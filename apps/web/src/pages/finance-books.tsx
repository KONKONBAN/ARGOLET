import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Settings2 } from 'lucide-react';
import { D, formatNumber, formatPercent, formatVnd } from '@argolet/core';
import type { OpResult } from '@argolet/client';
import { useBackend, useMutation, useQuery } from '../api/hooks';
import {
  Alert,
  Button,
  Card,
  ErrorNote,
  Modal,
  MoneyInput,
  PageHeader,
  PageLoading,
  Pagination,
  SelectInput,
  TextInput,
  downloadBase64,
  useToast,
} from '../ui/components';
import { ModuleTabs } from './g1';
import { FINANCE_TABS, Segmented } from './finance-report';
import { PageFoot, usePeriodLabel } from './overview';

type Books = Extract<OpResult<'ledger.overview'>, { applicable: true }>;
type Ratio = Books['ratios'][number]['items'][number];
type Line = Books['income']['lines'][number];

const RANGES = [
  { value: '3', label: '3 tháng' },
  { value: '6', label: '6 tháng' },
  { value: '12', label: '12 tháng' },
];
const VIEWS = [
  { value: 'ratios', label: 'Chỉ số tài chính' },
  { value: 'income', label: 'Kết quả kinh doanh' },
  { value: 'position', label: 'Tình hình tài chính' },
  { value: 'trial', label: 'Cân đối tài khoản' },
  { value: 'journal', label: 'Nhật ký chung' },
] as const;
type View = (typeof VIEWS)[number]['value'];

const money = (v: string) => (D(v).isZero() ? '–' : formatNumber(D(v)));
export function ratioText(r: { value: string | null; unit: Ratio['unit'] }) {
  if (r.value === null) return '—';
  if (r.unit === 'PERCENT') return formatPercent(r.value, 2);
  if (r.unit === 'DAYS') return `${formatNumber(D(r.value), 1)} ngày`;
  return `${formatNumber(D(r.value), 2)} lần`;
}

/** Sổ sách & chỉ số: the books kept automatically from confirmed documents. */
export function FinanceBooksPage() {
  const [sp, setSp] = useSearchParams();
  const months = RANGES.some((r) => r.value === sp.get('months')) ? sp.get('months')! : '12';
  const view = (VIEWS.find((v) => v.value === sp.get('view'))?.value ?? 'ratios') as View;
  const data = useQuery('ledger.overview', { months }, { keepPrevious: true });
  const { backend } = useBackend();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const period = usePeriodLabel();
  const set = (k: string, v: string) =>
    setSp(
      (p) => {
        const next = new URLSearchParams(p);
        next.set(k, v);
        if (k !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const header = (
    <>
      <PageHeader
        eyebrow="Tài chính"
        title="Sổ sách & chỉ số"
        subtitle="Tự động từ chứng từ đã xác nhận."
        period={period}
      />
      <ModuleTabs tabs={FINANCE_TABS} current="/finance-books" />
    </>
  );
  if (!data.data.applicable)
    return (
      <div className="page">
        {header}
        <Alert tone="info">
          Hộ kinh doanh ghi sổ theo mẫu của Thông tư 152/2025/TT-BTC trong Sổ sách & thuế.
        </Alert>
        <PageFoot />
      </div>
    );
  const b = data.data;
  const exportBooks = async () => {
    setExporting(true);
    try {
      const f = await backend.call('ledger.export', { months });
      downloadBase64(f.filename, f.contentBase64, f.mime);
      toast('success', `Đã xuất ${f.filename}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không xuất được sổ');
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="page books-page">
      <PageHeader
        eyebrow="Tài chính"
        title="Sổ sách & chỉ số"
        subtitle={`${b.rangeLabel} · ${b.location}`}
        period={period}
        actions={
          <>
            <Segmented
              label="Khoảng thời gian"
              value={months}
              options={RANGES}
              onChange={(v) => set('months', v)}
            />
            {b.canEdit && (
              <Button icon={<Settings2 size={18} />} onClick={() => setSettingsOpen(true)}>
                Số dư & kiểm kê
              </Button>
            )}
            {b.canExport && (
              <Button
                variant="primary"
                icon={<FileSpreadsheet size={18} />}
                loading={exporting}
                onClick={() => void exportBooks()}
              >
                Xuất Excel
              </Button>
            )}
          </>
        }
      />
      <ModuleTabs tabs={FINANCE_TABS} current="/finance-books" />
      {(!b.hasOpening || b.warnings.length > 0) && (
        <div className="books-notice">
          <Alert tone="warning">
            {[...(!b.hasOpening ? ['Chưa nhập số dư đầu kỳ.'] : []), ...b.warnings].join(' ')}
          </Alert>
          {b.canEdit && !b.hasOpening && (
            <Button onClick={() => setSettingsOpen(true)}>Nhập số dư đầu kỳ</Button>
          )}
        </div>
      )}
      <div className="mb-16">
        <Segmented label="Báo cáo" value={view} options={[...VIEWS]} onChange={(v) => set('view', v)} />
      </div>
      {view === 'ratios' && <RatiosView b={b} />}
      {view === 'income' && <IncomeView b={b} />}
      {view === 'position' && <PositionView b={b} />}
      {view === 'trial' && <TrialView b={b} />}
      {view === 'journal' && (
        <JournalView
          months={months}
          page={Number(sp.get('page') ?? 1)}
          onPage={(p) => set('page', String(p))}
        />
      )}
      {settingsOpen && <SettingsModal b={b} onClose={() => setSettingsOpen(false)} />}
      <PageFoot />
    </div>
  );
}

function RatiosView({ b }: { b: Books }) {
  return (
    <div className="grid grid-2 books-ratios">
      {b.ratios.map((g) => (
        <Card key={g.key} title={g.label}>
          <div className="kv">
            {g.items.map((r) => (
              <div key={r.key} className="kv-row">
                <span className="k">{r.label}</span>
                <span className="v strong num">{ratioText(r)}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function StatementTable({
  lines,
  columns,
}: {
  lines: { label: string; code?: string; values: string[]; strong?: boolean }[];
  columns: string[];
}) {
  return (
    <div className="table-wrap">
      <table className="table report-table books-table">
        <thead>
          <tr>
            <th scope="col">Chỉ tiêu</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="right">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.code ?? ''}${l.label}`} className={l.strong ? 'strong-row' : undefined}>
              <th scope="row">
                {l.code && <span className="books-code">{l.code}</span>}
                {l.label}
              </th>
              {l.values.map((v, i) => (
                <td key={i} className="right num">
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

function IncomeView({ b }: { b: Books }) {
  const f = b.income.figures;
  return (
    <div className="books-split">
      <Card
        title={
          b.regime === 'TT99'
            ? 'Kết quả hoạt động kinh doanh · B02-DN'
            : 'Kết quả hoạt động kinh doanh · B02-DNN'
        }
      >
        <StatementTable
          columns={['Số tiền (đồng)']}
          lines={b.income.lines.map((l: Line) => ({
            label: l.label,
            code: l.code,
            values: [l.value],
            ...(l.strong ? { strong: true } : {}),
          }))}
        />
      </Card>
      <div className="stack books-side">
        <div className="calc-kpi lead">
          <div className="calc-kpi-label">Lợi nhuận sau thuế</div>
          <div className="calc-kpi-value num">{formatVnd(f.profitAfterTax)}</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi-label">Doanh thu thuần</div>
          <div className="calc-kpi-value num">{formatVnd(f.netRevenue)}</div>
        </div>
        <div className="calc-kpi">
          <div className="calc-kpi-label">Thuế TNDN · {formatPercent(b.citRate, 0)}</div>
          <div className="calc-kpi-value num">{formatVnd(f.cit)}</div>
        </div>
        <Card title="Theo tháng">
          <div className="kv">
            {b.monthly
              .filter((m) => !D(m.netRevenue).isZero() || !D(m.profitAfterTax).isZero())
              .slice(-6)
              .map((m) => (
                <div key={m.periodId} className="kv-row">
                  <span className="k">{m.label}</span>
                  <span className="v strong num">{formatVnd(m.profitAfterTax)}</span>
                </div>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function PositionView({ b }: { b: Books }) {
  const { start, end } = b.balance;
  const rows = (from: number, to: number) =>
    end.lines.slice(from, to).map((l, i) => ({
      label: l.label,
      values: [start.lines[from + i]!.value, l.value],
      ...(l.strong ? { strong: true } : {}),
    }));
  const split = end.lines.findIndex((l) => l.code === 'C');
  return (
    <div className="grid grid-2">
      <Card title="Tài sản" subtitle="Đơn vị: đồng">
        <StatementTable columns={['Đầu kỳ', 'Cuối kỳ']} lines={rows(0, split)} />
      </Card>
      <Card title="Nguồn vốn" subtitle="Đơn vị: đồng">
        <StatementTable columns={['Đầu kỳ', 'Cuối kỳ']} lines={rows(split, end.lines.length)} />
      </Card>
    </div>
  );
}

function TrialView({ b }: { b: Books }) {
  return (
    <Card
      title={b.regime === 'TT99' ? 'Bảng cân đối tài khoản · F01-DN' : 'Bảng cân đối tài khoản · F01-DNN'}
      subtitle="Đơn vị: đồng"
    >
      <div className="table-wrap calc-scroll books-trial">
        <table className="table report-table">
          <thead>
            <tr>
              <th scope="col">Tài khoản</th>
              <th scope="col" className="right">
                Dư Nợ đầu kỳ
              </th>
              <th scope="col" className="right">
                Dư Có đầu kỳ
              </th>
              <th scope="col" className="right">
                Phát sinh Nợ
              </th>
              <th scope="col" className="right">
                Phát sinh Có
              </th>
              <th scope="col" className="right">
                Dư Nợ cuối kỳ
              </th>
              <th scope="col" className="right">
                Dư Có cuối kỳ
              </th>
            </tr>
          </thead>
          <tbody>
            {b.trial.map((r) => (
              <tr key={r.account}>
                <th scope="row">
                  <span className="books-code">{r.account}</span>
                  {r.name}
                </th>
                {[r.openingDebit, r.openingCredit, r.debit, r.credit, r.closingDebit, r.closingCredit].map(
                  (v, i) => (
                    <td key={i} className="right num">
                      {money(v)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function JournalView({
  months,
  page,
  onPage,
}: {
  months: string;
  page: number;
  onPage: (p: number) => void;
}) {
  const data = useQuery('ledger.journal', { months, page, pageSize: 10 }, { keepPrevious: true });
  const d = data.data;
  return (
    <Card title="Sổ Nhật ký chung" subtitle="Đơn vị: đồng">
      {d && (
        <>
          <div className="table-wrap">
            <table className="table books-journal">
              <thead>
                <tr>
                  <th scope="col">Ngày</th>
                  <th scope="col">Chứng từ</th>
                  <th scope="col">Diễn giải</th>
                  <th scope="col">Nợ</th>
                  <th scope="col">Có</th>
                  <th scope="col" className="right">
                    Số tiền
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((e) => {
                  const debit = e.lines.filter((l) => !D(l.debit).isZero());
                  const credit = e.lines.filter((l) => !D(l.credit).isZero());
                  return (
                    <tr key={e.id}>
                      <td className="nowrap">{`${e.date.slice(8, 10)}/${e.date.slice(5, 7)}/${e.date.slice(0, 4)}`}</td>
                      <td className="strong nowrap">{e.ref}</td>
                      <td>{e.description}</td>
                      <td className="num" title={debit.map((l) => l.name).join(', ')}>
                        {[...new Set(debit.map((l) => l.account))].join(', ')}
                      </td>
                      <td className="num" title={credit.map((l) => l.name).join(', ')}>
                        {[...new Set(credit.map((l) => l.account))].join(', ')}
                      </td>
                      <td className="right num">
                        {formatNumber(debit.reduce((t, l) => t.plus(l.debit), D(0)))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={d.page}
            pageCount={d.pageCount}
            total={d.total}
            pageSize={d.pageSize}
            onPage={onPage}
            unit="bút toán"
            busy={data.fetching}
          />
        </>
      )}
    </Card>
  );
}

const DEBIT_SIDE = new Set(['111', '112', '131', '1331', '152', '156', '211']);

function SettingsModal({ b, onClose }: { b: Books; onClose: () => void }) {
  const save = useMutation('ledger.saveSettings', { silent: true });
  const inventory = useQuery('modules.inventory', {});
  const toast = useToast();
  const [start, setStart] = useState(b.settings.openingPeriod ?? b.from);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(b.settings.opening).map(([k, v]) => [k, D(v).abs().toFixed()])),
  );
  const [loss, setLoss] = useState(D(b.settings.opening['4211'] ?? '0').gt(0));
  const [count, setCount] = useState(b.settings.stockCounts[b.to] ?? '');
  const [rate, setRate] = useState(b.settings.citRate ?? '');
  const signed = (code: string) => {
    const v = D(amounts[code] || '0');
    if (code === '4211') return loss ? v : v.neg();
    return DEBIT_SIDE.has(code) ? v : v.neg();
  };
  const diff = b.openingAccounts.reduce((t, a) => t.plus(signed(a.code)), D(0));
  const stockValue = inventory.data?.items.reduce(
    (t, i) => t.plus(String(i.value).replace(/[^\d]/g, '') || '0'),
    D(0),
  );
  return (
    <Modal
      open
      onClose={onClose}
      title="Số dư đầu kỳ & kiểm kê"
      width={720}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            loading={save.loading}
            disabled={!diff.isZero()}
            onClick={async () => {
              try {
                await save.mutate({
                  openingPeriod: start,
                  opening: Object.fromEntries(
                    b.openingAccounts.map((a) => [a.code, signed(a.code).toFixed()]),
                  ),
                  stockCounts: { ...b.settings.stockCounts, [b.to]: count },
                  citRate: rate,
                });
                toast('success', 'Đã lưu số dư đầu kỳ và kiểm kê');
                onClose();
              } catch {
                /* shown below */
              }
            }}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="calc-fields">
        <TextInput
          label="Tháng bắt đầu ghi sổ"
          type="month"
          value={start}
          onChange={(e) => setStart(e.target.value)}
        />
        <SelectInput
          label="Thuế suất TNDN"
          value={rate}
          onChange={setRate}
          options={[
            { value: '', label: `Tự động (${formatPercent(b.citRate, 0)})` },
            { value: '0.2', label: '20%' },
            { value: '0.17', label: '17%' },
            { value: '0.15', label: '15%' },
          ]}
        />
      </div>
      <div className="books-opening">
        {b.openingAccounts.map((a) => (
          <MoneyInput
            key={a.code}
            label={`${a.code} · ${a.name}`}
            value={amounts[a.code] ?? ''}
            onChange={(v) => setAmounts({ ...amounts, [a.code]: v })}
          />
        ))}
        <label className="row calc-check">
          <input type="checkbox" checked={loss} onChange={(e) => setLoss(e.target.checked)} />
          <span>Tài khoản 4211 là lỗ lũy kế</span>
        </label>
      </div>
      <p className={`books-diff${diff.isZero() ? ' ok' : ''}`}>
        {diff.isZero() ? 'Tổng Nợ bằng tổng Có' : `Chênh lệch Nợ − Có: ${formatVnd(diff.toFixed())}`}
      </p>
      <div className="calc-fields mt-16">
        <MoneyInput
          label={`Tồn kho kiểm kê cuối ${b.to.slice(5)}/${b.to.slice(0, 4)}`}
          value={count}
          onChange={setCount}
        />
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <Button disabled={!stockValue} onClick={() => stockValue && setCount(stockValue.toFixed())}>
            Lấy từ Kho & giá thành
          </Button>
        </div>
      </div>
      {save.error && <ErrorNote error={save.error} />}
    </Modal>
  );
}
