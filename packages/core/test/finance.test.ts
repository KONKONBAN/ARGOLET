import { describe, expect, it } from 'vitest';
import {
  agingBuckets,
  allocateByDriver,
  appraiseProject,
  chargeAfterFreeTime,
  compareScenarios,
  D,
  dscr,
  dueWithin,
  energySavings,
  formatMillions,
  formatPercent,
  freeTimeEnd,
  irr,
  landedCost,
  makeCalcRun,
  matchIntercompany,
  movingAverage,
  npv,
  paybackPeriod,
  recipeCost,
  wasteRate,
} from '../src';

const base = {
  investment: '1000',
  annualCashflow: '300',
  years: 5,
  discountRate: '0.10',
  annualDebtService: '200',
};

describe('G3 investment appraisal — numbers shown in Figma screen 27/28', () => {
  it('NPV 137,24 triệu · IRR 15,24% · payback 3,33 năm · DSCR 1,50', () => {
    const r = appraiseProject(base);
    expect(r.cashflows).toEqual(['-1000', '300', '300', '300', '300', '300']);
    expect(formatMillions(r.npv)).toBe('137,24 triệu');
    expect(formatPercent(r.irr!)).toBe('15,24%');
    expect(D(r.payback!).toFixed(2)).toBe('3.33');
    expect(D(r.dscr).toFixed(2)).toBe('1.50');
  });

  it('scenario comparison: thận trọng / cơ sở / tích cực', () => {
    const [low, mid, high] = compareScenarios(base, [
      { name: 'Thận trọng', annualCashflow: '250' },
      { name: 'Cơ sở', annualCashflow: '300' },
      { name: 'Tích cực', annualCashflow: '350' },
    ]);
    expect(formatMillions(low!.npv)).toBe('−52,30 triệu');
    expect(formatPercent(low!.irr!)).toBe('7,93%');
    expect(D(low!.payback!).toFixed(2)).toBe('4.00');
    expect(formatMillions(mid!.npv)).toBe('137,24 triệu');
    expect(formatMillions(high!.npv)).toBe('326,78 triệu');
    expect(formatPercent(high!.irr!)).toBe('22,11%');
    expect(D(high!.payback!).toFixed(2)).toBe('2.86');
  });

  it('npv/irr consistency and edge cases', () => {
    const flows = ['-1000', '300', '300', '300', '300', '300'];
    expect(npv(irr(flows)!, flows).abs().lt('1e-9')).toBe(true);
    expect(irr(['100', '100'])).toBeNull();
    expect(paybackPeriod(['-100', '10', '10'])).toBeNull();
    expect(() => dscr(1, 0)).toThrow();
    expect(() => appraiseProject({ ...base, years: 0 })).toThrow();
  });
});

describe('G1 cost, inventory, waste', () => {
  it('recipe cost of one cup = 12.400 đ', () => {
    const r = recipeCost(
      [
        { itemId: 'beans', name: 'Cà phê hạt', quantity: '18', unit: 'g' },
        { itemId: 'milk', name: 'Sữa tươi', quantity: '120', unit: 'ml' },
        { itemId: 'sugar', name: 'Đường', quantity: '12', unit: 'g' },
        { itemId: 'cup', name: 'Ly giấy', quantity: '1', unit: 'cái' },
        { itemId: 'lid', name: 'Nắp & ống hút', quantity: '1', unit: 'bộ' },
      ],
      [
        { itemId: 'beans', unitCost: '300' },
        { itemId: 'milk', unitCost: '35' },
        { itemId: 'sugar', unitCost: '25' },
        { itemId: 'cup', unitCost: '1900' },
        { itemId: 'lid', unitCost: '600' },
      ],
    );
    expect(r.total).toBe('12400');
    expect(() => recipeCost([{ itemId: 'x', name: 'X', quantity: '1', unit: 'g' }], [])).toThrow();
  });

  it('moving average valuation and COGS', () => {
    const r = movingAverage([
      { type: 'IN', quantity: '10', unitCost: '100' },
      { type: 'IN', quantity: '10', unitCost: '200' },
      { type: 'OUT', quantity: '5' },
    ]);
    expect(r).toEqual({ quantity: '15', unitCost: '150', value: '2250', cogs: '750' });
    expect(() => movingAverage([{ type: 'OUT', quantity: '1' }])).toThrow();
  });

  it('waste rate', () => {
    expect(wasteRate('100', '104')).toBe('0.04');
    expect(wasteRate('0', '5')).toBe('0');
  });
});

describe('G1-G2 receivables / payables', () => {
  it('aging buckets and amounts due within 7 days', () => {
    const items = [
      { id: 'a', dueDate: '2026-11-02', amount: '7250000' },
      { id: 'b', dueDate: '2026-11-08', amount: '4680000' },
      { id: 'c', dueDate: '2026-09-01', amount: '1000' },
    ];
    expect(dueWithin(items, '2026-10-31', 7)).toBe('7250000');
    expect(agingBuckets(items, '2026-10-31')).toMatchObject({ notDue: '11930000', d31_60: '1000' });
  });
});

describe('G3 logistics — Figma screen 30/31', () => {
  it('storage 2 days × 600.000 after free time', () => {
    const r = chargeAfterFreeTime(7, 5, [{ fromDay: 1, toDay: null, ratePerDay: '600000' }]);
    expect(r).toMatchObject({ chargeableDays: 2, amount: '1200000' });
    expect(freeTimeEnd('2026-10-28', 5)).toBe('2026-11-02');
  });

  it('cost allocation by weight 60/40 of 18.200.000', () => {
    expect(
      allocateByDriver('18200000', [
        { id: 'A', driver: '60' },
        { id: 'B', driver: '40' },
      ]).map((x) => x.amount),
    ).toEqual(['10920000', '7280000']);
    expect(() => allocateByDriver('1', [{ id: 'A', driver: '0' }])).toThrow();
  });

  it('landed cost', () => {
    expect(
      landedCost({ goodsValue: '1000', freight: '100', insurance: '10', dutyRate: '0.1', otherCosts: '50' }),
    ).toEqual({ dutiableValue: '1110', duty: '111', total: '1271' });
  });

  it('energy M&V savings 20%', () => {
    expect(energySavings('125000', '100000')).toEqual({ savingsKwh: '25000', savingsRatio: '0.2' });
  });
});

describe('G4 intercompany — Figma screen 33', () => {
  it('85.400.000 vs 85.100.000 → difference 300.000', () => {
    const r = matchIntercompany(
      { entityId: 'MAR', reference: 'IC-2610-018', amount: '85400000', currency: 'VND', periodId: '2026-10' },
      { entityId: 'MAL', reference: 'IC-2610-018', amount: '85100000', currency: 'VND', periodId: '2026-10' },
    );
    expect(r.difference).toBe('300000');
    expect(r.status).toBe('DIFFERENCE');
    expect(r.sameReference).toBe(true);
    expect(r.eliminationDraft.amount).toBe('85100000');
  });
});

describe('CalcRun', () => {
  it('pins engine version and input digest deterministically', () => {
    const a = makeCalcRun({
      calcRunId: 'c1',
      task: 'npv',
      packageCode: 'G3',
      rulesVersion: 'r1',
      assumptions: base,
      method: 'NPV',
      result: 1,
      createdAt: 'x',
    });
    const b = makeCalcRun({
      calcRunId: 'c2',
      task: 'npv',
      packageCode: 'G3',
      rulesVersion: 'r1',
      assumptions: { ...base },
      method: 'NPV',
      result: 1,
      createdAt: 'y',
    });
    expect(a.inputSnapshotDigest).toBe(b.inputSnapshotDigest);
    expect(a.engineVersion).toMatch(/^finance-engine-/);
  });
});
