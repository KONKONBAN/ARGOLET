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

/**
 * Checks a photo of a document before it is sent: enough pixels to read the text, not too dark
 * or washed out, not blurred. Runs entirely in the browser on a downscaled copy.
 */
export async function analyzePhoto(blob: Blob): Promise<PhotoQuality> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const scale = Math.min(1, 480 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
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
  const washedOut = contrast < FLAT_CONTRAST && sharpness < FLAT_DETAIL;
  const checks = [
    {
      label: `Độ phân giải ${width}×${height}`,
      ok: Math.max(width, height) >= MIN_LONG_SIDE,
      hint: 'Ảnh nhỏ, chữ có thể không đọc được — đưa máy gần hơn hoặc dùng camera sau.',
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
            {!c.ok && c.hint && <span className="muted small"> — {c.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
