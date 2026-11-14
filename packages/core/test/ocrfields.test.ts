import { describe, expect, it } from 'vitest';
import { amountsIn, datesIn, fieldsFromOcrText, reconcileReadings, type OcrReading } from '../src';

/** Text Tesseract (Vietnamese model) returned for a delivery note photographed on a desk. */
const TEXT = `CÔNG TY TNHH BAO BÌ AN PHÁT

MST: 0312345678

Địa chỉ: 12 Nguyễn Trãi, Quận 1, TP.HCM
PHIẾU GIAO HÀNG

Số: PGH-2910

Ngày 29/10/2026

Ly giấy 12oz x 500 950.000
Ốnghútgiấyx1000 450.000

Nắp ly x 500 440.000

Tổng cộng thanh toán: 1.840.000 đ
Bằng chữ: Một triệu tám trăm bốn mươi nghìn đồng`;

const ocr: OcrReading = {
  text: TEXT,
  words: [
    { text: '1.840.000', bbox: [480, 760, 640, 790], confidence: 0.95 },
    { text: 'PGH-2910', bbox: [110, 340, 260, 370], confidence: 0.93 },
  ],
  confidence: 0.92,
  engine: 'ocr:tesseract-7/vie',
};
const vlm = (over: Partial<Record<'supplier' | 'documentNo' | 'documentDate' | 'total', string>> = {}) => ({
  modelVersion: 'vlm:claude',
  fields: (
    [
      ['supplier', over.supplier ?? 'Công ty TNHH Bao bì An Phát'],
      ['documentNo', over.documentNo ?? 'PGH-2910'],
      ['documentDate', over.documentDate ?? '2026-10-29'],
      ['total', over.total ?? '1840000'],
    ] as const
  ).map(([name, value]) => ({ name, value, confidence: 0.9 })),
  lines: [],
});

describe('OCR text reading', () => {
  it('reads amounts and dates in Vietnamese formats', () => {
    expect(amountsIn('Tổng cộng thanh toán: 1.840.000 đ')).toEqual(['1840000']);
    expect(amountsIn('Total 1,250,000.00')).toEqual(['1250000']);
    expect(datesIn('Ngày 29 tháng 10 năm 2026')).toEqual(['2026-10-29']);
    expect(datesIn('31/02/2026 · 05-11-26')).toEqual(['2026-11-05']);
  });

  it('finds the fields of a delivery note', () => {
    const f = fieldsFromOcrText(TEXT);
    expect(f).toMatchObject({
      supplier: 'CÔNG TY TNHH BAO BÌ AN PHÁT',
      taxCode: '0312345678',
      documentNo: 'PGH-2910',
      documentDate: '2026-10-29',
      total: '1840000',
    });
    expect(f.lines.map((l) => l.amount)).toEqual(['950000', '450000', '440000']);
  });
});

describe('OCR + VLM reconciliation', () => {
  it('fields both systems agree on are trusted, with the box on the original', () => {
    const r = reconcileReadings({ ocr, vlm: vlm() });
    expect(r.disagreements).toEqual([]);
    for (const f of r.fields.filter((x) => x.name !== 'taxCode'))
      expect(f.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.fields.find((f) => f.name === 'total')!.bbox).toEqual([480, 760, 640, 790]);
    expect(r.fields.find((f) => f.name === 'taxCode')).toMatchObject({
      value: '0312345678',
      confidence: 0.7,
    });
    expect(r.modelVersion).toBe('ocr:tesseract-7/vie + vlm:claude');
  });

  it('a total the VLM misread is flagged with both readings and sent for review', () => {
    const r = reconcileReadings({ ocr, vlm: vlm({ total: '1480000' }) });
    expect(r.disagreements).toEqual([{ field: 'total', ocr: '1840000', vlm: '1480000' }]);
    expect(r.fields.find((f) => f.name === 'total')!.confidence).toBeLessThan(0.85);
  });

  it('a VLM date that is not printed anywhere is not trusted', () => {
    const r = reconcileReadings({ ocr, vlm: vlm({ documentDate: '2026-10-28' }) });
    expect(r.fields.find((f) => f.name === 'documentDate')!.confidence).toBeLessThan(0.85);
    expect(r.disagreements.map((d) => d.field)).toEqual(['documentDate']);
  });

  it('a blurred photo (low OCR confidence) is not used to fill or to doubt anything', () => {
    const blurred = { ...ocr, text: 'PHIEUGI2O HANG\nSrFaH7781\nTong 6400004', confidence: 0.38 };
    expect(reconcileReadings({ ocr: blurred, vlm: null }).fields).toEqual([]);
    const r = reconcileReadings({ ocr: blurred, vlm: vlm() });
    expect(r.disagreements).toEqual([]);
    expect(r.fields.find((f) => f.name === 'total')!.confidence).toBe(0.9);
  });

  it('item lines that do not add up to the total are dropped; the seller label is removed', () => {
    const f = fieldsFromOcrText(
      'Đơn vị bán hàng: CÔNG TY TNHH SỮA XANH\nSữa tươi 1.000.000\nSữa chua 400.000\nTổng tiền thanh toán: 1.650.000',
    );
    expect(f.supplier).toBe('CÔNG TY TNHH SỮA XANH');
    expect(f.total).toBe('1650000');
    expect(f.lines).toEqual([]);
  });

  it('without a VLM the OCR reading is used but always reviewed; without OCR the VLM is kept', () => {
    const onlyOcr = reconcileReadings({ ocr, vlm: null });
    expect(onlyOcr.fields.find((f) => f.name === 'total')).toMatchObject({
      value: '1840000',
      confidence: 0.7,
    });
    expect(onlyOcr.modelVersion).toBe('ocr:tesseract-7/vie');
    const onlyVlm = reconcileReadings({ ocr: null, vlm: vlm() });
    expect(onlyVlm.fields.find((f) => f.name === 'total')!.confidence).toBe(0.9);
  });
});
