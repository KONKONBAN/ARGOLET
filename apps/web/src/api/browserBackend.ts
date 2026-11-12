import {
  AppError, ConcurrencyError, createArgoletApp, demoClock, DEMO_EMAIL, DEMO_PASSWORD, MemoryStore, ScryptHasher, seedDemo, operations,
  type CallContext, type OperationName, type OpParams, type OpResult,
} from '@argolet/app';
import { ApiError, type Backend } from './backend';

const STORAGE_KEY = 'argolet.demo.v1';
const TOKEN_KEY = 'argolet.demo.session';
const CLOCK_KEY = 'argolet.demo.clockStart';

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* storage unavailable (private mode / quota): the demo keeps working in memory */
  }
}

/**
 * The complete ARGOLET application running inside the browser: same services, same
 * engines and the same API contract as the server, on an in-memory store persisted to
 * localStorage. Used when the web app is hosted statically (no API server).
 */
export async function createBrowserBackend(): Promise<Backend> {
  const ls = typeof localStorage !== 'undefined' ? localStorage : undefined;
  let clockStart = Number(safeGet(ls, CLOCK_KEY));
  if (!clockStart) {
    clockStart = Date.now();
    safeSet(ls, CLOCK_KEY, String(clockStart));
  }
  const clock = demoClock(clockStart);
  let initial: Record<string, Record<string, unknown>> | undefined;
  const raw = safeGet(ls, STORAGE_KEY);
  if (raw) {
    try {
      initial = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    } catch {
      initial = undefined;
    }
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Record<string, Record<string, unknown>> | null = null;
  const flush = () => {
    if (pending) safeSet(ls, STORAGE_KEY, JSON.stringify(pending));
    pending = null;
    timer = null;
  };
  const store = new MemoryStore(
    initial,
    (dump) => {
      pending = dump;
      if (!timer) timer = setTimeout(flush, 400);
    },
    () => clock().toISOString(),
  );
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', flush);
  const app = createArgoletApp({ store, hasher: new ScryptHasher(2 ** 12, 8, 1), clock, config: { exposeDevCodes: true, publicBaseUrl: typeof location !== 'undefined' ? location.href.split('#')[0]! : '' } });
  await seedDemo(app);

  const tokenStore = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;
  let token: string | null = safeGet(ls, TOKEN_KEY) ?? safeGet(tokenStore, TOKEN_KEY);

  const backend: Backend = {
    info: { mode: 'browser', label: 'Bản chạy trên trình duyệt · dữ liệu mẫu', demo: { email: DEMO_EMAIL, password: DEMO_PASSWORD, clock: true }, assistant: 'rules' },
    async call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>> {
      const def = operations[name] as unknown as { handler: (a: typeof app, c: CallContext, p: unknown) => Promise<unknown>; session?: 'issue' | 'clear' };
      const call: CallContext = { sessionToken: token, channel: 'web', userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'browser', ip: 'local' };
      try {
        const result = (await def.handler(app, call, params ?? {})) as Record<string, unknown> | null;
        if (def.session === 'issue' && result && typeof result.token === 'string') {
          token = result.token;
          const remember = (params as { remember?: boolean } | undefined)?.remember;
          safeSet(remember ? ls : tokenStore, TOKEN_KEY, token);
          const { token: _t, ...rest } = result;
          void _t;
          return rest as OpResult<K>;
        }
        if (def.session === 'clear') {
          token = null;
          safeSet(ls, TOKEN_KEY, null);
          safeSet(tokenStore, TOKEN_KEY, null);
        }
        return result as OpResult<K>;
      } catch (e) {
        if (e instanceof AppError) throw new ApiError(e.code, e.message, e.status, e.details);
        if (e instanceof ConcurrencyError) throw new ApiError('CONFLICT', e.message, 409);
        console.error(e);
        throw new ApiError('INTERNAL', e instanceof Error ? e.message : 'Đã xảy ra lỗi', 500);
      }
    },
    async reset() {
      safeSet(ls, STORAGE_KEY, null);
      safeSet(ls, TOKEN_KEY, null);
      safeSet(ls, CLOCK_KEY, null);
      safeSet(tokenStore, TOKEN_KEY, null);
      pending = null;
      if (timer) clearTimeout(timer);
    },
  };
  return backend;
}
