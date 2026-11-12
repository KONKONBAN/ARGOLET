import { authorize, newId, sessionTokenHash, type Action } from '@argolet/core';
import type { Store, Tx } from './store';
import { AppError, Emitter, OutboxRelay, accessContext, type AppDeps, type AuthState, type CallContext, type WorkspaceState } from './runtime';
import { GLOBAL, type SessionRow } from './types';

/** Shared plumbing for services: session resolution, workspace scope, transactions. */
export class AppCore {
  readonly relay: OutboxRelay;
  constructor(readonly deps: AppDeps) {
    this.relay = new OutboxRelay(deps.store, deps.clock);
  }

  get store(): Store {
    return this.deps.store;
  }

  now(): string {
    return this.deps.clock().toISOString();
  }

  /** Run a command transaction, then publish its outbox events. */
  async command<T>(call: CallContext, fn: (tx: Tx, emitter: Emitter, now: string) => Promise<T>): Promise<T> {
    const now = this.now();
    const correlationId = call.correlationId ?? newId('cor');
    const result = await this.store.transaction(async (tx) => fn(tx, new Emitter(tx, now, correlationId), now));
    await this.relay.drain();
    return result;
  }

  async query<T>(fn: (tx: Tx, now: string) => Promise<T>): Promise<T> {
    return this.store.read((tx) => fn(tx, this.now()));
  }

  async resolveSession(tx: Tx, call: CallContext): Promise<AuthState | null> {
    if (!call.sessionToken) return null;
    const hash = sessionTokenHash(call.sessionToken);
    const [session] = await tx.findGlobal('sessions', { tokenHash: hash });
    if (!session || session.revokedAt || session.expiresAt < this.now()) return null;
    const user = await tx.get('users', GLOBAL, session.userId);
    if (!user || user.status === 'LOCKED') return null;
    return { session, user };
  }

  async requireAuth(tx: Tx, call: CallContext): Promise<AuthState> {
    const auth = await this.resolveSession(tx, call);
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại');
    if (auth.user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Tài khoản chưa được xác minh');
    return auth;
  }

  /**
   * Resolve the active workspace (tenant + scope) from the server-side session and
   * evaluate the effective permission for `action` on every request.
   */
  async requireWorkspace(tx: Tx, call: CallContext, action?: Action, opts: { entityId?: string; amount?: string } = {}): Promise<WorkspaceState> {
    const auth = await this.requireAuth(tx, call);
    const tenantId = auth.session.activeTenantId;
    if (!tenantId) throw new AppError('NO_WORKSPACE', 'Chọn không gian làm việc trước khi tiếp tục');
    const [membership] = await tx.list('memberships', tenantId, { userId: auth.user.id });
    if (!membership || membership.status !== 'ACTIVE') {
      throw new AppError('FORBIDDEN', 'Bạn không còn là thành viên của tổ chức này');
    }
    const access = accessContext(auth.user, tenantId, membership.bindings, auth.session, this.now());
    const scopeEntity = opts.entityId ?? (auth.session.activeEntityId !== '*' ? auth.session.activeEntityId : undefined);
    if (action) {
      const decision = authorize(access, { action, entityId: scopeEntity, amount: opts.amount });
      if (!decision.allowed) {
        throw new AppError(decision.requiresStepUp ? 'STEP_UP_REQUIRED' : 'FORBIDDEN', decision.reason, { action });
      }
    }
    return { ...auth, tenantId, membership, access, entityId: auth.session.activeEntityId };
  }

  can(ws: WorkspaceState, action: Action, entityId?: string): boolean {
    return authorize(ws.access, { action, entityId }).allowed;
  }

  async touchSession(tx: Tx, session: SessionRow): Promise<void> {
    const now = this.now();
    if (Date.parse(now) - Date.parse(session.lastSeenAt) > 60_000) {
      await tx.put('sessions', { ...session, lastSeenAt: now });
    }
  }
}

export function actor(ws: { user: { id: string; fullName: string }; membership?: { displayName: string } }) {
  return { id: ws.user.id, name: ws.membership?.displayName ?? ws.user.fullName };
}

export function requireFound<T>(row: T | undefined | null, what: string): T {
  if (!row) throw new AppError('NOT_FOUND', `Không tìm thấy ${what}`);
  return row;
}

export function requireText(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '') throw new AppError('VALIDATION', `${label} không được để trống`, { field: label });
  if (value.length > max) throw new AppError('VALIDATION', `${label} quá dài`, { field: label });
  return value.trim();
}

export function requireAmount(value: unknown, label: string): string {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.replace(/[.\s]/g, '').replace(',', '.') : '';
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new AppError('VALIDATION', `${label} phải là số hợp lệ`, { field: label });
  return s;
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function requireDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new AppError('VALIDATION', `${label} không hợp lệ (định dạng YYYY-MM-DD)`, { field: label });
  }
  return value;
}

export function requireNonNegative(value: unknown, label: string): string {
  const v = requireAmount(value, label);
  if (v.startsWith('-')) throw new AppError('VALIDATION', `${label} không được âm`, { field: label });
  return v;
}

export interface PageParams {
  page?: number | string | undefined;
  pageSize?: number | string | undefined;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

/** Server-side pagination: page is clamped to the available range, page size to [5, 100]. */
export function paginate<T>(rows: T[], p: PageParams = {}, defaultSize = 20): Page<T> {
  const sizeRaw = Number(p.pageSize ?? defaultSize);
  const pageSize = Math.min(100, Math.max(5, Number.isFinite(sizeRaw) ? Math.floor(sizeRaw) : defaultSize));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRaw = Number(p.page ?? 1);
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 1));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total, pageCount };
}

/** Ratios, weights, quantities: "0.05", "0,05" or 0.05 (a dot is a decimal point here, never a thousands separator). */
export function requireDecimal(value: unknown, label: string): string {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim().replace(',', '.') : '';
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AppError('VALIDATION', `${label} phải là số không âm (ví dụ 0.5)`, { field: label });
  return s;
}
