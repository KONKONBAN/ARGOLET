import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import { Button, Modal } from './components';
import { analyzePhoto, QualityList, type PhotoQuality } from './photo';

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
    const file = new File([blob], `chung-tu-${stamp()}-${pages + 1}.jpg`, { type: 'image/jpeg' });
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
      title="Chụp chứng từ"
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
                : 'Đặt chứng từ nằm trọn trong khung, đủ sáng, không bị nghiêng.'}
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
