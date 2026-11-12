import { canonicalize } from './canonical';
import { D, dec, sum, type Decimal, type DecimalInput } from './decimal';
import { sha256Hex } from './hash';

/**
 * Finance Engine — deterministic shared calculation core (board section D / 07).
 * Every result carries assumptions, method and the input snapshot digest so that
 * AI can only *explain* numbers produced here, never invent them.
 */
export const ENGINE_VERSION = 'finance-engine-1.4.0';

// ───────────────────────── G3 · investment appraisal ─────────────────────────

/** NPV with end-of-period cash flows; cashflows[0] occurs at t = 0. */
export function npv(rate: DecimalInput, cashflows: DecimalInput[]): Decimal {
  const r = D(rate);
  let total = D(0);
  let factor = D(1);
  cashflows.forEach((cf, t) => {
    if (t > 0) factor = factor.times(r.plus(1));
    total = total.plus(D(cf).div(factor));
  });
  return total;
}

/** IRR by bisection on NPV(r) = 0. Returns null when no sign change exists. */
export function irr(cashflows: DecimalInput[], lo = -0.9999, hi = 10, iterations = 200): Decimal | null {
  let a = D(lo);
  let b = D(hi);
  let fa = npv(a, cashflows);
  const fb = npv(b, cashflows);
  if (fa.isZero()) return a;
  if (fb.isZero()) return b;
  if (fa.isPos() === fb.isPos()) return null;
  for (let i = 0; i < iterations; i++) {
    const m = a.plus(b).div(2);
    const fm = npv(m, cashflows);
    if (fm.abs().lt('1e-18')) return m;
    if (fm.isPos() === fa.isPos()) {
      a = m;
      fa = fm;
    } else {
      b = m;
    }
  }
  return a.plus(b).div(2);
}

/** Simple (undiscounted) payback period with linear interpolation inside the year. */
export function paybackPeriod(cashflows: DecimalInput[]): Decimal | null {
  let cumulative = D(0);
  for (let t = 0; t < cashflows.length; t++) {
    const cf = D(cashflows[t]!);
    const before = cumulative;
    cumulative = cumulative.plus(cf);
    if (t > 0 && before.isNeg() && cumulative.gte(0)) {
      return D(t - 1).plus(before.abs().div(cf));
    }
  }
  return null;
}

export function discountedPayback(rate: DecimalInput, cashflows: DecimalInput[]): Decimal | null {
  const r = D(rate);
  return paybackPeriod(cashflows.map((cf, t) => D(cf).div(r.plus(1).pow(t))));
}

/** Debt service coverage ratio = CFADS / debt service. */
export function dscr(cfads: DecimalInput, debtService: DecimalInput): Decimal {
  if (D(debtService).isZero()) throw new RangeError('Nghĩa vụ trả nợ phải khác 0');
  return D(cfads).div(debtService);
}

export interface ProjectAssumptions {
  investment: string; // triệu đồng
  annualCashflow: string; // triệu đồng / năm
  years: number;
  discountRate: string; // ratio, e.g. "0.10"
  annualDebtService: string; // triệu đồng / năm
  salvageValue?: string;
}

export interface ProjectAppraisal {
  cashflows: string[];
  npv: string;
  irr: string | null;
  payback: string | null;
  discountedPayback: string | null;
  dscr: string;
}

export function appraiseProject(a: ProjectAssumptions): ProjectAppraisal {
  if (a.years < 1 || a.years > 50) throw new RangeError('Thời gian phân tích phải từ 1 đến 50 năm');
  const flows: Decimal[] = [D(a.investment).neg()];
  for (let y = 1; y <= a.years; y++) {
    flows.push(D(a.annualCashflow).plus(y === a.years ? D(a.salvageValue ?? 0) : 0));
  }
  const i = irr(flows);
  const pb = paybackPeriod(flows);
  const dpb = discountedPayback(a.discountRate, flows);
  return {
    cashflows: flows.map((f) => dec(f)),
    npv: dec(npv(a.discountRate, flows)),
    irr: i ? dec(i) : null,
    payback: pb ? dec(pb) : null,
    discountedPayback: dpb ? dec(dpb) : null,
    dscr: dec(dscr(a.annualCashflow, a.annualDebtService)),
  };
}

export interface ScenarioResult extends ProjectAppraisal {
  name: string;
  annualCashflow: string;
}

export function compareScenarios(base: ProjectAssumptions, scenarios: { name: string; annualCashflow: string }[]): ScenarioResult[] {
  return scenarios.map((s) => ({ name: s.name, annualCashflow: s.annualCashflow, ...appraiseProject({ ...base, annualCashflow: s.annualCashflow }) }));
}

/** ΔNPV per 1 unit change of annual cash flow (linear in annuity factor). */
export function npvSensitivity(base: ProjectAssumptions, deltaCashflow: DecimalInput): string {
  const up = appraiseProject({ ...base, annualCashflow: dec(D(base.annualCashflow).plus(deltaCashflow)) });
  const b = appraiseProject(base);
  return dec(D(up.npv).minus(b.npv));
}

// ───────────────────────── G1 · cost of goods, inventory ─────────────────────────

export interface RecipeLine {
  itemId: string;
  name: string;
  quantity: string; // in item unit
  unit: string;
}

export interface CostedItem {
  itemId: string;
  unitCost: string; // VND per unit
}

export function recipeCost(lines: RecipeLine[], costs: CostedItem[], wasteRate: DecimalInput = 0): { total: string; lines: { itemId: string; name: string; cost: string }[] } {
  const costMap = new Map(costs.map((c) => [c.itemId, D(c.unitCost)]));
  const out = lines.map((l) => {
    const unit = costMap.get(l.itemId);
    if (!unit) throw new Error(`Thiếu đơn giá cho nguyên liệu ${l.name}`);
    return { itemId: l.itemId, name: l.name, cost: dec(unit.times(l.quantity)) };
  });
  const total = sum(out.map((l) => l.cost)).times(D(1).plus(wasteRate));
  return { total: dec(total.toDecimalPlaces(0)), lines: out };
}

/** Moving-average inventory valuation over receipts and issues. */
export function movingAverage(movements: { type: 'IN' | 'OUT'; quantity: string; unitCost?: string }[]): { quantity: string; unitCost: string; value: string; cogs: string } {
  let qty = D(0);
  let value = D(0);
  let cogs = D(0);
  for (const m of movements) {
    if (m.type === 'IN') {
      qty = qty.plus(m.quantity);
      value = value.plus(D(m.quantity).times(m.unitCost ?? 0));
    } else {
      if (D(m.quantity).gt(qty)) throw new RangeError('Xuất kho vượt tồn');
      const avg = qty.isZero() ? D(0) : value.div(qty);
      const out = avg.times(m.quantity);
      cogs = cogs.plus(out);
      qty = qty.minus(m.quantity);
      value = value.minus(out);
    }
  }
  const unitCost = qty.isZero() ? D(0) : value.div(qty);
  return { quantity: dec(qty), unitCost: dec(unitCost.toDecimalPlaces(2)), value: dec(value.toDecimalPlaces(0)), cogs: dec(cogs.toDecimalPlaces(0)) };
}

/** Waste rate = (actual usage − standard usage) / standard usage. */
export function wasteRate(standardUsage: DecimalInput, actualUsage: DecimalInput): string {
  if (D(standardUsage).isZero()) return '0';
  return dec(D(actualUsage).minus(standardUsage).div(standardUsage));
}

// ───────────────────────── G1-G2 · receivables / payables ─────────────────────────

export interface OpenItem {
  id: string;
  dueDate: string;
  amount: string;
}

export function agingBuckets(items: OpenItem[], asOf: string): Record<'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'over90', string> {
  const buckets = { notDue: D(0), d1_30: D(0), d31_60: D(0), d61_90: D(0), over90: D(0) };
  const ref = Date.parse(asOf + 'T00:00:00Z');
  for (const it of items) {
    const days = Math.floor((ref - Date.parse(it.dueDate + 'T00:00:00Z')) / 86_400_000);
    const key = days <= 0 ? 'notDue' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'over90';
    buckets[key] = buckets[key].plus(it.amount);
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, dec(v)])) as Record<keyof typeof buckets, string>;
}

export function dueWithin(items: OpenItem[], asOf: string, days: number): string {
  const ref = Date.parse(asOf + 'T00:00:00Z');
  return dec(sum(items.filter((i) => {
    const d = (Date.parse(i.dueDate + 'T00:00:00Z') - ref) / 86_400_000;
    return d >= 0 && d <= days;
  }).map((i) => i.amount)));
}

// ───────────────────────── G3 · logistics ─────────────────────────

export interface TariffTier {
  fromDay: number; // first chargeable day index after free time (1-based)
  toDay: number | null;
  ratePerDay: string;
}

/** Storage / detention / demurrage charge by tariff after free time. */
export function chargeAfterFreeTime(daysUsed: number, freeDays: number, tiers: TariffTier[]): { chargeableDays: number; amount: string; breakdown: { days: number; rate: string; amount: string }[] } {
  const chargeable = Math.max(0, daysUsed - freeDays);
  const breakdown: { days: number; rate: string; amount: string }[] = [];
  let total = D(0);
  for (const tier of tiers) {
    const start = tier.fromDay;
    const end = tier.toDay ?? Infinity;
    const days = Math.max(0, Math.min(chargeable, end) - start + 1);
    if (days > 0) {
      const amt = D(tier.ratePerDay).times(days);
      breakdown.push({ days, rate: tier.ratePerDay, amount: dec(amt) });
      total = total.plus(amt);
    }
  }
  return { chargeableDays: chargeable, amount: dec(total), breakdown };
}

export function freeTimeEnd(startDate: string, freeDays: number): string {
  const d = new Date(Date.parse(startDate + 'T00:00:00Z') + freeDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Allocate shipment cost to goods lines by a driver (weight, volume, value). */
export function allocateByDriver(total: DecimalInput, drivers: { id: string; driver: string }[]): { id: string; share: string; amount: string }[] {
  const totalDriver = sum(drivers.map((d) => d.driver));
  if (totalDriver.isZero()) throw new RangeError('Tổng tiêu thức phân bổ phải khác 0');
  let allocated = D(0);
  return drivers.map((d, idx) => {
    const share = D(d.driver).div(totalDriver);
    const amount = idx === drivers.length - 1 ? D(total).minus(allocated) : D(total).times(share).toDecimalPlaces(0);
    allocated = allocated.plus(amount);
    return { id: d.id, share: dec(share), amount: dec(amount) };
  });
}

export function landedCost(c: { goodsValue: string; freight: string; insurance: string; dutyRate: string; otherCosts: string }): { dutiableValue: string; duty: string; total: string } {
  const cif = D(c.goodsValue).plus(c.freight).plus(c.insurance);
  const duty = cif.times(c.dutyRate).toDecimalPlaces(0);
  return { dutiableValue: dec(cif), duty: dec(duty), total: dec(cif.plus(duty).plus(c.otherCosts)) };
}

// ───────────────────────── G4 · group / intercompany ─────────────────────────

export interface IntercompanySide {
  entityId: string;
  reference: string;
  amount: string;
  currency: string;
  periodId: string;
}

export function matchIntercompany(a: IntercompanySide, b: IntercompanySide, fxRateBtoA: DecimalInput = 1, tolerance: DecimalInput = 0) {
  const bConverted = D(b.amount).times(fxRateBtoA);
  const diff = D(a.amount).minus(bConverted);
  const sameRef = a.reference === b.reference;
  const samePeriod = a.periodId === b.periodId;
  return {
    sameReference: sameRef,
    samePeriod,
    difference: dec(diff),
    status: sameRef && samePeriod && diff.abs().lte(tolerance) ? ('MATCHED' as const) : ('DIFFERENCE' as const),
    eliminationDraft: { debit: `Phải trả nội bộ · ${b.entityId}`, credit: `Phải thu nội bộ · ${a.entityId}`, amount: dec(Decimal_min(D(a.amount), bConverted)) },
  };
}

function Decimal_min(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}

// ───────────────────────── G3 · M&V (energy) ─────────────────────────

export function energySavings(baselineKwh: DecimalInput, reportingKwh: DecimalInput, adjustmentsKwh: DecimalInput = 0) {
  const adjustedBaseline = D(baselineKwh).plus(adjustmentsKwh);
  const savings = adjustedBaseline.minus(reportingKwh);
  return { savingsKwh: dec(savings), savingsRatio: dec(adjustedBaseline.isZero() ? 0 : savings.div(adjustedBaseline)) };
}

// ───────────────────────── CalcRun ─────────────────────────

export interface CalcRun<T = unknown> {
  calcRunId: string;
  task: string;
  packageCode: 'G1' | 'G2' | 'G3' | 'G4';
  inputSnapshotDigest: string;
  rulesVersion: string;
  engineVersion: string;
  assumptions: unknown;
  method: string;
  result: T;
  createdAt: string;
}

export function makeCalcRun<T>(params: Omit<CalcRun<T>, 'inputSnapshotDigest' | 'engineVersion'>): CalcRun<T> {
  return {
    ...params,
    engineVersion: ENGINE_VERSION,
    inputSnapshotDigest: sha256Hex(canonicalize({ task: params.task, assumptions: params.assumptions, rulesVersion: params.rulesVersion })),
  };
}
