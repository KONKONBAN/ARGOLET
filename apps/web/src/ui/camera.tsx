import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Camera,
  CameraOff,
  CircleAlert,
  CircleCheck,
  FileImage,
  Images,
  Keyboard,
  Lock,
  QrCode,
  RotateCcw,
  ScanLine,
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
type Page = { url: string; name: string; size: number; ok: boolean };

/** What the person sees above the document frame, for each live state. */
const GUIDE: Record<LiveState | 'starting', string> = {
  starting: 'Đặt chứng từ nằm trọn trong khung',
  dark: 'Thiếu sáng, bật thêm đèn hoặc chụp gần cửa sổ',
  glare: 'Ảnh bị lóa, nghiêng nhẹ chứng từ để tránh đèn',
  moving: 'Giữ chứng từ và camera cố định',
  blurry: 'Đưa chứng từ lại gần hơn để chữ rõ nét',
  ready: 'Ảnh đã rõ, bấm nút chụp',
};

/** Frames the live checks need to stay good before an automatic capture (about 1,5 giây). */
const AUTO_TICKS = 3;
const TICK_MS = 500;

/** The browser's camera, its live checks and the pages taken: shared by the desktop and phone layouts. */
function useDocumentCamera(open: boolean, onCapture: (file: File, quality: PhotoQuality) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [shot, setShot] = useState<Shot | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [live, setLive] = useState<LiveState | 'starting'>('starting');
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(null);
  const [auto, setAuto] = useState(false);
  const [steady, setSteady] = useState(0);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPages([]);
    setShot(null);
    setAuto(false);
  }, [open]);

  // Open the chosen camera (by default the back one) at the best resolution it offers.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setReady(false);
    setLive('starting');
    setSteady(0);
    setTorch(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Trình duyệt này không cho phép mở camera trực tiếp.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
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
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        if (!cancelled)
          setCameras(
            devices
              .filter((d) => d.kind === 'videoinput')
              .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` })),
          );
        if (!deviceId && !cancelled) setDeviceId(track?.getSettings?.().deviceId);
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
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, deviceId]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );
  useEffect(() => () => pages.forEach((p) => URL.revokeObjectURL(p.url)), [pages]);

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

  /** Keeps the picture just taken; returns false when there was none. */
  const keep = () => {
    if (!shot) return false;
    onCapture(shot.file, shot.quality);
    setPages((p) => [
      ...p,
      {
        url: URL.createObjectURL(shot.file),
        name: shot.file.name,
        size: shot.file.size,
        ok: shot.quality.ok,
      },
    ]);
    setShot(null);
    return true;
  };

  const lowRes = resolution ? Math.max(resolution.w, resolution.h) < MIN_PHOTO_SIDE : false;
  const state: LiveState | 'starting' = live === 'ready' && lowRes ? 'blurry' : live;
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

  return {
    videoRef,
    cameras,
    deviceId,
    setDeviceId,
    error,
    ready,
    shot,
    retake: () => setShot(null),
    pages,
    state,
    isReady,
    checks,
    auto,
    setAuto,
    arm: auto ? Math.min(1, steady / AUTO_TICKS) : isReady ? 1 : 0,
    torch,
    toggleTorch,
    flash,
    busy,
    capture,
    keep,
  };
}
type Cam = ReturnType<typeof useDocumentCamera>;

/** Desktop browsers get the workspace layout; phones get the full-screen viewfinder. */
function useWide() {
  const query = '(min-width: 900px) and (min-height: 560px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Scanning paper documents (invoices, receipts, delivery notes) with the browser's camera. On a
 * computer: a workspace with the camera on the left, the pages and tips on the right, a camera
 * picker (built-in webcam, document camera), keyboard shortcuts. On a phone: a full-screen
 * viewfinder. Both check light, sharpness and steadiness live, can capture automatically, review
 * each page with its quality checks and the e-invoice QR read from the picture. Falls back to the
 * device's own camera / file picker when the browser gives no camera.
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
  const cam = useDocumentCamera(open, onCapture);
  const wide = useWide();
  const fallback = () => {
    onClose();
    onFallback();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        e.key === ' ' &&
        !cam.shot &&
        cam.ready &&
        tag !== 'SELECT' &&
        tag !== 'BUTTON' &&
        tag !== 'INPUT'
      ) {
        e.preventDefault();
        void cam.capture();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, cam]);

  if (!open) return null;
  return wide ? (
    <DeskScanner cam={cam} onClose={onClose} onFallback={fallback} />
  ) : (
    <PhoneScanner cam={cam} onClose={onClose} onFallback={fallback} />
  );
}

type ViewProps = { cam: Cam; onClose: () => void; onFallback: () => void };

/** The camera picture with the document frame, the live guidance and checks. */
function Viewfinder({ cam, compact }: { cam: Cam; compact: boolean }) {
  const { shot, isReady, ready, state, checks } = cam;
  return (
    <>
      <video
        ref={cam.videoRef as RefObject<HTMLVideoElement>}
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
          <span>
            {!ready
              ? 'Đang mở camera'
              : isReady && !compact
                ? 'Ảnh đã rõ, bấm nút chụp hoặc phím cách'
                : GUIDE[state]}
          </span>
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
      {cam.flash && <div className="scan-flash" aria-hidden />}
    </>
  );
}

/** The quality checks of the picture just taken, with the e-invoice QR when there is one. */
function ShotChecks({ shot }: { shot: Shot }) {
  return (
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
  );
}

function CameraError({
  message,
  onClose,
  onFallback,
}: {
  message: string;
  onClose: () => void;
  onFallback: () => void;
}) {
  return (
    <div className="scan-error" role="alert">
      <span className="scan-error-icon">
        <CameraOff size={28} />
      </span>
      <p>{message}</p>
      <div className="scan-error-actions">
        <Button variant="primary" icon={<Images size={18} />} onClick={onFallback}>
          Chọn ảnh từ thiết bị
        </Button>
        <Button onClick={onClose}>Đóng</Button>
      </div>
    </div>
  );
}

// ───────── computer: workspace ─────────

function DeskScanner({ cam, onClose, onFallback }: ViewProps) {
  const { shot, pages } = cam;
  const shutterRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (cam.ready && !shot) shutterRef.current?.focus();
  }, [cam.ready, shot]);
  const camName = cam.cameras.find((c) => c.id === cam.deviceId)?.label ?? cam.cameras[0]?.label;
  return (
    <div className="sd-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sd" role="dialog" aria-modal="true" aria-label="Chụp chứng từ">
        <header className="sd-head">
          <span className="sd-head-icon" aria-hidden>
            <ScanLine size={20} />
          </span>
          <div>
            <h2>Chụp chứng từ</h2>
            <p>
              {pages.length
                ? `Đã thêm ${pages.length} trang`
                : 'Hóa đơn, phiếu thu chi, phiếu giao hàng bằng webcam hoặc máy chiếu tài liệu'}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={20} />
          </button>
        </header>

        <div className="sd-body">
          <section className="sd-main">
            <div className="sd-stage">
              {cam.error ? (
                <CameraError message={cam.error} onClose={onClose} onFallback={onFallback} />
              ) : (
                <Viewfinder cam={cam} compact={false} />
              )}
            </div>
            {!cam.error && (
              <div className="sd-bar">
                <div className="sd-bar-side">
                  {cam.cameras.length > 1 ? (
                    <label className="sd-select">
                      <Camera size={16} aria-hidden />
                      <span className="sr-only">Camera</span>
                      <select
                        value={cam.deviceId ?? ''}
                        onChange={(e) => cam.setDeviceId(e.target.value)}
                        disabled={!!shot}
                      >
                        {cam.cameras.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : camName ? (
                    <span className="sd-cam" title={camName}>
                      <Camera size={16} aria-hidden /> {camName}
                    </span>
                  ) : null}
                  {cam.torch !== null && (
                    <button
                      className={`icon-btn${cam.torch ? ' on' : ''}`}
                      onClick={() => void cam.toggleTorch()}
                      aria-label={cam.torch ? 'Tắt đèn' : 'Bật đèn'}
                      aria-pressed={cam.torch}
                    >
                      {cam.torch ? <Zap size={18} /> : <ZapOff size={18} />}
                    </button>
                  )}
                </div>
                <button
                  ref={shutterRef}
                  className={`sd-shutter${cam.isReady ? ' ready' : ''}`}
                  disabled={!cam.ready || cam.busy || !!shot}
                  onClick={() => void cam.capture()}
                  aria-label="Chụp"
                  style={{ ['--arm' as string]: `${cam.arm}` }}
                >
                  <Camera size={20} aria-hidden />
                  <span>Chụp</span>
                  <kbd>Phím cách</kbd>
                </button>
                <div className="sd-bar-side end">
                  <label className="sd-switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={cam.auto}
                      onChange={(e) => cam.setAuto(e.target.checked)}
                      disabled={!!shot}
                    />
                    <span className="sd-switch-track" aria-hidden />
                    Tự động chụp
                  </label>
                </div>
              </div>
            )}
          </section>

          <aside className="sd-side">
            {shot ? (
              <section className="sd-review" aria-label="Kiểm tra ảnh vừa chụp">
                <div className="sd-review-head">
                  <strong>{shot.quality.ok ? 'Ảnh đạt yêu cầu' : 'Ảnh chưa đạt, nên chụp lại'}</strong>
                  <span className={`scan-badge${shot.quality.ok ? ' ok' : ' warn'}`}>
                    Trang {pages.length + 1}
                  </span>
                </div>
                <ShotChecks shot={shot} />
                <div className="sd-review-actions">
                  <Button variant="primary" onClick={() => cam.keep() && onClose()}>
                    Dùng ảnh này
                  </Button>
                  <Button onClick={() => cam.keep()}>Chụp trang tiếp</Button>
                  <Button icon={<RotateCcw size={16} />} onClick={cam.retake}>
                    Chụp lại
                  </Button>
                </div>
              </section>
            ) : (
              <>
                <h3 className="sd-side-title">
                  Trang đã chụp <span className="muted">{pages.length}</span>
                </h3>
                {pages.length ? (
                  <ol className="sd-pages">
                    {pages.map((p, i) => (
                      <li key={p.url}>
                        <img src={p.url} alt="" />
                        <div>
                          <strong>Trang {i + 1}</strong>
                          <span className="muted small">{Math.max(1, Math.round(p.size / 1024))} KB</span>
                        </div>
                        <span className={`scan-badge${p.ok ? ' ok' : ' warn'}`}>
                          {p.ok ? 'Đạt' : 'Nên chụp lại'}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <ul className="sd-tips">
                    <li>
                      <FileImage size={18} aria-hidden />
                      <span>Đặt chứng từ trên mặt bàn phẳng, đủ sáng, cả bốn góc nằm trong khung.</span>
                    </li>
                    <li>
                      <QrCode size={18} aria-hidden />
                      <span>Hóa đơn điện tử có mã QR được đọc ngay khi chụp.</span>
                    </li>
                    <li>
                      <Keyboard size={18} aria-hidden />
                      <span>Bấm phím cách để chụp, phím Esc để đóng.</span>
                    </li>
                  </ul>
                )}
                <div className="sd-side-foot">
                  <Button icon={<Images size={16} />} onClick={onFallback}>
                    Tải ảnh từ máy
                  </Button>
                  <Button variant="primary" disabled={!pages.length} onClick={onClose}>
                    {pages.length ? `Hoàn tất (${pages.length} trang)` : 'Hoàn tất'}
                  </Button>
                </div>
              </>
            )}
            <p className="sd-trust">
              <Lock size={12} aria-hidden /> Ảnh được mã hóa khi gửi, chỉ dùng cho hồ sơ của bạn
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ───────── phone browser: full-screen viewfinder ─────────

function PhoneScanner({ cam, onClose, onFallback }: ViewProps) {
  const { shot, pages } = cam;
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
        {cam.torch !== null && !cam.error ? (
          <button
            className={`scan-icon${cam.torch ? ' on' : ''}`}
            onClick={() => void cam.toggleTorch()}
            aria-label={cam.torch ? 'Tắt đèn' : 'Bật đèn'}
            aria-pressed={cam.torch}
          >
            {cam.torch ? <Zap size={20} /> : <ZapOff size={20} />}
          </button>
        ) : (
          <span className="scan-icon-space" aria-hidden />
        )}
      </header>

      {cam.error ? (
        <CameraError message={cam.error} onClose={onClose} onFallback={onFallback} />
      ) : (
        <div className="scan-view">
          <Viewfinder cam={cam} compact />
        </div>
      )}

      {!cam.error && !shot && (
        <footer className="scan-bottom">
          <div className="scan-modes" role="radiogroup" aria-label="Cách chụp">
            <button
              role="radio"
              aria-checked={!cam.auto}
              className={!cam.auto ? 'on' : ''}
              onClick={() => cam.setAuto(false)}
            >
              Chụp tay
            </button>
            <button
              role="radio"
              aria-checked={cam.auto}
              className={cam.auto ? 'on' : ''}
              onClick={() => cam.setAuto(true)}
            >
              Tự động chụp
            </button>
          </div>
          <div className="scan-controls">
            <button className="scan-side" onClick={onFallback}>
              <Images size={22} aria-hidden />
              <span>Thư viện</span>
            </button>
            <button
              className={`scan-shutter${cam.isReady ? ' ready' : ''}`}
              disabled={!cam.ready || cam.busy}
              onClick={() => void cam.capture()}
              aria-label="Chụp"
              style={{ ['--arm' as string]: `${cam.arm}` }}
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
                  <img src={pages.at(-1)!.url} alt="" />
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
          <ShotChecks shot={shot} />
          <div className="scan-sheet-actions">
            <Button icon={<RotateCcw size={16} />} onClick={cam.retake}>
              Chụp lại
            </Button>
            <Button onClick={() => cam.keep()}>Chụp trang tiếp</Button>
            <Button variant="primary" onClick={() => cam.keep() && onClose()}>
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
