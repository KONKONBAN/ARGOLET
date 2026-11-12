import { describe, expect, it } from 'vitest';
import { allocateManyToMany, computeNet, D, hungarianMax, runReconciliation, scorePair, type ReconOrder, type ReconTxn } from '../src';

const order = (p: Partial<ReconOrder> & { recordId: string; gross: string }): ReconOrder => ({
  recordVersion: 1,
  code: p.recordId,
  fee: '0',
  refund: '0',
  discount: '0',
  adjustment: '0',
  currency: 'VND',
  date: '2026-10-31',
  ...p,
});
const txn = (p: Partial<ReconTxn> & { recordId: string; amount: string }): ReconTxn => ({
  recordVersion: 1,
  code: p.recordId,
  currency: 'VND',
  date: '2026-10-31',
  source: 'BANK',
  ...p,
});

describe('net receivable', () => {
  it('Gross − refund − discount − fee + adjustments', () => {
    expect(computeNet({ gross: '150000', fee: '33000', refund: '5000', discount: '0', adjustment: '0' }).toFixed()).toBe('112000');
    expect(computeNet({ gross: '100000', fee: '22000', refund: '0', discount: '1000', adjustment: '-500' }).toFixed()).toBe('76500');
  });
});

describe('board section 11 — many-to-many example', () => {
  const orders = [
    order({ recordId: 'O1', gross: '100000', fee: '22000', payoutBatch: 'S01', date: '2026-10-30' }),
    order({ recordId: 'O2', gross: '150000', fee: '33000', refund: '5000', payoutBatch: 'S01', date: '2026-10-30' }),
  ];
  const txns = [txn({ recordId: 'B1', amount: '120000', payoutBatch: 'S01' }), txn({ recordId: 'B2', amount: '70000', payoutBatch: 'S01' })];
  const result = runReconciliation(orders, txns);

  it('creates one MatchGroup S01 that balances', () => {
    expect(result.groups).toHaveLength(1);
    const g = result.groups[0]!;
    expect(g.kind).toBe('MANY_TO_MANY');
    expect(g.status).toBe('MATCHED');
    expect(g.gross).toBe('250000');
    expect(g.fee).toBe('55000');
    expect(g.refund).toBe('5000');
    expect(g.net).toBe('190000');
    expect(g.received).toBe('190000');
    expect(g.residual).toBe('0');
  });

  it('allocates O1→B1 78.000, O2→B1 42.000, O2→B2 70.000', () => {
    expect(result.groups[0]!.links).toEqual([
      { orderId: 'O1', txnId: 'B1', amount: '78000' },
      { orderId: 'O2', txnId: 'B1', amount: '42000' },
      { orderId: 'O2', txnId: 'B2', amount: '70000' },
    ]);
    const alloc = Object.fromEntries(result.groups[0]!.allocations.map((a) => [a.recordId, a]));
    expect(alloc.O1!.allocatedAmount).toBe('78000');
    expect(alloc.O2!.allocatedAmount).toBe('112000');
    expect(alloc.B1!.allocatedAmount).toBe('120000');
    expect(alloc.B2!.allocatedAmount).toBe('70000');
    expect(result.groups[0]!.allocations.every((a) => a.remaining === '0')).toBe(true);
  });

  it('records no unmatched items', () => {
    expect(result.unmatchedOrders).toEqual([]);
    expect(result.unmatchedTxns).toEqual([]);
  });
});

describe('Figma DS-1031 — 3 orders, platform fee 10%, one bank receipt', () => {
  it('matches 1.250.000 − 125.000 = 1.125.000 (GD-883019)', () => {
    const orders = [
      order({ recordId: 'DH-1031-01', gross: '450000', fee: '45000', payoutBatch: 'TT-1031' }),
      order({ recordId: 'DH-1031-02', gross: '400000', fee: '40000', payoutBatch: 'TT-1031' }),
      order({ recordId: 'DH-1031-03', gross: '400000', fee: '40000', payoutBatch: 'TT-1031' }),
    ];
    const res = runReconciliation(orders, [txn({ recordId: 'GD-883019', amount: '1125000', payoutBatch: 'TT-1031' })]);
    const g = res.groups[0]!;
    expect(g.kind).toBe('MANY_TO_ONE');
    expect(g.status).toBe('MATCHED');
    expect(g.net).toBe('1125000');
    expect(g.explanation).toContain('1.125.000 đ');
    expect(g.basis[0]).toContain('TT-1031');
  });

  it('flags a discrepancy (DS-1030: lệch 50.000 đ)', () => {
    const res = runReconciliation(
      [order({ recordId: 'A', gross: '2680000', payoutBatch: 'X' })],
      [txn({ recordId: 'B', amount: '2630000', payoutBatch: 'X' })],
    );
    expect(res.groups[0]!.status).toBe('DISCREPANCY');
    expect(res.groups[0]!.residual).toBe('50000');
  });
});

describe('candidate blocking and 1:1 assignment', () => {
  it('never matches across currencies', () => {
    expect(scorePair(order({ recordId: 'o', gross: '100', reference: 'R' }), txn({ recordId: 't', amount: '100', currency: 'USD', reference: 'R' }))).toBe(0);
  });

  it('assigns unkeyed records with the Hungarian algorithm', () => {
    const orders = [order({ recordId: 'o1', gross: '100000', date: '2026-10-01' }), order({ recordId: 'o2', gross: '250000', date: '2026-10-02' })];
    const txns = [txn({ recordId: 't1', amount: '250000', date: '2026-10-02' }), txn({ recordId: 't2', amount: '100000', date: '2026-10-01' })];
    const res = runReconciliation(orders, txns);
    const pairs = res.groups.map((g) => [g.orderIds[0], g.txnIds[0]]);
    expect(pairs).toContainEqual(['o1', 't2']);
    expect(pairs).toContainEqual(['o2', 't1']);
    expect(res.groups.every((g) => g.status === 'MATCHED')).toBe(true);
  });

  it('leaves records unmatched when the score is below threshold', () => {
    const res = runReconciliation([order({ recordId: 'o', gross: '100000', date: '2026-10-01' })], [txn({ recordId: 't', amount: '900000', date: '2026-10-20' })]);
    expect(res.groups).toHaveLength(0);
    expect(res.unmatchedOrders).toEqual(['o']);
    expect(res.unmatchedTxns).toEqual(['t']);
  });

  it('hungarianMax finds the optimal assignment on a rectangular matrix', () => {
    expect(hungarianMax([[0.1, 0.9, 0.2], [0.8, 0.7, 0.1]])).toEqual([[0, 1], [1, 0]]);
    expect(hungarianMax([])).toEqual([]);
  });

  it('allocateManyToMany handles partial coverage deterministically', () => {
    const links = allocateManyToMany(
      [{ id: 'a', net: D(100), date: '2026-01-01', code: 'a' }],
      [{ id: 'x', amount: D(60), date: '2026-01-01', code: 'x' }, { id: 'y', amount: D(60), date: '2026-01-02', code: 'y' }],
    );
    expect(links).toEqual([{ orderId: 'a', txnId: 'x', amount: '60' }, { orderId: 'a', txnId: 'y', amount: '40' }]);
  });
});
