import { CircleAlert, CircleCheck } from 'lucide-react';

// ───────── photo quality ─────────

export interface PhotoQuality {
  width: number;
  height: number;
  /** Mean luminance 0–255. */
  brightness: number;
  /** Standard deviation of luminance (low on glare, also low on sparse text — see FLAT_*). */
  contrast: number;
  /** Variance of the Laplacian on a downscaled grey image: low = blurred. */
  sharpness: number;
  checks: { label: string; ok: boolean; hint?: string }[];
  ok: boolean;
}

const MIN_LONG_SIDE = 1000;
const DARK = 60;
/** Washed out (glare, overexposure): almost no contrast AND almost no detail. White paper with
 * sparse text has low contrast but plenty of edges, so it is not flagged. */
const FLAT_CONTRAST = 10;
const FLAT_DETAIL = 100;
const BLURRY = 25;

/** Light and detail measured on a downscaled grey copy of an image or a live camera frame. */
export interface FrameStats {
  brightness: number;
  contrast: number;
  sharpness: number;
  /** The grey pixels (for comparing two frames: is the phone held still?). */
  grey: Float32Array;
}

let scratch: HTMLCanvasElement | null = null;

/** Measures a picture or the current video frame, scaled so its long side is at most 480 px. */
export function measureFrame(source: CanvasImageSource, width: number, height: number): FrameStats {
  const scale = Math.min(1, 480 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  scratch ??= document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const grey = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const v = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    grey[i] = v;
    sum += v;
  }
  const brightness = sum / (w * h);
  let varSum = 0;
  for (let i = 0; i < w * h; i++) varSum += (grey[i]! - brightness) ** 2;
  const contrast = Math.sqrt(varSum / (w * h));
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = grey[i - w]! + grey[i + w]! + grey[i - 1]! + grey[i + 1]! - 4 * grey[i]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  const sharpness = n ? lapSq / n - (lapSum / n) ** 2 : 0;
  return { brightness, contrast, sharpness, grey };
}

/** Mean difference between two frames (0 = identical): high while the phone is moving. */
export function frameMotion(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || !a.length) return 255;
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!);
  return d / a.length;
}

export type LiveState = 'dark' | 'glare' | 'blurry' | 'moving' | 'ready';

/** What the live camera frame needs before it can be captured. */
export function liveState(s: FrameStats, motion: number): LiveState {
  if (s.brightness < DARK) return 'dark';
  if (s.contrast < FLAT_CONTRAST && s.sharpness < FLAT_DETAIL) return 'glare';
  if (motion > 6) return 'moving';
  if (s.sharpness < BLURRY) return 'blurry';
  return 'ready';
}

export const MIN_PHOTO_SIDE = MIN_LONG_SIDE;

/**
 * Checks a photo of a document before it is sent: enough pixels to read the text, not too dark
 * or washed out, not blurred. Runs entirely in the browser on a downscaled copy.
 */
export async function analyzePhoto(blob: Blob): Promise<PhotoQuality> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const { brightness, contrast, sharpness } = measureFrame(bitmap, width, height);
  bitmap.close?.();
  const washedOut = contrast < FLAT_CONTRAST && sharpness < FLAT_DETAIL;
  const checks = [
    {
      label: `Độ phân giải ${((width * height) / 1e6).toFixed(1).replace('.', ',')} MP`,
      ok: Math.max(width, height) >= MIN_LONG_SIDE,
      hint: 'Ảnh nhỏ, chữ có thể không đọc được, đưa máy gần hơn hoặc dùng camera sau.',
    },
    {
      // White paper is bright by nature: judge light by darkness, and glare by a flat image.
      label: brightness < DARK ? 'Ảnh quá tối' : washedOut ? 'Ảnh bị lóa, mất chữ' : 'Ánh sáng tốt',
      ok: brightness >= DARK && !washedOut,
      hint:
        brightness < DARK
          ? 'Bật thêm đèn hoặc chụp gần cửa sổ.'
          : 'Tránh đèn chiếu thẳng vào giấy, nghiêng nhẹ máy rồi chụp lại.',
    },
    {
      label: sharpness < BLURRY ? 'Ảnh có thể bị mờ' : 'Ảnh rõ nét',
      ok: sharpness >= BLURRY,
      hint: 'Giữ chắc tay, chạm để lấy nét rồi chụp lại.',
    },
  ];
  return { width, height, brightness, contrast, sharpness, checks, ok: checks.every((c) => c.ok) };
}

export function QualityList({ q }: { q: PhotoQuality }) {
  return (
    <ul className="quality-list" aria-label="Kiểm tra ảnh">
      {q.checks.map((c) => (
        <li key={c.label} className={c.ok ? 'ok' : 'warn'}>
          {c.ok ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
          <span>
            {c.label}
            {!c.ok && c.hint && <span className="muted small">: {c.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
