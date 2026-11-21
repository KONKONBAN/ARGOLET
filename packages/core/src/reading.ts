/**
 * Every reading of a photographed document, reconciled into one set of fields:
 *  - OCR, possibly several passes (the photo as taken, the restored page, its black-and-white copy),
 *    gives the exact characters printed and where they are;
 *  - a vision model (VLM) understands the layout and picks the right fields;
 *  - the amount in words and, on an e-invoice, the QR code give the total independently;
 *  - the figures of a VAT invoice must add up (core/invoicemath).
 * A field confirmed by independent readers is trusted; a field only one reader saw, or that readers
 * saw differently, goes to a person with the readings shown. Figures the equations recover are
 * filled in for a person to confirm. Nothing is guessed.
 */
import type { DocumentFields, ExtractionField, ExtractionResult, InvoiceAmounts } from './documents';
import { formatVnd } from './format';
import {
  amountsFromText,
  amountFromWords,
  blurredDigitApart,
  solveAmounts,
  totalConfidence,
  type AmountReading,
} from './invoicemath';
import {
  amountsIn,
  datesIn,
  fieldsFromOcrText,
  type ExtractionDisagreement,
  type OcrReading,
} from './ocrfields';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Mean word confidence below which an OCR pass may not fill or doubt a field on its own. */
export const MIN_OCR_CONFIDENCE = 0.6;
/** Below this an OCR pass is noise; between the two it may only support figures the equations confirm. */
export const WEAK_OCR_CONFIDENCE = 0.35;

const TEXT_FIELDS: (keyof DocumentFields)[] = ['supplier', 'documentNo', 'documentDate', 'taxCode', 'series'];

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

/** Whether a value is actually printed in the OCR text. */
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

/** The value most OCR passes read for a field (weighted by their confidence). */
function vote(name: keyof DocumentFields, passes: { o: OcrReading; f: Partial<DocumentFields> }[]): string {
  const tally = new Map<string, { raw: string; w: number }>();
  for (const { o, f } of passes) {
    const raw = f[name];
    if (typeof raw !== 'string' || !raw) continue;
    const key = normal(name, raw);
    const t = tally.get(key) ?? { raw, w: 0 };
    t.w += o.confidence;
    tally.set(key, t);
  }
  let best: { raw: string; w: number } | null = null;
  for (const t of tally.values()) if (!best || t.w > best.w) best = t;
  return best?.raw ?? '';
}

const vnd = (v: string) => formatVnd(v);

export function reconcileReadings(p: {
  ocr: OcrReading | OcrReading[] | null;
  vlm: ExtractionResult | null;
  /** Total carried by the e-invoice QR code (CRC checked), if the photo has one. */
  qrTotal?: string | null | undefined;
}): ExtractionResult & { disagreements: ExtractionDisagreement[] } {
  const { vlm } = p;
  const all = (Array.isArray(p.ocr) ? p.ocr : p.ocr ? [p.ocr] : []).filter((o) => o.text.trim());
  // A blurred, skewed or dark photo gives OCR text that cannot be trusted on its own.
  const strong = all
    .filter((o) => o.confidence >= MIN_OCR_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
  const weak = all.filter((o) => o.confidence >= WEAK_OCR_CONFIDENCE && o.confidence < MIN_OCR_CONFIDENCE);
  const passes = strong.map((o) => ({ o, f: fieldsFromOcrText(o.text) }));
  const best = strong[0] ?? null;
  const disagreements: ExtractionDisagreement[] = [];
  const fields: ExtractionField[] = [];
  const notes: string[] = [];
  const ocrConfidence = best ? Math.min(0.7, best.confidence) : 0;
  const boxIn = (name: keyof DocumentFields, value: string) => {
    for (const o of strong) {
      const b = boxOf(name, value, o);
      if (b) return b;
    }
    return undefined;
  };

  for (const name of TEXT_FIELDS) {
    const v = vlm?.fields.find((f) => f.name === name);
    const ov = vote(name, passes);
    if (v?.value) {
      if (!strong.length) {
        fields.push(v);
        continue;
      }
      const same = ov && normal(name, ov) === normal(name, v.value);
      const confirmed = same || strong.some((o) => printed(name, v.value, o));
      const bbox = boxIn(name, v.value) ?? v.bbox;
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
      const bbox = boxIn(name, ov);
      fields.push({ name, value: ov, confidence: ocrConfidence, page: 1, ...(bbox ? { bbox } : {}) });
    }
  }

  // The figures: every reading proposes values, the equations decide.
  const readings: AmountReading[] = [];
  for (const o of [...strong, ...weak]) {
    const isWeak = o.confidence < MIN_OCR_CONFIDENCE;
    const a = amountsFromText(o.text);
    const base = { source: 'ocr' as const, confidence: o.confidence, weak: isWeak };
    const totals = new Set([
      ...a.total,
      ...(fieldsFromOcrText(o.text).total ? [fieldsFromOcrText(o.text).total!] : []),
    ]);
    for (const t of totals) readings.push({ ...base, total: t });
    for (const s of a.subtotal) readings.push({ ...base, subtotal: s });
    for (const v of a.vatAmount) readings.push({ ...base, vatAmount: v });
    for (const r of a.vatRate) readings.push({ ...base, vatRate: r });
    if (a.words)
      readings.push({
        source: 'words',
        family: 'ocr',
        total: a.words,
        confidence: o.confidence,
        weak: isWeak,
      });
  }
  const vTotal = vlm?.fields.find((f) => f.name === 'total');
  if (vlm) {
    const c = vTotal?.confidence ?? 0.8;
    if (vTotal?.value)
      readings.push({ source: 'vlm', total: normal('total', vTotal.value), confidence: vTotal.confidence });
    const am = vlm.amounts;
    if (am?.subtotal) readings.push({ source: 'vlm', subtotal: digitsOf(am.subtotal), confidence: c });
    if (am?.vatAmount) readings.push({ source: 'vlm', vatAmount: digitsOf(am.vatAmount), confidence: c });
    if (am?.vatRate !== undefined) readings.push({ source: 'vlm', vatRate: am.vatRate, confidence: c });
    const words = am?.words ? amountFromWords(am.words) : null;
    if (words) readings.push({ source: 'words', family: 'vlm', total: words, confidence: c });
    const sum = vlm.lines.reduce((t, l) => t + (/^\d+$/.test(l.amount) ? BigInt(l.amount) : 0n), 0n);
    if (vlm.lines.length && sum > 0n)
      readings.push({ source: 'lines', subtotal: sum.toString(), confidence: c * 0.9 });
  }
  if (p.qrTotal && /^\d+$/.test(p.qrTotal)) readings.push({ source: 'qr', total: p.qrTotal, confidence: 1 });

  const solved = solveAmounts(readings);
  let amounts: InvoiceAmounts | undefined;
  if (solved.total) {
    const strongSupport = readings.some((r) => r.total === solved.total && !r.weak);
    const weakWordsAndDigits =
      readings.some((r) => r.total === solved.total && r.source === 'words') &&
      readings.some((r) => r.total === solved.total && r.source === 'ocr');
    // Only unsure OCR saw it: used only when the equations or the words back it up.
    const usable =
      strongSupport || solved.consistent || weakWordsAndDigits || solved.derived.includes('total');
    if (usable) {
      const confidence = strongSupport
        ? totalConfidence(solved, readings)
        : Math.min(0.5, totalConfidence(solved, readings));
      const bbox = boxIn('total', solved.total) ?? (vTotal?.value === solved.total ? vTotal.bbox : undefined);
      fields.push({ name: 'total', value: solved.total, confidence, page: 1, ...(bbox ? { bbox } : {}) });
      amounts = {
        ...(solved.subtotal ? { subtotal: solved.subtotal } : {}),
        ...(solved.vatAmount ? { vatAmount: solved.vatAmount } : {}),
        ...(solved.vatRate !== null ? { vatRate: solved.vatRate } : {}),
        total: solved.total,
        consistent: solved.consistent,
        derived: solved.derived,
      };
      // What the reviewer should know.
      if (solved.derived.includes('total') && solved.subtotal && solved.vatAmount)
        notes.push(
          `Tổng tiền không đọc rõ, đã tính từ tiền hàng ${vnd(solved.subtotal)} cộng thuế GTGT ${vnd(solved.vatAmount)}`,
        );
      else if (solved.derived.includes('subtotal') && solved.subtotal && solved.vatRate !== null)
        notes.push(
          `Tiền hàng ${vnd(solved.subtotal)} và thuế ${vnd(solved.vatAmount ?? '0')} tính từ tổng tiền và thuế suất ${solved.vatRate}%`,
        );
      if (solved.support.total.includes('words') && !solved.support.total.includes('qr'))
        notes.push('Tổng tiền khớp với số tiền viết bằng chữ trên chứng từ');
      if (solved.consistent && !solved.derived.length)
        notes.push('Tiền hàng cộng thuế GTGT khớp với tổng tiền thanh toán');
      const dropped = [...new Set(solved.rejected.filter((r) => r.family !== 'qr').map((r) => r.total))];
      if (dropped.length)
        notes.push(
          `Không dùng cách đọc ${dropped.map(vnd).join(', ')} vì không khớp với các số còn lại trên chứng từ`,
        );
      // OCR and the vision model read the total differently and nothing settles it: show both.
      const ocrTotal = vote('total', passes);
      if (
        vTotal?.value &&
        ocrTotal &&
        normal('total', ocrTotal) !== normal('total', vTotal.value) &&
        !blurredDigitApart(normal('total', ocrTotal), normal('total', vTotal.value)) &&
        confidence < 0.85
      )
        disagreements.push({
          field: 'total',
          ocr: normal('total', ocrTotal),
          vlm: normal('total', vTotal.value),
        });
    }
  } else if (vTotal?.value) {
    fields.push(vTotal);
  }

  const engines = [...new Set(all.map((o) => o.engine)), vlm?.modelVersion].filter(Boolean).join(' + ');
  return {
    modelVersion: engines || 'manual-entry',
    fields,
    lines: vlm?.lines.length
      ? vlm.lines
      : ((passes[0]?.f as { lines?: { description: string; amount: string }[] })?.lines ?? []),
    disagreements,
    ...(amounts ? { amounts } : {}),
    ...(notes.length ? { notes } : {}),
  };
}
