import { describe, expect, it } from 'vitest';
import { canonicalDecimal, requireAmount, requireDecimal } from '../src';

describe('decimal input', () => {
  it('is stored in its canonical spelling, keeping the scale', () => {
    expect(canonicalDecimal('007')).toBe('7');
    expect(canonicalDecimal('0')).toBe('0');
    expect(canonicalDecimal('0.50')).toBe('0.50');
    expect(canonicalDecimal('-0')).toBe('0');
    expect(canonicalDecimal('-0.00')).toBe('0.00');
    expect(canonicalDecimal('-00120.5')).toBe('-120.5');
    expect(requireAmount('1.250.000', 'Số tiền')).toBe('1250000');
    expect(requireAmount('0012,50', 'Số tiền')).toBe('12.50');
    expect(requireDecimal('00.05', 'Tỷ lệ')).toBe('0.05');
  });
});
