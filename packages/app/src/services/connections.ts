/**
 * ARGOLET's connections to partners' APIs. Credentials are sealed with the server key and never
 * leave the server; every test and sync is logged; synced data enters through the same intake as
 * an uploaded file (import batch, SHA-256 of the verbatim partner response, document, recon).
 */
import {
  newId,
  readKiotVietInvoices,
  readSepayTransactions,
  type ConnectorProvider,
  type ConnectorSnapshot,
} from '@argolet/core';
import { fetchProvider, PROVIDERS, testProvider, type ProviderCredentials } from '../connectors';
import { type AppCore, actor, periodOf, requireFound, requireText } from '../core';
import { AppError, type CallContext } from '../runtime';
import type { ConnectionRow, ConnectionRunRow } from '../types';
import type { DocumentService } from './documents';

const isProvider = (p: unknown): p is ConnectorProvider => p === 'SEPAY' || p === 'KIOTVIET';

/** Rows of a snapshot not received before (same reading as the intake). */
function newCodes(s: ConnectorSnapshot): number {
  const known = new Set(s.alreadyImported ?? []);
  const codes =
    s.provider === 'SEPAY'
      ? readSepayTransactions(s.pages).map((t) => t.reference)
      : readKiotVietInvoices(s.pages).sales.map((x) => x.code);
  return codes.filter((c) => !known.has(c)).length;
}

function publicConnection(c: ConnectionRow) {
  return {
    id: c.id,
    provider: c.provider,
    label: c.label,
    status: c.status,
    config: c.config,
    secretHint: c.secretHint,
    entityId: c.entityId,
    connectedByName: c.connectedByName,
    connectedAt: c.connectedAt,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    cursor: c.cursor,
  };
}

function publicRun(r: ConnectionRunRow) {
  return {
    id: r.id,
    trigger: r.trigger,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    fetched: r.fetched,
    imported: r.imported,
    requests: r.requests,
    documentId: r.documentId,
    documentCode: r.documentCode,
    message: r.message,
    actorName: r.actorName,
  };
}

export class ConnectionService {
  /** One sync at a time per connection (a second click waits for nothing and is refused). */
  private readonly running = new Set<string>();

  constructor(
    private readonly core: AppCore,
    private readonly documents: DocumentService,
  ) {}

  async list(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const conns = (await tx.list('connections', ws.tenantId)).sort((a, b) =>
        b.connectedAt.localeCompare(a.connectedAt),
      );
      const runs = (await tx.list('connectionRuns', ws.tenantId)).sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
      return {
        serverReady: !!this.core.deps.secrets && !!this.core.deps.http,
        providers: PROVIDERS,
        connections: conns.map((c) => ({
          ...publicConnection(c),
          runs: runs
            .filter((r) => r.connectionId === c.id)
            .slice(0, 10)
            .map(publicRun),
        })),
      };
    });
  }

  private async record(
    call: CallContext,
    conn: ConnectionRow,
    run: Omit<
      ConnectionRunRow,
      | 'id'
      | 'tenantId'
      | 'createdAt'
      | 'updatedAt'
      | 'rev'
      | 'connectionId'
      | 'provider'
      | 'actorId'
      | 'actorName'
    >,
    patch: Partial<ConnectionRow>,
  ) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call);
      const current = requireFound(await tx.get('connections', ws.tenantId, conn.id), 'kết nối');
      await tx.put('connections', { ...current, ...patch });
      const row = await tx.put('connectionRuns', {
        ...run,
        id: newId('crun'),
        tenantId: ws.tenantId,
        connectionId: conn.id,
        provider: conn.provider,
        actorId: ws.user.id,
        actorName: actor(ws).name,
      });
      await em.audit(
        ws.tenantId,
        actor(ws),
        `connection.${run.trigger.toLowerCase()}`,
        conn.label,
        `${run.status}: ${run.message}`.slice(0, 500),
      );
      return publicRun(row);
    });
  }

  /** Tests the credentials with the partner, then stores them sealed. */
  async connect(
    call: CallContext,
    p: { provider: string; credentials: ProviderCredentials; label?: string; entityId?: string },
  ) {
    if (!isProvider(p.provider)) throw new AppError('VALIDATION', 'Đối tác chưa được hỗ trợ kết nối');
    const provider = p.provider;
    const info = PROVIDERS.find((x) => x.provider === provider)!;
    // Permission and site are checked before any call leaves the server.
    const ws = await this.core.query((tx) => this.core.requireWorkspace(tx, call, 'settings.manage'));
    const entityId =
      p.entityId && p.entityId !== '*'
        ? p.entityId
        : await this.core.query(async (tx) => {
            const sites = (await tx.list('entities', ws.tenantId)).filter((e) => e.kind === 'SITE');
            return sites[0]?.id ?? ws.tenantId;
          });
    const creds: ProviderCredentials = {};
    for (const f of info.fields) creds[f.key] = String(p.credentials?.[f.key] ?? '').trim();
    const startedAt = this.core.now();
    const test = await testProvider(this.core.deps, provider, creds);
    const secrets = this.core.deps.secrets!;
    const sealed = await secrets.seal(
      JSON.stringify(
        Object.fromEntries(info.fields.filter((f) => f.secret).map((f) => [f.key, creds[f.key]])),
      ),
    );
    const firstSecret = creds[info.fields.find((f) => f.secret)!.key]!;
    const config = Object.fromEntries(
      info.fields.filter((f) => !f.secret).map((f) => [f.key, creds[f.key]!]),
    );
    const label = p.label?.trim()
      ? requireText(p.label, 'Tên kết nối', 80)
      : `${info.name}${config.retailer ? `, ${config.retailer}` : ''}`;
    const conn = await this.core.command(call, async (tx, em, now) => {
      const w = await this.core.requireWorkspace(tx, call, 'settings.manage', { entityId });
      requireFound(await tx.get('entities', w.tenantId, entityId), 'cơ sở');
      const row = await tx.put('connections', {
        id: newId('conn'),
        tenantId: w.tenantId,
        provider,
        label,
        status: 'ACTIVE',
        config,
        secretSealed: sealed,
        secretHint: firstSecret.length > 8 ? `đuôi ${firstSecret.slice(-4)}` : 'đã ẩn',
        cursor: null,
        entityId,
        connectedBy: w.user.id,
        connectedByName: actor(w).name,
        connectedAt: now,
        lastSyncAt: null,
        lastError: null,
      });
      await em.audit(w.tenantId, actor(w), 'connection.create', label, info.name);
      return row;
    });
    const run = await this.record(
      call,
      conn,
      {
        trigger: 'TEST',
        startedAt,
        finishedAt: this.core.now(),
        status: 'SUCCESS',
        fetched: 0,
        imported: 0,
        requests: test.requests,
        documentId: null,
        documentCode: null,
        message: test.detail,
      },
      {},
    );
    return { connection: publicConnection(conn), run };
  }

  private async load(call: CallContext, connectionId: string, action: 'settings.manage' | 'document.create') {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const conn = requireFound(await tx.get('connections', ws.tenantId, connectionId), 'kết nối');
      if (action === 'document.create')
        await this.core.requireWorkspace(tx, call, 'document.create', { entityId: conn.entityId });
      return conn;
    });
  }

  private async credentials(conn: ConnectionRow): Promise<ProviderCredentials> {
    if (conn.status === 'DISCONNECTED' || !conn.secretSealed)
      throw new AppError('CONFLICT', 'Kết nối đã ngắt, kết nối lại để tiếp tục');
    if (!this.core.deps.secrets)
      throw new AppError('VALIDATION', 'Máy chủ chưa cấu hình khóa giải mã (ARGOLET_SECRET_KEY)');
    let secret: ProviderCredentials;
    try {
      secret = JSON.parse(await this.core.deps.secrets.open(conn.secretSealed)) as ProviderCredentials;
    } catch {
      throw new AppError(
        'VALIDATION',
        'Không giải mã được khóa đã lưu, khóa máy chủ đã đổi? Hãy kết nối lại',
      );
    }
    return { ...conn.config, ...secret };
  }

  async test(call: CallContext, p: { connectionId: string }) {
    const conn = await this.load(call, p.connectionId, 'settings.manage');
    const startedAt = this.core.now();
    try {
      const r = await testProvider(this.core.deps, conn.provider, await this.credentials(conn));
      return await this.record(
        call,
        conn,
        {
          trigger: 'TEST',
          startedAt,
          finishedAt: this.core.now(),
          status: 'SUCCESS',
          fetched: 0,
          imported: 0,
          requests: r.requests,
          documentId: null,
          documentCode: null,
          message: r.detail,
        },
        { status: 'ACTIVE', lastError: null },
      );
    } catch (e) {
      return this.fail(call, conn, 'TEST', startedAt, e);
    }
  }

  private async fail(
    call: CallContext,
    conn: ConnectionRow,
    trigger: 'TEST' | 'MANUAL',
    startedAt: string,
    e: unknown,
  ): Promise<never> {
    if (!(e instanceof AppError) || e.code !== 'VALIDATION') throw e;
    await this.record(
      call,
      conn,
      {
        trigger,
        startedAt,
        finishedAt: this.core.now(),
        status: 'FAILED',
        fetched: 0,
        imported: 0,
        requests: 0,
        documentId: null,
        documentCode: null,
        message: e.message,
      },
      { status: 'ERROR', lastError: e.message },
    );
    throw e;
  }

  /** Pulls what is new since the last sync and receives it as a document. */
  async sync(call: CallContext, p: { connectionId: string }) {
    const conn = await this.load(call, p.connectionId, 'document.create');
    if (this.running.has(conn.id)) throw new AppError('CONFLICT', 'Kết nối này đang đồng bộ');
    this.running.add(conn.id);
    const startedAt = this.core.now();
    try {
      const creds = await this.credentials(conn);
      // First sync: from the start of the current period.
      const since = `${periodOf(startedAt.slice(0, 10))}-01`;
      const r = await fetchProvider(this.core.deps, conn.provider, creds, conn.cursor, since);
      const alreadyImported = await this.core.query(async (tx) => {
        const docs = await tx.list('documents', conn.tenantId, {
          sourceKind: conn.provider === 'SEPAY' ? 'BANK' : 'POS',
        });
        return [
          ...new Set(docs.filter((d) => d.status !== 'REJECTED').flatMap((d) => d.rows.map((x) => x.code))),
        ];
      });
      const snapshot = { ...r.snapshot, alreadyImported };
      let documentId: string | null = null;
      let documentCode: string | null = null;
      let imported = 0;
      let message: string;
      const fresh = newCodes(snapshot);
      if (r.fetched === 0) message = 'Không có dữ liệu mới từ đối tác';
      else if (fresh === 0) message = `Nhận ${r.fetched} bản ghi, tất cả đã được ghi nhận ở lần trước`;
      else {
        const stamp = startedAt.slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
        const name = `${conn.provider === 'SEPAY' ? 'sepay-giao-dich' : 'kiotviet-hoa-don'}-${stamp}.json`;
        const batch = await this.documents.intake(call, {
          entityId: conn.entityId,
          location: `API ${conn.label}`,
          files: [{ name, mime: 'application/json', text: JSON.stringify(snapshot) }],
        });
        const file = batch.files[0]!;
        if (file.documentId) {
          documentId = file.documentId;
          documentCode = file.code;
          imported = fresh;
          message = `Nhận ${r.fetched} bản ghi, ghi nhận ${imported} dòng mới vào ${file.code}`;
        } else message = 'Dữ liệu trùng với lần nhận trước';
      }
      return await this.record(
        call,
        conn,
        {
          trigger: 'MANUAL',
          startedAt,
          finishedAt: this.core.now(),
          status: imported > 0 ? 'SUCCESS' : 'NO_CHANGE',
          fetched: r.fetched,
          imported,
          requests: r.requests,
          documentId,
          documentCode,
          message,
        },
        { cursor: r.nextCursor, lastSyncAt: this.core.now(), status: 'ACTIVE', lastError: null },
      );
    } catch (e) {
      return this.fail(call, conn, 'MANUAL', startedAt, e);
    } finally {
      this.running.delete(conn.id);
    }
  }

  /** Forgets the credentials (the history and the documents already received stay). */
  async disconnect(call: CallContext, p: { connectionId: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const conn = requireFound(await tx.get('connections', ws.tenantId, p.connectionId), 'kết nối');
      const row = await tx.put('connections', { ...conn, status: 'DISCONNECTED', secretSealed: null });
      await em.audit(ws.tenantId, actor(ws), 'connection.disconnect', conn.label);
      return publicConnection(row);
    });
  }
}
