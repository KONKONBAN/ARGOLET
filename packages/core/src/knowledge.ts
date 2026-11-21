/**
 * What the assistant knows beyond the numbers, and what it must never talk about.
 *
 * Knowledge: short passages (terms, rules of the organisation, answers people corrected, pages of an
 * imported handbook) found for a question by keyword relevance (BM25 over syllables and syllable
 * pairs, so "hóa đơn" is matched as a word, not as "hóa" and "đơn" anywhere). Typed with or without
 * diacritics, the question finds the same passages.
 *
 * Locked topics: subjects the organisation declares internal (salaries, passwords, contracts...).
 * A question about one is refused before anything is sent to an AI provider, passages and data that
 * mention one are withheld, and an answer that mentions one is replaced by the refusal. Matching
 * respects diacritics ("lương" is salary, "lượng" in "số lượng" is not); a phrase typed without
 * diacritics ("bang luong") still matches, since the person may simply not have typed them.
 */

export interface KnowledgePassage {
  id: string;
  title: string;
  content: string;
}

export interface LockedTopic {
  id: string;
  name: string;
  /** Words and phrases that identify the topic, as people write them. */
  keywords: string[];
}

const nfc = (s: string) => s.normalize('NFC').toLowerCase();
const fold = (s: string) => nfc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const ascii = (s: string) => ![...s].some((ch) => ch.charCodeAt(0) > 127);

const STOP = new Set(
  [
    'va',
    'la',
    'cua',
    'co',
    'cho',
    'cac',
    'nhung',
    'duoc',
    'trong',
    'voi',
    'mot',
    'nay',
    'do',
    'thi',
    'gi',
    'nao',
    'khong',
    'bao',
    'nhieu',
    'the',
    'hay',
    'hoi',
    'toi',
    'ban',
    'em',
    'anh',
    'chi',
    'a',
    'oi',
    'nhe',
    'ah',
    'vay',
    'sao',
    'lam',
    'de',
    'khi',
    'neu',
    'o',
    've',
    'tu',
    'den',
    'ra',
    'vao',
  ].map(fold),
);

/** Function words that still form compounds ("đầu vào", "đầu ra", "đến hạn"): kept in pairs. */
const COMPOUND = new Set(['ra', 'vao', 'tu', 'den', 've', 'de', 'o', 'lam', 'do', 'the'].map(fold));

/** Syllables (folded, without stop words) and the pairs of neighbouring syllables. */
export function terms(text: string): string[] {
  const syl = fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  const out: string[] = [];
  const blocks = (w: string) => STOP.has(w) && !COMPOUND.has(w);
  for (let i = 0; i < syl.length; i++) {
    if (!STOP.has(syl[i]!)) out.push(syl[i]!);
    // "được khấu" or "là gì" are not words: a pair is kept only without a grammatical word.
    if (i + 1 < syl.length && !blocks(syl[i]!) && !blocks(syl[i + 1]!)) out.push(`${syl[i]} ${syl[i + 1]}`);
  }
  return out;
}

/** The passages most relevant to `query` (best first), at most `limit`, each with its score. */
export function searchKnowledge<T extends KnowledgePassage>(
  query: string,
  passages: T[],
  limit = 5,
): (T & { score: number })[] {
  const q = [...new Set(terms(query))];
  if (!q.length || !passages.length) return [];
  const docs = passages.map((p) => {
    // The title counts three times: it says what the passage is about.
    const title = terms(p.title);
    const t = [...title, ...title, ...title, ...terms(p.content)];
    const tf = new Map<string, number>();
    for (const w of t) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { p, tf, len: t.length };
  });
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const w of q) df.set(w, docs.filter((d) => d.tf.has(w)).length);
  const k1 = 1.2;
  const b = 0.5;
  const N = docs.length;
  const scored = docs.map((d) => {
    let s = 0;
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      const n = df.get(w)!;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      // A matched syllable pair is a matched word: worth more than its syllables.
      const weight = w.includes(' ') ? 1.6 : 1;
      s += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avg)));
    }
    return { ...d.p, score: s };
  });
  // Meaning in Vietnamese mostly lives in two-syllable words: a passage must share one with the
  // question, unless the question is one or two syllables (NPV, WACC, "khấu hao") all found.
  const words = q.filter((w) => w.includes(' '));
  const syllables = q.filter((w) => !w.includes(' '));
  const relevant = (d: (typeof docs)[number]) =>
    words.some((w) => d.tf.has(w)) || (syllables.length <= 2 && syllables.every((w) => d.tf.has(w)));
  const kept = scored.filter((x, i) => x.score > 0.5 && relevant(docs[i]!)).sort((a, b) => b.score - a.score);
  // Far weaker matches than the best one are noise (a shared word like "chi phí"), not related.
  const top = kept[0]?.score ?? 0;
  return kept.filter((x) => x.score >= 0.35 * top).slice(0, limit);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD = '[\\p{L}\\p{N}]';

/** The locked topic a text touches, with the word that gave it away; null when none. */
export function lockedTopicIn(
  text: string,
  topics: LockedTopic[],
): { topic: LockedTopic; keyword: string } | null {
  if (!text || !topics.length) return null;
  const exact = nfc(text);
  // Words typed without diacritics, compared without diacritics; the others exactly.
  const plainOnly = exact
    .split(/([^\p{L}\p{N}]+)/u)
    .map((tok) => (ascii(tok) ? tok : ' '.repeat(tok.length)))
    .join('');
  for (const topic of topics)
    // The longest phrase first, so "bảng lương" is reported rather than "lương".
    for (const raw of [...topic.keywords].sort((a, b) => b.length - a.length)) {
      const kw = nfc(raw.trim());
      if (kw.length < 2) continue;
      const exactRe = new RegExp(`(?<!${WORD})${escape(kw)}(?!${WORD})`, 'u');
      if (exactRe.test(exact)) return { topic, keyword: raw.trim() };
      // Without diacritics a single syllable is too ambiguous ("luong" may be "lượng" in "số
      // lượng"): only phrases, and keywords that have no diacritics themselves, are compared so.
      if (!ascii(kw) && !/\s/.test(kw)) continue;
      const plainRe = new RegExp(`(?<!${WORD})${escape(fold(kw))}(?!${WORD})`, 'u');
      if (plainRe.test(plainOnly)) return { topic, keyword: raw.trim() };
    }
  return null;
}

/** Replaces every string inside a value that touches a locked topic (data sent to an AI provider). */
export function withholdLocked<T>(value: T, topics: LockedTopic[], mark = '[thông tin nội bộ]'): T {
  if (!topics.length) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return lockedTopicIn(v, topics) ? mark : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Topics an organisation often keeps internal; offered as starting points, never on by default. */
export const LOCKED_TOPIC_PRESETS: Omit<LockedTopic, 'id'>[] = [
  {
    name: 'Lương, thưởng và thu nhập của nhân sự',
    keywords: ['lương', 'tiền lương', 'bảng lương', 'thưởng', 'phụ cấp', 'thu nhập cá nhân', 'thuế TNCN'],
  },
  {
    name: 'Mật khẩu, khóa truy cập và mã xác thực',
    keywords: ['mật khẩu', 'password', 'khóa API', 'API key', 'mã OTP', 'mã xác thực', 'token'],
  },
  {
    name: 'Hợp đồng và điều khoản với đối tác',
    keywords: ['hợp đồng', 'điều khoản', 'đàm phán', 'chiết khấu riêng'],
  },
  {
    name: 'Kế hoạch và chiến lược chưa công bố',
    keywords: ['chiến lược', 'kế hoạch mở rộng', 'sáp nhập', 'mua lại', 'tái cấu trúc'],
  },
];
