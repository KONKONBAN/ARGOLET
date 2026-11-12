import type { CollectionName, Collections, NewRow, Store, Tx } from '@argolet/app';
import { ConcurrencyError } from '@argolet/app';

/**
 * PostgreSQL implementation of the storage port.
 * Rows live in one tenant-partitioned JSONB table (collection, tenant_id, id) and the
 * business tables of the data model (board section 08 – Tenant, LegalEntity,
 * BusinessRecord, …, EvidenceReceipt) are exposed as relational views for reporting.
 * Every command runs in a SERIALIZABLE transaction and is retried on serialization
 * failures, so data + DomainEvent + outbox commit atomically.
 */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

export interface SqlDriver {
  readonly kind: string;
  /** Run `fn` inside one database transaction. */
  transaction<T>(fn: (client: SqlClient) => Promise<T>, isolation: 'serializable' | 'read committed'): Promise<T>;
  /** Non-transactional reads. */
  client(): SqlClient;
  close(): Promise<void>;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS argolet_rows (
  collection  text        NOT NULL,
  tenant_id   text        NOT NULL,
  id          text        NOT NULL,
  rev         integer     NOT NULL,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  data        jsonb       NOT NULL,
  PRIMARY KEY (collection, tenant_id, id)
);
CREATE INDEX IF NOT EXISTS argolet_rows_data_idx ON argolet_rows USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS argolet_rows_outbox_idx ON argolet_rows ((data->>'publishedAt')) WHERE collection = 'outbox';
CREATE TABLE IF NOT EXISTS argolet_meta (key text PRIMARY KEY, value text NOT NULL);

CREATE OR REPLACE VIEW tenant AS
  SELECT id AS tenant_id, data->>'policyVersion' AS policy_version, data->>'name' AS name FROM argolet_rows WHERE collection = 'tenants';
CREATE OR REPLACE VIEW legal_entity AS
  SELECT tenant_id, id AS entity_id, data->>'baseCurrency' AS base_currency, data->>'timezone' AS timezone, data->>'kind' AS kind, data->>'name' AS name
  FROM argolet_rows WHERE collection = 'entities';
CREATE OR REPLACE VIEW business_record AS
  SELECT tenant_id, data->>'recordId' AS record_id, (data->>'version')::int AS version, data->>'entityId' AS entity_id, data->>'kind' AS kind,
         (data->>'amount')::numeric AS amount, data->>'currency' AS currency, (data->>'date')::date AS record_date, data->>'matchGroupId' AS match_group_id
  FROM argolet_rows WHERE collection IN ('records', 'recordHistory');
CREATE OR REPLACE VIEW source_artifact AS
  SELECT tenant_id, id AS artifact_id, data->>'rawSha256' AS raw_sha256, data->>'objectUri' AS object_uri, data->>'sourceKey' AS source_key
  FROM argolet_rows WHERE collection = 'artifacts';
CREATE OR REPLACE VIEW document_version AS
  SELECT tenant_id, data->>'documentId' AS document_id, (data->>'version')::int AS version, data->>'artifactId' AS artifact_id,
         data->>'parserVersion' AS parser_version, data->>'fieldLocator' AS field_locator, data->>'fingerprint' AS fingerprint
  FROM argolet_rows WHERE collection = 'documentVersions';
CREATE OR REPLACE VIEW match_group AS
  SELECT tenant_id, id AS group_id, data->>'code' AS code, data->>'inputSnapshotVersion' AS input_snapshot_version, data->>'rulesVersion' AS rules_version,
         data->>'status' AS status, (data->>'net')::numeric AS net, (data->>'received')::numeric AS received
  FROM argolet_rows WHERE collection = 'matchGroups';
CREATE OR REPLACE VIEW match_allocation AS
  SELECT r.tenant_id, r.id AS group_id, a->>'recordId' AS record_id, (a->>'recordVersion')::int AS record_version,
         (a->>'allocatedAmount')::numeric AS allocated_amount, a->>'role' AS role
  FROM argolet_rows r, jsonb_array_elements(r.data->'allocations') a WHERE r.collection = 'matchGroups';
CREATE OR REPLACE VIEW record_evidence AS
  SELECT tenant_id, data->>'recordId' AS record_id, (data->>'recordVersion')::int AS record_version, data->>'documentId' AS document_id,
         (data->>'documentVersion')::int AS document_version, data->>'fieldLocator' AS field_locator
  FROM argolet_rows WHERE collection = 'recordEvidence';
CREATE OR REPLACE VIEW approval AS
  SELECT tenant_id, id AS approval_id, data->>'targetId' AS target_id, (data->>'targetVersion')::int AS target_version, data->>'digest' AS digest,
         data->>'actorId' AS actor_id, data->>'status' AS status, data->>'policyVersion' AS policy_version
  FROM argolet_rows WHERE collection = 'approvals';
CREATE OR REPLACE VIEW close_snapshot AS
  SELECT tenant_id, id AS close_id, data->>'entityId' AS entity_id, data->>'periodId' AS period_id, (data->>'version')::int AS version,
         data->>'previousCloseId' AS previous_close_id, data->>'rulesVersion' AS rules_version, data->>'manifestDigest' AS manifest_digest
  FROM argolet_rows WHERE collection = 'closeSnapshots';
CREATE OR REPLACE VIEW snapshot_member AS
  SELECT s.tenant_id, s.id AS close_id, m->>'recordId' AS record_id, (m->>'recordVersion')::int AS record_version, m->>'digest' AS member_digest
  FROM argolet_rows s, jsonb_array_elements(s.data->'manifest'->'members') m WHERE s.collection = 'closeSnapshots';
CREATE OR REPLACE VIEW evidence_receipt AS
  SELECT tenant_id, data->>'targetId' AS target_id, data->>'targetType' AS target_type, data->>'batchCode' AS batch_id, data->>'merkleRoot' AS merkle_root,
         data->>'transactionId' AS transaction_id, (data->>'blockNumber')::int AS block_number, data->>'validationCode' AS validation_code
  FROM argolet_rows WHERE collection = 'evidenceReceipts';
`;

type RowShape = { id: string; tenantId: string; rev?: number; createdAt?: string };

export class PgStore implements Store {
  readonly kind: string;
  private lastTs = 0;

  constructor(
    private readonly driver: SqlDriver,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.kind = `postgres:${driver.kind}`;
  }

  async migrate(): Promise<void> {
    await this.driver.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(424242)');
      for (const stmt of SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await c.query(stmt);
      await c.query(`INSERT INTO argolet_meta(key, value) VALUES ('schema_version', '1') ON CONFLICT (key) DO NOTHING`);
    }, 'read committed');
  }

  private tick(): string {
    let t = Date.parse(this.clock());
    if (t <= this.lastTs) t = this.lastTs + 1;
    this.lastTs = t;
    return new Date(t).toISOString();
  }

  private makeTx(c: SqlClient, writable: boolean): Tx {
    const tx: Tx = {
      get: async (col, tenantId, id) => {
        const r = await c.query<{ data: unknown }>('SELECT data FROM argolet_rows WHERE collection = $1 AND tenant_id = $2 AND id = $3', [col, tenantId, id]);
        return (r.rows[0]?.data ?? undefined) as never;
      },
      list: async (col, tenantId, filter) => {
        const r = await c.query<{ data: unknown }>(
          'SELECT data FROM argolet_rows WHERE collection = $1 AND tenant_id = $2 AND data @> $3::jsonb ORDER BY created_at, id',
          [col, tenantId, JSON.stringify(cleanFilter(filter))],
        );
        return r.rows.map((x) => x.data) as never;
      },
      findGlobal: async (col, filter) => {
        const r = await c.query<{ data: unknown }>('SELECT data FROM argolet_rows WHERE collection = $1 AND data @> $2::jsonb ORDER BY created_at, id', [col, JSON.stringify(cleanFilter(filter))]);
        return r.rows.map((x) => x.data) as never;
      },
      put: async <K extends CollectionName>(col: K, row: NewRow<K> | Collections[K], opts?: { expectedRev?: number }) => {
        if (!writable) throw new Error('Read-only transaction');
        const r = row as unknown as RowShape;
        if (!r.id || !r.tenantId) throw new Error(`Thiếu id/tenantId khi ghi ${col}`);
        const existing = await c.query<{ rev: number; created_at: Date | string }>(
          'SELECT rev, created_at FROM argolet_rows WHERE collection = $1 AND tenant_id = $2 AND id = $3 FOR UPDATE',
          [col, r.tenantId, r.id],
        );
        const prev = existing.rows[0];
        if (opts?.expectedRev !== undefined && (prev?.rev ?? 0) !== opts.expectedRev) throw new ConcurrencyError();
        const now = this.tick();
        const createdAt = prev ? new Date(prev.created_at).toISOString() : r.createdAt ?? now;
        const rev = (prev?.rev ?? 0) + 1;
        const saved = { ...stripUndefined(row as object), createdAt, updatedAt: now, rev };
        await c.query(
          `INSERT INTO argolet_rows (collection, tenant_id, id, rev, created_at, updated_at, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (collection, tenant_id, id) DO UPDATE SET rev = EXCLUDED.rev, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
          [col, r.tenantId, r.id, rev, createdAt, now, JSON.stringify(saved)],
        );
        return saved as never;
      },
      delete: async (col, tenantId, id) => {
        if (!writable) throw new Error('Read-only transaction');
        await c.query('DELETE FROM argolet_rows WHERE collection = $1 AND tenant_id = $2 AND id = $3', [col, tenantId, id]);
      },
    };
    return tx;
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.driver.transaction((c) => fn(this.makeTx(c, true)), 'serializable');
      } catch (e) {
        const code = (e as { code?: string }).code;
        if ((code === '40001' || code === '40P01') && attempt < 6) {
          await new Promise((r) => setTimeout(r, 10 * 2 ** attempt + Math.random() * 20));
          continue;
        }
        throw e;
      }
    }
  }

  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(this.makeTx(this.driver.client(), false));
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}

/** JSON containment: drop undefined keys (they mean "no constraint"). */
function cleanFilter(filter?: object): Record<string, unknown> {
  if (!filter) return {};
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined));
}

function stripUndefined<T extends object>(row: T): T {
  return JSON.parse(JSON.stringify(row)) as T;
}

// ───────────── drivers ─────────────

/** node-postgres pool driver (production). */
export async function pgDriver(connectionString: string): Promise<SqlDriver> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({ connectionString, max: Number(process.env.PG_POOL_MAX ?? 10), ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined });
  return {
    kind: 'pg',
    client: () => ({ query: (text, params) => pool.query(text, params as unknown[]) as never }),
    async transaction(fn, isolation) {
      const client = await pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL ${isolation === 'serializable' ? 'SERIALIZABLE' : 'READ COMMITTED'}`);
        const result = await fn({ query: (text, params) => client.query(text, params as unknown[]) as never });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres (WASM) for development, tests and single-node demos. */
export async function pgliteDriver(dataDir?: string): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  // PGlite has a single connection: serialise transactions explicitly.
  let queue: Promise<unknown> = Promise.resolve();
  const client: SqlClient = { query: (text, params) => db.query(text, params) as never };
  return {
    kind: dataDir ? 'pglite-file' : 'pglite-memory',
    client: () => client,
    transaction(fn) {
      const run = () => db.transaction((tx) => fn({ query: (text, params) => tx.query(text, params) as never }));
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p as never;
    },
    close: () => db.close(),
  };
}
