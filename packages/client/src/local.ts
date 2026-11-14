import {
  AppError,
  ConcurrencyError,
  createArgoletApp,
  demoClock,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  MemoryStore,
  ScryptHasher,
  seedDemo,
  operations,
  type CallContext,
  type OperationName,
  type OpParams,
  type OpResult,
} from '@argolet/app';
import { ApiError, type Backend, type TokenStore } from './backend';

export interface LocalBackendOptions {
  /** Previously persisted store dump (or undefined for a fresh demo). */
  initial?: Record<string, Record<string, unknown>> | undefined;
  /** Called (debounced) with the full store dump after writes. */
  persist?: ((dump: Record<string, Record<string, unknown>>) => void) | undefined;
  /** Real-time origin of the demo clock (kept stable across reloads). */
  clockStart: number;
  tokens: TokenStore;
  label: string;
  userAgent: string;
  publicBaseUrl?: string;
  onReset?: () => Promise<void>;
  /**
   * Try-out builds handed from one person to the next: after signing out, everything (sample
   * company, documents, accounts registered on the device) starts again from the initial state.
   */
  freshAfterSignOut?: boolean;
}

/**
 * The complete ARGOLET application running on the client (browser or phone): same
 * services, engines and API contract as the server, on an in-memory store.
 * Used for static hosting / offline demo.
 */
export async function createLocalBackend(o: LocalBackendOptions): Promise<Backend> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Record<string, Record<string, unknown>> | null = null;
  const build = async (initial: LocalBackendOptions['initial'], clockStart: number) => {
    const clock = demoClock(clockStart);
    const store = new MemoryStore(
      initial,
      o.persist
        ? (dump) => {
            pending = dump;
            if (!timer)
              timer = setTimeout(() => {
                if (pending) o.persist!(pending);
                pending = null;
                timer = null;
              }, 400);
          }
        : undefined,
      () => clock().toISOString(),
    );
    const app = createArgoletApp({
      store,
      hasher: new ScryptHasher(2 ** 12, 8, 1),
      clock,
      config: { exposeDevCodes: true, publicBaseUrl: o.publicBaseUrl ?? '' },
    });
    await seedDemo(app);
    return app;
  };
  let app = await build(o.initial, o.clockStart);
  /** A fresh copy of the sample data being prepared after a sign-out; awaited by the next call. */
  let rebuilding: Promise<void> | null = null;
  let token = await o.tokens.get();

  return {
    info: {
      mode: 'device',
      label: o.label,
      demo: {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        clock: true,
        freshAfterSignOut: o.freshAfterSignOut ?? false,
      },
      assistant: 'rules',
    },
    async call<K extends OperationName>(name: K, params?: OpParams<K>): Promise<OpResult<K>> {
      if (rebuilding) await rebuilding;
      const def = operations[name] as unknown as {
        handler: (a: typeof app, c: CallContext, p: unknown) => Promise<unknown>;
        session?: 'issue' | 'clear';
      };
      const call: CallContext = { sessionToken: token, channel: 'web', userAgent: o.userAgent, ip: 'local' };
      try {
        const result = (await def.handler(app, call, params ?? {})) as Record<string, unknown> | null;
        if (def.session === 'issue' && result && typeof result.token === 'string') {
          token = result.token;
          await o.tokens.set(token);
          const { token: _t, ...rest } = result;
          return rest as OpResult<K>;
        }
        if (def.session === 'clear') {
          token = null;
          await o.tokens.set(null);
          if (o.freshAfterSignOut) {
            // Start preparing the initial sample data right away; the next call waits for it.
            rebuilding = build(undefined, Date.now())
              .then((fresh) => {
                app = fresh;
              })
              .catch((err: unknown) => console.error('Không khôi phục được dữ liệu mẫu', err))
              .finally(() => {
                rebuilding = null;
              });
          }
        }
        return result as OpResult<K>;
      } catch (e) {
        if (e instanceof AppError) throw new ApiError(e.code, e.message, e.status, e.details);
        if (e instanceof ConcurrencyError) throw new ApiError('CONFLICT', e.message, 409);
        console.error(e);
        throw new ApiError('INTERNAL', e instanceof Error ? e.message : 'Đã xảy ra lỗi', 500);
      }
    },
    flush() {
      if (timer) clearTimeout(timer);
      timer = null;
      if (pending && o.persist) o.persist(pending);
      pending = null;
    },
    async reset() {
      if (timer) clearTimeout(timer);
      pending = null;
      await o.tokens.set(null);
      await o.onReset?.();
    },
  };
}
