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
  /** SMTP connection URL (smtp:// or smtps://user:pass@host:port); enables real email delivery. */
  smtpUrl: string | null;
  mailFrom: string;
  webDist: string | null;
  publicBaseUrl: string;
  trustProxy: boolean;
}

const bool = (v: string | undefined, dflt: boolean) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase()));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const production = env.NODE_ENV === 'production';
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [env.WEB_DIST, path.resolve(here, '../../web/dist'), path.resolve(here, '../web'), path.resolve(process.cwd(), 'apps/web/dist')].filter(Boolean) as string[];
  const webDist = candidates.find((p) => existsSync(path.join(p, 'index.html'))) ?? null;
  const demoSeed = bool(env.DEMO_SEED, true);
  const pepper = env.PEPPER ?? '';
  if (production && pepper.length < 32) {
    throw new Error('PEPPER (>= 32 ký tự ngẫu nhiên) là bắt buộc khi NODE_ENV=production');
  }
  return {
    port: Number(env.PORT ?? 8080),
    host: env.HOST ?? '0.0.0.0',
    production,
    databaseUrl: env.DATABASE_URL ?? 'pglite:./data/pglite',
    cookieSecure: bool(env.COOKIE_SECURE, production),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    demoSeed,
    demoClock: bool(env.DEMO_CLOCK, demoSeed),
    // Codes are shown on screen only in development / demo installs without a mail server.
    exposeDevCodes: bool(env.EXPOSE_DEV_CODES, !env.SMTP_URL && (!production || demoSeed)),
    pepper: pepper || 'argolet-dev-pepper-change-me',
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM || 'ARGOLET <no-reply@argolet.local>',
    webDist,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    trustProxy: bool(env.TRUST_PROXY, production),
  };
}
