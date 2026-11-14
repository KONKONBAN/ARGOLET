/**
 * QR code on Vietnamese e-invoices — Quy định về thành phần chứa dữ liệu nghiệp vụ hóa đơn điện tử
 * (QĐ 1450/QĐ-TCT, sửa đổi QĐ 1510/QĐ-TCT và bản 2025 của Cục Thuế), Phần I, Mục IV, Khoản 7:
 *
 *  - EMV-style TLV objects: 2-digit ID, 2-digit length (number of characters), value (UTF-8);
 *  - "00" spec version ("01"); optional payment fields (NAPAS / QĐ 1928/QĐ-NHNN);
 *  - "99" invoice lookup data with sub-objects 00 GUID, 01 seller tax code (no dash),
 *    02 form number, 03 symbol, 04 number, 05 issue date YYYYMMDD, 06 total payable;
 *  - "63" CRC: CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the whole payload up to and
 *    including "6304", as 4 upper-case hex digits (Phụ lục XIII: …6304383C).
 *
 * The same data sits in the XML (<HDon><DLQRCode>) and is printed as the QR image. Reading it from a
 * photo gives the invoice's identity exactly as issued — which a retouched print cannot change
 * without breaking either the QR or the match with the printed figures.
 */

import { D } from './decimal';

export interface TlvObject {
  id: string;
  value: string;
}

export interface InvoiceQr {
  /** "01" in the current regulation. */
  version: string;
  crcOk: boolean;
  /** Seller tax code as on the invoice (13 digits get their dash back: 0107001729-001). */
  sellerTaxCode: string;
  formNo: string;
  series: string;
  /** formNo + series, as printed (1C26TAA). */
  symbol: string;
  documentNo: string;
  /** ISO date (YYYY-MM-DD) or "" if missing / invalid. */
  issueDate: string;
  total: string;
  /** ISO 4217 numeric currency from tag 53 ("704" = VND), "" if absent. */
  currencyCode: string;
  /** Payment amount (tag 54), when the QR also serves for payment. */
  paymentAmount: string;
  merchantName: string;
  /** Format problems found while reading (empty when the QR follows the regulation). */
  problems: string[];
}

export type QrContent =
  | { kind: 'INVOICE'; qr: InvoiceQr; raw: string }
  | { kind: 'URL'; url: string; host: string; raw: string }
  | { kind: 'OTHER'; raw: string };

/** Splits an EMV TLV string; throws on a malformed structure. Lengths count characters (code points). */
export function parseTlv(data: string): TlvObject[] {
  const chars = Array.from(data);
  const out: TlvObject[] = [];
  let p = 0;
  while (p < chars.length) {
    const id = chars.slice(p, p + 2).join('');
    const lenText = chars.slice(p + 2, p + 4).join('');
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lenText))
      throw new Error(`Cấu trúc TLV sai tại vị trí ${p + 1}`);
    const len = Number(lenText);
    if (p + 4 + len > chars.length)
      throw new Error(`Trường ${id} khai báo ${len} ký tự nhưng dữ liệu bị cắt`);
    out.push({ id, value: chars.slice(p + 4, p + 4 + len).join('') });
    p += 4 + len;
  }
  return out;
}

/** CRC-16/CCITT-FALSE over the UTF-8 bytes of `data`, as 4 upper-case hex digits. */
export function crc16Ccitt(data: string): string {
  let crc = 0xffff;
  for (const byte of utf8Bytes(data)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}

function isoDate(yyyymmdd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(yyyymmdd);
  if (!m) return '';
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === iso ? iso : '';
}

/** Reads what a QR code on a document holds: an e-invoice QR (per the regulation), a link, or other text. */
export function readQrContent(raw: string): QrContent {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'URL', url: text, host: new URL(text).host, raw: text };
    } catch {
      return { kind: 'OTHER', raw: text };
    }
  }
  const qr = parseInvoiceQr(text);
  return qr ? { kind: 'INVOICE', qr, raw: text } : { kind: 'OTHER', raw: text };
}

/** Parses an e-invoice QR payload; null when it is not TLV data with invoice information (tag 99). */
export function parseInvoiceQr(raw: string): InvoiceQr | null {
  const text = raw.trim();
  let top: TlvObject[];
  try {
    top = parseTlv(text);
  } catch {
    return null;
  }
  const get = (id: string) => top.find((o) => o.id === id)?.value ?? '';
  const info = get('99');
  if (!info) return null;
  let sub: TlvObject[];
  try {
    sub = parseTlv(info);
  } catch {
    return null;
  }
  const s = (id: string) => sub.find((o) => o.id === id)?.value ?? '';
  const problems: string[] = [];

  const version = get('00');
  if (top[0]?.id !== '00') problems.push('Trường phiên bản (00) phải đứng đầu');
  if (version !== '01') problems.push(`Phiên bản đặc tả "${version}" khác "01"`);

  const crcObj = top[top.length - 1];
  let crcOk = false;
  if (!crcObj || crcObj.id !== '63' || crcObj.value.length !== 4) {
    problems.push('Thiếu mã kiểm tra CRC (63) ở cuối dữ liệu');
  } else {
    const payload = text.slice(0, text.length - 4);
    crcOk = crc16Ccitt(payload) === crcObj.value.toUpperCase();
    if (!crcOk) problems.push('Mã kiểm tra CRC không khớp, dữ liệu QR đã bị thay đổi hoặc đọc sai');
  }

  const mst = s('01');
  const sellerTaxCode = /^\d{13}$/.test(mst) ? `${mst.slice(0, 10)}-${mst.slice(10)}` : mst;
  if (!/^\d{10}(\d{3})?$/.test(mst)) problems.push(`MST người bán "${mst}" không đúng 10 hoặc 13 chữ số`);
  const formNo = s('02');
  if (!/^[1-9]$/.test(formNo)) problems.push(`Ký hiệu mẫu số "${formNo}" không hợp lệ`);
  const series = s('03');
  if (!/^[CK]\d{2}[A-Z]{3}$/.test(series))
    problems.push(`Ký hiệu hóa đơn "${series}" không đúng 6 ký tự theo quy định`);
  const documentNo = s('04');
  if (!/^\d{1,8}$/.test(documentNo)) problems.push(`Số hóa đơn "${documentNo}" không hợp lệ`);
  const issueDate = isoDate(s('05'));
  if (!issueDate) problems.push(`Ngày lập "${s('05')}" không đúng định dạng YYYYMMDD`);
  const total = s('06');
  if (!/^\d+(\.\d+)?$/.test(total)) problems.push(`Tổng tiền thanh toán "${total}" không hợp lệ`);

  return {
    version,
    crcOk,
    sellerTaxCode,
    formNo,
    series,
    symbol: `${formNo}${series}`,
    documentNo,
    issueDate,
    total,
    currencyCode: get('53'),
    paymentAmount: get('54'),
    merchantName: get('59'),
    problems,
  };
}

/** Builds a regulation-conformant invoice QR payload (tests, fixtures, documentation). */
export function buildInvoiceQr(o: {
  sellerTaxCode: string;
  formNo: string;
  series: string;
  documentNo: string;
  issueDate: string;
  total: string;
  guid?: string;
}): string {
  const tlv = (id: string, v: string) => `${id}${String(Array.from(v).length).padStart(2, '0')}${v}`;
  const info =
    tlv('00', o.guid ?? 'A000000775') +
    tlv('01', o.sellerTaxCode.replace('-', '')) +
    tlv('02', o.formNo) +
    tlv('03', o.series) +
    tlv('04', o.documentNo.replace(/^0+(?=\d)/, '')) +
    tlv('05', o.issueDate.replace(/-/g, '')) +
    tlv('06', o.total);
  const payload = tlv('00', '01') + tlv('99', info) + '6304';
  return payload + crc16Ccitt(payload);
}

const digits = (s: string) => s.replace(/^0+(?=\d)/, '');

/**
 * Differences between what the QR says and what the document says (fields typed in, read by OCR or
 * taken from the XML). Each entry names the field, the QR value and the document value.
 */
export function compareQrWithDocument(
  qr: InvoiceQr,
  doc: {
    taxCode?: string | undefined;
    series?: string | undefined;
    documentNo?: string | undefined;
    documentDate?: string | undefined;
    total?: string | undefined;
  },
): { field: string; label: string; qr: string; document: string }[] {
  const out: { field: string; label: string; qr: string; document: string }[] = [];
  const tax = (doc.taxCode ?? '').trim();
  if (tax && tax.replace('-', '') !== qr.sellerTaxCode.replace('-', ''))
    out.push({ field: 'taxCode', label: 'MST người bán', qr: qr.sellerTaxCode, document: tax });
  const sym = (doc.series ?? '').trim().toUpperCase();
  if (sym && sym !== qr.symbol && sym !== qr.series)
    out.push({ field: 'series', label: 'Ký hiệu', qr: qr.symbol, document: sym });
  const no = (doc.documentNo ?? '').trim();
  if (no && /\d/.test(no) && digits(no.replace(/\D/g, '')) !== digits(qr.documentNo))
    out.push({ field: 'documentNo', label: 'Số hóa đơn', qr: qr.documentNo, document: no });
  const date = (doc.documentDate ?? '').trim();
  if (date && qr.issueDate && date !== qr.issueDate)
    out.push({ field: 'documentDate', label: 'Ngày lập', qr: qr.issueDate, document: date });
  const total = (doc.total ?? '').trim();
  if (total && /^\d+(\.\d+)?$/.test(total) && /^\d+(\.\d+)?$/.test(qr.total) && !D(total).eq(qr.total))
    out.push({ field: 'total', label: 'Tổng tiền thanh toán', qr: qr.total, document: total });
  return out;
}
