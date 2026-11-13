import type { ExtractionProvider, ExtractionResult } from '@argolet/core';

/**
 * Used when no OCR / vision model is configured (no ANTHROPIC_API_KEY on the server, or the app
 * running entirely in the browser). It never reads numbers from the image and never guesses: the
 * fields stay empty for a person to type from the original, EXCEPT when the file name follows the
 * explicit naming convention "<số chứng từ>_<tổng tiền>_<YYYY-MM-DD>_<nhà cung cấp>"
 * (e.g. "PN-551_1840000_2026-10-30_Bao-bi-An-Phat.jpg") — and even then the values are marked
 * low-confidence so the reviewer checks them against the image. Camera file names such as
 * "IMG_20261113_153045.jpg" carry no document data and are ignored.
 */
export class ManualEntryExtractionProvider implements ExtractionProvider {
  readonly modelVersion = 'manual-entry-1.0';

  async extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<ExtractionResult> {
    const hint = parseNamingConvention(input.filename);
    const field = (name: 'supplier' | 'documentNo' | 'documentDate' | 'total', value: string) => ({
      name,
      value,
      confidence: value ? 0.6 : 0,
      page: 1,
    });
    return {
      modelVersion: this.modelVersion,
      fields: [
        field('supplier', hint?.supplier ?? ''),
        field('documentNo', hint?.documentNo ?? ''),
        field('documentDate', hint?.documentDate ?? ''),
        field('total', hint?.total ?? ''),
      ],
      lines: [],
    };
  }
}

const CAMERA_NAME = /^(IMG|PXL|DSC|DCIM|PHOTO|SCREENSHOT|SCAN|ANH|HOA-DON|CAPTURE|WIN|MVIMG)\b/i;

/** "<no>_<amount>_<YYYY-MM-DD>_<supplier>": all four parts or nothing. */
export function parseNamingConvention(
  filename: string,
): { documentNo: string; total: string; documentDate: string; supplier: string } | null {
  const base = filename.replace(/\.[^.]+$/, '');
  if (CAMERA_NAME.test(base)) return null;
  const m = /^([A-Z]{1,6}-?\d{2,12})_(\d{4,15})_(\d{4}-\d{2}-\d{2})_([^_]{3,80})$/i.exec(base);
  if (!m || Number.isNaN(Date.parse(m[3]!))) return null;
  return {
    documentNo: m[1]!.toUpperCase(),
    total: m[2]!,
    documentDate: m[3]!,
    supplier: m[4]!.replace(/-/g, ' ').trim(),
  };
}
