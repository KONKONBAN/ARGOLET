/**
 * The complete new-company scenario (empty system, every module, period close and rollover)
 * on the SQL store: embedded PGlite always, a real PostgreSQL server when PG_TEST_URL is set.
 * SQL enforces types the in-memory store does not (e.g. timestamps), so both must pass.
 */
import { afterAll, describe, it } from 'vitest';
import { ScryptHasher } from '@argolet/app';
import type { PgStore } from '../src/db';
import { openStore, PG_URL } from './pg';
import { newCompanyScenario } from '../../../packages/app/test/scenarios/newCompany';

const opened: PgStore[] = [];
const hasher = new ScryptHasher(2 ** 10, 8, 1);

afterAll(async () => {
  for (const s of opened) await s.close();
});

describe('new company on SQL storage', () => {
  it('runs end to end on PGlite', async () => {
    await newCompanyScenario(async (now) => {
      const s = await openStore('pglite', now);
      opened.push(s);
      return s;
    }, hasher);
  }, 120_000);

  it.skipIf(!PG_URL)(
    'runs end to end on PostgreSQL',
    async () => {
      await newCompanyScenario(async (now) => {
        const s = await openStore('postgres', now);
        opened.push(s);
        return s;
      }, hasher);
    },
    120_000,
  );
});
