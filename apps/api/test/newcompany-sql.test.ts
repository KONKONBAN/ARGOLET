/**
 * The complete new-company scenario (empty system, every module, period close and rollover)
 * on the SQL store: embedded PGlite always, a real PostgreSQL server when PG_TEST_URL is set.
 * SQL enforces types the in-memory store does not (e.g. timestamps), so both must pass.
 */
import { afterAll, describe, it } from 'vitest';
import { ScryptHasher } from '@argolet/app';
import { PgStore, pgDriver, pgliteDriver } from '../src/pgStore';
import { newCompanyScenario } from '../../../packages/app/test/scenarios/newCompany';

const PG_URL = process.env.PG_TEST_URL;
const opened: PgStore[] = [];
const hasher = new ScryptHasher(2 ** 10, 8, 1);

afterAll(async () => {
  for (const s of opened) await s.close();
});

describe('new company on SQL storage', () => {
  it('runs end to end on PGlite', async () => {
    await newCompanyScenario(async (now) => {
      const s = new PgStore(await pgliteDriver(), now);
      await s.migrate();
      opened.push(s);
      return s;
    }, hasher);
  }, 120_000);

  it.skipIf(!PG_URL)(
    'runs end to end on PostgreSQL',
    async () => {
      await newCompanyScenario(async (now) => {
        const s = new PgStore(await pgDriver(PG_URL!), now);
        await s.migrate();
        const { default: pg } = await import('pg');
        const c = new pg.Client({ connectionString: PG_URL });
        await c.connect();
        await c.query('TRUNCATE argolet_rows');
        await c.end();
        opened.push(s);
        return s;
      }, hasher);
    },
    120_000,
  );
});
