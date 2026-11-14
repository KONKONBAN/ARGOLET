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
import { useNavigate } from 'react-router-dom';
import type { SessionInfo, WorkspaceContext } from '@argolet/app';
import { ApiError } from '../api/backend';
import { clearCache, invalidateAll, useBackend } from '../api/hooks';
import { Button, Modal, OtpInput, useToast } from '../ui/components';

type Status = 'loading' | 'anon' | 'no-workspace' | 'ready';

interface SessionCtx {
  status: Status;
  me: SessionInfo | null;
  ctx: WorkspaceContext | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Run a sensitive action; when policy demands step-up auth, ask for a code and retry once. */
  withStepUp: <T>(fn: () => Promise<T>) => Promise<T>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('SessionProvider missing');
  return c;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { backend, onError } = useBackend();
  const navigate = useNavigate();
  const toast = useToast();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<SessionInfo | null>(null);
  const [ctx, setCtx] = useState<WorkspaceContext | null>(null);
  const [stepUp, setStepUp] = useState<{
    method: 'OTP' | 'TOTP';
    sentTo?: string;
    devCode?: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [code, setCode] = useState('');
  const [stepErr, setStepErr] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
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
      const c = await backend.call('org.context');
      setCtx(c);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'NO_WORKSPACE' || e.code === 'FORBIDDEN')) {
        setCtx(null);
        setStatus('no-workspace');
      } else throw e;
    }
  }, [backend]);

  useEffect(() => {
    refresh().catch(() => setStatus('anon'));
  }, [refresh]);

  // Refresh the workspace context (badges, counts) whenever data changes.
  useEffect(() => {
    if (status !== 'ready') return;
    const id = setInterval(() => {
      backend
        .call('org.context')
        .then(setCtx)
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [status, backend]);

  useEffect(() => {
    onError.current = (err) => {
      if (err.code === 'UNAUTHENTICATED' && statusRef.current !== 'anon') {
        setMe(null);
        setCtx(null);
        setStatus('anon');
        clearCache();
        toast('info', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
        navigate('/login');
        return true;
      }
      if (err.code === 'NO_WORKSPACE') {
        setStatus('no-workspace');
        navigate('/workspaces');
        return true;
      }
      return false;
    };
  }, [onError, navigate, toast]);

  const signOut = useCallback(async () => {
    await backend.call('auth.logout').catch(() => undefined);
    clearCache();
    setMe(null);
    setCtx(null);
    setStatus('anon');
    navigate('/login');
  }, [backend, navigate]);

  const askStepUp = useCallback(async (): Promise<boolean> => {
    const r = await backend.call('auth.startStepUp');
    setCode('');
    setStepErr(null);
    return new Promise<boolean>((resolve) =>
      setStepUp({
        method: r.method,
        sentTo: 'sentTo' in r ? r.sentTo : undefined,
        devCode: 'devCode' in r ? r.devCode : undefined,
        resolve,
      }),
    );
  }, [backend]);

  const withStepUp = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof ApiError && e.code === 'STEP_UP_REQUIRED') {
          const ok = await askStepUp();
          if (!ok) throw new ApiError('CANCELLED', 'Đã hủy xác thực bổ sung', 0);
          return fn();
        }
        throw e;
      }
    },
    [askStepUp],
  );

  const confirmStepUp = async () => {
    if (!stepUp) return;
    setStepBusy(true);
    setStepErr(null);
    try {
      await backend.call('auth.completeStepUp', { code });
      stepUp.resolve(true);
      setStepUp(null);
      invalidateAll();
    } catch (e) {
      setStepErr(e instanceof Error ? e.message : 'Mã không đúng');
    } finally {
      setStepBusy(false);
    }
  };

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
      <Modal
        open={!!stepUp}
        title="Xác thực bổ sung"
        onClose={() => {
          stepUp?.resolve(false);
          setStepUp(null);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                stepUp?.resolve(false);
                setStepUp(null);
              }}
            >
              Hủy
            </Button>
            <Button variant="primary" loading={stepBusy} disabled={code.length !== 6} onClick={confirmStepUp}>
              Xác nhận
            </Button>
          </>
        }
      >
        <p className="muted" style={{ marginBottom: 16 }}>
          {stepUp?.method === 'TOTP'
            ? 'Nhập mã 6 số từ ứng dụng xác thực.'
            : `Chính sách yêu cầu xác thực lại. Nhập mã đã gửi đến ${stepUp?.sentTo ?? 'email của bạn'}.`}
        </p>
        <OtpInput value={code} onChange={setCode} autoFocus />
        {stepUp?.devCode && (
          <div className="demo-box">
            Môi trường thử nghiệm, mã xác thực: <b>{stepUp.devCode}</b>
          </div>
        )}
        {stepErr && <div className="field-error mt-8">{stepErr}</div>}
      </Modal>
    </Ctx.Provider>
  );
}
