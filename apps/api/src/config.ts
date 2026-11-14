import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ApiConfig {
  port: number;
  host: string;
  production: boolean;
  databaseUrl: string;
  cookieSecure: boolean;
  corsOrigins: string[];
  demoSeed: boolean;
  demoClock: boolean;
  exposeDevCodes: boolean;
  pepper: string;
  anthropicApiKey: string | null;
  /** Character recognition on the server (Tesseract, Vietnamese); on unless ARGOLET_OCR=off. */
  ocr: boolean;
  /** OpenAI (ChatGPT) key: enables ChatGPT as a choice for organisations; kept server-side. */
  openaiApiKey: string | null;
  /** SMTP connection URL (smtp:// or smtps://user:pass@host:port); enables real email delivery. */
  smtpUrl: string | null;
  mailFrom: string;
  webDist: string | null;
  publicBaseUrl: string;
  trustProxy: boolean;
  /** Key sealing partners' credentials (connections); connections are off without it. */
  secretKey: string | null;
  /** Partner API base URLs, for a test stand-in only (production uses the partners' own URLs). */
  connectorEndpoints: Partial<Record<'SEPAY' | 'KIOTVIET' | 'KIOTVIET_TOKEN', string>>;
}

const bool = (v: string | undefined, dflt: boolean) =>
  v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // A relative WEB_DIST is resolved against the working directory (static serving needs an absolute path).
    env.WEB_DIST ? path.resolve(env.WEB_DIST) : undefined,
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../web'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ].filter(Boolean) as string[];
  const webDist = candidates.find((p) => existsSync(path.join(p, 'index.html'))) ?? null;
  // Sample data only where asked for: a production server starts empty unless DEMO_SEED=true.
  const demoSeed = bool(env.DEMO_SEED, !production);
  const pepper = env.PEPPER ?? '';
  if (production && pepper.length < 32) {
    throw new Error('PEPPER (>= 32 ký tự ngẫu nhiên) là bắt buộc khi NODE_ENV=production');
  }
  // A real deployment must deliver verification codes by e-mail, or nobody can sign up.
  if (production && !demoSeed && !env.SMTP_URL && !bool(env.EXPOSE_DEV_CODES, false)) {
    throw new Error(
      'SMTP_URL là bắt buộc khi NODE_ENV=production (người dùng nhận mã xác minh qua email). Máy chủ trải nghiệm: đặt DEMO_SEED=true',
    );
  }
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    production,
    databaseUrl: env.DATABASE_URL ?? 'pglite:./data/pglite',
    cookieSecure: bool(env.COOKIE_SECURE, production),
    corsOrigins: (env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    demoSeed,
    demoClock: bool(env.DEMO_CLOCK, demoSeed),
    // Codes are shown on screen only in development / demo installs without a mail server.
    exposeDevCodes: bool(env.EXPOSE_DEV_CODES, !env.SMTP_URL && (!production || demoSeed)),
    pepper: pepper || 'argolet-dev-pepper-change-me',
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    ocr: bool(env.ARGOLET_OCR, true),
    openaiApiKey: env.OPENAI_API_KEY || null,
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM || 'ARGOLET <no-reply@argolet.local>',
    webDist,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    trustProxy: bool(env.TRUST_PROXY, production),
    secretKey: env.ARGOLET_SECRET_KEY || null,
    connectorEndpoints: production ? {} : parseEndpoints(env.ARGOLET_CONNECTOR_ENDPOINTS),
  };
}

function parseEndpoints(v: string | undefined): ApiConfig['connectorEndpoints'] {
  if (!v) return {};
  const parsed = JSON.parse(v) as Record<string, string>;
  const out: ApiConfig['connectorEndpoints'] = {};
  for (const k of ['SEPAY', 'KIOTVIET', 'KIOTVIET_TOKEN'] as const)
    if (typeof parsed[k] === 'string') out[k] = parsed[k];
  return out;
}
