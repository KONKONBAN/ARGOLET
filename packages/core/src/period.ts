import { canonicalize } from './canonical';
import { D, dec, sum } from './decimal';
import { sha256Hex } from './hash';
import { EVIDENCE_SCHEMA_VERSION, type SnapshotManifest } from './evidence';

/** Period close lifecycle (board 05 / 12): OPEN → REVIEW → APPROVED → CLOSED. */
export type PeriodStatus = 'OPEN' | 'REVIEW' | 'APPROVED' | 'CLOSED';

const NEXT: Record<PeriodStatus, PeriodStatus[]> = {
  OPEN: ['REVIEW'],
  REVIEW: ['APPROVED', 'OPEN'],
  APPROVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export function canMovePeriod(from: PeriodStatus, to: PeriodStatus): boolean {
  return NEXT[from].includes(to);
}

export interface CloseChecklistInput {
  documentsTotal: number;
  documentsValidated: number;
  groupsTotal: number;
  groupsConfirmed: number;
  unexplainedDiscrepancies: number;
  pendingApprovals: number;
  closeMemoPrepared: boolean;
}

export interface ChecklistItem {
  key: 'documents' | 'reconciliation' | 'approvals' | 'memo';
  done: boolean;
  title: string;
  detail: string;
}

export function closeChecklist(i: CloseChecklistInput): { items: ChecklistItem[]; blocking: number; ready: boolean } {
  const items: ChecklistItem[] = [
    {
      key: 'documents',
      done: i.documentsValidated === i.documentsTotal,
      title: i.documentsValidated === i.documentsTotal ? `${i.documentsValidated} chứng từ đã xác nhận` : `${i.documentsTotal - i.documentsValidated} chứng từ cần kiểm tra`,
      detail: i.documentsValidated === i.documentsTotal ? 'Nguồn gốc và thông tin đã được rà soát' : 'Xác nhận chứng từ trước khi chốt',
    },
    {
      key: 'reconciliation',
      done: i.unexplainedDiscrepancies === 0 && i.groupsConfirmed === i.groupsTotal,
      title: i.unexplainedDiscrepancies === 0 && i.groupsConfirmed === i.groupsTotal ? `${i.groupsConfirmed} nhóm đã đối soát` : `${i.groupsTotal - i.groupsConfirmed} nhóm đối soát chưa xác nhận`,
      detail: i.unexplainedDiscrepancies === 0 ? 'Không có chênh lệch chưa giải thích' : `${i.unexplainedDiscrepancies} chênh lệch chưa giải thích`,
    },
    {
      key: 'approvals',
      done: i.pendingApprovals === 0,
      title: i.pendingApprovals === 0 ? 'Không còn hồ sơ chờ phê duyệt' : `${i.pendingApprovals} hồ sơ chờ phê duyệt`,
      detail: i.pendingApprovals === 0 ? 'Mọi hồ sơ đã có quyết định' : 'Mở công việc để hoàn tất trước khi chốt',
    },
    {
      key: 'memo',
      done: i.closeMemoPrepared,
      title: i.closeMemoPrepared ? 'Biên bản chốt đã lập' : 'Biên bản chốt chưa được lập',
      detail: i.closeMemoPrepared ? 'Sẵn sàng lưu phiên bản chốt' : 'Sẽ tạo sau khi đủ điều kiện',
    },
  ];
  // The memo is generated automatically once all other conditions are met.
  const blocking = items.filter((x) => !x.done && x.key !== 'memo').length;
  return { items, blocking, ready: blocking === 0 };
}

export interface SnapshotMemberInput {
  recordId: string;
  recordVersion: number;
  kind: string;
  amount: string;
  artifactId?: string | undefined;
  rawSha256?: string | undefined;
}

export function buildSnapshotManifest(p: {
  tenantId: string;
  closeId: string;
  entityId: string;
  periodId: string;
  closeVersion: number;
  previousCloseId: string | null;
  rulesVersion: string;
  members: SnapshotMemberInput[];
  approvals: { approvalId: string; digest: string; actorId: string }[];
}): SnapshotManifest {
  const revenue = sum(p.members.filter((m) => m.kind === 'REVENUE' || m.kind === 'ORDER').map((m) => m.amount));
  const expense = sum(p.members.filter((m) => m.kind === 'EXPENSE').map((m) => m.amount));
  const sources = new Map<string, string>();
  for (const m of p.members) if (m.artifactId && m.rawSha256) sources.set(m.artifactId, m.rawSha256);
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    tenantId: p.tenantId,
    closeId: p.closeId,
    entityId: p.entityId,
    periodId: p.periodId,
    closeVersion: p.closeVersion,
    previousCloseId: p.previousCloseId,
    rulesVersion: p.rulesVersion,
    members: p.members
      .map((m) => ({ recordId: m.recordId, recordVersion: m.recordVersion, digest: sha256Hex(canonicalize({ id: m.recordId, v: m.recordVersion, kind: m.kind, amount: dec(m.amount) })) }))
      .sort((a, b) => a.recordId.localeCompare(b.recordId)),
    sources: [...sources.entries()].map(([artifactId, rawSha256]) => ({ artifactId, rawSha256 })).sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
    approvals: p.approvals.slice().sort((a, b) => a.approvalId.localeCompare(b.approvalId)),
    totals: { revenue: dec(revenue), expense: dec(expense), net: dec(D(revenue).minus(expense)) },
  };
}
