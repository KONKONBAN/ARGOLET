import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { createRuntime, type Runtime } from '../src/bootstrap';
import { buildServer, CSRF_HEADER, SESSION_COOKIE } from '../src/server';

let server: FastifyInstance;
let rt: Runtime;

beforeAll(async () => {
  const config = {
    ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite:memory', DEMO_SEED: 'true' }),
    webDist: null,
  };
  rt = await createRuntime(config, () => undefined);
  server = await buildServer({ app: rt.app, config, storeKind: rt.store.kind });
}, 180_000);

afterAll(async () => {
  await server?.close();
  await rt?.store.close();
});

const H = { [CSRF_HEADER]: '1', 'content-type': 'application/json' };

function cookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : [raw];
  const c = list.find((x) => typeof x === 'string' && x.startsWith(`${SESSION_COOKIE}=`)) as
    string | undefined;
  if (!c) throw new Error('no session cookie');
  return c.split(';')[0]!;
}

async function webLogin(email = 'ketoan@minhan.example', password = 'Argolet@2026') {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: H,
    payload: { contact: email, password },
  });
  expect(res.statusCode).toBe(200);
  const cookie = cookieFrom(res);
  const sel = await server.inject({
    method: 'POST',
    url: '/v1/workspaces/select',
    headers: { ...H, cookie },
    payload: { tenantId: 'ten_minhan' },
  });
  expect(sel.statusCode).toBe(200);
  return cookie;
}

describe('HTTP API', () => {
  it('serves health and meta', async () => {
    const h = await server.inject({ method: 'GET', url: '/healthz' });
    expect(h.json()).toMatchObject({ ok: true, store: 'postgres:pglite-memory' });
    const m = await server.inject({ method: 'GET', url: '/v1/meta' });
    expect(m.json()).toMatchObject({
      name: 'ARGOLET',
      assistant: 'rules',
      demo: { email: 'ketoan@minhan.example' },
    });
    expect(h.headers['x-frame-options']).toBeDefined();
    expect(String(h.headers['content-security-policy'])).toContain("default-src 'self'");
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { contact: 'a', password: 'b' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toContain('CSRF');
  });

  it('signs in with an HttpOnly cookie for the web (token never in the body)', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: H,
      payload: { contact: 'ketoan@minhan.example', password: 'Argolet@2026' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().token).toBeUndefined();
    const raw = String(res.headers['set-cookie']);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    const cookie = cookieFrom(res);
    const me = await server.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } });
    expect(me.json().user.fullName).toBe('Minh Anh');
    const out = await server.inject({ method: 'POST', url: '/v1/auth/logout', headers: { ...H, cookie } });
    expect(String(out.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=;`);
    expect(
      (await server.inject({ method: 'GET', url: '/v1/auth/me', headers: { cookie } })).json(),
    ).toBeNull();
  });

  it('gives the session cookie a relative lifetime, valid even when the demo clock lags real time', async () => {
    for (const [remember, maxHours] of [
      [false, 13],
      [true, 24 * 31],
    ] as const) {
      const res = await server.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: H,
        payload: { contact: 'ketoan@minhan.example', password: 'Argolet@2026', remember },
      });
      const raw = String(res.headers['set-cookie']);
      expect(raw).not.toMatch(/Expires=/i);
      const maxAge = Number(/Max-Age=(\d+)/i.exec(raw)?.[1]);
      expect(maxAge).toBeGreaterThan(3600);
      expect(maxAge).toBeLessThanOrEqual(maxHours * 3600);
    }
  });

  it('issues a bearer token for the mobile app', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { ...H, 'x-argolet-client': 'mobile' },
      payload: { contact: 'thanhha@minhan.example', password: 'Argolet@2026' },
    });
    const token = res.json().token as string;
    expect(token.length).toBeGreaterThan(40);
    const ws = await server.inject({
      method: 'GET',
      url: '/v1/workspaces',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ws.json()).toEqual([
      {
        tenantId: 'ten_minhan',
        name: 'Minh An Commerce',
        roleLabel: 'Kế toán',
        scopeLabel: '3 cơ sở',
        sites: 3,
      },
    ]);
    const ctx = await server.inject({
      method: 'GET',
      url: '/v1/workspace',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(ctx.json().member.roleLabel).toBe('Kế toán');
  });

  it('returns structured errors with the right status codes', async () => {
    const bad = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: H,
      payload: { contact: 'ketoan@minhan.example', password: 'sai-mat-khau-0' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toMatchObject({ code: 'UNAUTHENTICATED' });
    const anon = await server.inject({ method: 'GET', url: '/v1/dashboard' });
    expect(anon.statusCode).toBe(401);
    const cookie = await webLogin();
    const nf = await server.inject({ method: 'GET', url: '/v1/documents/CT-9999', headers: { cookie } });
    expect(nf.statusCode).toBe(404);
    const val = await server.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { ...H, cookie },
      payload: { name: '', orgType: 'x' },
    });
    expect(val.statusCode).toBe(422);
    expect(val.json().error.details.field).toBe('Tên tổ chức');
    const notJson = await server.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { [CSRF_HEADER]: '1', 'content-type': 'application/json', cookie },
      payload: '{bad json',
    });
    expect(notJson.statusCode).toBe(400);
    const unknown = await server.inject({ method: 'GET', url: '/v1/nope' });
    expect(unknown.statusCode).toBe(404);
  });

  it('serves the Figma screens through the REST contract', async () => {
    const cookie = await webLogin();
    const get = async (url: string) => {
      const r = await server.inject({ method: 'GET', url, headers: { cookie } });
      expect(r.statusCode, url).toBe(200);
      return r.json();
    };
    expect((await get('/v1/dashboard')).netLabel).toBe('+84.600.000 đ');
    expect((await get('/v1/documents?status=review')).total).toBe(4);
    expect((await get('/v1/documents?q=Nguy%C3%AAn&pageSize=5')).items.length).toBeLessThanOrEqual(5);
    // Pagination over HTTP: numbers arrive as query strings, pages are disjoint and clamped.
    const p1 = await get('/v1/documents?page=1&pageSize=20');
    const p2 = await get('/v1/documents?page=2&pageSize=20');
    expect([p1.total, p1.pageCount, p1.items.length, p2.page]).toEqual([128, 7, 20, 2]);
    expect(p1.items.some((x: { id: string }) => p2.items.some((y: { id: string }) => y.id === x.id))).toBe(
      false,
    );
    expect((await get('/v1/documents?page=99&pageSize=20')).page).toBe(7);
    expect(
      (await get('/v1/inbox?kind=APPROVAL')).items.every((i: { kind: string }) => i.kind === 'APPROVAL'),
    ).toBe(true);
    expect(
      (await get('/v1/notifications?unread=true')).items.every(
        (n: { status: string }) => n.status === 'UNREAD',
      ),
    ).toBe(true);
    expect((await get('/v1/match-groups')).kpis.matched).toBe(82);
    expect((await get('/v1/match-groups/DS-1031')).group.received).toBe('1125000');
    expect((await get('/v1/inbox')).items.length).toBeGreaterThan(3);
    expect((await get('/v1/approvals/apv_031')).approval.amountLabel).toBe('7.250.000 đ');
    expect((await get('/v1/periods/current?entityId=site_q3')).periodId).toBe('2026-10');
    expect((await get('/v1/decision-pack')).kpis.revenueLabel).toBe('428.600.000 đ');
    expect((await get('/v1/evidence/documents/CT-1027')).version.label).toBe('Phiên bản 03');
    expect((await get('/v1/finance/appraisal')).result.npvLabel).toBe('137,24 triệu');
    expect((await get('/v1/g4/intercompany')).pair.reference).toBe('IC-2610-018');
    expect((await get('/v1/notifications')).kpis.unread).toBe(5);
    expect((await get('/v1/members')).members.length).toBeGreaterThanOrEqual(4);
    expect((await get('/v1/settings')).integrations).toHaveLength(6);
    expect((await get('/v1/assistant/conversations')).items).toHaveLength(4);
    for (const url of [
      '/v1/g1/daily-close',
      '/v1/g1/inventory',
      '/v1/g1/purchase-orders',
      '/v1/g1/books',
      '/v1/g2/clients',
      '/v1/g2/deals',
      '/v1/g3/projects',
      '/v1/g3/assets',
      '/v1/g3/shipments/current',
      '/v1/g3/shipments/current/finance',
      '/v1/g4/group',
      '/v1/finance/scenarios',
      '/v1/import-batches',
      '/v1/snapshots',
    ]) {
      await get(url);
    }
  });

  it('runs intake → confirm → evidence verify over HTTP', async () => {
    const cookie = await webLogin('thanhha@minhan.example');
    const xml = `<HDon><DLHDon><TTChung><KHMSHDon>1</KHMSHDon><KHHDon>C26TSX</KHHDon><SHDon>00888</SHDon><NLap>2026-10-30</NLap></TTChung><NDHDon><NBan><Ten>Sữa Xanh</Ten><MST>0313334441</MST></NBan><NMua><Ten>Minh An Commerce</Ten><MST>0309876547</MST></NMua><DSHHDVu><HHDVu><THHDVu>Sữa</THHDVu><ThTien>900000</ThTien></HHDVu></DSHHDVu><TToan><TgTCThue>900000</TgTCThue><TgTThue>0</TgTThue><TgTTTBSo>900000</TgTTTBSo></TToan></NDHDon></DLHDon><MCCQT Id="cqt">00F0A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5</MCCQT><DSCKS><NBan><Signature/></NBan></DSCKS></HDon>`;
    const up = await server.inject({
      method: 'POST',
      url: '/v1/import-batches',
      headers: { ...H, cookie },
      payload: {
        entityId: 'site_q1',
        files: [
          { name: 'sx.xml', contentBase64: Buffer.from(xml).toString('base64'), mime: 'application/xml' },
        ],
      },
    });
    expect(up.statusCode).toBe(200);
    const docId = up.json().files[0].documentId as string;
    const conf = await server.inject({
      method: 'POST',
      url: `/v1/documents/${docId}/confirm`,
      headers: { ...H, cookie },
      payload: {},
    });
    expect(conf.statusCode).toBe(200);
    const ver = await server.inject({
      method: 'POST',
      url: `/v1/evidence/documents/${docId}/verify`,
      headers: { ...H, cookie },
      payload: { fileBase64: Buffer.from(xml).toString('base64') },
    });
    expect(ver.json().ok).toBe(true);
  });

  it('decides an approval and closes nothing without step-up', async () => {
    const cookie = await webLogin();
    const a = (
      await server.inject({ method: 'GET', url: '/v1/approvals/apv_vpp', headers: { cookie } })
    ).json();
    const d = await server.inject({
      method: 'POST',
      url: '/v1/approvals/apv_vpp/decisions',
      headers: { ...H, cookie },
      payload: { decision: 'APPROVE', digest: a.approval.digest },
    });
    expect(d.statusCode).toBe(200);
    expect(d.json().status).toBe('APPROVED');
    const st = (
      await server.inject({ method: 'GET', url: '/v1/periods/current?entityId=site_q1', headers: { cookie } })
    ).json();
    const close = await server.inject({
      method: 'POST',
      url: '/v1/periods/2026-10/close',
      headers: { ...H, cookie },
      payload: { entityId: 'site_q1', digest: st.draftDigest },
    });
    expect(close.statusCode).toBe(403);
    expect(close.json().error.code).toBe('STEP_UP_REQUIRED');
  });

  it('locks internal topics and learns from corrections over HTTP', async () => {
    const cookie = await webLogin();
    const locked = await server.inject({
      method: 'POST',
      url: '/v1/settings/ai/locked',
      headers: { ...H, cookie },
      payload: { topics: [{ name: 'Lương nhân sự', keywords: 'lương, bảng lương' }] },
    });
    expect(locked.statusCode).toBe(200);
    const ask = await server.inject({
      method: 'POST',
      url: '/v1/assistant/ask',
      headers: { ...H, cookie },
      payload: { question: 'Bảng lương tháng này?' },
    });
    expect(ask.json().answer).toMatchObject({ locked: true });
    const term = await server.inject({
      method: 'POST',
      url: '/v1/assistant/ask',
      headers: { ...H, cookie },
      payload: { question: 'Ký hiệu hóa đơn là gì?' },
    });
    const { conversationId, answer } = term.json();
    expect(answer.sources[0].title).toBe('Ký hiệu hóa đơn');
    const fb = await server.inject({
      method: 'POST',
      url: '/v1/assistant/feedback',
      headers: { ...H, cookie },
      payload: {
        conversationId,
        index: 1,
        helpful: false,
        correction: 'Công ty dùng ký hiệu 1C26TMA cho cửa hàng Quận 7.',
      },
    });
    expect(fb.json()).toEqual({ learning: true });
    const list = await server.inject({ method: 'GET', url: '/v1/knowledge', headers: { ...H, cookie } });
    expect(list.json().pending).toBe(1);
    expect(list.json().locked[0].keywords).toEqual(['lương', 'bảng lương']);
    // Leave the shared server without locked topics for the other tests.
    await server.inject({
      method: 'POST',
      url: '/v1/settings/ai/locked',
      headers: { ...H, cookie },
      payload: { topics: [] },
    });
  });

  it('rate-limits brute force on authentication endpoints', async () => {
    let last = 0;
    for (let i = 0; i < 35; i++) {
      const r = await server.inject({
        method: 'POST',
        url: '/v1/auth/password-reset',
        headers: { ...H, 'x-forwarded-for': '10.9.9.9' },
        remoteAddress: '10.9.9.9',
        payload: { contact: 'x@y.vn' },
      });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });

  it('counts only API calls towards the allowance of one internet address', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'argolet-web-'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ARGOLET</title>');
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'assets', 'app.js'), 'export {};');
    const config = {
      ...loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'pglite:memory', RATE_LIMIT_PER_MINUTE: '5' }),
      webDist: dir,
    };
    expect(config.rateLimitPerMinute).toBe(5);
    const small = await buildServer({ app: rt.app, config, storeKind: rt.store.kind });
    try {
      const office = { remoteAddress: '10.7.7.7' };
      // The web app's files and the health check never use up the allowance.
      for (let i = 0; i < 20; i++) {
        expect((await small.inject({ method: 'GET', url: '/assets/app.js', ...office })).statusCode).toBe(
          200,
        );
        expect((await small.inject({ method: 'GET', url: '/', ...office })).statusCode).toBe(200);
        expect((await small.inject({ method: 'GET', url: '/healthz', ...office })).statusCode).toBe(200);
      }
      const codes: number[] = [];
      for (let i = 0; i < 7; i++)
        codes.push((await small.inject({ method: 'GET', url: '/v1/meta', ...office })).statusCode);
      expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
      const limited = await small.inject({ method: 'GET', url: '/v1/meta', ...office });
      expect(limited.json().error.code).toBe('RATE_LIMITED');
      // Another address keeps its own allowance.
      expect(
        (await small.inject({ method: 'GET', url: '/v1/meta', remoteAddress: '10.7.7.8' })).statusCode,
      ).toBe(200);
    } finally {
      await small.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a rate limit that is not a positive whole number', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: 'nhanh' })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
    expect(() => loadConfig({ NODE_ENV: 'test', RATE_LIMIT_PER_MINUTE: '0' })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
    expect(loadConfig({ NODE_ENV: 'test' }).rateLimitPerMinute).toBe(1200);
  });
});
