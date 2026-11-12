import DecimalLib from 'decimal.js';

/**
 * Deterministic decimal arithmetic for every money and finance calculation.
 * Lõi xác định: Decimal, làm tròn, đơn vị (board section D).
 */
export const Decimal = DecimalLib.clone({ precision: 40, rounding: DecimalLib.ROUND_HALF_UP });
export type Decimal = InstanceType<typeof Decimal>;
export type DecimalInput = Decimal | string | number;

export function D(value: DecimalInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new RangeError(`Giá trị số không hợp lệ: ${value}`);
  }
  return new Decimal(value);
}

export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = new Decimal(0);
  for (const v of values) total = total.plus(D(v));
  return total;
}

/** Round to whole đồng (VND has no minor unit in practice). */
export function roundVnd(value: DecimalInput): Decimal {
  return D(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** Canonical string form used for storage, hashing and transport. */
export function dec(value: DecimalInput, places?: number): string {
  const d = D(value);
  return places === undefined ? d.toFixed() : d.toFixed(places);
}

export function isZero(value: DecimalInput, tolerance: DecimalInput = 0): boolean {
  return D(value).abs().lte(D(tolerance));
}

export function min(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.min(D(a), D(b));
}

export function max(a: DecimalInput, b: DecimalInput): Decimal {
  return Decimal.max(D(a), D(b));
}
