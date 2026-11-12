import {
  checkVerificationToken, generateOtp, hashSecret, newId, newSessionToken, newTotpSecret, normalizeContact, otpauthUrl, validatePassword,
  verifyTotp, MAX_OTP_ATTEMPTS,
} from '@argolet/core';
import { type AppCore, requireFound, requireText } from '../core';
import { AppError, type CallContext } from '../runtime';
import type { Tx } from '../store';
import { GLOBAL, type SessionRow, type UserRow, type VerificationTokenRow } from '../types';

export interface PublicUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: UserRow['status'];
  mfaEnabled: boolean;
}

export interface SessionInfo {
  user: PublicUser;
  session: { id: string; aal: 1 | 2; channel: 'web' | 'mobile'; expiresAt: string; activeTenantId: string | null; activeEntityId: string };
}

export const toPublicUser = (u: UserRow): PublicUser => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  status: u.status,
  mfaEnabled: !!u.mfaEnabledAt,
});

const sessionInfo = (u: UserRow, s: SessionRow): SessionInfo => ({
  user: toPublicUser(u),
  session: { id: s.id, aal: s.aal, channel: s.channel, expiresAt: s.expiresAt, activeTenantId: s.activeTenantId, activeEntityId: s.activeEntityId },
});

export class AuthService {
  constructor(private readonly core: AppCore) {}

  private get cfg() {
    return this.core.deps.config;
  }

  private async findUserByContact(tx: Tx, contact: string): Promise<UserRow | undefined> {
    const c = normalizeContact(contact);
    if (!c) return undefined;
    const [u] = await tx.findGlobal('users', c.type === 'email' ? { email: c.value } : { phone: c.value });
    return u;
  }

  private async issueCode(tx: Tx, user: UserRow, purpose: VerificationTokenRow['purpose'], sentTo: string, now: string): Promise<string> {
    const existing = (await tx.list('verificationTokens', GLOBAL, { userId: user.id, purpose })).filter((t) => !t.consumedAt);
    for (const t of existing) await tx.put('verificationTokens', { ...t, consumedAt: now });
    const code = generateOtp();
    await tx.put('verificationTokens', {
      id: newId('vtk'),
      tenantId: GLOBAL,
      userId: user.id,
      purpose,
      tokenHash: hashSecret(code, this.cfg.pepper),
      expiresAt: new Date(Date.parse(now) + this.cfg.otpTtlMinutes * 60_000).toISOString(),
      attempts: 0,
      consumedAt: null,
      sentTo,
      lastSentAt: now,
    });
    await this.core.deps.notifier.sendCode(sentTo, purpose, code);
    return code;
  }

  /** 01 · Đăng ký email/SĐT + mật khẩu → user PENDING + OTP (invitation_id được giữ xuyên suốt). */
  async register(call: CallContext, p: { fullName: string; contact: string; password: string; acceptTerms: boolean; invitationCode?: string | null }) {
    const fullName = requireText(p.fullName, 'Họ và tên', 120);
    const contact = normalizeContact(p.contact ?? '');
    if (!contact) throw new AppError('VALIDATION', 'Email hoặc số điện thoại không hợp lệ', { field: 'contact' });
    const pwErr = validatePassword(p.password ?? '');
    if (pwErr) throw new AppError('VALIDATION', pwErr, { field: 'password' });
    if (!p.acceptTerms) throw new AppError('VALIDATION', 'Bạn cần đồng ý với Điều khoản sử dụng và Chính sách bảo mật', { field: 'acceptTerms' });
    const passwordHash = await this.core.deps.hasher.hash(p.password);
    return this.core.command(call, async (tx, em, now) => {
      const existing = await this.findUserByContact(tx, contact.value);
      if (existing && existing.status !== 'PENDING_VERIFICATION') {
        throw new AppError('CONFLICT', 'Tài khoản đã tồn tại. Vui lòng đăng nhập hoặc khôi phục mật khẩu', { field: 'contact' });
      }
      const user: UserRow = (await tx.put('users', {
        id: existing?.id ?? newId('usr'),
        tenantId: GLOBAL,
        fullName,
        email: contact.type === 'email' ? contact.value : null,
        phone: contact.type === 'phone' ? contact.value : null,
        status: 'PENDING_VERIFICATION',
        verifiedAt: null,
        totpSecret: null,
        mfaEnabledAt: null,
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: null,
        pendingInvitationCode: p.invitationCode ?? existing?.pendingInvitationCode ?? null,
      })) as UserRow;
      await tx.put('credentials', { id: user.id, tenantId: GLOBAL, userId: user.id, passwordHash, passwordUpdatedAt: now });
      const code = await this.issueCode(tx, user, 'VERIFY_CONTACT', contact.value, now);
      await em.emit({ type: 'UserRegistered', tenantId: GLOBAL, entityId: null, aggregateType: 'User', aggregateId: user.id, actorId: user.id, dataRef: `user/${user.id}`, dataVersion: 1, data: { userId: user.id, contactType: contact.type } });
      return { userId: user.id, sentTo: contact.value, resendAfterSeconds: this.cfg.resendCooldownSeconds, devCode: this.cfg.exposeDevCodes ? code : undefined };
    });
  }

  async resendCode(call: CallContext, p: { contact: string }) {
    return this.core.command(call, async (tx, _em, now) => {
      const user = await this.findUserByContact(tx, p.contact ?? '');
      if (!user || user.status !== 'PENDING_VERIFICATION') return { sent: true, resendAfterSeconds: this.cfg.resendCooldownSeconds };
      const [last] = (await tx.list('verificationTokens', GLOBAL, { userId: user.id, purpose: 'VERIFY_CONTACT' })).sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
      if (last && Date.parse(now) - Date.parse(last.lastSentAt) < this.cfg.resendCooldownSeconds * 1000) {
        throw new AppError('RATE_LIMITED', 'Vui lòng chờ trước khi gửi lại mã');
      }
      const code = await this.issueCode(tx, user, 'VERIFY_CONTACT', user.email ?? user.phone ?? '', now);
      return { sent: true, resendAfterSeconds: this.cfg.resendCooldownSeconds, devCode: this.cfg.exposeDevCodes ? code : undefined };
    });
  }

  /**
   * Verify a one-time code. Failed attempts are counted in a separate transaction so the
   * counter survives the error that aborts the caller's transaction.
   */
  private async consumeCode(tx: Tx, userId: string, purpose: VerificationTokenRow['purpose'], code: string, now: string): Promise<void> {
    const [tok] = (await tx.list('verificationTokens', GLOBAL, { userId, purpose })).filter((t) => !t.consumedAt).sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
    if (!tok) throw new AppError('VALIDATION', 'Mã xác minh không hợp lệ hoặc đã hết hạn', { field: 'code' });
    const check = checkVerificationToken(tok, (code ?? '').trim(), this.cfg.pepper, now);
    if (!check.ok) {
      const msg = {
        EXPIRED: 'Mã xác minh đã hết hạn, vui lòng gửi lại mã',
        CONSUMED: 'Mã xác minh đã được sử dụng',
        TOO_MANY_ATTEMPTS: `Bạn đã nhập sai quá ${MAX_OTP_ATTEMPTS} lần, vui lòng gửi lại mã`,
        INVALID: 'Mã xác minh không đúng',
      }[check.reason];
      throw new CodeAttemptError(msg, check.reason, tok.id);
    }
    await tx.put('verificationTokens', { ...tok, consumedAt: now });
  }

  /** Wrap a command that may fail on a wrong code, then persist the attempt counter. */
  private async withAttempts<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CodeAttemptError) {
        const id = e.tokenId;
        await this.core.store.transaction(async (tx) => {
          const t = await tx.get('verificationTokens', GLOBAL, id);
          if (t && !t.consumedAt) await tx.put('verificationTokens', { ...t, attempts: t.attempts + 1 });
        });
      }
      throw e;
    }
  }

  private async createSession(tx: Tx, user: UserRow, call: CallContext, remember: boolean, aal: 1 | 2, now: string) {
    const { token, tokenHash } = newSessionToken();
    const ttl = remember ? this.cfg.rememberTtlDays * 86_400_000 : this.cfg.sessionTtlHours * 3_600_000;
    const memberships = await tx.findGlobal('memberships', { userId: user.id, status: 'ACTIVE' });
    const session = (await tx.put('sessions', {
      id: newId('ses'),
      tenantId: GLOBAL,
      userId: user.id,
      tokenHash,
      channel: call.channel ?? 'web',
      aal,
      expiresAt: new Date(Date.parse(now) + ttl).toISOString(),
      lastSeenAt: now,
      userAgent: (call.userAgent ?? '').slice(0, 200),
      ip: call.ip ?? '',
      remember,
      activeTenantId: memberships.length === 1 ? memberships[0]!.tenantId : null,
      activeEntityId: '*',
      revokedAt: null,
      stepUpAt: aal === 2 ? now : null,
    })) as SessionRow;
    return { token, session };
  }

  /** Xác minh OTP → kích hoạt danh tính → tạo phiên. */
  async verifyContact(call: CallContext, p: { contact: string; code: string }) {
    return this.withAttempts(() => this.core.command(call, async (tx, _em, now) => {
      const user = await this.findUserByContact(tx, p.contact ?? '');
      if (!user) throw new AppError('VALIDATION', 'Mã xác minh không hợp lệ hoặc đã hết hạn', { field: 'code' });
      if (user.status === 'ACTIVE') throw new AppError('CONFLICT', 'Tài khoản đã được xác minh, vui lòng đăng nhập');
      await this.consumeCode(tx, user.id, 'VERIFY_CONTACT', p.code, now);
      const active = (await tx.put('users', { ...user, status: 'ACTIVE', verifiedAt: now })) as UserRow;
      const { token, session } = await this.createSession(tx, active, call, false, 1, now);
      return { token, ...sessionInfo(active, session), pendingInvitationCode: active.pendingInvitationCode };
    }));
  }

  /** 02 · Đăng nhập; MFA theo chính sách (TOTP) khi người dùng đã bật. */
  async login(call: CallContext, p: { contact: string; password: string; remember?: boolean; totpCode?: string }) {
    const generic = new AppError('UNAUTHENTICATED', 'Email/số điện thoại hoặc mật khẩu không đúng');
    const prelim = await this.core.query(async (tx) => {
      const user = await this.findUserByContact(tx, p.contact ?? '');
      const cred = user ? await tx.get('credentials', GLOBAL, user.id) : undefined;
      return { user, cred };
    });
    const ok = prelim.cred ? await this.core.deps.hasher.verify(prelim.cred.passwordHash, p.password ?? '') : false;
    if (prelim.user && !ok) {
      // Record the failure in its own transaction so it survives the error below.
      const locked = await this.core.command(call, async (tx, _em, now) => {
        const u = await tx.get('users', GLOBAL, prelim.user!.id);
        if (!u) return false;
        if (u.lockedUntil && u.lockedUntil > now) return true;
        const failed = u.failedLogins + 1;
        await tx.put('users', { ...u, failedLogins: failed, lockedUntil: failed >= this.cfg.maxFailedLogins ? new Date(Date.parse(now) + 15 * 60_000).toISOString() : null });
        return false;
      });
      if (locked) throw new AppError('RATE_LIMITED', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau 15 phút');
      throw generic;
    }
    return this.core.command(call, async (tx, _em, now) => {
      const user = prelim.user ? await tx.get('users', GLOBAL, prelim.user.id) : undefined;
      if (!user || !ok) throw generic;
      if (user.lockedUntil && user.lockedUntil > now) throw new AppError('RATE_LIMITED', 'Tài khoản tạm khóa do đăng nhập sai nhiều lần. Thử lại sau 15 phút');
      if (user.status === 'PENDING_VERIFICATION') {
        throw new AppError('FORBIDDEN', 'Tài khoản chưa xác minh. Vui lòng nhập mã đã gửi đến email', { reason: 'UNVERIFIED' });
      }
      let aal: 1 | 2 = 1;
      if (user.mfaEnabledAt && user.totpSecret) {
        if (!p.totpCode) throw new AppError('STEP_UP_REQUIRED', 'Nhập mã xác thực từ ứng dụng Authenticator', { reason: 'MFA_REQUIRED' });
        if (!verifyTotp(user.totpSecret, p.totpCode, Date.parse(now))) throw new AppError('VALIDATION', 'Mã xác thực không đúng', { field: 'totpCode' });
        aal = 2;
      }
      const updated = (await tx.put('users', { ...user, failedLogins: 0, lockedUntil: null, lastLoginAt: now })) as UserRow;
      const { token, session } = await this.createSession(tx, updated, call, !!p.remember, aal, now);
      return { token, ...sessionInfo(updated, session), pendingInvitationCode: updated.pendingInvitationCode };
    });
  }

  async me(call: CallContext): Promise<SessionInfo | null> {
    return this.core.query(async (tx) => {
      const auth = await this.core.resolveSession(tx, call);
      return auth ? sessionInfo(auth.user, auth.session) : null;
    });
  }

  async logout(call: CallContext) {
    return this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.resolveSession(tx, call);
      if (auth) await tx.put('sessions', { ...auth.session, revokedAt: now });
      return { ok: true };
    });
  }

  /** Đặt lại mật khẩu: luôn trả về như nhau để không lộ tài khoản tồn tại. */
  async requestPasswordReset(call: CallContext, p: { contact: string }) {
    return this.core.command(call, async (tx, _em, now) => {
      const user = await this.findUserByContact(tx, p.contact ?? '');
      let devCode: string | undefined;
      if (user && user.status === 'ACTIVE') {
        const code = await this.issueCode(tx, user, 'RESET_PASSWORD', user.email ?? user.phone ?? '', now);
        devCode = this.cfg.exposeDevCodes ? code : undefined;
      }
      return { sent: true, devCode, devLink: devCode ? `${this.cfg.publicBaseUrl}/#/reset?contact=${encodeURIComponent(p.contact)}&code=${devCode}` : undefined };
    });
  }

  async resetPassword(call: CallContext, p: { contact: string; code: string; newPassword: string }) {
    const pwErr = validatePassword(p.newPassword ?? '');
    if (pwErr) throw new AppError('VALIDATION', pwErr, { field: 'newPassword' });
    const hash = await this.core.deps.hasher.hash(p.newPassword);
    return this.withAttempts(() => this.core.command(call, async (tx, _em, now) => {
      const user = await this.findUserByContact(tx, p.contact ?? '');
      if (!user) throw new AppError('VALIDATION', 'Mã xác minh không hợp lệ hoặc đã hết hạn', { field: 'code' });
      await this.consumeCode(tx, user.id, 'RESET_PASSWORD', p.code, now);
      await tx.put('credentials', { id: user.id, tenantId: GLOBAL, userId: user.id, passwordHash: hash, passwordUpdatedAt: now });
      for (const s of await tx.list('sessions', GLOBAL, { userId: user.id })) {
        if (!s.revokedAt) await tx.put('sessions', { ...s, revokedAt: now });
      }
      await tx.put('users', { ...user, failedLogins: 0, lockedUntil: null });
      return { ok: true };
    }));
  }

  async changePassword(call: CallContext, p: { currentPassword: string; newPassword: string }) {
    const pwErr = validatePassword(p.newPassword ?? '');
    if (pwErr) throw new AppError('VALIDATION', pwErr, { field: 'newPassword' });
    const { auth, cred } = await this.core.query(async (tx) => {
      const auth = await this.core.requireAuth(tx, call);
      return { auth, cred: requireFound(await tx.get('credentials', GLOBAL, auth.user.id), 'thông tin đăng nhập') };
    });
    if (!(await this.core.deps.hasher.verify(cred.passwordHash, p.currentPassword ?? ''))) {
      throw new AppError('VALIDATION', 'Mật khẩu hiện tại không đúng', { field: 'currentPassword' });
    }
    const hash = await this.core.deps.hasher.hash(p.newPassword);
    return this.core.command(call, async (tx, _em, now) => {
      await tx.put('credentials', { ...cred, passwordHash: hash, passwordUpdatedAt: now });
      for (const s of await tx.list('sessions', GLOBAL, { userId: auth.user.id })) {
        if (!s.revokedAt && s.id !== auth.session.id) await tx.put('sessions', { ...s, revokedAt: now });
      }
      return { ok: true };
    });
  }

  async listSessions(call: CallContext) {
    return this.core.query(async (tx, now) => {
      const auth = await this.core.requireAuth(tx, call);
      return (await tx.list('sessions', GLOBAL, { userId: auth.user.id }))
        .filter((s) => !s.revokedAt && s.expiresAt > now)
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
        .map((s) => ({ id: s.id, channel: s.channel, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, current: s.id === auth.session.id, aal: s.aal }));
    });
  }

  async revokeSession(call: CallContext, p: { sessionId: string }) {
    return this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      const s = requireFound(await tx.get('sessions', GLOBAL, p.sessionId), 'phiên');
      if (s.userId !== auth.user.id) throw new AppError('NOT_FOUND', 'Không tìm thấy phiên');
      await tx.put('sessions', { ...s, revokedAt: now });
      return { ok: true };
    });
  }

  async setupTotp(call: CallContext) {
    return this.core.command(call, async (tx) => {
      const auth = await this.core.requireAuth(tx, call);
      const secret = newTotpSecret();
      await tx.put('users', { ...auth.user, totpSecret: secret, mfaEnabledAt: null });
      return { secret, otpauthUrl: otpauthUrl(secret, auth.user.email ?? auth.user.phone ?? auth.user.id) };
    });
  }

  async enableTotp(call: CallContext, p: { code: string }) {
    return this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      if (!auth.user.totpSecret) throw new AppError('VALIDATION', 'Chưa khởi tạo khóa xác thực');
      if (!verifyTotp(auth.user.totpSecret, p.code ?? '', Date.parse(now))) throw new AppError('VALIDATION', 'Mã xác thực không đúng', { field: 'code' });
      await tx.put('users', { ...auth.user, mfaEnabledAt: now });
      await tx.put('sessions', { ...auth.session, aal: 2, stepUpAt: now });
      return { ok: true };
    });
  }

  async disableTotp(call: CallContext, p: { code: string }) {
    return this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      if (!auth.user.totpSecret || !verifyTotp(auth.user.totpSecret, p.code ?? '', Date.parse(now))) {
        throw new AppError('VALIDATION', 'Mã xác thực không đúng', { field: 'code' });
      }
      await tx.put('users', { ...auth.user, totpSecret: null, mfaEnabledAt: null });
      return { ok: true };
    });
  }

  /** Xác thực bổ sung trước thao tác nhạy cảm: TOTP nếu đã bật, ngược lại OTP qua email. */
  async startStepUp(call: CallContext) {
    return this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      if (auth.user.mfaEnabledAt) return { method: 'TOTP' as const };
      const code = await this.issueCode(tx, auth.user, 'STEP_UP', auth.user.email ?? auth.user.phone ?? '', now);
      return { method: 'OTP' as const, sentTo: auth.user.email ?? auth.user.phone ?? '', devCode: this.cfg.exposeDevCodes ? code : undefined };
    });
  }

  async completeStepUp(call: CallContext, p: { code: string }) {
    return this.withAttempts(() => this.core.command(call, async (tx, _em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      if (auth.user.mfaEnabledAt && auth.user.totpSecret) {
        if (!verifyTotp(auth.user.totpSecret, p.code ?? '', Date.parse(now))) throw new AppError('VALIDATION', 'Mã xác thực không đúng', { field: 'code' });
      } else {
        await this.consumeCode(tx, auth.user.id, 'STEP_UP', p.code, now);
      }
      await tx.put('sessions', { ...auth.session, aal: 2, stepUpAt: now });
      return { ok: true, aal: 2 as const };
    }));
  }
}

/** Wrong one-time code; carries the token id (never serialised) so the attempt can be counted. */
class CodeAttemptError extends AppError {
  constructor(message: string, reason: string, readonly tokenId: string) {
    super('VALIDATION', message, { field: 'code', reason });
  }
}
