import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NativeScanPage {
  uri: string;
  width: number;
  height: number;
}

interface ArgoletScannerNative {
  isAvailable(): boolean;
  scan(options: { pageLimit: number; quality?: number }): Promise<NativeScanPage[]>;
}

const native =
  Platform.OS === 'web' ? null : requireOptionalNativeModule<ArgoletScannerNative>('ArgoletScanner');

/**
 * The phone's own document scanner: Apple VisionKit on iPhone, Google ML Kit on Android (needs
 * Google Play services). Unavailable in the browser preview or without Play services.
 */
export function nativeScannerAvailable(): boolean {
  try {
    return !!native && native.isAvailable();
  } catch {
    return false;
  }
}

/** Opens the scanner; resolves with the pages kept (empty when the person cancels). */
export function scanWithNativeScanner(pageLimit = 20): Promise<NativeScanPage[]> {
  if (!native) return Promise.resolve([]);
  return native.scan({ pageLimit, quality: 0.85 });
}
