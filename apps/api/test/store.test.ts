import { afterAll, describe, expect, it } from 'vitest';
import {
  ConcurrencyError,
  createArgoletApp,
  demoClock,
  MemoryStore,
  ScryptHasher,
  seedDemo,
  type Store,
} from '@argolet/app';
import type { PgStore } from '../src/db';
import { openStore, PG_URL, seedTenants } from './pg';

/**
 * Storage conformance: the same behavioural contract must hold for the in-memory store,
 * embedded Postgres (PGlite) and a real PostgreSQL server (PG_TEST_URL).
 */
const opened: PgStore[] = [];

async function makeStores(): Promise<[string, () => Promise<Store>][]> {
  const sql = (kind: 'pglite' | 'postgres') => async () => {
    const s = await openStore(kind);
    opened.push(s);
    return s;
  };
  return [
    ['memory', async () => new MemoryStore()],
    ['pglite', sql('pglite')],
    ...(PG_URL ? [['postgres', sql('postgres')] as [string, () => Promise<Store>]] : []),
  ];
}

afterAll(async () => {
  for (const s of opened) await s.close();
});

const stores = await makeStores();

describe.each(stores)('store conformance · %s', (_name, make) => {
  it('puts, gets, lists with filters and keeps tenants isolated', async () => {
    const store = await make();
    await seedTenants(store, ['t1', 't2']);
    await store.transaction(async (tx) => {
      await tx.put('notifications', {
        id: 'n1',
        tenantId: 't1',
        userId: null,
        title: 'A',
        unitLabel: 'Q3',
        refCode: 'X',
        route: '/',
        status: 'UNREAD',
        actionRequired: true,
      });
      await tx.put('notifications', {
        id: 'n2',
        tenantId: 't1',
        userId: null,
        title: 'B',
        unitLabel: 'Q3',
        refCode: 'Y',
        route: '/',
        status: 'READ',
        actionRequired: false,
      });
      await tx.put('notifications', {
        id: 'n1',
        tenantId: 't2',
        userId: null,
        title: 'Other tenant',
        unitLabel: 'Q1',
        refCode: 'Z',
        route: '/',
        status: 'UNREAD',
        actionRequired: false,
      });
    });
    const got = await store.read((tx) => tx.get('notifications', 't1', 'n1'));
    expect(got?.title).toBe('A');
    expect(got?.rev).toBe(1);
    expect(typeof got?.createdAt).toBe('string');
    expect((await store.read((tx) => tx.list('notifications', 't1'))).map((n) => n.id).sort()).toEqual([
      'n1',
      'n2',
    ]);
    expect(
      (await store.read((tx) => tx.list('notifications', 't1', { status: 'UNREAD' }))).map((n) => n.id),
    ).toEqual(['n1']);
    expect(await store.read((tx) => tx.findGlobal('notifications', { status: 'UNREAD' }))).toHaveLength(2);
    expect(await store.read((tx) => tx.get('notifications', 't3', 'n1'))).toBeUndefined();
  });

  it('matches null filters (outbox publishedAt: null)', async () => {
    const store = await make();
    await store.transaction(async (tx) => {
      await tx.put('aggregateSeqs', { id: 'a', tenantId: 't', seq: 1 });
      await tx.put('outbox', {
        id: 'e1',
        tenantId: 't',
        event: { eventId: 'e1' } as never,
        publishedAt: null,
      });
      await tx.put('outbox', {
        id: 'e2',
        tenantId: 't',
        event: { eventId: 'e2' } as never,
        publishedAt: '2026-10-31T00:00:00Z',
      });
    });
    expect(
      (await store.read((tx) => tx.findGlobal('outbox', { publishedAt: null }))).map((r) => r.id),
    ).toEqual(['e1']);
  });

  it('updates revisions, keeps createdAt, enforces expectedRev', async () => {
    const store = await make();
    const first = await store.transaction((tx) =>
      tx.put('aggregateSeqs', { id: 'k', tenantId: 't', seq: 1 }),
    );
    const second = await store.transaction((tx) => tx.put('aggregateSeqs', { ...first, seq: 2 }));
    expect(second.rev).toBe(2);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    await expect(
      store.transaction((tx) => tx.put('aggregateSeqs', { ...second, seq: 3 }, { expectedRev: 1 })),
    ).rejects.toBeInstanceOf(ConcurrencyError);
    await store.transaction((tx) => tx.put('aggregateSeqs', { ...second, seq: 3 }, { expectedRev: 2 }));
  });

  it('stamps new rows whose placeholder timestamps are empty (virtual records saved for the first time)', async () => {
    const store = await make();
    const saved = await store.transaction((tx) =>
      tx.put('aggregateSeqs', {
        id: 'v',
        tenantId: 't',
        seq: 1,
        createdAt: '',
        updatedAt: '',
        rev: 0,
      } as never),
    );
    expect(Number.isNaN(Date.parse(saved.createdAt))).toBe(false);
    expect(saved.rev).toBe(1);
  });

  it('rolls back every write when the transaction throws', async () => {
    const store = await make();
    await expect(
      store.transaction(async (tx) => {
        await tx.put('aggregateSeqs', { id: 'rollback', tenantId: 't', seq: 1 });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await store.read((tx) => tx.get('aggregateSeqs', 't', 'rollback'))).toBeUndefined();
  });

  it('deletes rows and sees its own writes inside a transaction', async () => {
    const store = await make();
    await store.transaction(async (tx) => {
      await tx.put('aggregateSeqs', { id: 'd', tenantId: 't', seq: 1 });
      expect((await tx.get('aggregateSeqs', 't', 'd'))?.seq).toBe(1);
      await tx.delete('aggregateSeqs', 't', 'd');
      expect(await tx.get('aggregateSeqs', 't', 'd')).toBeUndefined();
    });
    expect(await store.read((tx) => tx.get('aggregateSeqs', 't', 'd'))).toBeUndefined();
  });

  it('serialises concurrent increments without lost updates', async () => {
    const store = await make();
    await store.transaction((tx) => tx.put('aggregateSeqs', { id: 'c', tenantId: 't', seq: 0 }));
    await Promise.all(
      Array.from({ length: 12 }, () =>
        store.transaction(async (tx) => {
          const row = (await tx.get('aggregateSeqs', 't', 'c'))!;
          await tx.put('aggregateSeqs', { ...row, seq: row.seq + 1 });
        }),
      ),
    );
    expect((await store.read((tx) => tx.get('aggregateSeqs', 't', 'c')))!.seq).toBe(12);
  });

  it('runs the full demo seed and produces the Figma KPIs', async () => {
    const store = await make();
    const clock = demoClock();
    const app = createArgoletApp({ store, hasher: new ScryptHasher(2 ** 10, 8, 1), clock });
    await seedDemo(app);
    const login = await app.auth.login({}, { contact: 'ketoan@minhan.example', password: 'Argolet@2026' });
    const call = { sessionToken: login.token };
    await app.org.selectWorkspace(call, { tenantId: 'ten_minhan' });
    const o = await app.dashboard.overview(call);
    expect([o.revenueLabel, o.expenseLabel, o.netLabel]).toEqual([
      '428.600.000 đ',
      '344.000.000 đ',
      '+84.600.000 đ',
    ]);
    expect((await app.documents.listDocuments(call, {})).kpis).toEqual({
      total: 128,
      needsReview: 4,
      validated: 124,
    });
    const r = await app.recon.summary(call, {});
    expect([r.kpis.matched, r.kpis.toConfirm, r.kpis.discrepancies]).toEqual([82, 6, 2]);
    const v = await app.evidence.verifyDocument(call, { documentId: 'CT-1027' });
    expect(v.ok).toBe(true);
  }, 180_000);
});
