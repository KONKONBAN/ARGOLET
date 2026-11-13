/**
 * Reads the QR code printed on a photographed invoice. The browser's own BarcodeDetector is used
 * where it exists (Chrome on Android, macOS, ChromeOS); elsewhere jsQR (loaded on demand) scans the
 * picture, first downscaled and then at higher resolution for a small QR on a full A4 page.
 * Returns the raw text; @argolet/core decides whether it is an e-invoice QR (QĐ 1450) and checks it.
 */
import { readQrContent } from '@argolet/core';

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = (new (o: { formats: string[] }) => BarcodeDetectorLike) & {
  getSupportedFormats?: () => Promise<string[]>;
};

/** Prefers a code that carries invoice data when a page holds several (e.g. a payment QR too). */
function pick(values: string[]): string | null {
  const found = values.map((v) => v.trim()).filter(Boolean);
  return found.find((v) => readQrContent(v).kind === 'INVOICE') ?? found[0] ?? null;
}

async function nativeDetect(bitmap: ImageBitmap): Promise<string | null | undefined> {
  const Ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return undefined;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ['qr_code'];
    if (!formats.includes('qr_code')) return undefined;
    const codes = await new Ctor({ formats: ['qr_code'] }).detect(bitmap);
    return pick(codes.map((c) => c.rawValue));
  } catch {
    return undefined;
  }
}

async function jsqrDetect(bitmap: ImageBitmap): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  const long = Math.max(bitmap.width, bitmap.height);
  for (const target of [1600, 2800]) {
    const scale = Math.min(1, target / long);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    const code = jsQR(data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return pick([code.data]);
    if (scale === 1) break;
  }
  return null;
}

export async function readQrFromImage(blob: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    const native = await nativeDetect(bitmap);
    if (native) return native;
    return await jsqrDetect(bitmap);
  } catch {
    return null;
  } finally {
    bitmap.close?.();
  }
}
