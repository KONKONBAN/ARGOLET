import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CameraOff,
  CircleAlert,
  CircleCheck,
  Images,
  Lock,
  QrCode,
  RotateCcw,
  Sun,
  Zap,
  ZapOff,
  X,
} from 'lucide-react';
import { formatVnd, readQrContent } from '@argolet/core';
import { Button } from './components';
import {
  analyzePhoto,
  frameMotion,
  liveState,
  measureFrame,
  MIN_PHOTO_SIDE,
  type LiveState,
  type PhotoQuality,
} from './photo';
import { readQrFromImage } from './qr';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

type Shot = { file: File; url: string; quality: PhotoQuality; qr: string | null | undefined };

/** What the person sees above the document frame, for each live state. */
const GUIDE: Record<LiveState | 'starting', string> = {
  starting: 'Đặt chứng từ nằm trọn trong khung',
  dark: 'Thiếu sáng, bật thêm đèn hoặc chụp gần cửa sổ',
  glare: 'Ảnh bị lóa, nghiêng nhẹ máy để tránh đèn',
  moving: 'Giữ máy cố định',
  blurry: 'Đưa máy lại gần hơn để chữ rõ nét',
  ready: 'Ảnh đã rõ, bấm nút chụp',
};

/** Frames the live checks need to stay good before an automatic capture (about 1,5 giây). */
const AUTO_TICKS = 3;
const TICK_MS = 500;

/**
 * In-app document scanner (invoices, receipts, delivery notes), designed like the ID scanners of
 * banking and securities apps: a full-screen viewfinder with a document frame, live guidance on
 * light, sharpness and steadiness, manual or automatic capture, the torch when the phone has one,
 * a review sheet with the quality checks and the e-invoice QR read from the picture, page after
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
  const shutterRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [live, setLive] = useState<LiveState | 'starting'>('starting');
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [steady, setSteady] = useState(0);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  // Open the back camera at the best resolution it offers.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setShot(null);
    setPages([]);
    setLive('starting');
    setSteady(0);
    setTorch(null);
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
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
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

  useEffect(() => {
    if (open && ready && !shot) shutterRef.current?.focus();
  }, [open, ready, shot]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );
  useEffect(() => () => pages.forEach((u) => URL.revokeObjectURL(u)), [pages]);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) return setBusy(false);
    const file = new File([blob], `chung-tu-${stamp()}-${pages.length + 1}.jpg`, { type: 'image/jpeg' });
    const quality = await analyzePhoto(blob);
    setShot({ file, url: URL.createObjectURL(blob), quality, qr: undefined });
    setSteady(0);
    setBusy(false);
    void readQrFromImage(blob)
      .catch(() => null)
      .then((qr) => setShot((s) => (s && s.file === file ? { ...s, qr } : s)));
  }, [busy, pages.length]);

  // Live checks on the viewfinder: light, sharpness, steadiness; automatic capture when asked.
  useEffect(() => {
    if (!open || !ready || shot) return;
    let prev: Float32Array | null = null;
    let good = 0;
    const id = window.setInterval(() => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return;
      setResolution((r) =>
        r && r.w === v.videoWidth && r.h === v.videoHeight ? r : { w: v.videoWidth, h: v.videoHeight },
      );
      const stats = measureFrame(v, v.videoWidth, v.videoHeight);
      const state = liveState(stats, prev ? frameMotion(prev, stats.grey) : 0);
      prev = stats.grey;
      setLive(state);
      good = state === 'ready' ? good + 1 : 0;
      setSteady(good);
      if (auto && good >= AUTO_TICKS) {
        good = 0;
        void capture();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [open, ready, shot, auto, capture]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const keep = (more: boolean) => {
    if (!shot) return;
    onCapture(shot.file, shot.quality);
    setPages((p) => [...p, URL.createObjectURL(shot.file)]);
    setShot(null);
    if (!more) onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const lowRes = resolution ? Math.max(resolution.w, resolution.h) < MIN_PHOTO_SIDE : false;
  const state = live === 'ready' && lowRes ? 'blurry' : live;
  const isReady = ready && state === 'ready';
  const checks: { key: string; label: string; ok: boolean | null }[] = [
    { key: 'light', label: 'Ánh sáng', ok: live === 'starting' ? null : live !== 'dark' && live !== 'glare' },
    {
      key: 'sharp',
      label: 'Độ nét',
      ok: live === 'starting' ? null : live !== 'blurry' && live !== 'moving',
    },
    { key: 'res', label: 'Độ phân giải', ok: resolution ? !lowRes : null },
  ];

  return (
    <div className="scan" role="dialog" aria-modal="true" aria-label="Chụp chứng từ">
      <header className="scan-top">
        <button className="scan-icon" onClick={onClose} aria-label="Đóng">
          <X size={22} />
        </button>
        <div className="scan-title">
          <strong>Chụp chứng từ</strong>
          <span>
            {pages.length ? `Đã thêm ${pages.length} trang` : 'Hóa đơn, phiếu thu chi, phiếu giao hàng'}
          </span>
        </div>
        {torch !== null && !error ? (
          <button
            className={`scan-icon${torch ? ' on' : ''}`}
            onClick={() => void toggleTorch()}
            aria-label={torch ? 'Tắt đèn' : 'Bật đèn'}
            aria-pressed={torch}
          >
            {torch ? <Zap size={20} /> : <ZapOff size={20} />}
          </button>
        ) : (
          <span className="scan-icon-space" aria-hidden />
        )}
      </header>

      {error ? (
        <div className="scan-error" role="alert">
          <span className="scan-error-icon">
            <CameraOff size={28} />
          </span>
          <p>{error}</p>
          <div className="scan-error-actions">
            <Button
              variant="primary"
              icon={<Images size={18} />}
              onClick={() => {
                onClose();
                onFallback();
              }}
            >
              Chọn ảnh từ thiết bị
            </Button>
            <Button onClick={onClose}>Đóng</Button>
          </div>
        </div>
      ) : (
        <div className="scan-view">
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Khung camera"
            style={{ visibility: shot ? 'hidden' : 'visible' }}
          />
          {shot && <img src={shot.url} alt="Ảnh vừa chụp" className="scan-shot" />}
          {!shot && (
            <div className={`scan-frame${isReady ? ' ready' : ''}`} aria-hidden>
              <i className="tl" />
              <i className="tr" />
              <i className="bl" />
              <i className="br" />
              {ready && !isReady && <span className="scan-line" />}
            </div>
          )}
          {!shot && (
            <div className={`scan-guide${isReady ? ' ready' : ''}`} role="status" aria-live="polite">
              {isReady ? <CircleCheck size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
              <span>{ready ? GUIDE[state] : 'Đang mở camera'}</span>
            </div>
          )}
          {!shot && ready && (
            <ul className="scan-checks" aria-label="Kiểm tra trực tiếp">
              {checks.map((c) => (
                <li key={c.key} className={c.ok === null ? '' : c.ok ? 'ok' : 'warn'}>
                  <span className="dot" aria-hidden />
                  {c.label}
                </li>
              ))}
            </ul>
          )}
          {flash && <div className="scan-flash" aria-hidden />}
        </div>
      )}

      {!error && !shot && (
        <footer className="scan-bottom">
          <div className="scan-modes" role="radiogroup" aria-label="Cách chụp">
            <button
              role="radio"
              aria-checked={!auto}
              className={!auto ? 'on' : ''}
              onClick={() => setAuto(false)}
            >
              Chụp tay
            </button>
            <button
              role="radio"
              aria-checked={auto}
              className={auto ? 'on' : ''}
              onClick={() => setAuto(true)}
            >
              Tự động chụp
            </button>
          </div>
          <div className="scan-controls">
            <button
              className="scan-side"
              onClick={() => {
                onClose();
                onFallback();
              }}
            >
              <Images size={22} aria-hidden />
              <span>Thư viện</span>
            </button>
            <button
              ref={shutterRef}
              className={`scan-shutter${isReady ? ' ready' : ''}${auto && steady > 0 ? ' arming' : ''}`}
              disabled={!ready || busy}
              onClick={() => void capture()}
              aria-label="Chụp"
              style={{ ['--arm' as string]: `${auto ? Math.min(1, steady / AUTO_TICKS) : isReady ? 1 : 0}` }}
            >
              <span />
            </button>
            {pages.length ? (
              <button
                className="scan-side scan-done"
                onClick={onClose}
                aria-label={`Xong, ${pages.length} trang`}
              >
                <span className="scan-thumb">
                  <img src={pages.at(-1)} alt="" />
                  <b>{pages.length}</b>
                </span>
                <span>Xong</span>
              </button>
            ) : (
              <span className="scan-side" aria-hidden />
            )}
          </div>
          <p className="scan-trust">
            <Lock size={12} aria-hidden /> Ảnh được mã hóa khi gửi, chỉ dùng cho hồ sơ của bạn
          </p>
        </footer>
      )}

      {shot && (
        <section className="scan-sheet" aria-label="Kiểm tra ảnh vừa chụp">
          <div className="scan-sheet-head">
            <strong>{shot.quality.ok ? 'Ảnh đạt yêu cầu' : 'Ảnh chưa đạt, nên chụp lại'}</strong>
            <span className={`scan-badge${shot.quality.ok ? ' ok' : ' warn'}`}>Trang {pages.length + 1}</span>
          </div>
          <ul className="quality-list scan-quality" aria-label="Kiểm tra ảnh">
            {shot.quality.checks.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : 'warn'}>
                {c.ok ? <CircleCheck size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
                <span>
                  {c.label}
                  {!c.ok && c.hint && <span className="muted small">: {c.hint}</span>}
                </span>
              </li>
            ))}
            <QrLine raw={shot.qr} />
          </ul>
          <div className="scan-sheet-actions">
            <Button icon={<RotateCcw size={16} />} onClick={() => setShot(null)}>
              Chụp lại
            </Button>
            <Button onClick={() => keep(true)}>Chụp trang tiếp</Button>
            <Button variant="primary" onClick={() => keep(false)}>
              Dùng ảnh này
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** The e-invoice QR read from the picture, when there is one. */
function QrLine({ raw }: { raw: string | null | undefined }) {
  if (raw === undefined)
    return (
      <li className="muted">
        <QrCode size={16} aria-hidden />
        <span>Đang tìm mã QR hóa đơn</span>
      </li>
    );
  if (raw === null) return null;
  const c = readQrContent(raw);
  if (c.kind !== 'INVOICE') return null;
  const ok = c.qr.crcOk && c.qr.problems.length === 0;
  return (
    <li className={ok ? 'ok' : 'warn'}>
      <QrCode size={16} aria-hidden />
      <span>
        {ok
          ? `Đã đọc mã QR hóa đơn số ${c.qr.documentNo}, ${formatVnd(c.qr.total)}`
          : `Mã QR hóa đơn bị lỗi: ${c.qr.problems[0]}`}
      </span>
    </li>
  );
}
