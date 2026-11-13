import {
  buildPath,
  operations,
  type ApiErrorBody,
  type OperationName,
  type OpParams,
  type OpResult,
} from '@argolet/app/contract';

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
  mode: 'server' | 'device';
  label: string;
  demo: { email: string; password: string; clock: boolean } | null;
  assistant: string;
}

export interface Backend {
  readonly info: BackendInfo;
  call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>>;
  /** Reset local demo data (device mode only). */
  reset?(): Promise<void>;
  /** Persist pending local changes immediately (device mode only). */
  flush?(): void;
}

/** Where a bearer token lives (mobile: secure storage). */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string | null): Promise<void>;
}

export interface HttpOptions {
  baseUrl: string;
  info: BackendInfo;
  /** 'cookie' for browsers (HttpOnly session cookie); a TokenStore for native apps (Bearer). */
  auth: 'cookie' | TokenStore;
  fetchImpl?: typeof fetch;
}

/** REST transport against the ARGOLET API, generated from the shared operation table. */
export class HttpBackend implements Backend {
  readonly info: BackendInfo;
  constructor(private readonly opts: HttpOptions) {
    this.info = opts.info;
  }

  async call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>> {
    const def = operations[name] as { method: string; path: string; session?: 'issue' | 'clear' };
    const { path, rest } = buildPath(def.path, (params ?? {}) as Record<string, unknown>);
    let url = `${this.opts.baseUrl}${path}`;
    const headers: Record<string, string> = { 'x-argolet-request': '1' };
    const init: RequestInit = { method: def.method, headers };
    if (this.opts.auth === 'cookie') init.credentials = 'include';
    else {
      headers['x-argolet-client'] = 'mobile';
      const token = await this.opts.auth.get();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    if (def.method === 'GET' || def.method === 'DELETE') {
      const qs = Object.entries(rest)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    } else {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(rest);
    }
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(url, init);
    } catch {
      throw new ApiError('NETWORK', 'Không kết nối được máy chủ. Kiểm tra mạng và thử lại.', 0);
    }
    const body = parseJsonBody(await res.text(), res.status);
    if (!res.ok) {
      const err = (body as ApiErrorBody | null)?.error;
      if (res.status === 401 && this.opts.auth !== 'cookie') await this.opts.auth.set(null);
      throw new ApiError(
        err?.code ?? 'INTERNAL',
        err?.message ?? 'Đã xảy ra lỗi, vui lòng thử lại',
        res.status,
        err?.details,
      );
    }
    if (this.opts.auth !== 'cookie') {
      const r = body as Record<string, unknown> | null;
      if (def.session === 'issue' && r && typeof r.token === 'string') {
        await this.opts.auth.set(r.token);
        const { token: _t, ...restBody } = r;
        return restBody as OpResult<K>;
      }
      if (def.session === 'clear') await this.opts.auth.set(null);
    }
    return body as OpResult<K>;
  }
}

/** Probe an ARGOLET API base URL. */
function parseJsonBody(text: string, status: number): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('INTERNAL', 'Máy chủ trả về dữ liệu không hợp lệ', status);
  }
}

export async function probeServer(
  baseUrl: string,
  timeoutMs = 2500,
  fetchImpl: typeof fetch = fetch,
): Promise<BackendInfo | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetchImpl(`${baseUrl}/v1/meta`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const meta = (await res.json()) as {
      name?: string;
      demo?: BackendInfo['demo'];
      assistant?: string;
      store?: string;
    };
    if (meta.name !== 'ARGOLET') return null;
    return {
      mode: 'server',
      label: `Máy chủ ARGOLET · ${meta.store ?? ''}`,
      demo: meta.demo ?? null,
      assistant: meta.assistant ?? 'rules',
    };
  } catch {
    return null;
  }
}
