import { describe, expect, it } from 'vitest';
import {
  amountFromWords,
  amountInWordsFromText,
  amountsFromText,
  solveAmounts,
  totalConfidence,
  type AmountReading,
} from '../src';

describe('amount written in Vietnamese words', () => {
  it.each([
    ['Một triệu sáu trăm năm mươi nghìn đồng', '1650000'],
    ['Hai mươi lăm nghìn bốn trăm linh năm đồng chẵn', '25405'],
    ['Mười hai triệu không trăm bảy mươi mốt nghìn đồng', '12071000'],
    ['Ba trăm nghìn đồng', '300000'],
    ['Một tỷ hai trăm triệu đồng', '1200000000'],
    ['Chín mươi tư nghìn năm trăm đồng', '94500'],
    ['Bảy trăm lẻ năm nghìn đồng', '705000'],
    ['Hai triệu ngàn', '2001000'],
    ['mot trieu sau tram nam muoi nghin dong', '1650000'],
  ])('%s', (words, value) => expect(amountFromWords(words)).toBe(value));

  it('finds the phrase on the page, even when it wraps', () => {
    expect(
      amountInWordsFromText(
        'Tổng: 1.950.000\nSố tiền viết bảng chữ: Một triệu sáu trăm năm mươi nghìn đỏng.',
      ),
    ).toBe('1650000');
    expect(amountInWordsFromText('Bằng chữ: Hai triệu ba trăm\nnghìn đồng chẵn')).toBe('2300000');
    expect(amountInWordsFromText('Không có số tiền bằng chữ ở đây')).toBeNull();
  });
});

describe('figures next to their labels', () => {
  it('reads subtotal, rate, VAT, total and words from OCR text', () => {
    const a = amountsFromText(
      [
        'Cộng tiền hàng: 1.500.000',
        'Thuế suất GTGT: 10%   Tiền thuế GTGT: 150.000',
        'Tổng tiền thanh toán: 1.650.000',
        'Số tiền viết bằng chữ: Một triệu sáu trăm năm mươi nghìn đồng.',
      ].join('\n'),
    );
    expect(a).toEqual({
      subtotal: ['1500000'],
      vatAmount: ['150000'],
      vatRate: [10],
      total: ['1650000'],
      words: '1650000',
    });
  });
});

describe('solving the figures of a damaged invoice', () => {
  it('trusts readings that agree and satisfy the equations', () => {
    const r1: AmountReading[] = [
      {
        source: 'ocr',
        subtotal: '1500000',
        vatAmount: '150000',
        vatRate: 10,
        total: '1650000',
        confidence: 0.8,
      },
      { source: 'words', total: '1650000', confidence: 0.8 },
    ];
    const s = solveAmounts(r1);
    expect(s).toMatchObject({
      total: '1650000',
      subtotal: '1500000',
      vatAmount: '150000',
      vatRate: 10,
      consistent: true,
    });
    expect(s.derived).toEqual([]);
    // OCR alone (digits and words): prefilled, but a person confirms it.
    expect(totalConfidence(s, r1)).toBeLessThanOrEqual(0.7);
    const withVlm = [
      ...r1,
      { source: 'vlm' as const, total: '1650000', subtotal: '1500000', confidence: 0.9 },
    ];
    expect(totalConfidence(solveAmounts(withVlm), withVlm)).toBe(0.98);
  });

  it('rejects blurred digits that break the equations and keeps the amount in words', () => {
    // A wet invoice: two OCR passes misread 5 as 9 or 3; the words survived.
    const r: AmountReading[] = [
      { source: 'ocr', subtotal: '1390000', total: '1950000', confidence: 0.7 },
      { source: 'ocr', subtotal: '1300000', vatAmount: '139002', total: '1630000', confidence: 0.6 },
      { source: 'words', total: '1650000', confidence: 0.8 },
    ];
    const s = solveAmounts(r);
    expect(s.total).toBe('1650000');
    expect(s.rejected.map((r) => r.total).sort()).toEqual(['1630000', '1950000']);
    // Only one reading: filled in, but a person confirms it.
    expect(totalConfidence(s, r)).toBeLessThan(0.85);
  });

  it('recovers a total nobody could read from the subtotal and VAT', () => {
    const r: AmountReading[] = [
      { source: 'ocr', subtotal: '1500000', vatAmount: '150000', vatRate: 10, confidence: 0.8 },
    ];
    const s = solveAmounts(r);
    expect(s).toMatchObject({ total: '1650000', consistent: true, derived: ['total'] });
    expect(totalConfidence(s, r)).toBe(0.7);
  });

  it('fills subtotal and VAT from the total and the rate printed', () => {
    const s = solveAmounts([
      { source: 'vlm', total: '1080000', confidence: 0.9 },
      { source: 'ocr', vatRate: 8, confidence: 0.7 },
    ]);
    expect(s).toMatchObject({ total: '1080000', subtotal: '1000000', vatAmount: '80000', vatRate: 8 });
    expect(s.derived.sort()).toEqual(['subtotal', 'vatAmount']);
  });

  it('prefers the reading the equations support when OCR and the vision model disagree', () => {
    const r: AmountReading[] = [
      { source: 'vlm', subtotal: '1500000', vatAmount: '150000', total: '1650000', confidence: 0.85 },
      { source: 'ocr', subtotal: '1500000', vatAmount: '150000', total: '1950000', confidence: 0.75 },
    ];
    const s = solveAmounts(r);
    expect(s.total).toBe('1650000');
    expect(s.support.subtotal.sort()).toEqual(['ocr', 'vlm']);
    // 1.950.000 is one blurred digit away (6 read as 9): not a contradiction.
    expect(totalConfidence(s, r)).toBe(0.85);
  });

  it('the QR code settles the total', () => {
    const r: AmountReading[] = [
      { source: 'qr', total: '1650000', confidence: 1 },
      { source: 'ocr', total: '1950000', confidence: 0.8 },
    ];
    const s = solveAmounts(r);
    expect(s.total).toBe('1650000');
    expect(totalConfidence(s, r)).toBe(0.99);
  });

  it('never accepts a VAT above 10 % of the subtotal', () => {
    const s = solveAmounts([{ source: 'ocr', subtotal: '1000000', total: '1400000', confidence: 0.9 }]);
    expect(s.subtotal).toBeNull();
    expect(s.consistent).toBe(false);
  });

  it('accepts an invoice mixing rates (VAT between 0 and 10 %) without calling it consistent', () => {
    const s = solveAmounts([
      { source: 'vlm', subtotal: '2000000', vatAmount: '150000', total: '2150000', confidence: 0.9 },
    ]);
    expect(s).toMatchObject({
      total: '2150000',
      subtotal: '2000000',
      vatAmount: '150000',
      vatRate: null,
      consistent: false,
    });
  });

  it('returns nothing when no figure was read', () => {
    expect(solveAmounts([{ source: 'ocr', confidence: 0.5 }]).total).toBeNull();
  });
});
