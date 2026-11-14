/**
 * Chỉ số tài chính doanh nghiệp — đòn bẩy, hòa vốn, cơ cấu vốn, khả năng trả lãi, DuPont và hiệu
 * ứng đòn bẩy tài chính theo Modigliani–Miller mở rộng. Definitions follow the corporate finance
 * course (TCDN), Ross–Westerfield–Jordan and the ROE–ROA analysis used in the course materials:
 *  - DOL = (Doanh thu − Biến phí) / EBIT;  DFL = EBIT / (EBIT − Lãi vay − Cổ tức ưu đãi/(1 − t));
 *    DTL = DOL × DFL = Số dư đảm phí / (EBIT − Lãi vay);
 *  - ROE = (1 + LEV) × ROA − LEV × Rd × (1 − T), LEV = D/E, ROA = EBIT(1 − T)/Tổng tài sản.
 * A ratio whose denominator is zero is reported as null (undefined), never as a made-up number.
 */
import { D, dec, type Decimal, type DecimalInput } from './decimal';

const div = (a: Decimal, b: Decimal): Decimal | null => (b.isZero() ? null : a.div(b));
const out = (v: Decimal | null) => (v === null ? null : dec(v));

/** Đòn bẩy kinh doanh (DOL): % thay đổi EBIT khi doanh thu thay đổi 1%. */
export function operatingLeverage(p: {
  revenue: DecimalInput;
  variableCosts: DecimalInput;
  fixedCosts: DecimalInput;
}) {
  const cm = D(p.revenue).minus(p.variableCosts);
  const ebit = cm.minus(p.fixedCosts);
  return {
    contributionMargin: dec(cm),
    contributionMarginRatio: out(div(cm, D(p.revenue))),
    ebit: dec(ebit),
    dol: out(div(cm, ebit)),
  };
}

/** Đòn bẩy tài chính (DFL): % thay đổi EPS (lợi nhuận cho chủ sở hữu) khi EBIT thay đổi 1%. */
export function financialLeverage(p: {
  ebit: DecimalInput;
  interest: DecimalInput;
  preferredDividends?: DecimalInput;
  taxRate?: DecimalInput;
}) {
  const t = D(p.taxRate ?? 0);
  const pd = D(p.preferredDividends ?? 0);
  if (pd.gt(0) && t.gte(1)) throw new RangeError('Thuế suất phải nhỏ hơn 100%');
  const ebt = D(p.ebit)
    .minus(p.interest)
    .minus(pd.isZero() ? 0 : pd.div(D(1).minus(t)));
  return { ebt: dec(D(p.ebit).minus(p.interest)), dfl: out(div(D(p.ebit), ebt)) };
}

/** Đòn bẩy tổng hợp (DTL = DOL × DFL). */
export function totalLeverage(p: {
  revenue: DecimalInput;
  variableCosts: DecimalInput;
  fixedCosts: DecimalInput;
  interest: DecimalInput;
  preferredDividends?: DecimalInput;
  taxRate?: DecimalInput;
}) {
  const op = operatingLeverage(p);
  const fin = financialLeverage({ ...p, ebit: op.ebit });
  const dtl = op.dol !== null && fin.dfl !== null ? dec(D(op.dol).times(fin.dfl)) : null;
  return { ...op, ...fin, dtl };
}

/** Điểm hòa vốn: sản lượng = Định phí / (Giá − Biến phí đơn vị); doanh thu = Định phí / tỷ lệ số dư đảm phí. */
export function breakEven(p: {
  fixedCosts: DecimalInput;
  price: DecimalInput;
  variableCostPerUnit: DecimalInput;
}) {
  const unitMargin = D(p.price).minus(p.variableCostPerUnit);
  if (unitMargin.lte(0)) throw new RangeError('Giá bán phải lớn hơn biến phí đơn vị');
  const units = D(p.fixedCosts).div(unitMargin);
  return { units: dec(units), revenue: dec(units.times(p.price)), unitMargin: dec(unitMargin) };
}

/** Cơ cấu vốn: hệ số nợ, nợ / vốn chủ, hệ số nhân vốn chủ, hệ số tự tài trợ. */
export function capitalStructure(p: {
  totalAssets: DecimalInput;
  equity: DecimalInput;
  liabilities?: DecimalInput;
}) {
  const A = D(p.totalAssets);
  const E = D(p.equity);
  const L = p.liabilities === undefined ? A.minus(E) : D(p.liabilities);
  return {
    liabilities: dec(L),
    debtRatio: out(div(L, A)),
    debtToEquity: out(div(L, E)),
    equityMultiplier: out(div(A, E)),
    equityRatio: out(div(E, A)),
  };
}

/** Khả năng thanh toán lãi vay (TIE) = EBIT / Lãi vay. */
export function interestCoverage(ebit: DecimalInput, interest: DecimalInput): string | null {
  return out(div(D(ebit), D(interest)));
}

/** DuPont 3 nhân tố: ROE = ROS × Vòng quay tài sản × Hệ số nhân vốn chủ. */
export function dupont(p: {
  netIncome: DecimalInput;
  revenue: DecimalInput;
  totalAssets: DecimalInput;
  equity: DecimalInput;
}) {
  const ros = div(D(p.netIncome), D(p.revenue));
  const turnover = div(D(p.revenue), D(p.totalAssets));
  const multiplier = div(D(p.totalAssets), D(p.equity));
  return {
    ros: out(ros),
    assetTurnover: out(turnover),
    equityMultiplier: out(multiplier),
    roa: out(div(D(p.netIncome), D(p.totalAssets))),
    roe: out(div(D(p.netIncome), D(p.equity))),
  };
}

/**
 * Hiệu ứng đòn bẩy tài chính (Modigliani–Miller mở rộng):
 *   ROE = (1 + LEV) × ROA − LEV × Rd × (1 − T)  ⇔  ROE = ROA + LEV × (ROA − Rd(1 − T)),
 * with LEV = D/E (D = nợ phải trả = Tổng tài sản − Vốn chủ), Rd = Lãi vay / D and
 * ROA = EBIT × (1 − T) / Tổng tài sản (lợi nhuận trước lãi vay, sau thuế). Debt raises ROE while
 * ROA exceeds the after-tax cost of debt, and lowers it otherwise.
 */
export function leverageEffect(p: {
  ebit: DecimalInput;
  interest: DecimalInput;
  taxRate: DecimalInput;
  totalAssets: DecimalInput;
  equity: DecimalInput;
}) {
  const t = D(p.taxRate);
  if (t.lt(0) || t.gte(1)) throw new RangeError('Thuế suất phải từ 0% đến dưới 100%');
  const A = D(p.totalAssets);
  const E = D(p.equity);
  if (A.lte(0) || E.lte(0)) throw new RangeError('Tổng tài sản và vốn chủ sở hữu phải lớn hơn 0');
  if (E.gt(A)) throw new RangeError('Vốn chủ sở hữu không thể lớn hơn tổng tài sản');
  const debt = A.minus(E);
  const lev = debt.div(E);
  const roa = D(p.ebit).times(D(1).minus(t)).div(A);
  const rd = debt.isZero() ? D(0) : D(p.interest).div(debt);
  const afterTaxRd = rd.times(D(1).minus(t));
  const roeModel = D(1).plus(lev).times(roa).minus(lev.times(afterTaxRd));
  const roeActual = D(p.ebit).minus(p.interest).times(D(1).minus(t)).div(E);
  const spread = roa.minus(afterTaxRd);
  return {
    debt: dec(debt),
    lev: dec(lev),
    roa: dec(roa),
    costOfDebt: dec(rd),
    afterTaxCostOfDebt: dec(afterTaxRd),
    roe: dec(roeModel),
    roeFromStatements: dec(roeActual),
    spread: dec(spread),
    /** How much the leverage adds to (or takes from) ROE: LEV × (ROA − Rd(1 − T)). */
    leverageContribution: dec(lev.times(spread)),
    favourable: spread.gt(0),
  };
}
