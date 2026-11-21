/**
 * The figures of an invoice check each other. On a Vietnamese VAT invoice (TT 78/2021, NĐ 123/2020):
 *
 *   Cộng tiền hàng (subtotal) + Tiền thuế GTGT (VAT) = Tổng tiền thanh toán (total)
 *   Tiền thuế GTGT = Cộng tiền hàng x thuế suất (0 %, 5 %, 8 % or 10 %), give or take rounding
 *   the item amounts add up to the subtotal
 *   the total is also written out in words ("Số tiền viết bằng chữ")
 *   and, on an e-invoice, carried by the QR code.
 *
 * A wet or crumpled invoice blurs digits (5, 6, 8, 9 and 3 look alike when the ink runs), yet the
 * amount in words, being long ordinary words, usually survives, and so do some of the other figures.
 * Every reading (several OCR passes, a vision model, the words, the QR) proposes values; the
 * combination that satisfies the equations and agrees with the most independent readings wins. A
 * figure no reading saw directly but the equations determine is filled in as "derived", for a
 * person to confirm. Nothing that fails the equations is passed off as certain.
 */
import { amountsIn } from './ocrfields';

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');

const DIGIT: Record<string, number> = {
  khong: 0,
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  nham: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
};
const SCALE: Record<string, bigint> = {
  nghin: 1000n,
  ngan: 1000n,
  trieu: 1000000n,
  ty: 1000000000n,
  ti: 1000000000n,
};

/**
 * Value of an amount written in Vietnamese words ("Một triệu sáu trăm năm mươi nghìn đồng",
 * "hai mươi lăm nghìn bốn trăm linh năm đồng chẵn"), in đồng; null when no number is written.
 */
export function amountFromWords(phrase: string): string | null {
  const tokens = fold(phrase)
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  let total = 0n;
  let group = 0n;
  let pending: number | null = null;
  let seen = false;
  // Within a group below one thousand: "X trăm", "X mươi" (tens), "mười" (ten), units.
  const flush = () => {
    if (pending !== null) group += BigInt(pending);
    pending = null;
  };
  for (const t of tokens) {
    if (t === 'dong' || t === 'vnd') break;
    if (t in DIGIT) {
      flush();
      pending = DIGIT[t]!;
      seen = true;
    } else if (t === 'tram') {
      group += BigInt(pending ?? 1) * 100n;
      pending = null;
      seen = true;
    } else if (t === 'muoi' || t === 'chuc') {
      // "mười" (ten) has no digit before it; "X mươi" multiplies the digit by ten.
      group += pending === null ? 10n : BigInt(pending) * 10n;
      pending = null;
      seen = true;
    } else if (t === 'linh' || t === 'le') {
      flush();
    } else if (t in SCALE) {
      flush();
      const s = SCALE[t]!;
      // "một trăm nghìn tỷ" and the like: a smaller scale already applied is multiplied up.
      if (s === 1000000000n && total > 0n && total < 1000000000n) total = (total + group) * s;
      else total += (group === 0n ? 1n : group) * s;
      group = 0n;
      seen = true;
    }
  }
  flush();
  total += group;
  return seen && total > 0n ? total.toString() : null;
}

/** The amount in words printed on the page ("Số tiền viết bằng chữ: ..."), if any. */
export function amountInWordsFromText(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const f = fold(lines[i]!);
    const at = f.search(/bang chu/);
    if (at < 0) continue;
    let phrase = lines[i]!.slice(at + 8).replace(/^[\s:.)-]+/, '');
    // The phrase may wrap onto the next line.
    if (!/dong/.test(fold(phrase)) && lines[i + 1]) phrase += ` ${lines[i + 1]}`;
    const v = amountFromWords(phrase);
    if (v) return v;
  }
  return null;
}

export interface AmountsRead {
  subtotal: string[];
  vatAmount: string[];
  /** Percent as written (0, 5, 8, 10). */
  vatRate: number[];
  total: string[];
  words: string | null;
}

const TOTAL_LABEL = /tong (cong )?(tien )?thanh toan|tong cong|tong tien|(can|phai) thanh toan/;
const SUBTOTAL_LABEL =
  /cong tien hang|tong tien hang|tien hang( hoa)?( chua thue)?|thanh tien truoc thue|cong tien truoc thue|gia tri chua thue/;
const VAT_LABEL = /tien thue( gtgt)?|thue gtgt\s*[:.]|vat amount/;

/** Candidate figures found next to their labels in OCR text (several per field when unsure). */
export function amountsFromText(text: string): AmountsRead {
  const out: AmountsRead = {
    subtotal: [],
    vatAmount: [],
    vatRate: [],
    total: [],
    words: amountInWordsFromText(text),
  };
  const lines = text.split(/\r?\n/);
  const add = (list: string[], v: string | undefined) => {
    if (v && !list.includes(v)) list.push(v);
  };
  lines.forEach((line, i) => {
    const f = fold(line);
    const amounts = amountsIn(line);
    const after = (re: RegExp) => {
      const m = re.exec(f);
      if (!m) return [] as string[];
      // Amounts written after the label on this line, else on the next line.
      const tail = amountsIn(line.slice(Math.min(line.length, m.index + m[0].length)));
      return tail.length ? tail : amountsIn(lines[i + 1] ?? '');
    };
    for (const m of f.matchAll(/thue suat[^0-9k]{0,12}(\d{1,2})\s*%/g)) {
      const r = Number(m[1]);
      if ([0, 5, 8, 10].includes(r) && !out.vatRate.includes(r)) out.vatRate.push(r);
    }
    if (/thue suat[^a-z0-9]{0,6}(kct|khong chiu thue)/.test(f) && !out.vatRate.includes(0))
      out.vatRate.push(0);
    if (/bang chu/.test(f)) return;
    if (SUBTOTAL_LABEL.test(f)) add(out.subtotal, after(SUBTOTAL_LABEL).at(-1));
    if (VAT_LABEL.test(f)) add(out.vatAmount, after(VAT_LABEL).at(-1));
    if (
      TOTAL_LABEL.test(f) &&
      !SUBTOTAL_LABEL.test(f) &&
      amounts.length + amountsIn(lines[i + 1] ?? '').length
    ) {
      const list = after(TOTAL_LABEL);
      if (list.length)
        add(
          out.total,
          list.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a)),
        );
    }
  });
  return out;
}

export type AmountSource = 'qr' | 'vlm' | 'ocr' | 'words' | 'lines';

/** One reading of the figures. Several OCR passes share the source "ocr" (they are not independent). */
export interface AmountReading {
  source: AmountSource;
  subtotal?: string | undefined;
  vatAmount?: string | undefined;
  vatRate?: number | undefined;
  total?: string | undefined;
  /** 0 to 1. */
  confidence: number;
  /**
   * A reading too unsure to doubt anything (OCR of a badly damaged photo): it can support a value,
   * at half weight, but never speaks against one.
   */
  weak?: boolean | undefined;
  /**
   * Readings from the same reader are not independent evidence of each other: the amount in words
   * read by the vision model belongs to "vlm", read by OCR to "ocr". Defaults to the source.
   */
  family?: 'qr' | 'vlm' | 'ocr' | undefined;
}

const familyOf = (r: AmountReading): 'qr' | 'vlm' | 'ocr' =>
  r.family ?? (r.source === 'qr' ? 'qr' : r.source === 'vlm' || r.source === 'lines' ? 'vlm' : 'ocr');

export interface SolvedAmounts {
  total: string | null;
  subtotal: string | null;
  vatAmount: string | null;
  vatRate: number | null;
  /** The figures satisfy subtotal + VAT = total (and the rate) with every one of them known. */
  consistent: boolean;
  /** Independent sources that read each figure as solved. */
  support: { total: AmountSource[]; subtotal: AmountSource[]; vatAmount: AmountSource[] };
  /** Figures no reading saw but the equations determine. */
  derived: ('total' | 'subtotal' | 'vatAmount')[];
  /** Readings of the total that the solution rejects (shown to the reviewer). */
  rejected: { source: AmountSource; total: string; weak: boolean; family: 'qr' | 'vlm' | 'ocr' }[];
}

const WEIGHT: Record<AmountSource, number> = { qr: 5, vlm: 2.2, words: 2, ocr: 1.5, lines: 1 };
const RATES = [0, 5, 8, 10];

/** VAT computed per line and summed may differ from subtotal x rate by a few đồng. */
const vatMatches = (subtotal: bigint, vat: bigint, rate: number) => {
  const exact = (subtotal * BigInt(rate * 10)) / 1000n;
  const diff = vat > exact ? vat - exact : exact - vat;
  return diff <= 2n + subtotal / 100000n;
};

// A reading one digit away, where the two digits look alike when blurred (5 and 6, 8 and 9, 3 and
// 8, 1 and 7...), is weak support, never counted as agreement nor as contradiction.
const LOOKALIKE: Record<string, string> = {
  '0': '689',
  '1': '7',
  '3': '589',
  '5': '369',
  '6': '0589',
  '7': '1',
  '8': '03569',
  '9': '03568',
};
export function blurredDigitApart(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++)
    if (a[i] !== b[i]) {
      if (++d > 1 || !(LOOKALIKE[a[i]!] ?? '').includes(b[i]!)) return false;
    }
  return true;
}

export function solveAmounts(readings: AmountReading[]): SolvedAmounts {
  const pos = (v: string | undefined) => (v && /^\d+$/.test(v) && BigInt(v) > 0n ? v : undefined);
  const totals = new Set<string>();
  const subs = new Set<string>();
  const vats = new Set<string>(['0']);
  const rates = new Set<number>();
  for (const r of readings) {
    if (pos(r.total)) totals.add(r.total!);
    if (pos(r.subtotal)) subs.add(r.subtotal!);
    if (r.vatAmount !== undefined && /^\d+$/.test(r.vatAmount)) vats.add(r.vatAmount);
    if (r.vatRate !== undefined && RATES.includes(r.vatRate)) rates.add(r.vatRate);
  }
  // Values the equations give from the others (so a figure nobody could read can be recovered).
  const rateList = rates.size ? [...rates] : RATES;
  for (const s of [...subs]) {
    for (const v of [...vats]) totals.add((BigInt(s) + BigInt(v)).toString());
    for (const r of rateList) {
      const v = (BigInt(s) * BigInt(r * 10)) / 1000n;
      vats.add(v.toString());
      totals.add((BigInt(s) + v).toString());
    }
  }
  for (const t of [...totals]) {
    for (const v of [...vats]) if (BigInt(v) < BigInt(t)) subs.add((BigInt(t) - BigInt(v)).toString());
    for (const r of rateList) {
      const s = (BigInt(t) * 100n + BigInt(100 + r) / 2n) / BigInt(100 + r);
      subs.add(s.toString());
      vats.add((BigInt(t) - s).toString());
    }
  }

  const empty: SolvedAmounts = {
    total: null,
    subtotal: null,
    vatAmount: null,
    vatRate: null,
    consistent: false,
    support: { total: [], subtotal: [], vatAmount: [] },
    derived: [],
    rejected: [],
  };
  if (!totals.size) return empty;

  const strength = (r: AmountReading) => WEIGHT[r.source] * (0.5 + r.confidence / 2) * (r.weak ? 0.5 : 1);
  const supportOf = (field: 'total' | 'subtotal' | 'vatAmount', value: string) => {
    const by = new Map<AmountSource, number>();
    for (const r of readings)
      if (r[field] === value) by.set(r.source, Math.max(by.get(r.source) ?? 0, strength(r)));
    return by;
  };
  type Pick = {
    t: string;
    s: string | null;
    v: string | null;
    r: number | null;
    score: number;
    consistent: boolean;
  };
  let best: Pick | null = null;
  const consider = (p: Pick) => {
    if (!best || p.score > best.score + 1e-9) best = p;
  };
  const read = (field: 'total' | 'subtotal' | 'vatAmount', value: string | null) => {
    if (value === null) return 0;
    let s = 0;
    const support = supportOf(field, value);
    for (const w of support.values()) s += w;
    const against = new Map<AmountSource, number>();
    for (const r of readings) {
      const x = r[field];
      if (!x || x === value) continue;
      const w = strength(r);
      if (blurredDigitApart(x, value)) s += 0.25 * w;
      // A source that read something else entirely speaks against this value (once per source).
      else if (!r.weak && !support.has(r.source))
        against.set(r.source, Math.max(against.get(r.source) ?? 0, w));
    }
    for (const w of against.values()) s -= w;
    return s;
  };
  const exact = (field: 'total' | 'subtotal' | 'vatAmount', value: string | null) =>
    value !== null && readings.some((r) => r[field] === value);
  const rateRead = (r: number | null) => (r !== null && readings.some((x) => x.vatRate === r) ? 0.8 : 0);

  for (const t of totals) {
    const tb = BigInt(t);
    // The total alone (nothing else read is consistent with it).
    consider({ t, s: null, v: null, r: null, score: read('total', t), consistent: false });
    for (const s of subs) {
      const sb = BigInt(s);
      if (sb > tb) continue;
      const vb = tb - sb;
      const v = vb.toString();
      const rateOk = RATES.filter((r) => vatMatches(sb, vb, r));
      // No single rate fits: possible only for an invoice mixing rates (VAT between 0 % and 10 %).
      if (!rateOk.length && vb * 1000n > sb * 100n + 1000n) continue;
      const figures = [exact('total', t), exact('subtotal', s), exact('vatAmount', v)].filter(Boolean).length;
      for (const r of rateOk.length ? rateOk : [null]) {
        const base = read('total', t) + read('subtotal', s) + read('vatAmount', v) + rateRead(r);
        // An equation that holds is evidence too: strong when two figures were read, some when one
        // figure and the rate were.
        const bonus = r === null ? 0 : figures >= 2 ? 1.5 : figures === 1 && rateRead(r) > 0 ? 0.6 : 0;
        // One figure without a printed rate determines nothing new (that is the total alone).
        if (figures === 0 || (figures === 1 && (r === null || rateRead(r) === 0))) continue;
        consider({ t, s, v, r, score: base + bonus, consistent: r !== null });
      }
    }
  }
  const b = best as Pick | null;
  if (!b || b.score <= 0) return empty;
  const sources = (field: 'total' | 'subtotal' | 'vatAmount', value: string | null) =>
    value === null ? [] : [...supportOf(field, value).keys()];
  const support = {
    total: sources('total', b.t),
    subtotal: sources('subtotal', b.s),
    vatAmount: sources('vatAmount', b.v),
  };
  const derived = (['total', 'subtotal', 'vatAmount'] as const).filter((f) => {
    const value = f === 'total' ? b.t : f === 'subtotal' ? b.s : b.v;
    return value !== null && support[f].length === 0;
  });
  const rejected: SolvedAmounts['rejected'] = [];
  for (const r of readings)
    if (
      pos(r.total) &&
      r.total !== b.t &&
      !rejected.some((x) => x.source === r.source && x.total === r.total)
    )
      rejected.push({ source: r.source, total: r.total!, weak: !!r.weak, family: familyOf(r) });
  return {
    total: b.t,
    subtotal: b.s,
    vatAmount: b.v,
    vatRate: b.r,
    consistent: b.consistent,
    support,
    derived,
    rejected,
  };
}

/**
 * Confidence in the solved total, by how many independent readers (the QR, the vision model, OCR)
 * saw it:
 *  - the QR, or two readers agreeing, is as good as certain (more so when the equations hold);
 *  - the vision model alone keeps its own confidence, unless another reader saw something else;
 *  - OCR alone is always checked by a person (at most 0.7), however well the figures add up;
 *  - a figure only the equations give, or one another reader contradicts, goes to a person.
 */
export function totalConfidence(s: SolvedAmounts, readings: AmountReading[]): number {
  if (!s.total) return 0;
  const agreeing = readings.filter((r) => r.total === s.total);
  const families = new Set(agreeing.filter((r) => !r.weak).map(familyOf));
  if (families.has('qr')) return 0.99;
  const contradicted = s.rejected.some((r) => !r.weak && !blurredDigitApart(r.total, s.total!));
  if (families.size >= 2) return s.consistent ? 0.98 : 0.95;
  if (families.has('vlm')) {
    const own = Math.max(...agreeing.filter((r) => familyOf(r) === 'vlm').map((r) => r.confidence));
    return contradicted ? Math.min(own, 0.5) : own;
  }
  if (families.has('ocr')) {
    const own = Math.max(
      ...agreeing.filter((r) => familyOf(r) === 'ocr' && !r.weak).map((r) => r.confidence),
    );
    return Math.min(contradicted ? 0.5 : 0.7, own);
  }
  if (s.derived.includes('total')) return s.consistent ? 0.7 : 0.5;
  return 0.5;
}
