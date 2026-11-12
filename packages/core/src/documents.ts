import { D, dec, sum } from './decimal';

/**
 * Document intake & normalisation (board 02 / 05): format detection, structured parsing
 * (XML e-invoice, CSV bank statement / POS export), field validation and lifecycle.
 */
export type DocumentStatus = 'RECEIVED' | 'EXTRACTED' | 'NEEDS_REVIEW' | 'VALIDATED' | 'REJECTED';
export type SourceFormat = 'XML' | 'CSV' | 'EXCEL' | 'JSON' | 'IMAGE' | 'PDF';
export type SourceKind = 'PHOTO' | 'XML_EINVOICE' | 'BANK' | 'CSV' | 'PDF' | 'POS' | 'EXCEL';

const TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  RECEIVED: ['EXTRACTED', 'REJECTED'],
  EXTRACTED: ['NEEDS_REVIEW', 'VALIDATED', 'REJECTED'],
  NEEDS_REVIEW: ['VALIDATED', 'REJECTED', 'EXTRACTED'],
  VALIDATED: ['EXTRACTED'], // a correction creates a new extraction version
  REJECTED: [],
};

export function canTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!canTransition(from, to)) throw new Error(`Không thể chuyển chứng từ từ ${from} sang ${to}`);
}

export function detectFormat(filename: string, mime = ''): SourceFormat {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xml' || mime.includes('xml')) return 'XML';
  if (ext === 'csv' || mime.includes('csv')) return 'CSV';
  if (['xls', 'xlsx'].includes(ext) || mime.includes('spreadsheet') || mime.includes('excel')) return 'EXCEL';
  if (ext === 'json' || mime.includes('json')) return 'JSON';
  if (ext === 'pdf' || mime.includes('pdf')) return 'PDF';
  return 'IMAGE';
}

/** Parser chosen by file type, source and template (board 02 "Chọn bộ phân tích"). */
export function chooseParser(format: SourceFormat): 'structured' | 'ocr_vlm' {
  return format === 'XML' || format === 'CSV' || format === 'EXCEL' || format === 'JSON' ? 'structured' : 'ocr_vlm';
}

// ───────────── CSV ─────────────

export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** "1.250.000" | "1,250,000" | "1250000.00" → "1250000" */
export function parseAmount(raw: string): string {
  let s = raw.trim().replace(/[đ₫\sVND]/gi, '');
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-') || s.startsWith('−');
  s = s.replace(/[()\-−+]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Số tiền không hợp lệ: "${raw}"`);
  return dec(D(s).times(neg ? -1 : 1));
}

/** "31/10/2026" | "2026-10-31" → "2026-10-31" */
export function parseDate(raw: string): string {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  throw new Error(`Ngày không hợp lệ: "${raw}"`);
}

export interface BankLine {
  lineNo: number;
  date: string;
  amount: string;
  reference: string;
  description: string;
  counterparty: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');

function headerIndex(header: string[], candidates: string[]): number {
  const h = header.map(norm);
  for (const c of candidates) {
    const idx = h.indexOf(norm(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Bank statement CSV: Ngày, Số tiền (or Ghi có/Ghi nợ), Mã tham chiếu, Nội dung, Đối tác */
export function parseBankStatementCsv(text: string): BankLine[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Sao kê không có dòng dữ liệu');
  const header = rows[0]!;
  const iDate = headerIndex(header, ['Ngày', 'Ngày giao dịch', 'Date']);
  const iAmount = headerIndex(header, ['Số tiền', 'Amount']);
  const iCredit = headerIndex(header, ['Ghi có', 'Credit']);
  const iDebit = headerIndex(header, ['Ghi nợ', 'Debit']);
  const iRef = headerIndex(header, ['Mã tham chiếu', 'Mã GD', 'Reference', 'Ref']);
  const iDesc = headerIndex(header, ['Nội dung', 'Diễn giải', 'Description']);
  const iCp = headerIndex(header, ['Đối tác', 'Counterparty', 'Tên đối ứng']);
  if (iDate < 0 || (iAmount < 0 && iCredit < 0)) throw new Error('Thiếu cột Ngày hoặc Số tiền trong sao kê');
  return rows.slice(1).map((r, idx) => {
    let amount: string;
    if (iAmount >= 0) amount = parseAmount(r[iAmount] ?? '0');
    else {
      const credit = r[iCredit]?.trim() ? parseAmount(r[iCredit]!) : '0';
      const debit = iDebit >= 0 && r[iDebit]?.trim() ? parseAmount(r[iDebit]!) : '0';
      amount = dec(D(credit).minus(debit));
    }
    return {
      lineNo: idx + 2,
      date: parseDate(r[iDate] ?? ''),
      amount,
      reference: (iRef >= 0 ? r[iRef] : '')?.trim() ?? '',
      description: (iDesc >= 0 ? r[iDesc] : '')?.trim() ?? '',
      counterparty: (iCp >= 0 ? r[iCp] : '')?.trim() ?? '',
    };
  });
}

export interface PosOrderLine {
  lineNo: number;
  orderCode: string;
  date: string;
  gross: string;
  fee: string;
  refund: string;
  discount: string;
  payoutBatch: string;
  channel: string;
}

/** POS / platform export: Mã đơn, Ngày, Giá trị, Phí, Hoàn tiền, Chiết khấu, Mã lô chi trả, Kênh */
export function parsePosCsv(text: string): PosOrderLine[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Tệp đơn hàng không có dòng dữ liệu');
  const h = rows[0]!;
  const i = {
    code: headerIndex(h, ['Mã đơn', 'Order', 'Mã đơn hàng']),
    date: headerIndex(h, ['Ngày', 'Date']),
    gross: headerIndex(h, ['Giá trị', 'Gross', 'Tổng tiền']),
    fee: headerIndex(h, ['Phí', 'Fee', 'Phí nền tảng']),
    refund: headerIndex(h, ['Hoàn tiền', 'Refund']),
    discount: headerIndex(h, ['Chiết khấu', 'Discount']),
    batch: headerIndex(h, ['Mã lô chi trả', 'Payout', 'Lô chi trả']),
    channel: headerIndex(h, ['Kênh', 'Channel']),
  };
  if (i.code < 0 || i.date < 0 || i.gross < 0) throw new Error('Thiếu cột Mã đơn, Ngày hoặc Giá trị');
  const opt = (r: string[], idx: number) => (idx >= 0 && r[idx]?.trim() ? parseAmount(r[idx]!) : '0');
  return rows.slice(1).map((r, n) => ({
    lineNo: n + 2,
    orderCode: r[i.code]!.trim(),
    date: parseDate(r[i.date] ?? ''),
    gross: parseAmount(r[i.gross] ?? '0'),
    fee: opt(r, i.fee),
    refund: opt(r, i.refund),
    discount: opt(r, i.discount),
    payoutBatch: i.batch >= 0 ? (r[i.batch] ?? '').trim() : '',
    channel: i.channel >= 0 ? (r[i.channel] ?? '').trim() : '',
  }));
}

// ───────────── XML e-invoice (simplified HĐĐT schema) ─────────────

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');

/** Minimal, dependency-free XML parser (no DTD/entities expansion → safe against XXE). */
export function parseXml(xml: string): XmlNode {
  const src = xml.replace(/<\?xml[^>]*\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.text += m[1];
    else if (m[2]) {
      if (top.name !== m[2]) throw new Error(`XML không hợp lệ: thẻ đóng </${m[2]}> không khớp`);
      stack.pop();
    } else if (m[3]) {
      const attrs: Record<string, string> = {};
      const attrRe = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = attrRe.exec(m[4] ?? ''))) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? '');
      const node: XmlNode = { name: m[3], attrs, children: [], text: '' };
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6]) top.text += decodeEntities(m[6]);
  }
  if (stack.length !== 1) throw new Error('XML không hợp lệ: thiếu thẻ đóng');
  return root;
}

export function findAll(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    if (n.name === name || n.name.endsWith(':' + name)) out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

export function findText(node: XmlNode, ...path: string[]): string {
  let cur: XmlNode | undefined = node;
  for (const p of path) {
    cur = cur ? findAll(cur, p)[0] : undefined;
  }
  return cur?.text.trim() ?? '';
}

export interface InvoiceLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
}

export interface ExtractedInvoice {
  documentNo: string;
  series: string;
  issueDate: string;
  sellerName: string;
  sellerTaxCode: string;
  buyerName: string;
  buyerTaxCode: string;
  currency: string;
  lines: InvoiceLine[];
  subtotal: string;
  vat: string;
  total: string;
  signed: boolean;
}

export function parseEInvoiceXml(xml: string): ExtractedInvoice {
  const root = parseXml(xml);
  if (findAll(root, 'HDon').length === 0) throw new Error('Không phải hóa đơn điện tử (thiếu thẻ HDon)');
  const lines = findAll(root, 'HHDVu').map((n) => ({
    description: findText(n, 'THHDVu'),
    quantity: findText(n, 'SLuong') || '1',
    unit: findText(n, 'DVTinh'),
    unitPrice: findText(n, 'DGia') || findText(n, 'ThTien'),
    amount: findText(n, 'ThTien'),
  }));
  const subtotal = findText(root, 'TToan', 'TgTCThue') || dec(sum(lines.map((l) => l.amount || '0')));
  const vat = findText(root, 'TToan', 'TgTThue') || '0';
  return {
    documentNo: findText(root, 'TTChung', 'SHDon'),
    series: findText(root, 'TTChung', 'KHHDon'),
    issueDate: parseDate(findText(root, 'TTChung', 'NLap')),
    sellerName: findText(root, 'NBan', 'Ten'),
    sellerTaxCode: findText(root, 'NBan', 'MST'),
    buyerName: findText(root, 'NMua', 'Ten'),
    buyerTaxCode: findText(root, 'NMua', 'MST'),
    currency: findText(root, 'TTChung', 'DVTTe') || 'VND',
    lines,
    subtotal,
    vat,
    total: findText(root, 'TToan', 'TgTTTBSo') || dec(D(subtotal).plus(vat)),
    signed: findAll(root, 'Signature').length > 0 || findAll(root, 'DSCKS').length > 0,
  };
}

// ───────────── Field validation (board 02 "Kiểm chứng trường dữ liệu") ─────────────

export interface DocumentFields {
  supplier: string;
  documentNo: string;
  documentDate: string; // YYYY-MM-DD
  total: string;
  taxCode?: string | undefined;
  lines?: { description: string; amount: string }[] | undefined;
}

export interface FieldIssue {
  field: keyof DocumentFields | 'duplicate';
  severity: 'error' | 'warning';
  message: string;
}

export function isValidTaxCode(code: string): boolean {
  return /^\d{10}(-\d{3})?$/.test(code.trim());
}

export function validateFields(
  f: DocumentFields,
  opts: { today?: string; periodId?: string; knownDocumentKeys?: string[]; lowConfidence?: (keyof DocumentFields)[] } = {},
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!f.supplier.trim()) issues.push({ field: 'supplier', severity: 'error', message: 'Thiếu nhà cung cấp' });
  if (!f.documentNo.trim()) issues.push({ field: 'documentNo', severity: 'error', message: 'Thiếu số chứng từ' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.documentDate) || Number.isNaN(Date.parse(f.documentDate))) {
    issues.push({ field: 'documentDate', severity: 'error', message: 'Ngày chứng từ không hợp lệ' });
  } else {
    if (opts.today && f.documentDate > opts.today) issues.push({ field: 'documentDate', severity: 'error', message: 'Ngày chứng từ ở tương lai' });
    if (opts.periodId && !f.documentDate.startsWith(opts.periodId)) {
      issues.push({ field: 'documentDate', severity: 'warning', message: 'Ngày chứng từ nằm ngoài kỳ dữ liệu' });
    }
  }
  try {
    if (D(f.total).lte(0)) issues.push({ field: 'total', severity: 'error', message: 'Tổng thanh toán phải lớn hơn 0' });
    if (f.lines?.length) {
      const lineSum = sum(f.lines.map((l) => l.amount));
      if (!lineSum.eq(f.total)) {
        issues.push({ field: 'total', severity: 'error', message: `Tổng các dòng (${dec(lineSum)}) khác tổng thanh toán (${dec(f.total)})` });
      }
    }
  } catch {
    issues.push({ field: 'total', severity: 'error', message: 'Tổng thanh toán không phải số hợp lệ' });
  }
  if (f.taxCode && !isValidTaxCode(f.taxCode)) issues.push({ field: 'taxCode', severity: 'error', message: 'Mã số thuế phải gồm 10 hoặc 13 chữ số' });
  const key = documentKey(f);
  if (opts.knownDocumentKeys?.includes(key)) issues.push({ field: 'duplicate', severity: 'error', message: 'Chứng từ trùng số và nhà cung cấp đã tiếp nhận' });
  for (const field of opts.lowConfidence ?? []) {
    if (!issues.some((i) => i.field === field)) {
      issues.push({ field, severity: 'warning', message: 'Độ tin cậy trích xuất thấp, cần kiểm tra lại trên ảnh gốc' });
    }
  }
  return issues;
}

export function documentKey(f: Pick<DocumentFields, 'supplier' | 'documentNo'>): string {
  return `${norm(f.supplier)}#${f.documentNo.trim().toUpperCase()}`;
}

/** OCR / VLM provider contract. Implementations return fields + bbox + confidence + model version. */
export interface ExtractionField {
  name: keyof DocumentFields;
  value: string;
  confidence: number;
  bbox?: [number, number, number, number];
  page?: number;
}

export interface ExtractionResult {
  modelVersion: string;
  fields: ExtractionField[];
  lines: { description: string; amount: string }[];
}

export interface ExtractionProvider {
  readonly modelVersion: string;
  extract(input: { bytes: Uint8Array; mime: string; filename: string; hints?: Partial<DocumentFields> }): Promise<ExtractionResult>;
}
