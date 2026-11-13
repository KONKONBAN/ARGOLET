import { GLOBAL, type CollectionName, type Collections, type NewRow } from './types';

/**
 * Storage port. Every call is tenant-scoped (tenantId is part of the key), and writes
 * happen inside a transaction so business data, DomainEvents and the outbox commit
 * atomically (board 07 "Ghi dữ liệu và sự kiện ... trong cùng giao dịch CSDL").
 */
export interface Tx {
  get<K extends CollectionName>(col: K, tenantId: string, id: string): Promise<Collections[K] | undefined>;
  list<K extends CollectionName>(
    col: K,
    tenantId: string,
    filter?: Partial<Collections[K]>,
  ): Promise<Collections[K][]>;
  /** Cross-tenant lookup — only for global identity tables (users, invitations, sessions). */
  findGlobal<K extends CollectionName>(col: K, filter: Partial<Collections[K]>): Promise<Collections[K][]>;
  put<K extends CollectionName>(
    col: K,
    row: NewRow<K> | Collections[K],
    opts?: { expectedRev?: number },
  ): Promise<Collections[K]>;
  delete<K extends CollectionName>(col: K, tenantId: string, id: string): Promise<void>;
}

export interface Store {
  readonly kind: string;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Read-only convenience; implementations may skip locking. */
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export class ConcurrencyError extends Error {
  constructor(message = 'Dữ liệu đã được người khác cập nhật, vui lòng tải lại') {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export function matches<T extends object>(row: T, filter?: Partial<T>): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (v === undefined) continue;
    if ((row as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

type Table = Map<string, unknown>;
const key = (tenantId: string, id: string) => `${tenantId}\u0000${id}`;

/**
 * In-memory store with serialised transactions and copy-on-commit semantics.
 * Used by the browser demo backend, tests, and the API in development.
 * Optional `persist` callback lets the browser save a snapshot (localStorage/IndexedDB).
 */
export class MemoryStore implements Store {
  readonly kind = 'memory';
  private tables = new Map<CollectionName, Table>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastTs = 0;

  constructor(
    initial?: Record<string, Record<string, unknown>>,
    private readonly persist?: (dump: Record<string, Record<string, unknown>>) => void,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {
    if (initial) {
      for (const [col, rows] of Object.entries(initial)) {
        this.tables.set(col as CollectionName, new Map(Object.entries(rows)));
      }
    }
  }

  private table(col: CollectionName): Table {
    let t = this.tables.get(col);
    if (!t) {
      t = new Map();
      this.tables.set(col, t);
    }
    return t;
  }

  /** Strictly increasing timestamps so ordering by updatedAt is deterministic. */
  private tick(): string {
    let t = Date.parse(this.clock());
    if (t <= this.lastTs) t = this.lastTs + 1;
    this.lastTs = t;
    return new Date(t).toISOString();
  }

  dump(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [col, t] of this.tables) out[col] = Object.fromEntries(t);
    return out;
  }

  count(col: CollectionName): number {
    return this.table(col).size;
  }

  private makeTx(writes: Map<CollectionName, Map<string, unknown | null>> | null): Tx {
    const readRow = (col: CollectionName, k: string): unknown => {
      const w = writes?.get(col);
      if (w && w.has(k)) return w.get(k) ?? undefined;
      return this.table(col).get(k);
    };
    const allRows = (col: CollectionName): unknown[] => {
      const base = new Map(this.table(col));
      const w = writes?.get(col);
      if (w) {
        for (const [k, v] of w) {
          if (v === null) base.delete(k);
          else base.set(k, v);
        }
      }
      return [...base.values()];
    };
    const tx: Tx = {
      get: async (col, tenantId, id) => clone(readRow(col, key(tenantId, id))) as never,
      list: async (col, tenantId, filter) =>
        allRows(col)
          .filter(
            (r) =>
              (r as { tenantId: string }).tenantId === tenantId && matches(r as object, filter as object),
          )
          .map(clone) as never,
      findGlobal: async (col, filter) =>
        allRows(col)
          .filter((r) => matches(r as object, filter as object))
          .map(clone) as never,
      put: async (col, row, opts) => {
        if (!writes) throw new Error('Read-only transaction');
        const r = row as unknown as { id: string; tenantId: string; rev?: number; createdAt?: string };
        if (!r.id || !r.tenantId) throw new Error(`Thiếu id/tenantId khi ghi ${col}`);
        const k = key(r.tenantId, r.id);
        const existing = readRow(col, k) as { rev: number; createdAt: string } | undefined;
        if (opts?.expectedRev !== undefined && (existing?.rev ?? 0) !== opts.expectedRev)
          throw new ConcurrencyError();
        const now = this.tick();
        const saved = {
          ...clone(row),
          createdAt: existing?.createdAt || r.createdAt || now,
          updatedAt: now,
          rev: (existing?.rev ?? 0) + 1,
        };
        if (!writes.has(col)) writes.set(col, new Map());
        writes.get(col)!.set(k, saved);
        return clone(saved) as never;
      },
      delete: async (col, tenantId, id) => {
        if (!writes) throw new Error('Read-only transaction');
        if (!writes.has(col)) writes.set(col, new Map());
        writes.get(col)!.set(key(tenantId, id), null);
      },
    };
    return tx;
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async () => {
      const writes = new Map<CollectionName, Map<string, unknown | null>>();
      const result = await fn(this.makeTx(writes));
      for (const [col, rows] of writes) {
        const t = this.table(col);
        for (const [k, v] of rows) {
          if (v === null) t.delete(k);
          else t.set(k, v);
        }
      }
      if (writes.size && this.persist) this.persist(this.dump());
      return result;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return fn(this.makeTx(null));
  }
}

export { GLOBAL };
