/**
 * Minimal SQL driver port: a real PostgreSQL server through node-postgres (production) or
 * embedded PostgreSQL compiled to WebAssembly (PGlite: development, tests, single-node demos).
 */
export interface SqlClient {
  /** One parameterised statement. */
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  /** A script of several statements without parameters (migrations). */
  exec(script: string): Promise<void>;
}

export interface SqlDriver {
  readonly kind: string;
  /** Run `fn` inside one database transaction. */
  transaction<T>(
    fn: (client: SqlClient) => Promise<T>,
    isolation: 'serializable' | 'read committed',
  ): Promise<T>;
  /** Non-transactional reads. */
  client(): SqlClient;
  close(): Promise<void>;
}

/** node-postgres pool driver (production). */
export async function pgDriver(connectionString: string): Promise<SqlDriver> {
  const pg = await import('pg');
  const pool = new pg.default.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined,
  });
  const wrap = (q: { query: (text: string, params?: unknown[]) => Promise<unknown> }): SqlClient => ({
    query: (text, params) => q.query(text, params) as never,
    // Without parameters node-postgres uses the simple protocol, which accepts several statements.
    exec: async (script) => void (await q.query(script)),
  });
  return {
    kind: 'pg',
    client: () => wrap(pool),
    async transaction(fn, isolation) {
      const client = await pool.connect();
      try {
        await client.query(
          `BEGIN ISOLATION LEVEL ${isolation === 'serializable' ? 'SERIALIZABLE' : 'READ COMMITTED'}`,
        );
        const result = await fn(wrap(client));
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

/** Embedded PostgreSQL (WASM). `dataDir` persists to disk; omitted = in memory. */
export async function pgliteDriver(dataDir?: string): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  // PGlite has a single connection: serialise transactions explicitly.
  let queue: Promise<unknown> = Promise.resolve();
  const client: SqlClient = {
    query: (text, params) => db.query(text, params) as never,
    exec: async (script) => void (await db.exec(script)),
  };
  return {
    kind: dataDir ? 'pglite-file' : 'pglite-memory',
    client: () => client,
    transaction(fn) {
      const run = () =>
        db.transaction((tx) =>
          fn({
            query: (text, params) => tx.query(text, params) as never,
            exec: async (script) => void (await tx.exec(script)),
          }),
        );
      const p = queue.then(run, run);
      queue = p.catch(() => undefined);
      return p as never;
    },
    close: () => db.close(),
  };
}
