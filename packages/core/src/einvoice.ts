import { D, dec, sum } from './decimal';
import { findAll, parseDate, parseXml, type XmlNode } from './documents';

/**
 * Vietnamese e-invoices (hóa đơn điện tử) — XML format of the General Department of Taxation
 * (Nghị định 123/2020, Thông tư 78/2021, định dạng QĐ 1450/QĐ-TCT):
 *
 *   HDon
 *   ├─ DLHDon
 *   │  ├─ TTChung   KHMSHDon, KHHDon, SHDon, NLap, DVTTe, TGia, HTTToan, TTHDLQuan (thay thế / điều chỉnh)
 *   │  └─ NDHDon
 *   │     ├─ NBan / NMua   Ten, MST, DChi
 *   │     ├─ DSHHDVu/HHDVu TChat (1 hàng hóa, 2 khuyến mại, 3 chiết khấu, 4 ghi chú), THHDVu, DVTinh,
 *   │     │                SLuong, DGia, TLCKhau, STCKhau, ThTien, TSuat
 *   │     └─ TToan         THTTLTSuat/LTSuat (TSuat, ThTien, TThue), TgTCThue, TgTThue, DSLPhi,
 *   │                      TTCKTMai, TgTTTBSo, TgTTTBChu
 *   ├─ MCCQT       mã của cơ quan thuế (hóa đơn có mã)
 *   └─ DSCKS       NBan/Signature (người bán), CQT/Signature (cơ quan thuế)
 *
 * Amounts are kept as exact decimal strings in the invoice currency, and converted to VND
 * (rounded to the đồng) with the invoice exchange rate for the books.
 */

export type InvoiceLineKind = 'GOODS' | 'PROMOTION' | 'DISCOUNT' | 'NOTE';

export interface InvoiceLine {
  no: number;
  kind: InvoiceLineKind;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  /** Signed amount before VAT in the invoice currency (commercial discounts are negative). */
  amount: string;
  /** "10%", "8%", "5%", "0%", "KCT" (không chịu thuế), "KKKNT" (không kê khai), "KHAC:x%" or "". */
  vatRate: string;
}

export interface InvoiceRate {
  rate: string;
  taxable: string;
  vat: string;
}

export interface ExtractedInvoice {
  /** Ký hiệu mẫu số (1–6, e.g. 1 = hóa đơn GTGT). */
  formNo: string;
  /** Ký hiệu hóa đơn, 6 ký tự (e.g. C26TAA). */
  series: string;
  /** Full symbol as printed: formNo + series (e.g. 1C26TAA). */
  symbol: string;
  documentNo: string;
  issueDate: string;
  invoiceName: string;
  currency: string;
  /** Exchange rate to VND ("1" for VND invoices). */
  exchangeRate: string;
  paymentMethod: string;
  sellerName: string;
  sellerTaxCode: string;
  sellerAddress: string;
  buyerName: string;
  buyerTaxCode: string;
  buyerAddress: string;
  lines: InvoiceLine[];
  rates: InvoiceRate[];
  subtotal: string;
  vat: string;
  fees: string;
  total: string;
  totalInWords: string;
  /** VND amounts used for the books (= invoice currency × exchange rate, rounded to the đồng). */
  subtotalVnd: string;
  vatVnd: string;
  totalVnd: string;
  /** Mã của cơ quan thuế ("" for invoices without a tax authority code). */
  taxAuthorityCode: string;
  /** QR code data (<DLQRCode>, QĐ 1450 Khoản 7 Mục IV Phần I), "" when absent. */
  qrData: string;
  /** A seller signature element (DSCKS/NBan/Signature) is present. */
  sellerSigned: boolean;
  /** Any signature element is present (seller or tax authority). */
  signed: boolean;
  /** Base64 X.509 certificates embedded in the signatures. */
  certificates: string[];
  /** Replacement / adjustment of an earlier invoice. */
  related: {
    kind: 'REPLACEMENT' | 'ADJUSTMENT';
    symbol: string;
    documentNo: string;
    issueDate: string;
  } | null;
  /** Arithmetic inconsistencies inside the invoice itself (empty when every total adds up). */
  inconsistencies: string[];
}

const child = (node: XmlNode | undefined, name: string): XmlNode | undefined =>
  node?.children.find((c) => c.name === name || c.name.endsWith(':' + name));
const text = (node: XmlNode | undefined, ...path: string[]): string => {
  let cur = node;
  for (const p of path) cur = child(cur, p);
  return cur?.text.trim() ?? '';
};
const first = (node: XmlNode, name: string): XmlNode | undefined => findAll(node, name)[0];

/** Decimal string from an XML number ("1.250.000" is not valid XML decimal; "1250000.00" is). */
function num(raw: string, label: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Số tiền không hợp lệ trong hóa đơn (${label}: "${s}")`);
  return D(s).toFixed();
}

const LINE_KIND: Record<string, InvoiceLineKind> = {
  '1': 'GOODS',
  '2': 'PROMOTION',
  '3': 'DISCOUNT',
  '4': 'NOTE',
};

/** "C26TAA" with the form number apart, or "1C26TAA" written in one field: both are accepted. */
export function splitInvoiceSymbol(
  formNo: string,
  series: string,
): { formNo: string; series: string; symbol: string } {
  let f = formNo.trim();
  let s = series.trim().toUpperCase();
  if (!f && /^[1-6][CK]\d{2}[A-Z]{3}$/.test(s)) {
    f = s[0]!;
    s = s.slice(1);
  }
  return { formNo: f, series: s, symbol: `${f}${s}` };
}

/**
 * Checks the symbol against Nghị định 123/2020 (Điều 4): form number 1–6; then C (có mã) or
 * K (không mã); two digits of the issue year; a letter for the invoice type
 * (T, D, L, M, N, B, G, H); two letters chosen by the seller. Returns the problems found.
 */
export function invoiceSymbolProblems(sym: { formNo: string; series: string }, issueDate: string): string[] {
  const out: string[] = [];
  if (!/^[1-6]$/.test(sym.formNo)) out.push('Ký hiệu mẫu số phải là một chữ số từ 1 đến 6');
  // Letter 4 is the invoice type (TT78 / TT32: T, D, L, M, N, B, G, H…); any letter is accepted so a
  // newly introduced type is not reported as a forgery.
  if (!/^[CK]\d{2}[A-Z]{3}$/.test(sym.series))
    out.push('Ký hiệu hóa đơn không đúng định dạng (ví dụ C26TAA: C/K, năm 2 số, loại, 2 chữ cái)');
  else if (/^\d{4}-/.test(issueDate) && sym.series.slice(1, 3) !== issueDate.slice(2, 4))
    out.push(
      `Năm trong ký hiệu (20${sym.series.slice(1, 3)}) khác năm lập hóa đơn (${issueDate.slice(0, 4)})`,
    );
  return out;
}

/**
 * Mã số thuế: 10 digits (or 10 + "-" + 3 for a branch), the 10th being a check digit:
 * d10 = 10 − (31·d1 + 29·d2 + 23·d3 + 19·d4 + 17·d5 + 13·d6 + 7·d7 + 5·d8 + 3·d9) mod 11.
 */
export function taxCodeChecksumOk(code: string): boolean {
  const m = /^(\d{10})(-\d{3})?$/.exec(code.trim());
  if (!m) return false;
  const d = m[1]!.split('').map(Number);
  const weights = [31, 29, 23, 19, 17, 13, 7, 5, 3];
  const check = 10 - (weights.reduce((s, w, i) => s + w * d[i]!, 0) % 11);
  return check < 10 && check === d[9];
}

/** Completes the first nine digits of a tax code with its check digit (test data, seeds). */
export function withTaxCodeCheckDigit(nineDigits: string): string {
  const d = nineDigits.split('').map(Number);
  const weights = [31, 29, 23, 19, 17, 13, 7, 5, 3];
  const check = 10 - (weights.reduce((s, w, i) => s + w * d[i]!, 0) % 11);
  if (check >= 10) throw new Error(`Không có chữ số kiểm tra hợp lệ cho ${nineDigits}`);
  return `${nineDigits}${check}`;
}

const toVnd = (amount: string, rate: string) =>
  amount ? D(amount).times(rate).toDecimalPlaces(0).toFixed() : '';

export function parseEInvoiceXml(xml: string): ExtractedInvoice {
  const root = parseXml(xml);
  const hdon = first(root, 'HDon');
  if (!hdon) throw new Error('Không phải hóa đơn điện tử (thiếu thẻ HDon)');
  const dl = child(hdon, 'DLHDon') ?? first(hdon, 'DLHDon');
  const tt = child(dl, 'TTChung') ?? (dl ? first(dl, 'TTChung') : undefined);
  const nd = child(dl, 'NDHDon') ?? (dl ? first(dl, 'NDHDon') : undefined);
  if (!tt || !nd) throw new Error('Hóa đơn thiếu phần thông tin chung (TTChung) hoặc nội dung (NDHDon)');

  const sym = splitInvoiceSymbol(text(tt, 'KHMSHDon'), text(tt, 'KHHDon'));
  const currency = (text(tt, 'DVTTe') || 'VND').toUpperCase();
  const exchangeRate = currency === 'VND' ? '1' : num(text(tt, 'TGia'), 'TGia') || '';
  const nban = child(nd, 'NBan');
  const nmua = child(nd, 'NMua');

  const lines: InvoiceLine[] = findAll(child(nd, 'DSHHDVu') ?? nd, 'HHDVu').map((n, i) => {
    const kind = LINE_KIND[text(n, 'TChat')] ?? 'GOODS';
    const raw = num(text(n, 'ThTien'), `ThTien dòng ${i + 1}`) || '0';
    const amount = kind === 'NOTE' ? '0' : kind === 'DISCOUNT' ? D(raw).abs().neg().toFixed() : raw;
    return {
      no: Number(text(n, 'STT')) || i + 1,
      kind,
      description: text(n, 'THHDVu'),
      unit: text(n, 'DVTinh'),
      quantity: num(text(n, 'SLuong'), `SLuong dòng ${i + 1}`) || (kind === 'GOODS' ? '1' : ''),
      unitPrice: num(text(n, 'DGia'), `DGia dòng ${i + 1}`) || (kind === 'GOODS' ? raw : ''),
      amount,
      vatRate: text(n, 'TSuat').toUpperCase(),
    };
  });

  const toan = child(nd, 'TToan');
  const rates: InvoiceRate[] = findAll(
    child(toan, 'THTTLTSuat') ?? { name: '', attrs: {}, children: [], text: '' },
    'LTSuat',
  ).map((r, i) => ({
    rate: text(r, 'TSuat').toUpperCase(),
    taxable: num(text(r, 'ThTien'), `ThTien thuế suất ${i + 1}`) || '0',
    vat: num(text(r, 'TThue'), `TThue thuế suất ${i + 1}`) || '0',
  }));
  const counted = lines.filter((l) => l.kind !== 'NOTE');
  const lineSum = sum(counted.map((l) => l.amount));
  const subtotal = num(text(toan, 'TgTCThue'), 'TgTCThue') || dec(lineSum);
  const vat = num(text(toan, 'TgTThue'), 'TgTThue') || dec(sum(rates.map((r) => r.vat)));
  const fees = dec(
    sum(
      findAll(child(toan, 'DSLPhi') ?? { name: '', attrs: {}, children: [], text: '' }, 'LPhi').map(
        (f) => num(text(f, 'TPhi'), 'TPhi') || '0',
      ),
    ),
  );
  const total = num(text(toan, 'TgTTTBSo'), 'TgTTTBSo') || dec(D(subtotal).plus(vat).plus(fees));

  // Arithmetic inside the invoice (rounding tolerance: 1 unit per line in the invoice currency).
  const inconsistencies: string[] = [];
  const tol = D(Math.max(1, counted.length));
  if (counted.length && lineSum.minus(subtotal).abs().gt(tol))
    inconsistencies.push(`Cộng tiền các dòng (${dec(lineSum)}) khác tổng tiền chưa thuế (${subtotal})`);
  if (rates.length) {
    const rateVat = sum(rates.map((r) => r.vat));
    if (rateVat.minus(vat).abs().gt(1))
      inconsistencies.push(`Cộng thuế theo thuế suất (${dec(rateVat)}) khác tổng tiền thuế (${vat})`);
    for (const r of rates) {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(r.rate.replace(/^KHAC:/, ''));
      if (!pct) continue;
      const expected = D(r.taxable).times(pct[1]!).div(100);
      if (
        expected
          .minus(r.vat)
          .abs()
          .gt(D(1).plus(D(r.taxable).abs().div(1_000_000)))
      )
        inconsistencies.push(
          `Thuế suất ${r.rate}: ${r.taxable} × ${r.rate} = ${dec(expected.toDecimalPlaces(0))}, hóa đơn ghi ${r.vat}`,
        );
    }
  }
  if (D(subtotal).plus(vat).plus(fees).minus(total).abs().gt(1))
    inconsistencies.push(
      `Tổng tiền chưa thuế + thuế + phí (${dec(D(subtotal).plus(vat).plus(fees))}) khác tổng thanh toán (${total})`,
    );
  if (currency !== 'VND' && !exchangeRate)
    inconsistencies.push(`Hóa đơn bằng ${currency} nhưng thiếu tỷ giá (TGia)`);

  const ttLq = child(tt, 'TTHDLQuan');
  const relatedKind = text(ttLq, 'TCHDon');
  const relSym = splitInvoiceSymbol(text(ttLq, 'KHMSHDCLQuan'), text(ttLq, 'KHHDCLQuan'));
  const dscks = child(hdon, 'DSCKS');
  const sellerSig = child(dscks, 'NBan');
  const rate = exchangeRate || '1';
  return {
    formNo: sym.formNo,
    series: sym.series,
    symbol: sym.symbol,
    documentNo: text(tt, 'SHDon'),
    issueDate: parseDate(text(tt, 'NLap')),
    invoiceName: text(tt, 'THDon'),
    currency,
    exchangeRate,
    paymentMethod: text(tt, 'HTTToan'),
    sellerName: text(nban, 'Ten'),
    sellerTaxCode: text(nban, 'MST'),
    sellerAddress: text(nban, 'DChi'),
    buyerName: text(nmua, 'Ten'),
    buyerTaxCode: text(nmua, 'MST'),
    buyerAddress: text(nmua, 'DChi'),
    lines,
    rates,
    subtotal,
    vat,
    fees,
    total,
    totalInWords: text(toan, 'TgTTTBChu'),
    subtotalVnd: toVnd(subtotal, rate),
    vatVnd: toVnd(vat, rate),
    totalVnd: toVnd(total, rate),
    taxAuthorityCode: text(hdon, 'MCCQT'),
    qrData: text(hdon, 'DLQRCode'),
    sellerSigned:
      !!sellerSig && (findAll(sellerSig, 'Signature').length > 0 || sellerSig.text.trim().length > 0),
    signed: findAll(hdon, 'Signature').length > 0 || !!dscks,
    certificates: findAll(dscks ?? hdon, 'X509Certificate').map((c) => c.text.replace(/\s+/g, '')),
    related:
      relatedKind === '1' || relatedKind === '2'
        ? {
            kind: relatedKind === '1' ? 'REPLACEMENT' : 'ADJUSTMENT',
            symbol: relSym.symbol,
            documentNo: text(ttLq, 'SHDCLQuan'),
            issueDate: parseDate(text(ttLq, 'NLHDCLQuan')),
          }
        : null,
    inconsistencies,
  };
}
