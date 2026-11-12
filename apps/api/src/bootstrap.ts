import { createArgoletApp, demoClock, seedDemo, type ArgoletApp } from '@argolet/app';
import type { ApiConfig } from './config';
import { serverHasher } from './hasher';
import { ClaudeLlmClient, ClaudeVisionExtractionProvider } from './claude';
import { PgStore, pgDriver, pgliteDriver } from './pgStore';
import { createMailNotifier } from './mailer';

export interface Runtime {
  app: ArgoletApp;
  store: PgStore;
}

export async function createRuntime(config: ApiConfig, log: (msg: string) => void = console.info): Promise<Runtime> {
  const clock = config.demoClock ? demoClock() : () => new Date();
  const driver = config.databaseUrl.startsWith('pglite:')
    ? await pgliteDriver(config.databaseUrl === 'pglite:memory' ? undefined : config.databaseUrl.slice('pglite:'.length))
    : await pgDriver(config.databaseUrl);
  const store = new PgStore(driver, () => clock().toISOString());
  await store.migrate();
  const app = createArgoletApp({
    store,
    hasher: serverHasher(),
    clock,
    llm: config.anthropicApiKey ? new ClaudeLlmClient(config.anthropicApiKey) : null,
    extraction: config.anthropicApiKey ? new ClaudeVisionExtractionProvider(config.anthropicApiKey) : undefined,
    notifier: config.smtpUrl
      ? createMailNotifier({ smtpUrl: config.smtpUrl, from: config.mailFrom, otpTtlMinutes: 10 }, log)
      : {
          // Without a mail server codes are only logged in development (and shown on screen when EXPOSE_DEV_CODES).
          sendCode: async (to, purpose, code) => {
            if (!config.production) log(`[notifier] ${purpose} → ${to}: ${code}`);
          },
        },
    config: { pepper: config.pepper, exposeDevCodes: config.exposeDevCodes, publicBaseUrl: config.publicBaseUrl },
  });
  if (config.demoSeed) {
    const r = await seedDemo(app);
    if (r.seeded) log('[seed] Demo dataset "Minh An Commerce" created');
  }
  await app.core.relay.drain();
  return { app, store };
}
