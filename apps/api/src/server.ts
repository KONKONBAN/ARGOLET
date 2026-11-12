import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { AppError, ConcurrencyError, operations, type ArgoletApp, type CallContext, type OperationDef, DEMO_EMAIL, DEMO_PASSWORD } from '@argolet/app';
import type { ApiConfig } from './config';

export const SESSION_COOKIE = 'argolet_session';
export const CSRF_HEADER = 'x-argolet-request';
export const VERSION = '0.1.0';

export interface ServerDeps {
  app: ArgoletApp;
  config: ApiConfig;
  storeKind: string;
  logger?: boolean;
}

function callContext(req: FastifyRequest): CallContext {
  const auth = req.headers.authorization;
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const cookieToken = req.cookies?.[SESSION_COOKIE] ?? null;
  return {
    sessionToken: bearer || cookieToken,
    ip: req.ip,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    channel: req.headers['x-argolet-client'] === 'mobile' ? 'mobile' : 'web',
    correlationId: String(req.headers['x-correlation-id'] ?? req.id),
  };
}

function sendError(reply: FastifyReply, err: unknown, req: FastifyRequest) {
  if (err instanceof AppError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ConcurrencyError) {
    return reply.status(409).send({ error: { code: 'CONFLICT', message: err.message } });
  }
  const e = err as { statusCode?: number; message?: string; validation?: unknown; code?: string };
  if (e.statusCode === 429) return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút' } });
  if (e.statusCode === 413) return reply.status(413).send({ error: { code: 'VALIDATION', message: 'Tệp tải lên quá lớn' } });
  if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
    return reply.status(e.statusCode).send({ error: { code: 'VALIDATION', message: 'Yêu cầu không hợp lệ' } });
  }
  req.log.error({ err }, 'unhandled error');
  return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Đã xảy ra lỗi, vui lòng thử lại' } });
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { app, config } = deps;
  const server = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 32 * 1024 * 1024,
    trustProxy: config.trustProxy,
    genReqId: () => `req_${Math.random().toString(36).slice(2, 12)}`,
  });

  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await server.register(cookie);
  if (config.corsOrigins.length) {
    await server.register(cors, { origin: config.corsOrigins, credentials: true, allowedHeaders: ['content-type', 'authorization', CSRF_HEADER, 'x-argolet-client', 'x-correlation-id'] });
  }
  await server.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });

  server.setErrorHandler((err, req, reply) => sendError(reply, err, req));
  // Accept an empty JSON body as {} (e.g. POST /v1/auth/logout).
  server.removeContentTypeParser('application/json');
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Invalid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  // CSRF: every state-changing request must carry a custom header (blocked cross-site by CORS).
  server.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.url.startsWith('/v1/') && req.headers[CSRF_HEADER] !== '1') {
      return reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Thiếu tiêu đề bảo vệ CSRF' } });
    }
  });

  server.get('/healthz', async () => ({ ok: true, version: VERSION, store: deps.storeKind }));
  server.get('/v1/meta', async () => ({
    name: 'ARGOLET',
    version: VERSION,
    store: deps.storeKind,
    assistant: app.deps.llm ? app.deps.llm.name : 'rules',
    extraction: app.deps.extraction.modelVersion,
    demo: config.demoSeed ? { email: DEMO_EMAIL, password: DEMO_PASSWORD, clock: config.demoClock } : null,
    now: app.core.now(),
  }));

  for (const [name, def] of Object.entries(operations) as [string, OperationDef<Record<string, unknown>, unknown>][]) {
    const isAuth = name.startsWith('auth.');
    server.route({
      method: def.method,
      url: def.path,
      config: { rateLimit: isAuth && def.method !== 'GET' ? { max: 30, timeWindow: '1 minute' } : undefined },
      handler: async (req, reply) => {
        const call = callContext(req);
        const params: Record<string, unknown> = {
          ...((def.method === 'GET' || def.method === 'DELETE') ? (req.query as Record<string, unknown>) : ((req.body as Record<string, unknown>) ?? {})),
          ...(req.params as Record<string, unknown>),
        };
        if (params.limit !== undefined && typeof params.limit === 'string') params.limit = Number(params.limit);
        const result = (await def.handler(app, call, params)) as Record<string, unknown> | null;
        if (def.session === 'issue' && result && typeof result.token === 'string') {
          const session = result.session as { expiresAt: string } | undefined;
          // Session expiry is in application time (which may be the shifted demo clock), so the
          // cookie gets a relative Max-Age instead of an absolute Expires in that timeline.
          const maxAge = session ? Math.max(0, Math.floor((Date.parse(session.expiresAt) - app.core.deps.clock().getTime()) / 1000)) : undefined;
          reply.setCookie(SESSION_COOKIE, result.token, {
            httpOnly: true,
            secure: config.cookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge,
          });
          if (call.channel !== 'mobile') {
            const { token: _omit, ...rest } = result;
            void _omit;
            return rest;
          }
        }
        if (def.session === 'clear') reply.clearCookie(SESSION_COOKIE, { path: '/' });
        return result ?? null;
      },
    });
  }

  if (config.webDist) {
    await server.register(fastifyStatic, { root: config.webDist, prefix: '/', index: ['index.html'], maxAge: '1h', immutable: false });
    server.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/') && String(req.headers.accept ?? '').includes('text/html')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } });
    });
  } else {
    server.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }));
  }

  // Outbox relay safety net (events committed but not yet published, e.g. after a crash).
  const timer = setInterval(() => {
    app.core.relay.drain().catch((err) => server.log.error({ err }, 'outbox relay failed'));
  }, 5000);
  timer.unref();
  server.addHook('onClose', async () => clearInterval(timer));
  return server;
}
