import { D, type DecimalInput } from './decimal';

/** Vietnamese number formatting: "." for thousands, "," for decimals. */
export function formatNumber(value: DecimalInput, fractionDigits = 0): string {
  const d = D(value);
  const negative = d.isNeg() && !d.isZero();
  const fixed = d.abs().toFixed(fractionDigits);
  const [intPart = '0', fracPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '−' : '') + grouped + (fracPart ? ',' + fracPart : '');
}

/** 7250000 → "7.250.000 đ" */
export function formatVnd(value: DecimalInput): string {
  return `${formatNumber(D(value).toDecimalPlaces(0))} đ`;
}

/** 84600000 → "+84.600.000 đ"; −125000 → "−125.000 đ" */
export function formatSignedVnd(value: DecimalInput): string {
  const d = D(value);
  return (d.gt(0) ? '+' : '') + formatVnd(d);
}

/** Amount already expressed in millions: 137.236 → "137,24 triệu" */
export function formatMillions(valueInMillions: DecimalInput, fractionDigits = 2): string {
  return `${formatNumber(valueInMillions, fractionDigits)} triệu`;
}

/** 428600000 → "428,6 triệu" (compact) */
export function formatCompactVnd(value: DecimalInput): string {
  const d = D(value);
  if (d.abs().gte(1_000_000_000)) return `${trimZeros(formatNumber(d.div(1_000_000_000), 2))} tỷ`;
  if (d.abs().gte(1_000_000)) return `${trimZeros(formatNumber(d.div(1_000_000), 1))} triệu`;
  return formatVnd(d);
}

function trimZeros(s: string): string {
  return s.includes(',') ? s.replace(/,?0+$/, '') : s;
}

/** 0.15237 → "15,24%" */
export function formatPercent(ratio: DecimalInput, fractionDigits = 2): string {
  return `${formatNumber(D(ratio).times(100), fractionDigits)}%`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO date/datetime → "31/10/2026" */
export function formatDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** ISO datetime → "31/10, 09:32" (Vietnam time, UTC+7) */
export function formatShortDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** ISO datetime → "09:32 ngày 31/10/2026" (Vietnam time, UTC+7) */
export function formatTimeDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ngày ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

/** "2026-10" → "Tháng 10/2026" */
export function formatPeriod(periodId: string): string {
  const [y, m] = periodId.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

/** Shorten a hex fingerprint: 0167ecbf31e793…237b3c1e1e3d5c */
export function shortHash(hex: string, head = 14, tail = 14): string {
  if (hex.length <= head + tail) return hex;
  return `${hex.slice(0, head)} ${hex.slice(-tail)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[parts.length - 2]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
