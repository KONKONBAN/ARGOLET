import { randomBytes } from './hash';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Sortable unique id (ULID-like): 10 chars time + 16 chars randomness, with a type prefix. */
export function newId(prefix: string, now: number = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(10);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i % 10]! % 32];
  return `${prefix}_${time}${rand}`;
}

/** Human readable sequential business codes: CT-1029, DS-1033, PO-032 ... */
export function nextCode(prefix: string, existing: string[], width = 4, start = 1000): string {
  let maxN = start - 1;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const code of existing) {
    const m = re.exec(code);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  return `${prefix}-${String(maxN + 1).padStart(width, '0')}`;
}
