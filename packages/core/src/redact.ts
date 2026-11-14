/**
 * Personal data is replaced by placeholders before anything is sent to an AI provider, and put
 * back in the answer shown to the user. The mapping lives only for one request, on the server.
 *
 *  - free text: e-mail addresses, Vietnamese phone numbers, tax codes (check digit), citizen ID
 *    numbers (CCCD, 12 digits), bank account numbers introduced as such (STK / số tài khoản…);
 *  - structured data: values under personal keys (email, phone, account, tax code, CCCD);
 *    amounts stay untouched — answers need them;
 *  - names of the organisation's people, given by the caller.
 */
import { taxCodeChecksumOk } from './einvoice';

export type PiiKind = 'EMAIL' | 'SĐT' | 'MST' | 'CCCD' | 'STK' | 'NGƯỜI';

export interface Redactor {
  /** Replaces personal data in a text. */
  text(s: string): string;
  /** Replaces personal data anywhere in a JSON-like value (keys kept). */
  value<T>(v: T): T;
  /** Puts the original values back into a text produced from redacted input. */
  restore(s: string): string;
  /** How many distinct values of each kind were hidden. */
  counts(): Partial<Record<PiiKind, number>>;
}

const PERSONAL_KEY =
  /email|phone|mobile|sdt|account(number)?$|accountNo|bankAccount|taxCode|^mst$|cccd|idNumber|citizen/i;
const MONEY_KEY =
  /^(amount|total|subtotal|vat|price|fee|refund|discount|value|sum|balance|accumulated|count|qty|quantity|gross|net|paid)$|(amount|total|vnd|price|fee|balance)$/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACCOUNT_CTX =
  /((?:STK|số\s*tài\s*khoản|so\s*tai\s*khoan|tài\s*khoản|TK)\s*[:#]?\s*)(\d[\d\s.-]{5,22}\d)/giu;
/** Runs of digits (with the separators people type in phone numbers) not inside a longer number. */
const DIGITS = /(?<!\d)(?<!\d[.,])(\+?84[\s.-]?|0)?\d(?:[\s.-]?\d){7,13}(?!\d|[.,]\d)/g;

function classify(raw: string): PiiKind | null {
  const d = raw.replace(/[^\d+]/g, '');
  const plain = d.replace(/^\+?84/, '0');
  if (/^\d{10}-?\d{3}$/.test(raw.replace(/\s/g, '')) && taxCodeChecksumOk(raw.replace(/\s/g, '')))
    return 'MST';
  if (/^\d{10}$/.test(plain) && taxCodeChecksumOk(plain)) return 'MST';
  if (/^0[35789]\d{8}$/.test(plain) || /^02\d{9}$/.test(plain)) return 'SĐT';
  if (/^0\d{11}$/.test(plain) && !/[\s.-]/.test(raw)) return 'CCCD';
  return null;
}

export function createRedactor(known: { people?: string[] } = {}): Redactor {
  const byValue = new Map<string, string>();
  const byToken = new Map<string, string>();
  const n: Partial<Record<PiiKind, number>> = {};
  const token = (kind: PiiKind, original: string) => {
    const key = `${kind}:${original}`;
    let t = byValue.get(key);
    if (!t) {
      n[kind] = (n[kind] ?? 0) + 1;
      t = `[${kind}_${n[kind]}]`;
      byValue.set(key, t);
      byToken.set(t, original);
    }
    return t;
  };
  const people = [...new Set((known.people ?? []).map((p) => p.trim()).filter((p) => p.length >= 4))].sort(
    (a, b) => b.length - a.length,
  );
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const peopleRe = people.length ? new RegExp(people.map(escape).join('|'), 'gu') : null;

  const text = (s: string): string => {
    let out = s.replace(EMAIL, (m) => token('EMAIL', m));
    out = out.replace(ACCOUNT_CTX, (_m, lead: string, num: string) => `${lead}${token('STK', num)}`);
    out = out.replace(DIGITS, (m) => {
      const kind = classify(m);
      return kind ? token(kind, m) : m;
    });
    if (peopleRe) out = out.replace(peopleRe, (m) => token('NGƯỜI', m));
    return out;
  };

  const value = <T>(v: T, key = ''): T => {
    if (typeof v === 'string') {
      if (PERSONAL_KEY.test(key) && !MONEY_KEY.test(key) && v.trim())
        return token(
          /email/i.test(key)
            ? 'EMAIL'
            : /phone|mobile|sdt/i.test(key)
              ? 'SĐT'
              : /tax|mst/i.test(key)
                ? 'MST'
                : /cccd|id|citizen/i.test(key)
                  ? 'CCCD'
                  : 'STK',
          v,
        ) as T;
      return (MONEY_KEY.test(key) ? v : text(v)) as T;
    }
    if (Array.isArray(v)) return v.map((x) => value(x, key)) as T;
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x, k)])) as T;
    return v;
  };

  const restore = (s: string) =>
    s.replace(/\[(EMAIL|SĐT|MST|CCCD|STK|NGƯỜI)_\d+\]/gu, (t) => byToken.get(t) ?? t);

  return { text, value: (v) => value(v), restore, counts: () => ({ ...n }) };
}
