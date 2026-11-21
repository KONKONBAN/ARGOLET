/**
 * "Tự động căn chỉnh theo màn hình" on phones and tablets. The app was designed on a 390 pt wide
 * phone; on other screens it adapts instead of looking stretched or cramped:
 *  - a small phone (320 to 359 pt) keeps the text size but tightens the margins;
 *  - a large phone (400 pt and more) gets slightly larger text and roomier margins;
 *  - a tablet (600 pt and more) gets larger text, wider margins and a centred column of a
 *    comfortable reading width instead of lines running across the whole screen.
 * The phone's own font size setting and the app's "Chữ lớn" apply on top. On by default; the
 * choice is remembered on this device.
 */
import { useSyncExternalStore } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type FitMode = 'auto' | 'off';
const KEY = 'argolet_fit';

let mode: FitMode = 'auto';
const listeners = new Set<() => void>();

async function load(): Promise<void> {
  try {
    const raw = Platform.OS === 'web' ? localStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    if (raw === 'off' && mode !== 'off') {
      mode = 'off';
      listeners.forEach((l) => l());
    }
  } catch {
    /* no saved preference */
  }
}
void load();

export function setFitMode(next: FitMode): void {
  mode = next;
  listeners.forEach((l) => l());
  try {
    if (Platform.OS === 'web') localStorage.setItem(KEY, next);
    else void SecureStore.setItemAsync(KEY, next).catch(() => undefined);
  } catch {
    /* kept for this session only */
  }
}

export function useFitMode(): FitMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
    () => mode,
  );
}

export interface ScreenFit {
  /** Text multiplier for this screen (1 = as designed). */
  text: number;
  /** Horizontal margin of a screen's content, in points. */
  pad: number;
  /** Widest a column of content may be (tablets); undefined = the full width. */
  maxWidth: number | undefined;
  device: 'small-phone' | 'phone' | 'large-phone' | 'tablet';
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Layout for a screen of `width` x `height` points (portrait or landscape). */
export function screenFit(width: number, height: number): ScreenFit {
  const short = Math.min(width, height);
  if (short >= 600) {
    // Tablets: text grows with the screen (768 pt iPad 1.12, 1024 pt iPad Pro 1.3); a centred
    // column of about 70 characters per line keeps reading comfortable.
    const text = round(Math.min(1.3, Math.max(1.12, short / 700)));
    return { text, pad: 28, maxWidth: Math.round(720 * text), device: 'tablet' };
  }
  if (short < 360) return { text: 1, pad: 12, maxWidth: undefined, device: 'small-phone' };
  if (short >= 400) {
    const text = round(Math.min(1.08, short / 390));
    return { text, pad: 20, maxWidth: undefined, device: 'large-phone' };
  }
  return { text: 1, pad: 16, maxWidth: undefined, device: 'phone' };
}

const AS_DESIGNED: ScreenFit = { text: 1, pad: 16, maxWidth: undefined, device: 'phone' };

/** The fit for the current screen (follows rotation and split screen), or the design when off. */
export function useScreenFit(): ScreenFit & {
  mode: FitMode;
  width: number;
  height: number;
  actual: ScreenFit;
} {
  const { width, height } = useWindowDimensions();
  const m = useFitMode();
  const actual = screenFit(width, height);
  const fit = m === 'auto' ? actual : AS_DESIGNED;
  return { ...fit, mode: m, width: Math.round(width), height: Math.round(height), actual };
}
