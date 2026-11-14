/**
 * The relational schema itself: it matches the row mapping, every reference and rule is
 * enforced by PostgreSQL, every row of the demo and of a brand-new company survives a round
 * trip unchanged, migrations are versioned and checked, and v1 databases are upgraded in place.
 * Runs on embedded PGlite always and on a real PostgreSQL server when PG_TEST_URL is set.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AppError,
  canonicalDecimal,
  COLLECTIONS,
  createArgoletApp,
  demoClock,
  GLOBAL,
  MemoryStore,
  ScryptHasher,
  seedDemo,
  type CollectionName,
  type Store,
} from '@argolet/app';
import { columnsOf, MIGRATIONS, PgStore, pgDriver, pgliteDriver, SCHEMA_VERSION, TABLES } from '../src/db';
import type { SqlClient } from '../src/db';
import { renderDataDictionary } from '../src/db/docs';
import { newCompanyScenario } from '../../../packages/app/test/scenarios/newCompany';
import { openStore, PG_URL, resetPostgres, seedTenants } from './pg';

const hasher = new ScryptHasher(2 ** 10, 8, 1);
const opened: PgStore[] = [];
afterAll(async () => {
  for (const s of opened) await s.close();
});

type Kind = 'pglite' | 'postgres';
const KINDS: Kind[] = PG_URL ? ['pglite', 'postgres'] : ['pglite'];

async function open(kind: Kind, opts?: { migrate?: boolean }): Promise<PgStore> {
  const s = await openStore(kind, undefined, opts);
  opened.push(s);
  return s;
}

/** Raw SQL next to a store, for inspecting the catalog and simulating old databases. */
async function sqlFor(kind: Kind): Promise<{ store: PgStore; sql: SqlClient }> {
  if (kind === 'postgres') await resetPostgres(PG_URL!);
  const driver = kind === 'postgres' ? await pgDriver(PG_URL!) : await pgliteDriver();
  const store = new PgStore(driver);
  opened.push(store);
  return { store, sql: driver.client() };
}

async function demoDump(): Promise<Record<string, Record<string, Record<string, unknown>>>> {
  const clock = demoClock();
  const mem = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const app = createArgoletApp({ store: mem, hasher, clock });
  await seedDemo(app);
  await app.core.relay.drain();
  return mem.dump() as never;
}

async function newCompanyDump(): Promise<Record<string, Record<string, Record<string, unknown>>>> {
  let mem: MemoryStore | undefined;
  await newCompanyScenario((now) => (mem = new MemoryStore(undefined, undefined, now)), hasher);
  return mem!.dump() as never;
}

const strip = ({ rev: _r, updatedAt: _u, ...rest }: Record<string, unknown>) => rest;

async function expectRoundTrip(store: Store, dump: Record<string, Record<string, Record<string, unknown>>>) {
  let rows = 0;
  await store.transaction(async (tx) => {
    for (const col of COLLECTIONS)
      for (const row of Object.values(dump[col] ?? {})) {
        await tx.put(col, row as never);
        rows++;
      }
  });
  for (const col of COLLECTIONS)
    for (const row of Object.values(dump[col] ?? {})) {
      const got = await store.read((tx) => tx.get(col, row.tenantId as string, row.id as string));
      expect(got && strip(got as never), `${col}/${String(row.id)}`).toEqual(strip(row));
    }
  return rows;
}

const SQL_TYPE: Record<string, string> = {
  text: 'text',
  int: 'integer',
  bigint: 'bigint',
  real: 'double precision',
  numeric: 'numeric',
  bool: 'boolean',
  timestamp: 'timestamp with time zone',
  date: 'date',
  json: 'jsonb',
  textArray: 'ARRAY',
};

describe.each(KINDS)('relational schema · %s', (kind) => {
  it('matches the row mapping: every table, column, SQL type and NOT NULL', async () => {
    const { store, sql } = await sqlFor(kind);
    await store.migrate();
    const cols = (
      await sql.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
        `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
          WHERE table_schema = 'argolet' AND table_name IN (
            SELECT table_name FROM information_schema.tables WHERE table_schema = 'argolet' AND table_type = 'BASE TABLE')`,
      )
    ).rows;
    const tables = new Set(cols.map((c) => c.table_name));
    expect([...tables].sort()).toEqual(
      [...COLLECTIONS.map((c) => TABLES[c].table), 'schema_migrations'].sort(),
    );
    for (const col of COLLECTIONS) {
      const def = TABLES[col];
      const actual = new Map(cols.filter((c) => c.table_name === def.table).map((c) => [c.column_name, c]));
      const expected = new Map<string, { type: string; nullable: boolean }>([
        ['id', { type: 'text', nullable: false }],
        ['rev', { type: 'integer', nullable: false }],
        ['created_at', { type: 'timestamp with time zone', nullable: false }],
        ['updated_at', { type: 'timestamp with time zone', nullable: false }],
      ]);
      if (def.scope === 'tenant' || def.scope === 'mixed')
        expected.set('tenant_id', { type: 'text', nullable: false });
      for (const c of columnsOf(col))
        expected.set(c.column, {
          type: SQL_TYPE[c.def.kind]!,
          nullable: !!(c.def.nullable || c.def.optional || c.def.blankAsNull),
        });
      expect([...actual.keys()].sort(), def.table).toEqual([...expected.keys()].sort());
      for (const [name, e] of expected) {
        const a = actual.get(name)!;
        expect(`${def.table}.${name} ${a.data_type} ${a.is_nullable}`).toBe(
          `${def.table}.${name} ${e.type} ${e.nullable ? 'YES' : 'NO'}`,
        );
      }
    }
  });

  it('defers every foreign key to commit and indexes every foreign key', async () => {
    const { store, sql } = await sqlFor(kind);
    await store.migrate();
    const notDeferred = await sql.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'argolet'::regnamespace AND NOT (condeferrable AND condeferred)`,
    );
    expect(notDeferred.rows).toEqual([]);
    const unindexed = await sql.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
        WHERE c.contype = 'f' AND c.connamespace = 'argolet'::regnamespace
          AND NOT EXISTS (
            SELECT 1 FROM pg_index i
             WHERE i.indrelid = c.conrelid
               AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] @> c.conkey
               AND (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] <@ c.conkey)`,
    );
    expect(unindexed.rows.map((r) => r.conname)).toEqual([]);
    const count = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE contype = 'f' AND connamespace = 'argolet'::regnamespace`,
    );
    expect(count.rows[0]!.n).toBeGreaterThan(60);
  });

  it('stores every row of the demo dataset and reads it back unchanged', async () => {
    const store = await open(kind);
    const rows = await expectRoundTrip(store, await demoDump());
    expect(rows).toBeGreaterThan(1500);
  }, 180_000);

  it('stores every row written by a brand-new company (all modules) and reads it back unchanged', async () => {
    const store = await open(kind);
    expect(await expectRoundTrip(store, await newCompanyDump())).toBeGreaterThan(100);
  }, 180_000);

  it('keeps value formats exactly: decimals, blanks, optional and nullable fields', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1']);
    await store.transaction(async (tx) => {
      await tx.put('deals', {
        id: 'd1',
        tenantId: 't1',
        code: 'CH-001',
        customer: 'Khách A',
        stage: 'QUOTE',
        value: '1250000.50',
        status: 'IN_PROGRESS',
        dueDate: '2026-12-01',
      });
      await tx.put('assets', {
        id: 'a1',
        tenantId: 't1',
        code: 'TS-001',
        name: 'Máy pha',
        kind: 'ASSET',
        projectCode: '',
        baseline: '',
        reporting: '',
        unit: '',
        schedule: '',
        dueDate: null,
        status: 'OK',
      });
      await tx.put('notifications', {
        id: 'n1',
        tenantId: 't1',
        userId: null,
        title: 'A',
        unitLabel: 'Q1',
        refCode: 'X',
        route: '/',
        status: 'UNREAD',
        actionRequired: false,
      });
    });
    const deal = await store.read((tx) => tx.get('deals', 't1', 'd1'));
    expect(deal).toMatchObject({ value: '1250000.50', dueDate: '2026-12-01', rev: 1 });
    expect(deal!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const asset = await store.read((tx) => tx.get('assets', 't1', 'a1'));
    expect(asset).toMatchObject({ baseline: '', reporting: '', dueDate: null });
    const n = await store.read((tx) => tx.get('notifications', 't1', 'n1'));
    expect(n).not.toHaveProperty('statusLabel');
    expect(n!.userId).toBeNull();
  });

  it('agrees with the application on the canonical spelling of decimals', async () => {
    const { store, sql } = await sqlFor(kind);
    await store.migrate();
    for (const v of ['7', '007', '0', '-0', '-0.00', '0.50', '1250000', '-00120.5', '18.1', '0.05'])
      expect((await sql.query<{ t: string }>('SELECT $1::numeric::text AS t', [v])).rows[0]!.t, v).toBe(
        canonicalDecimal(v),
      );
  });

  it('rejects fields without a column and keys outside the table scope', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1']);
    await expect(
      store.transaction((tx) =>
        tx.put('aggregateSeqs', { id: 'x', tenantId: 't1', seq: 1, extra: 'không có cột' } as never),
      ),
    ).rejects.toThrow(/chưa có cột/);
    await expect(
      store.transaction((tx) =>
        tx.put('credentials', { id: 'c', tenantId: 't1', userId: 'usr_fixture', passwordHash: 'h' } as never),
      ),
    ).rejects.toThrow(/không hợp lệ/);
    expect(await store.read((tx) => tx.get('users', 't1', 'usr_fixture'))).toBeUndefined();
    expect(await store.read((tx) => tx.get('users', GLOBAL, 'usr_fixture'))).toBeDefined();
  });

  it('enforces references, including that they stay inside one tenant', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1', 't2']);
    const unit = {
      id: 'site_a',
      name: 'Cơ sở A',
      shortName: 'A',
      code: 'CS-01',
      kind: 'SITE' as const,
      parentId: null,
      baseCurrency: 'VND',
      timezone: 'Asia/Ho_Chi_Minh',
    };
    await store.transaction((tx) => tx.put('entities', { ...unit, tenantId: 't1' }));
    const item = (tenantId: string) => ({
      id: 'itm_1',
      tenantId,
      entityId: 'site_a',
      name: 'Bột mì',
      unit: 'kg',
      onHand: '10',
      reorderLevel: '2',
      unitCost: '18000',
    });
    await store.transaction((tx) => tx.put('inventoryItems', item('t1')));
    // Same unit id, other tenant: the composite key (tenant_id, entity_id) does not exist there.
    await expect(store.transaction((tx) => tx.put('inventoryItems', item('t2')))).rejects.toMatchObject({
      code: '23503',
    });
    // A tenant that does not exist.
    await expect(
      store.transaction((tx) => tx.put('entities', { ...unit, id: 'site_b', tenantId: 'ten_missing' })),
    ).rejects.toMatchObject({ code: '23503' });
    // Order inside one transaction does not matter: checked at commit.
    await store.transaction(async (tx) => {
      await tx.put('inventoryItems', { ...item('t1'), id: 'itm_2', name: 'Đường', entityId: 'site_c' });
      await tx.put('entities', { ...unit, id: 'site_c', code: 'CS-02', name: 'Cơ sở C', tenantId: 't1' });
    });
  });

  it('enforces uniqueness per tenant and reports it as a conflict', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1', 't2']);
    const deal = (id: string, tenantId: string) => ({
      id,
      tenantId,
      code: 'CH-001',
      customer: 'Khách',
      stage: 'OPPORTUNITY' as const,
      value: '1000',
      status: 'WAITING_REPLY' as const,
      dueDate: '2026-12-01',
    });
    await store.transaction((tx) => tx.put('deals', deal('d1', 't1')));
    await store.transaction((tx) => tx.put('deals', deal('d1', 't2')));
    const err = await store.transaction((tx) => tx.put('deals', deal('d2', 't1'))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('CONFLICT');
  });

  it('enforces enumerations, formats and ranges', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1']);
    const deal = {
      id: 'd1',
      tenantId: 't1',
      code: 'CH-001',
      customer: 'Khách',
      stage: 'OPPORTUNITY' as const,
      value: '1000',
      status: 'WAITING_REPLY' as const,
      dueDate: '2026-12-01',
    };
    await expect(
      store.transaction((tx) => tx.put('deals', { ...deal, stage: 'WON' as never })),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      store.transaction((tx) => tx.put('deals', { ...deal, dueDate: '01/12/2026' })),
    ).rejects.toBeDefined();
    await expect(
      store.transaction((tx) =>
        tx.put('intercompany', {
          id: 'ic1',
          tenantId: 't1',
          reference: 'IC-1',
          contract: 'HD-1',
          periodId: '2026-13',
          sideA: { entityId: 'a', name: 'A', role: 'RECEIVABLE', amount: '1' },
          sideB: { entityId: 'b', name: 'B', role: 'PAYABLE', amount: '1' },
          status: 'MATCHED',
          nextAction: '',
          requestedAt: null,
        }),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      store.transaction((tx) =>
        tx.put('recipes', { id: 'r1', tenantId: 't1', name: 'Món', price: '-1', wasteRate: '0', lines: [] }),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps history append-only', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1']);
    const audit = {
      id: 'aud_1',
      tenantId: 't1',
      actorId: 'usr_fixture',
      actorName: 'Kiểm thử',
      action: 'document.validate',
      target: 'CT-0001',
      detail: '',
      correlationId: 'cor_1',
    };
    await store.transaction((tx) => tx.put('audit', audit));
    await expect(
      store.transaction((tx) => tx.put('audit', { ...audit, detail: 'sửa lại lịch sử' })),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(store.transaction((tx) => tx.delete('audit', 't1', 'aud_1'))).rejects.toMatchObject({
      code: '23001',
    });
    expect((await store.read((tx) => tx.get('audit', 't1', 'aud_1')))!.detail).toBe('');
  });

  it('stores partner connections with sealed credentials and an append-only sync log', async () => {
    const store = await open(kind);
    await seedTenants(store, ['t1']);
    await store.transaction((tx) =>
      tx.put('entities', {
        id: 'site_a',
        tenantId: 't1',
        name: 'Cơ sở A',
        shortName: 'A',
        code: 'CS-01',
        kind: 'SITE',
        parentId: null,
        baseCurrency: 'VND',
        timezone: 'Asia/Ho_Chi_Minh',
      }),
    );
    const conn = {
      id: 'conn_1',
      tenantId: 't1',
      provider: 'SEPAY' as const,
      label: 'Ngân hàng qua SePay',
      status: 'ACTIVE' as const,
      config: {},
      secretSealed: 'v1.aXY=.Y2lwaGVy',
      secretHint: '…K7Q2',
      cursor: null,
      entityId: 'site_a',
      connectedBy: 'usr_fixture',
      connectedByName: 'Người kiểm thử',
      connectedAt: '2026-11-14T02:00:00.000Z',
      lastSyncAt: null,
      lastError: null,
    };
    await store.transaction((tx) => tx.put('connections', conn));
    // An active connection always has its sealed credentials.
    await expect(
      store.transaction((tx) => tx.put('connections', { ...conn, id: 'conn_2', secretSealed: null })),
    ).rejects.toMatchObject({ code: '23514' });
    const run = {
      id: 'crun_1',
      tenantId: 't1',
      connectionId: 'conn_1',
      provider: 'SEPAY' as const,
      trigger: 'MANUAL' as const,
      startedAt: '2026-11-14T02:01:00.000Z',
      finishedAt: '2026-11-14T02:01:02.000Z',
      status: 'NO_CHANGE' as const,
      fetched: 0,
      imported: 0,
      requests: 1,
      documentId: null,
      documentCode: null,
      message: 'Không có dữ liệu mới từ đối tác',
      actorId: 'usr_fixture',
      actorName: 'Người kiểm thử',
    };
    await store.transaction((tx) => tx.put('connectionRuns', run));
    expect(await store.read((tx) => tx.get('connectionRuns', 't1', 'crun_1'))).toMatchObject(run);
    expect(await store.read((tx) => tx.get('connections', 't1', 'conn_1'))).toMatchObject(conn);
    await expect(
      store.transaction((tx) => tx.put('connectionRuns', { ...run, status: 'SUCCESS' as const })),
    ).rejects.toMatchObject({ code: '23001' });
    // Disconnecting forgets the credentials.
    await store.transaction((tx) =>
      tx.put('connections', { ...conn, status: 'DISCONNECTED', secretSealed: null }),
    );
  });

  it('records migrations with checksums, refuses edited or newer schemas, and is idempotent', async () => {
    const { store, sql } = await sqlFor(kind);
    expect(await store.migrate()).toEqual({
      applied: MIGRATIONS.map((m) => m.version),
      current: SCHEMA_VERSION,
    });
    expect(await store.migrate()).toEqual({ applied: [], current: SCHEMA_VERSION });
    await sql.query(`UPDATE argolet.schema_migrations SET checksum = 'x' WHERE version = 1`);
    await expect(store.migrate()).rejects.toThrow(/đã bị sửa/);
    await sql.query(`UPDATE argolet.schema_migrations SET checksum = $1 WHERE version = 1`, [
      (await import('@argolet/core')).sha256Hex(MIGRATIONS[0]!.sql),
    ]);
    await sql.query(
      `INSERT INTO argolet.schema_migrations (version, name, checksum) VALUES (99, 'future', 'x')`,
    );
    await expect(store.migrate()).rejects.toThrow(/mới hơn/);
  });

  it('upgrades a v1 (JSON) database in place and keeps the old table as a backup', async () => {
    const { store, sql } = await sqlFor(kind);
    const dump = await demoDump();
    await sql.exec(`CREATE TABLE argolet_rows (
        collection text NOT NULL, tenant_id text NOT NULL, id text NOT NULL, rev integer NOT NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, data jsonb NOT NULL,
        PRIMARY KEY (collection, tenant_id, id));
      CREATE TABLE argolet_meta (key text PRIMARY KEY, value text NOT NULL);
      INSERT INTO argolet_meta VALUES ('schema_version', '1');
      CREATE VIEW tenant AS SELECT id AS tenant_id FROM argolet_rows WHERE collection = 'tenants';`);
    let total = 0;
    for (const col of COLLECTIONS)
      for (const row of Object.values(dump[col] ?? {})) {
        await sql.query(`INSERT INTO argolet_rows VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [
          col,
          row.tenantId,
          row.id,
          row.rev,
          row.createdAt,
          row.updatedAt,
          JSON.stringify(row),
        ]);
        total++;
      }
    const logs: string[] = [];
    await store.migrate((m) => logs.push(m));
    expect(logs.join('\n')).toContain(`imported ${total} rows`);
    for (const col of COLLECTIONS)
      for (const row of Object.values(dump[col] ?? {})) {
        const got = await store.read((tx) =>
          tx.get(col as CollectionName, row.tenantId as string, row.id as string),
        );
        expect(got, `${col}/${String(row.id)}`).toEqual(row);
      }
    const backup = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.argolet_rows_v1_backup`,
    );
    expect(backup.rows[0]!.n).toBe(total);
    const legacy = await sql.query<{ reg: string | null }>(
      `SELECT to_regclass('public.argolet_rows')::text AS reg`,
    );
    expect(legacy.rows[0]!.reg).toBeNull();
  }, 180_000);

  it('serves the reporting views on real data', async () => {
    const { store, sql } = await sqlFor(kind);
    await store.migrate();
    const clock = demoClock();
    await seedDemo(createArgoletApp({ store, hasher, clock }));
    const one = async (q: string) => Number((await sql.query<{ n: string }>(q)).rows[0]!.n);
    expect(await one(`SELECT sum(groups_total)::text AS n FROM argolet.v_period_reconciliation`)).toBe(
      await one(`SELECT count(*)::text AS n FROM argolet.match_groups`),
    );
    expect(await one(`SELECT count(*)::text AS n FROM argolet.v_match_allocations`)).toBe(
      await one(`SELECT sum(jsonb_array_length(allocations))::text AS n FROM argolet.match_groups`),
    );
    for (const v of [
      'v_close_snapshot_members',
      'v_evidence_leaves',
      'v_document_lines',
      'v_membership_roles',
      'v_project_tasks',
      'v_shipment_costs',
      'v_recipe_lines',
    ])
      expect(await one(`SELECT count(*)::text AS n FROM argolet.${v}`), v).toBeGreaterThanOrEqual(0);
    expect(await one(`SELECT count(*)::text AS n FROM argolet.v_membership_roles`)).toBeGreaterThan(0);
  }, 180_000);
});

describe('documentation', () => {
  it('the data dictionary in docs/database is up to date (pnpm --filter @argolet/api db:docs)', async () => {
    const { store, sql } = await sqlFor('pglite');
    await store.migrate();
    const committed = readFileSync(
      new URL('../../../docs/database/data-dictionary.md', import.meta.url),
      'utf8',
    );
    expect(committed).toBe(await renderDataDictionary(sql, SCHEMA_VERSION));
  });
});
