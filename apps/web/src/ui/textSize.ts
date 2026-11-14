import { useSyncExternalStore } from 'react';

/**
 * "Chữ lớn" for older users: the page is drawn 20% larger (text, buttons, tables alike). The choice
 * is remembered on this device only; the browser's own zoom keeps working as well.
 */
export type TextSize = 'normal' | 'large';
const KEY = 'argolet_text_size';
const listeners = new Set<() => void>();

function read(): TextSize {
  try {
    return localStorage.getItem(KEY) === 'large' ? 'large' : 'normal';
  } catch {
    return 'normal';
  }
}

let size: TextSize = read();

/** Applies the remembered size to the document (called once before the app renders). */
export function applyTextSize(): void {
  document.documentElement.dataset.textSize = size;
}

export function setTextSize(next: TextSize): void {
  size = next;
  applyTextSize();
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* kept for this visit only */
  }
}

export function useTextSize(): [TextSize, (s: TextSize) => void] {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => size,
    () => size,
  );
  return [value, setTextSize];
}
