import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '../api/hooks';
import { BookOpenCheck, FileSpreadsheet } from 'lucide-react';
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

/** Thuế suất thuế TNDN (Luật Thuế TNDN số 67/2025/QH15). */
const CIT_RATES = [
  { value: '20', label: '20% · phổ thông' },
  { value: '17', label: '17% · doanh thu năm trên 3 đến 50 tỷ' },
  { value: '15', label: '15% · doanh thu năm đến 3 tỷ' },
];

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

/** Headline results, read at a glance above the detail. */
function Figures({
  items,
}: {
  items: { label: string; value: ReactNode; note?: ReactNode | undefined; lead?: boolean }[];
}) {
  return (
    <div className="calc-kpis" style={{ ['--n' as string]: items.length }}>
      {items.map((k) => (
        <div key={k.label} className={`calc-kpi${k.lead ? ' lead' : ''}`}>
          <div className="calc-kpi-label">{k.label}</div>
          <div className="calc-kpi-value num">{k.value}</div>
          {k.note && <div className="calc-kpi-note">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** One calculator: what the person enters on the left, what it means on the right. */
function Calc({
  title,
  subtitle,
  actions,
  inputs,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  inputs: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="calc">
      <Card title={title} subtitle={subtitle} actions={actions} className="calc-in">
        <div className="calc-fields">{inputs}</div>
      </Card>
      <div className="calc-out">{children}</div>
    </div>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <Card className="calc-wait">
      <p className="muted">{children}</p>
    </Card>
  );
}

const round = (v: string | { toFixed: () => string }) =>
  D(typeof v === 'string' ? v : v.toFixed())
    .toDecimalPlaces(0)
    .toFixed();
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** The figures the automatic books give the calculators (null for household businesses). */
function useBooksFigures() {
  const q = useQuery('ledger.overview', { months: '12' });
  return q.data?.applicable ? q.data.calculators : null;
}
const whole = (v: string) => D(v).toDecimalPlaces(0).abs().toFixed();
const pctText = (v: string) => D(v).times(100).toDecimalPlaces(2).toFixed().replace('.', ',');

function PullFromBooks({ onPull }: { onPull: () => void }) {
  return (
    <Button size="sm" icon={<BookOpenCheck size={16} />} onClick={onPull}>
      Lấy từ sổ sách
    </Button>
  );
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
  const cost = r?.value?.cost;
  const first = s?.rows[0];
  return (
    <Calc
      title="Khoản vay"

      inputs={
        <>
          <MoneyInput label="Số tiền vay" value={f.principal} onChange={(v) => set({ principal: v })} />
          <TextInput
            label="Lãi suất · %/năm"
            inputMode="decimal"
            value={f.rate}
            onChange={(e) => set({ rate: e.target.value })}
            placeholder="10"
          />
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
          <div className="wide">
            <SelectInput
              label="Phương thức trả nợ"
              value={f.method}
              onChange={(v) => set({ method: v as RepaymentMethod })}
              options={METHODS}
            />
          </div>
          <TextInput
            label="Ân hạn gốc · tháng"
            inputMode="numeric"
            value={f.grace}
            onChange={(e) => set({ grace: e.target.value.replace(/[^\d]/g, '') })}
          />
          <MoneyInput label="Phí vay" value={f.fees} onChange={(v) => set({ fees: v })} />
          <div className="wide">
            <SelectInput
              label="Cách tính lãi"
              value={f.dayCount}
              onChange={(v) => set({ dayCount: v as 'PERIOD' | 'ACTUAL_365' })}
              options={[
                { value: 'PERIOD', label: 'Theo kỳ hạn trả nợ' },
                { value: 'ACTUAL_365', label: 'Theo số ngày thực tế (365 ngày/năm)' },
              ]}
            />
          </div>
          <TextInput
            label="Ngày giải ngân"
            type="date"
            value={f.startDate}
            onChange={(e) => set({ startDate: e.target.value })}
            hint={
              f.dayCount === 'ACTUAL_365' && !f.startDate ? 'Bắt buộc khi tính theo ngày thực tế' : undefined
            }
          />
          <details className="tool-more">
            <summary>Thuê tài chính</summary>
            <label className="row" style={{ gap: 8, margin: '4px 0 10px' }}>
              <input
                type="checkbox"
                checked={f.inAdvance}
                onChange={(e) => set({ inAdvance: e.target.checked })}
              />
              <span>Trả tiền thuê đầu mỗi kỳ</span>
            </label>
            <MoneyInput
              label="Giá trị còn lại (mua lại)"
              value={f.residual}
              onChange={(v) => set({ residual: v })}
            />
          </details>
        </>
      }
    >
      {!ready ? (
        <Waiting>Nhập số tiền vay, lãi suất và số kỳ để lập lịch trả nợ.</Waiting>
      ) : r?.error ? (
        <Card>
          <Problem>{r.error}</Problem>
        </Card>
      ) : (
        s &&
        first && (
          <>
            <Figures
              items={[
                s.instalment
                  ? {
                      label: 'Trả đều mỗi kỳ',
                      value: vnd(s.instalment),
                      note: `Lãi suất ${formatPercent(s.ratePerPeriod, 4)}/kỳ`,
                      lead: true,
                    }
                  : {
                      label: s.rows.length === 1 ? 'Trả khi đáo hạn' : 'Kỳ trả đầu tiên',
                      value: vnd(first.payment),
                      note: `Lãi suất ${formatPercent(s.ratePerPeriod, 4)}/kỳ`,
                      lead: true,
                    },
                { label: 'Tổng tiền lãi', value: vnd(s.totalInterest) },
                { label: 'Tổng phải trả', value: vnd(s.totalPayment) },
                {
                  label: 'Lãi suất thực / năm',
                  value: cost ? formatPercent(cost.annual) : '—',
                  note: cost ? `Hiệu dụng ${formatPercent(cost.effectiveAnnual)}` : undefined,
                },
              ]}
            />
            <Card
              title="Lịch trả nợ"
              subtitle="Đơn vị: đồng"
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
              <div className="table-wrap calc-scroll">
                <table className="table report-table tool-table">
                  <thead>
                    <tr>
                      <th scope="col">Kỳ</th>
                      {first.date && <th scope="col">Ngày trả</th>}
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
                        {x.date && <td>{dmy(x.date)}</td>}
                        <td className="right num">{formatNumber(D(x.opening))}</td>
                        <td className="right num">{formatNumber(D(x.interest))}</td>
                        <td className="right num">{formatNumber(D(x.principal))}</td>
                        <td className="right num">{formatNumber(D(x.payment))}</td>
                        <td className="right num">{formatNumber(D(x.closing))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Cộng</th>
                      {first.date && <td />}
                      <td />
                      <td className="right num">{formatNumber(D(s.totalInterest))}</td>
                      <td className="right num">{formatNumber(D(s.totalPayment).minus(s.totalInterest))}</td>
                      <td className="right num">{formatNumber(D(s.totalPayment))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        )
      )}
    </Calc>
  );
}

// ───────── 2 · Đòn bẩy và chỉ số tài chính ─────────
function LeverageTool() {
  const [f, setF] = useState({
    revenue: '',
    variable: '',
    fixed: '',
    interest: '',
    preferred: '',
    tax: '20',
    assets: '',
    equity: '',
    price: '',
    unitVariable: '',
  });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const books = useBooksFigures();
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
            preferredDividends: money(f.preferred) || '0',
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
  const L = lev?.value;
  const B = balance?.value;
  const cmRatio = L?.contributionMarginRatio;
  return (
    <Calc
      title="Số liệu kỳ phân tích"
      actions={
        books && (
          <PullFromBooks
            onPull={() =>
              set({
                revenue: whole(books.revenue),
                variable: whole(books.variableCosts),
                fixed: D(books.fixedCosts).isNegative() ? '0' : whole(books.fixedCosts),
                interest: whole(books.interest),
                tax: D(books.taxRate).times(100).toFixed(),
                assets: whole(books.totalAssets),
                equity: whole(books.equity),
                preferred: '',
              })
            }
          />
        )
      }

      inputs={
        <>
          <MoneyInput label="Doanh thu thuần" value={f.revenue} onChange={(v) => set({ revenue: v })} />
          <MoneyInput label="Biến phí" value={f.variable} onChange={(v) => set({ variable: v })} />
          <MoneyInput label="Định phí" value={f.fixed} onChange={(v) => set({ fixed: v })} />
          <MoneyInput label="Chi phí lãi vay" value={f.interest} onChange={(v) => set({ interest: v })} />
          <MoneyInput label="Tổng tài sản" value={f.assets} onChange={(v) => set({ assets: v })} />
          <MoneyInput label="Vốn chủ sở hữu" value={f.equity} onChange={(v) => set({ equity: v })} />
          <SelectInput
            label="Thuế suất TNDN"
            value={f.tax}
            onChange={(v) => set({ tax: v })}
            options={CIT_RATES}
          />
          <MoneyInput label="Cổ tức ưu đãi" value={f.preferred} onChange={(v) => set({ preferred: v })} />
          <details className="tool-more wide">
            <summary>Hòa vốn theo sản lượng</summary>
            <div className="calc-fields">
              <MoneyInput label="Giá bán đơn vị" value={f.price} onChange={(v) => set({ price: v })} />
              <MoneyInput
                label="Biến phí đơn vị"
                value={f.unitVariable}
                onChange={(v) => set({ unitVariable: v })}
              />
            </div>
          </details>
        </>
      }
    >
      {!lev ? (
        <Waiting>
          Nhập doanh thu thuần, biến phí và định phí để tính đòn bẩy; thêm tổng tài sản và vốn chủ để phân
          tích cơ cấu vốn.
        </Waiting>
      ) : lev.error !== null ? (
        <Card>
          <Problem>{lev.error}</Problem>
        </Card>
      ) : (
        L && (
          <>
            <Figures
              items={[
                {
                  label: 'Đòn bẩy kinh doanh (DOL)',
                  value: ratio(L.dol),
                },
                {
                  label: 'Đòn bẩy tài chính (DFL)',
                  value: ratio(L.dfl),
                },
                {
                  label: 'Đòn bẩy tổng hợp (DTL)',
                  value: ratio(L.dtl),

                  lead: true,
                },
                {
                  label: 'ROE',
                  value: B ? percent(B.dupont.roe) : '—',
                },
              ]}
            />
            <Card title="Phân tích chi tiết">
              <div className="calc-cols">
                <div className="kv">
                  <div className="calc-col-title">Kết quả kinh doanh</div>
                  <Result label="Số dư đảm phí" value={vnd(L.contributionMargin)} />
                  {cmRatio && <Result label="Tỷ lệ số dư đảm phí" value={formatPercent(cmRatio)} />}
                  <Result label="Lợi nhuận trước lãi vay và thuế (EBIT)" value={vnd(L.ebit)} />
                  <Result label="Lợi nhuận trước thuế" value={vnd(L.ebt)} />
                  {B && <Result label="Lợi nhuận sau thuế" value={vnd(round(B.netIncome))} />}
                  {cmRatio && D(cmRatio).gt(0) && (
                    <Result label="Doanh thu hòa vốn" value={vnd(round(D(money(f.fixed)).div(cmRatio)))} />
                  )}
                  {be?.value && (
                    <Result
                      label="Sản lượng hòa vốn"
                      value={`${formatNumber(D(be.value.units), 2)} sản phẩm`}
                    />
                  )}
                  {be?.error && <Problem>{be.error}</Problem>}
                </div>
                <div className="kv">
                  <div className="calc-col-title">Cơ cấu vốn và hiệu quả</div>
                  {!balance ? (
                    <p className="small muted">Nhập tổng tài sản và vốn chủ sở hữu.</p>
                  ) : balance.error !== null ? (
                    <Problem>{balance.error}</Problem>
                  ) : (
                    B && (
                      <>
                        <Result label="Hệ số nợ" value={percent(B.structure.debtRatio)} />
                        <Result label="Hệ số nợ trên vốn chủ (LEV)" value={ratio(B.structure.debtToEquity)} />
                        <Result label="Hệ số nhân vốn chủ" value={ratio(B.structure.equityMultiplier)} />
                        <Result label="Khả năng thanh toán lãi vay" value={ratio(B.tie)} />
                        <Result
                          label="Tỷ suất lợi nhuận trên doanh thu (ROS)"
                          value={percent(B.dupont.ros)}
                        />
                        <Result label="Vòng quay tổng tài sản" value={ratio(B.dupont.assetTurnover)} />
                        <Result label="Tỷ suất lợi nhuận trên tài sản (ROA)" value={percent(B.dupont.roa)} />
                        <Result label="ROA trước lãi vay, sau thuế" value={percent(B.mm.roa)} />
                        <Result label="Lãi suất vay bình quân" value={percent(B.mm.costOfDebt)} />
                        <Result label="Chi phí nợ sau thuế" value={percent(B.mm.afterTaxCostOfDebt)} />
                      </>
                    )
                  )}
                </div>
              </div>
              {B && (
                <p className={`calc-callout${B.mm.favourable ? '' : ' warn'}`}>
                  <strong>
                    {B.mm.favourable
                      ? `Vay nợ làm ROE tăng thêm ${formatPercent(B.mm.leverageContribution)}`
                      : `Vay nợ làm ROE giảm ${formatPercent(D(B.mm.leverageContribution).abs())}`}
                  </strong>
                </p>
              )}
            </Card>
          </>
        )
      )}
    </Calc>
  );
}

// ───────── 3 · Lãi đơn và lãi kép ─────────
function InterestTool() {
  const [f, setF] = useState({ principal: '', rate: '', years: '', perYear: '1' });
  const r = pct(f.rate);
  const years = Number(f.years.replace(',', '.'));
  const m = Number(f.perYear);
  const ok = money(f.principal) !== '' && r !== null && years > 0;
  const V0 = money(f.principal);
  const simple = (n: number) => simpleFutureValue(V0, String(r), n);
  const compound = (n: number) => compoundFutureValue(V0, D(String(r)).div(m), D(n).times(m));
  const marks = ok
    ? [
        ...Array.from({ length: Math.min(Math.floor(years), 50) }, (_, i) => i + 1),
        ...(years % 1 ? [years] : []),
      ]
    : [];
  return (
    <Calc
      title="Lãi đơn và lãi kép"

      inputs={
        <>
          <div className="wide">
            <MoneyInput
              label="Số tiền gốc"
              value={f.principal}
              onChange={(v) => setF({ ...f, principal: v })}
            />
          </div>
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
            placeholder="2,5"
          />
          <div className="wide">
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
          </div>
        </>
      }
    >
      {!ok ? (
        <Waiting>Nhập số tiền gốc, lãi suất và thời gian.</Waiting>
      ) : (
        <>
          <Figures
            items={[
              {
                label: 'Giá trị cuối kỳ · lãi đơn',
                value: vnd(round(simple(years))),
                note: `Tiền lãi ${vnd(round(simple(years).minus(V0)))}`,
              },
              {
                label: 'Giá trị cuối kỳ · lãi kép',
                value: vnd(round(compound(years))),
                note: `Tiền lãi ${vnd(round(compound(years).minus(V0)))}`,
                lead: true,
              },
              {
                label: 'Lãi suất hiệu dụng / năm',
                value: formatPercent(effectiveAnnualRate(String(r), m).toFixed(), 3),
              },
            ]}
          />
          <Card title="Giá trị theo thời gian" subtitle="Đơn vị: đồng">
            <div className="table-wrap calc-scroll">
              <table className="table report-table tool-table">
                <thead>
                  <tr>
                    <th scope="col">Năm</th>
                    <th scope="col" className="right">
                      Lãi đơn
                    </th>
                    <th scope="col" className="right">
                      Lãi kép
                    </th>
                    <th scope="col" className="right">
                      Chênh lệch
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {marks.map((n) => (
                    <tr key={n}>
                      <th scope="row">{formatNumber(D(n), n % 1 ? 2 : 0)}</th>
                      <td className="right num">{formatNumber(D(round(simple(n))))}</td>
                      <td className="right num">{formatNumber(D(round(compound(n))))}</td>
                      <td className="right num">
                        {formatNumber(D(round(compound(n))).minus(round(simple(n))))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </Calc>
  );
}

// ───────── 4 · Chiết khấu thương phiếu ─────────
function BillTool() {
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
  const v = bill?.value;
  return (
    <Calc
      title="Thương phiếu đem chiết khấu"

      inputs={
        <>
          <MoneyInput
            label="Mệnh giá thương phiếu"
            value={b.face}
            onChange={(x) => setB({ ...b, face: x })}
          />
          <TextInput
            label="Lãi suất chiết khấu · %/năm"
            inputMode="decimal"
            value={b.rate}
            onChange={(e) => setB({ ...b, rate: e.target.value })}
          />
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
          <TextInput
            label="Hoa hồng ký hậu · %/năm"
            inputMode="decimal"
            value={b.endorsement}
            onChange={(e) => setB({ ...b, endorsement: e.target.value })}
          />
          <TextInput
            label="Hoa hồng chung · %"
            inputMode="decimal"
            value={b.commission}
            onChange={(e) => setB({ ...b, commission: e.target.value })}
          />
          <MoneyInput label="Phí khác" value={b.other} onChange={(x) => setB({ ...b, other: x })} />
          <SelectInput
            label="Số ngày quy ước / năm"
            value={b.basis}
            onChange={(x) => setB({ ...b, basis: x })}
            options={[
              { value: '365', label: '365 ngày' },
              { value: '360', label: '360 ngày' },
            ]}
          />
        </>
      }
    >
      {!bill ? (
        <Waiting>Nhập mệnh giá, lãi suất chiết khấu, ngày chiết khấu và ngày đáo hạn.</Waiting>
      ) : bill.error !== null ? (
        <Card>
          <Problem>{bill.error}</Problem>
        </Card>
      ) : (
        v && (
          <>
            <Figures
              items={[
                {
                  label: 'Số tiền thực nhận',
                  value: vnd(round(v.agio.proceeds)),
                  note: `${v.days} ngày`,
                  lead: true,
                },
                {
                  label: 'Tổng chi phí chiết khấu (AGIO)',
                  value: vnd(round(v.agio.agio)),
                },
                {
                  label: 'Lãi suất chiết khấu thực tế',
                  value: formatPercent(v.agio.actualRate, 3),
                },
              ]}
            />
            <Card title="Chi tiết">
              <div className="calc-cols">
                <div className="kv">
                  <div className="calc-col-title">Cấu thành AGIO</div>
                  <Result label="Phí chiết khấu" value={vnd(round(v.agio.discount))} />
                  <Result label="Hoa hồng ký hậu" value={vnd(round(v.agio.endorsement))} />
                  <Result label="Hoa hồng chung" value={vnd(round(v.agio.commission))} />
                  <Result label="Phí khác" value={vnd(round(v.agio.otherFees))} />
                  <Result label="Cộng AGIO" value={vnd(round(v.agio.agio))} />
                </div>
                <div className="kv">
                  <div className="calc-col-title">Hiện giá và lãi suất</div>
                  <Result
                    label="Hiện giá theo chiết khấu thương mại"
                    value={vnd(round(v.commercial.proceeds))}
                  />
                  <Result label="Hiện giá theo chiết khấu hợp lý" value={vnd(round(v.rational.proceeds))} />
                  <Result label="Phí chiết khấu hợp lý" value={vnd(round(v.rational.fee))} />
                  <Result label="Lãi suất hiệu dụng" value={formatPercent(v.commercial.effectiveRate, 3)} />
                  <Result label="Lãi suất chi phí chiết khấu" value={formatPercent(v.agio.costRate, 3)} />
                </div>
              </div>
            </Card>
          </>
        )
      )}
    </Calc>
  );
}

// ───────── 5 · Chuỗi tiền tệ đều ─────────
function AnnuityTool() {
  const [a, setA] = useState({ payment: '', rate: '', periods: '', due: false, pv: '' });
  const ar = pct(a.rate);
  const n = Number(a.periods);
  const ok = ar !== null && n > 0 && (money(a.payment) !== '' || money(a.pv) !== '');
  const pay = money(a.payment);
  const pmt =
    ok && money(a.pv) !== ''
      ? PMT(String(ar), n, money(a.pv), 0, a.due ? 1 : 0)
          .neg()
          .toDecimalPlaces(0)
          .toFixed()
      : null;
  const flow = pay || pmt;
  const rows =
    ok && flow
      ? Array.from({ length: Math.min(n, 360) }, (_, k) => {
          const t = a.due ? k : k + 1;
          const factor = D(1).plus(String(ar)).pow(-t);
          return { k: k + 1, t, factor, pv: D(flow).times(factor) };
        })
      : [];
  return (
    <Calc
      title="Chuỗi tiền tệ đều"

      inputs={
        <>
          <div className="wide">
            <MoneyInput
              label="Số tiền mỗi kỳ (kỳ khoản)"
              value={a.payment}
              onChange={(v) => setA({ ...a, payment: v })}
            />
          </div>
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
          <label className="row wide calc-check">
            <input type="checkbox" checked={a.due} onChange={(e) => setA({ ...a, due: e.target.checked })} />
            <span>Thanh toán đầu mỗi kỳ</span>
          </label>
          <div className="wide">
            <MoneyInput
              label="Hoặc: số tiền hiện tại cần trả dần"
              value={a.pv}
              onChange={(v) => setA({ ...a, pv: v })}
            />
          </div>
        </>
      }
    >
      {!ok ? (
        <Waiting>Nhập lãi suất, số kỳ và số tiền mỗi kỳ (hoặc số tiền hiện tại cần trả dần).</Waiting>
      ) : (
        <>
          <Figures
            items={[
              {
                label: 'Hiện giá của chuỗi',
                value: pay ? vnd(round(annuityPresentValue(pay, String(ar), n, a.due))) : '—',
              },
              {
                label: 'Giá trị tương lai',
                value: pay ? vnd(round(annuityFutureValue(pay, String(ar), n, a.due))) : '—',
              },
              {
                label: 'Kỳ khoản trả đều (PMT)',
                value: pmt ? vnd(pmt) : '—',

                lead: true,
              },
            ]}
          />
          <Card title="Hiện giá từng kỳ khoản" subtitle="Đơn vị: đồng">
            <div className="table-wrap calc-scroll">
              <table className="table report-table tool-table">
                <thead>
                  <tr>
                    <th scope="col">Kỳ</th>
                    <th scope="col" className="right">
                      Thời điểm t
                    </th>
                    <th scope="col" className="right">
                      Hệ số chiết khấu
                    </th>
                    <th scope="col" className="right">
                      Hiện giá kỳ khoản
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((x) => (
                    <tr key={x.k}>
                      <th scope="row">{x.k}</th>
                      <td className="right num">{x.t}</td>
                      <td className="right num">{formatNumber(x.factor, 6)}</td>
                      <td className="right num">{formatNumber(x.pv.toDecimalPlaces(0))}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length === n && (
                  <tfoot>
                    <tr>
                      <th scope="row">Cộng</th>
                      <td />
                      <td />
                      <td className="right num">
                        {formatNumber(rows.reduce((t, x) => t.plus(x.pv), D(0)).toDecimalPlaces(0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </>
      )}
    </Calc>
  );
}

// ───────── 6 · Chi phí sử dụng vốn bình quân ─────────
function WaccTool() {
  const [w, setW] = useState({ equity: '', debt: '', re: '', rf: '', beta: '', rm: '', rd: '', tax: '20' });
  const books = useBooksFigures();
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
  const v = ww?.value;
  return (
    <Calc
      title="Cơ cấu và chi phí vốn"
      actions={
        books && (
          <PullFromBooks
            onPull={() =>
              setW({
                ...w,
                equity: whole(books.equity),
                debt: whole(books.debt),
                rd: books.costOfDebt ? pctText(books.costOfDebt) : w.rd,
                re: books.costOfEquity ? pctText(books.costOfEquity) : w.re,
                tax: D(books.taxRate).times(100).toFixed(),
              })
            }
          />
        )
      }

      inputs={
        <>
          <MoneyInput label="Vốn chủ sở hữu" value={w.equity} onChange={(x) => setW({ ...w, equity: x })} />
          <MoneyInput label="Nợ vay" value={w.debt} onChange={(x) => setW({ ...w, debt: x })} />
          <TextInput
            label="Lãi suất vay · %"
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
          <div className="wide">
            <TextInput
              label="Chi phí vốn chủ sở hữu · %"
              inputMode="decimal"
              value={w.re}
              onChange={(e) => setW({ ...w, re: e.target.value })}
              hint="Bỏ trống để tính theo CAPM"
            />
          </div>
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
        </>
      }
    >
      {!ww ? (
        <Waiting>
          Nhập vốn chủ, nợ vay, lãi suất vay, thuế suất và chi phí vốn chủ (hoặc các thông số CAPM).
          {capm && ` Chi phí vốn chủ theo CAPM: ${formatPercent(capm.toFixed(), 2)}.`}
        </Waiting>
      ) : ww.error !== null ? (
        <Card>
          <Problem>{ww.error}</Problem>
        </Card>
      ) : (
        v && (
          <>
            <Figures
              items={[
                {
                  label: 'WACC',
                  value: formatPercent(v.wacc, 2),

                  lead: true,
                },
                {
                  label: 'Chi phí vốn chủ sở hữu',
                  value: formatPercent(String(re), 2),
                },
                {
                  label: 'Chi phí nợ sau thuế',
                  value: formatPercent(v.afterTaxCostOfDebt, 2),
                },
              ]}
            />
            <Card title="Cấu thành WACC">
              <div className="table-wrap">
                <table className="table report-table tool-table calc-wacc">
                  <thead>
                    <tr>
                      <th scope="col">Nguồn vốn</th>
                      <th scope="col" className="right">
                        Giá trị
                      </th>
                      <th scope="col" className="right">
                        Tỷ trọng
                      </th>
                      <th scope="col" className="right">
                        Chi phí
                      </th>
                      <th scope="col" className="right">
                        Đóng góp
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Vốn chủ sở hữu</th>
                      <td className="right num">{formatNumber(D(money(w.equity)))}</td>
                      <td className="right num">{formatPercent(v.weightEquity, 2)}</td>
                      <td className="right num">{formatPercent(String(re), 2)}</td>
                      <td className="right num">
                        {formatPercent(D(v.weightEquity).times(String(re)).toFixed(), 2)}
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">Nợ vay (sau thuế)</th>
                      <td className="right num">{formatNumber(D(money(w.debt)))}</td>
                      <td className="right num">{formatPercent(v.weightDebt, 2)}</td>
                      <td className="right num">{formatPercent(v.afterTaxCostOfDebt, 2)}</td>
                      <td className="right num">
                        {formatPercent(D(v.weightDebt).times(v.afterTaxCostOfDebt).toFixed(), 2)}
                      </td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Cộng</th>
                      <td className="right num">{formatNumber(D(money(w.equity)).plus(money(w.debt)))}</td>
                      <td className="right num">{formatPercent('1', 2)}</td>
                      <td />
                      <td className="right num">{formatPercent(v.wacc, 2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          </>
        )
      )}
    </Calc>
  );
}

// ───────── 7 · Khấu hao tài sản cố định ─────────
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
  const rows = r?.value;
  const fastRate =
    f.method === 'DECLINING' && years > 0
      ? D(1).div(years).times(decliningCoefficient(years)).toFixed()
      : null;
  return (
    <Calc
      title="Tài sản cố định"

      inputs={
        <>
          <MoneyInput label="Nguyên giá" value={f.cost} onChange={(v) => setF({ ...f, cost: v })} />
          {f.method === 'UNITS' ? (
            <TextInput
              label="Sản lượng từng năm"
              value={f.units}
              onChange={(e) => setF({ ...f, units: e.target.value })}
              placeholder="1000; 2000; 3000"
            />
          ) : (
            <TextInput
              label="Thời gian trích · năm"
              inputMode="numeric"
              value={f.years}
              onChange={(e) => setF({ ...f, years: e.target.value.replace(/[^\d]/g, '') })}
            />
          )}
          <div className="wide">
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
          </div>
        </>
      }
    >
      {!r ? (
        <Waiting>Nhập nguyên giá và thời gian trích khấu hao.</Waiting>
      ) : r.error !== null ? (
        <Card>
          <Problem>{r.error}</Problem>
        </Card>
      ) : (
        rows &&
        rows[0] && (
          <>
            <Figures
              items={[
                { label: 'Khấu hao năm đầu', value: vnd(rows[0].depreciation), lead: true },
                {
                  label: 'Tỷ lệ khấu hao',
                  value:
                    f.method === 'UNITS'
                      ? 'Theo sản lượng'
                      : formatPercent(fastRate ?? D(1).div(years).toFixed(), 2),
                  note:
                    fastRate !== null
                      ? `Hệ số điều chỉnh ${formatNumber(decliningCoefficient(years), 1)}`
                      : undefined,
                },
                {
                  label: 'Tổng khấu hao',
                  value: vnd(rows[rows.length - 1]!.accumulated),
                },
              ]}
            />
            <Card title="Lịch khấu hao" subtitle="Đơn vị: đồng">
              <div className="table-wrap calc-scroll">
                <table className="table report-table tool-table">
                  <thead>
                    <tr>
                      <th scope="col">Năm</th>
                      <th scope="col" className="right">
                        Còn lại đầu năm
                      </th>
                      <th scope="col" className="right">
                        Mức khấu hao
                      </th>
                      <th scope="col" className="right">
                        Lũy kế
                      </th>
                      <th scope="col" className="right">
                        Còn lại cuối năm
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((x) => (
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
            </Card>
          </>
        )
      )}
    </Calc>
  );
}

const TOOLS = [
  { key: 'loan', label: 'Vay vốn' },
  { key: 'leverage', label: 'Đòn bẩy & chỉ số' },
  { key: 'interest', label: 'Lãi đơn & lãi kép' },
  { key: 'bill', label: 'Chiết khấu thương phiếu' },
  { key: 'annuity', label: 'Chuỗi tiền tệ' },
  { key: 'wacc', label: 'Chi phí vốn WACC' },
  { key: 'depreciation', label: 'Khấu hao TSCĐ' },
] as const;
type ToolKey = (typeof TOOLS)[number]['key'];

/** Công cụ tính toán tài chính: vay vốn, đòn bẩy, lãi suất, chiết khấu, chuỗi tiền tệ, WACC, khấu hao. */
export function FinanceToolsPage() {
  const [sp, setSp] = useSearchParams();
  const asked = sp.get('tool');
  const tool: ToolKey = TOOLS.some((t) => t.key === asked) ? (asked as ToolKey) : 'loan';
  const period = usePeriodLabel();
  return (
    <div className="page tool-page">
      <PageHeader
        eyebrow="Tài chính"
        title="Công cụ tính toán"
        subtitle="Vay vốn, đòn bẩy, lãi suất, chiết khấu, chi phí vốn và khấu hao."
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
            onClick={() => setSp(t.key === 'loan' ? {} : { tool: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'loan' && <LoanTool />}
      {tool === 'leverage' && <LeverageTool />}
      {tool === 'interest' && <InterestTool />}
      {tool === 'bill' && <BillTool />}
      {tool === 'annuity' && <AnnuityTool />}
      {tool === 'wacc' && <WaccTool />}
      {tool === 'depreciation' && <DepreciationTool />}
      <PageFoot />
    </div>
  );
}
