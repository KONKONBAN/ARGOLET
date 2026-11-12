import { buildPath, operations, type ApiErrorBody, type OperationName, type OpParams, type OpResult } from '@argolet/app/contract';

export type { OperationName, OpParams, OpResult };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface BackendInfo {
  mode: 'server' | 'browser';
  label: string;
  demo: { email: string; password: string; clock: boolean } | null;
  assistant: string;
}

export interface Backend {
  readonly info: BackendInfo;
  call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>>;
  /** Reset local demo data (browser mode only). */
  reset?(): Promise<void>;
}

/** REST transport against the ARGOLET API (cookie session + CSRF header). */
export class HttpBackend implements Backend {
  constructor(
    readonly info: BackendInfo,
    private readonly baseUrl = '',
  ) {}

  async call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>> {
    const def = operations[name];
    const { path, rest } = buildPath(def.path, (params ?? {}) as Record<string, unknown>);
    let url = `${this.baseUrl}${path}`;
    const init: RequestInit = { method: def.method, credentials: 'include', headers: { 'x-argolet-request': '1' } };
    if (def.method === 'GET' || def.method === 'DELETE') {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      const s = qs.toString();
      if (s) url += `?${s}`;
    } else {
      init.headers = { ...(init.headers as Record<string, string>), 'content-type': 'application/json' };
      init.body = JSON.stringify(rest);
    }
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new ApiError('NETWORK', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', 0);
    }
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const err = (body as ApiErrorBody | null)?.error;
      throw new ApiError(err?.code ?? 'INTERNAL', err?.message ?? 'Đã xảy ra lỗi, vui lòng thử lại', res.status, err?.details);
    }
    return body as OpResult<K>;
  }
}

/**
 * Choose the transport at start-up:
 *  1. VITE_API_URL set at build time → that API,
 *  2. the page is served by the ARGOLET API (same origin /v1/meta) → server mode,
 *  3. otherwise (static hosting) → the full application runs in the browser with demo data.
 */
export async function detectBackend(): Promise<Backend> {
  const configured = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
  const base = configured ?? '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${base}/v1/meta`, { signal: ctrl.signal, credentials: 'include' });
    clearTimeout(t);
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) {
      const meta = (await res.json()) as { name?: string; demo?: BackendInfo['demo']; assistant?: string; store?: string };
      if (meta.name === 'ARGOLET') {
        return new HttpBackend({ mode: 'server', label: `Máy chủ ARGOLET · ${meta.store ?? ''}`, demo: meta.demo ?? null, assistant: meta.assistant ?? 'rules' }, base);
      }
    }
  } catch {
    /* fall through to the in-browser backend */
  }
  if (configured) throw new ApiError('NETWORK', `Không kết nối được API tại ${configured}`, 0);
  const { createBrowserBackend } = await import('./browserBackend');
  return createBrowserBackend();
}
