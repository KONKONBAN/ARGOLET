/**
 * OCR + VLM on the server: Tesseract (Vietnamese) reads a real image; its text confirms or
 * contradicts what the vision model returned, field by field.
 */
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtractionProvider, ExtractionResult } from '@argolet/core';
import { CombinedExtractionProvider, TesseractOcr } from '../src/ocr';

const image = readFileSync(new URL('./fixtures/phieu-giao-hang.png', import.meta.url));
const input = { bytes: new Uint8Array(image), mime: 'image/png', filename: 'IMG_20261029_101500.png' };
const ocr = new TesseractOcr();
afterAll(() => ocr.close());

const vlmReading = (total: string): ExtractionProvider => ({
  modelVersion: 'vlm:test',
  extract: async (): Promise<ExtractionResult> => ({
    modelVersion: 'vlm:test',
    fields: [
      { name: 'supplier', value: 'Công ty TNHH Bao bì An Phát', confidence: 0.9 },
      { name: 'documentNo', value: 'PGH-2910', confidence: 0.9 },
      { name: 'documentDate', value: '2026-10-29', confidence: 0.9 },
      { name: 'total', value: total, confidence: 0.9 },
    ],
    lines: [],
  }),
});

describe('OCR + VLM extraction', () => {
  it('reads the delivery note with OCR alone (always sent for review)', async () => {
    const r = await new CombinedExtractionProvider(ocr, null).extract(input);
    const get = (n: string) => r.fields.find((f) => f.name === n);
    expect(get('total')?.value).toBe('1840000');
    expect(get('documentDate')?.value).toBe('2026-10-29');
    expect(get('taxCode')?.value).toBe('0312345678');
    expect(get('total')!.confidence).toBeLessThan(0.85);
    expect(r.modelVersion).toBe('ocr:tesseract-7/vie');
  }, 60_000);

  it('confirms the vision model where the printed text agrees', async () => {
    const r = await new CombinedExtractionProvider(ocr, vlmReading('1840000')).extract(input);
    expect(r.disagreements).toEqual([]);
    expect(r.fields.find((f) => f.name === 'total')!.confidence).toBeGreaterThanOrEqual(0.95);
    expect(r.fields.find((f) => f.name === 'total')!.bbox).toHaveLength(4);
  }, 60_000);

  it('flags a total the vision model misread', async () => {
    const r = await new CombinedExtractionProvider(ocr, vlmReading('1480000')).extract(input);
    expect(r.disagreements).toEqual([{ field: 'total', ocr: '1840000', vlm: '1480000' }]);
    expect(r.fields.find((f) => f.name === 'total')!.confidence).toBeLessThan(0.85);
  }, 60_000);

  it('keeps working when the vision model is unavailable', async () => {
    const failing: ExtractionProvider = {
      modelVersion: 'vlm:down',
      extract: async () => {
        throw new Error('overloaded');
      },
    };
    const logs: string[] = [];
    const r = await new CombinedExtractionProvider(ocr, failing, (m) => logs.push(m)).extract(input);
    expect(r.fields.find((f) => f.name === 'total')?.value).toBe('1840000');
    expect(logs).toEqual(['[vlm] overloaded']);
  }, 60_000);
});
