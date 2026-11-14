import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Text } from './textScale';
import type { SessionInfo, WorkspaceContext } from '@argolet/app';
import { ApiError, clearCache, invalidateAll, useBackend } from '@argolet/client';
import { Button, Gap, Notice, OtpInput, Sheet, T } from './ui';

type Status = 'loading' | 'anon' | 'no-workspace' | 'ready';

interface SessionCtx {
  status: Status;
  me: SessionInfo | null;
  ctx: WorkspaceContext | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  withStepUp: <T>(fn: () => Promise<T>) => Promise<T>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const { backend, onError } = useBackend();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<SessionInfo | null>(null);
  const [ctx, setCtx] = useState<WorkspaceContext | null>(null);
  const [step, setStep] = useState<{
    method: 'OTP' | 'TOTP';
    devCode?: string | undefined;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [code, setCode] = useState('');
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    const m = await backend.call('auth.me');
    setMe(m);
    if (!m) {
      setCtx(null);
      setStatus('anon');
      return;
    }
    if (!m.session.activeTenantId) {
      setCtx(null);
      setStatus('no-workspace');
      return;
    }
    try {
      setCtx(await backend.call('org.context'));
      setStatus('ready');
    } catch {
      setCtx(null);
      setStatus('no-workspace');
    }
  }, [backend]);

  useEffect(() => {
    refresh().catch(() => setStatus('anon'));
  }, [refresh]);

  useEffect(() => {
    onError.current = (err) => {
      if (err.code === 'UNAUTHENTICATED' && statusRef.current !== 'anon') {
        clearCache();
        setMe(null);
        setCtx(null);
        setStatus('anon');
        return true;
      }
      if (err.code === 'NO_WORKSPACE') {
        setStatus('no-workspace');
        return true;
      }
      return false;
    };
  }, [onError]);

  const signOut = useCallback(async () => {
    await backend.call('auth.logout').catch(() => undefined);
    clearCache();
    setMe(null);
    setCtx(null);
    setStatus('anon');
  }, [backend]);

  const withStepUp = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ApiError && e.code === 'STEP_UP_REQUIRED')) throw e;
        const r = await backend.call('auth.startStepUp');
        setCode('');
        setStepErr(null);
        const ok = await new Promise<boolean>((resolve) =>
          setStep({ method: r.method, devCode: 'devCode' in r ? r.devCode : undefined, resolve }),
        );
        if (!ok) throw new ApiError('CANCELLED', 'Đã hủy xác thực bổ sung', 0);
        return fn();
      }
    },
    [backend],
  );

  const value = useMemo<SessionCtx>(
    () => ({
      status,
      me,
      ctx,
      refresh,
      signOut,
      withStepUp,
      can: (p) => !!ctx?.member.permissions.includes(p),
    }),
    [status, me, ctx, refresh, signOut, withStepUp],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <Sheet
        visible={!!step}
        title="Xác thực bổ sung"
        onClose={() => {
          step?.resolve(false);
          setStep(null);
        }}
      >
        <Text style={[T.muted, { marginBottom: 14 }]}>
          {step?.method === 'TOTP'
            ? 'Nhập mã 6 số từ ứng dụng xác thực.'
            : 'Chính sách yêu cầu xác thực lại. Nhập mã đã gửi đến email của bạn.'}
        </Text>
        <OtpInput value={code} onChange={setCode} />
        {step?.devCode ? (
          <Notice tone="info">{`Môi trường thử nghiệm · mã xác thực: ${step.devCode}`}</Notice>
        ) : null}
        {stepErr ? <Notice tone="danger">{stepErr}</Notice> : null}
        <Gap />
        <Button
          title="Xác nhận"
          variant="primary"
          loading={busy}
          disabled={code.length !== 6}
          onPress={async () => {
            if (!step) return;
            setBusy(true);
            try {
              await backend.call('auth.completeStepUp', { code });
              step.resolve(true);
              setStep(null);
              invalidateAll();
            } catch (e) {
              setStepErr(e instanceof Error ? e.message : 'Mã không đúng');
            } finally {
              setBusy(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
    </Ctx.Provider>
  );
}
