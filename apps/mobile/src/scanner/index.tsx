import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { scanFromURLAsync } from 'expo-camera';
import { File } from 'expo-file-system';
import { nativeScannerAvailable, scanWithNativeScanner } from '../../modules/argolet-scanner';
import { ScannerAndroid } from './ScannerAndroid';
import { ScannerIos } from './ScannerIos';
import { invoiceQr, type ScannerProps } from './useScanner';

export type { ScannedPage } from './useScanner';
export { megapixels } from './useScanner';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/**
 * Each phone gets the scanner designed for it: iPhone and iPad the iOS one, Android phones the
 * Material one. The browser preview of the app shows the Android one, or the iOS one with
 * `?scanner=ios` in the address, to check both designs without a device.
 */
function design(): 'ios' | 'android' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'web' && /[?&]scanner=ios\b/.test(globalThis.location?.search ?? '')) return 'ios';
  return 'android';
}

/** Reads the e-invoice QR printed on a scanned page; null when there is none. */
async function readQr(uri: string): Promise<string | null> {
  try {
    const found = (await scanFromURLAsync(uri, ['qr'])).map((r) => r.data.trim());
    return found.find((v) => invoiceQr(v)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Scanning documents on the phone. Where the phone has its own document scanner (Apple VisionKit
 * on iPhone, Google ML Kit on Android) that is used: it finds the page edges, straightens the
 * page, removes shadows, offers filters and scans page after page, as in Notes or Google Drive.
 * Otherwise ARGOLET's own camera screen opens, designed for each platform.
 */
export function DocumentScanner(props: ScannerProps) {
  const { visible, onCapture, onClose } = props;
  const [nativeFailed, setNativeFailed] = useState(false);
  const useNative = !nativeFailed && nativeScannerAvailable();
  const running = useRef(false);

  useEffect(() => {
    if (!visible || !useNative || running.current) return;
    running.current = true;
    const at = stamp();
    scanWithNativeScanner(20)
      .then(async (pages) => {
        for (const [i, p] of pages.entries()) {
          const file = new File(p.uri);
          onCapture({
            name: `chung-tu-${at}-${i + 1}.jpg`,
            mime: 'image/jpeg',
            base64: await file.base64(),
            uri: p.uri,
            width: p.width,
            height: p.height,
            qr: await readQr(p.uri),
          });
        }
        onClose();
      })
      .catch(() => setNativeFailed(true))
      .finally(() => {
        running.current = false;
      });
  }, [visible, useNative, onCapture, onClose]);

  if (useNative) return null;
  return design() === 'ios' ? <ScannerIos {...props} /> : <ScannerAndroid {...props} />;
}
