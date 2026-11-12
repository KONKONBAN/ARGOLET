import { hash, verify } from '@node-rs/argon2';
import type { PasswordHasher } from '@argolet/app';
import { CompositeHasher, ScryptHasher } from '@argolet/app';

/** Argon2id (board 01: "băm mật khẩu Argon2id"), OWASP baseline parameters. */
export class Argon2idHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return hash(password.normalize('NFKC'), { algorithm: 2 /* Argon2id */, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password.normalize('NFKC'));
    } catch {
      return false;
    }
  }
}

/** Argon2id for new hashes; still verifies scrypt hashes created by the offline/demo backend. */
export function serverHasher(): PasswordHasher {
  return new CompositeHasher(new Argon2idHasher(), new ScryptHasher());
}
