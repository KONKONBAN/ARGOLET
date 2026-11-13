import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ApiError, type Backend, type OperationName, type OpParams, type OpResult } from './backend';

/** Global handler for errors that need app-level reaction (auth, workspace, step-up). */
export type ErrorRouter = (err: ApiError) => boolean;

interface Ctx {
  backend: Backend;
  onError: { current: ErrorRouter };
}

const BackendCtx = createContext<Ctx | null>(null);

export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const onError = useRef<ErrorRouter>(() => false);
  return <BackendCtx.Provider value={{ backend, onError }}>{children}</BackendCtx.Provider>;
}

export function useBackend(): Ctx {
  const c = useContext(BackendCtx);
  if (!c) throw new Error('BackendProvider missing');
  return c;
}

// ───────── tiny query cache with invalidation after every mutation ─────────
interface Entry {
  data?: unknown;
  error?: ApiError;
  promise?: Promise<void>;
  stale: boolean;
}
const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function invalidateAll(): void {
  for (const e of cache.values()) e.stale = true;
  emit();
}

export function clearCache(): void {
  cache.clear();
  emit();
}

function toApiError(e: unknown): ApiError {
  return e instanceof ApiError
    ? e
    : new ApiError('INTERNAL', e instanceof Error ? e.message : 'Lỗi không xác định', 500);
}

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** A request for the current parameters is in flight (data may be the previous page). */
  fetching: boolean;
  refetch: () => void;
}

export function useQuery<K extends OperationName>(
  name: K,
  params?: OpParams<K>,
  opts: { enabled?: boolean; keepPrevious?: boolean } = {},
): QueryState<OpResult<K>> {
  const { backend, onError } = useBackend();
  const key = `${name}:${JSON.stringify(params ?? {})}`;
  const enabled = opts.enabled ?? true;
  useSyncExternalStore(subscribe, () => version);
  const entry = cache.get(key);
  // Paginated / filtered lists keep showing the previous result while the next one loads.
  const previous = useRef<unknown>(undefined);
  if (entry?.data !== undefined) previous.current = entry.data;
  const load = useCallback(() => {
    const cur = cache.get(key) ?? { stale: true };
    if (cur.promise) return;
    const promise = backend
      .call(name, params)
      .then((data) => {
        cache.set(key, { data, stale: false });
      })
      .catch((e: unknown) => {
        const err = toApiError(e);
        if (!onError.current(err))
          cache.set(key, { ...cache.get(key), error: err, stale: false, promise: undefined });
        else cache.set(key, { ...cache.get(key), stale: false, promise: undefined });
      })
      .finally(emit);
    cache.set(key, { ...cur, promise, stale: false });
    emit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, backend]);
  useEffect(() => {
    if (!enabled) return;
    const e = cache.get(key);
    if (!e || (e.stale && !e.promise)) load();
  });
  const shown = entry?.data ?? (opts.keepPrevious ? previous.current : undefined);
  return {
    data: shown as OpResult<K> | undefined,
    error: entry?.error,
    loading: enabled && (!entry || !!entry.promise) && shown === undefined,
    fetching: enabled && !!entry?.promise,
    refetch: () => {
      const e = cache.get(key);
      if (e) e.stale = true;
      load();
    },
  };
}

export interface MutationState<K extends OperationName> {
  mutate: (params?: OpParams<K>) => Promise<OpResult<K>>;
  loading: boolean;
  error: ApiError | undefined;
  reset: () => void;
}

export function useMutation<K extends OperationName>(
  name: K,
  opts: { invalidate?: boolean; silent?: boolean } = {},
): MutationState<K> {
  const { backend, onError } = useBackend();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | undefined>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const mutate = useCallback(
    async (params?: OpParams<K>): Promise<OpResult<K>> => {
      setLoading(true);
      setError(undefined);
      try {
        const r = (await backend.call(name, params)) as OpResult<K>;
        if (opts.invalidate !== false) invalidateAll();
        return r;
      } catch (e) {
        const err = toApiError(e);
        if (mounted.current) setError(err);
        if (!opts.silent) onError.current(err);
        throw err;
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backend, name],
  );
  return { mutate, loading, error, reset: () => setError(undefined) };
}
