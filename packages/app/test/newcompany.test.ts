/** The new-company scenario on the in-memory store (also run on PGlite / PostgreSQL in apps/api). */
import { describe, it } from 'vitest';
import { MemoryStore } from '../src';
import { fastHasher } from './helpers';
import { newCompanyScenario } from './scenarios/newCompany';

describe('a new company runs every module from an empty system', () => {
  it('works end to end (memory store)', async () => {
    await newCompanyScenario((now) => new MemoryStore(undefined, undefined, now), fastHasher);
  });
});
