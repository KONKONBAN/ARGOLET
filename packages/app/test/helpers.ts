import {
  createArgoletApp,
  demoClock,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_TENANT,
  MemoryStore,
  ScryptHasher,
  seedDemo,
  type ArgoletApp,
  type CallContext,
} from '../src';

/** Fast scrypt params keep the suite quick; production uses Argon2id / stronger scrypt. */
export const fastHasher = new ScryptHasher(2 ** 10, 8, 1);

export async function seededApp(): Promise<{ app: ArgoletApp; store: MemoryStore }> {
  const clock = demoClock();
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const app = createArgoletApp({ store, hasher: fastHasher, clock });
  await seedDemo(app);
  return { app, store };
}

export async function loginAs(
  app: ArgoletApp,
  email = DEMO_EMAIL,
  tenantId: string | null = DEMO_TENANT,
): Promise<CallContext> {
  const r = await app.auth.login(
    { channel: 'web', userAgent: 'vitest', ip: '127.0.0.1' },
    { contact: email, password: DEMO_PASSWORD },
  );
  const call: CallContext = { sessionToken: r.token, channel: 'web' };
  if (tenantId) await app.org.selectWorkspace(call, { tenantId });
  return call;
}

export async function expectAppError(
  p: Promise<unknown>,
  code: string,
): Promise<{ code: string; message: string; details?: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; message: string; details?: Record<string, unknown> };
    if (err.code !== code)
      throw new Error(`Expected ${code} but got ${err.code ?? 'non-app error'}: ${err.message}`, {
        cause: e,
      });
    return err as { code: string; message: string };
  }
  throw new Error(`Expected AppError ${code} but the call succeeded`);
}
