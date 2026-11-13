import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, randomBytes, timingSafeEqual } from '@argolet/core';
import type { PasswordHasher } from './runtime';

/**
 * Portable scrypt password hasher (pure JS — browser, React Native, Node).
 * Format: scrypt$N$r$p$saltHex$hashHex. The API server uses Argon2id and still
 * verifies this format for accounts created by the demo/offline backend.
 */
export class ScryptHasher implements PasswordHasher {
  constructor(
    private readonly N = 2 ** 14,
    private readonly r = 8,
    private readonly p = 1,
  ) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const dk = await scryptAsync(new TextEncoder().encode(password.normalize('NFKC')), salt, {
      N: this.N,
      r: this.r,
      p: this.p,
      dkLen: 32,
    });
    return ['scrypt', this.N, this.r, this.p, bytesToHex(salt), bytesToHex(dk)].join('$');
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const parts = hash.split('$');
    if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
    const [, N, r, p, salt, expected] = parts as [string, string, string, string, string, string];
    const dk = await scryptAsync(new TextEncoder().encode(password.normalize('NFKC')), hexToBytes(salt), {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      dkLen: 32,
    });
    return timingSafeEqual(bytesToHex(dk), expected);
  }
}

/** Hash with the primary hasher; verify with whichever hasher recognises the stored format. */
export class CompositeHasher implements PasswordHasher {
  constructor(
    private readonly primary: PasswordHasher,
    private readonly scrypt: ScryptHasher = new ScryptHasher(),
  ) {}

  hash(password: string): Promise<string> {
    return this.primary.hash(password);
  }

  verify(hash: string, password: string): Promise<boolean> {
    if (hash.startsWith('scrypt$')) return this.scrypt.verify(hash, password);
    return this.primary.verify(hash, password);
  }
}
