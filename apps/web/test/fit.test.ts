/**
 * Automatic fit to the screen: the scale chosen for common screens.
 */
import { describe, expect, it } from 'vitest';
import { fitFor } from '../src/ui/fit';

describe('scale for each screen', () => {
  it.each([
    ['small phone', 320, 568, 1],
    ['phone', 390, 844, 1],
    ['tablet portrait', 768, 1024, 1],
    ['tablet landscape', 1024, 768, 1],
    ['iPad Pro landscape', 1180, 820, 1],
    ['short laptop', 1280, 720, 0.9],
    ['laptop 1366', 1366, 768, 0.94],
    ['laptop as designed', 1440, 900, 1],
    ['laptop 1536', 1536, 864, 1.04],
    ['Full HD monitor', 1920, 1080, 1.2],
    ['2K monitor', 2560, 1440, 1.47],
    ['4K at 100 %', 3840, 2160, 2],
  ])('%s %i x %i', (_name, w, h, k) => expect(fitFor(w, h)).toBe(k));

  it('a wide but short window is not blown up beyond what its height can show', () => {
    expect(fitFor(2560, 700)).toBe(0.9);
    expect(fitFor(1920, 900)).toBe(1.1);
  });

  it('nonsense sizes keep the design scale', () => {
    expect(fitFor(0, 0)).toBe(1);
    expect(fitFor(Number.NaN, 900)).toBe(1);
  });
});
