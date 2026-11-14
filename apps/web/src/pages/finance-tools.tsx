import { useMemo, useState, type ReactNode } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import {
  agio,
  annuityFutureValue,
  annuityPresentValue,
  breakEven,
  buildXlsx,
  capitalStructure,
  capmCostOfEquity,
  commercialDiscount,
  compoundFutureValue,
  D,
  daysBetween,
  decliningCoefficient,
  depreciationSchedule,
  dupont,
  effectiveAnnualRate,
  formatNumber,
  formatPercent,
  formatVnd,
  interestCoverage,
  leverageEffect,
  loanEffectiveCost,
  loanSchedule,
  PMT,
  rationalDiscount,
  simpleFutureValue,
  totalLeverage,
  wacc,
  XLSX_MIME,
  type DepreciationMethod,
  type LoanSchedule,
  type RepaymentMethod,
  type XCell,
} from '@argolet/core';
import {
  Button,
  Card,
  MoneyInput,
  PageHeader,
  SelectInput,
  TextInput,
  downloadBase64,
} from '../ui/components';
import { ModuleTabs } from './g1';
import { FINANCE_TABS } from './finance-report';
import { PageFoot, usePeriodLabel } from './overview';

/** "10,5" or "10.5" (percent) → 0.105; empty or invalid → null. */
const pct = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t) / 100;
};
/** Whole đồng from a money field ("40.000.000" → "40000000"). */
const money = (s: string) => s.replace(/[^\d]/g, '');
const vnd = (v: string | number) => formatVnd(D(v));
const ratio = (v: string | null, digits = 2) => (v === null ? '—' : `${formatNumber(D(v), digits)} lần`);
const percent = (v: string | null, digits = 2) => (v === null ? '—' : formatPercent(v, digits));

function Result({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="k">
        {label}
        {note && <span className="small muted tool-note">{note}</span>}
      </span>
      <span className="v strong num">{value}</span>
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="small" style={{ color: 'var(--danger)' }} role="alert">
      {children}
    </p>
  );
}

/** Runs a calculation; a RangeError from the engine becomes a message for the person. */
function attempt<T>(f: () => T): { value: T; error: null } | { value: null; error: string } {
  try {
    return { value: f(), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'Không tính được' };
  }
}

// ───────── 1 · Vay vốn: lịch trả nợ ─────────
const METHODS: { value: RepaymentMethod; label: string }[] = [
  { value: 'ANNUITY', label: 'Trả góp đều (gốc + lãi bằng nhau mỗi kỳ)' },
  { value: 'EQUAL_PRINCIPAL', label: 'Gốc đều, lãi tính trên dư nợ giảm dần' },
  { value: 'BULLET', label: 'Lãi trả định kỳ, gốc trả cuối kỳ' },
  { value: 'LUMP_SUM', label: 'Gốc và lãi trả một lần khi đáo hạn' },
];

function scheduleXlsx(s: LoanSchedule, title: string) {
  const head = [
    'Kỳ',
    'Ngày trả',
    'Số ngày',
    'Dư nợ đầu kỳ',
    'Tiền lãi',
    'Tiền gốc',
    'Số tiền phải trả',
    'Dư nợ cuối kỳ',
  ].map((v): XCell => ({ v, s: 'head' }));
  const m = (v: string): XCell => ({ v: Number(v), s: 'money' });
  const rows: (XCell | null)[][] = [
    [{ v: 'LỊCH TRẢ NỢ VAY', s: 'title' }],
    [{ v: title, s: 'subtitle' }],
    [{ v: 'Đơn vị tính: đồng', s: 'unitNote' }],
    head,
    ...s.rows.map((r): XCell[] => [
      { v: r.period, s: 'cellCenter' },
      { v: r.date ? `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}/${r.date.slice(0, 4)}` : '', s: 'date' },
      { v: r.days ?? '', s: 'cellCenter' },
      m(r.opening),
      m(r.interest),
      m(r.principal),
      m(r.payment),
      m(r.closing),
    ]),
  ];
  const first = 5;
  const last = 4 + s.rows.length;
  rows.push([
    { v: 'Cộng', s: 'cellBold' },
    { v: '', s: 'cell' },
    { v: '', s: 'cell' },
    { v: '', s: 'cell' },
    { v: Number(s.totalInterest), s: 'moneyBold', f: `SUM(E${first}:E${last})` },
    { v: Number(D(s.totalPayment).minus(s.totalInterest)), s: 'moneyBold', f: `SUM(F${first}:F${last})` },
    { v: Number(s.totalPayment), s: 'moneyBold', f: `SUM(G${first}:G${last})` },
    { v: '', s: 'cell' },
  ]);
  const bytes = buildXlsx(
    [
      {
        name: 'Lịch trả nợ',
        cols: [7, 12, 9, 17, 15, 15, 17, 17],
        rows,
        merges: ['A1:H1', 'A2:H2', 'A3:H3'],
        heights: { 1: 24 },
        landscape: true,
      },
    ],
    { title: 'Lịch trả nợ vay', author: 'ARGOLET', created: new Date() },
  );
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  downloadBase64('lich-tra-no-vay.xlsx', btoa(bin), XLSX_MIME);
}

function LoanTool() {
  const [f, setF] = useState({
    principal: '',
    rate: '',
    periods: '12',
    periodMonths: '1',
    method: 'ANNUITY' as RepaymentMethod,
    grace: '0',
    dayCount: 'PERIOD' as 'PERIOD' | 'ACTUAL_365',
    startDate: '',
    fees: '',
    inAdvance: false,
    residual: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const rate = pct(f.rate);
  const ready = money(f.principal) !== '' && rate !== null && Number(f.periods) > 0;
  const r = useMemo(
    () =>
      ready
        ? attempt(() => {
            const terms = {
              principal: money(f.principal),
              annualRate: String(rate),
              periods: Number(f.periods),
              periodMonths: Number(f.periodMonths),
              method: f.method,
              graceMonths: Number(f.grace || 0),
              dayCount: f.dayCount,
              ...(f.startDate ? { startDate: f.startDate } : {}),
              inAdvance: f.inAdvance,
              residual: money(f.residual) || '0',
            };
            const s = loanSchedule(terms);
            const cost = loanEffectiveCost(s, terms.principal, money(f.fees) || '0', {
              periodMonths: terms.periodMonths,
              inAdvance: terms.inAdvance,
            });
            return { s, cost };
          })
        : null,
    [f, rate, ready],
  );
  const s = r?.value?.s;
  return (
    <div className="tool-grid">
      <Card title="Khoản vay">
        <MoneyInput label="Số tiền vay" value={f.principal} onChange={(v) => set({ principal: v })} />
        <TextInput
          label="Lãi suất · %/năm"
          inputMode="decimal"
          value={f.rate}
          onChange={(e) => set({ rate: e.target.value })}
          placeholder="10"
        />
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Số kỳ trả nợ"
            inputMode="numeric"
            value={f.periods}
            onChange={(e) => set({ periods: e.target.value.replace(/[^\d]/g, '') })}
          />
          <SelectInput
            label="Mỗi kỳ"
            value={f.periodMonths}
            onChange={(v) => set({ periodMonths: v })}
            options={[
              { value: '1', label: '1 tháng' },
              { value: '3', label: '3 tháng (quý)' },
              { value: '6', label: '6 tháng' },
              { value: '12', label: '12 tháng (năm)' },
            ]}
          />
        </div>
        <SelectInput
          label="Phương thức trả nợ"
          value={f.method}
          onChange={(v) => set({ method: v as RepaymentMethod })}
          options={METHODS}
        />
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Ân hạn gốc · tháng"
            inputMode="numeric"
            value={f.grace}
            onChange={(e) => set({ grace: e.target.value.replace(/[^\d]/g, '') })}
            hint="Chỉ trả lãi trong thời gian này"
          />
          <MoneyInput
            label="Phí vay (để tính lãi suất thực)"
            value={f.fees}
            onChange={(v) => set({ fees: v })}
          />
        </div>
        <SelectInput
          label="Cách tính lãi"
          value={f.dayCount}
          onChange={(v) => set({ dayCount: v as 'PERIOD' | 'ACTUAL_365' })}
          options={[
            { value: 'PERIOD', label: 'Theo kỳ: lãi suất năm × số tháng / 12' },
            { value: 'ACTUAL_365', label: 'Theo ngày thực tế: dư nợ × số ngày × lãi suất / 365' },
          ]}
        />
        <TextInput
          label="Ngày giải ngân"
          type="date"
          value={f.startDate}
          onChange={(e) => set({ startDate: e.target.value })}
          hint={
            f.dayCount === 'ACTUAL_365'
              ? 'Bắt buộc khi tính lãi theo ngày thực tế'
              : 'Để hiện ngày trả từng kỳ'
          }
        />
        <details className="tool-more">
          <summary>Thuê tài chính</summary>
          <label className="row" style={{ gap: 8, margin: '10px 0' }}>
            <input
              type="checkbox"
              checked={f.inAdvance}
              onChange={(e) => set({ inAdvance: e.target.checked })}
            />
            <span>Trả tiền thuê đầu mỗi kỳ</span>
          </label>
          <MoneyInput
            label="Giá trị còn lại (mua lại cuối hợp đồng)"
            value={f.residual}
            onChange={(v) => set({ residual: v })}
          />
        </details>
      </Card>
      <div className="stack">
        {!ready ? (
          <Card>
            <p className="muted">Nhập số tiền vay, lãi suất và số kỳ để lập lịch trả nợ.</p>
          </Card>
        ) : r?.error ? (
          <Card>
            <Problem>{r.error}</Problem>
          </Card>
        ) : (
          s && (
            <>
              <Card
                title="Kết quả"
                actions={
                  <Button
                    size="sm"
                    icon={<FileSpreadsheet size={16} />}
                    onClick={() =>
                      scheduleXlsx(
                        s,
                        `${vnd(money(f.principal))} · ${f.rate}%/năm · ${f.periods} kỳ × ${f.periodMonths} tháng · ${METHODS.find((m) => m.value === f.method)!.label}`,
                      )
                    }
                  >
                    Xuất Excel
                  </Button>
                }
              >
                <div className="kv">
                  {s.instalment && <Result label="Số tiền trả đều mỗi kỳ" value={vnd(s.instalment)} />}
                  <Result label="Lãi suất mỗi kỳ" value={formatPercent(s.ratePerPeriod, 4)} />
                  <Result label="Tổng tiền lãi" value={vnd(s.totalInterest)} />
                  <Result label="Tổng số tiền phải trả" value={vnd(s.totalPayment)} />
                  {r?.value?.cost && (
                    <Result
                      label="Lãi suất thực / năm"
                      note="Gồm phí vay; tính trên số tiền thực nhận"
                      value={`${formatPercent(r.value.cost.annual)} (hiệu dụng ${formatPercent(r.value.cost.effectiveAnnual)})`}
                    />
                  )}
                </div>
              </Card>
              <Card
                title="Lịch trả nợ"
                subtitle="Đơn vị: đồng · lãi làm tròn đến đồng, kỳ cuối điều chỉnh để tất toán đúng"
              >
                <div className="table-wrap">
                  <table className="table report-table tool-table">
                    <thead>
                      <tr>
                        <th scope="col">Kỳ</th>
                        {s.rows[0]?.date && <th scope="col">Ngày trả</th>}
                        <th scope="col" className="right">
                          Dư nợ đầu kỳ
                        </th>
                        <th scope="col" className="right">
                          Tiền lãi
                        </th>
                        <th scope="col" className="right">
                          Tiền gốc
                        </th>
                        <th scope="col" className="right">
                          Phải trả
                        </th>
                        <th scope="col" className="right">
                          Dư nợ cuối kỳ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.map((x) => (
                        <tr key={x.period}>
                          <th scope="row">{x.period}</th>
                          {x.date && (
                            <td>{`${x.date.slice(8, 10)}/${x.date.slice(5, 7)}/${x.date.slice(0, 4)}`}</td>
                          )}
                          <td className="right num">{formatNumber(D(x.opening))}</td>
                          <td className="right num">{formatNumber(D(x.interest))}</td>
                          <td className="right num">{formatNumber(D(x.principal))}</td>
                          <td className="right num">{formatNumber(D(x.payment))}</td>
                          <td className="right num">{formatNumber(D(x.closing))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )
        )}
      </div>
    </div>
  );
}

// ───────── 2 · Đòn bẩy và chỉ số tài chính ─────────
function LeverageTool() {
  const [f, setF] = useState({
    revenue: '',
    variable: '',
    fixed: '',
    interest: '',
    tax: '20',
    assets: '',
    equity: '',
    price: '',
    unitVariable: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const t = pct(f.tax);
  const has = (k: keyof typeof f) => money(f[k]) !== '';
  const lev =
    has('revenue') && has('variable') && has('fixed')
      ? attempt(() =>
          totalLeverage({
            revenue: money(f.revenue),
            variableCosts: money(f.variable),
            fixedCosts: money(f.fixed),
            interest: money(f.interest) || '0',
            taxRate: String(t ?? 0),
          }),
        )
      : null;
  const ebit = lev?.value?.ebit;
  const balance =
    ebit !== undefined && has('assets') && has('equity') && t !== null
      ? attempt(() => {
          const interest = money(f.interest) || '0';
          const netIncome = D(ebit)
            .minus(interest)
            .times(1 - t)
            .toFixed();
          return {
            structure: capitalStructure({ totalAssets: money(f.assets), equity: money(f.equity) }),
            dupont: dupont({
              netIncome,
              revenue: money(f.revenue),
              totalAssets: money(f.assets),
              equity: money(f.equity),
            }),
            mm: leverageEffect({
              ebit,
              interest,
              taxRate: String(t),
              totalAssets: money(f.assets),
              equity: money(f.equity),
            }),
            tie: interestCoverage(ebit, interest),
            netIncome,
          };
        })
      : null;
  const be =
    has('price') && has('unitVariable') && has('fixed')
      ? attempt(() =>
          breakEven({
            fixedCosts: money(f.fixed),
            price: money(f.price),
            variableCostPerUnit: money(f.unitVariable),
          }),
        )
      : null;
  const cmRatio = lev?.value?.contributionMarginRatio;
  return (
    <div className="tool-grid">
      <Card
        title="Số liệu kỳ phân tích"
        subtitle="Lấy từ báo cáo kết quả kinh doanh và báo cáo tình hình tài chính"
      >
        <MoneyInput label="Doanh thu thuần" value={f.revenue} onChange={(v) => set({ revenue: v })} />
        <MoneyInput
          label="Biến phí (chi phí thay đổi theo doanh thu)"
          value={f.variable}
          onChange={(v) => set({ variable: v })}
        />
        <MoneyInput
          label="Định phí (không gồm lãi vay)"
          value={f.fixed}
          onChange={(v) => set({ fixed: v })}
        />
        <MoneyInput label="Chi phí lãi vay" value={f.interest} onChange={(v) => set({ interest: v })} />
        <TextInput
          label="Thuế suất thuế TNDN · %"
          inputMode="decimal"
          value={f.tax}
          onChange={(e) => set({ tax: e.target.value })}
          hint="Phổ thông 20%; doanh nghiệp doanh thu năm ≤ 3 tỷ: 15%, trên 3 đến 50 tỷ: 17%"
        />
        <MoneyInput label="Tổng tài sản" value={f.assets} onChange={(v) => set({ assets: v })} />
        <MoneyInput label="Vốn chủ sở hữu" value={f.equity} onChange={(v) => set({ equity: v })} />
        <details className="tool-more">
          <summary>Hòa vốn theo sản lượng</summary>
          <MoneyInput label="Giá bán đơn vị" value={f.price} onChange={(v) => set({ price: v })} />
          <MoneyInput
            label="Biến phí đơn vị"
            value={f.unitVariable}
            onChange={(v) => set({ unitVariable: v })}
          />
        </details>
      </Card>
      <div className="stack">
        <Card
          title="Đòn bẩy"
          subtitle="DOL = Số dư đảm phí / EBIT · DFL = EBIT / (EBIT − Lãi vay) · DTL = DOL × DFL"
        >
          {!lev ? (
            <p className="muted">Nhập doanh thu, biến phí và định phí.</p>
          ) : lev.value === null ? (
            <Problem>{lev.error}</Problem>
          ) : (
            <div className="kv">
              <Result
                label="Số dư đảm phí"
                value={vnd(lev.value.contributionMargin)}
                note={cmRatio ? `Tỷ lệ ${formatPercent(cmRatio)}` : undefined}
              />
              <Result label="EBIT (lợi nhuận trước lãi vay và thuế)" value={vnd(lev.value.ebit)} />
              <Result
                label="Đòn bẩy kinh doanh (DOL)"
                value={ratio(lev.value.dol)}
                note={
                  lev.value.dol
                    ? `Doanh thu thay đổi 1% → EBIT thay đổi ${formatNumber(D(lev.value.dol), 2)}%`
                    : 'EBIT bằng 0: không xác định'
                }
              />
              <Result
                label="Đòn bẩy tài chính (DFL)"
                value={ratio(lev.value.dfl)}
                note={
                  lev.value.dfl
                    ? `EBIT thay đổi 1% → lợi nhuận cho chủ sở hữu thay đổi ${formatNumber(D(lev.value.dfl), 2)}%`
                    : 'Lợi nhuận trước thuế bằng 0: không xác định'
                }
              />
              <Result
                label="Đòn bẩy tổng hợp (DTL)"
                value={ratio(lev.value.dtl)}
                note={
                  lev.value.dtl
                    ? `Doanh thu thay đổi 1% → lợi nhuận cho chủ sở hữu thay đổi ${formatNumber(D(lev.value.dtl), 2)}%`
                    : undefined
                }
              />
              {cmRatio && D(cmRatio).gt(0) && (
                <Result
                  label="Doanh thu hòa vốn"
                  value={vnd(D(money(f.fixed)).div(cmRatio).toDecimalPlaces(0).toFixed())}
                  note="Định phí / tỷ lệ số dư đảm phí"
                />
              )}
              {be?.value && (
                <Result
                  label="Sản lượng hòa vốn"
                  value={`${formatNumber(D(be.value.units), 2)} sản phẩm`}
                  note={`Doanh thu hòa vốn ${vnd(D(be.value.revenue).toDecimalPlaces(0).toFixed())}`}
                />
              )}
              {be?.error && <Problem>{be.error}</Problem>}
            </div>
          )}
        </Card>
        <Card
          title="Cơ cấu vốn và hiệu quả"
          subtitle="DuPont và hiệu ứng đòn bẩy tài chính (Modigliani–Miller mở rộng)"
        >
          {!balance ? (
            <p className="muted">Nhập thêm tổng tài sản và vốn chủ sở hữu.</p>
          ) : balance.value === null ? (
            <Problem>{balance.error}</Problem>
          ) : (
            <div className="kv">
              <Result
                label="Hệ số nợ (Nợ phải trả / Tổng tài sản)"
                value={percent(balance.value.structure.debtRatio)}
              />
              <Result label="Nợ / Vốn chủ sở hữu (LEV)" value={ratio(balance.value.structure.debtToEquity)} />
              <Result
                label="Hệ số nhân vốn chủ (Tổng tài sản / Vốn chủ)"
                value={ratio(balance.value.structure.equityMultiplier)}
              />
              <Result label="Khả năng thanh toán lãi vay (EBIT / Lãi vay)" value={ratio(balance.value.tie)} />
              <Result
                label="Lợi nhuận sau thuế"
                value={vnd(D(balance.value.netIncome).toDecimalPlaces(0).toFixed())}
                note="(EBIT − Lãi vay) × (1 − thuế suất)"
              />
              <Result label="ROS (LNST / Doanh thu)" value={percent(balance.value.dupont.ros)} />
              <Result label="Vòng quay tổng tài sản" value={ratio(balance.value.dupont.assetTurnover)} />
              <Result label="ROA (LNST / Tổng tài sản)" value={percent(balance.value.dupont.roa)} />
              <Result label="ROE = ROS × Vòng quay × Hệ số nhân" value={percent(balance.value.dupont.roe)} />
              <Result
                label="ROA trước lãi vay, sau thuế: EBIT(1 − T) / Tổng tài sản"
                value={percent(balance.value.mm.roa)}
              />
              <Result
                label="Chi phí nợ sau thuế: Rd(1 − T)"
                value={percent(balance.value.mm.afterTaxCostOfDebt)}
                note={`Rd = Lãi vay / Nợ = ${formatPercent(balance.value.mm.costOfDebt)}`}
              />
              <Result
                label="ROE = (1 + LEV) × ROA − LEV × Rd(1 − T)"
                value={percent(balance.value.mm.roe)}
                note={
                  balance.value.mm.favourable
                    ? `Đòn bẩy có lợi: ROA lớn hơn chi phí nợ sau thuế, nợ làm ROE tăng thêm ${formatPercent(balance.value.mm.leverageContribution)}`
                    : `Đòn bẩy bất lợi: chi phí nợ sau thuế lớn hơn ROA, nợ làm ROE giảm ${formatPercent(D(balance.value.mm.leverageContribution).abs())}`
                }
              />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ───────── 3 · Lãi suất và chiết khấu thương phiếu ─────────
function InterestTool() {
  const [f, setF] = useState({ principal: '', rate: '', years: '', perYear: '1' });
  const [b, setB] = useState({
    face: '',
    rate: '',
    from: '',
    to: '',
    endorsement: '',
    commission: '',
    other: '',
    basis: '365',
  });
  const r = pct(f.rate);
  const ok = money(f.principal) !== '' && r !== null && Number(f.years.replace(',', '.')) > 0;
  const years = Number(f.years.replace(',', '.'));
  const m = Number(f.perYear);
  const br = pct(b.rate);
  const bill =
    money(b.face) !== '' && br !== null && b.from && b.to
      ? attempt(() => {
          const days = daysBetween(b.from, b.to);
          const basis = Number(b.basis) as 365 | 360;
          const base = { face: money(b.face), annualRate: String(br), days, basis };
          return {
            days,
            commercial: commercialDiscount(base),
            rational: rationalDiscount(base),
            agio: agio({
              ...base,
              endorsementRate: String(pct(b.endorsement) ?? 0),
              commissionRate: String(pct(b.commission) ?? 0),
              otherFees: money(b.other) || '0',
            }),
          };
        })
      : null;
  return (
    <div className="tool-grid">
      <div className="stack">
        <Card title="Lãi đơn và lãi kép">
          <MoneyInput
            label="Số tiền gốc"
            value={f.principal}
            onChange={(v) => setF({ ...f, principal: v })}
          />
          <div className="grid grid-2" style={{ gap: 12 }}>
            <TextInput
              label="Lãi suất · %/năm"
              inputMode="decimal"
              value={f.rate}
              onChange={(e) => setF({ ...f, rate: e.target.value })}
            />
            <TextInput
              label="Thời gian · năm"
              inputMode="decimal"
              value={f.years}
              onChange={(e) => setF({ ...f, years: e.target.value })}
              hint="Ví dụ 2,5 = 2 năm 6 tháng"
            />
          </div>
          <SelectInput
            label="Ghép lãi (lãi kép)"
            value={f.perYear}
            onChange={(v) => setF({ ...f, perYear: v })}
            options={[
              { value: '1', label: 'Mỗi năm' },
              { value: '2', label: 'Mỗi 6 tháng' },
              { value: '4', label: 'Mỗi quý' },
              { value: '12', label: 'Mỗi tháng' },
            ]}
          />
          {ok && (
            <div className="kv mt-8">
              <Result
                label="Lãi đơn: V₀ × (1 + n × i)"
                value={vnd(
                  simpleFutureValue(money(f.principal), String(r), years).toDecimalPlaces(0).toFixed(),
                )}
              />
              <Result
                label={`Lãi kép: V₀ × (1 + i/m)^(n × m)`}
                value={vnd(
                  compoundFutureValue(money(f.principal), D(String(r)).div(m), D(years).times(m))
                    .toDecimalPlaces(0)
                    .toFixed(),
                )}
              />
              <Result
                label="Lãi suất thực (hiệu dụng) / năm"
                value={formatPercent(effectiveAnnualRate(String(r), m).toFixed(), 3)}
              />
            </div>
          )}
        </Card>
      </div>
      <Card
        title="Chiết khấu thương phiếu"
        subtitle="Phí chiết khấu = Mệnh giá × số ngày × lãi suất / số ngày quy ước"
      >
        <MoneyInput label="Mệnh giá thương phiếu" value={b.face} onChange={(v) => setB({ ...b, face: v })} />
        <TextInput
          label="Lãi suất chiết khấu · %/năm"
          inputMode="decimal"
          value={b.rate}
          onChange={(e) => setB({ ...b, rate: e.target.value })}
        />
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Ngày chiết khấu"
            type="date"
            value={b.from}
            onChange={(e) => setB({ ...b, from: e.target.value })}
          />
          <TextInput
            label="Ngày đáo hạn"
            type="date"
            value={b.to}
            onChange={(e) => setB({ ...b, to: e.target.value })}
          />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Hoa hồng ký hậu · %/năm"
            inputMode="decimal"
            value={b.endorsement}
            onChange={(e) => setB({ ...b, endorsement: e.target.value })}
          />
          <TextInput
            label="Hoa hồng chung · % mệnh giá"
            inputMode="decimal"
            value={b.commission}
            onChange={(e) => setB({ ...b, commission: e.target.value })}
          />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <MoneyInput label="Phí khác" value={b.other} onChange={(v) => setB({ ...b, other: v })} />
          <SelectInput
            label="Số ngày quy ước / năm"
            value={b.basis}
            onChange={(v) => setB({ ...b, basis: v })}
            options={[
              { value: '365', label: '365 ngày (Việt Nam)' },
              { value: '360', label: '360 ngày (quốc tế)' },
            ]}
          />
        </div>
        {bill?.error && <Problem>{bill.error}</Problem>}
        {bill?.value && (
          <div className="kv mt-8">
            <Result label="Số ngày chiết khấu" value={`${bill.value.days} ngày`} />
            <Result
              label="Phí chiết khấu thương mại (e)"
              value={vnd(D(bill.value.commercial.fee).toDecimalPlaces(0).toFixed())}
            />
            <Result
              label="Hiện giá theo chiết khấu thương mại"
              value={vnd(D(bill.value.commercial.proceeds).toDecimalPlaces(0).toFixed())}
              note={`Lãi suất chiết khấu hiệu dụng ${formatPercent(bill.value.commercial.effectiveRate, 3)}/năm`}
            />
            <Result
              label="Hiện giá theo chiết khấu hợp lý"
              value={vnd(D(bill.value.rational.proceeds).toDecimalPlaces(0).toFixed())}
              note={`Phí ${vnd(D(bill.value.rational.fee).toDecimalPlaces(0).toFixed())}`}
            />
            <Result
              label="AGIO (phí + hoa hồng + phí khác)"
              value={vnd(D(bill.value.agio.agio).toDecimalPlaces(0).toFixed())}
            />
            <Result
              label="Số tiền thực nhận"
              value={vnd(D(bill.value.agio.proceeds).toDecimalPlaces(0).toFixed())}
            />
            <Result
              label="Lãi suất chi phí chiết khấu (AGIO / mệnh giá)"
              value={formatPercent(bill.value.agio.costRate, 3)}
            />
            <Result
              label="Lãi suất chiết khấu thực tế (AGIO / số tiền thực nhận)"
              value={formatPercent(bill.value.agio.actualRate, 3)}
            />
          </div>
        )}
      </Card>
    </div>
  );
}

// ───────── 4 · Chuỗi tiền tệ và chi phí vốn ─────────
function AnnuityTool() {
  const [a, setA] = useState({ payment: '', rate: '', periods: '', due: false, pv: '' });
  const [w, setW] = useState({ equity: '', debt: '', re: '', rf: '', beta: '', rm: '', rd: '', tax: '20' });
  const ar = pct(a.rate);
  const n = Number(a.periods);
  const okA = ar !== null && n > 0;
  const capm =
    pct(w.rf) !== null && w.beta && pct(w.rm) !== null
      ? capmCostOfEquity(String(pct(w.rf)), w.beta.replace(',', '.'), String(pct(w.rm)))
      : null;
  const re = pct(w.re) ?? (capm ? capm.toNumber() : null);
  const ww =
    money(w.equity) !== '' && money(w.debt) !== '' && re !== null && pct(w.rd) !== null && pct(w.tax) !== null
      ? attempt(() =>
          wacc({
            equity: money(w.equity),
            debt: money(w.debt),
            costOfEquity: String(re),
            costOfDebt: String(pct(w.rd)),
            taxRate: String(pct(w.tax)),
          }),
        )
      : null;
  return (
    <div className="tool-grid">
      <Card title="Chuỗi tiền tệ đều" subtitle="Hiện giá, giá trị tương lai và kỳ khoản">
        <MoneyInput
          label="Số tiền mỗi kỳ (kỳ khoản)"
          value={a.payment}
          onChange={(v) => setA({ ...a, payment: v })}
        />
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Lãi suất mỗi kỳ · %"
            inputMode="decimal"
            value={a.rate}
            onChange={(e) => setA({ ...a, rate: e.target.value })}
          />
          <TextInput
            label="Số kỳ"
            inputMode="numeric"
            value={a.periods}
            onChange={(e) => setA({ ...a, periods: e.target.value.replace(/[^\d]/g, '') })}
          />
        </div>
        <label className="row" style={{ gap: 8, margin: '4px 0 12px' }}>
          <input type="checkbox" checked={a.due} onChange={(e) => setA({ ...a, due: e.target.checked })} />
          <span>Phát sinh đầu kỳ</span>
        </label>
        <MoneyInput
          label="Hoặc: số tiền hiện tại cần trả dần (tìm kỳ khoản)"
          value={a.pv}
          onChange={(v) => setA({ ...a, pv: v })}
        />
        {okA && (
          <div className="kv mt-8">
            {money(a.payment) !== '' && (
              <>
                <Result
                  label="Hiện giá của chuỗi"
                  value={vnd(
                    annuityPresentValue(money(a.payment), String(ar), n, a.due).toDecimalPlaces(0).toFixed(),
                  )}
                />
                <Result
                  label="Giá trị tương lai của chuỗi"
                  value={vnd(
                    annuityFutureValue(money(a.payment), String(ar), n, a.due).toDecimalPlaces(0).toFixed(),
                  )}
                />
              </>
            )}
            {money(a.pv) !== '' && (
              <Result
                label="Kỳ khoản trả đều (PMT)"
                value={vnd(
                  PMT(String(ar), n, money(a.pv), 0, a.due ? 1 : 0)
                    .neg()
                    .toDecimalPlaces(0)
                    .toFixed(),
                )}
              />
            )}
          </div>
        )}
      </Card>
      <Card title="Chi phí sử dụng vốn bình quân (WACC)" subtitle="WACC = wₑ × rₑ + w_d × r_d × (1 − t)">
        <div className="grid grid-2" style={{ gap: 12 }}>
          <MoneyInput label="Vốn chủ sở hữu" value={w.equity} onChange={(v) => setW({ ...w, equity: v })} />
          <MoneyInput label="Nợ vay" value={w.debt} onChange={(v) => setW({ ...w, debt: v })} />
        </div>
        <TextInput
          label="Chi phí vốn chủ rₑ · %"
          inputMode="decimal"
          value={w.re}
          onChange={(e) => setW({ ...w, re: e.target.value })}
          hint="Bỏ trống để tính theo CAPM bên dưới"
        />
        <div className="grid grid-3" style={{ gap: 12 }}>
          <TextInput
            label="Lãi suất phi rủi ro · %"
            inputMode="decimal"
            value={w.rf}
            onChange={(e) => setW({ ...w, rf: e.target.value })}
          />
          <TextInput
            label="Beta (β)"
            inputMode="decimal"
            value={w.beta}
            onChange={(e) => setW({ ...w, beta: e.target.value })}
          />
          <TextInput
            label="Lợi suất thị trường · %"
            inputMode="decimal"
            value={w.rm}
            onChange={(e) => setW({ ...w, rm: e.target.value })}
          />
        </div>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <TextInput
            label="Lãi suất vay r_d · %"
            inputMode="decimal"
            value={w.rd}
            onChange={(e) => setW({ ...w, rd: e.target.value })}
          />
          <TextInput
            label="Thuế suất TNDN · %"
            inputMode="decimal"
            value={w.tax}
            onChange={(e) => setW({ ...w, tax: e.target.value })}
          />
        </div>
        <div className="kv mt-8">
          {capm && pct(w.re) === null && (
            <Result label="rₑ theo CAPM = r_f + β(r_m − r_f)" value={formatPercent(capm.toFixed(), 2)} />
          )}
          {ww?.error && <Problem>{ww.error}</Problem>}
          {ww?.value && (
            <>
              <Result
                label="Tỷ trọng vốn chủ / nợ"
                value={`${formatPercent(ww.value.weightEquity, 1)} / ${formatPercent(ww.value.weightDebt, 1)}`}
              />
              <Result label="Chi phí nợ sau thuế" value={formatPercent(ww.value.afterTaxCostOfDebt, 2)} />
              <Result
                label="WACC"
                value={formatPercent(ww.value.wacc, 2)}
                note="Dùng làm suất chiết khấu khi thẩm định dự án có cùng mức rủi ro"
              />
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

// ───────── 5 · Khấu hao tài sản cố định ─────────
function DepreciationTool() {
  const [f, setF] = useState({
    cost: '',
    years: '5',
    method: 'STRAIGHT_LINE' as DepreciationMethod,
    units: '',
  });
  const years = Number(f.years);
  const units = f.units
    .split(/[;\n]+/)
    .map((u) => u.replace(/[^\d]/g, ''))
    .filter(Boolean);
  const ready = money(f.cost) !== '' && (f.method === 'UNITS' ? units.length > 0 : years > 0);
  const r = ready
    ? attempt(() =>
        depreciationSchedule({
          cost: money(f.cost),
          years,
          method: f.method,
          ...(f.method === 'UNITS' ? { unitsPerYear: units } : {}),
        }),
      )
    : null;
  return (
    <div className="tool-grid">
      <Card title="Tài sản cố định" subtitle="Theo Thông tư 45/2013/TT-BTC về trích khấu hao tài sản cố định">
        <MoneyInput label="Nguyên giá" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
        <SelectInput
          label="Phương pháp khấu hao"
          value={f.method}
          onChange={(v) => setF({ ...f, method: v as DepreciationMethod })}
          options={[
            { value: 'STRAIGHT_LINE', label: 'Đường thẳng' },
            { value: 'DECLINING', label: 'Số dư giảm dần có điều chỉnh' },
            { value: 'UNITS', label: 'Theo số lượng, khối lượng sản phẩm' },
          ]}
        />
        {f.method === 'UNITS' ? (
          <TextInput
            label="Sản lượng dự kiến từng năm"
            value={f.units}
            onChange={(e) => setF({ ...f, units: e.target.value })}
            placeholder="1000; 2000; 3000"
            hint="Ngăn cách các năm bằng dấu chấm phẩy"
          />
        ) : (
          <TextInput
            label="Thời gian trích khấu hao · năm"
            inputMode="numeric"
            value={f.years}
            onChange={(e) => setF({ ...f, years: e.target.value.replace(/[^\d]/g, '') })}
            hint={
              f.method === 'DECLINING' && years > 0
                ? `Hệ số điều chỉnh ${formatNumber(decliningCoefficient(years), 1)} · tỷ lệ khấu hao nhanh ${formatPercent(D(1).div(years).times(decliningCoefficient(years)).toFixed(), 2)}/năm`
                : undefined
            }
          />
        )}
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          Số dư giảm dần: khấu hao năm = giá trị còn lại × tỷ lệ khấu hao nhanh; khi mức này thấp hơn giá trị
          còn lại chia số năm còn lại thì chuyển sang chia đều cho các năm còn lại.
        </p>
      </Card>
      <Card title="Lịch khấu hao" subtitle="Đơn vị: đồng · năm cuối trích nốt phần còn lại">
        {!r ? (
          <p className="muted">Nhập nguyên giá và thời gian trích khấu hao.</p>
        ) : r.value === null ? (
          <Problem>{r.error}</Problem>
        ) : (
          <div className="table-wrap">
            <table className="table report-table tool-table">
              <thead>
                <tr>
                  <th scope="col">Năm</th>
                  <th scope="col" className="right">
                    Giá trị còn lại đầu năm
                  </th>
                  <th scope="col" className="right">
                    Mức khấu hao
                  </th>
                  <th scope="col" className="right">
                    Khấu hao lũy kế
                  </th>
                  <th scope="col" className="right">
                    Giá trị còn lại cuối năm
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.value.map((x) => (
                  <tr key={x.year}>
                    <th scope="row">{x.year}</th>
                    <td className="right num">{formatNumber(D(x.opening))}</td>
                    <td className="right num">{formatNumber(D(x.depreciation))}</td>
                    <td className="right num">{formatNumber(D(x.accumulated))}</td>
                    <td className="right num">{formatNumber(D(x.closing))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const TOOLS = [
  { key: 'loan', label: 'Vay vốn' },
  { key: 'leverage', label: 'Đòn bẩy & chỉ số' },
  { key: 'interest', label: 'Lãi suất & chiết khấu' },
  { key: 'annuity', label: 'Chuỗi tiền tệ & WACC' },
  { key: 'depreciation', label: 'Khấu hao TSCĐ' },
] as const;

/** Công cụ tính toán tài chính: vay vốn, đòn bẩy, lãi suất, chiết khấu, chuỗi tiền tệ, WACC. */
export function FinanceToolsPage() {
  const [tool, setTool] = useState<(typeof TOOLS)[number]['key']>('loan');
  const period = usePeriodLabel();
  return (
    <div className="page">
      <PageHeader
        eyebrow="Tài chính"
        title="Công cụ tính toán"
        subtitle="Vay vốn, đòn bẩy, lãi suất, chiết khấu, chuỗi tiền tệ, chi phí vốn và khấu hao theo chuẩn tài chính – kế toán."
        period={period}
      />
      <ModuleTabs tabs={FINANCE_TABS} current="/finance-tools" />
      <div className="seg mb-16" role="tablist" aria-label="Công cụ">
        {TOOLS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tool === t.key}
            className={tool === t.key ? 'on' : undefined}
            onClick={() => setTool(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'loan' && <LoanTool />}
      {tool === 'leverage' && <LeverageTool />}
      {tool === 'interest' && <InterestTool />}
      {tool === 'annuity' && <AnnuityTool />}
      {tool === 'depreciation' && <DepreciationTool />}
      <p className="small muted mt-16" style={{ lineHeight: 1.6 }}>
        Kết quả tính chính xác theo số thập phân; tiền làm tròn đến đồng. Lãi theo ngày thực tế tính trên 365
        ngày theo Thông tư 14/2017/TT-NHNN; lãi suất quá hạn không vượt 150% lãi suất trong hạn.
      </p>
      <PageFoot />
    </div>
  );
}
