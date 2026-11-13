import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, RotateCcw } from 'lucide-react';
import { Button, Modal } from './components';

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

// ───────── camera ─────────

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

type Shot = { file: File; url: string; quality: PhotoQuality };

/**
 * In-app camera for paper documents (invoices, receipts, delivery notes): live preview with a
 * framing guide, capture at full camera resolution, quality check, retake or keep — page after
 * page. Falls back to the device's own camera / file picker when the browser gives no camera.
 */
export function CameraCapture({
  open,
  onClose,
  onCapture,
  onFallback,
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File, quality: PhotoQuality) => void;
  onFallback: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [pages, setPages] = useState(0);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setShot(null);
    setPages(0);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt này không cho phép mở camera trực tiếp.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        const name = (e as { name?: string }).name;
        setError(
          name === 'NotAllowedError'
            ? 'Bạn chưa cho phép dùng camera. Bấm vào biểu tượng camera trên thanh địa chỉ để cho phép, hoặc chọn ảnh từ thiết bị.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'Không tìm thấy camera trên thiết bị này.'
              : 'Không mở được camera.',
        );
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
    if (!blob) return;
    const file = new File([blob], `hoa-don-${stamp()}-${pages + 1}.jpg`, { type: 'image/jpeg' });
    setShot({ file, url: URL.createObjectURL(blob), quality: await analyzePhoto(blob) });
  };

  const keep = (more: boolean) => {
    if (!shot) return;
    onCapture(shot.file, shot.quality);
    setPages((n) => n + 1);
    setShot(null);
    if (!more) onClose();
  };

  return (
    <Modal
      title="Chụp ảnh hóa đơn"
      open={open}
      onClose={onClose}
      width={760}
      footer={
        error ? (
          <>
            <Button onClick={onClose}>Đóng</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                onFallback();
              }}
            >
              Chọn ảnh từ thiết bị
            </Button>
          </>
        ) : shot ? (
          <>
            <Button icon={<RotateCcw size={16} />} onClick={() => setShot(null)}>
              Chụp lại
            </Button>
            <Button onClick={() => keep(true)}>Dùng ảnh & chụp trang tiếp</Button>
            <Button variant="primary" onClick={() => keep(false)}>
              Dùng ảnh này
            </Button>
          </>
        ) : (
          <>
            <span className="muted small" style={{ marginRight: 'auto' }}>
              {pages
                ? `Đã thêm ${pages} trang`
                : 'Đặt hóa đơn nằm trọn trong khung, đủ sáng, không bị nghiêng.'}
            </span>
            <Button onClick={onClose}>{pages ? 'Xong' : 'Đóng'}</Button>
            <Button
              variant="primary"
              icon={<Camera size={16} />}
              disabled={!ready}
              onClick={() => void capture()}
            >
              Chụp
            </Button>
          </>
        )
      }
    >
      {error ? (
        <div className="camera-error" role="alert">
          {error}
        </div>
      ) : (
        <div className="camera-stage">
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Khung camera"
            style={{ visibility: shot ? 'hidden' : 'visible' }}
          />
          {!shot && <div className="camera-frame" aria-hidden />}
          {shot && <img src={shot.url} alt="Ảnh vừa chụp" className="camera-shot" />}
          {!ready && !shot && <div className="camera-wait">Đang mở camera…</div>}
        </div>
      )}
      {shot && (
        <div className="mt-16">
          <QualityList q={shot.quality} />
        </div>
      )}
    </Modal>
  );
}
