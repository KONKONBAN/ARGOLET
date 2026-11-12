/**
 * Canonical JSON (sorted keys, no insignificant whitespace) — "JSON canonical" in
 * board section 06 / A2. Used before hashing manifests, approval targets and snapshots
 * so that the same content always yields the same digest on every platform.
 */
export type Canonicalizable =
  | null
  | boolean
  | number
  | string
  | Canonicalizable[]
  | { [key: string]: Canonicalizable | undefined };

export function canonicalize(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<unknown>): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('Không thể chuẩn hóa số không hữu hạn');
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'object': {
      if (seen.has(value)) throw new TypeError('Không thể chuẩn hóa dữ liệu vòng lặp');
      seen.add(value);
      let out: string;
      if (Array.isArray(value)) {
        out = '[' + value.map((v) => (v === undefined ? 'null' : serialize(v, seen))).join(',') + ']';
      } else if (value instanceof Date) {
        out = JSON.stringify(value.toISOString());
      } else if (typeof (value as { toFixed?: unknown }).toFixed === 'function' && 'd' in (value as object)) {
        // decimal.js instance → canonical decimal string
        out = JSON.stringify((value as { toFixed: () => string }).toFixed());
      } else {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj)
          .filter((k) => obj[k] !== undefined)
          .sort();
        out = '{' + keys.map((k) => JSON.stringify(k) + ':' + serialize(obj[k], seen)).join(',') + '}';
      }
      seen.delete(value);
      return out;
    }
    default:
      throw new TypeError(`Kiểu dữ liệu không hỗ trợ chuẩn hóa: ${typeof value}`);
  }
}
