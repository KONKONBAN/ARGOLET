/**
 * Toán tài chính — the money arithmetic used by Vietnamese banks, lenders and finance courses:
 *  - lãi đơn, lãi kép, lãi suất tương đương / trung bình / thực (chương 1–2);
 *  - chiết khấu thương phiếu: thương mại, hợp lý, AGIO (chương 3);
 *  - chuỗi tiền tệ: hiện giá, giá trị tương lai, kỳ khoản, số kỳ, lãi suất (chương 5);
 *  - vay vốn: lịch trả nợ trả góp đều, gốc đều, gốc cuối kỳ, gốc và lãi một lần; cho thuê tài
 *    chính (kỳ khoản cố định / giảm dần); bao thanh toán; lãi quá hạn (chương 6, NHTM C4–C8).
 * Interest on actual days follows Thông tư 14/2017/TT-NHNN: balance × days × annual rate / 365.
 * Every function is exact decimal arithmetic; money is rounded to whole đồng only where a bank
 * would round it (each instalment), and the last instalment absorbs the rounding.
 */
import { D, dec, min, roundVnd, sum, type Decimal, type DecimalInput } from './decimal';

export type DayBasis = 365 | 360;

const ONE = D(1);

/** Whole days between two ISO dates (the first day is not counted, the last is): 15/01 → 16/07 = 182. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new RangeError('Ngày phải có dạng YYYY-MM-DD');
  return Math.round((b - a) / 86_400_000);
}

/** The same calendar day `months` later (clamped to the month's last day: 31/01 + 1 → 28/02). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ───────────────────────── 1 · Lãi đơn ─────────────────────────

/** Lợi tức theo lãi đơn: I = V0 × n × i (i and n in the same time unit). */
export function simpleInterest(
  principal: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: DecimalInput,
): Decimal {
  return D(principal).times(periods).times(ratePerPeriod);
}

/** Giá trị đạt được theo lãi đơn: Vn = V0 × (1 + n × i). */
export function simpleFutureValue(
  principal: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: DecimalInput,
): Decimal {
  return D(principal).times(ONE.plus(D(periods).times(ratePerPeriod)));
}

/** Lãi theo ngày thực tế: balance × days × annual rate / basis (365 in Vietnam, 360 international). */
export function interestForDays(
  balance: DecimalInput,
  annualRate: DecimalInput,
  days: number,
  basis: DayBasis = 365,
): Decimal {
  return D(balance).times(days).times(annualRate).div(basis);
}

/** Lãi suất trung bình (lãi đơn): Σ nₖ iₖ / Σ nₖ. */
export function averageSimpleRate(parts: { rate: DecimalInput; periods: DecimalInput }[]): Decimal {
  const n = sum(parts.map((p) => p.periods));
  if (n.isZero()) throw new RangeError('Tổng số kỳ phải lớn hơn 0');
  return sum(parts.map((p) => D(p.rate).times(p.periods))).div(n);
}

/**
 * Lãi suất thực của khoản vay theo lãi đơn (per year): (lãi + chi phí vay) / vốn thực dùng / số năm.
 * Vốn thực dùng = V0 − chi phí (lãi trả khi đáo hạn) or V0 − chi phí − lãi (lãi trả trước).
 */
export function effectiveSimpleRate(p: {
  principal: DecimalInput;
  interest: DecimalInput;
  fees: DecimalInput;
  years: DecimalInput;
  interestPaidUpfront?: boolean;
}): Decimal {
  const used = D(p.principal)
    .minus(p.fees)
    .minus(p.interestPaidUpfront ? p.interest : 0);
  if (used.lte(0) || D(p.years).lte(0)) throw new RangeError('Vốn thực dùng và thời gian vay phải lớn hơn 0');
  return D(p.interest).plus(p.fees).div(used).div(p.years);
}

// ───────────────────────── 2 · Lãi kép ─────────────────────────

/** Vn = V0 × (1 + i)ⁿ. */
export function compoundFutureValue(
  principal: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: DecimalInput,
): Decimal {
  return D(principal).times(ONE.plus(ratePerPeriod).pow(periods));
}

/** V0 = Vn × (1 + i)⁻ⁿ. */
export function presentValue(
  future: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: DecimalInput,
): Decimal {
  return D(future).div(ONE.plus(ratePerPeriod).pow(periods));
}

/** i = (Vn / V0)^(1/n) − 1. */
export function compoundRate(principal: DecimalInput, future: DecimalInput, periods: DecimalInput): Decimal {
  return D(future).div(principal).pow(ONE.div(periods)).minus(1);
}

/** n = ln(Vn / V0) / ln(1 + i). */
export function compoundPeriods(
  principal: DecimalInput,
  future: DecimalInput,
  ratePerPeriod: DecimalInput,
): Decimal {
  return D(future).div(principal).ln().div(ONE.plus(ratePerPeriod).ln());
}

/** Lãi suất danh nghĩa j/năm ghép m lần → lãi suất thực (hiệu dụng) năm: (1 + j/m)^m − 1. */
export function effectiveAnnualRate(nominalAnnual: DecimalInput, timesPerYear: number): Decimal {
  return ONE.plus(D(nominalAnnual).div(timesPerYear)).pow(timesPerYear).minus(1);
}

/** Lãi suất tương đương của kỳ ngắn hơn (lãi kép): (1 + i_năm)^(1/m) − 1. */
export function equivalentPeriodicRate(annualRate: DecimalInput, periodsPerYear: number): Decimal {
  return ONE.plus(annualRate).pow(ONE.div(periodsPerYear)).minus(1);
}

/** Lãi suất trung bình (lãi kép): [Π (1 + iₖ)^nₖ]^(1/Σnₖ) − 1. */
export function averageCompoundRate(parts: { rate: DecimalInput; periods: DecimalInput }[]): Decimal {
  const n = sum(parts.map((p) => p.periods));
  if (n.isZero()) throw new RangeError('Tổng số kỳ phải lớn hơn 0');
  const growth = parts.reduce((g, p) => g.times(ONE.plus(p.rate).pow(p.periods)), ONE);
  return growth.pow(ONE.div(n)).minus(1);
}

/** Lãi suất thực (lãi kép) per period: (Vn / (V0 − chi phí))^(1/n) − 1. */
export function effectiveCompoundRate(p: {
  principal: DecimalInput;
  repayment: DecimalInput;
  fees: DecimalInput;
  periods: DecimalInput;
}): Decimal {
  const used = D(p.principal).minus(p.fees);
  if (used.lte(0)) throw new RangeError('Vốn thực dùng phải lớn hơn 0');
  return D(p.repayment).div(used).pow(ONE.div(p.periods)).minus(1);
}

// ───────────────────────── 3 · Chiết khấu thương phiếu ─────────────────────────

export interface DiscountResult {
  /** Phí chiết khấu (e). */
  fee: string;
  /** Hiện giá: số tiền thực nhận (a). */
  proceeds: string;
  /** Lãi suất chiết khấu hiệu dụng / năm: e / a × basis / n. */
  effectiveRate: string;
}

/** Chiết khấu thương mại: e = V × n × i / basis, trả ngay khi chiết khấu; a = V − e. */
export function commercialDiscount(p: {
  face: DecimalInput;
  annualRate: DecimalInput;
  days: number;
  basis?: DayBasis;
}): DiscountResult {
  const basis = p.basis ?? 365;
  if (p.days <= 0) throw new RangeError('Số ngày chiết khấu phải lớn hơn 0');
  const fee = D(p.face).times(p.days).times(p.annualRate).div(basis);
  const proceeds = D(p.face).minus(fee);
  return {
    fee: dec(fee),
    proceeds: dec(proceeds),
    effectiveRate: dec(fee.div(proceeds).times(basis).div(p.days)),
  };
}

/** Chiết khấu hợp lý: lãi tính trên số tiền thực nhận — a' = V / (1 + n × i / basis), e' = V − a'. */
export function rationalDiscount(p: {
  face: DecimalInput;
  annualRate: DecimalInput;
  days: number;
  basis?: DayBasis;
}): DiscountResult {
  const basis = p.basis ?? 365;
  if (p.days <= 0) throw new RangeError('Số ngày chiết khấu phải lớn hơn 0');
  const proceeds = D(p.face).div(ONE.plus(D(p.days).times(p.annualRate).div(basis)));
  const fee = D(p.face).minus(proceeds);
  return { fee: dec(fee), proceeds: dec(proceeds), effectiveRate: dec(p.annualRate) };
}

/**
 * AGIO = phí chiết khấu + hoa hồng ký hậu (theo ngày) + hoa hồng chung (trên mệnh giá) + phí khác.
 *  - lãi suất chi phí chiết khấu iₖ = AGIO / V × basis / n;
 *  - lãi suất chiết khấu thực tế iₚ = AGIO / (V − AGIO) × basis / n.
 */
export function agio(p: {
  face: DecimalInput;
  annualRate: DecimalInput;
  days: number;
  endorsementRate?: DecimalInput;
  commissionRate?: DecimalInput;
  otherFees?: DecimalInput;
  basis?: DayBasis;
}) {
  const basis = p.basis ?? 365;
  if (p.days <= 0) throw new RangeError('Số ngày chiết khấu phải lớn hơn 0');
  const V = D(p.face);
  const discount = V.times(p.days).times(p.annualRate).div(basis);
  const endorsement = V.times(p.days)
    .times(p.endorsementRate ?? 0)
    .div(basis);
  const commission = V.times(p.commissionRate ?? 0);
  const total = discount
    .plus(endorsement)
    .plus(commission)
    .plus(p.otherFees ?? 0);
  const proceeds = V.minus(total);
  return {
    discount: dec(discount),
    endorsement: dec(endorsement),
    commission: dec(commission),
    otherFees: dec(D(p.otherFees ?? 0)),
    agio: dec(total),
    proceeds: dec(proceeds),
    costRate: dec(total.div(V).times(basis).div(p.days)),
    actualRate: dec(total.div(proceeds).times(basis).div(p.days)),
  };
}

// ───────────────────────── 5 · Chuỗi tiền tệ ─────────────────────────

/** Giá trị tương lai của chuỗi đều: a × ((1+i)ⁿ − 1) / i, × (1+i) nếu phát sinh đầu kỳ. */
export function annuityFutureValue(
  payment: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: number,
  due = false,
): Decimal {
  const i = D(ratePerPeriod);
  const base = i.isZero()
    ? D(payment).times(periods)
    : D(payment).times(ONE.plus(i).pow(periods).minus(1)).div(i);
  return due ? base.times(ONE.plus(i)) : base;
}

/** Hiện giá của chuỗi đều: a × (1 − (1+i)⁻ⁿ) / i, × (1+i) nếu phát sinh đầu kỳ. */
export function annuityPresentValue(
  payment: DecimalInput,
  ratePerPeriod: DecimalInput,
  periods: number,
  due = false,
): Decimal {
  const i = D(ratePerPeriod);
  const base = i.isZero()
    ? D(payment).times(periods)
    : D(payment)
        .times(ONE.minus(ONE.plus(i).pow(-periods)))
        .div(i);
  return due ? base.times(ONE.plus(i)) : base;
}

/** Hiện giá của chuỗi không đều (cuối kỳ: Σ aₖ(1+i)⁻ᵏ; đầu kỳ: × (1+i)). */
export function seriesPresentValue(
  payments: DecimalInput[],
  ratePerPeriod: DecimalInput,
  due = false,
): Decimal {
  const g = ONE.plus(ratePerPeriod);
  const pv = payments.reduce<Decimal>((s, a, k) => s.plus(D(a).div(g.pow(k + 1))), D(0));
  return due ? pv.times(g) : pv;
}

/** Giá trị tương lai của chuỗi không đều (cuối kỳ: Σ aₖ(1+i)ⁿ⁻ᵏ; đầu kỳ: × (1+i)). */
export function seriesFutureValue(
  payments: DecimalInput[],
  ratePerPeriod: DecimalInput,
  due = false,
): Decimal {
  const g = ONE.plus(ratePerPeriod);
  const n = payments.length;
  const fv = payments.reduce<Decimal>((s, a, k) => s.plus(D(a).times(g.pow(n - k - 1))), D(0));
  return due ? fv.times(g) : fv;
}

/** Hiện giá chuỗi vĩnh viễn: a / i; tăng trưởng đều g: a / (i − g). */
export function perpetuityPresentValue(
  payment: DecimalInput,
  ratePerPeriod: DecimalInput,
  growth: DecimalInput = 0,
): Decimal {
  const spread = D(ratePerPeriod).minus(growth);
  if (spread.lte(0)) throw new RangeError('Lãi suất phải lớn hơn tốc độ tăng trưởng');
  return D(payment).div(spread);
}

/**
 * Excel-compatible PMT / IPMT / PPMT / NPER / RATE (money paid out is negative, money received
 * positive), so results can be checked against a spreadsheet. type 0 = cuối kỳ, 1 = đầu kỳ.
 */
export function PMT(
  rate: DecimalInput,
  nper: number,
  pv: DecimalInput,
  fv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal {
  const r = D(rate);
  if (r.isZero()) return D(pv).plus(fv).neg().div(nper);
  const g = ONE.plus(r).pow(nper);
  return D(pv)
    .times(g)
    .plus(fv)
    .times(r)
    .neg()
    .div(g.minus(1).times(ONE.plus(r.times(type))));
}

/** Excel FV: balance after `nper` periods of payment `pmt`. */
export function FV(
  rate: DecimalInput,
  nper: number,
  pmt: DecimalInput,
  pv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal {
  const r = D(rate);
  if (r.isZero()) return D(pv).plus(D(pmt).times(nper)).neg();
  const g = ONE.plus(r).pow(nper);
  return D(pv)
    .times(g)
    .plus(
      D(pmt)
        .times(ONE.plus(r.times(type)))
        .times(g.minus(1))
        .div(r),
    )
    .neg();
}

/** Excel IPMT: interest part of payment `per` (1-based), as Excel / LibreOffice compute it. */
export function IPMT(
  rate: DecimalInput,
  per: number,
  nper: number,
  pv: DecimalInput,
  fv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal {
  if (per < 1 || per > nper) throw new RangeError('Kỳ phải từ 1 đến số kỳ');
  const pmt = PMT(rate, nper, pv, fv, type);
  let base: Decimal;
  if (per === 1) base = type === 1 ? D(0) : D(pv).neg();
  else base = type === 1 ? FV(rate, per - 2, pmt, pv, 1).minus(pmt) : FV(rate, per - 1, pmt, pv, 0);
  return base.times(rate);
}

/** Excel PPMT: principal part of payment `per`. */
export function PPMT(
  rate: DecimalInput,
  per: number,
  nper: number,
  pv: DecimalInput,
  fv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal {
  return PMT(rate, nper, pv, fv, type).minus(IPMT(rate, per, nper, pv, fv, type));
}

/** Excel NPER: number of periods to repay `pv` with payment `pmt`. */
export function NPER(
  rate: DecimalInput,
  pmt: DecimalInput,
  pv: DecimalInput,
  fv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal {
  const r = D(rate);
  if (r.isZero()) return D(pv).plus(fv).neg().div(pmt);
  const a = D(pmt).times(ONE.plus(r.times(type)));
  const num = a.minus(D(fv).times(r));
  const den = a.plus(D(pv).times(r));
  if (num.div(den).lte(0)) throw new RangeError('Kỳ khoản không đủ trả lãi: khoản vay không bao giờ hết');
  return num.div(den).ln().div(ONE.plus(r).ln());
}

/** Excel RATE: rate per period solving the annuity equation (bisection, then exact enough). */
export function RATE(
  nper: number,
  pmt: DecimalInput,
  pv: DecimalInput,
  fv: DecimalInput = 0,
  type: 0 | 1 = 0,
): Decimal | null {
  const f = (r: Decimal) => {
    if (r.isZero()) return D(pv).plus(D(pmt).times(nper)).plus(fv);
    const g = ONE.plus(r).pow(nper);
    return D(pv)
      .times(g)
      .plus(
        D(pmt)
          .times(ONE.plus(r.times(type)))
          .times(g.minus(1))
          .div(r),
      )
      .plus(fv);
  };
  let lo = D('-0.99');
  let hi = D(10);
  let flo = f(lo);
  if (flo.isZero()) return lo;
  if (flo.isPos() === f(hi).isPos()) return null;
  for (let k = 0; k < 300; k++) {
    const mid = lo.plus(hi).div(2);
    const fm = f(mid);
    if (fm.abs().lt('1e-20')) return mid;
    if (fm.isPos() === flo.isPos()) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return lo.plus(hi).div(2);
}

// ───────────────────────── 6 · Vay vốn, thuê tài chính ─────────────────────────

/** How the loan is repaid. */
export type RepaymentMethod =
  /** Trả góp đều: gốc + lãi bằng nhau mỗi kỳ (kỳ khoản cố định). */
  | 'ANNUITY'
  /** Gốc đều, lãi tính trên dư nợ giảm dần (kỳ khoản giảm dần). */
  | 'EQUAL_PRINCIPAL'
  /** Lãi trả định kỳ, gốc trả một lần cuối kỳ. */
  | 'BULLET'
  /** Gốc và lãi (lãi đơn) trả một lần khi đáo hạn. */
  | 'LUMP_SUM';

export interface LoanTerms {
  principal: DecimalInput;
  /** Lãi suất năm, e.g. "0.10". */
  annualRate: DecimalInput;
  /** Number of repayment periods. */
  periods: number;
  /** Months per period (1 = hàng tháng, 3 = hàng quý, 6, 12). */
  periodMonths?: number;
  method: RepaymentMethod;
  /** Ân hạn gốc: the first periods pay interest only (ANNUITY / EQUAL_PRINCIPAL). */
  graceMonths?: number;
  /**
   * 'PERIOD': rate per period = annual rate × months / 12 (common for instalment loans);
   * 'ACTUAL_365': interest = balance × actual days × annual rate / 365 (TT14/2017/TT-NHNN), needs startDate.
   */
  dayCount?: 'PERIOD' | 'ACTUAL_365';
  startDate?: string;
  /** Payments at the start of each period (thuê tài chính trả đầu kỳ). ANNUITY / EQUAL_PRINCIPAL only. */
  inAdvance?: boolean;
  /** Giá trị còn lại phải trả ở cuối (thuê tài chính có giá trị mua lại). ANNUITY only. */
  residual?: DecimalInput;
}

export interface ScheduleRow {
  period: number;
  date: string | null;
  days: number | null;
  opening: string;
  interest: string;
  principal: string;
  payment: string;
  closing: string;
}

export interface LoanSchedule {
  rows: ScheduleRow[];
  totalInterest: string;
  totalPayment: string;
  /** The level instalment for ANNUITY (before the last-period rounding adjustment). */
  instalment: string | null;
  ratePerPeriod: string;
}

/**
 * Lịch trả nợ. Interest is rounded to whole đồng each period (as banks do), principal instalments
 * are whole đồng, and the last period settles the balance exactly (to the residual, if any).
 */
export function loanSchedule(t: LoanTerms): LoanSchedule {
  const P = D(t.principal);
  const months = t.periodMonths ?? 1;
  const n = t.periods;
  if (P.lte(0)) throw new RangeError('Số tiền vay phải lớn hơn 0');
  if (!Number.isInteger(n) || n < 1 || n > 600) throw new RangeError('Số kỳ trả nợ phải từ 1 đến 600');
  if (![1, 2, 3, 4, 6, 12].includes(months))
    throw new RangeError('Kỳ trả nợ phải là 1, 2, 3, 4, 6 hoặc 12 tháng');
  if (D(t.annualRate).lt(0) || D(t.annualRate).gt(1))
    throw new RangeError('Lãi suất năm phải từ 0% đến 100%');
  const actual = t.dayCount === 'ACTUAL_365';
  if (actual && !t.startDate) throw new RangeError('Cần ngày giải ngân để tính lãi theo ngày thực tế');
  const graceMonths = t.graceMonths ?? 0;
  if (graceMonths % months !== 0) throw new RangeError('Thời gian ân hạn phải là bội số của kỳ trả nợ');
  const grace = graceMonths / months;
  if (grace >= n) throw new RangeError('Thời gian ân hạn phải ngắn hơn thời hạn vay');
  if (t.inAdvance && t.method !== 'ANNUITY' && t.method !== 'EQUAL_PRINCIPAL')
    throw new RangeError('Trả đầu kỳ chỉ áp dụng cho trả góp đều hoặc gốc đều');
  if (t.inAdvance && actual) throw new RangeError('Trả đầu kỳ dùng lãi suất theo kỳ');
  if (t.inAdvance && grace > 0) throw new RangeError('Trả đầu kỳ không kết hợp với ân hạn');
  const residual = roundVnd(t.residual ?? 0);
  if (residual.gt(0) && t.method !== 'ANNUITY')
    throw new RangeError('Giá trị còn lại chỉ áp dụng cho trả góp đều');
  if (residual.gte(P)) throw new RangeError('Giá trị còn lại phải nhỏ hơn số tiền vay');

  const r = D(t.annualRate).times(months).div(12);
  const dates: (string | null)[] = [];
  const days: (number | null)[] = [];
  for (let k = 1; k <= n; k++) {
    if (!t.startDate) {
      dates.push(null);
      days.push(null);
      continue;
    }
    const prev = addMonths(t.startDate, (k - 1) * months);
    const cur = addMonths(t.startDate, k * months);
    dates.push(t.inAdvance ? prev : cur);
    days.push(daysBetween(prev, cur));
  }
  const interestOn = (balance: Decimal, k: number) =>
    roundVnd(actual ? interestForDays(balance, t.annualRate, days[k - 1]!) : balance.times(r));

  const rows: ScheduleRow[] = [];
  let balance = P;
  const push = (k: number, opening: Decimal, interest: Decimal, principal: Decimal) => {
    const closing = opening.minus(principal);
    rows.push({
      period: k,
      date: dates[k - 1] ?? null,
      days: days[k - 1] ?? null,
      opening: dec(opening),
      interest: dec(interest),
      principal: dec(principal),
      payment: dec(interest.plus(principal)),
      closing: dec(closing),
    });
    balance = closing;
  };

  let instalment: Decimal | null = null;
  if (t.method === 'LUMP_SUM') {
    // Lãi đơn on the whole term, everything paid on the last date.
    const totalDays = actual ? days.reduce<number>((s, d) => s + (d ?? 0), 0) : 0;
    const interest = roundVnd(actual ? interestForDays(P, t.annualRate, totalDays) : P.times(r).times(n));
    for (let k = 1; k < n; k++) push(k, balance, D(0), D(0));
    push(n, balance, interest, balance);
  } else if (t.method === 'BULLET') {
    for (let k = 1; k <= n; k++) push(k, balance, interestOn(balance, k), k === n ? balance : D(0));
  } else if (t.method === 'EQUAL_PRINCIPAL') {
    const repaying = n - grace;
    const part = roundVnd(P.div(repaying));
    for (let k = 1; k <= n; k++) {
      const opening = balance;
      const interest =
        t.inAdvance && k === 1 ? D(0) : t.inAdvance ? roundVnd(opening.times(r)) : interestOn(opening, k);
      const principal = k <= grace ? D(0) : k === n ? opening : min(part, opening);
      push(k, opening, interest, principal);
    }
  } else {
    // ANNUITY: level payment over the repaying periods (after any grace), optional residual.
    const repaying = n - grace;
    const level = roundVnd(PMT(r, repaying, P, residual.neg(), t.inAdvance ? 1 : 0).neg());
    instalment = level;
    for (let k = 1; k <= n; k++) {
      const opening = balance;
      if (k <= grace) {
        push(k, opening, interestOn(opening, k), D(0));
        continue;
      }
      const interest = t.inAdvance && k === grace + 1 ? D(0) : interestOn(opening, k);
      const principal = k === n ? opening.minus(residual) : level.minus(interest);
      push(k, opening, interest, principal);
    }
    if (residual.gt(0)) {
      // The residual (giá trị mua lại) is paid with the last instalment.
      const last = rows[rows.length - 1]!;
      last.principal = dec(D(last.principal).plus(residual));
      last.payment = dec(D(last.payment).plus(residual));
      last.closing = '0';
    }
  }
  const totalInterest = sum(rows.map((x) => x.interest));
  return {
    rows,
    totalInterest: dec(totalInterest),
    totalPayment: dec(sum(rows.map((x) => x.payment))),
    instalment: instalment ? dec(instalment) : null,
    ratePerPeriod: dec(r),
  };
}

/**
 * Lãi suất thực (chi phí thực) của khoản vay có phí: the rate that equates the money actually
 * received (số tiền vay − phí) with the instalments of the schedule. Returns the rate per period,
 * the annual rate (× periods per year) and the effective annual rate.
 */
export function loanEffectiveCost(
  schedule: LoanSchedule,
  principal: DecimalInput,
  fees: DecimalInput,
  opts: { periodMonths?: number; inAdvance?: boolean } = {},
) {
  const received = D(principal).minus(fees);
  if (received.lte(0)) throw new RangeError('Phí vay phải nhỏ hơn số tiền vay');
  // Instalment k falls at the end of period k (or at its start when paid in advance).
  const shift = opts.inAdvance ? 1 : 0;
  const flows = schedule.rows.map((x) => ({ t: x.period - shift, amount: D(x.payment) }));
  const f = (rate: Decimal) =>
    flows.reduce<Decimal>((s, cf) => s.plus(cf.amount.div(ONE.plus(rate).pow(cf.t))), received.neg());
  let lo = D(0);
  let hi = D(1);
  let flo = f(lo);
  if (flo.isPos() === f(hi).isPos()) return null;
  for (let k = 0; k < 200; k++) {
    const mid = lo.plus(hi).div(2);
    const fm = f(mid);
    if (fm.isPos() === flo.isPos()) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  const perPeriod = lo.plus(hi).div(2);
  const perYear = 12 / (opts.periodMonths ?? 1);
  return {
    perPeriod: dec(perPeriod),
    annual: dec(perPeriod.times(perYear)),
    effectiveAnnual: dec(ONE.plus(perPeriod).pow(perYear).minus(1)),
  };
}

/** Lãi quá hạn: overdue amount × days × (in-term rate × multiple, capped at 150%) / 365. */
export function overdueInterest(p: {
  amount: DecimalInput;
  annualRate: DecimalInput;
  days: number;
  multiple?: DecimalInput;
}): Decimal {
  const multiple = D(p.multiple ?? '1.5');
  if (multiple.gt('1.5')) throw new RangeError('Lãi suất quá hạn không vượt quá 150% lãi suất trong hạn');
  return interestForDays(p.amount, D(p.annualRate).times(multiple), p.days);
}

/** Bao thanh toán: ứng trước, phí, lãi theo số ngày ứng trước, phần còn lại trả cho bên bán. */
export function factoring(p: {
  receivable: DecimalInput;
  advanceRate: DecimalInput;
  feeRate: DecimalInput;
  annualRate: DecimalInput;
  days: number;
  otherFees?: DecimalInput;
  basis?: DayBasis;
}) {
  const advance = roundVnd(D(p.receivable).times(p.advanceRate));
  const fee = roundVnd(D(p.receivable).times(p.feeRate));
  const interest = roundVnd(interestForDays(advance, p.annualRate, p.days, p.basis ?? 365));
  const other = roundVnd(p.otherFees ?? 0);
  return {
    advance: dec(advance),
    fee: dec(fee),
    interest: dec(interest),
    otherFees: dec(other),
    remaining: dec(D(p.receivable).minus(advance).minus(interest).minus(fee).minus(other)),
  };
}

// ───────────────────────── Khấu hao tài sản cố định ─────────────────────────

export type DepreciationMethod =
  /** Đường thẳng: nguyên giá / số năm sử dụng. */
  | 'STRAIGHT_LINE'
  /** Số dư giảm dần có điều chỉnh (Thông tư 45/2013/TT-BTC). */
  | 'DECLINING'
  /** Theo số lượng, khối lượng sản phẩm. */
  | 'UNITS';

export interface DepreciationRow {
  year: number;
  opening: string;
  depreciation: string;
  accumulated: string;
  closing: string;
}

/** Hệ số điều chỉnh của phương pháp số dư giảm dần: ≤ 4 năm 1,5; > 4 đến 6 năm 2,0; > 6 năm 2,5. */
export function decliningCoefficient(years: number): Decimal {
  return D(years <= 4 ? '1.5' : years <= 6 ? '2' : '2.5');
}

/**
 * Lịch khấu hao năm. Declining balance: remaining value × (1 / years × coefficient), switching to
 * remaining value / remaining years once that is larger (as Thông tư 45/2013 prescribes). Units of
 * production: cost / total units × units of the year. Amounts are whole đồng; the last year takes
 * what remains so the asset is fully depreciated.
 */
export function depreciationSchedule(p: {
  cost: DecimalInput;
  years: number;
  method: DepreciationMethod;
  /** UNITS only: expected output of each year (its sum is the total output). */
  unitsPerYear?: DecimalInput[];
}): DepreciationRow[] {
  const cost = roundVnd(p.cost);
  if (cost.lte(0)) throw new RangeError('Nguyên giá phải lớn hơn 0');
  const years = p.method === 'UNITS' ? (p.unitsPerYear?.length ?? 0) : p.years;
  if (!Number.isInteger(years) || years < 1 || years > 50)
    throw new RangeError('Thời gian sử dụng phải từ 1 đến 50 năm');
  const rows: DepreciationRow[] = [];
  let remaining = cost;
  let accumulated = D(0);
  const totalUnits = p.method === 'UNITS' ? sum(p.unitsPerYear ?? []) : D(0);
  if (p.method === 'UNITS' && totalUnits.lte(0)) throw new RangeError('Tổng sản lượng phải lớn hơn 0');
  const fastRate = ONE.div(years).times(decliningCoefficient(years));
  for (let y = 1; y <= years; y++) {
    const left = years - y + 1;
    let amount: Decimal;
    if (y === years) amount = remaining;
    else if (p.method === 'STRAIGHT_LINE') amount = roundVnd(cost.div(years));
    else if (p.method === 'UNITS') amount = roundVnd(cost.times(p.unitsPerYear![y - 1]!).div(totalUnits));
    else {
      const declining = roundVnd(remaining.times(fastRate));
      const even = roundVnd(remaining.div(left));
      amount = declining.lt(even) ? even : declining;
    }
    amount = min(amount, remaining);
    const opening = remaining;
    remaining = remaining.minus(amount);
    accumulated = accumulated.plus(amount);
    rows.push({
      year: y,
      opening: dec(opening),
      depreciation: dec(amount),
      accumulated: dec(accumulated),
      closing: dec(remaining),
    });
  }
  return rows;
}
