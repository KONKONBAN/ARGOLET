import { useEffect, useRef, useState } from 'react';
import {
  scanFromURLAsync,
  useCameraPermissions,
  type BarcodeScanningResult,
  type CameraView,
} from 'expo-camera';
import { readQrContent } from '@argolet/core';

export interface ScannedPage {
  name: string;
  mime: string;
  base64: string;
  uri: string;
  width: number;
  height: number;
  /** The e-invoice QR seen in the viewfinder when the page was taken (checked again on the server). */
  qr: string | null;
}

export interface ScannerProps {
  visible: boolean;
  onClose: () => void;
  onCapture: (page: ScannedPage) => void;
  onLibrary: () => void;
}

/** Long side, in pixels, below which the text of a document may not be readable. */
export const MIN_SIDE = 1000;
/** The e-invoice QR must stay in view this long before an automatic capture. */
const AUTO_MS = 1000;

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/** "1,9 MP": the picture size in megapixels. */
export const megapixels = (w: number, h: number) => `${((w * h) / 1e6).toFixed(1).replace('.', ',')} MP`;

export function invoiceQr(raw: string | null | undefined) {
  if (!raw) return null;
  const c = readQrContent(raw);
  return c.kind === 'INVOICE' ? c.qr : null;
}

/**
 * The camera, the e-invoice QR seen live, the picture just taken and the pages kept: the same on
 * Android and iOS, only the screens differ.
 */
export function useScanner({ visible, onClose, onCapture }: ScannerProps) {
  const camRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seenQr, setSeenQr] = useState<string | null>(null);
  const seenAt = useRef<{ raw: string; since: number; last: number } | null>(null);
  const [shot, setShot] = useState<ScannedPage | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [added, setAdded] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setShot(null);
    setPages([]);
    setReady(false);
    setTorch(false);
    setAuto(false);
    setSeenQr(null);
    setAdded(0);
    seenAt.current = null;
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // The QR leaves the view: forget it after a moment.
  useEffect(() => {
    if (!visible || shot) return;
    const id = setInterval(() => {
      const s = seenAt.current;
      if (s && Date.now() - s.last > 1200) {
        seenAt.current = null;
        setSeenQr(null);
      }
    }, 400);
    return () => clearInterval(id);
  }, [visible, shot]);

  // "Đã thêm trang n" stays a moment, then goes away.
  useEffect(() => {
    if (!added) return;
    const id = setTimeout(() => setAdded(0), 2500);
    return () => clearTimeout(id);
  }, [added]);

  const capture = async () => {
    if (!camRef.current || !ready || busy) return;
    setBusy(true);
    try {
      const p = await camRef.current.takePictureAsync({ base64: true, quality: 0.8 });
      if (!p) return;
      setShot({
        name: `chung-tu-${stamp()}-${pages.length + 1}.jpg`,
        mime: 'image/jpeg',
        base64: (p.base64 ?? '').replace(/^data:image\/\w+;base64,/, ''),
        uri: p.uri,
        width: p.width,
        height: p.height,
        qr: seenAt.current?.raw ?? null,
      });
      // No QR caught live: read it from the picture itself.
      if (!seenAt.current) {
        const uri = p.uri;
        void scanFromURLAsync(uri, ['qr'])
          .then((r) => r.map((x) => x.data.trim()).find((v) => invoiceQr(v)) ?? null)
          .catch(() => null)
          .then((qr) => qr && setShot((cur) => (cur && cur.uri === uri ? { ...cur, qr } : cur)));
      }
    } finally {
      setBusy(false);
    }
  };

  const onBarcodeScanned = (r: BarcodeScanningResult) => {
    const raw = r.data?.trim();
    if (!raw || !invoiceQr(raw)) return;
    const now = Date.now();
    const s = seenAt.current;
    seenAt.current = s && s.raw === raw ? { ...s, last: now } : { raw, since: now, last: now };
    if (seenQr !== raw) setSeenQr(raw);
    if (auto && !shot && !busy && now - seenAt.current.since >= AUTO_MS) {
      seenAt.current = { raw, since: now + 60_000, last: now };
      void capture();
    }
  };

  /** Keeps the picture just taken; `more` goes back to the camera for the next page. */
  const keep = (more: boolean) => {
    if (!shot) return;
    onCapture(shot);
    setPages((list) => [...list, shot.uri]);
    setAdded(pages.length + 1);
    setShot(null);
    if (!more) onClose();
  };

  return {
    camRef,
    permission,
    requestPermission,
    granted: !!permission?.granted,
    ready,
    onCameraReady: () => setReady(true),
    torch,
    toggleTorch: () => setTorch((t) => !t),
    auto,
    setAuto,
    busy,
    qr: invoiceQr(seenQr),
    onBarcodeScanned,
    capture,
    shot,
    shotQr: invoiceQr(shot?.qr),
    lowRes: shot ? Math.max(shot.width, shot.height) < MIN_SIDE : false,
    retake: () => setShot(null),
    keep,
    pages,
    added,
  };
}
export type Scanner = ReturnType<typeof useScanner>;
