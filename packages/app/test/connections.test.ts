/**
 * Connections from ARGOLET to partners' APIs, against a stand-in that answers like the partners'
 * documentation says (SePay API v2, KiotViet Public API): authentication, paging, polling,
 * rate limiting — and what ARGOLET keeps (sealed credentials, verbatim snapshots, run log).
 */
import { describe, expect, it } from 'vitest';
import {
  createArgoletApp,
  demoClock,
  DEMO_TENANT,
  MemoryStore,
  seedDemo,
  type HttpFetch,
  type SecretBox,
} from '../src';
import { expectAppError, fastHasher, loginAs } from './helpers';

/** AES-256-GCM with WebCrypto, like the server's box (a fresh key per test run). */
async function testBox(): Promise<SecretBox> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return {
    async seal(text) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)),
      );
      return `v1.${b64(iv)}.${b64(ct)}`;
    },
    async open(sealed) {
      const [, iv, ct] = sealed.split('.');
      return new TextDecoder().decode(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv!) }, key, unb64(ct!)),
      );
    },
  };
}

const TOKEN = 'S'.repeat(60) + 'K7Q2';

type Tx = { id: string; date: string; in: number; out: number; ref: string; text: string };

/** A partner stand-in: SePay v2 + KiotViet, with the documented shapes and status codes. */
function partners() {
  const sepayTx: Tx[] = [];
  const kiot: { id: number; code: string; date: string; total: number; status: number }[] = [];
  const calls: string[] = [];
  let throttleNext = false;
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  });
  const http: HttpFetch = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method} ${u.host}${u.pathname}`);
    if (u.host === 'sepay.test') {
      if (init.headers.authorization !== `Bearer ${TOKEN}`)
        return res(401, { status: 'error', message: 'Invalid API key', error_code: 'unauthorized' });
      if (throttleNext) {
        throttleNext = false;
        return res(
          429,
          { status: 'error', message: 'Too many requests', error_code: 'rate_limited' },
          { 'retry-after': '1' },
        );
      }
      if (u.pathname === '/v2/bank-accounts')
        return res(200, {
          status: 'success',
          data: [
            { id: 'ba1', account_number: '0123456789', bank_short_name: 'ACB', accumulated: 1, active: 1 },
          ],
          meta: { pagination: { total: 1, per_page: 100, current_page: 1, last_page: 1, has_more: false } },
        });
      const since = u.searchParams.get('since_id');
      const from = u.searchParams.get('transaction_date_from');
      let list = [...sepayTx].sort((a, b) => a.date.localeCompare(b.date));
      if (since) list = list.slice(list.findIndex((t) => t.id === since) + 1);
      else if (from) list = list.filter((t) => t.date >= from);
      const per = 2;
      const page = Number(u.searchParams.get('page') ?? '1');
      const slice = list.slice((page - 1) * per, page * per);
      return res(200, {
        status: 'success',
        data: slice.map((t) => ({
          id: t.id,
          transaction_date: t.date,
          account_number: '0123456789',
          transfer_type: t.in ? 'in' : 'out',
          amount_in: t.in,
          amount_out: t.out,
          transaction_content: t.text,
          reference_number: t.ref,
          bank_brand_name: 'ACB',
        })),
        meta: {
          pagination: {
            total: list.length,
            per_page: per,
            current_page: page,
            last_page: Math.max(1, Math.ceil(list.length / per)),
            has_more: page * per < list.length,
          },
        },
      });
    }
    if (u.host === 'kiot-id.test') {
      const form = new URLSearchParams(init.body ?? '');
      if (
        form.get('client_id') !== 'cid' ||
        form.get('client_secret') !== 'csecret' ||
        form.get('scopes') !== 'PublicApi.Access'
      )
        return res(400, { error: 'invalid_client' });
      return res(200, { access_token: 'kv-token', expires_in: 86400, token_type: 'Bearer' });
    }
    if (u.host === 'kiot.test') {
      if (init.headers.authorization !== 'Bearer kv-token' || init.headers.retailer !== 'tiembanh')
        return res(401, { message: 'Unauthorized' });
      const from = u.searchParams.get('fromPurchaseDate') ?? '';
      const list = kiot.filter((i) => i.date >= from).sort((a, b) => a.date.localeCompare(b.date));
      const size = Math.min(100, Number(u.searchParams.get('pageSize') ?? '20'));
      const current = Number(u.searchParams.get('currentItem') ?? '0');
      const slice = list.slice(current, current + Math.min(size, 2));
      return res(200, {
        total: list.length,
        pageSize: size,
        data: slice.map((i) => ({
          id: i.id,
          code: i.code,
          purchaseDate: i.date,
          branchName: 'Tiệm chính',
          customerName: 'Khách lẻ',
          total: i.total,
          totalPayment: i.total,
          status: i.status,
          payments: [{ id: 1, amount: i.total, method: 'Transfer' }],
        })),
      });
    }
    return res(404, {});
  };
  return { http, sepayTx, kiot, calls, throttle: () => (throttleNext = true) };
}

async function setup(withServer = true) {
  const clock = demoClock();
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const p = partners();
  const app = createArgoletApp({
    store,
    hasher: fastHasher,
    clock,
    http: withServer ? p.http : null,
    secrets: withServer ? await testBox() : null,
    connectorEndpoints: {
      SEPAY: 'https://sepay.test',
      KIOTVIET_TOKEN: 'https://kiot-id.test/connect/token',
      KIOTVIET: 'https://kiot.test',
    },
    connectorPaceMs: 0,
  });
  await seedDemo(app);
  return { app, store, p, admin: await loginAs(app), acct: await loginAs(app, 'thanhha@minhan.example') };
}

describe('connections to partner APIs', () => {
  it('SePay: refuses a wrong token, stores a good one sealed and never shows it', async () => {
    const { app, store, admin } = await setup();
    await expectAppError(
      app.connections.connect(admin, { provider: 'SEPAY', credentials: { apiToken: 'wrong-token' } }),
      'VALIDATION',
    );
    expect(await store.read((tx) => tx.list('connections', DEMO_TENANT))).toHaveLength(0);
    const r = await app.connections.connect(admin, { provider: 'SEPAY', credentials: { apiToken: TOKEN } });
    expect(r.run).toMatchObject({
      trigger: 'TEST',
      status: 'SUCCESS',
      message: 'SePay xác nhận 1 tài khoản: ACB đuôi 6789',
    });
    expect(r.connection.secretHint).toBe('đuôi K7Q2');
    const listed = JSON.stringify(await app.connections.list(admin));
    expect(listed).not.toContain(TOKEN);
    const [row] = await store.read((tx) => tx.list('connections', DEMO_TENANT));
    expect(row!.secretSealed).toMatch(/^v1\./);
    expect(row!.secretSealed).not.toContain(TOKEN);
  });

  it('SePay: pulls new transactions page by page, then only what is new (since_id)', async () => {
    const { app, store, p, admin } = await setup();
    p.sepayTx.push(
      { id: 't1', date: '2026-10-28 08:00:00', in: 1_250_000, out: 0, ref: 'FT1', text: 'GRAB TT-2810' },
      { id: 't2', date: '2026-10-29 09:00:00', in: 0, out: 300_000, ref: 'FT2', text: 'Phi' },
      { id: 't3', date: '2026-10-30 10:00:00', in: 845_000, out: 0, ref: 'FT3', text: 'SHOPEEFOOD S30' },
      { id: 'old', date: '2026-09-15 10:00:00', in: 1, out: 0, ref: 'OLD', text: 'thang truoc' },
    );
    const { connection } = await app.connections.connect(admin, {
      provider: 'SEPAY',
      credentials: { apiToken: TOKEN },
    });
    p.throttle(); // the first data request is rate limited once (HTTP 429 + Retry-After)
    const first = await app.connections.sync(admin, { connectionId: connection.id });
    expect(first).toMatchObject({ status: 'SUCCESS', fetched: 3, imported: 3 });
    const doc = await app.documents.getDocument(admin, { documentId: first.documentId! });
    expect(doc.document).toMatchObject({
      sourceKind: 'BANK',
      kind: 'STATEMENT',
      rowKind: 'BANK',
      amount: '1795000',
    });
    expect(doc.document.rows.map((r) => [r.code, r.date, r.amount, r.payoutBatch])).toEqual([
      ['FT1', '2026-10-28', '1250000', 'TT-2810'],
      ['FT2', '2026-10-29', '-300000', ''],
      ['FT3', '2026-10-30', '845000', 'S30'],
    ]);
    // The partner's own response is the source artifact, fingerprinted like any upload.
    expect(doc.artifact?.mime).toBe('application/json');
    expect(doc.artifact?.content).toContain('"format":"argolet.connector-snapshot/1"');
    expect(doc.artifact?.rawSha256).toMatch(/^[0-9a-f]{64}$/);

    p.sepayTx.push({ id: 't4', date: '2026-10-31 07:30:00', in: 500_000, out: 0, ref: 'FT4', text: 'CK' });
    const second = await app.connections.sync(admin, { connectionId: connection.id });
    expect(second).toMatchObject({ status: 'SUCCESS', fetched: 1, imported: 1 });
    expect(p.calls.filter((c) => c.endsWith('/v2/transactions')).length).toBeGreaterThanOrEqual(4);
    const third = await app.connections.sync(admin, { connectionId: connection.id });
    expect(third).toMatchObject({ status: 'NO_CHANGE', fetched: 0, imported: 0, documentId: null });
    const runs = await store.read((tx) => tx.list('connectionRuns', DEMO_TENANT));
    expect(runs.map((r) => r.status).sort()).toEqual(['NO_CHANGE', 'SUCCESS', 'SUCCESS', 'SUCCESS']);
  });

  it('KiotViet: client-credentials token, completed sales only, no double booking', async () => {
    const { app, p, admin } = await setup();
    p.kiot.push(
      { id: 1, code: 'HD001', date: '2026-10-30T09:00:00', total: 350_000, status: 1 },
      { id: 2, code: 'HD002', date: '2026-10-30T10:00:00', total: 90_000, status: 2 },
      { id: 3, code: 'HD003', date: '2026-10-31T08:00:00', total: 120_000, status: 1 },
    );
    await expectAppError(
      app.connections.connect(admin, {
        provider: 'KIOTVIET',
        credentials: { retailer: 'tiembanh', clientId: 'cid', clientSecret: 'sai' },
      }),
      'VALIDATION',
    );
    const { connection, run } = await app.connections.connect(admin, {
      provider: 'KIOTVIET',
      credentials: { retailer: 'tiembanh', clientId: 'cid', clientSecret: 'csecret' },
    });
    expect(run.message).toBe('KiotViet xác nhận gian hàng "tiembanh", 3 hóa đơn');
    expect(connection.config).toEqual({ retailer: 'tiembanh' });
    const first = await app.connections.sync(admin, { connectionId: connection.id });
    expect(first).toMatchObject({ status: 'SUCCESS', fetched: 3, imported: 2 });
    const doc = await app.documents.getDocument(admin, { documentId: first.documentId! });
    expect(doc.document).toMatchObject({ sourceKind: 'POS', rowKind: 'POS', amount: '470000' });
    expect(doc.document.issues[0]?.message).toBe('Bỏ qua 1 hóa đơn đã hủy, 0 hóa đơn chưa hoàn thành');
    // The next call starts from the last purchase date, so HD003 comes back: it is not booked twice.
    const again = await app.connections.sync(admin, { connectionId: connection.id });
    expect(again).toMatchObject({ status: 'NO_CHANGE', imported: 0 });
  });

  it('a failure is logged and shown; disconnecting forgets the credentials', async () => {
    const { app, store, p, admin } = await setup();
    const { connection } = await app.connections.connect(admin, {
      provider: 'SEPAY',
      credentials: { apiToken: TOKEN },
    });
    p.sepayTx.push({ id: 'x', date: '2026-10-30 10:00:00', in: 0, out: 0, ref: 'R', text: '' });
    // The stored token no longer works on the partner side (revoked there).
    await store.transaction(async (tx) => {
      const c = (await tx.get('connections', DEMO_TENANT, connection.id))!;
      const box = app.deps.secrets!;
      await tx.put('connections', {
        ...c,
        secretSealed: await box.seal(JSON.stringify({ apiToken: 'revoked' })),
      });
    });
    await expectAppError(app.connections.sync(admin, { connectionId: connection.id }), 'VALIDATION');
    const list = await app.connections.list(admin);
    expect(list.connections[0]).toMatchObject({ status: 'ERROR' });
    expect(list.connections[0]!.lastError).toMatch(/từ chối thông tin xác thực/);
    expect(list.connections[0]!.runs[0]).toMatchObject({ status: 'FAILED' });
    await app.connections.disconnect(admin, { connectionId: connection.id });
    const [row] = await store.read((tx) => tx.list('connections', DEMO_TENANT));
    expect(row).toMatchObject({ status: 'DISCONNECTED', secretSealed: null });
    await expectAppError(app.connections.sync(admin, { connectionId: connection.id }), 'CONFLICT');
  });

  it('only administrators manage connections; without a server key nothing is stored', async () => {
    const { app } = await setup(false);
    const admin = await loginAs(app);
    const viewer = await loginAs(app, undefined, 'ten_anviet');
    await expectAppError(app.connections.list(viewer), 'FORBIDDEN');
    await expectAppError(
      app.connections.connect(viewer, { provider: 'SEPAY', credentials: { apiToken: TOKEN } }),
      'FORBIDDEN',
    );
    const err = await app.connections
      .connect(admin, { provider: 'SEPAY', credentials: { apiToken: TOKEN } })
      .catch((e: Error) => e);
    expect((err as Error).message).toMatch(/máy chủ ARGOLET/);
    expect((await app.connections.list(admin)).serverReady).toBe(false);
    await expectAppError(app.connections.connect(admin, { provider: 'IPOS', credentials: {} }), 'VALIDATION');
  });
});
