/**
 * Accounting books of household / individual businesses on the Ministry of Finance's forms —
 * Thông tư 152/2025/TT-BTC (31/12/2025, hiệu lực 01/01/2026, thay Thông tư 88/2021/TT-BTC):
 *
 *  - S1a-HKD Sổ doanh thu bán hàng hóa, dịch vụ (không chịu thuế GTGT, không nộp thuế TNCN);
 *  - S2a-HKD Sổ doanh thu bán hàng hóa, dịch vụ (GTGT và TNCN theo tỷ lệ % trên doanh thu);
 *  - S2b-HKD Sổ doanh thu bán hàng hóa, dịch vụ, S2c-HKD Sổ chi tiết doanh thu, chi phí,
 *    S2e-HKD Sổ chi tiết tiền (GTGT theo % doanh thu, TNCN trên thu nhập tính thuế).
 *
 * Headings, column letters/numbers, row captions and signature lines follow the published forms
 * (Công báo số 51, 23/01/2026) word for word. Amounts are VND integers.
 */
import { D, dec } from './decimal';
import type { XCell, XSheet, XStyle } from './xlsx';

export type HkdTaxMethod = 'EXEMPT' | 'PERCENT' | 'INCOME';

export interface HkdHeader {
  name: string;
  address: string;
  taxCode: string;
  /** Địa điểm kinh doanh. */
  location: string;
  /** Kỳ kê khai, e.g. "Tháng 10/2026". */
  period: string;
}

export interface BookLine {
  /** Số hiệu chứng từ. */
  docNo: string;
  /** ISO date. */
  date: string;
  description: string;
  amount: string;
}

export interface BusinessLineBook {
  /** Ngành nghề, e.g. "Phân phối, cung cấp hàng hóa". */
  name: string;
  /** Tỷ lệ % thuế GTGT trên doanh thu ("1" = 1%), absent when not configured. */
  vatRate?: string | undefined;
  /** Tỷ lệ % (S2a) / thuế suất (S2c) thuế TNCN, absent when not configured. */
  pitRate?: string | undefined;
  lines: BookLine[];
}

/** Chi phí hợp lý, mục a)–e) of S2c-HKD. */
export type CostCategory = 'a' | 'b' | 'c' | 'd' | 'dd' | 'e';

export const COST_CATEGORIES: Record<CostCategory, string> = {
  a: 'a) Chi phí nguyên liệu, vật liệu, nhiên liệu, năng lượng, hàng hóa sử dụng vào sản xuất, kinh doanh.',
  b: 'b) Chi phí tiền lương, tiền công, các khoản phụ cấp, bảo hiểm bắt buộc và các khoản chi trả cho người lao động có đóng bảo hiểm bắt buộc theo quy định; chi phí tiền lương, tiền công, các khoản phụ cấp và các khoản chi trả cho người lao động dưới 01 tháng.',
  c: 'c) Chi phí khấu hao tài sản cố định phục vụ cho hoạt động sản xuất, kinh doanh theo chế độ quản lý, sử dụng và trích khấu hao tài sản cố định (nếu có).',
  d: 'd) Chi phí dịch vụ mua ngoài như điện, nước, điện thoại, internet, vận chuyển, thuê tài sản, sửa chữa, bảo dưỡng.',
  dd: 'đ) Chi phí trả lãi tiền vay vốn sản xuất, kinh doanh của tổ chức tín dụng theo lãi suất thực tế. Chi phí trả lãi tiền vay vốn sản xuất, kinh doanh của đối tượng không phải là tổ chức tín dụng không vượt quá mức quy định tại Bộ luật Dân sự.',
  e: 'e) Các khoản chi khác phục vụ trực tiếp hoạt động sản xuất, kinh doanh...',
};

export interface CashLine {
  docNo: string;
  date: string;
  description: string;
  /** Positive = thu / gửi vào, negative = chi / rút ra. */
  amount: string;
}

export interface MoneyAccount {
  /** "Tiền mặt" or the bank's name (and account). */
  name: string;
  kind: 'CASH' | 'BANK';
  /** Opening balance when known; the cell is left for the household to fill in otherwise. */
  opening?: string | undefined;
  lines: CashLine[];
}

const LEGAL = '(Kèm theo Thông tư số 152/2025/TT-BTC ngày 31 tháng 12 năm 2025 của Bộ trưởng Bộ Tài chính)';
const SIGN_TITLE = 'NGƯỜI ĐẠI DIỆN HỘ KINH DOANH/ CÁ NHÂN KINH DOANH';
const num = (s: string) => Number(dec(D(s)));
const vnDate = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;
const taxOf = (amount: string, rate: string | undefined) =>
  rate === undefined || rate === '' ? null : num(D(amount).times(rate).div(100).toDecimalPlaces(0).toFixed());

/** Rough row height (points) for wrapped text in a column `width` characters wide (12 pt font). */
export function fitHeight(text: string, width: number, min = 17): number {
  const lines = text
    .split('\n')
    .reduce((n, part) => n + Math.max(1, Math.ceil((part.length * 1.08) / Math.max(width - 1, 1))), 0);
  return Math.max(min, lines * 15.5 + 3);
}

/**
 * Builds a sheet row by row. Table rows are written by logical column; `spans` says how many
 * physical columns each logical column covers (the "Diễn giải" column spans two, so that the
 * heading blocks above the table can split the page in halves as on the printed forms).
 */
class Builder {
  rows: (XCell | null)[][] = [];
  merges: string[] = [];
  heights: Record<number, number> = {};
  readonly width: number;
  constructor(
    readonly cols: number[],
    readonly spans: number[],
  ) {
    this.width = cols.length;
  }
  get next() {
    return this.rows.length + 1;
  }
  col(i: number) {
    let n = i + 1;
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }
  /** Physical column where logical column `i` starts. */
  at(i: number) {
    return this.spans.slice(0, i).reduce((a, b) => a + b, 0);
  }
  /** Cell reference of logical column `i` in row `r`. */
  ref(i: number, r: number) {
    return `${this.col(this.at(i))}${r}`;
  }
  push(cells: (XCell | null)[], height?: number) {
    const row: (XCell | null)[] = Array.from({ length: this.width }, (_, i) => cells[i] ?? null);
    this.rows.push(row);
    if (height) this.heights[this.rows.length] = height;
    return this.rows.length;
  }
  merge(r1: number, c1: number, r2: number, c2: number) {
    if (r1 !== r2 || c1 !== c2) this.merges.push(`${this.col(c1)}${r1}:${this.col(c2)}${r2}`);
  }
  /** A table row by logical columns; covered physical cells keep the border style. */
  trow(cells: XCell[], height?: number) {
    const phys: (XCell | null)[] = [];
    cells.forEach((c, i) => {
      const start = this.at(i);
      phys[start] = c;
      for (let k = 1; k < this.spans[i]!; k++) phys[start + k] = { v: '', s: c.s ?? 'cell' };
    });
    // Wrapped text: grow the row to fit the widest wrapped cell.
    let h = height ?? 0;
    cells.forEach((c, i) => {
      if (
        typeof c.v === 'string' &&
        c.v &&
        (c.s === 'cell' || c.s === 'cellItalic' || c.s === 'cellBold' || c.s === 'head')
      ) {
        const w = this.cols.slice(this.at(i), this.at(i) + this.spans[i]!).reduce((a, b) => a + b, 0);
        h = Math.max(h, fitHeight(c.v, w));
      }
    });
    const r = this.push(phys, h > 17 ? h : undefined);
    cells.forEach((_, i) => {
      if (this.spans[i]! > 1) this.merge(r, this.at(i), r, this.at(i) + this.spans[i]! - 1);
    });
    return r;
  }
  /** Merges logical column `i` over rows r1..r2 (headers spanning two rows). */
  vmerge(i: number, r1: number, r2: number) {
    this.merges = this.merges.filter(
      (m) => !m.startsWith(`${this.col(this.at(i))}${r1}:`) && !m.startsWith(`${this.col(this.at(i))}${r2}:`),
    );
    this.merge(r1, this.at(i), r2, this.at(i) + this.spans[i]! - 1);
  }
  /** A text across columns c1..c2 of a new row. */
  line(text: string, s: XStyle, c1 = 0, c2 = this.width - 1, height?: number) {
    const cells: (XCell | null)[] = [];
    cells[c1] = { v: text, s };
    const w = this.cols.slice(c1, c2 + 1).reduce((a, b) => a + b, 0);
    const h = height ?? (s === 'note' ? fitHeight(text, w) : undefined);
    const r = this.push(cells, h);
    this.merge(r, c1, r, c2);
    return r;
  }
  sheet(name: string, landscape = false): XSheet {
    return { name, cols: this.cols, rows: this.rows, merges: this.merges, heights: this.heights, landscape };
  }
}

/** Unit block on the left, form number and legal basis on the right, then title lines. */
function heading(b: Builder, h: HkdHeader, form: string, title: string, extra: string[], splitAt: number) {
  const right = b.width - 1;
  const r1 = b.push([{ v: `HỘ, CÁ NHÂN KINH DOANH: ${h.name || '......'}`, s: 'unit' }]);
  b.merge(r1, 0, r1, splitAt - 1);
  b.rows[r1 - 1]![splitAt] = { v: `Mẫu số ${form}`, s: 'form' };
  b.merge(r1, splitAt, r1, right);
  const r2 = b.push([{ v: `Địa chỉ: ${h.address || '.......................................'}`, s: 'unit' }]);
  b.merge(r2, 0, r2, splitAt - 1);
  b.rows[r2 - 1]![splitAt] = { v: LEGAL, s: 'formItalic' };
  const r3 = b.push([{ v: `Mã số thuế: ${h.taxCode || '................................'}`, s: 'unit' }]);
  b.merge(r3, 0, r3, splitAt - 1);
  b.merge(r2, splitAt, r3, right);
  const leftWidth = b.cols.slice(0, splitAt).reduce((a, c) => a + c, 0);
  b.heights[r1] = fitHeight(String(b.rows[r1 - 1]![0]!.v), leftWidth);
  b.heights[r2] = Math.max(fitHeight(String(b.rows[r2 - 1]![0]!.v), leftWidth), 17);
  b.heights[r3] = Math.max(fitHeight(String(b.rows[r3 - 1]![0]!.v), leftWidth), 24);
  b.push([]);
  b.line(title, 'title', 0, right, 24);
  for (const t of extra) b.line(t, 'subtitle');
  b.line('Đơn vị tính: đồng', 'unitNote');
}

function signature(b: Builder, from: number, note: string) {
  b.push([]);
  b.line('Ngày ..... tháng ..... năm .....', 'signNote', from);
  b.line(SIGN_TITLE, 'sign', from, b.width - 1, 34);
  b.line(note, 'signNote', from);
}

const SIGN_NOTE = '(Ký, ghi rõ họ tên và đóng dấu (nếu có))';

/** Two-level header "Chứng từ (Số hiệu | Ngày, tháng) · Diễn giải · …amount columns". */
function voucherHeader(b: Builder, amounts: string[], amountGroup?: string) {
  const n = 3 + amounts.length;
  const top: XCell[] = [
    { v: 'Chứng từ', s: 'head' },
    { v: '', s: 'head' },
    { v: 'Diễn giải', s: 'head' },
    ...amounts.map((a, i) => ({ v: amountGroup ? (i === 0 ? amountGroup : '') : a, s: 'head' as const })),
  ];
  const h1 = b.trow(top);
  b.merge(h1, b.at(0), h1, b.at(1));
  if (amountGroup) b.merge(h1, b.at(3), h1, b.at(n - 1));
  const h2 = b.trow(
    [
      { v: 'Số hiệu', s: 'head' },
      { v: 'Ngày, tháng', s: 'head' },
      { v: '', s: 'head' },
      ...amounts.map((a) => ({ v: amountGroup ? a : '', s: 'head' as const })),
    ],
    22,
  );
  b.vmerge(2, h1, h2);
  if (!amountGroup) for (let i = 3; i < n; i++) b.vmerge(i, h1, h2);
  b.trow([
    { v: 'A', s: 'code' },
    { v: 'B', s: 'code' },
    { v: 'C', s: 'code' },
    ...amounts.map((_, i) => ({ v: String(i + 1), s: 'code' as const })),
  ]);
}

const empty = (): XCell => ({ v: '', s: 'cell' });

// ───────── S1a-HKD ─────────

export function sheetS1a(h: HkdHeader, lines: BookLine[]): XSheet {
  const b = new Builder([14, 30, 30, 20], [1, 2, 1]);
  heading(
    b,
    h,
    'S1a-HKD',
    'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    [`Địa điểm kinh doanh: ${h.location}`, `Kỳ kê khai: ${h.period}`],
    2,
  );
  b.trow(
    [
      { v: 'Ngày tháng', s: 'head' },
      { v: 'Diễn giải', s: 'head' },
      { v: 'Số tiền', s: 'head' },
    ],
    22,
  );
  b.trow([
    { v: 'A', s: 'code' },
    { v: 'B', s: 'code' },
    { v: '1', s: 'code' },
  ]);
  const first = b.next;
  for (const l of lines)
    b.trow([
      { v: vnDate(l.date), s: 'date' },
      { v: l.description, s: 'cell' },
      { v: num(l.amount), s: 'money' },
    ]);
  const last = b.next - 1;
  const total = lines.reduce((s, l) => s.plus(l.amount), D(0));
  b.trow([
    empty(),
    { v: 'Tổng cộng', s: 'head' },
    {
      v: num(dec(total)),
      s: 'moneyBold',
      ...(lines.length ? { f: `SUM(${b.ref(2, first)}:${b.ref(2, last)})` } : {}),
    },
  ]);
  signature(b, 1, '(Ký, ghi rõ họ tên, đóng dấu (nếu có))');
  return b.sheet('S1a-HKD');
}

// ───────── S2a-HKD / S2b-HKD ─────────

function revenueByLine(h: HkdHeader, form: 'S2a-HKD' | 'S2b-HKD', groups: BusinessLineBook[]): XSheet {
  const withPit = form === 'S2a-HKD';
  const b = new Builder([12, 13, 27, 28, 19], [1, 1, 2, 1]);
  heading(
    b,
    h,
    form,
    'SỔ DOANH THU BÁN HÀNG HÓA, DỊCH VỤ',
    [`Địa điểm kinh doanh: ${h.location}`, `Kỳ kê khai: ${h.period}`],
    3,
  );
  voucherHeader(b, ['Số tiền']);
  const amt = (r: number) => b.ref(3, r);
  const vatCells: string[] = [];
  const pitCells: string[] = [];
  let vatTotal = 0;
  let pitTotal = 0;
  let vatKnown = true;
  let pitKnown = true;
  groups.forEach((g, i) => {
    b.trow([empty(), empty(), { v: `${i + 1}. Ngành nghề ${g.name}`, s: 'cellBold' }, { v: '', s: 'money' }]);
    const first = b.next;
    for (const l of g.lines)
      b.trow([
        { v: l.docNo, s: 'cellCenter' },
        { v: vnDate(l.date), s: 'date' },
        { v: l.description, s: 'cell' },
        { v: num(l.amount), s: 'money' },
      ]);
    const last = b.next - 1;
    const total = g.lines.reduce((s, l) => s.plus(l.amount), D(0));
    const tr = b.trow([
      empty(),
      empty(),
      { v: `Tổng cộng (${i + 1})`, s: 'head' },
      {
        v: num(dec(total)),
        s: 'moneyBold',
        ...(g.lines.length ? { f: `SUM(${amt(first)}:${amt(last)})` } : {}),
      },
    ]);
    const vat = taxOf(dec(total), g.vatRate);
    if (vat === null) vatKnown = false;
    else vatTotal += vat;
    const vr = b.trow([
      empty(),
      empty(),
      { v: g.vatRate ? `Thuế GTGT (${g.vatRate}%)` : 'Thuế GTGT', s: 'cellCenter' },
      vat === null
        ? { v: '', s: 'money' }
        : { v: vat, s: 'money', f: `ROUND(${amt(tr)}*${g.vatRate}/100,0)` },
    ]);
    vatCells.push(amt(vr));
    if (withPit) {
      const pit = taxOf(dec(total), g.pitRate);
      if (pit === null) pitKnown = false;
      else pitTotal += pit;
      const pr = b.trow([
        empty(),
        empty(),
        { v: g.pitRate ? `Thuế TNCN (${g.pitRate}%)` : 'Thuế TNCN', s: 'cellCenter' },
        pit === null
          ? { v: '', s: 'money' }
          : { v: pit, s: 'money', f: `ROUND(${amt(tr)}*${g.pitRate}/100,0)` },
      ]);
      pitCells.push(amt(pr));
    }
  });
  b.trow([
    empty(),
    empty(),
    { v: 'Tổng số thuế GTGT phải nộp', s: 'head' },
    vatKnown && groups.length
      ? { v: vatTotal, s: 'moneyBold', f: vatCells.join('+') }
      : { v: '', s: 'moneyBold' },
  ]);
  if (withPit)
    b.trow([
      empty(),
      empty(),
      { v: 'Tổng số thuế TNCN phải nộp', s: 'head' },
      pitKnown && groups.length
        ? { v: pitTotal, s: 'moneyBold', f: pitCells.join('+') }
        : { v: '', s: 'moneyBold' },
    ]);
  if (!vatKnown || (withPit && !pitKnown))
    b.line(
      'Ghi chú: chưa khai báo tỷ lệ % tính thuế cho một số ngành nghề trong Cài đặt, ô thuế để trống để hộ kinh doanh điền theo tỷ lệ áp dụng.',
      'note',
    );
  signature(b, 2, form === 'S2a-HKD' ? '(Ký, ghi rõ họ tên, đóng dấu (nếu có))' : SIGN_NOTE);
  return b.sheet(form);
}

export const sheetS2a = (h: HkdHeader, groups: BusinessLineBook[]) => revenueByLine(h, 'S2a-HKD', groups);
export const sheetS2b = (h: HkdHeader, groups: BusinessLineBook[]) => revenueByLine(h, 'S2b-HKD', groups);

// ───────── S2c-HKD ─────────

export function sheetS2c(
  h: HkdHeader,
  revenue: BookLine[],
  costs: Partial<Record<CostCategory, BookLine[]>>,
  pitRate?: string,
): XSheet {
  const b = new Builder([12, 13, 30, 30, 19], [1, 1, 2, 1]);
  heading(
    b,
    h,
    'S2c-HKD',
    'SỔ CHI TIẾT DOANH THU, CHI PHÍ',
    [`Tên địa điểm kinh doanh: ${h.location}`, `Kỳ kê khai: ${h.period}`],
    3,
  );
  voucherHeader(b, ['Số tiền']);
  const amt = (r: number) => b.ref(3, r);
  const setAmount = (r: number, c: XCell) => {
    b.rows[r - 1]![b.at(3)] = c;
  };
  const detail = (l: BookLine) =>
    b.trow([
      { v: l.docNo, s: 'cellCenter' },
      { v: vnDate(l.date), s: 'date' },
      { v: l.description, s: 'cellItalic' },
      { v: num(l.amount), s: 'money' },
    ]);
  const sumOf = (first: number, n: number) => (n ? { f: `SUM(${amt(first)}:${amt(first + n - 1)})` } : {});
  const revTotal = revenue.reduce((s, l) => s.plus(l.amount), D(0));
  const r1 = b.trow([
    empty(),
    empty(),
    { v: '1. Doanh thu bán hàng hóa, dịch vụ', s: 'cellBold' },
    { v: '', s: 'money' },
  ]);
  const rf = b.next;
  revenue.forEach(detail);
  setAmount(r1, { v: num(dec(revTotal)), s: 'moneyBold', ...sumOf(rf, revenue.length) });
  const r2 = b.trow([empty(), empty(), { v: '2. Chi phí hợp lý', s: 'cellBold' }, { v: '', s: 'money' }]);
  const catRows: number[] = [];
  let costTotal = D(0);
  for (const k of Object.keys(COST_CATEGORIES) as CostCategory[]) {
    const lines = costs[k] ?? [];
    const t = lines.reduce((s, l) => s.plus(l.amount), D(0));
    costTotal = costTotal.plus(t);
    const cr = b.trow([empty(), empty(), { v: COST_CATEGORIES[k], s: 'cell' }, { v: '', s: 'money' }]);
    const cf = b.next;
    lines.forEach(detail);
    setAmount(cr, { v: num(dec(t)), s: 'money', ...sumOf(cf, lines.length) });
    catRows.push(cr);
  }
  setAmount(r2, { v: num(dec(costTotal)), s: 'moneyBold', f: catRows.map((r) => amt(r)).join('+') });
  const diff = revTotal.minus(costTotal);
  const r3 = b.trow([
    empty(),
    empty(),
    { v: '3. Chênh lệch {(3) = (1) - (2)}', s: 'cellBold' },
    { v: num(dec(diff)), s: 'moneyBold', f: `${amt(r1)}-${amt(r2)}` },
  ]);
  const pit = pitRate
    ? num((diff.gt(0) ? diff : D(0)).times(pitRate).div(100).toDecimalPlaces(0).toFixed())
    : null;
  b.trow([
    empty(),
    empty(),
    {
      v: `4. Tổng số thuế TNCN phải nộp {(4) = (3) x thuế suất}${pitRate ? `, thuế suất ${pitRate}%` : ''}`,
      s: 'cellBold',
    },
    pit === null
      ? { v: '', s: 'moneyBold' }
      : { v: pit, s: 'moneyBold', f: `ROUND(MAX(${amt(r3)},0)*${pitRate}/100,0)` },
  ]);
  if (pit === null)
    b.line('Ghi chú: chưa khai báo thuế suất thuế TNCN trong Cài đặt, dòng (4) để trống.', 'note');
  signature(b, 2, SIGN_NOTE);
  return b.sheet('S2c-HKD');
}

// ───────── S2e-HKD ─────────

export function sheetS2e(h: HkdHeader, accounts: MoneyAccount[]): XSheet {
  const b = new Builder([12, 13, 23, 24, 17, 17], [1, 1, 2, 1, 1]);
  heading(b, h, 'S2e-HKD', 'SỔ CHI TIẾT TIỀN', [`Kỳ kê khai: ${h.period}`], 3);
  voucherHeader(b, ['Thu/Gửi vào', 'Chi/Rút ra'], 'Số tiền');
  const IN = 3;
  const OUT = 4;
  const caption = (text: string, bold = false): XCell => ({ v: text, s: bold ? 'cellBold' : 'cell' });
  const money = (v: number | null): XCell => ({ v: v ?? '', s: 'money' });
  const section = (a: MoneyAccount, labels: { open: string; in: string; out: string; close: string }) => {
    const open = b.trow([
      empty(),
      empty(),
      caption(labels.open),
      money(a.opening === undefined ? null : num(a.opening)),
      money(null),
    ]);
    const first = b.next;
    for (const l of a.lines) {
      const v = num(l.amount);
      b.trow([
        { v: l.docNo, s: 'cellCenter' },
        { v: vnDate(l.date), s: 'date' },
        { v: l.description, s: 'cell' },
        money(v >= 0 ? v : null),
        money(v < 0 ? -v : null),
      ]);
    }
    const last = b.next - 1;
    const inn = a.lines.reduce((s, l) => (D(l.amount).gte(0) ? s.plus(l.amount) : s), D(0));
    const out = a.lines.reduce((s, l) => (D(l.amount).lt(0) ? s.minus(l.amount) : s), D(0));
    const range = (c: number) => (a.lines.length ? { f: `SUM(${b.ref(c, first)}:${b.ref(c, last)})` } : {});
    const ri = b.trow([
      empty(),
      empty(),
      caption(labels.in, true),
      { v: num(dec(inn)), s: 'moneyBold', ...range(IN) },
      money(null),
    ]);
    const ro = b.trow([
      empty(),
      empty(),
      caption(labels.out, true),
      money(null),
      { v: num(dec(out)), s: 'moneyBold', ...range(OUT) },
    ]);
    const closing = a.opening === undefined ? null : num(dec(D(a.opening).plus(inn).minus(out)));
    b.trow([
      empty(),
      empty(),
      caption(labels.close, true),
      {
        v: closing ?? '',
        s: 'moneyBold',
        // Blank until the opening balance is entered: no closing figure without an opening one.
        f: `IF(${b.ref(IN, open)}="","",${b.ref(IN, open)}+${b.ref(IN, ri)}-${b.ref(OUT, ro)})`,
      },
      money(null),
    ]);
  };
  const cash = accounts.filter((a) => a.kind === 'CASH');
  const banks = accounts.filter((a) => a.kind === 'BANK');
  b.trow([empty(), empty(), caption('Tiền mặt', true), money(null), money(null)]);
  for (const a of cash.length ? cash : [{ name: 'Tiền mặt', kind: 'CASH' as const, lines: [] }])
    section(a, {
      open: 'Tiền mặt đầu kỳ',
      in: 'Tổng tiền thu vào trong kỳ',
      out: 'Tổng tiền chi ra trong kỳ',
      close: 'Tiền mặt tồn cuối kỳ',
    });
  b.trow([empty(), empty(), caption('Tiền gửi không kỳ hạn', true), money(null), money(null)]);
  for (const a of banks) {
    b.trow([empty(), empty(), caption(`Ngân hàng ${a.name}`, true), money(null), money(null)]);
    section(a, {
      open: 'Tiền gửi đầu kỳ',
      in: 'Tổng gửi vào trong kỳ',
      out: 'Tổng tiền rút ra trong kỳ',
      close: 'Tiền gửi cuối kỳ',
    });
  }
  if (!cash.length || accounts.some((a) => a.opening === undefined))
    b.line(
      'Ghi chú: số dư đầu kỳ chưa có trong ARGOLET, điền vào ô "đầu kỳ", Excel tự tính số cuối kỳ.',
      'note',
    );
  signature(b, 3, SIGN_NOTE);
  return b.sheet('S2e-HKD');
}

/** Which forms a household keeps, by how it pays VAT and PIT (Điều 4, 5, 6 Thông tư 152/2025). */
export function hkdForms(method: HkdTaxMethod): string[] {
  return method === 'EXEMPT'
    ? ['S1a-HKD']
    : method === 'PERCENT'
      ? ['S2a-HKD']
      : ['S2b-HKD', 'S2c-HKD', 'S2e-HKD'];
}
