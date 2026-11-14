import { D, dec } from './decimal';
import { invoiceSymbolProblems, taxCodeChecksumOk, type ExtractedInvoice } from './einvoice';
import { editingSoftware, type ImageMeta } from './imagemeta';
import { compareQrWithDocument, readQrContent } from './invoiceqr';

/**
 * Signs that a document may be fake, altered or not deductible — the checks an accountant runs
 * before booking an invoice, made systematic. Nothing here proves a forgery: each check says what
 * was found and why it matters, the risk level says how carefully to look, and a person decides.
 * Status lookups on the tax authority portal (hoadondientu.gdt.gov.vn) still need a person.
 */

export type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'NA';

export interface AuthenticityCheck {
  code: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface AuthenticityResult {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  levelLabel: string;
  checks: AuthenticityCheck[];
  /** Official portal to check an e-invoice's status (cancelled, replaced…). */
  lookupUrl: string | null;
}

export interface HistoryDoc {
  code: string;
  supplier: string;
  taxCode?: string | undefined;
  total: string;
  date: string;
}

export interface AuthenticityInput {
  today: string;
  kind: 'EXPENSE' | 'REVENUE' | 'STATEMENT' | 'OTHER';
  sourceKind: string;
  fields: {
    supplier: string;
    documentNo: string;
    documentDate: string;
    total: string;
    taxCode?: string | undefined;
    series?: string | undefined;
  };
  /** Parsed XML when the source is an e-invoice. */
  invoice?: ExtractedInvoice | null;
  organisationTaxCode?: string | null;
  /** The very same file (SHA-256) was received before. */
  duplicateFileOf?: string | null;
  /** Another document carries the same identity (tax code + symbol + number). */
  sameDocumentAs?: string | null;
  /** Other documents from the same counterparty (by tax code or name). */
  history: HistoryDoc[];
  imageMeta?: ImageMeta | null;
  /** Text of a QR code read from the photo / PDF of the document (the XML carries its own). */
  qr?: string | null;
  /** Purchases from this amount (VAT included) must be paid without cash for input VAT to be deductible. */
  nonCashThreshold?: string;
}

/** QĐ 1450 Phụ lục V: 0%, 5%, 8%, 10%, KCT, KKKNT, KHAC:AB.CD% or plain KHAC (TT 103/2014 Điều 11). */
const VALID_RATES = /^(0|5|8|10)%$|^KCT$|^KKKNT$|^KHAC(:\d{1,2}(\.\d{1,2})?%)?$/;
/** Luật Thuế GTGT số 48/2024/QH15 (từ 01/07/2025): mua vào từ 5 triệu đồng phải thanh toán không dùng tiền mặt. */
export const NON_CASH_THRESHOLD = '5000000';

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(cong ty|cty|tnhh|co phan|cp|mtv|dntn|ho kinh doanh|hkd)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

function median(xs: string[]): string {
  const s = xs.map((x) => D(x)).sort((a, b) => a.cmp(b));
  const m = Math.floor(s.length / 2);
  return dec(s.length % 2 ? s[m]! : s[m - 1]!.plus(s[m]!).div(2));
}

export function assessAuthenticity(i: AuthenticityInput): AuthenticityResult {
  const checks: AuthenticityCheck[] = [];
  const add = (code: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ code, label, status, detail });
  const inv = i.invoice ?? null;
  const f = i.fields;
  const isInvoice = !!inv || !!f.series;
  const threshold = i.nonCashThreshold ?? NON_CASH_THRESHOLD;
  const vnd = (x: string) =>
    `${D(x)
      .toFixed(0)
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.')} đ`;

  // 1. Tax code of the counterparty
  const tax = (f.taxCode ?? '').trim();
  if (tax)
    add(
      'TAX_CODE',
      'Mã số thuế đối tác',
      taxCodeChecksumOk(tax) ? 'PASS' : 'FAIL',
      taxCodeChecksumOk(tax)
        ? `${tax} đúng cấu trúc và chữ số kiểm tra`
        : `${tax} sai chữ số kiểm tra, mã số thuế không tồn tại theo thuật toán cấp mã`,
    );
  else {
    // A receipt from a small shop has no tax code — only worth a warning on an invoice, or on a
    // purchase large enough that it should come with one.
    const large = i.kind === 'EXPENSE' && /^\d+(\.\d+)?$/.test(f.total) && D(f.total).gte(threshold);
    add(
      'TAX_CODE',
      'Mã số thuế đối tác',
      inv ? 'FAIL' : f.series || large ? 'WARN' : 'NA',
      inv
        ? 'Hóa đơn điện tử không ghi mã số thuế người bán'
        : f.series
          ? 'Hóa đơn có ký hiệu nhưng chưa nhập mã số thuế người bán, nhập MST để đối chiếu'
          : large
            ? `Khoản chi từ ${vnd(threshold)} nhưng chứng từ không có mã số thuế người bán, kiểm tra đã có hóa đơn chưa`
            : 'Chứng từ không ghi mã số thuế (biên lai, phiếu bán lẻ)',
    );
  }

  // 2. Same counterparty, consistent identity
  if (tax || f.supplier) {
    const sameName = i.history.filter((h) => norm(h.supplier) && norm(h.supplier) === norm(f.supplier));
    const otherTax = sameName.find((h) => h.taxCode && tax && h.taxCode !== tax);
    const sameTaxOtherName = tax
      ? i.history.find((h) => h.taxCode === tax && norm(h.supplier) && norm(h.supplier) !== norm(f.supplier))
      : undefined;
    if (otherTax)
      add(
        'IDENTITY',
        'Nhất quán với các lần trước',
        'WARN',
        `Cùng tên "${f.supplier}" nhưng ${otherTax.code} ghi MST ${otherTax.taxCode}`,
      );
    else if (sameTaxOtherName)
      add(
        'IDENTITY',
        'Nhất quán với các lần trước',
        'WARN',
        `Cùng MST ${tax} nhưng ${sameTaxOtherName.code} ghi tên "${sameTaxOtherName.supplier}"`,
      );
    else
      add(
        'IDENTITY',
        'Nhất quán với các lần trước',
        i.history.length ? 'PASS' : 'NA',
        i.history.length
          ? `Khớp ${tax ? 'tên và MST' : 'tên'} với ${i.history.length} chứng từ trước`
          : 'Đối tác mới, chưa có chứng từ trước để so',
      );
  }

  // 3. Issued to this organisation
  if (inv) {
    const org = (i.organisationTaxCode ?? '').trim();
    const party = i.kind === 'REVENUE' ? inv.sellerTaxCode : inv.buyerTaxCode;
    if (!org)
      add(
        'ADDRESSEE',
        'Hóa đơn xuất cho đúng đơn vị',
        'NA',
        'Tổ chức chưa khai báo mã số thuế trong Cài đặt',
      );
    else if (!party)
      add('ADDRESSEE', 'Hóa đơn xuất cho đúng đơn vị', 'WARN', 'Hóa đơn không ghi mã số thuế người mua');
    else
      add(
        'ADDRESSEE',
        'Hóa đơn xuất cho đúng đơn vị',
        party === org ? 'PASS' : 'FAIL',
        party === org
          ? `MST ${i.kind === 'REVENUE' ? 'người bán' : 'người mua'} ${party} là của tổ chức`
          : `Hóa đơn ghi MST người mua ${party}, không phải MST của tổ chức (${org}), không được khấu trừ thuế`,
      );
  }

  // 4–8. E-invoice structure
  if (inv) {
    add(
      'SIGNATURE',
      'Chữ ký số của người bán',
      inv.sellerSigned ? 'PASS' : 'FAIL',
      inv.sellerSigned
        ? `Có chữ ký số trong tệp XML${inv.certificates.length ? ' kèm chứng thư số' : ''}`
        : 'Tệp XML không có chữ ký số của người bán, hóa đơn điện tử hợp lệ luôn được ký',
    );
    if (inv.series.startsWith('C'))
      add(
        'TAX_AUTHORITY_CODE',
        'Mã của cơ quan thuế',
        inv.taxAuthorityCode ? 'PASS' : 'FAIL',
        inv.taxAuthorityCode
          ? `Có mã CQT ${inv.taxAuthorityCode.slice(0, 8)}`
          : 'Ký hiệu "C" là hóa đơn có mã nhưng tệp không có mã của cơ quan thuế (MCCQT)',
      );
    else add('TAX_AUTHORITY_CODE', 'Mã của cơ quan thuế', 'NA', 'Hóa đơn không mã (ký hiệu "K")');
    const sym = invoiceSymbolProblems(inv, inv.issueDate);
    add(
      'SYMBOL',
      'Ký hiệu hóa đơn',
      sym.length ? 'FAIL' : 'PASS',
      sym.length ? sym.join('; ') : `${inv.symbol} đúng định dạng và năm lập`,
    );
    add(
      'ARITHMETIC',
      'Số học trên hóa đơn',
      inv.inconsistencies.length ? 'FAIL' : 'PASS',
      inv.inconsistencies.length
        ? inv.inconsistencies.join('; ')
        : 'Dòng hàng, thuế theo từng thuế suất và tổng thanh toán khớp nhau',
    );
    const rates = [
      ...new Set([...inv.rates.map((r) => r.rate), ...inv.lines.map((l) => l.vatRate)].filter(Boolean)),
    ];
    const odd = rates.filter((r) => !VALID_RATES.test(r));
    add(
      'VAT_RATE',
      'Thuế suất GTGT',
      odd.length ? 'WARN' : rates.length ? 'PASS' : 'NA',
      odd.length
        ? `Thuế suất không thông dụng: ${odd.join(', ')}`
        : rates.length
          ? `Thuế suất ${rates.join(', ')}`
          : 'Hóa đơn không ghi thuế suất',
    );
    if (inv.related)
      add(
        'RELATED',
        'Hóa đơn thay thế / điều chỉnh',
        'WARN',
        `${inv.related.kind === 'REPLACEMENT' ? 'Thay thế' : 'Điều chỉnh'} hóa đơn ${inv.related.symbol} số ${inv.related.documentNo}, kiểm tra hóa đơn gốc trước khi ghi sổ`,
      );
  } else if (f.series) {
    const sym = invoiceSymbolProblems(
      { formNo: f.series[0] ?? '', series: f.series.slice(1) },
      f.documentDate,
    );
    add(
      'SYMBOL',
      'Ký hiệu hóa đơn',
      sym.length ? 'FAIL' : 'PASS',
      sym.length ? sym.join('; ') : `${f.series} đúng định dạng`,
    );
  }

  // 9–10. Duplicates
  add(
    'DUPLICATE_FILE',
    'Trùng tệp đã tiếp nhận',
    i.duplicateFileOf ? 'FAIL' : 'PASS',
    i.duplicateFileOf
      ? `Cùng dấu vân tay SHA-256 với tệp của ${i.duplicateFileOf}`
      : 'Tệp chưa từng được tiếp nhận',
  );
  add(
    'DUPLICATE_DOCUMENT',
    isInvoice ? 'Trùng hóa đơn' : 'Trùng chứng từ',
    i.sameDocumentAs ? 'FAIL' : 'PASS',
    i.sameDocumentAs
      ? `${isInvoice ? 'Cùng MST, ký hiệu và số' : 'Cùng đối tác và số'} với ${i.sameDocumentAs}`
      : isInvoice
        ? 'Không có hóa đơn nào cùng MST, ký hiệu và số'
        : 'Không có chứng từ nào cùng đối tác và số',
  );

  // 11. Date
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.documentDate)) {
    const ageDays = (Date.parse(i.today) - Date.parse(f.documentDate)) / 86_400_000;
    add(
      'DATE',
      'Ngày chứng từ',
      ageDays < 0 ? 'FAIL' : ageDays > 366 ? 'WARN' : 'PASS',
      ageDays < 0
        ? 'Ngày chứng từ ở tương lai'
        : ageDays > 366
          ? `Chứng từ đã ${Math.floor(ageDays)} ngày, quá một năm`
          : 'Ngày hợp lý',
    );
  }

  // 12. Amount compared with this counterparty's history
  const totals = i.history.map((h) => h.total).filter((t) => /^-?\d+(\.\d+)?$/.test(t) && D(t).gt(0));
  if (totals.length >= 3 && /^\d+(\.\d+)?$/.test(f.total)) {
    const med = median(totals);
    const high = D(f.total).gt(D(med).times(3));
    add(
      'AMOUNT',
      'Số tiền so với các lần trước',
      high ? 'WARN' : 'PASS',
      high
        ? `${vnd(f.total)} cao hơn 3 lần trung vị ${vnd(med)} của ${totals.length} chứng từ trước`
        : `Trong khoảng thường gặp (trung vị ${vnd(med)})`,
    );
  }

  // 13. Non-cash payment rule and invoices split under it
  if (i.kind === 'EXPENSE' && /^\d+(\.\d+)?$/.test(f.total)) {
    const big = D(f.total).gte(threshold);
    const cash = inv ? /^TM$|tiền mặt/i.test(inv.paymentMethod.trim()) : false;
    // Paid by bank transfer according to the invoice: splitting would not change deductibility.
    const transfer = inv ? /^(CK|chuyển khoản)$/i.test(inv.paymentMethod.trim()) : false;
    const sameDay = transfer
      ? []
      : i.history.filter((h) => h.date === f.documentDate && D(h.total).lt(threshold));
    const splitSum = sameDay.reduce((s, h) => s.plus(h.total), D(f.total));
    if (big && cash)
      add(
        'NON_CASH',
        'Thanh toán không dùng tiền mặt',
        'WARN',
        `Hóa đơn từ ${vnd(threshold)} ghi hình thức tiền mặt: thuế GTGT đầu vào chỉ được khấu trừ khi có chứng từ thanh toán không dùng tiền mặt (Luật Thuế GTGT 48/2024)`,
      );
    else if (!big && sameDay.length && splitSum.gte(threshold))
      add(
        'NON_CASH',
        'Thanh toán không dùng tiền mặt',
        'WARN',
        `${sameDay.length + 1} chứng từ cùng ngày của cùng đối tác, mỗi chứng từ dưới ${vnd(threshold)} nhưng cộng lại ${vnd(dec(splitSum))}, dấu hiệu tách hóa đơn`,
      );
    else
      add(
        'NON_CASH',
        'Thanh toán không dùng tiền mặt',
        big ? 'PASS' : 'NA',
        big ? 'Cần chứng từ chuyển khoản khi thanh toán' : `Dưới ngưỡng ${vnd(threshold)}`,
      );
  }

  // 14. Photo editing traces
  if (i.sourceKind === 'PHOTO') {
    const editor = editingSoftware(i.imageMeta);
    add(
      'IMAGE_EDIT',
      'Dấu vết chỉnh sửa ảnh',
      editor ? 'WARN' : i.imageMeta && (i.imageMeta.make || i.imageMeta.software) ? 'PASS' : 'NA',
      editor
        ? `Ảnh được lưu bởi phần mềm chỉnh sửa "${editor}", đối chiếu với bản giấy`
        : i.imageMeta?.make
          ? `Chụp bằng ${[i.imageMeta.make, i.imageMeta.model].filter(Boolean).join(' ')}${i.imageMeta.takenAt ? ` lúc ${i.imageMeta.takenAt}` : ''}`
          : 'Ảnh không có thông tin máy chụp để đối chiếu',
    );
  }

  // 15. QR code (QĐ 1450 Khoản 7 Mục IV Phần I): TLV data with the invoice identity and a CRC.
  const qrRaw = (inv?.qrData || i.qr || '').trim();
  if (qrRaw) {
    const content = readQrContent(qrRaw);
    if (content.kind === 'INVOICE') {
      const q = content.qr;
      const seen = new Set<string>();
      const diffs = [
        ...(inv
          ? compareQrWithDocument(q, {
              taxCode: inv.sellerTaxCode,
              series: inv.symbol,
              documentNo: inv.documentNo,
              documentDate: inv.issueDate,
              total: inv.total,
            })
          : []),
        // Typed / extracted fields are in VND; the QR total is in the invoice currency.
        ...compareQrWithDocument(q, inv && inv.currency !== 'VND' ? { ...f, total: undefined } : f),
      ].filter((d) => !seen.has(d.field) && seen.add(d.field));
      const format = q.problems.filter((p) => !p.startsWith('Mã kiểm tra CRC'));
      add(
        'QR',
        'Mã QR của hóa đơn',
        !q.crcOk || diffs.length ? 'FAIL' : format.length ? 'WARN' : 'PASS',
        !q.crcOk
          ? 'Mã kiểm tra CRC của mã QR không khớp, dữ liệu QR đã bị thay đổi hoặc ảnh chụp đọc sai'
          : diffs.length
            ? `Mã QR ghi ${diffs.map((d) => `${d.label} ${d.qr}`).join(', ')} nhưng chứng từ ghi ${diffs.map((d) => d.document).join(', ')}`
            : format.length
              ? format.join('; ')
              : `Đúng chuẩn của cơ quan thuế, khớp MST ${q.sellerTaxCode}, ký hiệu ${q.symbol}, số ${q.documentNo}, ngày lập và tổng tiền`,
      );
    } else
      add(
        'QR',
        'Mã QR của hóa đơn',
        'NA',
        content.kind === 'URL'
          ? `Mã QR là đường dẫn tra cứu của nhà cung cấp hóa đơn (${content.host}), không chứa dữ liệu hóa đơn để đối chiếu`
          : 'Mã QR không chứa thông tin tra cứu hóa đơn (có thể là mã thanh toán)',
      );
  } else if (inv || i.sourceKind === 'PHOTO')
    add(
      'QR',
      'Mã QR của hóa đơn',
      'NA',
      inv ? 'Tệp XML không kèm dữ liệu QR (không bắt buộc)' : 'Không đọc được mã QR trên ảnh',
    );

  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  const level = fails ? 'HIGH' : warns ? 'MEDIUM' : 'LOW';
  return {
    level,
    levelLabel: level === 'HIGH' ? 'Rủi ro cao' : level === 'MEDIUM' ? 'Cần lưu ý' : 'Rủi ro thấp',
    checks,
    lookupUrl: inv || f.series ? 'https://hoadondientu.gdt.gov.vn/' : null,
  };
}
