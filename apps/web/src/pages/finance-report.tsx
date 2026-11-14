import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Calculator, FileSpreadsheet, Inbox } from 'lucide-react';
import { formatCompactVnd, formatNumber, formatPercent, formatVnd, D } from '@argolet/core';
import type { OpResult } from '@argolet/client';
import { useBackend, useQuery } from '../api/hooks';
import {
  Button,
  ErrorNote,
  KpiRow,
  PageHeader,
  PageLoading,
  downloadBase64,
  useToast,
} from '../ui/components';
import { ModuleTabs } from './g1';
import { PageFoot, usePeriodLabel } from './overview';

export const FINANCE_TABS = [
  { to: '/finance-report', label: 'Báo cáo tài chính' },
  { to: '/finance-books', label: 'Sổ sách & chỉ số' },
  { to: '/finance', label: 'Thẩm định dự án' },
  { to: '/scenarios', label: 'So sánh kịch bản' },
  { to: '/finance-tools', label: 'Công cụ tính toán' },
];

const RANGES = [
  { value: '3', label: '3 tháng' },
  { value: '6', label: '6 tháng' },
  { value: '12', label: '12 tháng' },
];

/** Thousands-separated đồng; a zero is shown as a dash so the figures that exist stand out. */
const money = (v: string) => formatNumber(D(v));
const shortMonth = (label: string) => label.replace('Tháng ', 'T').replace(/\/20(\d\d)$/, '/$1');

interface Line {
  key: string;
  label: string;
  values: string[];
  strong?: boolean | undefined;
  sub?: boolean | undefined;
}

/** A small segmented control (range, view). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Change against the previous month, as the note under a headline figure. */
function Delta({
  current,
  previous,
  previousLabel,
  costLike,
}: {
  current: string;
  previous?: string | undefined;
  previousLabel: string;
  /** For costs a rise is not good news: the colour is inverted. */
  costLike?: boolean;
}) {
  if (previous === undefined || D(previous).isZero()) return null;
  const ch = D(current).minus(previous).div(D(previous).abs());
  const up = ch.gte(0);
  const good = costLike ? !up : up;
  return (
    <span className={`delta ${good ? 'up' : 'down'}`}>
      {up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
      {formatPercent(ch.abs(), 1)} so với {previousLabel}
    </span>
  );
}

/** Net revenue and costs per month as paired columns, sized for a narrow panel. */
function MonthBars({ months }: { months: { label: string; revenue: string; costs: string }[] }) {
  const max = months.reduce((m, x) => {
    const top = D(x.revenue).gt(x.costs) ? D(x.revenue) : D(x.costs);
    return top.gt(m) ? top : m;
  }, D(0));
  const h = (v: string) =>
    max.gt(0) && D(v).gt(0) ? D(v).div(max).times(100).toDecimalPlaces(1).toNumber() : 0;
  return (
    <div>
      <div className="mbars" role="img" aria-label="Doanh thu thuần và chi phí theo tháng">
        {months.map((m) => (
          <div
            className="mbars-col"
            key={m.label}
            title={`${m.label}: doanh thu thuần ${formatVnd(m.revenue)}, chi phí ${formatVnd(m.costs)}`}
          >
            <div className="mbars-pair">
              <i className="in" style={{ height: `${h(m.revenue)}%` }} />
              <i className="out" style={{ height: `${h(m.costs)}%` }} />
            </div>
            {/* Twelve columns leave no room for the year: the month alone, the full label on hover. */}
            <span>
              {months.length > 6 ? m.label.replace(/^Tháng (\d+)\/\d+$/, 'T$1') : shortMonth(m.label)}
            </span>
          </div>
        ))}
      </div>
      <div className="mbars-legend">
        <span>
          <i className="in" /> Doanh thu thuần
        </span>
        <span>
          <i className="out" /> Chi phí
        </span>
      </div>
      <div className="sr-only">
        <table>
          <caption>Doanh thu thuần và chi phí theo tháng (đồng)</caption>
          <thead>
            <tr>
              <th>Tháng</th>
              <th>Doanh thu thuần</th>
              <th>Chi phí</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.label}>
                <td>{m.label}</td>
                <td>{m.revenue}</td>
                <td>{m.costs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Cost groups as share bars: one hue (magnitude), amount and share written beside each bar. */
function CostBars({
  items,
  total,
}: {
  items: { key: string; label: string; amount: string }[];
  total: string;
}) {
  if (!items.length) return <p className="muted small">Chưa có chi phí có chứng từ.</p>;
  return (
    <ul className="cost-bars">
      {items.map((c) => {
        const share = D(total).gt(0) ? D(c.amount).div(total) : D(0);
        return (
          <li key={c.key}>
            <div className="cost-bars-head">
              <span className="cost-bars-label" title={c.label}>
                {c.label}
              </span>
              <span className="num strong nowrap">{formatCompactVnd(c.amount)}</span>
              <span className="small muted nowrap cost-bars-pct">{formatPercent(share, 1)}</span>
            </div>
            <div className="cost-bars-track" aria-hidden>
              <i style={{ width: `${share.times(100).toDecimalPlaces(1).toNumber()}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The income statement as rows × columns, kept as a table on every width: it scrolls sideways
 * with the indicator column pinned, and opens on the latest columns.
 */
function StatementTable({ columns, lines }: { columns: string[]; lines: Line[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  // The month-by-month view opens on its latest months; the summary starts with the current month.
  useEffect(() => {
    const el = wrap.current;
    if (el) el.scrollLeft = columns.length > 3 ? el.scrollWidth : 0;
  }, [columns.length]);
  return (
    <div className="table-wrap" ref={wrap}>
      <table className="table report-table">
        <thead>
          <tr>
            <th scope="col">Chỉ tiêu</th>
            {columns.map((m) => (
              <th key={m} scope="col" className="right">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.key} className={l.strong ? 'strong-row' : l.sub ? 'sub-row' : undefined}>
              <th scope="row">{l.label}</th>
              {l.values.map((v, i) => (
                <td key={columns[i]} className="right num">
                  {money(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Report = OpResult<'finance.report'>;
type Figures = Pick<
  Report['months'][number],
  | 'grossSales'
  | 'returns'
  | 'netRevenue'
  | 'totalCosts'
  | 'platformFees'
  | 'result'
  | 'vatOut'
  | 'vatIn'
  | 'costs'
>;

/** Báo cáo tài chính · one screen: headline figures, income statement, trend and cost structure. */
export function FinanceReportPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { backend } = useBackend();
  const [sp, setSp] = useSearchParams();
  const months = RANGES.some((x) => x.value === sp.get('months')) ? sp.get('months')! : '6';
  const [view, setView] = useState<'summary' | 'months'>('summary');
  const data = useQuery('finance.report', { months }, { keepPrevious: true });
  const [exporting, setExporting] = useState(false);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const r = data.data;
  const t = r.totals;
  const cur = r.months.at(-1)!;
  const prev = r.months.at(-2);
  const prevLabel = prev ? shortMonth(prev.label) : 'tháng trước';
  const groups = Object.keys(r.costCaptions) as (keyof typeof r.costCaptions)[];
  const empty = r.sourceCount === 0;

  // Rows of the statement; each row reads its figure from a month or from the range totals.
  const rows: {
    key: string;
    label: string;
    pick: (m: Figures) => string;
    strong?: boolean;
    sub?: boolean;
  }[] = [
    { key: 'gross', label: '1. Doanh thu bán hàng', pick: (m) => m.grossSales },
    { key: 'returns', label: '2. Hoàn tiền, chiết khấu', pick: (m) => m.returns },
    { key: 'net', label: '3. Doanh thu thuần', pick: (m) => m.netRevenue, strong: true },
    { key: 'costs', label: '4. Chi phí theo chứng từ', pick: (m) => m.totalCosts, strong: true },
    ...groups
      .filter((k) => !D(t.costs[k]).isZero())
      .map((k) => ({ key: `c-${k}`, label: r.costCaptions[k], pick: (m: Figures) => m.costs[k], sub: true })),
    ...(D(t.platformFees).isZero()
      ? []
      : [{ key: 'fees', label: 'Phí nền tảng bán hàng', pick: (m: Figures) => m.platformFees, sub: true }]),
    { key: 'result', label: '5. Chênh lệch thu chi', pick: (m) => m.result, strong: true },
    // VAT printed on confirmed e-invoices, when there is any in the range.
    ...(D(t.vatOut).isZero() && D(t.vatIn).isZero()
      ? []
      : [
          {
            key: 'vatOut',
            label: 'Thuế GTGT đầu ra trên hóa đơn',
            pick: (m: Figures) => m.vatOut,
            sub: true,
          },
          { key: 'vatIn', label: 'Thuế GTGT đầu vào trên hóa đơn', pick: (m: Figures) => m.vatIn, sub: true },
        ]),
  ];
  const columns =
    view === 'summary'
      ? [shortMonth(cur.label), prevLabel, `Cộng ${months} tháng`]
      : [...r.months.map((m) => shortMonth(m.label)), 'Cộng'];
  const lines: Line[] = rows.map((row) => ({
    key: row.key,
    label: row.label,
    strong: row.strong,
    sub: row.sub,
    values:
      view === 'summary'
        ? [row.pick(cur), prev ? row.pick(prev) : '0', row.pick(t)]
        : [...r.months.map((m) => row.pick(m)), row.pick(t)],
  }));
  const costShare = groups
    .map((k): { key: string; label: string; amount: string } => ({
      key: k,
      label: r.costCaptions[k],
      amount: t.costs[k],
    }))
    .concat([{ key: 'fees', label: 'Phí nền tảng bán hàng', amount: t.platformFees }])
    .filter((c) => D(c.amount).gt(0))
    .sort((a, b) => D(b.amount).comparedTo(a.amount));
  const exportReport = async () => {
    setExporting(true);
    try {
      const f = await backend.call('finance.exportReport', { months });
      downloadBase64(f.filename, f.contentBase64, f.mime);
      toast('success', `Đã xuất ${f.filename}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không xuất được báo cáo');
    } finally {
      setExporting(false);
    }
  };
  const setMonths = (v: string) =>
    setSp(
      (p) => {
        const next = new URLSearchParams(p);
        next.set('months', v);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="page">
      <PageHeader
        eyebrow="Tài chính"
        title="Báo cáo tài chính"
        subtitle={`Kết quả kinh doanh, ${r.location}`}
        period={period}
        actions={
          <>
            <Segmented label="Khoảng thời gian" value={months} options={RANGES} onChange={setMonths} />
            {r.appraisalHint && r.canAppraise && (
              <Button
                icon={<Calculator size={18} />}
                title={`${r.appraisalHint.note} Dòng tiền ≈ ${formatNumber(D(r.appraisalHint.annualCashflowMillions))} triệu đ/năm.`}
                onClick={() => navigate(`/finance?new=1&cashflow=${r.appraisalHint!.annualCashflowMillions}`)}
              >
                Thẩm định từ số liệu
              </Button>
            )}
            {r.canExport && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={18} />}
                loading={exporting}
                disabled={empty}
                onClick={() => void exportReport()}
              >
                Xuất Excel
              </Button>
            )}
          </>
        }
      />
      <ModuleTabs tabs={FINANCE_TABS} current="/finance-report" />
      <KpiRow
        items={[
          {
            label: 'Doanh thu thuần',
            value: r.current.netRevenueLabel,
            note: <Delta current={cur.netRevenue} previous={prev?.netRevenue} previousLabel={prevLabel} />,
          },
          {
            label: 'Chi phí',
            value: r.current.totalCostsLabel,
            note: (
              <Delta
                current={cur.totalCosts}
                previous={prev?.totalCosts}
                previousLabel={prevLabel}
                costLike
              />
            ),
          },
          {
            label: 'Chênh lệch thu chi',
            value: r.current.resultLabel,
            note: `Biên lợi nhuận ${r.current.marginLabel}`,
            highlight: true,
          },
          {
            label: 'Tiền thu về',
            value: formatVnd(cur.received),
            note: <Delta current={cur.received} previous={prev?.received} previousLabel={prevLabel} />,
          },
        ]}
      />

      {empty ? (
        <section className="card fin-empty">
          <p className="muted">
            Chưa có chứng từ đã xác nhận trong {r.rangeLabel.toLowerCase()}. Báo cáo được lập từ hóa đơn, sao
            kê và báo cáo bán hàng sau khi bạn kiểm tra và xác nhận.
          </p>
          <Button variant="primary" icon={<Inbox size={18} />} onClick={() => navigate('/capture')}>
            Tiếp nhận chứng từ
          </Button>
        </section>
      ) : (
        <div className="fin-main">
          <section className="card fin-statement">
            <div className="fin-card-head">
              <h2 className="card-title">
                Kết quả kinh doanh <span className="small muted fin-unit">Đơn vị: đồng</span>
              </h2>
              <Segmented
                label="Cách xem"
                value={view}
                options={[
                  { value: 'summary', label: 'Tóm tắt' },
                  { value: 'months', label: 'Theo tháng' },
                ]}
                onChange={setView}
              />
            </div>
            <StatementTable columns={columns} lines={lines} />
          </section>
          <div className="fin-side">
            <section className="card">
              <div className="fin-card-head">
                <h2 className="card-title">Xu hướng {months} tháng</h2>
              </div>
              <MonthBars
                months={r.months.map((m) => ({ label: m.label, revenue: m.netRevenue, costs: m.totalCosts }))}
              />
            </section>
            <section className="card">
              <div className="fin-card-head">
                <h2 className="card-title">Cơ cấu chi phí</h2>
                <span className="small muted num">{formatCompactVnd(t.totalCosts)}</span>
              </div>
              <CostBars items={costShare} total={t.totalCosts} />
            </section>
          </div>
        </div>
      )}
      <PageFoot />
    </div>
  );
}
