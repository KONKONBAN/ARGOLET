import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production builds, in both deployment modes:
 *  - static: apps/web/dist on a plain static server (the whole app runs in the browser),
 *  - api:    the Fastify API server (PGlite, demo seed) serving the same web build,
 *  - fresh:  the API server on an empty database (no demo data, real calendar): a new company
 *            runs the whole product through the UI.
 * Build first: `pnpm build` (web dist + API bundle).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = Number(process.env.E2E_STATIC_PORT ?? 4310);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4320);
const FRESH_PORT = Number(process.env.E2E_FRESH_PORT ?? 4340);
const PARTNER_PORT = Number(process.env.E2E_PARTNER_PORT ?? 4360);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 3,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'off',
    screenshot: 'only-on-failure',
    // A camera that films a printed invoice (for the in-app photo capture).
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${path.join(root, 'e2e/fixtures/camera-hoa-don.mjpeg')}`,
      ],
    },
  },
  projects: [
    {
      name: 'static',
      testIgnore: /fresh\//,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://127.0.0.1:${STATIC_PORT}`,
      },
    },
    {
      name: 'api',
      testIgnore: /fresh\//,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://127.0.0.1:${API_PORT}`,
      },
    },
    {
      name: 'fresh',
      testMatch: /fresh\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        baseURL: `http://127.0.0.1:${FRESH_PORT}`,
      },
    },
  ],
  webServer: [
    {
      // Stand-in for the partners' APIs (SePay) that the API server connects to.
      command: 'node partner-standin.mjs',
      cwd: path.join(root, 'e2e'),
      url: `http://127.0.0.1:${PARTNER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: { PARTNER_PORT: String(PARTNER_PORT) },
    },
    {
      command: `npx vite preview --port ${STATIC_PORT} --strictPort --host 127.0.0.1`,
      cwd: path.join(root, 'apps/web'),
      url: `http://127.0.0.1:${STATIC_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node dist/main.mjs',
      cwd: path.join(root, 'apps/api'),
      url: `http://127.0.0.1:${API_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        DATABASE_URL: 'pglite:memory',
        DEMO_SEED: 'true',
        EXPOSE_DEV_CODES: 'true',
        WEB_DIST: path.join(root, 'apps/web/dist'),
        PUBLIC_BASE_URL: `http://127.0.0.1:${API_PORT}`,
        // A throw-away key per run; partner calls go to the local stand-in.
        ARGOLET_SECRET_KEY: randomBytes(32).toString('base64'),
        ARGOLET_CONNECTOR_ENDPOINTS: JSON.stringify({ SEPAY: `http://127.0.0.1:${PARTNER_PORT}` }),
      },
    },
    {
      command: 'node dist/main.mjs',
      cwd: path.join(root, 'apps/api'),
      url: `http://127.0.0.1:${FRESH_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(FRESH_PORT),
        HOST: '127.0.0.1',
        DATABASE_URL: 'pglite:memory',
        DEMO_SEED: 'false',
        EXPOSE_DEV_CODES: 'true',
        WEB_DIST: path.join(root, 'apps/web/dist'),
        PUBLIC_BASE_URL: `http://127.0.0.1:${FRESH_PORT}`,
      },
    },
  ],
});
