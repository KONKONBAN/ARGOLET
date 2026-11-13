import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha1 } from '@noble/hashes/legacy.js';
import {
  bytesToHex,
  hexToBytes,
  utf8ToBytes,
  concatBytes,
  randomBytes as nobleRandom,
} from '@noble/hashes/utils.js';

export { bytesToHex, hexToBytes, utf8ToBytes, concatBytes };

export type BytesLike = Uint8Array | string;

const toBytes = (v: BytesLike): Uint8Array => (typeof v === 'string' ? utf8ToBytes(v) : v);

export function sha256(data: BytesLike): Uint8Array {
  return nobleSha256(toBytes(data));
}

export function sha256Hex(data: BytesLike): string {
  return bytesToHex(sha256(data));
}

export function hmacSha256Hex(key: BytesLike, data: BytesLike): string {
  return bytesToHex(hmac(nobleSha256, toBytes(key), toBytes(data)));
}

export function hmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha1, key, data);
}

export function randomBytes(length: number): Uint8Array {
  return nobleRandom(length);
}

export function randomHex(length: number): string {
  return bytesToHex(randomBytes(length));
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64Url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]! + B64URL[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64URL[(n >> 18) & 63]! + B64URL[(n >> 12) & 63]! + B64URL[(n >> 6) & 63]!;
  }
  return out;
}

/** Constant-time comparison of two hex/ascii strings. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Chuỗi base32 không hợp lệ');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
