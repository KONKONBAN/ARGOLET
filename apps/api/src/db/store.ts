import {
  AppError,
  ConcurrencyError,
  type CollectionName,
  type Collections,
  type NewRow,
  type Store,
  type Tx,
} from '@argolet/app';
import { decodeRow, filterWhere, keyMatchesScope, keyWhere, planFor, upsertRow } from './codec';
import type { SqlClient, SqlDriver } from './drivers';
import { runMigrations, type MigrationReport } from './migrate';

/**
 * PostgreSQL implementation of the storage port on the relational schema (one typed table per
 * collection, see db/tables.ts and migrations/). Every command runs in a SERIALIZABLE
 * transaction, retried on serialization failures, so business data, DomainEvents and the
 * outbox commit atomically; integrity constraints are checked when the transaction commits.
 */
export class PgStore implements Store {
  readonly kind: string;
  private lastTs = 0;

  constructor(
    private readonly driver: SqlDriver,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    this.kind = `postgres:${driver.kind}`;
  }

  migrate(log?: (msg: string) => void): Promise<MigrationReport> {
    return runMigrations(this.driver, log);
  }

  /** Strictly increasing timestamps so ordering by updatedAt is deterministic. */
  private tick(): string {
    let t = Date.parse(this.clock());
    if (t <= this.lastTs) t = this.lastTs + 1;
    this.lastTs = t;
    return new Date(t).toISOString();
  }

  private async select(c: SqlClient, col: CollectionName, filter: Record<string, unknown>) {
    const plan = planFor(col);
    const params: unknown[] = [];
    const conds = filterWhere(plan, filter, params);
    const r = await c.query<Record<string, unknown>>(
      `SELECT ${plan.select} FROM ${plan.table}${conds.length ? ` WHERE ${conds.join(' AND ')}` : ''} ORDER BY created_at, id`,
      params,
    );
    return r.rows.map((row) => decodeRow(plan, row));
  }

  private makeTx(c: SqlClient, writable: boolean): Tx {
    const readOnly = () => {
      if (!writable) throw new Error('Read-only transaction');
    };
    return {
      get: async (col, tenantId, id) => {
        const plan = planFor(col);
        if (!keyMatchesScope(plan, tenantId, id)) return undefined;
        const k = keyWhere(plan, tenantId, id);
        const r = await c.query<Record<string, unknown>>(
          `SELECT ${plan.select} FROM ${plan.table} WHERE ${k.sql}`,
          k.params,
        );
        return (r.rows[0] ? decodeRow(plan, r.rows[0]) : undefined) as never;
      },
      list: async (col, tenantId, filter) =>
        (await this.select(c, col, { ...(filter as Record<string, unknown>), tenantId })) as never,
      findGlobal: async (col, filter) =>
        (await this.select(c, col, filter as Record<string, unknown>)) as never,
      put: async <K extends CollectionName>(
        col: K,
        row: NewRow<K> | Collections[K],
        opts?: { expectedRev?: number },
      ) => {
        readOnly();
        const plan = planFor(col);
        const r = row as unknown as Record<string, unknown> & { id: string; tenantId: string };
        if (!r.id || !r.tenantId) throw new Error(`Thiếu id/tenantId khi ghi ${col}`);
        const k = keyWhere(plan, r.tenantId, r.id);
        const prev = keyMatchesScope(plan, r.tenantId, r.id)
          ? (
              await c.query<{ rev: number; created_at: string }>(
                `SELECT rev, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
                   FROM ${plan.table} WHERE ${k.sql} FOR UPDATE`,
                k.params,
              )
            ).rows[0]
          : undefined;
        if (opts?.expectedRev !== undefined && (prev?.rev ?? 0) !== opts.expectedRev)
          throw new ConcurrencyError();
        const now = this.tick();
        const saved = await upsertRow(c, plan, r, {
          rev: (prev?.rev ?? 0) + 1,
          createdAt: prev?.created_at || (r.createdAt as string) || now,
          updatedAt: now,
        });
        return saved as never;
      },
      delete: async (col, tenantId, id) => {
        readOnly();
        const plan = planFor(col);
        if (!keyMatchesScope(plan, tenantId, id)) return;
        const k = keyWhere(plan, tenantId, id);
        await c.query(`DELETE FROM ${plan.table} WHERE ${k.sql}`, k.params);
      },
    };
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
        if (code === '23505')
          throw new AppError(
            'CONFLICT',
            'Dữ liệu này đã tồn tại (trùng mã hoặc tên). Vui lòng kiểm tra lại.',
            {
              constraint: (e as { constraint?: string }).constraint,
            },
          );
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
