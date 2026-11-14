/**
 * Toán tài chính and corporate finance ratios, checked against the worked examples of the course
 * materials (Toán tài chính ch.1–5, NHTM, TCDN) and against Excel's PMT / IPMT / PPMT.
 */
import { describe, expect, it } from 'vitest';
import {
  agio,
  annuityFutureValue,
  annuityPresentValue,
  averageCompoundRate,
  averageSimpleRate,
  breakEven,
  capitalStructure,
  commercialDiscount,
  compoundFutureValue,
  compoundPeriods,
  compoundRate,
  D,
  daysBetween,
  dupont,
  effectiveAnnualRate,
  effectiveCompoundRate,
  effectiveSimpleRate,
  factoring,
  interestCoverage,
  interestForDays,
  IPMT,
  leverageEffect,
  loanEffectiveCost,
  loanSchedule,
  NPER,
  overdueInterest,
  perpetuityPresentValue,
  PMT,
  PPMT,
  RATE,
  rationalDiscount,
  seriesFutureValue,
  seriesPresentValue,
  simpleFutureValue,
  simpleInterest,
  totalLeverage,
} from '../src';

const near = (actual: unknown, expected: number, digits = 6) =>
  expect(Number(String(actual))).toBeCloseTo(expected, digits);

describe('lãi đơn (chương 1)', () => {
  it('counts days and computes interest on the international (360) and Vietnamese (365) bases', () => {
    expect(daysBetween('2026-01-15', '2026-07-16')).toBe(182);
    // Ví dụ 2: 50 trđ, 7,2%/năm, 15/01 → 16/07, chuẩn quốc tế.
    expect(interestForDays(50_000_000, '0.072', 182, 360).toFixed()).toBe('1820000');
    expect(simpleInterest(50, '0.08', 5).toFixed()).toBe('20');
    // Ví dụ 3: 20 trđ, 42 tháng, 9%/năm.
    expect(simpleFutureValue(20_000_000, D('0.09').div(12), 42).toFixed()).toBe('26300000');
  });

  it('average and effective rates', () => {
    // Ví dụ 7: 8% × 6 tháng, 9% × 3 tháng, 12% × 4 tháng → 9,46%/năm.
    near(
      averageSimpleRate([
        { rate: '0.08', periods: 6 },
        { rate: '0.09', periods: 3 },
        { rate: '0.12', periods: 4 },
      ]),
      0.094615,
      6,
    );
    // Ví dụ 8: 200 trđ, 9,6%/năm, 4 tháng, phí 600.000 → 10,53%/năm.
    near(
      effectiveSimpleRate({
        principal: 200_000_000,
        interest: 6_400_000,
        fees: 600_000,
        years: D(4).div(12),
      }),
      0.105316,
      6,
    );
  });
});

describe('lãi kép (chương 2)', () => {
  it('future value, rate, number of periods', () => {
    expect(compoundFutureValue(100, '0.1', 5).toFixed()).toBe('161.051');
    near(compoundRate(100, '161.051', 5), 0.1, 12);
    near(compoundPeriods(100, '161.051', '0.1'), 5, 12);
    // Ví dụ 5c: 10 trđ, 6%/năm ghép tháng, 3 năm → 11,9668 trđ.
    near(compoundFutureValue(10, D('0.06').div(12), 36), 11.966805, 6);
    near(effectiveAnnualRate('0.06', 12), 0.0616778, 6);
  });

  it('average and effective compound rates', () => {
    // Ví dụ 6: 8% × 3 năm, 8,5% × 2, 10% × 2 → 8,71%/năm.
    near(
      averageCompoundRate([
        { rate: '0.08', periods: 3 },
        { rate: '0.085', periods: 2 },
        { rate: '0.1', periods: 2 },
      ]),
      0.08712,
      4,
    );
    // Ví dụ 7: 400 trđ, 4,5%/kỳ 6 tháng × 6 kỳ, phí 0,5% → 4,587%/kỳ.
    const repay = compoundFutureValue(400_000_000, '0.045', 6);
    near(
      effectiveCompoundRate({ principal: 400_000_000, repayment: repay, fees: 2_000_000, periods: 6 }),
      0.04587,
      5,
    );
  });
});

describe('chiết khấu thương phiếu (chương 3)', () => {
  it('commercial and rational discount', () => {
    // Ví dụ 1: 100 trđ, chiết khấu 01/04, đáo hạn 30/06 (90 ngày), 12%/năm.
    const days = daysBetween('2026-04-01', '2026-06-30');
    expect(days).toBe(90);
    const c = commercialDiscount({ face: 100_000_000, annualRate: '0.12', days });
    near(c.fee, 2_958_904.109589, 5);
    const r = rationalDiscount({ face: 100_000_000, annualRate: '0.12', days });
    near(r.proceeds, 97_126_130.920703, 4);
    // The effective rate of a commercial discount is above the quoted rate.
    expect(Number(c.effectiveRate)).toBeGreaterThan(0.12);
  });

  it('AGIO: discount, endorsement commission, general commission and other fees', () => {
    // Ví dụ 5: 300 trđ, 02/08 → 15/11 (105 ngày), 9,6%, ký hậu 1%, hoa hồng chung 0,1%, phí 500.000.
    const a = agio({
      face: 300_000_000,
      annualRate: '0.096',
      days: 105,
      endorsementRate: '0.01',
      commissionRate: '0.001',
      otherFees: 500_000,
    });
    near(a.discount, 8_284_931.506849, 5);
    near(a.endorsement, 863_013.69863, 5);
    expect(a.commission).toBe('300000');
    near(a.agio, 9_947_945.205479, 5);
    expect(Number(a.actualRate)).toBeGreaterThan(Number(a.costRate));
  });
});

describe('chuỗi tiền tệ (chương 5)', () => {
  it('irregular series, ordinary and due', () => {
    near(seriesFutureValue([200, 100, 50, 80], '0.1'), 522.2, 9);
    near(seriesFutureValue([200, 100, 50, 80], '0.1', true), 574.42, 9);
    near(seriesPresentValue([110, 220, 180, 146], '0.1'), 516.775, 3);
    near(seriesPresentValue([50, 50, 60, 60, 100], '0.05'), 272.516, 3);
    near(seriesFutureValue([50, 50, 60, 60, 100], '0.05'), 347.81, 2);
  });

  it('level annuities and perpetuities', () => {
    near(annuityPresentValue(100, '0.1', 3), 248.685199, 5);
    near(annuityPresentValue(100, '0.1', 3, true), 273.553719, 5);
    near(annuityFutureValue(100, '0.1', 3), 331, 9);
    expect(annuityPresentValue(100, 0, 3).toFixed()).toBe('300');
    expect(perpetuityPresentValue(100, '0.1').toFixed()).toBe('1000');
    expect(perpetuityPresentValue(100, '0.1', '0.05').toFixed()).toBe('2000');
    expect(() => perpetuityPresentValue(100, '0.05', '0.05')).toThrow();
  });

  it('PMT / IPMT / PPMT / NPER / RATE match Excel (vay 40 trđ, 10%/năm, 6 tháng)', () => {
    const r = D('0.1').div(12);
    near(PMT(r, 6, 40_000_000), -6_862_455.767424, 4);
    near(PMT(r, 6, 40_000_000, 0, 1), -6_805_741.256949, 4);
    near(IPMT(r, 3, 6, 40_000_000), -224_061.214818, 4);
    near(PPMT(r, 3, 6, 40_000_000), -6_638_394.552605, 4);
    // The notebook's formula: PPMTᵢ = PV × r / ((1+r)ⁿ − 1) × (1+r)^(i−1).
    for (let i = 1; i <= 6; i++) {
      const manual = D(40_000_000)
        .times(r)
        .div(r.plus(1).pow(6).minus(1))
        .times(r.plus(1).pow(i - 1));
      near(PPMT(r, i, 6, 40_000_000).neg(), manual.toNumber(), 4);
    }
    expect(IPMT(r, 1, 6, 40_000_000, 0, 1).toFixed()).toBe('0');
    near(NPER(r, PMT(r, 6, 40_000_000), 40_000_000), 6, 9);
    near(RATE(6, PMT(r, 6, 40_000_000), 40_000_000)!, r.toNumber(), 12);
  });
});

describe('vay vốn: lịch trả nợ (chương 6, NHTM C4, C8)', () => {
  it('trả góp đều: equal instalments, exact principal, interest on the balance', () => {
    const s = loanSchedule({ principal: 40_000_000, annualRate: '0.1', periods: 6, method: 'ANNUITY' });
    expect(s.instalment).toBe('6862456');
    expect(s.rows).toHaveLength(6);
    expect(s.rows[0]!.interest).toBe('333333');
    expect(D(s.rows.reduce((a, x) => a + Number(x.principal), 0)).toFixed()).toBe('40000000');
    expect(s.rows.at(-1)!.closing).toBe('0');
    // Every instalment but the last is the level amount.
    expect(s.rows.slice(0, -1).every((x) => x.payment === '6862456')).toBe(true);
  });

  it('gốc đều, lãi giảm dần; gốc cuối kỳ; gốc và lãi một lần', () => {
    const eq = loanSchedule({
      principal: 120_000_000,
      annualRate: '0.12',
      periods: 12,
      method: 'EQUAL_PRINCIPAL',
    });
    expect(eq.rows.map((x) => x.principal).every((p) => p === '10000000')).toBe(true);
    expect(eq.rows[0]!.interest).toBe('1200000');
    expect(eq.rows[11]!.interest).toBe('100000');
    expect(eq.totalInterest).toBe('7800000');
    const bullet = loanSchedule({
      principal: 100_000_000,
      annualRate: '0.12',
      periods: 3,
      periodMonths: 3,
      method: 'BULLET',
    });
    expect(bullet.rows.map((x) => x.payment)).toEqual(['3000000', '3000000', '103000000']);
    const lump = loanSchedule({ principal: 100_000_000, annualRate: '0.12', periods: 6, method: 'LUMP_SUM' });
    expect(lump.rows.at(-1)!.payment).toBe('106000000');
  });

  it('interest on actual days (TT14/2017: dư nợ × số ngày × lãi suất / 365) and grace periods', () => {
    const s = loanSchedule({
      principal: 300_000_000,
      annualRate: '0.12',
      periods: 3,
      method: 'EQUAL_PRINCIPAL',
      dayCount: 'ACTUAL_365',
      startDate: '2026-01-18',
    });
    expect(s.rows.map((x) => x.days)).toEqual([31, 28, 31]);
    expect(s.rows[0]!.interest).toBe(interestForDays(300_000_000, '0.12', 31).toDecimalPlaces(0).toFixed());
    expect(s.rows.map((x) => x.date)).toEqual(['2026-02-18', '2026-03-18', '2026-04-18']);
    const g = loanSchedule({
      principal: 60_000_000,
      annualRate: '0.12',
      periods: 6,
      method: 'ANNUITY',
      graceMonths: 2,
    });
    expect(g.rows.slice(0, 2).map((x) => x.principal)).toEqual(['0', '0']);
    expect(g.rows.at(-1)!.closing).toBe('0');
  });

  it('thuê tài chính: payments in advance with a purchase option', () => {
    const lease = loanSchedule({
      principal: 500_000_000,
      annualRate: '0.12',
      periods: 8,
      periodMonths: 6,
      method: 'ANNUITY',
      inAdvance: true,
      residual: 50_000_000,
    });
    expect(lease.rows[0]!.interest).toBe('0');
    expect(lease.rows.at(-1)!.closing).toBe('0');
    expect(lease.instalment).toBe(
      PMT('0.06', 8, 500_000_000, -50_000_000, 1).neg().toDecimalPlaces(0).toFixed(),
    );
  });

  it('the effective cost of a loan with fees is above the quoted rate', () => {
    const s = loanSchedule({ principal: 100_000_000, annualRate: '0.12', periods: 12, method: 'ANNUITY' });
    const cost = loanEffectiveCost(s, 100_000_000, 0)!;
    near(cost.annual, 0.12, 5);
    const withFees = loanEffectiveCost(s, 100_000_000, 2_000_000)!;
    expect(Number(withFees.annual)).toBeGreaterThan(0.155);
    expect(Number(withFees.effectiveAnnual)).toBeGreaterThan(Number(withFees.annual));
  });

  it('refuses inconsistent terms', () => {
    expect(() => loanSchedule({ principal: 0, annualRate: '0.1', periods: 6, method: 'ANNUITY' })).toThrow();
    expect(() =>
      loanSchedule({ principal: 1, annualRate: '0.1', periods: 6, method: 'ANNUITY', graceMonths: 6 }),
    ).toThrow();
    expect(() =>
      loanSchedule({
        principal: 1,
        annualRate: '0.1',
        periods: 6,
        method: 'ANNUITY',
        dayCount: 'ACTUAL_365',
      }),
    ).toThrow();
    expect(() => overdueInterest({ amount: 1, annualRate: '0.1', days: 1, multiple: 2 })).toThrow();
  });

  it('overdue interest and factoring', () => {
    expect(overdueInterest({ amount: 365_000_000, annualRate: '0.1', days: 10 }).toFixed()).toBe('1500000');
    const f = factoring({
      receivable: 600_000_000,
      advanceRate: '0.8',
      feeRate: '0.002',
      annualRate: '0.1',
      days: 60,
    });
    expect(f.advance).toBe('480000000');
    expect(f.fee).toBe('1200000');
    expect(f.interest).toBe('7890411');
    expect(f.remaining).toBe(String(600_000_000 - 480_000_000 - 7_890_411 - 1_200_000));
  });
});

describe('đòn bẩy và chỉ số tài chính', () => {
  it('DOL, DFL, DTL and break-even', () => {
    const t = totalLeverage({ revenue: 1000, variableCosts: 600, fixedCosts: 200, interest: 50 });
    expect([t.contributionMargin, t.ebit, t.dol]).toEqual(['400', '200', '2']);
    near(t.dfl!, 200 / 150, 12);
    near(t.dtl!, 400 / 150, 12);
    expect(totalLeverage({ revenue: 100, variableCosts: 50, fixedCosts: 50, interest: 0 }).dol).toBeNull();
    const be = breakEven({ fixedCosts: 200_000_000, price: 50_000, variableCostPerUnit: 30_000 });
    expect([be.units, be.revenue]).toEqual(['10000', '500000000']);
  });

  it('capital structure, interest cover, DuPont', () => {
    const c = capitalStructure({ totalAssets: 1000, equity: 400 });
    expect([c.liabilities, c.debtRatio, c.debtToEquity, c.equityMultiplier]).toEqual([
      '600',
      '0.6',
      '1.5',
      '2.5',
    ]);
    expect(interestCoverage(200, 50)).toBe('4');
    expect(interestCoverage(200, 0)).toBeNull();
    const d = dupont({ netIncome: 60, revenue: 1200, totalAssets: 1000, equity: 400 });
    expect([d.ros, d.assetTurnover, d.equityMultiplier, d.roe]).toEqual(['0.05', '1.2', '2.5', '0.15']);
    near(Number(d.ros) * Number(d.assetTurnover) * Number(d.equityMultiplier), Number(d.roe), 12);
  });

  it('leverage effect (MM): ROE = (1 + LEV)ROA − LEV·Rd(1 − T) equals ROE from the statements', () => {
    const e = leverageEffect({ ebit: 200, interest: 48, taxRate: '0.2', totalAssets: 1000, equity: 400 });
    expect(e.lev).toBe('1.5');
    expect(e.roa).toBe('0.16');
    expect(e.costOfDebt).toBe('0.08');
    near(e.roe, Number(e.roeFromStatements), 12);
    expect(e.favourable).toBe(true);
    // Debt costing more than the return on assets lowers ROE.
    const bad = leverageEffect({ ebit: 50, interest: 90, taxRate: '0.2', totalAssets: 1000, equity: 400 });
    expect(bad.favourable).toBe(false);
    expect(Number(bad.leverageContribution)).toBeLessThan(0);
  });
});

describe('thẩm định dự án theo giáo trình (Ross ch.9, TCDN1 ch.6)', () => {
  it('NPV, IRR, MIRR, PI, discounted payback and EAA', async () => {
    const { appraiseProject, mirr, profitabilityIndex, equivalentAnnualAnnuity, npv } =
      await import('../src');
    // Ross ch.9 data (Excel 9): −30.000; 13.700; 14.200; 13.400 at 11%.
    const flows = [-30000, 13700, 14200, 13400];
    const v = npv('0.11', flows);
    near(v, 3_665.345404, 5);
    near(profitabilityIndex('0.11', flows)!, (v.toNumber() + 30000) / 30000, 12);
    // Excel MIRR(−30000, 13700, 14200, 13400; 11%; 11%).
    near(mirr(flows, '0.11', '0.11')!, 0.153480487, 7);
    near(equivalentAnnualAnnuity(v, '0.11', 3), (v.toNumber() * 0.11) / (1 - 1.11 ** -3), 6);
    const a = appraiseProject({
      investment: '1000',
      annualCashflow: '300',
      years: 5,
      discountRate: '0.1',
      annualDebtService: '200',
      salvageValue: '100',
    });
    expect(a.cashflows).toEqual(['-1000', '300', '300', '300', '300', '400']);
    expect(Number(a.pi)).toBeGreaterThan(1);
    expect(Number(a.discountedPayback)).toBeGreaterThan(Number(a.payback));
    expect(Number(a.mirr)).toBeLessThan(Number(a.irr));
  });

  it('cost of capital: CAPM, WACC and after-tax operating cash flow', async () => {
    const { capmCostOfEquity, wacc, operatingCashFlow } = await import('../src');
    near(capmCostOfEquity('0.04', '1.2', '0.1'), 0.112, 12);
    const w = wacc({ equity: 3000, debt: 1500, costOfEquity: '0.15', costOfDebt: '0.12', taxRate: '0.2' });
    near(w.wacc, (2 / 3) * 0.15 + (1 / 3) * 0.12 * 0.8, 12);
    expect(w.afterTaxCostOfDebt).toBe('0.096');
    // OCF = (R − C − D)(1 − t) + D.
    expect(
      operatingCashFlow({ revenue: 1000, cashCosts: 600, depreciation: 100, taxRate: '0.2' }).toFixed(),
    ).toBe('340');
  });
});
