/**
 * Kế toán kép tự động — chứng từ đã xác nhận → bút toán → sổ cái → báo cáo tài chính → chỉ số.
 *
 * Hệ thống tài khoản theo Thông tư 99/2025/TT-BTC (doanh nghiệp, thay Thông tư 200 từ 01/01/2026) và
 * Thông tư 133/2016/TT-BTC (doanh nghiệp nhỏ và vừa). Mọi số tiền tính bằng số thập phân chính xác;
 * mỗi bút toán phải cân (tổng Nợ = tổng Có) nếu không sẽ bị từ chối.
 *
 * Bút toán cuối mỗi tháng: kết chuyển giá vốn nguyên liệu, hàng hóa (theo kiểm kê nếu có), khấu trừ
 * thuế GTGT, tạm tính thuế TNDN lũy kế từ đầu năm, kết chuyển doanh thu – chi phí sang 911 và lợi
 * nhuận sang 4212; sang năm mới, lợi nhuận năm trước chuyển từ 4212 sang 4211.
 *
 * Báo cáo kết quả hoạt động kinh doanh theo mẫu B02-DN (TT99) / B02-DNN (TT133); báo cáo tình hình
 * tài chính theo nhóm chỉ tiêu; chỉ số tài chính tính từ chính hai báo cáo đó.
 */
import { D, dec, type Decimal, type DecimalInput } from './decimal';

export type Regime = 'TT99' | 'TT133';

export type AccountType =
  'ASSET' | 'CONTRA_ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'CONTRA_REVENUE' | 'EXPENSE' | 'RESULT';

export interface Account {
  code: string;
  name: string;
  type: AccountType;
}

const COMMON: Account[] = [
  { code: '111', name: 'Tiền mặt', type: 'ASSET' },
  { code: '112', name: 'Tiền gửi ngân hàng', type: 'ASSET' },
  { code: '131', name: 'Phải thu của khách hàng', type: 'ASSET' },
  { code: '1331', name: 'Thuế GTGT được khấu trừ của hàng hóa, dịch vụ', type: 'ASSET' },
  { code: '152', name: 'Nguyên liệu, vật liệu', type: 'ASSET' },
  { code: '156', name: 'Hàng hóa', type: 'ASSET' },
  { code: '211', name: 'Tài sản cố định hữu hình', type: 'ASSET' },
  { code: '214', name: 'Hao mòn tài sản cố định', type: 'CONTRA_ASSET' },
  { code: '331', name: 'Phải trả cho người bán', type: 'LIABILITY' },
  { code: '33311', name: 'Thuế GTGT đầu ra', type: 'LIABILITY' },
  { code: '3334', name: 'Thuế thu nhập doanh nghiệp', type: 'LIABILITY' },
  { code: '334', name: 'Phải trả người lao động', type: 'LIABILITY' },
  { code: '341', name: 'Vay và nợ thuê tài chính', type: 'LIABILITY' },
  { code: '4111', name: 'Vốn góp của chủ sở hữu', type: 'EQUITY' },
  { code: '4211', name: 'Lợi nhuận sau thuế chưa phân phối năm trước', type: 'EQUITY' },
  { code: '4212', name: 'Lợi nhuận sau thuế chưa phân phối năm nay', type: 'EQUITY' },
  { code: '511', name: 'Doanh thu bán hàng và cung cấp dịch vụ', type: 'REVENUE' },
  { code: '515', name: 'Doanh thu hoạt động tài chính', type: 'REVENUE' },
  { code: '632', name: 'Giá vốn hàng bán', type: 'EXPENSE' },
  { code: '635', name: 'Chi phí tài chính', type: 'EXPENSE' },
  { code: '711', name: 'Thu nhập khác', type: 'REVENUE' },
  { code: '811', name: 'Chi phí khác', type: 'EXPENSE' },
  { code: '911', name: 'Xác định kết quả kinh doanh', type: 'RESULT' },
];

const ONLY: Record<Regime, Account[]> = {
  TT99: [
    { code: '521', name: 'Các khoản giảm trừ doanh thu', type: 'CONTRA_REVENUE' },
    { code: '641', name: 'Chi phí bán hàng', type: 'EXPENSE' },
    { code: '642', name: 'Chi phí quản lý doanh nghiệp', type: 'EXPENSE' },
    { code: '8211', name: 'Chi phí thuế thu nhập doanh nghiệp hiện hành', type: 'EXPENSE' },
  ],
  TT133: [
    { code: '6421', name: 'Chi phí bán hàng', type: 'EXPENSE' },
    { code: '6422', name: 'Chi phí quản lý doanh nghiệp', type: 'EXPENSE' },
    { code: '821', name: 'Chi phí thuế thu nhập doanh nghiệp', type: 'EXPENSE' },
  ],
};

/** The accounts that play the same role under each regime. */
export interface RegimeAccounts {
  /** Hàng bán bị trả lại, chiết khấu, giảm giá: 521 (TT99) — TT133 ghi giảm thẳng 511. */
  returns: string;
  selling: string;
  admin: string;
  cit: string;
}
export const REGIME_ACCOUNTS: Record<Regime, RegimeAccounts> = {
  TT99: { returns: '521', selling: '641', admin: '642', cit: '8211' },
  TT133: { returns: '511', selling: '6421', admin: '6422', cit: '821' },
};

export function chartOfAccounts(regime: Regime): Account[] {
  return [...COMMON, ...ONLY[regime]].sort((a, b) => a.code.localeCompare(b.code));
}

const chartMaps: Partial<Record<Regime, Map<string, Account>>> = {};
function chart(regime: Regime): Map<string, Account> {
  return (chartMaps[regime] ??= new Map(chartOfAccounts(regime).map((a) => [a.code, a])));
}
export function accountName(regime: Regime, code: string): string {
  return chart(regime).get(code)?.name ?? code;
}

/** Balance-sheet accounts a business may open its books with. */
export const OPENING_ACCOUNTS = [
  '111',
  '112',
  '131',
  '1331',
  '152',
  '156',
  '211',
  '214',
  '331',
  '33311',
  '3334',
  '334',
  '341',
  '4111',
  '4211',
] as const;

// ───────────────────────── journal ─────────────────────────

/** What a line means for the analysis (variable cost, interest…), independent of the regime. */
export type LineTag = 'VARIABLE' | 'INTEREST';

export interface JournalLine {
  account: string;
  debit: string;
  credit: string;
  tags?: LineTag[] | undefined;
}

export type EntryKind = 'OPENING' | 'DOCUMENT' | 'BANK' | 'PERIOD_END' | 'CLOSING' | 'YEAR_END';

export interface JournalEntry {
  id: string;
  date: string;
  periodId: string;
  ref: string;
  description: string;
  kind: EntryKind;
  documentId: string | null;
  lines: JournalLine[];
}

const ZERO = D(0);
const pos = (v: DecimalInput) => D(v).gt(0);
const periodOfDate = (date: string) => date.slice(0, 7);

function line(account: string, debit: Decimal, credit: Decimal, tags?: LineTag[]): JournalLine {
  return { account, debit: dec(debit), credit: dec(credit), ...(tags?.length ? { tags } : {}) };
}
const dr = (account: string, v: DecimalInput, tags?: LineTag[]) => line(account, D(v), ZERO, tags);
const cr = (account: string, v: DecimalInput, tags?: LineTag[]) => line(account, ZERO, D(v), tags);

/** Builds an entry; refuses one that does not balance or holds a negative amount. */
export function journalEntry(e: Omit<JournalEntry, 'lines'> & { lines: JournalLine[] }): JournalEntry {
  const lines = e.lines.filter((l) => !D(l.debit).isZero() || !D(l.credit).isZero());
  for (const l of lines) {
    if (D(l.debit).isNegative() || D(l.credit).isNegative())
      throw new RangeError(`Bút toán ${e.ref}: số tiền không được âm`);
  }
  const debit = lines.reduce((t, l) => t.plus(l.debit), ZERO);
  const credit = lines.reduce((t, l) => t.plus(l.credit), ZERO);
  if (!debit.eq(credit))
    throw new RangeError(`Bút toán ${e.ref} không cân: Nợ ${debit.toFixed()} ≠ Có ${credit.toFixed()}`);
  return { ...e, lines };
}

// ───────────────────────── classification ─────────────────────────

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

export type CostGroup = 'INVENTORY' | 'SELLING' | 'ADMIN' | 'FINANCE' | 'OTHER';

export interface CostClass {
  /** Debit account of the cost (or of the inventory it buys). */
  account: string;
  group: CostGroup;
  /** Varies with sales (for operating leverage and break-even). */
  variable: boolean;
  interest: boolean;
  /** Credit account forced by the nature of the cost (payroll, depreciation), else the payment. */
  credit?: string;
}

/**
 * Account of a purchase / cost from its supplier and description (Vietnamese, with or without accents).
 * Materials and goods go to inventory (152 / 156) and reach cost of sales at month end.
 */
export function classifyCost(text: string, regime: Regime): CostClass {
  const t = fold(text);
  const r = REGIME_ACCOUNTS[regime];
  const has = (re: RegExp) => re.test(t);
  if (has(/lai vay|lai tien vay|tien lai vay|chi phi lai/))
    return { account: '635', group: 'FINANCE', variable: false, interest: true };
  if (has(/tien phat|bi phat|nop phat|phat vi pham|phat cham|xu phat/))
    return { account: '811', group: 'OTHER', variable: false, interest: false };
  if (has(/khau hao/))
    return { account: r.admin, group: 'ADMIN', variable: false, interest: false, credit: '214' };
  if (has(/luong|tien cong|bao hiem xa hoi|bhxh|phu cap/))
    return { account: r.admin, group: 'ADMIN', variable: false, interest: false, credit: '334' };
  if (has(/van chuyen|van tai|giao hang|chuyen phat|boc xep|ship|xang|dau diesel|nhien lieu|hoa hong ban/))
    return { account: r.selling, group: 'SELLING', variable: true, interest: false };
  if (has(/quang cao|marketing|khuyen mai|tiep thi/))
    return { account: r.selling, group: 'SELLING', variable: false, interest: false };
  if (has(/nguyen lieu|vat lieu|bao bi|\bbot\b|\bsua\b|ca phe|duong|thuc pham|nong san|hat|tra |trai cay/))
    return { account: '152', group: 'INVENTORY', variable: true, interest: false };
  if (has(/hang hoa|nhap hang|mua hang|phieu nhap/))
    return { account: '156', group: 'INVENTORY', variable: true, interest: false };
  return { account: r.admin, group: 'ADMIN', variable: false, interest: false };
}

/** Counter account of money received, from the bank line text. */
export function classifyReceipt(text: string): string {
  const t = fold(text);
  if (/giai ngan|khoan vay|nhan no vay/.test(t)) return '341';
  if (/gop von|von gop|tang von/.test(t)) return '4111';
  if (/lai tien gui|lai khong ky han|tra lai tien gui/.test(t)) return '515';
  return '131';
}

/** Counter account of money paid out of the bank, from the line text. */
export function classifyPayment(text: string, regime: Regime): { account: string; tags?: LineTag[] } {
  const t = fold(text);
  if (/tra no vay|tra goc|tat toan khoan vay/.test(t)) return { account: '341' };
  if (/lai vay/.test(t)) return { account: '635', tags: ['INTEREST'] };
  if (/luong|tien cong/.test(t)) return { account: '334' };
  if (/thue gtgt|gia tri gia tang/.test(t)) return { account: '33311' };
  if (/thue tndn|thu nhap doanh nghiep/.test(t)) return { account: '3334' };
  if (/phi ngan hang|phi chuyen|phi dich vu ngan hang|phi sms|phi quan ly tai khoan/.test(t))
    return { account: REGIME_ACCOUNTS[regime].admin };
  return { account: '331' };
}

// ───────────────────────── business events ─────────────────────────

interface EventBase {
  id: string;
  date: string;
  ref: string;
  party: string;
  documentId?: string | null | undefined;
}

export type LedgerEvent =
  /** Hóa đơn bán ra / doanh thu tại quầy: tiền mặt thu ngay, còn lại phải thu khách hàng. */
  | (EventBase & { kind: 'SALE'; net: string; vat: string; cash: boolean })
  /** Đơn bán qua nền tảng: doanh thu gộp, hoàn tiền / chiết khấu và phí nền tảng trừ vào khoản phải thu. */
  | (EventBase & { kind: 'PLATFORM_SALE'; gross: string; refund: string; discount: string; fee: string })
  /** Tiền về tài khoản / thu tiền mặt. */
  | (EventBase & { kind: 'RECEIPT'; amount: string; via: 'BANK' | 'CASH'; text: string })
  /** Hóa đơn, phiếu mua vào: chi phí hoặc hàng tồn kho, thuế GTGT đầu vào, phải trả người bán hoặc trả tiền mặt. */
  | (EventBase & { kind: 'PURCHASE'; net: string; vat: string; text: string; onCredit: boolean })
  /** Tiền chi khỏi tài khoản ngân hàng (sao kê). */
  | (EventBase & { kind: 'PAYMENT'; amount: string; text: string });

/** The journal entry of one confirmed business event. */
export function postEvent(e: LedgerEvent, regime: Regime): JournalEntry {
  const r = REGIME_ACCOUNTS[regime];
  const base = {
    id: e.id,
    date: e.date,
    periodId: periodOfDate(e.date),
    ref: e.ref,
    documentId: e.documentId ?? null,
  };
  switch (e.kind) {
    case 'SALE': {
      const total = D(e.net).plus(e.vat);
      return journalEntry({
        ...base,
        kind: 'DOCUMENT',
        description: `Doanh thu bán hàng · ${e.party || 'khách lẻ'}`,
        lines: [dr(e.cash ? '111' : '131', total), cr('511', e.net), cr('33311', e.vat)],
      });
    }
    case 'PLATFORM_SALE': {
      const returns = D(e.refund).plus(e.discount);
      return journalEntry({
        ...base,
        kind: 'DOCUMENT',
        description: `Doanh thu bán qua ${e.party || 'nền tảng'}`,
        lines: [
          dr('131', e.gross),
          cr('511', e.gross),
          dr(r.returns, returns),
          cr('131', returns),
          dr(r.selling, e.fee, ['VARIABLE']),
          cr('131', e.fee),
        ],
      });
    }
    case 'RECEIPT': {
      const counter = classifyReceipt(e.text);
      return journalEntry({
        ...base,
        kind: 'BANK',
        description: counter === '131' ? `Thu tiền · ${e.party || 'khách hàng'}` : `Thu tiền · ${e.text}`,
        lines: [dr(e.via === 'CASH' ? '111' : '112', e.amount), cr(counter, e.amount)],
      });
    }
    case 'PURCHASE': {
      const c = classifyCost(`${e.party} ${e.text}`, regime);
      const total = D(e.net).plus(e.vat);
      const tags: LineTag[] = [
        ...(c.variable && c.group !== 'INVENTORY' ? (['VARIABLE'] as const) : []),
        ...(c.interest ? (['INTEREST'] as const) : []),
      ];
      return journalEntry({
        ...base,
        kind: 'DOCUMENT',
        description: `${c.group === 'INVENTORY' ? 'Mua' : 'Chi phí'} · ${e.party || e.text}`,
        lines: [
          dr(c.account, e.net, tags),
          dr('1331', e.vat),
          cr(c.credit ?? (e.onCredit ? '331' : '111'), total),
        ],
      });
    }
    case 'PAYMENT': {
      const p = classifyPayment(e.text, regime);
      return journalEntry({
        ...base,
        kind: 'BANK',
        description: `Chi tiền · ${e.party || e.text}`,
        lines: [dr(p.account, e.amount, p.tags), cr('112', e.amount)],
      });
    }
  }
}

// ───────────────────────── balances ─────────────────────────

/** Signed balance per account (debit positive) of the given entries. */
export function balances(entries: Iterable<JournalEntry>): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const e of entries)
    for (const l of e.lines) m.set(l.account, (m.get(l.account) ?? ZERO).plus(l.debit).minus(l.credit));
  return m;
}
const bal = (m: Map<string, Decimal>, ...codes: string[]) =>
  codes.reduce((t, c) => t.plus(m.get(c) ?? ZERO), ZERO);

const PL_TYPES = new Set<AccountType>(['REVENUE', 'CONTRA_REVENUE', 'EXPENSE']);

// ───────────────────────── the ledger ─────────────────────────

export interface LedgerInput {
  regime: Regime;
  /** Consecutive months to book, oldest first ("YYYY-MM"). */
  periods: string[];
  events: LedgerEvent[];
  /** Balances at the start of the first month (signed: debit positive), balance-sheet accounts only. */
  opening?: Record<string, string> | undefined;
  /** Inventory counted at the end of a month (152 + 156), by month. */
  stockCounts?: Record<string, string> | undefined;
  /** Corporate income tax rate (0.2 = 20%). */
  citRate: DecimalInput;
}

export interface Ledger {
  regime: Regime;
  periods: string[];
  entries: JournalEntry[];
  warnings: string[];
}

const lastDay = (periodId: string) => {
  const [y, m] = periodId.split('-').map(Number) as [number, number];
  return `${periodId}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
export const daysInPeriod = (periodId: string) => Number(lastDay(periodId).slice(8));

/**
 * Books every event, then closes each month: cost of goods used or sold, VAT offset, provisional
 * corporate income tax (year to date) and the transfer of revenue and costs to the result.
 */
export function buildLedger(input: LedgerInput): Ledger {
  const { regime, periods } = input;
  const r = REGIME_ACCOUNTS[regime];
  const accounts = chart(regime);
  const warnings: string[] = [];
  const entries: JournalEntry[] = [];
  const first = periods[0];
  if (!first) return { regime, periods, entries, warnings };

  if (input.opening) {
    const lines: JournalLine[] = [];
    for (const [code, v] of Object.entries(input.opening)) {
      if (!(OPENING_ACCOUNTS as readonly string[]).includes(code))
        throw new RangeError(`Tài khoản ${code} không nhập số dư đầu kỳ được`);
      const x = D(v);
      if (x.isZero()) continue;
      lines.push(x.gt(0) ? dr(code, x) : cr(code, x.abs()));
    }
    if (lines.length)
      entries.push(
        journalEntry({
          id: `opening-${first}`,
          date: `${first}-01`,
          periodId: first,
          ref: 'SDĐK',
          description: 'Số dư đầu kỳ',
          kind: 'OPENING',
          documentId: null,
          lines,
        }),
      );
  }

  const wanted = new Set(periods);
  const byPeriod = new Map<string, JournalEntry[]>();
  for (const ev of [...input.events].sort(
    (a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref),
  )) {
    const p = periodOfDate(ev.date);
    if (!wanted.has(p)) continue;
    const list = byPeriod.get(p) ?? [];
    list.push(postEvent(ev, regime));
    byPeriod.set(p, list);
  }

  const rate = D(input.citRate);
  let year = first.slice(0, 4);
  let ytdPbt = ZERO;
  let ytdCit = ZERO;

  for (const p of periods) {
    const end = lastDay(p);
    const make = (key: string, description: string, lines: JournalLine[], kind: EntryKind = 'PERIOD_END') =>
      journalEntry({
        id: `${key}-${p}`,
        date: end,
        periodId: p,
        ref: `KC-${p}`,
        description,
        kind,
        documentId: null,
        lines,
      });

    // New year: last year's profit moves from 4212 to 4211, the tax provision starts again.
    if (p.slice(0, 4) !== year) {
      year = p.slice(0, 4);
      ytdPbt = ZERO;
      ytdCit = ZERO;
      const carried = bal(balances(entries), '4212');
      if (!carried.isZero())
        entries.push(
          journalEntry({
            id: `year-${p}`,
            date: `${p}-01`,
            periodId: p,
            ref: `KC-${year}`,
            description: 'Kết chuyển lợi nhuận năm trước',
            kind: 'YEAR_END',
            documentId: null,
            lines: carried.lt(0)
              ? [dr('4212', carried.abs()), cr('4211', carried.abs())]
              : [dr('4211', carried), cr('4212', carried)],
          }),
        );
    }

    const opening = balances(entries);
    const month = byPeriod.get(p) ?? [];
    entries.push(...month);

    // 1 · Giá vốn: nguyên liệu, hàng hóa mua trong tháng — theo kiểm kê cuối tháng nếu có.
    const bought = (code: string) =>
      month.reduce(
        (t, e) =>
          t.plus(
            e.lines.filter((l) => l.account === code).reduce((s, l) => s.plus(l.debit).minus(l.credit), ZERO),
          ),
        ZERO,
      );
    const purchases = { '152': bought('152'), '156': bought('156') };
    const count = input.stockCounts?.[p];
    let used = { '152': purchases['152'], '156': purchases['156'] };
    if (count !== undefined && count !== '') {
      const available = {
        '152': bal(opening, '152').plus(purchases['152']),
        '156': bal(opening, '156').plus(purchases['156']),
      };
      const totalAvailable = available['152'].plus(available['156']);
      const cogs = totalAvailable.minus(count);
      if (cogs.isNegative()) {
        warnings.push(
          `Kiểm kê ${p.slice(5)}/${p.slice(0, 4)} lớn hơn tồn đầu kỳ cộng mua trong kỳ: kiểm tra chứng từ mua vào hoặc số dư đầu kỳ.`,
        );
      } else {
        const share152 = totalAvailable.isZero()
          ? ZERO
          : cogs.times(available['152']).div(totalAvailable).toDecimalPlaces(0);
        used = { '152': share152, '156': cogs.minus(share152) };
      }
    }
    const cogsLines: JournalLine[] = [];
    for (const code of ['152', '156'] as const) {
      if (pos(used[code])) cogsLines.push(dr('632', used[code], ['VARIABLE']), cr(code, used[code]));
    }
    if (cogsLines.length)
      entries.push(make('cogs', 'Kết chuyển giá vốn nguyên liệu, hàng hóa đã dùng, đã bán', cogsLines));

    // 2 · Khấu trừ thuế GTGT đầu vào với đầu ra.
    const now = balances(entries);
    const outVat = bal(now, '33311').neg();
    const inVat = bal(now, '1331');
    const offset = Decimal_min(outVat, inVat);
    if (pos(offset))
      entries.push(make('vat', 'Khấu trừ thuế GTGT', [dr('33311', offset), cr('1331', offset)]));

    // 3 · Tạm tính thuế TNDN trên lợi nhuận lũy kế từ đầu năm.
    const monthEntries = entries.filter((e) => e.periodId === p && e.kind !== 'CLOSING');
    const plMonth = balances(monthEntries);
    let pbt = ZERO;
    for (const [code, v] of plMonth) {
      const a = accounts.get(code);
      if (a && PL_TYPES.has(a.type) && code !== r.cit) pbt = pbt.minus(v);
    }
    ytdPbt = ytdPbt.plus(pbt);
    const target = Decimal_max(ytdPbt, ZERO).times(rate).toDecimalPlaces(0);
    const citDelta = target.minus(ytdCit);
    if (!citDelta.isZero()) {
      entries.push(
        make(
          'cit',
          citDelta.gt(0) ? 'Tạm tính thuế thu nhập doanh nghiệp' : 'Giảm thuế thu nhập doanh nghiệp tạm tính',
          citDelta.gt(0)
            ? [dr(r.cit, citDelta), cr('3334', citDelta)]
            : [dr('3334', citDelta.abs()), cr(r.cit, citDelta.abs())],
        ),
      );
      ytdCit = target;
    }

    // 4 · Kết chuyển doanh thu, chi phí sang 911 và lợi nhuận sang 4212.
    const pl = balances(entries.filter((e) => e.periodId === p && e.kind !== 'CLOSING'));
    if (regime === 'TT99') {
      const returns = bal(pl, '521');
      if (!returns.isZero())
        entries.push(
          make(
            'k521',
            'Kết chuyển các khoản giảm trừ doanh thu',
            [dr('511', returns), cr('521', returns)],
            'CLOSING',
          ),
        );
      pl.set('511', bal(pl, '511').plus(returns));
      pl.set('521', ZERO);
    }
    const closing: JournalLine[] = [];
    let result = ZERO;
    for (const [code, v] of [...pl].sort(([a], [b]) => a.localeCompare(b))) {
      const a = accounts.get(code);
      if (!a || !PL_TYPES.has(a.type) || v.isZero()) continue;
      result = result.minus(v);
      // A credit balance (revenue) is debited out to 911; a debit balance (cost) is credited out.
      closing.push(v.lt(0) ? dr(code, v.abs()) : cr(code, v));
      closing.push(v.lt(0) ? cr('911', v.abs()) : dr('911', v));
    }
    if (!result.isZero()) closing.push(result.gt(0) ? dr('911', result) : cr('911', result.abs()));
    if (!result.isZero()) closing.push(result.gt(0) ? cr('4212', result) : dr('4212', result.abs()));
    if (closing.length)
      entries.push(make('close', 'Kết chuyển xác định kết quả kinh doanh', closing, 'CLOSING'));
  }
  return { regime, periods, entries, warnings };
}

function Decimal_min(a: Decimal, b: Decimal) {
  return a.lt(b) ? a : b;
}
function Decimal_max(a: Decimal, b: Decimal) {
  return a.gt(b) ? a : b;
}

// ───────────────────────── statements ─────────────────────────

const inRange = (p: string, from: string, to: string) => p >= from && p <= to;

export interface TrialRow {
  account: string;
  name: string;
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
  closingDebit: string;
  closingCredit: string;
}

/** Bảng cân đối tài khoản: số dư đầu kỳ, phát sinh trong kỳ, số dư cuối kỳ của mỗi tài khoản. */
export function trialBalance(ledger: Ledger, from: string, to: string): TrialRow[] {
  const before = balances(ledger.entries.filter((e) => e.periodId < from));
  const during = ledger.entries.filter((e) => inRange(e.periodId, from, to));
  const moves = new Map<string, { d: Decimal; c: Decimal }>();
  for (const e of during)
    for (const l of e.lines) {
      const m = moves.get(l.account) ?? { d: ZERO, c: ZERO };
      moves.set(l.account, { d: m.d.plus(l.debit), c: m.c.plus(l.credit) });
    }
  const codes = [...new Set([...before.keys(), ...moves.keys()])].sort();
  return codes
    .map((code) => {
      const o = before.get(code) ?? ZERO;
      const m = moves.get(code) ?? { d: ZERO, c: ZERO };
      const c = o.plus(m.d).minus(m.c);
      return {
        account: code,
        name: accountName(ledger.regime, code),
        openingDebit: dec(o.gt(0) ? o : ZERO),
        openingCredit: dec(o.lt(0) ? o.abs() : ZERO),
        debit: dec(m.d),
        credit: dec(m.c),
        closingDebit: dec(c.gt(0) ? c : ZERO),
        closingCredit: dec(c.lt(0) ? c.abs() : ZERO),
      };
    })
    .filter((x) => [x.openingDebit, x.openingCredit, x.debit, x.credit].some((v) => v !== '0'));
}

export interface IncomeFigures {
  grossSales: string;
  returns: string;
  netRevenue: string;
  cogs: string;
  grossProfit: string;
  financialIncome: string;
  financialExpense: string;
  interest: string;
  selling: string;
  admin: string;
  operatingProfit: string;
  otherIncome: string;
  otherExpense: string;
  otherProfit: string;
  profitBeforeTax: string;
  cit: string;
  profitAfterTax: string;
  /** EBIT = lợi nhuận trước thuế + chi phí lãi vay. */
  ebit: string;
  variableCosts: string;
}

export interface StatementLine {
  code: string;
  label: string;
  value: string;
  strong?: boolean;
}

/** Báo cáo kết quả hoạt động kinh doanh (B02-DN / B02-DNN) of the months from–to. */
export function incomeStatement(
  ledger: Ledger,
  from: string,
  to: string,
): { figures: IncomeFigures; lines: StatementLine[] } {
  const r = REGIME_ACCOUNTS[ledger.regime];
  const during = ledger.entries.filter(
    (e) => inRange(e.periodId, from, to) && e.kind !== 'CLOSING' && e.kind !== 'OPENING',
  );
  let grossSales = ZERO;
  let returns = ZERO;
  let interest = ZERO;
  let variable = ZERO;
  const net = new Map<string, Decimal>();
  for (const e of during)
    for (const l of e.lines) {
      net.set(l.account, (net.get(l.account) ?? ZERO).plus(l.debit).minus(l.credit));
      if (l.account === '511') {
        grossSales = grossSales.plus(l.credit);
        returns = returns.plus(l.debit);
      }
      if (l.account === '521') returns = returns.plus(l.debit).minus(l.credit);
      if (l.tags?.includes('INTEREST')) interest = interest.plus(l.debit).minus(l.credit);
      if (l.tags?.includes('VARIABLE')) variable = variable.plus(l.debit).minus(l.credit);
    }
  const costOf = (...codes: string[]) => bal(net, ...codes);
  const incomeOf = (...codes: string[]) => bal(net, ...codes).neg();
  const netRevenue = grossSales.minus(returns);
  const cogs = costOf('632');
  const grossProfit = netRevenue.minus(cogs);
  const financialIncome = incomeOf('515');
  const financialExpense = costOf('635');
  const selling = costOf(r.selling);
  const admin = costOf(r.admin);
  const operatingProfit = grossProfit
    .plus(financialIncome)
    .minus(financialExpense)
    .minus(selling)
    .minus(admin);
  const otherIncome = incomeOf('711');
  const otherExpense = costOf('811');
  const otherProfit = otherIncome.minus(otherExpense);
  const profitBeforeTax = operatingProfit.plus(otherProfit);
  const cit = costOf(r.cit);
  const profitAfterTax = profitBeforeTax.minus(cit);
  const figures: IncomeFigures = {
    grossSales: dec(grossSales),
    returns: dec(returns),
    netRevenue: dec(netRevenue),
    cogs: dec(cogs),
    grossProfit: dec(grossProfit),
    financialIncome: dec(financialIncome),
    financialExpense: dec(financialExpense),
    interest: dec(interest),
    selling: dec(selling),
    admin: dec(admin),
    operatingProfit: dec(operatingProfit),
    otherIncome: dec(otherIncome),
    otherExpense: dec(otherExpense),
    otherProfit: dec(otherProfit),
    profitBeforeTax: dec(profitBeforeTax),
    cit: dec(cit),
    profitAfterTax: dec(profitAfterTax),
    ebit: dec(profitBeforeTax.plus(interest)),
    variableCosts: dec(variable),
  };
  const L = (code: string, label: string, v: Decimal, strong = false): StatementLine => ({
    code,
    label,
    value: dec(v),
    ...(strong ? { strong } : {}),
  });
  const lines: StatementLine[] = [
    L('01', 'Doanh thu bán hàng và cung cấp dịch vụ', grossSales),
    L('02', 'Các khoản giảm trừ doanh thu', returns),
    L('10', 'Doanh thu thuần về bán hàng và cung cấp dịch vụ', netRevenue, true),
    L('11', 'Giá vốn hàng bán', cogs),
    L('20', 'Lợi nhuận gộp về bán hàng và cung cấp dịch vụ', grossProfit, true),
    L('21', 'Doanh thu hoạt động tài chính', financialIncome),
    L('22', 'Chi phí tài chính', financialExpense),
    L('23', 'Trong đó: Chi phí lãi vay', interest),
    ...(ledger.regime === 'TT99'
      ? [L('25', 'Chi phí bán hàng', selling), L('26', 'Chi phí quản lý doanh nghiệp', admin)]
      : [L('24', 'Chi phí quản lý kinh doanh', selling.plus(admin))]),
    L('30', 'Lợi nhuận thuần từ hoạt động kinh doanh', operatingProfit, true),
    L('31', 'Thu nhập khác', otherIncome),
    L('32', 'Chi phí khác', otherExpense),
    L('40', 'Lợi nhuận khác', otherProfit),
    L('50', 'Tổng lợi nhuận kế toán trước thuế', profitBeforeTax, true),
    L('51', 'Chi phí thuế thu nhập doanh nghiệp', cit),
    L('60', 'Lợi nhuận sau thuế thu nhập doanh nghiệp', profitAfterTax, true),
  ];
  return { figures, lines };
}

export interface BalanceFigures {
  cash: string;
  receivables: string;
  supplierAdvances: string;
  inventory: string;
  vatDeductible: string;
  otherCurrentAssets: string;
  currentAssets: string;
  fixedAssetCost: string;
  accumulatedDepreciation: string;
  fixedAssets: string;
  totalAssets: string;
  payables: string;
  customerAdvances: string;
  taxes: string;
  payroll: string;
  loans: string;
  liabilities: string;
  capital: string;
  retainedEarnings: string;
  equity: string;
  totalSources: string;
  balanced: boolean;
}

/** Báo cáo tình hình tài chính at the end of a month (or before the first month when `at` is null). */
export function balanceSheet(
  ledger: Ledger,
  at: string | null,
): { figures: BalanceFigures; lines: StatementLine[] } {
  const first = ledger.periods[0] ?? '';
  const m = balances(
    ledger.entries.filter((e) =>
      at === null ? e.periodId === first && e.kind === 'OPENING' : e.periodId <= at,
    ),
  );
  const debitPart = (code: string) => Decimal_max(bal(m, code), ZERO);
  const creditPart = (code: string) => Decimal_max(bal(m, code).neg(), ZERO);
  const cash = bal(m, '111', '112');
  const receivables = debitPart('131');
  const supplierAdvances = debitPart('331');
  const inventory = bal(m, '152', '156');
  const vatDeductible = debitPart('1331');
  const otherCurrentAssets = debitPart('33311').plus(debitPart('3334')).plus(debitPart('334'));
  const currentAssets = cash
    .plus(receivables)
    .plus(supplierAdvances)
    .plus(inventory)
    .plus(vatDeductible)
    .plus(otherCurrentAssets);
  const fixedAssetCost = bal(m, '211');
  const accumulatedDepreciation = bal(m, '214').neg();
  const fixedAssets = fixedAssetCost.minus(accumulatedDepreciation);
  const totalAssets = currentAssets.plus(fixedAssets);
  const payables = creditPart('331');
  const customerAdvances = creditPart('131');
  const taxes = creditPart('33311').plus(creditPart('3334'));
  const payroll = creditPart('334');
  const loans = bal(m, '341').neg();
  const liabilities = payables.plus(customerAdvances).plus(taxes).plus(payroll).plus(loans);
  const capital = bal(m, '4111').neg();
  // Profit of months not yet closed (none after closing) still belongs to the owners.
  let open = ZERO;
  const accounts = chart(ledger.regime);
  for (const [code, v] of m) {
    const a = accounts.get(code);
    if (a && (PL_TYPES.has(a.type) || a.type === 'RESULT')) open = open.minus(v);
  }
  const retainedEarnings = bal(m, '4211', '4212').neg().plus(open);
  const equity = capital.plus(retainedEarnings);
  const totalSources = liabilities.plus(equity);
  const figures: BalanceFigures = {
    cash: dec(cash),
    receivables: dec(receivables),
    supplierAdvances: dec(supplierAdvances),
    inventory: dec(inventory),
    vatDeductible: dec(vatDeductible),
    otherCurrentAssets: dec(otherCurrentAssets),
    currentAssets: dec(currentAssets),
    fixedAssetCost: dec(fixedAssetCost),
    accumulatedDepreciation: dec(accumulatedDepreciation),
    fixedAssets: dec(fixedAssets),
    totalAssets: dec(totalAssets),
    payables: dec(payables),
    customerAdvances: dec(customerAdvances),
    taxes: dec(taxes),
    payroll: dec(payroll),
    loans: dec(loans),
    liabilities: dec(liabilities),
    capital: dec(capital),
    retainedEarnings: dec(retainedEarnings),
    equity: dec(equity),
    totalSources: dec(totalSources),
    balanced: totalAssets.eq(totalSources),
  };
  const L = (code: string, label: string, v: Decimal, strong = false): StatementLine => ({
    code,
    label,
    value: dec(v),
    ...(strong ? { strong } : {}),
  });
  const lines: StatementLine[] = [
    L('A', 'Tài sản ngắn hạn', currentAssets, true),
    L('A1', 'Tiền', cash),
    L('A2', 'Phải thu của khách hàng', receivables),
    L('A3', 'Trả trước cho người bán', supplierAdvances),
    L('A4', 'Hàng tồn kho', inventory),
    L('A5', 'Thuế GTGT được khấu trừ', vatDeductible),
    L('A6', 'Tài sản ngắn hạn khác', otherCurrentAssets),
    L('B', 'Tài sản dài hạn', fixedAssets, true),
    L('B1', 'Nguyên giá tài sản cố định', fixedAssetCost),
    L('B2', 'Giá trị hao mòn lũy kế', accumulatedDepreciation.neg()),
    L('T', 'Tổng cộng tài sản', totalAssets, true),
    L('C', 'Nợ phải trả', liabilities, true),
    L('C1', 'Phải trả người bán', payables),
    L('C2', 'Người mua trả tiền trước', customerAdvances),
    L('C3', 'Thuế và các khoản phải nộp Nhà nước', taxes),
    L('C4', 'Phải trả người lao động', payroll),
    L('C5', 'Vay và nợ thuê tài chính', loans),
    L('D', 'Vốn chủ sở hữu', equity, true),
    L('D1', 'Vốn góp của chủ sở hữu', capital),
    L('D2', 'Lợi nhuận sau thuế chưa phân phối', retainedEarnings),
    L('N', 'Tổng cộng nguồn vốn', totalSources, true),
  ];
  return { figures, lines };
}

// ───────────────────────── ratios ─────────────────────────

export type RatioUnit = 'TIMES' | 'PERCENT' | 'DAYS';

export interface Ratio {
  key: string;
  label: string;
  value: string | null;
  unit: RatioUnit;
}
export interface RatioGroup {
  key: 'liquidity' | 'leverage' | 'efficiency' | 'profitability';
  label: string;
  items: Ratio[];
}

const q = (a: Decimal, b: Decimal) => (b.isZero() ? null : dec(a.div(b)));
const avg = (a: DecimalInput, b: DecimalInput) => D(a).plus(b).div(2);

/**
 * Financial ratios of the months from–to, from the income statement of the range and the balance
 * sheets at its start and end (averages for turnover and returns). Ratios whose denominator is zero
 * are not defined (null).
 */
export function financialRatios(p: {
  income: IncomeFigures;
  start: BalanceFigures;
  end: BalanceFigures;
  days: number;
}): {
  groups: RatioGroup[];
  leverageInputs: { revenue: string; variableCosts: string; fixedCosts: string; interest: string };
} {
  const { income: i, start: s, end: e } = p;
  const revenue = D(i.netRevenue);
  const pat = D(i.profitAfterTax);
  const ebit = D(i.ebit);
  const interest = D(i.interest);
  const variable = D(i.variableCosts);
  const contribution = revenue.minus(variable);
  const fixed = contribution.minus(ebit);
  const avgAssets = avg(s.totalAssets, e.totalAssets);
  const avgEquity = avg(s.equity, e.equity);
  const avgReceivables = avg(s.receivables, e.receivables);
  const avgInventory = avg(s.inventory, e.inventory);
  const avgPayables = avg(s.payables, e.payables);
  const days = D(p.days);
  const turnoverDays = (turnover: string | null) =>
    turnover === null || D(turnover).isZero() ? null : dec(days.div(turnover));
  const receivableTurnover = q(revenue, avgReceivables);
  const inventoryTurnover = q(D(i.cogs), avgInventory);
  const payableTurnover = q(D(i.cogs), avgPayables);
  const R = (key: string, label: string, value: string | null, unit: RatioUnit): Ratio => ({
    key,
    label,
    value,
    unit,
  });
  return {
    groups: [
      {
        key: 'liquidity',
        label: 'Khả năng thanh toán',
        items: [
          R('current', 'Thanh toán hiện hành', q(D(e.currentAssets), D(e.liabilities)), 'TIMES'),
          R('quick', 'Thanh toán nhanh', q(D(e.currentAssets).minus(e.inventory), D(e.liabilities)), 'TIMES'),
          R('cash', 'Thanh toán bằng tiền', q(D(e.cash), D(e.liabilities)), 'TIMES'),
          R('interestCover', 'Khả năng thanh toán lãi vay', q(ebit, interest), 'TIMES'),
        ],
      },
      {
        key: 'leverage',
        label: 'Cơ cấu vốn và đòn bẩy',
        items: [
          R('debtRatio', 'Hệ số nợ', q(D(e.liabilities), D(e.totalAssets)), 'PERCENT'),
          R('debtEquity', 'Hệ số nợ trên vốn chủ', q(D(e.liabilities), D(e.equity)), 'TIMES'),
          R('equityMultiplier', 'Hệ số nhân vốn chủ', q(avgAssets, avgEquity), 'TIMES'),
          R('dol', 'Đòn bẩy kinh doanh (DOL)', q(contribution, ebit), 'TIMES'),
          R('dfl', 'Đòn bẩy tài chính (DFL)', q(ebit, ebit.minus(interest)), 'TIMES'),
          R('dtl', 'Đòn bẩy tổng hợp (DTL)', q(contribution, ebit.minus(interest)), 'TIMES'),
        ],
      },
      {
        key: 'efficiency',
        label: 'Hiệu quả hoạt động',
        items: [
          R('assetTurnover', 'Vòng quay tổng tài sản', q(revenue, avgAssets), 'TIMES'),
          R('receivableTurnover', 'Vòng quay khoản phải thu', receivableTurnover, 'TIMES'),
          R('dso', 'Kỳ thu tiền bình quân', turnoverDays(receivableTurnover), 'DAYS'),
          R('inventoryTurnover', 'Vòng quay hàng tồn kho', inventoryTurnover, 'TIMES'),
          R('dio', 'Số ngày tồn kho bình quân', turnoverDays(inventoryTurnover), 'DAYS'),
          R('dpo', 'Số ngày trả tiền người bán bình quân', turnoverDays(payableTurnover), 'DAYS'),
        ],
      },
      {
        key: 'profitability',
        label: 'Khả năng sinh lời',
        items: [
          R('grossMargin', 'Tỷ suất lợi nhuận gộp', q(D(i.grossProfit), revenue), 'PERCENT'),
          R(
            'operatingMargin',
            'Tỷ suất lợi nhuận từ hoạt động kinh doanh',
            q(D(i.operatingProfit), revenue),
            'PERCENT',
          ),
          R('ros', 'Tỷ suất lợi nhuận trên doanh thu (ROS)', q(pat, revenue), 'PERCENT'),
          R('roa', 'Tỷ suất lợi nhuận trên tài sản (ROA)', q(pat, avgAssets), 'PERCENT'),
          R('roe', 'Tỷ suất lợi nhuận trên vốn chủ sở hữu (ROE)', q(pat, avgEquity), 'PERCENT'),
          R('basicEarningPower', 'Tỷ suất sinh lời kinh tế của tài sản (BEP)', q(ebit, avgAssets), 'PERCENT'),
        ],
      },
    ],
    leverageInputs: {
      revenue: dec(revenue),
      variableCosts: dec(variable),
      fixedCosts: dec(fixed),
      interest: dec(interest),
    },
  };
}
