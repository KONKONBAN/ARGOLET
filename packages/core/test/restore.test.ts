/**
 * Restoration of damaged photos before reading: each step on a synthetic page with known damage.
 */
import { describe, expect, it } from 'vitest';
import {
  applyLineWarp,
  flatten,
  grayImage,
  linePitch,
  measureLineWarp,
  reconcileReadings,
  restoreGray,
  rotate,
  sauvola,
  skewAngle,
  stretchInk,
  type GrayImage,
  type OcrReading,
} from '../src';
import { damage } from './support/damage';

/** A page of "text": lines of word blocks with gaps, like print seen from afar. */
function page(width = 900, height = 1200, pitch = 40): GrayImage {
  const g = grayImage(width, height, 245);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y0 = 60; y0 + 20 < height - 60; y0 += pitch) {
    let x = 60;
    while (x < width - 80) {
      const word = 30 + Math.floor(rand() * 90);
      for (let y = y0; y < y0 + 18; y++)
        for (let xx = x; xx < Math.min(width - 60, x + word); xx++)
          // Strokes: vertical bars inside each word.
          if ((xx - x) % 6 < 3) g.data[y * width + xx] = 30;
      x += word + 14 + Math.floor(rand() * 10);
    }
  }
  return g;
}

const stats = (g: GrayImage, keep: (v: number) => boolean) => {
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (const v of g.data)
    if (keep(v)) {
      n++;
      s += v;
      s2 += v * v;
    }
  const mean = s / n;
  return { mean, sd: Math.sqrt(s2 / n - mean * mean) };
};

describe('restoring a damaged page', () => {
  it('divides out shading so the paper is even again', () => {
    const shaded = damage(page(), { seed: 1, shade: 1 });
    const before = stats(shaded, (v) => v > 120);
    const after = stats(flatten(shaded), (v) => v > 120);
    expect(before.sd).toBeGreaterThan(15);
    expect(after.sd).toBeLessThan(before.sd / 3);
    expect(after.mean).toBeGreaterThan(240);
  });

  it('brings faded print back to dark', () => {
    const faded = damage(page(), { seed: 2, fade: 0.75 });
    expect(stats(faded, (v) => v < 200).mean).toBeGreaterThan(150);
    const { image, contrast } = stretchInk(faded);
    expect(contrast).toBeLessThan(80);
    expect(stats(image, (v) => v < 128).mean).toBeLessThan(60);
  });

  it('measures and undoes skew', () => {
    const p = page();
    expect(skewAngle(sauvola(p))).toBe(0);
    const tilted = rotate(p, 3);
    const angle = skewAngle(sauvola(tilted));
    expect(Math.abs(Math.abs(angle) - 3)).toBeLessThan(0.3);
    const fixed = rotate(tilted, angle);
    expect(Math.abs(skewAngle(sauvola(fixed)))).toBeLessThan(0.3);
  });

  it('finds the line spacing', () => {
    expect(linePitch(sauvola(page()))).toBe(40);
  });

  it('straightens wavy lines and leaves straight ones alone', () => {
    const p = page();
    const flat = measureLineWarp(sauvola(p));
    expect(flat?.max ?? 0).toBeLessThan(1.5);
    // A wrinkle: the right half of the page sags by up to 10 px.
    const wavy = grayImage(p.width, p.height, 245);
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x < p.width; x++) {
        const sy = Math.round(y - 10 * Math.sin((Math.PI * x) / p.width));
        if (sy >= 0 && sy < p.height) wavy.data[y * p.width + x] = p.data[sy * p.width + x]!;
      }
    const w = measureLineWarp(sauvola(wavy))!;
    expect(w.max).toBeGreaterThan(3);
    const straightened = applyLineWarp(wavy, w);
    const again = measureLineWarp(sauvola(straightened));
    expect(again?.max ?? 0).toBeLessThan(w.max / 2);
  });

  it('a clean page goes through unharmed', () => {
    const r = restoreGray(page());
    expect(r.skew).toBe(0);
    expect(r.warp).toBeLessThan(3);
    expect(r.contrast).toBeGreaterThan(180);
    expect(r.enhanced.width).toBeGreaterThan(0);
  });

  it('enlarges small print to a readable size', () => {
    const small = page(900, 1200, 20);
    // Lines 20 px apart with 18 px blocks would merge; use thinner lines for this check.
    const r = restoreGray(small);
    expect(r.scale).toBeGreaterThanOrEqual(1);
    expect(r.enhanced.width).toBe(Math.round(900 * r.scale));
  });
});

describe('reading a wet invoice', () => {
  const pass = (text: string, confidence: number): OcrReading => ({
    text,
    words: [],
    confidence,
    engine: 'ocr:tesseract-7/vie',
  });

  it('keeps the amount in words over blurred digits and explains it to the reviewer', () => {
    const r = reconcileReadings({
      ocr: [
        pass(
          'Cộng tiền hàng: 1.390.000\nTổng tiền thanh toa 1.950.000\nSố tiền viết bảng chữ: Một triệu sáu trăm năm mươi nghìn đỏng.',
          0.72,
        ),
        pass('Cộng tiền hàng: 1.300.000\nThuế suất GTGT: 1v B 139.002\nTổng tiền thanh toán 1.630.000', 0.64),
      ],
      vlm: null,
    });
    const total = r.fields.find((f) => f.name === 'total')!;
    expect(total.value).toBe('1650000');
    // OCR alone: filled in, checked by a person.
    expect(total.confidence).toBeLessThan(0.85);
    expect(r.notes).toEqual(
      expect.arrayContaining([
        'Tổng tiền khớp với số tiền viết bằng chữ trên chứng từ',
        expect.stringMatching(/^Không dùng cách đọc .*1\.950\.000/),
      ]),
    );
  });

  it('recovers the total from subtotal and VAT and fills the figures', () => {
    const r = reconcileReadings({
      ocr: pass(
        'Cộng tiền hàng: 1.500.000\nThuế suất GTGT: 10% Tiền thuế GTGT: 150.000\nTổng tiền thanh toán: ...',
        0.8,
      ),
      vlm: null,
    });
    expect(r.fields.find((f) => f.name === 'total')).toMatchObject({ value: '1650000' });
    expect(r.amounts).toMatchObject({
      subtotal: '1500000',
      vatAmount: '150000',
      vatRate: 10,
      consistent: true,
    });
    expect(r.notes?.[0]).toBe(
      'Tổng tiền không đọc rõ, đã tính từ tiền hàng 1.500.000 đ cộng thuế GTGT 150.000 đ',
    );
  });

  it('the vision model, the words and the equations together are trusted', () => {
    const r = reconcileReadings({
      ocr: pass('Tổng tiền thanh toán: 1.950.000\nBằng chữ: Một triệu sáu trăm năm mươi nghìn đồng', 0.7),
      vlm: {
        modelVersion: 'vlm:test',
        fields: [{ name: 'total', value: '1650000', confidence: 0.9 }],
        lines: [],
        amounts: { subtotal: '1500000', vatAmount: '150000', vatRate: 10 },
      },
    });
    const total = r.fields.find((f) => f.name === 'total')!;
    expect(total.value).toBe('1650000');
    expect(total.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.disagreements).toEqual([]);
  });

  it('an unsure OCR pass alone fills nothing unless the figures add up', () => {
    expect(
      reconcileReadings({ ocr: pass('Tong 6400004\nCong tien hang 1.200.000', 0.45), vlm: null }).fields.find(
        (f) => f.name === 'total',
      ),
    ).toBeUndefined();
    const r = reconcileReadings({
      ocr: pass(
        'Cộng tiền hàng: 1.000.000\nThuế suất GTGT: 8% Tiền thuế GTGT: 80.000\nTổng cộng: 1.080.000',
        0.45,
      ),
      vlm: null,
    });
    expect(r.fields.find((f) => f.name === 'total')).toMatchObject({ value: '1080000' });
    expect(r.fields.find((f) => f.name === 'total')!.confidence).toBeLessThanOrEqual(0.5);
  });
});
