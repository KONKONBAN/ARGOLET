/**
 * Two independent readings of a photo or scan, checked against each other:
 *  - OCR (character recognition, Vietnamese model) gives the exact text printed and where it is;
 *  - a VLM (vision-language model) understands the layout and picks the right fields.
 * A field both agree on is trusted; a field the VLM read that the OCR text does not contain, or a
 * field the two read differently, goes to a person with both readings shown. Nothing is guessed.
 */
import type { DocumentFields, ExtractionField, ExtractionResult } from './documents';

export interface OcrWord {
  text: string;
  bbox: [number, number, number, number];
  confidence: number;
}

export interface OcrReading {
  text: string;
  words: OcrWord[];
  /** Mean word confidence, 0–1. */
  confidence: number;
  engine: string;
}

export interface ExtractionDisagreement {
  field: keyof DocumentFields;
  ocr: string;
  vlm: string;
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.,]\d{3})+|\d{4,12})(?![\d])(?:[.,]\d{1,2}(?!\d))?/g;
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Amounts written on a line ("1.840.000", "1,840,000", "1840000"), in đồng. */
export function amountsIn(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const v = digitsOf(m[1]!).replace(/^0+(?=\d)/, '');
    if (v.length >= 3) out.push(v);
  }
  return out;
}

const TOTAL_KEYS: [RegExp, number][] = [
  [/tong (cong )?(tien )?thanh toan/, 5],
  [/tong cong/, 4],
  [/tong tien/, 3],
  [/(can|phai) thanh toan|thanh tien phai tra/, 3],
  [/\btotal\b|grand total/, 2],
  [/thanh toan/, 1],
];

function isoDate(d: number, m: number, y: number): string {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCDate() !== d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Dates written on the page ("Ngày 29 tháng 10 năm 2026", "29/10/2026", "29-10-26"). */
export function datesIn(text: string): string[] {
  const t = fold(text);
  const out: string[] = [];
  for (const m of t.matchAll(/ngay\s*(\d{1,2})\s*thang\s*(\d{1,2})\s*nam\s*(\d{2,4})/g)) {
    const v = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) out.push(v);
  }
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g)) {
    const v = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (v) out.push(v);
  }
  return out;
}

/** The fields a rule-based reading of the OCR text finds (no layout understanding). */
export function fieldsFromOcrText(
  text: string,
): Partial<DocumentFields> & { lines: { description: string; amount: string }[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const folded = lines.map(fold);
  const out: Partial<DocumentFields> & { lines: { description: string; amount: string }[] } = { lines: [] };

  const tax = /(?:mst|ma so thue|tax code)\s*[:.]?\s*(\d{10}(?:\s*-\s*\d{3})?)/.exec(fold(text));
  if (tax) out.taxCode = tax[1]!.replace(/\s/g, '');
  const series = /ky hieu\s*[:.]?\s*([0-9][a-z][0-9]{2}[a-z]{2,4})/.exec(fold(text));
  if (series) out.series = series[1]!.toUpperCase();
  const no =
    /(?:^|\s)(?:so|no\.?)\s*(?:hoa don|hd|chung tu|phieu)?\s*[:.]\s*([a-z0-9][a-z0-9\-/]{0,24})/.exec(
      fold(text),
    );
  if (no && /\d/.test(no[1]!)) out.documentNo = no[1]!.toUpperCase();
  const date = datesIn(text)[0];
  if (date) out.documentDate = date;

  let best: { rank: number; amount: string } | null = null;
  folded.forEach((l, i) => {
    const rank = TOTAL_KEYS.find(([re]) => re.test(l))?.[1];
    if (!rank) return;
    const amounts = amountsIn(lines[i]!).length ? amountsIn(lines[i]!) : amountsIn(lines[i + 1] ?? '');
    if (!amounts.length) return;
    const amount = amounts.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));
    if (!best || rank > best.rank) best = { rank, amount };
  });
  if (best) out.total = (best as { amount: string }).amount;

  const head = lines
    .slice(0, 10)
    .map((l) =>
      l.replace(/^(đơn vị bán( hàng)?|tên đơn vị|người bán|bên bán|nhà cung cấp|seller)\s*[:.]\s*/i, ''),
    );
  out.supplier =
    head.find((l) =>
      /cong ty|cty|cua hang|ho kinh doanh|doanh nghiep|sieu thi|tap doan|chi nhanh/.test(fold(l)),
    ) ??
    head.find((l) => /[a-zà-ỹ]{3,}/i.test(l) && !/^\d/.test(l)) ??
    '';

  folded.forEach((l, i) => {
    if (
      TOTAL_KEYS.some(([re]) => re.test(l)) ||
      /mst|ma so thue|so tai khoan|dien thoai|ngay|dia chi|bang chu|ky hieu|mau so|^(so|no\.?)\s*[:.]/.test(l)
    )
      return;
    const amounts = amountsIn(lines[i]!);
    const desc = lines[i]!.replace(AMOUNT, '').replace(/[|:]/g, ' ').trim();
    if (amounts.length && /[a-zà-ỹ]{2,}/i.test(desc))
      out.lines.push({ description: desc, amount: amounts.at(-1)! });
  });
  // Item lines are kept only when they add up to the total read: otherwise the reading is unreliable.
  const sumLines = out.lines.reduce((t, l) => t + BigInt(l.amount), 0n);
  if (!out.total || sumLines !== BigInt(out.total)) out.lines = [];
  return out;
}

/** Mean word confidence below which an OCR reading is ignored. */
export const MIN_OCR_CONFIDENCE = 0.6;

const NAMES: (keyof DocumentFields)[] = [
  'supplier',
  'documentNo',
  'documentDate',
  'total',
  'taxCode',
  'series',
];

function normal(name: keyof DocumentFields, v: string): string {
  if (!v) return '';
  if (name === 'total' || name === 'taxCode') return digitsOf(v).replace(/^0+(?=\d)/, '');
  if (name === 'documentNo' || name === 'series')
    return v
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .replace(/^0+(?=\d)/, '');
  if (name === 'supplier')
    return fold(v)
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return v;
}

/** Whether a value the VLM read is actually printed in the OCR text. */
function printed(name: keyof DocumentFields, value: string, ocr: OcrReading): boolean {
  const v = normal(name, value);
  if (!v) return false;
  if (name === 'total') return ocr.text.split(/\r?\n/).some((l) => amountsIn(l).includes(v));
  if (name === 'documentDate') return datesIn(ocr.text).includes(v);
  if (name === 'supplier') {
    const words = v
      .split(' ')
      .filter((w) => w.length > 1 && !['cong', 'ty', 'tnhh', 'cp', 'co', 'phan'].includes(w));
    if (!words.length) return false;
    const text = normal('supplier', ocr.text);
    return words.filter((w) => text.includes(w)).length / words.length >= 0.6;
  }
  const compact = ocr.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return compact.includes(v);
}

/** Box of the OCR word(s) holding a value, for highlighting it on the original. */
function boxOf(
  name: keyof DocumentFields,
  value: string,
  ocr: OcrReading,
): [number, number, number, number] | undefined {
  const v = normal(name, value);
  if (!v || name === 'supplier') return undefined;
  const w = ocr.words.find((x) =>
    name === 'total'
      ? digitsOf(x.text) === v
      : x.text
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '')
          .includes(v),
  );
  return w?.bbox;
}

/**
 * Merges an OCR reading and a VLM extraction (either may be missing). Agreement raises the
 * confidence; a VLM value the OCR text does not contain, or two different readings, lower it below
 * the review threshold and are reported as disagreements for the reviewer.
 */
export function reconcileReadings(p: {
  ocr: OcrReading | null;
  vlm: ExtractionResult | null;
}): ExtractionResult & { disagreements: ExtractionDisagreement[] } {
  const { vlm } = p;
  // A blurred, skewed or dark photo gives OCR text that cannot be trusted: it is not used at all.
  const ocr = p.ocr && p.ocr.confidence >= MIN_OCR_CONFIDENCE ? p.ocr : null;
  const fromOcr = ocr ? fieldsFromOcrText(ocr.text) : null;
  const disagreements: ExtractionDisagreement[] = [];
  const fields: ExtractionField[] = [];
  const ocrConfidence = ocr ? Math.min(0.7, ocr.confidence) : 0;
  for (const name of NAMES) {
    const v = vlm?.fields.find((f) => f.name === name);
    const o = fromOcr?.[name];
    const ov = typeof o === 'string' ? o : '';
    if (v?.value) {
      if (!ocr) {
        fields.push(v);
        continue;
      }
      const same = ov && normal(name, ov) === normal(name, v.value);
      const confirmed = same || printed(name, v.value, ocr);
      const bbox = boxOf(name, v.value, ocr) ?? v.bbox;
      if (confirmed) {
        fields.push({
          ...v,
          confidence: Math.max(v.confidence, same ? 0.98 : 0.95),
          ...(bbox ? { bbox } : {}),
        });
      } else {
        fields.push({ ...v, confidence: Math.min(v.confidence, 0.5), ...(bbox ? { bbox } : {}) });
        if (ov) disagreements.push({ field: name, ocr: ov, vlm: v.value });
      }
    } else if (ov) {
      const bbox = ocr ? boxOf(name, ov, ocr) : undefined;
      fields.push({ name, value: ov, confidence: ocrConfidence, page: 1, ...(bbox ? { bbox } : {}) });
    }
  }
  const engines = [p.ocr?.engine, vlm?.modelVersion].filter(Boolean).join(' + ');
  return {
    modelVersion: engines || 'manual-entry',
    fields,
    lines: vlm?.lines.length ? vlm.lines : (fromOcr?.lines ?? []),
    disagreements,
  };
}
