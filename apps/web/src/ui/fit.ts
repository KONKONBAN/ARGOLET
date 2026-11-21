import { useSyncExternalStore } from 'react';

/**
 * "Tự động căn chỉnh theo màn hình": the whole interface is drawn at a scale that suits the screen it
 * is on, the way it was designed for a 1440 x 900 laptop:
 *  - phones and tablets keep their own layouts at the size the device chose (touch targets stay
 *    finger-sized, text stays at the system size);
 *  - a short laptop screen (1280 x 720, 1366 x 768) is drawn a little smaller so a page fits;
 *  - a large monitor (1920 px, 2K, 4K) is drawn larger, so the page fills the screen instead of a
 *    narrow column of small text.
 * The layout itself adapts to the room left at that scale (container queries on the content area).
 * On by default; the choice is remembered on this device. Browser zoom keeps working on top of it.
 */
export type FitMode = 'auto' | 'off';

const KEY = 'argolet_fit';
/** Below this width the phone and tablet layouts apply and nothing is scaled. */
const TABLET_MAX = 1180;
/** The width the desktop layout was designed for. */
const DESIGN_WIDTH = 1440;
/** Height a desktop page needs to show its header, key figures and first panels. */
const DESIGN_HEIGHT = 820;
const MIN = 0.9;
const MAX = 2;

/** Scale for a viewport of `width` x `height` CSS pixels (1 = as designed). */
export function fitFor(width: number, height: number): number {
  if (!(width > 0) || !(height > 0) || width <= TABLET_MAX) return 1;
  // Grow by 60 % of the extra width beyond the design width; shrink by half of the missing width.
  const byWidth =
    width >= DESIGN_WIDTH
      ? 1 + ((width - DESIGN_WIDTH) / DESIGN_WIDTH) * 0.6
      : 1 - ((DESIGN_WIDTH - width) / DESIGN_WIDTH) * 0.5;
  // Never taller than the screen can show: a wide but short window is not blown up.
  const byHeight = height / DESIGN_HEIGHT;
  const k = Math.min(byWidth, Math.max(byHeight, MIN));
  return Math.round(Math.min(MAX, Math.max(MIN, k)) * 100) / 100;
}

function readMode(): FitMode {
  try {
    return localStorage.getItem(KEY) === 'off' ? 'off' : 'auto';
  } catch {
    return 'auto';
  }
}

interface FitState {
  mode: FitMode;
  zoom: number;
  width: number;
  height: number;
}

let state: FitState = { mode: readMode(), zoom: 1, width: 0, height: 0 };
const listeners = new Set<() => void>();

function compute(): FitState {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const zoom = state.mode === 'auto' ? fitFor(width, height) : 1;
  return { mode: state.mode, zoom, width, height };
}

/**
 * Applies the scale to the document. Viewport units inside a zoomed page are themselves zoomed in
 * some browsers and not in others, so the page uses --vw / --vh (the viewport in the page's own
 * pixels) instead of 100vw / 100vh.
 */
function apply(next: FitState): void {
  const root = document.documentElement;
  root.style.setProperty('--fit', String(next.zoom));
  root.style.setProperty('--vw', `${next.width / next.zoom}px`);
  root.style.setProperty('--vh', `${next.height / next.zoom}px`);
  root.dataset.fit = next.mode;
  const changed =
    next.zoom !== state.zoom ||
    next.mode !== state.mode ||
    next.width !== state.width ||
    next.height !== state.height;
  state = next;
  if (changed) listeners.forEach((l) => l());
}

let frame = 0;
function onResize(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => apply(compute()));
}

/** Applies the remembered mode before the first paint and follows window and rotation changes. */
export function applyFit(): void {
  apply(compute());
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
}

export function setFitMode(mode: FitMode): void {
  state = { ...state, mode };
  apply(compute());
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* kept for this visit only */
  }
}

export function useFit(): FitState & { setMode: (m: FitMode) => void } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
  return { ...s, setMode: setFitMode };
}
