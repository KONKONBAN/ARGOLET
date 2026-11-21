import { COLLECTIONS } from '@argolet/app';
import { sha256Hex } from '@argolet/core';
import { planFor, upsertRow } from './codec';
import type { SqlClient, SqlDriver } from './drivers';
import { sql as relationalSchema } from './migrations/0001_relational_schema';
import { sql as connections } from './migrations/0002_connections';
import { sql as assistantKnowledge } from './migrations/0003_assistant_knowledge';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Data step run in the same transaction, after the DDL. */
  after?: (client: SqlClient, log: (msg: string) => void) => Promise<void>;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'relational_schema', sql: relationalSchema, after: importLegacyJsonStore },
  { version: 2, name: 'connections', sql: connections },
  { version: 3, name: 'assistant_knowledge', sql: assistantKnowledge },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

const MIGRATION_LOCK = 424242;

export interface MigrationReport {
  applied: number[];
  current: number;
}

/**
 * Applies pending migrations in one transaction under an advisory lock (several server
 * instances may start together). A migration that was edited after being applied is refused:
 * its recorded checksum no longer matches.
 */
export async function runMigrations(
  driver: SqlDriver,
  log: (msg: string) => void = () => undefined,
): Promise<MigrationReport> {
  return driver.transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await c.exec(`
      CREATE SCHEMA IF NOT EXISTS argolet;
      CREATE TABLE IF NOT EXISTS argolet.schema_migrations (
        version    integer     PRIMARY KEY,
        name       text        NOT NULL,
        checksum   text        NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );`);
    const done = new Map(
      (
        await c.query<{ version: number; checksum: string }>(
          'SELECT version, checksum FROM argolet.schema_migrations',
        )
      ).rows.map((r) => [Number(r.version), r.checksum]),
    );
    const applied: number[] = [];
    for (const m of MIGRATIONS) {
      const checksum = sha256Hex(m.sql);
      const recorded = done.get(m.version);
      if (recorded !== undefined) {
        if (recorded !== checksum)
          throw new Error(
            `Migration ${m.version} (${m.name}) đã bị sửa sau khi áp dụng – hãy tạo migration mới thay vì sửa file cũ`,
          );
        continue;
      }
      await c.exec(m.sql);
      await m.after?.(c, log);
      await c.query('INSERT INTO argolet.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [
        m.version,
        m.name,
        checksum,
      ]);
      applied.push(m.version);
      log(`[db] migration ${m.version} ${m.name} applied`);
    }
    const unknown = [...done.keys()].filter((v) => v > SCHEMA_VERSION);
    if (unknown.length)
      throw new Error(
        `CSDL đang ở phiên bản lược đồ ${Math.max(...unknown)}, mới hơn phiên bản máy chủ này hỗ trợ (${SCHEMA_VERSION})`,
      );
    return { applied, current: SCHEMA_VERSION };
  }, 'read committed');
}

const LEGACY_VIEWS = [
  'tenant',
  'legal_entity',
  'business_record',
  'source_artifact',
  'document_version',
  'match_group',
  'match_allocation',
  'record_evidence',
  'approval',
  'close_snapshot',
  'snapshot_member',
  'evidence_receipt',
];

/**
 * Databases created by the first release kept every row as JSON in public.argolet_rows. Their
 * rows are copied into the typed tables (every constraint is checked at commit, so a bad row
 * aborts the upgrade instead of being half-imported); the old table is kept, renamed, as a backup.
 */
async function importLegacyJsonStore(c: SqlClient, log: (msg: string) => void): Promise<void> {
  const found = await c.query<{ reg: string | null }>(
    `SELECT to_regclass('public.argolet_rows')::text AS reg`,
  );
  if (!found.rows[0]?.reg) return;
  let count = 0;
  for (const col of COLLECTIONS) {
    const plan = planFor(col);
    const rows = await c.query<{
      data: Record<string, unknown>;
      rev: number;
      created: string;
      updated: string;
    }>(
      `SELECT data, rev, created_at::text AS created, updated_at::text AS updated
         FROM public.argolet_rows WHERE collection = $1 ORDER BY created_at, id`,
      [col],
    );
    for (const r of rows.rows) {
      const { rev, createdAt, updatedAt, ...data } = r.data;
      await upsertRow(c, plan, data, {
        rev: Number(rev ?? r.rev) || 1,
        createdAt: (createdAt as string) || r.created,
        updatedAt: (updatedAt as string) || r.updated,
      });
      count++;
    }
  }
  await c.exec(`
    DROP VIEW IF EXISTS ${LEGACY_VIEWS.map((v) => `public.${v}`).join(', ')};
    ALTER TABLE public.argolet_rows RENAME TO argolet_rows_v1_backup;
    ALTER TABLE IF EXISTS public.argolet_meta RENAME TO argolet_meta_v1_backup;`);
  log(`[db] imported ${count} rows from the v1 JSON store (kept as public.argolet_rows_v1_backup)`);
}
