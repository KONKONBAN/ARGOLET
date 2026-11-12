import { createLocalBackend } from '@argolet/client/local';
import type { Backend } from '@argolet/client';

const STORAGE_KEY = 'argolet.demo.v1';
const TOKEN_KEY = 'argolet.demo.session';
const CLOCK_KEY = 'argolet.demo.clockStart';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota): the demo keeps working in memory */
  }
}

/** Static hosting: run the whole application in the browser, persisted to localStorage. */
export async function createBrowserBackend(): Promise<Backend> {
  let clockStart = Number(safeGet(CLOCK_KEY));
  if (!clockStart) {
    clockStart = Date.now();
    safeSet(CLOCK_KEY, String(clockStart));
  }
  let initial: Record<string, Record<string, unknown>> | undefined;
  const raw = safeGet(STORAGE_KEY);
  if (raw) {
    try {
      initial = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    } catch {
      initial = undefined;
    }
  }
  const save = (dump: Record<string, Record<string, unknown>>) => safeSet(STORAGE_KEY, JSON.stringify(dump));
  const backend = await createLocalBackend({
    initial,
    persist: save,
    clockStart,
    tokens: { get: async () => safeGet(TOKEN_KEY), set: async (t) => safeSet(TOKEN_KEY, t) },
    label: 'Bản chạy trên trình duyệt · dữ liệu mẫu',
    userAgent: navigator.userAgent,
    publicBaseUrl: location.href.split('#')[0],
    onReset: async () => {
      safeSet(STORAGE_KEY, null);
      safeSet(CLOCK_KEY, null);
    },
  });
  window.addEventListener('pagehide', () => backend.flush?.());
  return backend;
}
