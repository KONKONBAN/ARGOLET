import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretBox } from '@argolet/app';

/**
 * AES-256-GCM box for partners' credentials (connections). The 32-byte key comes from
 * ARGOLET_SECRET_KEY (base64 or hex) and never reaches the database: a database dump alone does
 * not reveal any partner key. Format: v1.<iv>.<ciphertext+tag> (base64), a fresh 96-bit IV each time.
 */
export function parseSecretKey(value: string): Buffer {
  const v = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32)
    throw new Error('ARGOLET_SECRET_KEY phải là 32 byte ngẫu nhiên (base64 hoặc 64 ký tự hex)');
  return key;
}

export function aesGcmBox(key: Buffer): SecretBox {
  return {
    async seal(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return `v1.${iv.toString('base64')}.${body.toString('base64')}`;
    },
    async open(sealed) {
      const [version, iv, body] = sealed.split('.');
      if (version !== 'v1' || !iv || !body) throw new Error('Định dạng khóa đã mã hóa không hợp lệ');
      const data = Buffer.from(body, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString(
        'utf8',
      );
    },
  };
}
