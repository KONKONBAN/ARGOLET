import type {
  ApprovalRequest,
  DocumentStatus,
  ExtractionField,
  ImageMeta,
  FieldIssue,
  LedgerReceipt,
  LedgerState,
  MatchKind,
  ProofStep,
  RecordAllocation,
  AllocationLink,
  RoleBinding,
  SnapshotManifest,
  PeriodStatus,
  CalcRun,
  DomainEvent,
  ProjectAssumptions,
  VerificationStep,
  Role,
} from '@argolet/core';

export const GLOBAL = '_global';

export interface BaseRow {
  id: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  rev: number;
}

// ───────── identity & access ─────────
export interface UserRow extends BaseRow {
  fullName: string;
  email: string | null;
  phone: string | null;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'LOCKED';
  verifiedAt: string | null;
  totpSecret: string | null;
  mfaEnabledAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  pendingInvitationCode: string | null;
}
export interface CredentialRow extends BaseRow {
  userId: string;
  passwordHash: string;
  passwordUpdatedAt: string;
}
export interface VerificationTokenRow extends BaseRow {
  userId: string;
  purpose: 'VERIFY_CONTACT' | 'RESET_PASSWORD' | 'STEP_UP';
  tokenHash: string;
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
  sentTo: string;
  lastSentAt: string;
}
export interface SessionRow extends BaseRow {
  userId: string;
  tokenHash: string;
  channel: 'web' | 'mobile';
  aal: 1 | 2;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string;
  ip: string;
  remember: boolean;
  activeTenantId: string | null;
  activeEntityId: string;
  revokedAt: string | null;
  stepUpAt: string | null;
}
/** How a household business pays VAT and PIT — decides its books (Thông tư 152/2025/TT-BTC). */
export interface HkdSettings {
  /** EXEMPT: không chịu GTGT, không nộp TNCN (S1a) · PERCENT: GTGT và TNCN theo % doanh thu (S2a) ·
   * INCOME: GTGT theo % doanh thu, TNCN trên thu nhập tính thuế (S2b, S2c, S2e). */
  method: 'EXEMPT' | 'PERCENT' | 'INCOME';
  /** Business lines with their rates (% on revenue), as declared by the household. */
  lines: { name: string; vatRate?: string | undefined; pitRate?: string | undefined }[];
  /** PIT rate on taxable income for INCOME (S2c line 4). */
  incomePitRate?: string | undefined;
}
export interface LedgerSettings {
  /** First month of the books; opening balances are those at its first day. */
  openingPeriod?: string | undefined;
  /** Signed balances (debit positive) of balance-sheet accounts at the start of openingPeriod. */
  opening?: Record<string, string> | undefined;
  /** Inventory (152 + 156) counted at the end of a month, by month. */
  stockCounts?: Record<string, string> | undefined;
  /** Corporate income tax rate set by the accountant ("0.2"); automatic by revenue when absent. */
  citRate?: string | undefined;
}
export interface TenantSettings {
  currency: string;
  timezone: string;
  periodType: 'MONTH';
  /** TT200 is kept for data recorded before 2026; Thông tư 99/2025 replaces it from 01/01/2026. */
  accountingRegime: 'TT133' | 'TT99' | 'TT200' | 'HKD';
  /** Registered address, printed on the accounting books. */
  address?: string | undefined;
  hkd?: HkdSettings | undefined;
  /** Automatic double-entry books: opening balances, stock counts and the income-tax rate. */
  ledger?: LedgerSettings | undefined;
  /** Generative AI for the assistant: off unless an administrator picks a provider. */
  ai?: { provider: 'claude' | 'openai' | 'off' } | undefined;
  packages: ('G1' | 'G2' | 'G3' | 'G4')[];
  currentPeriod: string;
  dataLocation: string;
}
export interface TenantRow extends BaseRow {
  name: string;
  orgType: string;
  taxCode: string | null;
  policyVersion: string;
  settings: TenantSettings;
  createdBy: string;
}
export interface LegalEntityRow extends BaseRow {
  name: string;
  shortName: string;
  code: string;
  kind: 'LEGAL_ENTITY' | 'SITE';
  parentId: string | null;
  baseCurrency: string;
  timezone: string;
}
export interface MembershipRow extends BaseRow {
  userId: string;
  displayName: string;
  title: string;
  bindings: RoleBinding[];
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  scopeLabel: string;
  limitLabel: string;
}
export interface InvitationRow extends BaseRow {
  orgTenantId: string;
  orgName: string;
  code: string;
  email: string;
  role: Role;
  entityIds: string[] | '*';
  scopeLabel: string;
  permissionsLabel: string;
  approvalLimit: string | null;
  invitedBy: string;
  inviterName: string;
  expiresAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
}

// ───────── intake & documents ─────────
export type SourceKindCode = 'PHOTO' | 'XML_EINVOICE' | 'BANK' | 'CSV' | 'PDF' | 'POS' | 'EXCEL';
export interface ImportBatchRow extends BaseRow {
  code: string;
  entityId: string;
  sourceKind: SourceKindCode | 'MIXED';
  location: string;
  status: 'RECEIVED' | 'PROCESSING' | 'READY' | 'NEEDS_REVIEW';
  fileCount: number;
  normalized: number;
  needsReview: number;
  duplicates: number;
  createdBy: string;
  parserVersion: string;
}
export interface SourceArtifactRow extends BaseRow {
  batchId: string;
  filename: string;
  mime: string;
  size: number;
  rawSha256: string;
  objectUri: string;
  sourceKey: string;
  receivedAt: string;
  duplicateOf: string | null;
  /** Small text sources (XML/CSV) are retained for re-parsing and verification. */
  content: string | null;
  /** The original started with a UTF-8 byte-order mark (content excludes it). */
  contentBom?: boolean | undefined;
  /** content (+ BOM) re-encodes to exactly the original bytes; false for legacy encodings. */
  contentExact?: boolean | undefined;
}
export interface DocumentRow extends BaseRow {
  code: string;
  title: string;
  counterparty: string;
  sourceKind: SourceKindCode;
  entityId: string;
  date: string;
  amount: string;
  status: DocumentStatus | 'NEEDS_RECON';
  currentVersion: number;
  artifactId: string | null;
  batchId: string | null;
  fields: {
    supplier: string;
    documentNo: string;
    documentDate: string;
    total: string;
    taxCode?: string | undefined;
    /** Invoice symbol (ký hiệu, e.g. 1C26TAA): with the tax code and number it identifies an invoice. */
    series?: string | undefined;
  };
  lines: { description: string; amount: string }[];
  /** VAT of an e-invoice (lines are net amounts; total = lines + VAT). */
  vat?: string | undefined;
  /** Structured rows parsed from statements / POS exports (become BusinessRecords on confirmation). */
  rows: StructuredRow[];
  rowKind: 'BANK' | 'POS' | null;
  /** OCR / VLM result; for photos also the camera metadata (EXIF) used by the forgery checks. */
  extraction: {
    modelVersion: string;
    fields: ExtractionField[];
    imageMeta?: ImageMeta | undefined;
    /** QR code text read from the photo / PDF (e-invoice QR per QĐ 1450 when it parses as one). */
    qr?: string | undefined;
  } | null;
  issues: FieldIssue[];
  receivedAt: string;
  receivedBy: string;
  validatedBy: string | null;
  validatedAt: string | null;
  kind: 'EXPENSE' | 'REVENUE' | 'STATEMENT' | 'OTHER';
}
export interface StructuredRow {
  lineNo: number;
  code: string;
  date: string;
  amount: string;
  fee: string;
  refund: string;
  discount: string;
  reference: string;
  payoutBatch: string;
  counterparty: string;
  channel: string;
  description: string;
}
export interface DocumentVersionRow extends BaseRow {
  documentId: string;
  version: number;
  artifactId: string | null;
  parserVersion: string;
  fields: DocumentRow['fields'];
  fieldLocator: string;
  confirmedBy: string;
  confirmedByName: string;
  confirmedAt: string;
  note: string;
  fingerprint: string;
  salt: string;
}
export type RecordKind = 'ORDER' | 'BANK_TXN' | 'CASH' | 'EXPENSE' | 'REVENUE';
export interface BusinessRecordRow extends BaseRow {
  recordId: string;
  version: number;
  entityId: string;
  kind: RecordKind;
  code: string;
  amount: string;
  currency: string;
  date: string;
  channel: string;
  counterparty: string;
  reference: string;
  payoutBatch: string;
  /** Free-text line description (bank statements), used to recognise payout batch codes. */
  description?: string | undefined;
  fee: string;
  refund: string;
  discount: string;
  adjustment: string;
  documentId: string | null;
  matchGroupId: string | null;
  periodId: string;
}
export interface RecordEvidenceRow extends BaseRow {
  recordId: string;
  recordVersion: number;
  documentId: string;
  documentVersion: number;
  fieldLocator: string;
}

// ───────── reconciliation ─────────
export interface ReconRunRow extends BaseRow {
  entityId: string;
  periodId: string;
  inputSnapshotDigest: string;
  rulesVersion: string;
  groupIds: string[];
  unmatchedOrders: string[];
  unmatchedTxns: string[];
  createdBy: string;
}
export interface MatchGroupRow extends BaseRow {
  code: string;
  runId: string | null;
  entityId: string;
  periodId: string;
  kind: MatchKind;
  status: 'PROPOSED' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'DISCREPANCY';
  sourceLabel: string;
  orderIds: string[];
  txnIds: string[];
  gross: string;
  fee: string;
  refund: string;
  discount: string;
  adjustment: string;
  net: string;
  received: string;
  residual: string;
  score: number;
  links: AllocationLink[];
  allocations: RecordAllocation[];
  explanation: string;
  basis: string[];
  feeRule: string;
  inputSnapshotVersion: string;
  rulesVersion: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  approvalId: string | null;
  version: number;
}

// ───────── approvals, close, evidence ─────────
export interface ApprovalRow extends BaseRow, Omit<ApprovalRequest, 'tenantId'> {
  requesterName: string;
  entityLabel: string;
  details: { label: string; value: string }[];
  timeline: { title: string; by: string; at: string }[];
  dueDate: string;
}
export interface PeriodRow extends BaseRow {
  entityId: string;
  periodId: string;
  status: PeriodStatus;
  closeMemoPrepared: boolean;
  closeId: string | null;
  version: number;
}
export interface CloseSnapshotRow extends BaseRow {
  entityId: string;
  periodId: string;
  version: number;
  previousCloseId: string | null;
  rulesVersion: string;
  manifest: SnapshotManifest;
  manifestDigest: string;
  approvalIds: string[];
  closedBy: string;
  closedAt: string;
  evidenceStatus: 'PENDING' | 'ANCHORED' | 'FAILED';
}
export interface EvidenceLeafRow {
  targetType: 'CLOSE' | 'DOCUMENT_VERSION';
  targetId: string;
  targetVersion: number;
  leafIndex: number;
  salt: string;
  manifestDigest: string;
  leaf: string;
  proof: ProofStep[];
}
export interface EvidenceBatchRow extends BaseRow {
  code: string;
  batchRef: string;
  merkleRoot: string;
  schemaVersion: string;
  leaves: EvidenceLeafRow[];
  receipt: LedgerReceipt | null;
}
export interface EvidenceReceiptRow extends BaseRow {
  targetType: 'CLOSE' | 'DOCUMENT_VERSION';
  targetId: string;
  targetVersion: number;
  batchId: string;
  batchCode: string;
  merkleRoot: string;
  leafIndex: number;
  transactionId: string;
  blockNumber: number;
  channel: string;
  validationCode: string;
  committedAt: string;
}
export interface VerificationLogRow extends BaseRow {
  targetType: 'CLOSE' | 'DOCUMENT_VERSION';
  targetId: string;
  ok: boolean;
  steps: VerificationStep[];
  requestedBy: string;
}
export interface LedgerRow extends BaseRow {
  state: LedgerState;
}

// ───────── finance, AI, ops ─────────
export interface CalcRunRow extends BaseRow, Omit<CalcRun, 'createdAt'> {
  createdBy: string;
}
export interface FinanceProjectRow extends BaseRow {
  code: string;
  name: string;
  assumptions: ProjectAssumptions;
  scenarios: { name: string; annualCashflow: string }[];
  lastCalcRunId: string | null;
}
export interface ConversationRow extends BaseRow {
  userId: string;
  title: string;
  messages: ChatMessage[];
}
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  answer?: AssistantAnswer | undefined;
}
export interface AssistantAnswer {
  headline: string;
  body: string;
  facts: { label: string; value: string }[];
  citations: { label: string; ref: string; route?: string | undefined }[];
  toolCalls: { tool: string; status: string }[];
  note: string;
  proposal?: { toolName: string; args: Record<string, unknown>; impact: string } | undefined;
  engine: 'claude' | 'openai' | 'rules';
}
export interface NotificationRow extends BaseRow {
  userId: string | null;
  title: string;
  unitLabel: string;
  refCode: string;
  route: string;
  status: 'UNREAD' | 'READ';
  actionRequired: boolean;
  statusLabel?: string | undefined;
}
export interface AuditRow extends BaseRow {
  actorId: string;
  actorName: string;
  action: string;
  target: string;
  detail: string;
  correlationId: string;
}
export interface OutboxRow extends BaseRow {
  event: DomainEvent;
  publishedAt: string | null;
}
export interface InboxRow extends BaseRow {
  consumer: string;
  eventId: string;
}
export interface ProjectionRow extends BaseRow {
  name: string;
  asOfSeq: number;
  data: Record<string, unknown>;
}
export interface IntegrationRow extends BaseRow {
  kind: 'POS' | 'PLATFORM' | 'BANK' | 'EINVOICE' | 'PAPER' | 'EXCEL';
  name: string;
  description: string;
  status: 'CONNECTED' | 'AVAILABLE' | 'PAUSED';
  scope: string;
  connectedAt: string | null;
}
export type ConnectorProviderCode = 'SEPAY' | 'KIOTVIET';
/** ARGOLET's connection to a partner's API. */
export interface ConnectionRow extends BaseRow {
  provider: ConnectorProviderCode;
  label: string;
  status: 'ACTIVE' | 'ERROR' | 'DISCONNECTED';
  /** Non-secret settings (e.g. the KiotViet shop name). */
  config: Record<string, string>;
  /** Credentials sealed with the server key (AES-256-GCM); never sent to a client. */
  secretSealed: string | null;
  /** Last characters of the key, to recognise it. */
  secretHint: string;
  /** Where the next sync resumes (SePay: last transaction id · KiotViet: last purchase date). */
  cursor: string | null;
  /** Site that receives the data. */
  entityId: string;
  connectedBy: string;
  connectedByName: string;
  connectedAt: string;
  lastSyncAt: string | null;
  lastError: string | null;
}
/** One test or sync with a partner (append-only). */
export interface ConnectionRunRow extends BaseRow {
  connectionId: string;
  provider: ConnectorProviderCode;
  trigger: 'MANUAL' | 'SCHEDULE' | 'TEST';
  startedAt: string;
  finishedAt: string;
  status: 'SUCCESS' | 'NO_CHANGE' | 'FAILED';
  fetched: number;
  imported: number;
  requests: number;
  documentId: string | null;
  documentCode: string | null;
  message: string;
  actorId: string;
  actorName: string;
}
export interface AggregateSeqRow extends BaseRow {
  seq: number;
}

// ───────── modules G1–G4 ─────────
export interface InventoryItemRow extends BaseRow {
  entityId: string;
  name: string;
  unit: string;
  onHand: string;
  reorderLevel: string;
  unitCost: string;
}
export interface RecipeRow extends BaseRow {
  name: string;
  price: string;
  wasteRate: string;
  lines: { itemId: string; name: string; quantity: string; unit: string; unitCost: string }[];
}
export interface PurchaseOrderRow extends BaseRow {
  code: string;
  supplier: string;
  entityId: string;
  orderDate: string;
  dueDate: string;
  amount: string;
  outstanding: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'RECEIVED' | 'AWAITING_INVOICE' | 'PAID';
}
export interface DailyCloseRow extends BaseRow {
  entityId: string;
  date: string;
  shift: string;
  lines: { channel: string; system: string; counted: string }[];
  status: 'OPEN' | 'SUBMITTED';
  submittedBy: string | null;
  submittedAt: string | null;
}
export interface ClientRow extends BaseRow {
  name: string;
  scope: string;
  completion: number;
  closeDue: string;
  status: 'MISSING_DOCS' | 'READY' | 'REVIEWED' | 'WAITING';
  missingDocs: number;
  delegationValidUntil: string;
}
export interface DealRow extends BaseRow {
  code: string;
  customer: string;
  stage: 'OPPORTUNITY' | 'QUOTE' | 'CONTRACT' | 'DELIVERY' | 'INVOICE' | 'COLLECTION';
  value: string;
  status: 'WAITING_REPLY' | 'IN_PROGRESS' | 'DUE' | 'DONE';
  dueDate: string;
}
export interface WbsTask {
  code: string;
  name: string;
  dependsOn: string | null;
  owner: string;
  progress: number;
  status: 'DONE' | 'IN_PROGRESS' | 'NOT_STARTED';
}
export interface ProjectRow extends BaseRow {
  code: string;
  name: string;
  manager: string;
  budget: string;
  recorded: string;
  committed: string;
  wbs: WbsTask[];
}
export interface AssetRow extends BaseRow {
  code: string;
  name: string;
  kind: 'ASSET' | 'METRIC';
  projectCode: string;
  baseline: string;
  reporting: string;
  unit: string;
  schedule: string;
  dueDate: string | null;
  status: 'MONITORING' | 'MAINTENANCE_DUE' | 'OK';
}
export interface ShipmentRow extends BaseRow {
  code: string;
  route: string;
  container: string;
  status: 'IN_TRANSIT' | 'CUSTOMS' | 'DELIVERING' | 'DELIVERED';
  events: { title: string; detail: string; at: string; done: boolean }[];
  documents: { name: string; status: string }[];
  freeTimeStart: string;
  freeDays: number;
  tariffCode: string;
  tariffFrom: string;
  storageRatePerDay: string;
  storageDays: number;
  revenue: string;
  costs: { name: string; basis: string; amount: string }[];
  allocation: { item: string; weightShare: string }[];
  allocationConfirmed: boolean;
}
export interface GroupEntityRow extends BaseRow {
  entityId: string;
  name: string;
  code: string;
  docsSubmitted: number;
  docsTotal: number;
  periodStatus: 'SUBMITTED' | 'PENDING';
  icStatus: string;
}
export interface IntercompanyRow extends BaseRow {
  reference: string;
  contract: string;
  periodId: string;
  sideA: { entityId: string; name: string; role: 'RECEIVABLE'; amount: string };
  sideB: { entityId: string; name: string; role: 'PAYABLE'; amount: string };
  status: 'MATCHED' | 'DIFFERENCE' | 'REQUESTED';
  nextAction: string;
  requestedAt: string | null;
}

export interface Collections {
  users: UserRow;
  credentials: CredentialRow;
  verificationTokens: VerificationTokenRow;
  sessions: SessionRow;
  tenants: TenantRow;
  entities: LegalEntityRow;
  memberships: MembershipRow;
  invitations: InvitationRow;
  importBatches: ImportBatchRow;
  artifacts: SourceArtifactRow;
  documents: DocumentRow;
  documentVersions: DocumentVersionRow;
  records: BusinessRecordRow;
  recordHistory: BusinessRecordRow;
  recordEvidence: RecordEvidenceRow;
  reconRuns: ReconRunRow;
  matchGroups: MatchGroupRow;
  approvals: ApprovalRow;
  periods: PeriodRow;
  closeSnapshots: CloseSnapshotRow;
  evidenceBatches: EvidenceBatchRow;
  evidenceReceipts: EvidenceReceiptRow;
  verifications: VerificationLogRow;
  ledger: LedgerRow;
  calcRuns: CalcRunRow;
  financeProjects: FinanceProjectRow;
  conversations: ConversationRow;
  notifications: NotificationRow;
  audit: AuditRow;
  outbox: OutboxRow;
  inbox: InboxRow;
  projections: ProjectionRow;
  integrations: IntegrationRow;
  connections: ConnectionRow;
  connectionRuns: ConnectionRunRow;
  aggregateSeqs: AggregateSeqRow;
  inventoryItems: InventoryItemRow;
  recipes: RecipeRow;
  purchaseOrders: PurchaseOrderRow;
  dailyCloses: DailyCloseRow;
  clients: ClientRow;
  deals: DealRow;
  projects: ProjectRow;
  assets: AssetRow;
  shipments: ShipmentRow;
  groupEntities: GroupEntityRow;
  intercompany: IntercompanyRow;
}

export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = [
  'users',
  'credentials',
  'verificationTokens',
  'sessions',
  'tenants',
  'entities',
  'memberships',
  'invitations',
  'importBatches',
  'artifacts',
  'documents',
  'documentVersions',
  'records',
  'recordHistory',
  'recordEvidence',
  'reconRuns',
  'matchGroups',
  'approvals',
  'periods',
  'closeSnapshots',
  'evidenceBatches',
  'evidenceReceipts',
  'verifications',
  'ledger',
  'calcRuns',
  'financeProjects',
  'conversations',
  'notifications',
  'audit',
  'outbox',
  'inbox',
  'projections',
  'integrations',
  'connections',
  'connectionRuns',
  'aggregateSeqs',
  'inventoryItems',
  'recipes',
  'purchaseOrders',
  'dailyCloses',
  'clients',
  'deals',
  'projects',
  'assets',
  'shipments',
  'groupEntities',
  'intercompany',
];

/** Input type for inserting a row: storage fills timestamps and revision. */
export type NewRow<K extends CollectionName> = Omit<Collections[K], 'createdAt' | 'updatedAt' | 'rev'> &
  Partial<Pick<BaseRow, 'createdAt' | 'updatedAt' | 'rev'>>;
