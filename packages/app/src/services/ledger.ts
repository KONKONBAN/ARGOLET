/**
 * Automatic books: every confirmed document becomes a journal entry, every month is closed, and the
 * financial statements and ratios are read off the ledger — no figure is typed in twice. The same
 * books feed the calculators, the project appraisal and its scenarios.
 */
import {
  accountName,
  balanceSheet,
  buildLedger,
  buildXlsx,
  canonicalize,
  D,
  daysInPeriod,
  dec,
  financialRatios,
  formatPeriod,
  incomeStatement,
  makeCalcRun,
  newId,
  OPENING_ACCOUNTS,
  sha256Hex,
  trialBalance,
  XLSX_MIME,
  type Decimal,
  type Ledger,
  type LedgerEvent,
  type Regime,
  type XCell,
  type XSheet,
} from '@argolet/core';
import { type AppCore, actor, requireFound } from '../core';
import { AppError, type CallContext, type Emitter, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { BusinessRecordRow, DocumentRow, LedgerSettings, TenantRow } from '../types';
import { scoped } from './documents';
import { scopeLabel } from './org';
import { isConfirmed, periodsEndingAt, validPeriod } from './report';

const MAX_MONTHS = 60;
/** Posting, closing and statement rules applied by the automatic books. */
export const LEDGER_RULES_VERSION = 'ledger-rules-2026.11';

export function ledgerRegime(t: TenantRow): Regime | null {
  const r = t.settings.accountingRegime;
  if (r === 'HKD') return null;
  return r === 'TT133' ? 'TT133' : 'TT99';
}

const REGIME_LABEL: Record<Regime, string> = {
  TT99: 'Thông tư 99/2025/TT-BTC',
  TT133: 'Thông tư 133/2016/TT-BTC',
};

/** Counter sales are collected on the spot (cash, card or transfer at the till). */
const PAID_AT_COUNTER = /tại quầy|tiền mặt/i;

/**
 * The business events of confirmed records and validated bank statements. Amounts follow the
 * records: enterprise revenue and costs on e-invoices are before VAT, the VAT is on the document.
 */
export function sourceEvents(
  records: BusinessRecordRow[],
  docs: Map<string, DocumentRow>,
  from: string,
  to: string,
): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  const inRange = (date: string) => date.slice(0, 7) >= from && date.slice(0, 7) <= to;
  for (const r of records) {
    if (!isConfirmed(r, docs) || !inRange(r.date)) continue;
    const doc = r.documentId ? docs.get(r.documentId) : undefined;
    const base = {
      id: r.id,
      date: r.date,
      ref: doc?.code ?? r.code,
      party: r.counterparty,
      documentId: r.documentId,
    };
    switch (r.kind) {
      case 'REVENUE':
        events.push({
          ...base,
          kind: 'SALE',
          net: r.amount,
          vat: doc?.kind === 'REVENUE' && doc.vat ? doc.vat : '0',
          cash: PAID_AT_COUNTER.test(r.channel),
        });
        break;
      case 'ORDER':
        events.push({
          ...base,
          kind: 'PLATFORM_SALE',
          party: r.channel || r.counterparty,
          gross: r.amount,
          refund: r.refund || '0',
          discount: r.discount || '0',
          fee: r.fee || '0',
        });
        break;
      case 'BANK_TXN':
      case 'CASH':
        events.push({
          ...base,
          kind: 'RECEIPT',
          amount: r.amount,
          via: r.kind === 'CASH' ? 'CASH' : 'BANK',
          text: [r.description, r.reference, r.counterparty].filter(Boolean).join(' · '),
        });
        break;
      case 'EXPENSE': {
        const vat = doc?.kind === 'EXPENSE' && doc.vat ? doc.vat : '0';
        events.push({
          ...base,
          kind: 'PURCHASE',
          net: r.amount,
          vat,
          text: [doc?.title, r.description, ...(doc?.lines.map((l) => l.description) ?? [])]
            .filter(Boolean)
            .join(' · '),
          // An invoice from a registered seller is paid later (331); a till receipt is paid in cash.
          onCredit: !!(doc?.fields.taxCode || doc?.fields.series || doc?.sourceKind === 'XML_EINVOICE'),
        });
        break;
      }
    }
  }
  // Money paid out of the bank, read from validated statements.
  for (const d of docs.values()) {
    if (d.status !== 'VALIDATED' || d.kind !== 'STATEMENT' || d.rowKind !== 'BANK') continue;
    for (const row of d.rows) {
      if (!D(row.amount).isNegative() || !inRange(row.date)) continue;
      events.push({
        kind: 'PAYMENT',
        id: `${d.id}-${row.lineNo}`,
        date: row.date,
        ref: row.code || d.code,
        party: row.counterparty,
        amount: D(row.amount).abs().toFixed(),
        text: [row.description, row.reference, row.counterparty].filter(Boolean).join(' · '),
        documentId: d.id,
      });
    }
  }
  return events;
}

/** Thuế suất TNDN theo tổng doanh thu năm (Luật Thuế TNDN số 67/2025/QH15). */
export function citRateForRevenue(annualRevenue: Decimal): string {
  if (annualRevenue.lte(3_000_000_000)) return '0.15';
  if (annualRevenue.lte(50_000_000_000)) return '0.17';
  return '0.2';
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while ((y < ty || (y === ty && m <= tm)) && out.length <= MAX_MONTHS) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface BooksQuery {
  to?: string | undefined;
  months?: number | string | undefined;
}

interface Books {
  regime: Regime;
  ledger: Ledger;
  from: string;
  to: string;
  range: string[];
  citRate: string;
  citAuto: boolean;
  documents: number;
  events: number;
  /** Fingerprint of the source events the books were built from (for the CalcRun). */
  sourceDigest: string;
  settings: LedgerSettings;
}

async function loadBooks(
  tx: Tx,
  ws: WorkspaceState,
  tenant: TenantRow,
  q: BooksQuery,
): Promise<Books | null> {
  const regime = ledgerRegime(tenant);
  if (!regime) return null;
  const settings = tenant.settings.ledger ?? {};
  const to = q.to && validPeriod(q.to) ? q.to : tenant.settings.currentPeriod;
  const n = Math.min(12, Math.max(1, Math.floor(Number(q.months ?? 12)) || 12));
  let range = periodsEndingAt(to, n);
  const docs = new Map((await scoped(tx, ws, 'documents')).map((d) => [d.id, d]));
  const records = await scoped(tx, ws, 'records');
  const opening =
    settings.openingPeriod && validPeriod(settings.openingPeriod) ? settings.openingPeriod : null;
  // Books start at the opening month, or at the first month with a confirmed record.
  const firstData = records
    .filter((r) => isConfirmed(r, docs))
    .map((r) => r.periodId)
    .sort()[0];
  let start = opening ?? (firstData && firstData < range[0]! ? firstData : range[0]!);
  if (start > to) start = to;
  if (opening) range = range.filter((p) => p >= opening);
  if (!range.length) range = [to];
  const periods = monthsBetween(start, to).slice(-MAX_MONTHS);
  const events = sourceEvents(records, docs, periods[0]!, to);
  // Rate: the accountant's, else by the year's revenue (annualised from the books).
  const salesOf = (list: LedgerEvent[]) =>
    list.reduce((t, e) => {
      if (e.kind === 'SALE') return t.plus(e.net);
      if (e.kind === 'PLATFORM_SALE') return t.plus(e.gross).minus(e.refund).minus(e.discount);
      return t;
    }, D(0));
  const yearEvents = events.filter((e) => e.date.slice(0, 4) === to.slice(0, 4));
  const monthsWithData = new Set(yearEvents.map((e) => e.date.slice(0, 7))).size || 1;
  const annualRevenue = salesOf(yearEvents).div(monthsWithData).times(12);
  const citAuto = !settings.citRate;
  const citRate = settings.citRate ?? citRateForRevenue(annualRevenue);
  const ledger = buildLedger({
    regime,
    periods,
    events,
    opening: opening && opening === periods[0] ? settings.opening : undefined,
    stockCounts: settings.stockCounts,
    citRate,
  });
  return {
    regime,
    ledger,
    from: range[0]!,
    to,
    range,
    citRate,
    citAuto,
    documents: new Set(events.map((e) => e.documentId).filter(Boolean)).size,
    events: events.length,
    sourceDigest: sha256Hex(canonicalize(events)),
    settings,
  };
}

const prevPeriod = (p: string) => periodsEndingAt(p, 2)[0]!;

/** The statements, ratios and the figures the calculators and the appraisal start from. */
function analyse(b: Books) {
  const { ledger, from, to, range } = b;
  const income = incomeStatement(ledger, from, to);
  const startAt = from === ledger.periods[0] ? null : prevPeriod(from);
  const start = balanceSheet(ledger, startAt);
  const end = balanceSheet(ledger, to);
  const days = range.reduce((t, p) => t + daysInPeriod(p), 0);
  const ratios = financialRatios({ income: income.figures, start: start.figures, end: end.figures, days });
  const monthly = range.map((p) => ({ periodId: p, ...incomeStatement(ledger, p, p).figures }));
  const t = D(b.citRate);
  const months = range.length;
  const annual = (v: Decimal) => v.div(months).times(12);
  // Depreciation charged in the range (non-cash) and principal repaid on loans.
  let depreciation = D(0);
  let principal = D(0);
  for (const e of ledger.entries) {
    if (e.periodId < from || e.periodId > to || e.kind === 'OPENING') continue;
    for (const l of e.lines) {
      if (l.account === '214') depreciation = depreciation.plus(l.credit).minus(l.debit);
      if (l.account === '341' && e.kind === 'BANK') principal = principal.plus(l.debit);
    }
  }
  const pat = D(income.figures.profitAfterTax);
  const interest = D(income.figures.interest);
  const loansAvg = D(start.figures.loans).plus(end.figures.loans).div(2);
  const equityEnd = D(end.figures.equity);
  const loansEnd = D(end.figures.loans);
  const avgEquity = D(start.figures.equity).plus(equityEnd).div(2);
  const costOfDebt = loansAvg.gt(0) ? annual(interest).div(loansAvg) : null;
  const roeAnnual = avgEquity.gt(0) ? annual(pat).div(avgEquity) : null;
  const costOfEquity = roeAnnual && roeAnnual.gt(0) ? roeAnnual : null;
  const capital = equityEnd.plus(loansEnd);
  const wacc =
    costOfEquity && capital.gt(0) && equityEnd.gt(0)
      ? equityEnd
          .div(capital)
          .times(costOfEquity)
          .plus(costOfDebt ? loansEnd.div(capital).times(costOfDebt).times(D(1).minus(t)) : 0)
      : null;
  const million = (v: Decimal) => v.div(1_000_000).toDecimalPlaces(0);
  const cashflows = monthly.map((m) => D(m.profitAfterTax));
  const mean = cashflows.reduce((s, v) => s.plus(v), D(0)).div(cashflows.length || 1);
  const sd =
    cashflows.length > 2
      ? cashflows
          .reduce((s, v) => s.plus(v.minus(mean).pow(2)), D(0))
          .div(cashflows.length - 1)
          .sqrt()
      : null;
  const annualCashflow = annual(pat.plus(depreciation));
  return {
    income,
    start,
    end,
    ratios: ratios.groups,
    monthly: monthly.map((m) => ({
      periodId: m.periodId,
      label: formatPeriod(m.periodId),
      netRevenue: m.netRevenue,
      profitAfterTax: m.profitAfterTax,
    })),
    calculators: {
      ...ratios.leverageInputs,
      taxRate: b.citRate,
      totalAssets: end.figures.totalAssets,
      equity: end.figures.equity,
      debt: end.figures.loans,
      costOfDebt: costOfDebt ? dec(costOfDebt) : null,
      costOfEquity: costOfEquity ? dec(costOfEquity) : null,
    },
    appraisal: {
      months,
      annualCashflowMillions: annualCashflow.gt(0) ? million(annualCashflow).toFixed() : null,
      discountRate: wacc ? dec(wacc.toDecimalPlaces(4)) : null,
      annualDebtServiceMillions: interest.plus(principal).gt(0)
        ? million(annual(interest.plus(principal))).toFixed()
        : null,
      /** Cash flow one standard deviation of the monthly results below / above the average. */
      scenarios:
        sd && mean.gt(0)
          ? {
              low: million(mean.minus(sd).times(12).plus(annual(depreciation))).toFixed(),
              high: million(mean.plus(sd).times(12).plus(annual(depreciation))).toFixed(),
            }
          : null,
    },
  };
}

/** A company's books for one month (Sổ sách & thuế): the same workbook as the books page. */
export async function companyBooksFile(
  tx: Tx,
  ws: WorkspaceState,
  tenant: TenantRow,
  periodId: string,
  now: Date,
) {
  const b = await loadBooks(tx, ws, tenant, { to: periodId, months: 1 });
  if (!b) throw new AppError('VALIDATION', 'Hộ kinh doanh xuất sổ theo Thông tư 152/2025/TT-BTC');
  const form = b.regime === 'TT99' ? 'DN' : 'DNN';
  return {
    ...booksWorkbook(b, tenant, await scopeLabel(tx, ws.tenantId, ws.entityId), now),
    forms: [`S03a-${form}`, `F01-${form}`, `B02-${form}`, 'Báo cáo tình hình tài chính', 'Chỉ số tài chính'],
  };
}

/** Statements, ratios and appraisal inputs from the books, or null for household businesses. */
export async function booksAnalysis(tx: Tx, ws: WorkspaceState, tenant: TenantRow, q: BooksQuery = {}) {
  const b = await loadBooks(tx, ws, tenant, q);
  return b ? analyse(b) : null;
}

export class LedgerService {
  constructor(private readonly core: AppCore) {}

  private async tenant(tx: Tx, ws: WorkspaceState) {
    return requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
  }

  /** Sổ sách & chỉ số: statements and ratios of the months ending at `to`, straight from the books. */
  async overview(call: CallContext, q: BooksQuery = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = await this.tenant(tx, ws);
      const b = await loadBooks(tx, ws, tenant, q);
      if (!b) return { applicable: false as const, regime: tenant.settings.accountingRegime };
      const a = analyse(b);
      const warnings = [...b.ledger.warnings];
      if (D(a.end.figures.cash).isNegative())
        warnings.push('Số dư tiền âm: còn thiếu chứng từ thu hoặc số dư đầu kỳ.');
      const accounts = new Set(b.ledger.entries.flatMap((e) => e.lines.map((l) => l.account)));
      return {
        applicable: true as const,
        regime: b.regime,
        regimeLabel: REGIME_LABEL[b.regime],
        location: await scopeLabel(tx, ws.tenantId, ws.entityId),
        from: b.from,
        to: b.to,
        months: b.range.length,
        rangeLabel: b.from === b.to ? formatPeriod(b.to) : `${formatPeriod(b.from)} – ${formatPeriod(b.to)}`,
        pipeline: {
          documents: b.documents,
          events: b.events,
          entries: b.ledger.entries.filter((e) => e.periodId >= b.from && e.periodId <= b.to).length,
          accounts: accounts.size,
        },
        income: a.income,
        balance: { start: a.start, end: a.end },
        ratios: a.ratios,
        monthly: a.monthly,
        calculators: a.calculators,
        appraisal: a.appraisal,
        trial: trialBalance(b.ledger, b.from, b.to),
        citRate: b.citRate,
        citAuto: b.citAuto,
        hasOpening: !!b.settings.opening && !!b.settings.openingPeriod,
        settings: {
          openingPeriod: b.settings.openingPeriod ?? null,
          opening: b.settings.opening ?? {},
          stockCounts: b.settings.stockCounts ?? {},
          citRate: b.settings.citRate ?? null,
        },
        openingAccounts: OPENING_ACCOUNTS.map((code) => ({ code, name: accountName(b.regime, code) })),
        warnings,
        canEdit: this.core.can(ws, 'document.validate'),
        canExport: this.core.can(ws, 'report.export'),
      };
    });
  }

  /** Sổ Nhật ký chung of the range, newest first, a page at a time. */
  async journal(
    call: CallContext,
    q: BooksQuery & { page?: number | string; pageSize?: number | string } = {},
  ) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = await this.tenant(tx, ws);
      const b = await loadBooks(tx, ws, tenant, q);
      if (!b) return { items: [], total: 0, page: 1, pageSize: 10, pageCount: 1 };
      const all = b.ledger.entries
        .filter((e) => e.periodId >= b.from && e.periodId <= b.to)
        .sort((x, y) => y.date.localeCompare(x.date) || y.id.localeCompare(x.id));
      const pageSize = Math.min(50, Math.max(5, Math.floor(Number(q.pageSize ?? 10)) || 10));
      const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
      const page = Math.min(pageCount, Math.max(1, Math.floor(Number(q.page ?? 1)) || 1));
      return {
        items: all.slice((page - 1) * pageSize, page * pageSize).map((e) => ({
          id: e.id,
          date: e.date,
          ref: e.ref,
          description: e.description,
          kind: e.kind,
          documentId: e.documentId,
          lines: e.lines.map((l) => ({ ...l, name: accountName(b.regime, l.account) })),
        })),
        total: all.length,
        page,
        pageSize,
        pageCount,
      };
    });
  }

  /** Opening balances, stock counts and the tax rate (accountants). */
  async saveSettings(call: CallContext, p: LedgerSettings) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'document.validate');
      const tenant = await this.tenant(tx, ws);
      const regime = ledgerRegime(tenant);
      if (!regime) throw new AppError('VALIDATION', 'Hộ kinh doanh ghi sổ theo Thông tư 152/2025/TT-BTC');
      const next: LedgerSettings = { ...(tenant.settings.ledger ?? {}) };
      if (p.openingPeriod !== undefined) {
        if (p.openingPeriod && !validPeriod(p.openingPeriod))
          throw new AppError('VALIDATION', 'Tháng bắt đầu không hợp lệ', { field: 'openingPeriod' });
        next.openingPeriod = p.openingPeriod || undefined;
      }
      if (p.opening !== undefined) {
        const clean: Record<string, string> = {};
        let total = D(0);
        for (const [code, v] of Object.entries(p.opening)) {
          if (!(OPENING_ACCOUNTS as readonly string[]).includes(code))
            throw new AppError('VALIDATION', `Tài khoản ${code} không nhập số dư đầu kỳ được`, {
              field: code,
            });
          const s = String(v ?? '').replace(/\s/g, '');
          if (s === '' || s === '0') continue;
          if (!/^-?\d+(\.\d+)?$/.test(s))
            throw new AppError('VALIDATION', `Số dư tài khoản ${code} phải là số`, { field: code });
          clean[code] = s;
          total = total.plus(s);
        }
        if (!total.isZero())
          throw new AppError('VALIDATION', `Số dư đầu kỳ chưa cân: chênh lệch Nợ − Có ${dec(total)} đ`, {
            field: 'opening',
          });
        next.opening = clean;
      }
      if (p.stockCounts !== undefined) {
        const clean: Record<string, string> = {};
        for (const [period, v] of Object.entries(p.stockCounts)) {
          if (!validPeriod(period))
            throw new AppError('VALIDATION', 'Tháng kiểm kê không hợp lệ', { field: 'stockCounts' });
          const s = String(v ?? '').replace(/[^\d.]/g, '');
          if (s !== '') clean[period] = s;
        }
        next.stockCounts = clean;
      }
      if (p.citRate !== undefined) {
        if (p.citRate && !['0.15', '0.17', '0.2'].includes(p.citRate))
          throw new AppError('VALIDATION', 'Thuế suất TNDN là 15%, 17% hoặc 20%', { field: 'citRate' });
        next.citRate = p.citRate || undefined;
      }
      await tx.put('tenants', { ...tenant, settings: { ...tenant.settings, ledger: next } });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'ledger.settings',
        tenant.name,
        'Số dư đầu kỳ / kiểm kê / thuế suất',
      );
      return { ok: true as const };
    });
  }

  /**
   * The books as an Excel workbook: journal, trial balance, B02, financial position and ratios. Each
   * export is recorded as a CalcRun (inputs, rules and engine version) so it can be reproduced.
   */
  async exportBooks(call: CallContext, q: BooksQuery = {}) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'report.export');
      const tenant = await this.tenant(tx, ws);
      const b = await loadBooks(tx, ws, tenant, q);
      if (!b)
        throw new AppError(
          'VALIDATION',
          'Hộ kinh doanh xuất sổ theo Thông tư 152/2025/TT-BTC trong Sổ sách & thuế',
        );
      const file = booksWorkbook(
        b,
        tenant,
        await scopeLabel(tx, ws.tenantId, ws.entityId),
        this.core.deps.clock(),
      );
      await recordBooksRun(tx, em, ws, b, now);
      return file;
    });
  }
}

/** Keeps a books computation reproducible: source fingerprint, settings, rules and engine version. */
async function recordBooksRun(tx: Tx, em: Emitter, ws: WorkspaceState, b: Books, now: string) {
  const a = analyse(b);
  const run = makeCalcRun({
    calcRunId: newId('calc'),
    task: 'books_statements',
    packageCode: 'G2',
    rulesVersion: LEDGER_RULES_VERSION,
    assumptions: {
      scope: ws.entityId,
      regime: b.regime,
      from: b.from,
      to: b.to,
      citRate: b.citRate,
      openingPeriod: b.settings.openingPeriod ?? null,
      opening: b.settings.opening ?? {},
      stockCounts: b.settings.stockCounts ?? {},
      sourceEvents: b.events,
      sourceDigest: b.sourceDigest,
    },
    method: 'Kế toán kép · kết chuyển cuối tháng · kết quả kinh doanh · tình hình tài chính · chỉ số',
    result: {
      netRevenue: a.income.figures.netRevenue,
      profitBeforeTax: a.income.figures.profitBeforeTax,
      profitAfterTax: a.income.figures.profitAfterTax,
      totalAssets: a.end.figures.totalAssets,
      entries: b.ledger.entries.length,
    },
    createdAt: now,
  });
  await tx.put('calcRuns', { ...run, id: run.calcRunId, tenantId: ws.tenantId, createdBy: ws.user.id });
  await em.emit({
    type: 'CalcRunCompleted',
    tenantId: ws.tenantId,
    entityId: ws.entityId === '*' ? null : ws.entityId,
    aggregateType: 'Books',
    aggregateId: ws.tenantId,
    actorId: ws.user.id,
    dataRef: `calc/${run.calcRunId}`,
    dataVersion: 1,
    data: { calcRunId: run.calcRunId, engineVersion: run.engineVersion },
  });
  return run;
}

const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const money = (v: string, strong = false): XCell => ({ v: Number(v), s: strong ? 'moneyBold' : 'money' });

export function booksWorkbook(b: Books, tenant: TenantRow, location: string, now: Date) {
  const a = analyse(b);
  const head = (labels: string[]) => labels.map((v): XCell => ({ v, s: 'head' }));
  const top = (title: string, cols: number): { rows: (XCell | null)[][]; merges: string[] } => {
    const last = String.fromCharCode(64 + cols);
    return {
      rows: [
        [{ v: `Đơn vị: ${tenant.name}`, s: 'unit' }],
        [{ v: `Mã số thuế: ${tenant.taxCode ?? ''}`, s: 'unit' }],
        [],
        [{ v: title, s: 'title' }],
        [
          {
            v: `${b.from === b.to ? formatPeriod(b.to) : `${formatPeriod(b.from)} – ${formatPeriod(b.to)}`} · ${location}`,
            s: 'subtitle',
          },
        ],
        [{ v: 'Đơn vị tính: đồng', s: 'unitNote' }],
      ],
      merges: [`A1:${last}1`, `A2:${last}2`, `A4:${last}4`, `A5:${last}5`, `A6:${last}6`],
    };
  };
  const form = b.regime === 'TT99' ? 'DN' : 'DNN';

  // Sổ Nhật ký chung (S03a)
  const j = top(`SỔ NHẬT KÝ CHUNG (Mẫu số S03a-${form})`, 8);
  j.rows.push(
    head([
      'Ngày ghi sổ',
      'Số hiệu chứng từ',
      'Ngày chứng từ',
      'Diễn giải',
      'STT dòng',
      'Số hiệu TK',
      'Nợ',
      'Có',
    ]),
  );
  let no = 0;
  for (const e of b.ledger.entries.filter((x) => x.periodId >= b.from && x.periodId <= b.to)) {
    for (const l of e.lines) {
      no++;
      j.rows.push([
        { v: dmy(e.date), s: 'date' },
        { v: e.ref, s: 'cellCenter' },
        { v: dmy(e.date), s: 'date' },
        { v: e.description, s: 'cell' },
        { v: no, s: 'cellCenter' },
        { v: l.account, s: 'cellCenter' },
        money(l.debit),
        money(l.credit),
      ]);
    }
  }
  const jFirst = 8;
  const jLast = j.rows.length;
  j.rows.push([
    { v: 'Cộng số phát sinh', s: 'cellBold' },
    null,
    null,
    null,
    null,
    null,
    { v: 0, s: 'moneyBold', f: `SUM(G${jFirst}:G${jLast})` },
    { v: 0, s: 'moneyBold', f: `SUM(H${jFirst}:H${jLast})` },
  ]);
  const journal: XSheet = {
    name: 'Nhật ký chung',
    cols: [12, 16, 12, 44, 8, 10, 16, 16],
    rows: j.rows,
    merges: j.merges,
    landscape: true,
  };

  // Bảng cân đối tài khoản (F01)
  const t = top(`BẢNG CÂN ĐỐI TÀI KHOẢN (Mẫu số F01-${form})`, 8);
  t.rows.push(
    head([
      'Số hiệu TK',
      'Tên tài khoản',
      'Dư Nợ đầu kỳ',
      'Dư Có đầu kỳ',
      'Phát sinh Nợ',
      'Phát sinh Có',
      'Dư Nợ cuối kỳ',
      'Dư Có cuối kỳ',
    ]),
  );
  for (const r of trialBalance(b.ledger, b.from, b.to))
    t.rows.push([
      { v: r.account, s: 'cellCenter' },
      { v: r.name, s: 'cell' },
      money(r.openingDebit),
      money(r.openingCredit),
      money(r.debit),
      money(r.credit),
      money(r.closingDebit),
      money(r.closingCredit),
    ]);
  const trial: XSheet = {
    name: 'Cân đối tài khoản',
    cols: [10, 40, 16, 16, 16, 16, 16, 16],
    rows: t.rows,
    merges: t.merges,
    landscape: true,
  };

  // B02
  const k = top(`BÁO CÁO KẾT QUẢ HOẠT ĐỘNG KINH DOANH (Mẫu số B02-${form})`, 3);
  k.rows.push(head(['Chỉ tiêu', 'Mã số', 'Số tiền']));
  for (const l of a.income.lines)
    k.rows.push([
      { v: l.label, s: l.strong ? 'cellBold' : 'cell' },
      { v: l.code, s: 'cellCenter' },
      money(l.value, l.strong),
    ]);
  const b02: XSheet = { name: 'Kết quả kinh doanh', cols: [56, 10, 20], rows: k.rows, merges: k.merges };

  // Tình hình tài chính
  const f = top('BÁO CÁO TÌNH HÌNH TÀI CHÍNH', 3);
  f.rows.push(head(['Chỉ tiêu', 'Đầu kỳ', 'Cuối kỳ']));
  a.end.lines.forEach((l, i) =>
    f.rows.push([
      { v: l.label, s: l.strong ? 'cellBold' : 'cell' },
      money(a.start.lines[i]!.value, l.strong),
      money(l.value, l.strong),
    ]),
  );
  const b01: XSheet = { name: 'Tình hình tài chính', cols: [48, 20, 20], rows: f.rows, merges: f.merges };

  // Chỉ số
  const c = top('CHỈ SỐ TÀI CHÍNH', 2);
  c.rows.push(head(['Chỉ số', 'Giá trị']));
  for (const g of a.ratios) {
    c.rows.push([{ v: g.label, s: 'cellBold' }, null]);
    for (const x of g.items)
      c.rows.push([
        { v: `   ${x.label}`, s: 'cell' },
        x.value === null
          ? { v: '—', s: 'cellCenter' }
          : x.unit === 'PERCENT'
            ? {
                v: `${D(x.value).times(100).toDecimalPlaces(2).toFixed(2).replace('.', ',')}%`,
                s: 'cellCenter',
              }
            : {
                v: `${D(x.value).toDecimalPlaces(2).toFixed(2).replace('.', ',')}${x.unit === 'DAYS' ? ' ngày' : ' lần'}`,
                s: 'cellCenter',
              },
      ]);
  }
  const ratios: XSheet = { name: 'Chỉ số tài chính', cols: [52, 18], rows: c.rows, merges: c.merges };

  const bytes = buildXlsx([journal, trial, b02, b01, ratios], {
    title: `Sổ kế toán và báo cáo tài chính ${b.from} – ${b.to}`,
    author: 'ARGOLET',
    created: now,
  });
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    filename: `so-ke-toan-${b.from}-den-${b.to}.xlsx`,
    mime: XLSX_MIME,
    contentBase64: btoa(bin),
  };
}
