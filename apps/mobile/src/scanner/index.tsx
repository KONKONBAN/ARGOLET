import { Platform } from 'react-native';
import { ScannerAndroid } from './ScannerAndroid';
import { ScannerIos } from './ScannerIos';
import type { ScannerProps } from './useScanner';

export type { ScannedPage } from './useScanner';
export { megapixels } from './useScanner';

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

export function DocumentScanner(props: ScannerProps) {
  return design() === 'ios' ? <ScannerIos {...props} /> : <ScannerAndroid {...props} />;
}
