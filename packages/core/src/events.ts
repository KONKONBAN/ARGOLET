import { newId } from './ids';

/**
 * Domain events, transactional outbox and idempotent consumers (board 07 / 10 / 12).
 * Envelope fields follow "Event envelope bắt buộc" + "Truy vết và payload".
 * Payloads carry references (data_ref / data_version), never raw PII.
 */
export type EventType =
  | 'UserRegistered'
  | 'TenantCreated'
  | 'MemberInvited'
  | 'BatchReceived'
  | 'DocumentExtracted'
  | 'DocumentValidated'
  | 'ReconciliationProposed'
  | 'MatchResolved'
  | 'ApprovalRequested'
  | 'ApprovalGranted'
  | 'ApprovalRejected'
  | 'PeriodClosed'
  | 'EvidenceAnchored'
  | 'CalcRunCompleted'
  | 'ModuleRecordChanged';

export interface DomainEvent<T = Record<string, unknown>> {
  eventId: string;
  type: EventType;
  tenantId: string;
  entityId: string | null;
  aggregateType: string;
  aggregateId: string;
  aggregateSeq: number;
  schemaVersion: number;
  occurredAt: string;
  correlationId: string;
  causationId: string | null;
  actorId: string | null;
  dataRef: string;
  dataVersion: number;
  data: T;
}

export function createEvent<T extends Record<string, unknown>>(
  e: Omit<DomainEvent<T>, 'eventId' | 'schemaVersion' | 'occurredAt'> & {
    occurredAt?: string;
    schemaVersion?: number;
  },
): DomainEvent<T> {
  return {
    ...e,
    eventId: newId('evt'),
    schemaVersion: e.schemaVersion ?? 1,
    occurredAt: e.occurredAt ?? new Date().toISOString(),
  };
}

const PII_KEYS = /^(email|phone|password|passwordHash|token|otp|fullName|address|taxCode)$/i;

/** Guard: refuse to put raw PII into the broker / logs. */
export function assertNoPii(data: unknown, path = 'data'): void {
  if (data && typeof data === 'object') {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (PII_KEYS.test(k)) throw new Error(`Không đưa PII thô vào sự kiện: ${path}.${k}`);
      assertNoPii(v, `${path}.${k}`);
    }
  }
}

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

/** In-process broker partitioned by tenant + aggregate. */
export class EventBroker {
  private handlers = new Map<string, { consumer: string; handler: EventHandler }[]>();

  subscribe(type: EventType | '*', consumer: string, handler: EventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push({ consumer, handler });
    this.handlers.set(type, list);
  }

  consumersFor(type: EventType): { consumer: string; handler: EventHandler }[] {
    return [...(this.handlers.get(type) ?? []), ...(this.handlers.get('*') ?? [])];
  }
}

/** Inbox for idempotent consumption: (event_id, consumer) processed at most once. */
export class Inbox {
  private seen = new Set<string>();
  constructor(initial: string[] = []) {
    initial.forEach((k) => this.seen.add(k));
  }
  has(eventId: string, consumer: string): boolean {
    return this.seen.has(`${consumer}:${eventId}`);
  }
  mark(eventId: string, consumer: string): void {
    this.seen.add(`${consumer}:${eventId}`);
  }
  keys(): string[] {
    return [...this.seen];
  }
}

/** Order guard per aggregate: only apply seq = last + 1 (out-of-order events are deferred). */
export function isNextInSequence(lastSeq: number | undefined, event: DomainEvent): boolean {
  return event.aggregateSeq === (lastSeq ?? 0) + 1;
}
