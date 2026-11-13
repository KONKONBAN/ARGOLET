import { GLOBAL, type Store } from '@argolet/app';
import { PgStore, pgDriver, pgliteDriver } from '../src/db';

/** A real PostgreSQL server for the SQL suites (CI service / local server); PGlite always runs. */
export const PG_URL = process.env.PG_TEST_URL;

/** Drops every ARGOLET object so the next store starts from an empty database. */
export async function resetPostgres(url: string): Promise<void> {
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`DROP SCHEMA IF EXISTS argolet CASCADE;
      DROP TABLE IF EXISTS public.argolet_rows, public.argolet_meta,
        public.argolet_rows_v1_backup, public.argolet_meta_v1_backup CASCADE;`);
  } finally {
    await c.end();
  }
}

export async function openStore(
  kind: 'pglite' | 'postgres',
  clock?: () => string,
  opts: { migrate?: boolean } = {},
): Promise<PgStore> {
  if (kind === 'postgres') await resetPostgres(PG_URL!);
  const store = new PgStore(kind === 'postgres' ? await pgDriver(PG_URL!) : await pgliteDriver(), clock);
  if (opts.migrate !== false) await store.migrate();
  return store;
}

/** Tenant rows (and their creator) that tenant-owned test rows can reference. */
export async function seedTenants(store: Store, ids: string[]): Promise<void> {
  await store.transaction(async (tx) => {
    await tx.put('users', {
      id: 'usr_fixture',
      tenantId: GLOBAL,
      fullName: 'Người kiểm thử',
      email: 'fixture@argolet.test',
      phone: null,
      status: 'ACTIVE',
      verifiedAt: null,
      totpSecret: null,
      mfaEnabledAt: null,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      pendingInvitationCode: null,
    });
    for (const id of ids)
      await tx.put('tenants', {
        id,
        tenantId: id,
        name: `Tổ chức ${id}`,
        orgType: 'Hộ kinh doanh',
        taxCode: null,
        policyVersion: 'policy-test',
        settings: {
          currency: 'VND',
          timezone: 'Asia/Ho_Chi_Minh',
          periodType: 'MONTH',
          accountingRegime: 'HKD',
          packages: ['G1'],
          currentPeriod: '2026-11',
          dataLocation: 'VN',
        },
        createdBy: 'usr_fixture',
      });
  });
}
