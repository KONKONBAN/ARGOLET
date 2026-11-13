/**
 * Real email delivery: the API talks SMTP to a local mail server. Codes are not exposed in
 * responses when a mail server is configured; users read them from their mailbox.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config';
import { createRuntime, type Runtime } from '../src/bootstrap';
import { buildServer, CSRF_HEADER, SESSION_COOKIE } from '../src/server';

interface Mail {
  to: string[];
  raw: string;
}
const inbox: Mail[] = [];
let smtp: SMTPServer;
let smtpPort = 0;
let server: FastifyInstance;
let rt: Runtime;
const H = { [CSRF_HEADER]: '1', 'content-type': 'application/json' };

/** Decodes quoted-printable / base64 bodies enough to find codes and links. */
function text(raw: string): string {
  const qp = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  const b64 = [...raw.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{40,})/g)].map((m) => {
    try {
      return Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      return '';
    }
  });
  return Buffer.from([qp, ...b64].join('\n'), 'latin1').toString('utf8');
}

beforeAll(async () => {
  smtp = new SMTPServer({
    secure: false,
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        inbox.push({
          to: session.envelope.rcptTo.map((r) => r.address),
          raw: Buffer.concat(chunks).toString('latin1'),
        });
        cb();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', () => resolve()));
  smtpPort = (smtp.server.address() as AddressInfo).port;
  const config = {
    ...loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite:memory',
      DEMO_SEED: 'false',
      SMTP_URL: `smtp://127.0.0.1:${smtpPort}`,
      MAIL_FROM: 'ARGOLET <no-reply@argolet.test>',
      PUBLIC_BASE_URL: 'https://app.argolet.test',
    }),
    webDist: null,
  };
  expect(config.exposeDevCodes).toBe(false);
  rt = await createRuntime(config, () => undefined);
  server = await buildServer({ app: rt.app, config, storeKind: rt.store.kind });
}, 180_000);

afterAll(async () => {
  await server?.close();
  await rt?.store.close();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
});

const lastMailTo = (addr: string) => [...inbox].reverse().find((m) => m.to.includes(addr));

describe('email delivery over SMTP', () => {
  it('sends the verification code by email and never returns it in the response', async () => {
    const reg = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: H,
      payload: {
        fullName: 'Phạm Thị Lan',
        contact: 'lan@cuahang.vn',
        password: 'Mat-khau-that-dai-2026',
        acceptTerms: true,
      },
    });
    expect(reg.statusCode).toBe(200);
    expect(reg.json().devCode).toBeUndefined();
    const mail = lastMailTo('lan@cuahang.vn');
    expect(mail).toBeDefined();
    const body = text(mail!.raw);
    expect(body).toContain('Mã xác minh tài khoản ARGOLET');
    const code = /\b(\d{6})\b/.exec(body)?.[1];
    expect(code).toMatch(/^\d{6}$/);

    const v = await server.inject({
      method: 'POST',
      url: '/v1/auth/verify',
      headers: H,
      payload: { contact: 'lan@cuahang.vn', code },
    });
    expect(v.statusCode).toBe(200);
    const cookie = String(v.headers['set-cookie']).split(';')[0]!;
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    // The new owner invites a colleague: the invitation is emailed with code and link.
    const org = await server.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { ...H, cookie },
      payload: { name: 'Cửa hàng Lan', orgType: 'Hộ kinh doanh' },
    });
    expect(org.statusCode).toBe(200);
    const inv = await server.inject({
      method: 'POST',
      url: '/v1/members/invitations',
      headers: { ...H, cookie },
      payload: { email: 'ketoan@cuahang.vn', role: 'ACCOUNTANT' },
    });
    expect(inv.statusCode).toBe(200);
    const invMail = text(lastMailTo('ketoan@cuahang.vn')!.raw);
    expect(invMail).toContain(inv.json().code);
    expect(invMail).toContain('https://app.argolet.test/#/invite?code=');
    expect(invMail).toContain('Cửa hàng Lan');
  });

  it('emails password-reset codes', async () => {
    const before = inbox.length;
    const r = await server.inject({
      method: 'POST',
      url: '/v1/auth/password-reset',
      headers: H,
      payload: { contact: 'lan@cuahang.vn' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().devCode).toBeUndefined();
    expect(inbox.length).toBe(before + 1);
    const code = /\b(\d{6})\b/.exec(text(lastMailTo('lan@cuahang.vn')!.raw))?.[1];
    const done = await server.inject({
      method: 'POST',
      url: '/v1/auth/password-reset/confirm',
      headers: H,
      payload: { contact: 'lan@cuahang.vn', code, newPassword: 'Mat-khau-moi-that-dai-2027' },
    });
    expect(done.statusCode).toBe(200);
    const login = await server.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: H,
      payload: { contact: 'lan@cuahang.vn', password: 'Mat-khau-moi-that-dai-2027' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('asks for an email address when only a phone number is given (no SMS gateway)', async () => {
    const r = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: H,
      payload: {
        fullName: 'Ngô Văn Tư',
        contact: '0901234567',
        password: 'Mat-khau-that-dai-2026',
        acceptTerms: true,
      },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toContain('email');
  });

  it('reports a temporary failure when the mail server is down, and nothing is half-created', async () => {
    await new Promise<void>((resolve) => smtp.close(() => resolve()));
    const r = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: H,
      payload: {
        fullName: 'Đỗ Minh',
        contact: 'minh@cuahang.vn',
        password: 'Mat-khau-that-dai-2026',
        acceptTerms: true,
      },
    });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.message).toContain('Chưa gửi được email');
    // mail server back: the same address can register normally
    smtp = new SMTPServer({
      secure: false,
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      onData(stream, session, cb) {
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => {
          inbox.push({
            to: session.envelope.rcptTo.map((x) => x.address),
            raw: Buffer.concat(chunks).toString('latin1'),
          });
          cb();
        });
      },
    });
    await new Promise<void>((resolve) => smtp.listen(smtpPort, '127.0.0.1', () => resolve()));
    const again = await server.inject({
      method: 'POST',
      url: '/v1/auth/register',
      headers: H,
      payload: {
        fullName: 'Đỗ Minh',
        contact: 'minh@cuahang.vn',
        password: 'Mat-khau-that-dai-2026',
        acceptTerms: true,
      },
    });
    expect(again.statusCode).toBe(200);
    expect(lastMailTo('minh@cuahang.vn')).toBeDefined();
  }, 60_000);
});
