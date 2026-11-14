import type { BaseRow, CollectionName, Collections } from '@argolet/app';

/**
 * How every collection of the application maps onto the relational schema
 * (migrations/0001_relational_schema.ts). The mapped types make the compiler check that
 * every field of every row type has a column, that the column kind fits the field's type
 * and that nullable / optional fields are declared as such; a database test checks the
 * same mapping against the live schema (column names, SQL types and NOT NULL).
 */

export type ColumnKind =
  'text' | 'int' | 'bigint' | 'real' | 'numeric' | 'bool' | 'timestamp' | 'date' | 'json' | 'textArray';

export interface Column {
  kind: ColumnKind;
  /** SQL column name; defaults to the snake_case field name. */
  name?: string;
  /** `null` is a valid value of the field (stored as SQL NULL, read back as null). */
  nullable?: true;
  /** The field may be absent (stored as SQL NULL, omitted when read back). */
  optional?: true;
  /** A string field where '' means "not applicable" (stored as SQL NULL, read back as ''). */
  blankAsNull?: true;
}

type KindFor<T> = [T] extends [boolean]
  ? 'bool'
  : [T] extends [number]
    ? 'int' | 'bigint' | 'real'
    : [T] extends [string]
      ? 'text' | 'numeric' | 'timestamp' | 'date'
      : [T] extends [string[]]
        ? 'textArray' | 'json'
        : 'json';

/** `unknown` payloads (calculation inputs/results) are free-form JSON that may be null. */
type ColumnFor<T> = unknown extends T
  ? { kind: 'json'; name?: string; nullable: true; optional?: never }
  : { kind: KindFor<NonNullable<T>>; name?: string; blankAsNull?: true } & (null extends T
      ? { nullable: true }
      : { nullable?: never }) &
      (undefined extends T ? { optional: true } : { optional?: never });

export type FieldName<K extends CollectionName> = Exclude<keyof Collections[K], keyof BaseRow> & string;

/**
 * - tenant: tenant-owned rows, primary key (tenant_id, id), tenant_id references tenants.
 * - global: platform-wide identity rows (tenantId is always '_global'), primary key (id).
 * - self:   the tenants table itself (tenantId = id), primary key (id).
 * - mixed:  event plumbing that is either platform-wide or tenant-owned, key (tenant_id, id).
 */
export type TableScope = 'tenant' | 'global' | 'self' | 'mixed';

export interface TableDef<K extends CollectionName> {
  table: string;
  scope: TableScope;
  columns: { [F in FieldName<K>]-?: ColumnFor<Collections[K][F]> };
}

type Opts = Omit<Column, 'kind'>;
/** NoInfer: the options must come from the argument, never from the expected column type. */
const make =
  <K extends ColumnKind>(kind: K) =>
  <O extends Opts = object>(o?: O) =>
    ({ kind, ...o }) as { kind: K } & NoInfer<O>;

const text = make('text');
const int = make('int');
const bigint = make('bigint');
const real = make('real');
const numeric = make('numeric');
const bool = make('bool');
const ts = make('timestamp');
const date = make('date');
const json = make('json');
const textArray = make('textArray');

const N = { nullable: true } as const;
const O = { optional: true } as const;

const recordColumns = {
  recordId: text(),
  version: int(),
  entityId: text(),
  kind: text(),
  code: text(),
  amount: numeric(),
  currency: text(),
  date: date({ name: 'record_date' }),
  channel: text(),
  counterparty: text(),
  reference: text(),
  payoutBatch: text(),
  description: text(O),
  fee: numeric(),
  refund: numeric(),
  discount: numeric(),
  adjustment: numeric(),
  documentId: text(N),
  matchGroupId: text(N),
  periodId: text(),
};

export const TABLES: { [K in CollectionName]: TableDef<K> } = {
  // ───────── identity & access ─────────
  users: {
    table: 'users',
    scope: 'global',
    columns: {
      fullName: text(),
      email: text(N),
      phone: text(N),
      status: text(),
      verifiedAt: ts(N),
      totpSecret: text(N),
      mfaEnabledAt: ts(N),
      failedLogins: int(),
      lockedUntil: ts(N),
      lastLoginAt: ts(N),
      pendingInvitationCode: text(N),
    },
  },
  credentials: {
    table: 'credentials',
    scope: 'global',
    columns: { userId: text(), passwordHash: text(), passwordUpdatedAt: ts() },
  },
  verificationTokens: {
    table: 'verification_tokens',
    scope: 'global',
    columns: {
      userId: text(),
      purpose: text(),
      tokenHash: text(),
      expiresAt: ts(),
      attempts: int(),
      consumedAt: ts(N),
      sentTo: text(),
      lastSentAt: ts(),
    },
  },
  sessions: {
    table: 'sessions',
    scope: 'global',
    columns: {
      userId: text(),
      tokenHash: text(),
      channel: text(),
      aal: int(),
      expiresAt: ts(),
      lastSeenAt: ts(),
      userAgent: text(),
      ip: text(),
      remember: bool(),
      activeTenantId: text(N),
      activeEntityId: text(),
      revokedAt: ts(N),
      stepUpAt: ts(N),
    },
  },
  tenants: {
    table: 'tenants',
    scope: 'self',
    columns: {
      name: text(),
      orgType: text(),
      taxCode: text(N),
      policyVersion: text(),
      settings: json(),
      createdBy: text(),
    },
  },
  entities: {
    table: 'legal_entities',
    scope: 'tenant',
    columns: {
      name: text(),
      shortName: text(),
      code: text(),
      kind: text(),
      parentId: text(N),
      baseCurrency: text(),
      timezone: text(),
    },
  },
  memberships: {
    table: 'memberships',
    scope: 'tenant',
    columns: {
      userId: text(),
      displayName: text(),
      title: text(),
      bindings: json(),
      status: text(),
      scopeLabel: text(),
      limitLabel: text(),
    },
  },
  invitations: {
    table: 'invitations',
    scope: 'global',
    columns: {
      orgTenantId: text(),
      orgName: text(),
      code: text(),
      email: text(),
      role: text(),
      entityIds: json(),
      scopeLabel: text(),
      permissionsLabel: text(),
      approvalLimit: numeric(N),
      invitedBy: text(),
      inviterName: text(),
      expiresAt: ts(),
      status: text(),
    },
  },

  // ───────── intake & documents ─────────
  importBatches: {
    table: 'import_batches',
    scope: 'tenant',
    columns: {
      code: text(),
      entityId: text(),
      sourceKind: text(),
      location: text(),
      status: text(),
      fileCount: int(),
      normalized: int(),
      needsReview: int(),
      duplicates: int(),
      createdBy: text(),
      parserVersion: text(),
    },
  },
  artifacts: {
    table: 'source_artifacts',
    scope: 'tenant',
    columns: {
      batchId: text(),
      filename: text(),
      mime: text(),
      size: bigint(),
      rawSha256: text(),
      objectUri: text(),
      sourceKey: text(),
      receivedAt: ts(),
      duplicateOf: text(N),
      content: text(N),
      contentBom: bool(O),
      contentExact: bool(O),
    },
  },
  documents: {
    table: 'documents',
    scope: 'tenant',
    columns: {
      code: text(),
      title: text(),
      counterparty: text(),
      sourceKind: text(),
      entityId: text(),
      date: date({ name: 'document_date' }),
      amount: numeric(),
      status: text(),
      currentVersion: int(),
      artifactId: text(N),
      batchId: text(N),
      fields: json(),
      lines: json(),
      vat: numeric(O),
      rows: json({ name: 'structured_rows' }),
      rowKind: text(N),
      extraction: json(N),
      issues: json(),
      receivedAt: ts(),
      receivedBy: text(),
      validatedBy: text(N),
      validatedAt: ts(N),
      kind: text(),
    },
  },
  documentVersions: {
    table: 'document_versions',
    scope: 'tenant',
    columns: {
      documentId: text(),
      version: int(),
      artifactId: text(N),
      parserVersion: text(),
      fields: json(),
      fieldLocator: text(),
      confirmedBy: text(),
      confirmedByName: text(),
      confirmedAt: ts(),
      note: text(),
      fingerprint: text(),
      salt: text(),
    },
  },
  records: { table: 'business_records', scope: 'tenant', columns: recordColumns },
  recordHistory: { table: 'business_record_history', scope: 'tenant', columns: recordColumns },
  recordEvidence: {
    table: 'record_evidence',
    scope: 'tenant',
    columns: {
      recordId: text(),
      recordVersion: int(),
      documentId: text(),
      documentVersion: int(),
      fieldLocator: text(),
    },
  },

  // ───────── reconciliation ─────────
  reconRuns: {
    table: 'recon_runs',
    scope: 'tenant',
    columns: {
      entityId: text(),
      periodId: text(),
      inputSnapshotDigest: text(),
      rulesVersion: text(),
      groupIds: textArray(),
      unmatchedOrders: textArray(),
      unmatchedTxns: textArray(),
      createdBy: text(),
    },
  },
  matchGroups: {
    table: 'match_groups',
    scope: 'tenant',
    columns: {
      code: text(),
      runId: text(N),
      entityId: text(),
      periodId: text(),
      kind: text(),
      status: text(),
      sourceLabel: text(),
      orderIds: textArray(),
      txnIds: textArray(),
      gross: numeric(),
      fee: numeric(),
      refund: numeric(),
      discount: numeric(),
      adjustment: numeric(),
      net: numeric(),
      received: numeric(),
      residual: numeric(),
      score: real(),
      links: json(),
      allocations: json(),
      explanation: text(),
      basis: textArray(),
      feeRule: text(),
      inputSnapshotVersion: text(),
      rulesVersion: text(),
      confirmedBy: text(N),
      confirmedAt: ts(N),
      approvalId: text(N),
      version: int(),
    },
  },

  // ───────── approvals, close, evidence ─────────
  approvals: {
    table: 'approvals',
    scope: 'tenant',
    columns: {
      approvalId: text(),
      entityId: text(),
      targetType: text(),
      targetId: text(),
      targetVersion: int(),
      digest: text(),
      amount: numeric(),
      title: text(),
      makerId: text(),
      status: text(),
      policyVersion: text(),
      decidedAt: ts(O),
      actorId: text(O),
      comment: text(O),
      requesterName: text(),
      entityLabel: text(),
      details: json(),
      timeline: json(),
      dueDate: date(),
    },
  },
  periods: {
    table: 'accounting_periods',
    scope: 'tenant',
    columns: {
      entityId: text(),
      periodId: text(),
      status: text(),
      closeMemoPrepared: bool(),
      closeId: text(N),
      version: int(),
    },
  },
  closeSnapshots: {
    table: 'close_snapshots',
    scope: 'tenant',
    columns: {
      entityId: text(),
      periodId: text(),
      version: int(),
      previousCloseId: text(N),
      rulesVersion: text(),
      manifest: json(),
      manifestDigest: text(),
      approvalIds: textArray(),
      closedBy: text(),
      closedAt: ts(),
      evidenceStatus: text(),
    },
  },
  evidenceBatches: {
    table: 'evidence_batches',
    scope: 'tenant',
    columns: {
      code: text(),
      batchRef: text(),
      merkleRoot: text(),
      schemaVersion: text(),
      leaves: json(),
      receipt: json(N),
    },
  },
  evidenceReceipts: {
    table: 'evidence_receipts',
    scope: 'tenant',
    columns: {
      targetType: text(),
      targetId: text(),
      targetVersion: int(),
      batchId: text(),
      batchCode: text(),
      merkleRoot: text(),
      leafIndex: int(),
      transactionId: text(),
      blockNumber: bigint(),
      channel: text(),
      validationCode: text(),
      committedAt: ts(),
    },
  },
  verifications: {
    table: 'evidence_verifications',
    scope: 'tenant',
    columns: { targetType: text(), targetId: text(), ok: bool(), steps: json(), requestedBy: text() },
  },
  ledger: { table: 'ledger_states', scope: 'global', columns: { state: json() } },

  // ───────── finance, AI, ops ─────────
  calcRuns: {
    table: 'calc_runs',
    scope: 'tenant',
    columns: {
      calcRunId: text(),
      task: text(),
      packageCode: text(),
      inputSnapshotDigest: text(),
      rulesVersion: text(),
      engineVersion: text(),
      assumptions: json(N),
      method: text(),
      result: json(N),
      createdBy: text(),
    },
  },
  financeProjects: {
    table: 'finance_projects',
    scope: 'tenant',
    columns: { code: text(), name: text(), assumptions: json(), scenarios: json(), lastCalcRunId: text(N) },
  },
  conversations: {
    table: 'assistant_conversations',
    scope: 'tenant',
    columns: { userId: text(), title: text(), messages: json() },
  },
  notifications: {
    table: 'notifications',
    scope: 'tenant',
    columns: {
      userId: text(N),
      title: text(),
      unitLabel: text(),
      refCode: text(),
      route: text(),
      status: text(),
      actionRequired: bool(),
      statusLabel: text(O),
    },
  },
  audit: {
    table: 'audit_log',
    scope: 'tenant',
    columns: {
      actorId: text(),
      actorName: text(),
      action: text(),
      target: text(),
      detail: text(),
      correlationId: text(),
    },
  },
  outbox: { table: 'event_outbox', scope: 'mixed', columns: { event: json(), publishedAt: ts(N) } },
  inbox: { table: 'event_inbox', scope: 'mixed', columns: { consumer: text(), eventId: text() } },
  projections: {
    table: 'read_projections',
    scope: 'tenant',
    columns: { name: text(), asOfSeq: bigint(), data: json() },
  },
  integrations: {
    table: 'integrations',
    scope: 'tenant',
    columns: {
      kind: text(),
      name: text(),
      description: text(),
      status: text(),
      scope: text(),
      connectedAt: ts(N),
    },
  },
  connections: {
    table: 'connections',
    scope: 'tenant',
    columns: {
      provider: text(),
      label: text(),
      status: text(),
      config: json(),
      secretSealed: text(N),
      secretHint: text(),
      cursor: text(N),
      entityId: text(),
      connectedBy: text(),
      connectedByName: text(),
      connectedAt: ts(),
      lastSyncAt: ts(N),
      lastError: text(N),
    },
  },
  connectionRuns: {
    table: 'connection_runs',
    scope: 'tenant',
    columns: {
      connectionId: text(),
      provider: text(),
      trigger: text(),
      startedAt: ts(),
      finishedAt: ts(),
      status: text(),
      fetched: int(),
      imported: int(),
      requests: int(),
      documentId: text(N),
      documentCode: text(N),
      message: text(),
      actorId: text(),
      actorName: text(),
    },
  },
  aggregateSeqs: { table: 'aggregate_sequences', scope: 'mixed', columns: { seq: bigint() } },

  // ───────── modules G1–G4 ─────────
  inventoryItems: {
    table: 'inventory_items',
    scope: 'tenant',
    columns: {
      entityId: text(),
      name: text(),
      unit: text(),
      onHand: numeric(),
      reorderLevel: numeric(),
      unitCost: numeric(),
    },
  },
  recipes: {
    table: 'recipes',
    scope: 'tenant',
    columns: { name: text(), price: numeric(), wasteRate: numeric(), lines: json() },
  },
  purchaseOrders: {
    table: 'purchase_orders',
    scope: 'tenant',
    columns: {
      code: text(),
      supplier: text(),
      entityId: text(),
      orderDate: date(),
      dueDate: date(),
      amount: numeric(),
      outstanding: numeric(),
      status: text(),
    },
  },
  dailyCloses: {
    table: 'daily_closes',
    scope: 'tenant',
    columns: {
      entityId: text(),
      date: date({ name: 'business_date' }),
      shift: text(),
      lines: json(),
      status: text(),
      submittedBy: text(N),
      submittedAt: ts(N),
    },
  },
  clients: {
    table: 'clients',
    scope: 'tenant',
    columns: {
      name: text(),
      scope: text(),
      completion: int(),
      closeDue: date(),
      status: text(),
      missingDocs: int(),
      delegationValidUntil: date(),
    },
  },
  deals: {
    table: 'deals',
    scope: 'tenant',
    columns: {
      code: text(),
      customer: text(),
      stage: text(),
      value: numeric({ name: 'deal_value' }),
      status: text(),
      dueDate: date(),
    },
  },
  projects: {
    table: 'projects',
    scope: 'tenant',
    columns: {
      code: text(),
      name: text(),
      manager: text(),
      budget: numeric(),
      recorded: numeric(),
      committed: numeric(),
      wbs: json(),
    },
  },
  assets: {
    table: 'assets',
    scope: 'tenant',
    columns: {
      code: text(),
      name: text(),
      kind: text(),
      projectCode: text(),
      baseline: numeric({ blankAsNull: true }),
      reporting: numeric({ blankAsNull: true }),
      unit: text(),
      schedule: text(),
      dueDate: date(N),
      status: text(),
    },
  },
  shipments: {
    table: 'shipments',
    scope: 'tenant',
    columns: {
      code: text(),
      route: text(),
      container: text(),
      status: text(),
      events: json(),
      documents: json(),
      freeTimeStart: date(),
      freeDays: int(),
      tariffCode: text(),
      tariffFrom: date(),
      storageRatePerDay: numeric(),
      storageDays: int(),
      revenue: numeric(),
      costs: json(),
      allocation: json(),
      allocationConfirmed: bool(),
    },
  },
  groupEntities: {
    table: 'group_entities',
    scope: 'tenant',
    columns: {
      entityId: text(),
      name: text(),
      code: text(),
      docsSubmitted: int(),
      docsTotal: int(),
      periodStatus: text(),
      icStatus: text(),
    },
  },
  intercompany: {
    table: 'intercompany_pairs',
    scope: 'tenant',
    columns: {
      reference: text(),
      contract: text(),
      periodId: text(),
      sideA: json(),
      sideB: json(),
      status: text(),
      nextAction: text(),
      requestedAt: ts(N),
    },
  },
};

export const snakeCase = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Column definitions with resolved SQL names, in declaration order. */
export function columnsOf(col: CollectionName): { field: string; column: string; def: Column }[] {
  return Object.entries(TABLES[col].columns as Record<string, Column>).map(([field, def]) => ({
    field,
    column: def.name ?? snakeCase(field),
    def,
  }));
}
