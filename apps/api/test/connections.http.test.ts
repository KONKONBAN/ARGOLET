/**
 * Partner connections through the real server: credentials sealed with ARGOLET_SECRET_KEY,
 * partner called over HTTP (a local stand-in answering like SePay API v2), document received.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { createRuntime, type Runtime } from '../src/bootstrap';
import { aesGcmBox, parseSecretKey } from '../src/secrets';
import { buildServer, CSRF_HEADER, SESSION_COOKIE } from '../src/server';

const TOKEN = 'T'.repeat(60) + 'Z9X8';
let partner: Server;
let server: FastifyInstance;
let rt: Runtime;
const seen: string[] = [];

beforeAll(async () => {
  partner = createServer((req, res) => {
    seen.push(
      `${req.method} ${req.url} ${req.headers.authorization === `Bearer ${TOKEN}` ? 'auth' : 'anon'}`,
    );
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.statusCode = 401;
      return res.end(
        JSON.stringify({ status: 'error', message: 'Invalid API key', error_code: 'unauthorized' }),
      );
    }
    const pagination = { total: 1, per_page: 100, current_page: 1, last_page: 1, has_more: false };
    if (req.url?.startsWith('/v2/bank-accounts'))
      return res.end(
        JSON.stringify({
          status: 'success',
          data: [{ id: 'ba', account_number: '19028745631', bank_short_name: 'VCB' }],
          meta: { pagination },
        }),
      );
    res.end(
      JSON.stringify({
        status: 'success',
        data: [
          {
            id: 'tx-1',
            transaction_date: '2026-10-30 14:15:00',
            account_number: '19028745631',
            transfer_type: 'in',
            amount_in: 2350000,
            amount_out: 0,
            transaction_content: 'GRAB CHUYEN TIEN TT-3010',
            reference_number: 'FT26303XYZ',
            bank_brand_name: 'VCB',
          },
        ],
        meta: { pagination },
      }),
    );
  });
  await new Promise<void>((r) => partner.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(partner.address() as AddressInfo).port}`;
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      DEMO_SEED: 'true',
      ARGOLET_SECRET_KEY: randomBytes(32).toString('base64'),
      ARGOLET_CONNECTOR_ENDPOINTS: JSON.stringify({ SEPAY: base }),
    }),
    webDist: null,
  };
  rt = await createRuntime(config, () => undefined);
  rt.app.deps.connectorPaceMs = 0;
  server = await buildServer({ app: rt.app, config, storeKind: rt.store.kind });
}, 180_000);

afterAll(async () => {
  await server?.close();
  await rt?.store.close();
  await new Promise((r) => partner?.close(r));
});

const H = { [CSRF_HEADER]: '1', 'content-type': 'application/json' };

async function adminCookie() {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: H,
    payload: { contact: 'ketoan@minhan.example', password: 'Argolet@2026' },
  });
  const raw = res.headers['set-cookie'];
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => String(c).startsWith(SESSION_COOKIE))!;
  const c = String(cookie).split(';')[0]!;
  await server.inject({
    method: 'POST',
    url: '/v1/workspaces/select',
    headers: { ...H, cookie: c },
    payload: { tenantId: 'ten_minhan' },
  });
  return c;
}

describe('partner connections over HTTP', () => {
  it('connects SePay, keeps the token server-side and receives transactions as a document', async () => {
    const cookie = await adminCookie();
    const bad = await server.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: { ...H, cookie },
      payload: { provider: 'SEPAY', credentials: { apiToken: 'sai' } },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toMatch(/SePay từ chối thông tin xác thực/);

    const ok = await server.inject({
      method: 'POST',
      url: '/v1/connections',
      headers: { ...H, cookie },
      payload: { provider: 'SEPAY', credentials: { apiToken: TOKEN } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain(TOKEN);
    const id = ok.json().connection.id as string;

    const list = await server.inject({ method: 'GET', url: '/v1/connections', headers: { cookie } });
    expect(list.json()).toMatchObject({ serverReady: true });
    expect(list.body).not.toContain(TOKEN);
    const stored = await rt.store.read((tx) => tx.get('connections', 'ten_minhan', id));
    expect(stored!.secretSealed).not.toContain(TOKEN);

    const sync = await server.inject({
      method: 'POST',
      url: `/v1/connections/${id}/sync`,
      headers: { ...H, cookie },
      payload: {},
    });
    expect(sync.statusCode).toBe(200);
    expect(sync.json()).toMatchObject({ status: 'SUCCESS', fetched: 1, imported: 1 });
    const doc = await server.inject({
      method: 'GET',
      url: `/v1/documents/${sync.json().documentId}`,
      headers: { cookie },
    });
    expect(doc.json().document).toMatchObject({ sourceKind: 'BANK', amount: '2350000' });
    expect(doc.json().document.rows[0]).toMatchObject({ code: 'FT26303XYZ', payoutBatch: 'TT-3010' });
    expect(seen.some((s) => s.startsWith('GET /v2/transactions?') && s.endsWith('auth'))).toBe(true);
  });
});

describe('secret box', () => {
  it('seals with a fresh IV each time and refuses tampered data or another key', async () => {
    const box = aesGcmBox(parseSecretKey(randomBytes(32).toString('hex')));
    const a = await box.seal('{"apiToken":"abc"}');
    expect(a).not.toBe(await box.seal('{"apiToken":"abc"}'));
    expect(await box.open(a)).toBe('{"apiToken":"abc"}');
    const [v, iv, body] = a.split('.');
    const flipped = Buffer.from(body!, 'base64');
    flipped[0]! ^= 1;
    await expect(box.open(`${v}.${iv}.${flipped.toString('base64')}`)).rejects.toThrow();
    await expect(aesGcmBox(parseSecretKey(randomBytes(32).toString('base64'))).open(a)).rejects.toThrow();
    expect(() => parseSecretKey('ngan-qua')).toThrow(/32 byte/);
  });
});
