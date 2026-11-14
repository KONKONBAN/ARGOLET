import { createRequire } from 'node:module';
import path from 'node:path';
import {
  reconcileReadings,
  type ExtractionProvider,
  type ExtractionResult,
  type OcrReading,
} from '@argolet/core';
import { ManualEntryExtractionProvider } from '@argolet/app';

const require = createRequire(import.meta.url);

/** Images Tesseract reads directly (PDFs and HEIC go to the VLM only). */
const OCR_MIME = /^image\/(jpeg|jpg|png|webp|bmp|gif)$/i;
const OCR_EXT = /\.(jpe?g|png|webp|bmp|gif)$/i;

type TesseractWorker = {
  recognize: (
    image: Buffer,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{ data: TesseractPage }>;
  terminate: () => Promise<unknown>;
};
interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}
interface TesseractPage {
  text: string;
  confidence: number;
  blocks: { paragraphs: { lines: { words: TesseractWord[] }[] }[] }[] | null;
}

/**
 * Character recognition on the server with Tesseract (Vietnamese model shipped with the app, no
 * network needed). One worker, created on first use and reused; pages are read one at a time.
 */
export class TesseractOcr {
  readonly engine = 'ocr:tesseract-7/vie';
  private worker: Promise<TesseractWorker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private start(): Promise<TesseractWorker> {
    this.worker ??= (async () => {
      const { createWorker } = require('tesseract.js') as {
        createWorker: (
          lang: string,
          oem: number,
          options: Record<string, unknown>,
        ) => Promise<TesseractWorker>;
      };
      const langPath = path.join(
        path.dirname(require.resolve('@tesseract.js-data/vie/package.json')),
        '4.0.0_best_int',
      );
      return createWorker('vie', 1, { langPath, cacheMethod: 'none', gzip: true });
    })();
    return this.worker;
  }

  /** Reads a page; resolves null when it takes longer than `timeoutMs`. */
  read(bytes: Uint8Array, timeoutMs = 25_000): Promise<OcrReading | null> {
    const job = this.queue.then(async () => {
      const worker = await this.start();
      const { data } = await worker.recognize(Buffer.from(bytes), {}, { text: true, blocks: true });
      const words = (data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) =>
          p.lines.flatMap((l) =>
            l.words.map((w) => ({
              text: w.text,
              bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] as [number, number, number, number],
              confidence: Math.max(0, Math.min(1, w.confidence / 100)),
            })),
          ),
        ),
      );
      return {
        text: data.text,
        words,
        confidence: Math.max(0, Math.min(1, data.confidence / 100)),
        engine: this.engine,
      };
    });
    this.queue = job.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return Promise.race([job, timeout]).finally(() => clearTimeout(timer));
  }

  async close(): Promise<void> {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}

/**
 * OCR and VLM on the same file, in parallel, checked field by field (see reconcileReadings). Either
 * may be absent or fail: the other still reads the document, and when neither can, the fields stay
 * empty for a person to type (file-name convention aside).
 */
export class CombinedExtractionProvider implements ExtractionProvider {
  readonly modelVersion: string;
  private readonly fallback = new ManualEntryExtractionProvider();

  constructor(
    private readonly ocr: TesseractOcr | null,
    private readonly vlm: ExtractionProvider | null,
    private readonly log: (msg: string) => void = console.warn,
  ) {
    this.modelVersion =
      [ocr?.engine, vlm?.modelVersion].filter(Boolean).join(' + ') || this.fallback.modelVersion;
  }

  async extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<ExtractionResult> {
    const image = OCR_MIME.test(input.mime) || OCR_EXT.test(input.filename);
    const [ocr, vlm] = await Promise.all([
      this.ocr && image
        ? this.ocr.read(input.bytes).catch((e: unknown) => {
            this.log(`[ocr] ${e instanceof Error ? e.message : String(e)}`);
            return null;
          })
        : Promise.resolve(null),
      this.vlm
        ? this.vlm.extract(input).catch((e: unknown) => {
            this.log(`[vlm] ${e instanceof Error ? e.message : String(e)}`);
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (!ocr?.text.trim() && !vlm) return this.fallback.extract(input);
    return reconcileReadings({ ocr: ocr?.text.trim() ? ocr : null, vlm });
  }
}
