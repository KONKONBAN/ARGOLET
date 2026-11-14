/**
 * Financial report of the last months, built only from what a person confirmed: the records of
 * validated documents (sales, refunds, platform fees, expenses, money received) and the VAT
 * printed on validated e-invoices. Nothing is estimated: a cost without a confirmed document is
 * not in the report, and the report says so. Every figure can be traced to its documents in the
 * Excel export.
 */
import {
  buildXlsx,
  canonicalize,
  columnName,
  D,
  dec,
  formatPercent,
  formatPeriod,
  formatVnd,
  sha256Hex,
  sum,
  XLSX_MIME,
  type CostCategory,
  type XCell,
  type XSheet,
} from '@argolet/core';
import { periodOf } from '../core';
import type { WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { BusinessRecordRow, DocumentRow, TenantRow } from '../types';
import { costCategory } from './books';
import { scoped } from './documents';
import { scopeLabel } from './org';

/** Short captions of the S2c-HKD cost groups (Thông tư 152/2025/TT-BTC), for screens and the report. */
export const COST_SHORT: Record<CostCategory, string> = {
  a: 'Nguyên vật liệu, hàng hóa, nhiên liệu',
  b: 'Tiền lương, tiền công, bảo hiểm',
  c: 'Khấu hao tài sản cố định',
  d: 'Dịch vụ mua ngoài (điện, nước, thuê mặt bằng)',
  dd: 'Lãi vay',
  e: 'Chi phí khác',
};
const CATS = Object.keys(COST_SHORT) as CostCategory[];

export interface MonthFigures {
  periodId: string;
  label: string;
  grossSales: string;
  /** Refunds and merchant-funded discounts given to customers. */
  returns: string;
  netRevenue: string;
  platformFees: string;
  costs: Record<CostCategory, string>;
  totalCosts: string;
  result: string;
  /** VAT printed on validated sales / purchase e-invoices (output / input). */
  vatOut: string;
  vatIn: string;
  /** Money received: bank credits and cash receipts. */
  received: string;
  documents: number;
}

export interface ReportSource {
  record: BusinessRecordRow;
  docCode: string;
  category: CostCategory | null;
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A record counts once a person confirmed it: its document is validated, or it was entered directly. */
export const isConfirmed = (r: BusinessRecordRow, docs: Map<string, DocumentRow>) =>
  !r.documentId || docs.get(r.documentId)?.status === 'VALIDATED';

/**
 * Revenue, costs and result of a set of records — the one definition used by the overview, the
 * decision pack, the finance report and the dashboard projection, so every screen shows the same
 * figures. Records of documents not yet confirmed are left out and reported as pending.
 */
export function periodTotals(records: BusinessRecordRow[], docs: Map<string, DocumentRow>) {
  const confirmed = records.filter((r) => isConfirmed(r, docs));
  const counter = sum(confirmed.filter((r) => r.kind === 'REVENUE').map((r) => r.amount));
  const orders = confirmed.filter((r) => r.kind === 'ORDER');
  const grossOrders = sum(orders.map((r) => r.amount));
  const returns = sum(orders.flatMap((r) => [r.refund || '0', r.discount || '0']));
  const platformFees = sum(orders.map((r) => r.fee || '0'));
  const expenseRows = confirmed.filter((r) => r.kind === 'EXPENSE');
  const expenses = sum(expenseRows.map((r) => r.amount));
  const netRevenue = counter.plus(grossOrders).minus(returns);
  const totalCosts = expenses.plus(platformFees);
  return {
    counter,
    platform: grossOrders.minus(returns),
    grossSales: counter.plus(grossOrders),
    returns,
    netRevenue,
    platformFees,
    expenses,
    expenseCount: expenseRows.length,
    totalCosts,
    result: netRevenue.minus(totalCosts),
    received: sum(confirmed.filter((r) => r.kind === 'BANK_TXN' || r.kind === 'CASH').map((r) => r.amount)),
    /** Sales on documents still awaiting confirmation or reconciliation (not in the figures). */
    pendingSales: sum(
      records
        .filter((r) => !isConfirmed(r, docs) && (r.kind === 'ORDER' || r.kind === 'REVENUE'))
        .map((r) => r.amount),
    ),
  };
}

/** The `count` months ending at `to`, oldest first. */
export function periodsEndingAt(to: string, count: number): string[] {
  const [y, m] = to.split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

export function validPeriod(p: string): boolean {
  return PERIOD.test(p);
}

const zeroCosts = (): Record<CostCategory, string> => ({ a: '0', b: '0', c: '0', d: '0', dd: '0', e: '0' });

/** Pure computation, kept apart from storage so it can be checked line by line. */
export function computeMonths(
  periods: string[],
  records: BusinessRecordRow[],
  docs: Map<string, DocumentRow>,
): { months: MonthFigures[]; sources: ReportSource[] } {
  const sources: ReportSource[] = [];
  const months = periods.map((periodId): MonthFigures => {
    const recs = records.filter((r) => r.periodId === periodId && isConfirmed(r, docs));
    const t = periodTotals(recs, docs);
    const costs = zeroCosts();
    for (const r of recs) {
      const d = r.documentId ? docs.get(r.documentId) : undefined;
      let category: CostCategory | null = null;
      if (r.kind === 'EXPENSE') {
        category = costCategory([r.counterparty, d?.title, r.description].filter(Boolean).join(', '));
        costs[category] = dec(D(costs[category]).plus(r.amount));
      }
      sources.push({ record: r, docCode: d?.code ?? r.code, category });
    }
    const invoices = [...docs.values()].filter(
      (d) => d.status === 'VALIDATED' && d.vat && periodOf(d.fields.documentDate) === periodId,
    );
    const vat = (kind: DocumentRow['kind']) =>
      sum(invoices.filter((d) => d.kind === kind).map((d) => d.vat ?? '0'));
    return {
      periodId,
      label: formatPeriod(periodId),
      grossSales: t.grossSales.toFixed(),
      returns: t.returns.toFixed(),
      netRevenue: t.netRevenue.toFixed(),
      platformFees: t.platformFees.toFixed(),
      costs,
      totalCosts: t.totalCosts.toFixed(),
      result: t.result.toFixed(),
      vatOut: vat('REVENUE').toFixed(),
      vatIn: vat('EXPENSE').toFixed(),
      received: t.received.toFixed(),
      documents: new Set(recs.map((r) => r.documentId).filter(Boolean)).size,
    };
  });
  return { months, sources };
}

async function loadSource(tx: Tx, ws: WorkspaceState, periods: string[]) {
  const docs = new Map((await scoped(tx, ws, 'documents')).map((d) => [d.id, d]));
  const wanted = new Set(periods);
  // Only what a person confirmed: records of validated documents, or entered directly.
  const records = (await scoped(tx, ws, 'records'))
    .filter((r) => wanted.has(r.periodId) && isConfirmed(r, docs))
    .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  return { docs, records };
}

const total = (months: MonthFigures[], pick: (m: MonthFigures) => string) => sum(months.map(pick));

export interface ReportQuery {
  to?: string | undefined;
  months?: number | string | undefined;
}

export async function financeReport(tx: Tx, ws: WorkspaceState, tenant: TenantRow, p: ReportQuery) {
  return (await buildReport(tx, ws, tenant, p)).report;
}

/** The report with a fingerprint of the confirmed records it was built from (for the CalcRun). */
export async function financeReportSnapshot(tx: Tx, ws: WorkspaceState, tenant: TenantRow, p: ReportQuery) {
  const { report, sources } = await buildReport(tx, ws, tenant, p);
  const sourceDigest = sha256Hex(
    canonicalize(
      sources.map((s) => ({
        id: s.record.id,
        version: s.record.version,
        kind: s.record.kind,
        date: s.record.date,
        amount: s.record.amount,
        category: s.category,
      })),
    ),
  );
  return { report, sourceDigest };
}

async function buildReport(tx: Tx, ws: WorkspaceState, tenant: TenantRow, p: ReportQuery) {
  const to = p.to && validPeriod(p.to) ? p.to : tenant.settings.currentPeriod;
  const n = Math.min(12, Math.max(1, Math.floor(Number(p.months ?? 6)) || 6));
  const periods = periodsEndingAt(to, n);
  const { docs, records } = await loadSource(tx, ws, periods);
  const { months, sources } = computeMonths(periods, records, docs);
  const net = total(months, (m) => m.netRevenue);
  const costs = total(months, (m) => m.totalCosts);
  const result = net.minus(costs);
  const current = months.at(-1)!;
  const withSales = months.filter((m) => D(m.netRevenue).gt(0));
  const hkd = tenant.settings.accountingRegime === 'HKD';
  // Average monthly result of the months that had sales: a starting point for a project
  // appraisal (annual net cash flow), never filled in without the person choosing it.
  const avg = withSales.length
    ? sum(withSales.map((m) => m.result))
        .div(withSales.length)
        .toDecimalPlaces(0)
    : null;
  const report = {
    to,
    periods,
    rangeLabel: `${formatPeriod(periods[0]!)} đến ${formatPeriod(to).toLowerCase()}`,
    location: await scopeLabel(tx, ws.tenantId, ws.entityId),
    basis: hkd
      ? 'Hộ kinh doanh: doanh thu và chi phí gồm thuế GTGT (không khấu trừ).'
      : 'Doanh nghiệp: doanh thu và chi phí trên hóa đơn điện tử tính trước thuế GTGT; thuế GTGT đầu ra, đầu vào trình bày riêng.',
    months,
    totals: {
      grossSales: total(months, (m) => m.grossSales).toFixed(),
      returns: total(months, (m) => m.returns).toFixed(),
      netRevenue: net.toFixed(),
      platformFees: total(months, (m) => m.platformFees).toFixed(),
      costs: Object.fromEntries(CATS.map((k) => [k, total(months, (m) => m.costs[k]).toFixed()])) as Record<
        CostCategory,
        string
      >,
      totalCosts: costs.toFixed(),
      result: result.toFixed(),
      vatOut: total(months, (m) => m.vatOut).toFixed(),
      vatIn: total(months, (m) => m.vatIn).toFixed(),
      received: total(months, (m) => m.received).toFixed(),
      documents: new Set(sources.map((s) => s.record.documentId).filter(Boolean)).size,
    },
    current: {
      label: current.label,
      netRevenueLabel: formatVnd(current.netRevenue),
      totalCostsLabel: formatVnd(current.totalCosts),
      resultLabel: formatVnd(current.result),
      marginLabel: D(current.netRevenue).gt(0)
        ? formatPercent(D(current.result).div(current.netRevenue), 1)
        : 'Chưa có',
    },
    costCaptions: COST_SHORT,
    appraisalHint: avg
      ? {
          annualCashflow: avg.times(12).toFixed(),
          /** The appraisal works in millions of đồng (whole millions in its form). */
          annualCashflowMillions: avg.times(12).div(1_000_000).toDecimalPlaces(0).toFixed(),
          note: `Kết quả bình quân ${formatVnd(avg)}/tháng của ${withSales.length} tháng có doanh thu, quy ra cả năm.`,
        }
      : null,
    note: 'Chỉ gồm chứng từ đã xác nhận. Chi phí chưa có chứng từ (lương, khấu hao) chưa được tính: kết quả là chênh lệch giữa thu và chi theo chứng từ, không phải lợi nhuận kế toán.',
    sourceCount: sources.length,
  };
  return { report, sources };
}

const RECORD_KIND: Record<BusinessRecordRow['kind'], string> = {
  ORDER: 'Doanh thu bán hàng',
  REVENUE: 'Hóa đơn bán ra / doanh thu',
  EXPENSE: 'Chi phí, mua vào',
  BANK_TXN: 'Tiền về tài khoản',
  CASH: 'Tiền mặt',
};

/** The report as a real Excel file: the figures with their formulas, and every source line. */
export async function financeReportXlsx(
  tx: Tx,
  ws: WorkspaceState,
  tenant: TenantRow,
  p: ReportQuery,
  now: Date,
) {
  const { report: r, sources } = await buildReport(tx, ws, tenant, p);
  const n = r.months.length;
  const totalCol = columnName(n + 1); // months in B…, then the total column
  const lastMonthCol = columnName(n);
  const cell = (strong: boolean, v: string, f?: string): XCell => ({
    v: Number(v),
    s: strong ? 'moneyBold' : 'money',
    ...(f ? { f } : {}),
  });
  const rows: (XCell | null)[][] = [
    [{ v: `Đơn vị: ${tenant.name}`, s: 'unit' }],
    [{ v: `Mã số thuế: ${tenant.taxCode ?? ''}`, s: 'unit' }],
    [],
    [{ v: 'BÁO CÁO KẾT QUẢ KINH DOANH THEO CHỨNG TỪ', s: 'title' }],
    [{ v: `${r.rangeLabel}, ${r.location}`, s: 'subtitle' }],
    [{ v: 'Đơn vị tính: đồng', s: 'unitNote' }],
    [
      { v: 'Chỉ tiêu', s: 'head' },
      ...r.months.map((m): XCell => ({ v: m.label, s: 'head' })),
      { v: 'Cộng', s: 'head' },
    ],
  ];
  /** Appends a figure row (formulas per month where given, the total as a sum) and returns its number. */
  const add = (
    label: string,
    pick: (m: MonthFigures) => string,
    opts: { strong?: boolean; formula?: (col: string) => string } = {},
  ): number => {
    const row = rows.length + 1;
    const strong = opts.strong ?? false;
    rows.push([
      { v: label, s: strong ? 'cellBold' : 'cell' },
      ...r.months.map((m, i) => cell(strong, pick(m), opts.formula?.(columnName(i + 1)))),
      cell(strong, sum(r.months.map(pick)).toFixed(), `SUM(B${row}:${lastMonthCol}${row})`),
    ]);
    return row;
  };
  const gross = add('1. Doanh thu bán hàng', (m) => m.grossSales);
  const returns = add('2. Hoàn tiền, chiết khấu cho khách', (m) => m.returns);
  const net = add('3. Doanh thu thuần', (m) => m.netRevenue, {
    strong: true,
    formula: (c) => `${c}${gross}-${c}${returns}`,
  });
  const costRow = rows.length + 1;
  const firstCost = costRow + 1;
  const lastCost = costRow + CATS.length + 1; // the cost groups, then platform fees
  add('4. Chi phí theo chứng từ', (m) => m.totalCosts, {
    strong: true,
    formula: (c) => `SUM(${c}${firstCost}:${c}${lastCost})`,
  });
  for (const k of CATS) add(`   ${COST_SHORT[k]}`, (m) => m.costs[k]);
  add('   Phí nền tảng bán hàng', (m) => m.platformFees);
  add('5. Chênh lệch thu chi', (m) => m.result, {
    strong: true,
    formula: (c) => `${c}${net}-${c}${costRow}`,
  });
  rows.push([]);
  add('Thuế GTGT đầu ra trên hóa đơn bán ra', (m) => m.vatOut);
  add('Thuế GTGT đầu vào trên hóa đơn mua vào', (m) => m.vatIn);
  add('Tiền thu về (ngân hàng, tiền mặt)', (m) => m.received);
  rows.push([]);
  rows.push([{ v: `Ghi chú: ${r.note} ${r.basis}`, s: 'note' }]);
  const noteRow = rows.length;
  const report: XSheet = {
    name: 'Kết quả kinh doanh',
    cols: [46, ...r.months.map(() => 15), 17],
    rows,
    merges: [
      `A1:${totalCol}1`,
      `A2:${totalCol}2`,
      `A4:${totalCol}4`,
      `A5:${totalCol}5`,
      `A6:${totalCol}6`,
      `A${noteRow}:${totalCol}${noteRow}`,
    ],
    heights: { 4: 24, [noteRow]: 48 },
    landscape: n > 4,
  };
  const list: XSheet = {
    name: 'Chứng từ nguồn',
    cols: [12, 14, 24, 40, 16, 14, 14, 30],
    rows: [
      [{ v: 'CHỨNG TỪ NGUỒN CỦA BÁO CÁO', s: 'title' }],
      [{ v: r.rangeLabel, s: 'subtitle' }],
      [],
      [
        'Ngày',
        'Chứng từ',
        'Loại',
        'Đối tác / nội dung',
        'Số tiền',
        'Hoàn tiền, chiết khấu',
        'Phí',
        'Nhóm chi phí',
      ].map((v): XCell => ({ v, s: 'head' })),
      ...sources.map(({ record: x, docCode, category }): XCell[] => [
        { v: `${x.date.slice(8, 10)}/${x.date.slice(5, 7)}/${x.date.slice(0, 4)}`, s: 'date' },
        { v: docCode, s: 'cellCenter' },
        { v: RECORD_KIND[x.kind], s: 'cell' },
        { v: [x.counterparty, x.channel, x.description].filter(Boolean).join(', '), s: 'cell' },
        cell(false, x.amount),
        cell(
          false,
          D(x.refund || '0')
            .plus(x.discount || '0')
            .toFixed(),
        ),
        cell(false, x.fee || '0'),
        { v: category ? COST_SHORT[category] : '', s: 'cell' },
      ]),
    ],
    merges: ['A1:H1', 'A2:H2'],
    landscape: true,
  };
  const bytes = buildXlsx([report, list], {
    title: `Báo cáo kết quả kinh doanh ${r.rangeLabel}`,
    author: 'ARGOLET',
    created: now,
  });
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    filename: `bao-cao-ket-qua-kinh-doanh-${r.periods[0]}-den-${r.to}.xlsx`,
    mime: XLSX_MIME,
    contentBase64: btoa(bin),
  };
}
