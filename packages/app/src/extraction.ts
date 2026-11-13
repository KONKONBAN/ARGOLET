import type { ExtractionProvider, ExtractionResult } from '@argolet/core';

/**
 * Offline OCR/VLM stand-in used by the demo backend and tests. It never invents numbers:
 * it reads structured hints embedded in the filename
 * (e.g. "HD-00318_7250000_2026-10-31_Nguyen-lieu-Viet.jpg") and otherwise returns empty
 * fields with low confidence so a person must fill them in.
 * The API server swaps this for the Claude vision provider when ANTHROPIC_API_KEY is set.
 */
export class FilenameHintExtractionProvider implements ExtractionProvider {
  readonly modelVersion = 'ocr-offline-hints-1.0';

  async extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<ExtractionResult> {
    const base = input.filename.replace(/\.[^.]+$/, '');
    const parts = base.split(/_+/);
    const docNo = parts.find((p) => /^[A-Z]{1,4}-?\d{3,}$/i.test(p)) ?? '';
    const total = parts.find((p) => /^\d{4,}$/.test(p)) ?? '';
    const date = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p)) ?? '';
    const supplierPart = parts.find(
      (p) => p !== docNo && p !== total && p !== date && /[A-Za-zÀ-ỹ]{3,}/.test(p) && !/^\d/.test(p),
    );
    const supplier = (supplierPart ?? '').replace(/-/g, ' ').trim();
    return {
      modelVersion: this.modelVersion,
      fields: [
        {
          name: 'supplier',
          value: supplier,
          confidence: supplier ? 0.9 : 0.2,
          bbox: [40, 60, 420, 90],
          page: 1,
        },
        {
          name: 'documentNo',
          value: docNo.toUpperCase(),
          confidence: docNo ? 0.93 : 0.2,
          bbox: [40, 100, 300, 120],
          page: 1,
        },
        {
          name: 'documentDate',
          value: date,
          confidence: date ? 0.88 : 0.2,
          bbox: [300, 100, 460, 120],
          page: 1,
        },
        { name: 'total', value: total, confidence: total ? 0.95 : 0.2, bbox: [300, 520, 460, 550], page: 1 },
      ],
      lines: [],
    };
  }
}
