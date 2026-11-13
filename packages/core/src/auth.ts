import {
  base32Decode,
  base32Encode,
  base64Url,
  hmacSha1,
  hmacSha256Hex,
  randomBytes,
  sha256Hex,
  timingSafeEqual,
} from './hash';

/** Account & session rules (board 01 / 02 / A). */
export const PASSWORD_MIN_LENGTH = 12;

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Sử dụng ít nhất ${PASSWORD_MIN_LENGTH} ký tự.`;
  if (password.length > 256) return 'Mật khẩu quá dài.';
  if (/^(.)\1+$/.test(password)) return 'Mật khẩu quá đơn giản.';
  return null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** Vietnamese phone → E.164 (+84…). Returns null when invalid. */
export function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, '');
  let n = digits;
  if (n.startsWith('+84')) n = '0' + n.slice(3);
  else if (n.startsWith('84') && n.length === 11) n = '0' + n.slice(2);
  if (!/^0\d{9}$/.test(n)) return null;
  return '+84' + n.slice(1);
}

export function normalizeContact(contact: string): { type: 'email' | 'phone'; value: string } | null {
  if (contact.includes('@'))
    return isValidEmail(contact) ? { type: 'email', value: normalizeEmail(contact) } : null;
  const p = normalizePhone(contact);
  return p ? { type: 'phone', value: p } : null;
}

/** 6-digit one-time code. Only its keyed hash is stored. */
export function generateOtp(): string {
  const b = randomBytes(4);
  const n = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  return String(n % 1_000_000).padStart(6, '0');
}

export function hashSecret(secret: string, pepper: string): string {
  return hmacSha256Hex(pepper, secret);
}

export interface VerificationTokenRecord {
  tokenHash: string;
  purpose: 'VERIFY_CONTACT' | 'RESET_PASSWORD' | 'STEP_UP';
  userId: string;
  expiresAt: string;
  attempts: number;
  consumedAt?: string | null | undefined;
}

export const MAX_OTP_ATTEMPTS = 5;

export function checkVerificationToken(
  rec: VerificationTokenRecord,
  code: string,
  pepper: string,
  now: string,
): { ok: true } | { ok: false; reason: 'EXPIRED' | 'CONSUMED' | 'TOO_MANY_ATTEMPTS' | 'INVALID' } {
  if (rec.consumedAt) return { ok: false, reason: 'CONSUMED' };
  if (now > rec.expiresAt) return { ok: false, reason: 'EXPIRED' };
  if (rec.attempts >= MAX_OTP_ATTEMPTS) return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  if (!timingSafeEqual(rec.tokenHash, hashSecret(code, pepper))) return { ok: false, reason: 'INVALID' };
  return { ok: true };
}

/** Opaque session token (sent to client) + its SHA-256 (stored server side). */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = base64Url(randomBytes(32));
  return { token, tokenHash: sha256Hex(token) };
}

export function sessionTokenHash(token: string): string {
  return sha256Hex(token);
}

// ───────── TOTP (RFC 6238) ─────────

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totp(secretBase32: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const h = hmacSha1(base32Decode(secretBase32), msg);
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function verifyTotp(secretBase32: string, code: string, timeMs: number, window = 1): boolean {
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqual(totp(secretBase32, timeMs + w * 30_000), code)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, account: string, issuer = 'ARGOLET'): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}`;
}
