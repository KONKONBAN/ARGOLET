import { createArgoletApp, demoClock, seedDemo, type ArgoletApp } from '@argolet/app';
import type { ApiConfig } from './config';
import { serverHasher } from './hasher';
import { createAiKeys } from '@argolet/app/llm';
import { ClaudeVisionExtractionProvider } from './claude';
import { CombinedExtractionProvider, TesseractOcr } from './ocr';
import { PgStore, pgDriver, pgliteDriver } from './db';
import { createMailNotifier } from './mailer';
import { aesGcmBox, parseSecretKey } from './secrets';

export interface Runtime {
  app: ArgoletApp;
  store: PgStore;
}

export async function createRuntime(
  config: ApiConfig,
  log: (msg: string) => void = console.info,
): Promise<Runtime> {
  const clock = config.demoClock ? demoClock() : () => new Date();
  const driver = config.databaseUrl.startsWith('pglite:')
    ? await pgliteDriver(
        config.databaseUrl === 'pglite:memory' ? undefined : config.databaseUrl.slice('pglite:'.length),
      )
    : await pgDriver(config.databaseUrl);
  const store = new PgStore(driver, () => clock().toISOString());
  await store.migrate(log);
  const aiKeys = createAiKeys({
    models: { claude: process.env.ARGOLET_CLAUDE_MODEL, openai: process.env.ARGOLET_OPENAI_MODEL },
  });
  const app = createArgoletApp({
    store,
    hasher: serverHasher(),
    clock,
    // Each provider is available only with its key; an organisation still has to choose it.
    llms: {
      ...(config.anthropicApiKey ? { claude: aiKeys.create('claude', config.anthropicApiKey) } : {}),
      ...(config.openaiApiKey ? { openai: aiKeys.create('openai', config.openaiApiKey) } : {}),
    },
    // An organisation can also connect its own Claude / ChatGPT key, sealed with the server key.
    aiKeys,
    // Photos and scans are read twice — OCR and the vision model — and checked field by field.
    extraction:
      config.ocr || config.anthropicApiKey
        ? new CombinedExtractionProvider(
            config.ocr ? new TesseractOcr() : null,
            config.anthropicApiKey ? new ClaudeVisionExtractionProvider(config.anthropicApiKey) : null,
            log,
          )
        : undefined,
    notifier: config.smtpUrl
      ? createMailNotifier({ smtpUrl: config.smtpUrl, from: config.mailFrom, otpTtlMinutes: 10 }, log)
      : {
          // Without a mail server codes are only logged in development (and shown on screen when EXPOSE_DEV_CODES).
          sendCode: async (to, purpose, code) => {
            if (!config.production) log(`[notifier] ${purpose} → ${to}: ${code}`);
          },
        },
    config: {
      pepper: config.pepper,
      exposeDevCodes: config.exposeDevCodes,
      publicBaseUrl: config.publicBaseUrl,
    },
    // Partner APIs are called from here only, with credentials sealed by the server key.
    secrets: config.secretKey ? aesGcmBox(parseSecretKey(config.secretKey)) : null,
    http: config.secretKey ? (url, init) => fetch(url, init) : null,
    connectorEndpoints: config.connectorEndpoints,
  });
  if (!config.secretKey) log('[connections] ARGOLET_SECRET_KEY chưa đặt: tắt kết nối API đối tác');
  if (config.demoSeed) {
    const r = await seedDemo(app);
    if (r.seeded) log('[seed] Demo dataset "Minh An Commerce" created');
  }
  await app.core.relay.drain();
  return { app, store };
}
