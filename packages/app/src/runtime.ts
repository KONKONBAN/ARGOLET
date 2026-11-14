import {
  assertNoPii,
  createEvent,
  EventBroker,
  newId,
  SimulatedFabricLedger,
  type AccessContext,
  type DomainEvent,
  type EventType,
  type ExtractionProvider,
  type LedgerGateway,
  type LedgerState,
  type RoleBinding,
} from '@argolet/core';
import type { Store, Tx } from './store';
import { GLOBAL, type MembershipRow, type SessionRow, type UserRow } from './types';

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'STEP_UP_REQUIRED'
  | 'NO_WORKSPACE'
  | 'UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  STEP_UP_REQUIRED: 403,
  NO_WORKSPACE: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface InvitationMessage {
  organization: string;
  inviter: string;
  roleLabel: string;
  code: string;
  link: string;
}

export interface Notifier {
  /** Deliver a one-time code (verification, password reset, step-up). */
  sendCode(to: string, purpose: string, code: string): Promise<void>;
  /** Optional: deliver an invitation to join an organisation. */
  sendInvitation?(to: string, invitation: InvitationMessage): Promise<void>;
}

export interface LlmClient {
  readonly name: string;
  /** Runs a tool-using conversation and returns the final assistant text + the tool calls made. */
  run(input: LlmRunInput): Promise<{
    text: string;
    toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[];
  }>;
}

export interface LlmRunInput {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  callTool: (name: string, input: Record<string, unknown>) => Promise<unknown>;
}

export interface AppConfig {
  /** Secret used to hash OTP / reset tokens. */
  pepper: string;
  /** Development / demo mode: one-time codes are returned to the client for display. */
  exposeDevCodes: boolean;
  sessionTtlHours: number;
  rememberTtlDays: number;
  otpTtlMinutes: number;
  resendCooldownSeconds: number;
  maxFailedLogins: number;
  publicBaseUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  pepper: 'argolet-dev-pepper-change-me',
  exposeDevCodes: true,
  sessionTtlHours: 12,
  rememberTtlDays: 30,
  otpTtlMinutes: 10,
  resendCooldownSeconds: 30,
  maxFailedLogins: 8,
  publicBaseUrl: 'http://localhost:5173',
};

/**
 * Seals partners' credentials with the server key (AES-256-GCM) before they are stored. Absent
 * where no server key exists (the in-browser app), which keeps partner keys off the browser.
 */
export interface SecretBox {
  seal(plaintext: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

/** Minimal fetch used to call partners' APIs (server side only). */
export type HttpFetch = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export interface AppDeps {
  store: Store;
  hasher: PasswordHasher;
  notifier: Notifier;
  extraction: ExtractionProvider;
  llm: LlmClient | null;
  clock: () => Date;
  config: AppConfig;
  secrets: SecretBox | null;
  http: HttpFetch | null;
  /** Partner API base URLs (tests point them to a local stand-in); defaults to the real ones. */
  connectorEndpoints: Partial<Record<'SEPAY' | 'KIOTVIET' | 'KIOTVIET_TOKEN', string>>;
  /** Pause between partner requests and before a 429 retry (tests set 0). */
  connectorPaceMs: number;
}

/** Caller identity as seen by the transport (cookie / bearer). */
export interface CallContext {
  sessionToken?: string | null | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  channel?: 'web' | 'mobile' | undefined;
  correlationId?: string | undefined;
}

export interface AuthState {
  session: SessionRow;
  user: UserRow;
}

export interface WorkspaceState extends AuthState {
  tenantId: string;
  membership: MembershipRow;
  access: AccessContext;
  /** Selected scope: a site / legal entity id or '*'. */
  entityId: string;
}

export function accessContext(
  user: UserRow,
  tenantId: string,
  bindings: RoleBinding[],
  session: SessionRow,
  now: string,
): AccessContext {
  return { userId: user.id, tenantId, bindings, aal: session.aal, now };
}

/** Per-request helper that owns the transaction-scoped event buffer. */
export class Emitter {
  readonly events: DomainEvent[] = [];
  constructor(
    private readonly tx: Tx,
    private readonly now: string,
    private readonly correlationId: string,
  ) {}

  async emit(params: {
    type: EventType;
    tenantId: string;
    entityId: string | null;
    aggregateType: string;
    aggregateId: string;
    actorId: string | null;
    dataRef: string;
    dataVersion: number;
    data: Record<string, unknown>;
    causationId?: string | null;
  }): Promise<DomainEvent> {
    assertNoPii(params.data);
    const seqKey = `${params.aggregateType}:${params.aggregateId}`;
    const seqRow = await this.tx.get('aggregateSeqs', params.tenantId, seqKey);
    const seq = (seqRow?.seq ?? 0) + 1;
    await this.tx.put('aggregateSeqs', { id: seqKey, tenantId: params.tenantId, seq });
    const event = createEvent({
      type: params.type,
      tenantId: params.tenantId,
      entityId: params.entityId,
      aggregateType: params.aggregateType,
      aggregateId: params.aggregateId,
      aggregateSeq: seq,
      correlationId: this.correlationId,
      causationId: params.causationId ?? null,
      actorId: params.actorId,
      dataRef: params.dataRef,
      dataVersion: params.dataVersion,
      data: params.data,
      occurredAt: this.now,
    });
    await this.tx.put('outbox', { id: event.eventId, tenantId: params.tenantId, event, publishedAt: null });
    this.events.push(event);
    return event;
  }

  async audit(
    tenantId: string,
    actor: { id: string; name: string },
    action: string,
    target: string,
    detail = '',
  ): Promise<void> {
    await this.tx.put('audit', {
      id: newId('aud'),
      tenantId,
      actorId: actor.id,
      actorName: actor.name,
      action,
      target,
      detail,
      correlationId: this.correlationId,
    });
  }
}

/** Ledger persisted in the store (global network shared by tenants). */
export class StoredLedger implements LedgerGateway {
  readonly networkName = 'Hyperledger Fabric (mô phỏng có cấp quyền)';
  constructor(
    private readonly tx: Tx,
    private readonly clock: () => Date,
  ) {}

  private async load(): Promise<SimulatedFabricLedger> {
    const row = await this.tx.get('ledger', GLOBAL, 'fabric');
    return new SimulatedFabricLedger(undefined, undefined, row?.state as LedgerState | undefined, this.clock);
  }

  private async save(l: SimulatedFabricLedger): Promise<void> {
    await this.tx.put('ledger', { id: 'fabric', tenantId: GLOBAL, state: l.snapshot() });
  }

  async submit(req: Parameters<LedgerGateway['submit']>[0]) {
    const l = await this.load();
    const r = await l.submit(req);
    await this.save(l);
    return r;
  }

  async getTransaction(txId: string) {
    return (await this.load()).getTransaction(txId);
  }

  async readRoot(batchRef: string) {
    return (await this.load()).readRoot(batchRef);
  }

  async verifyChain(): Promise<boolean> {
    return (await this.load()).verifyChain();
  }
}

export type Consumer = (event: DomainEvent, tx: Tx, emitter: Emitter) => Promise<void>;

/** Outbox relay → broker → idempotent consumers (projections, notifications, evidence). */
export class OutboxRelay {
  readonly broker = new EventBroker();
  private consumers = new Map<string, Consumer>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly clock: () => Date,
  ) {}

  on(type: EventType | '*', consumer: string, handler: Consumer): void {
    this.consumers.set(consumer, handler);
    this.broker.subscribe(type, consumer, () => undefined);
  }

  /** Publish every committed, unpublished outbox event. Safe to call repeatedly. */
  async drain(): Promise<number> {
    if (this.running) {
      await this.running;
    }
    let published = 0;
    const run = async () => {
      for (let round = 0; round < 10; round++) {
        const pending = await this.store.read((tx) => tx.findGlobal('outbox', { publishedAt: null }));
        if (pending.length === 0) break;
        pending.sort(
          (a, b) =>
            a.event.occurredAt.localeCompare(b.event.occurredAt) ||
            a.event.aggregateSeq - b.event.aggregateSeq,
        );
        for (const row of pending) {
          await this.store.transaction(async (tx) => {
            const now = this.clock().toISOString();
            const emitter = new Emitter(tx, now, row.event.correlationId);
            for (const { consumer } of this.broker.consumersFor(row.event.type)) {
              const inboxId = `${consumer}:${row.event.eventId}`;
              if (await tx.get('inbox', row.tenantId, inboxId)) continue;
              await this.consumers.get(consumer)!(row.event, tx, emitter);
              await tx.put('inbox', {
                id: inboxId,
                tenantId: row.tenantId,
                consumer,
                eventId: row.event.eventId,
              });
            }
            const fresh = await tx.get('outbox', row.tenantId, row.id);
            if (fresh && !fresh.publishedAt) await tx.put('outbox', { ...fresh, publishedAt: now });
          });
          published++;
        }
      }
    };
    this.running = run();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
    return published;
  }
}
