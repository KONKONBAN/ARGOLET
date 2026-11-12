import { canonicalize } from './canonical';
import { sha256Hex } from './hash';
import { authorize, type AccessContext } from './rbac';

/**
 * Approvals bound to content (board 05 / 09): a request pins target_version and
 * target_digest = SHA-256(canonical payload). A decision is only valid if the target
 * has not changed since it was submitted, the actor holds the right role/limit,
 * is not the maker, and has completed step-up authentication when policy requires.
 */
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

export interface ApprovalRequest {
  approvalId: string;
  tenantId: string;
  entityId: string;
  targetType: 'EXPENSE' | 'MATCH_GROUP' | 'PERIOD_CLOSE' | 'DECISION_PACK' | 'TOOL_PROPOSAL' | 'ALLOCATION' | 'DAILY_CLOSE';
  targetId: string;
  targetVersion: number;
  digest: string;
  amount: string;
  title: string;
  makerId: string;
  status: ApprovalStatus;
  policyVersion: string;
  createdAt: string;
  decidedAt?: string | undefined;
  actorId?: string | undefined;
  comment?: string | undefined;
}

export const APPROVAL_POLICY_VERSION = 'approval-policy-2026.10';

export function targetDigest(payload: unknown): string {
  return sha256Hex(canonicalize(payload));
}

export interface DecisionInput {
  decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  /** Digest the approver saw on screen — must equal the stored digest. */
  seenDigest: string;
  /** Digest of the target as it is *now* in the database. */
  currentDigest: string;
  currentVersion: number;
  comment?: string;
  now: string;
}

export function decide(req: ApprovalRequest, ctx: AccessContext, input: DecisionInput): ApprovalRequest {
  if (req.status !== 'PENDING') throw new ApprovalError('ALREADY_DECIDED', 'Hồ sơ đã được xử lý trước đó');
  // Authorisation first (role, scope, separation of duties, limit, step-up) — never leak content checks.
  const decisionAuth = authorize(ctx, {
    action: 'approval.decide',
    entityId: req.entityId,
    amount: input.decision === 'APPROVE' ? req.amount : undefined,
    makerId: req.makerId,
  });
  if (!decisionAuth.allowed) {
    throw new ApprovalError(decisionAuth.requiresStepUp ? 'STEP_UP_REQUIRED' : 'FORBIDDEN', decisionAuth.reason);
  }
  if (input.seenDigest !== req.digest) throw new ApprovalError('DIGEST_MISMATCH', 'Nội dung bạn xem khác nội dung đã trình duyệt');
  if (input.currentDigest !== req.digest || input.currentVersion !== req.targetVersion) {
    throw new ApprovalError('STALE_TARGET', 'Hồ sơ đã thay đổi sau khi trình duyệt, cần trình lại');
  }
  return {
    ...req,
    status: input.decision === 'APPROVE' ? 'APPROVED' : input.decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED',
    decidedAt: input.now,
    actorId: ctx.userId,
    comment: input.comment,
  };
}

export class ApprovalError extends Error {
  constructor(
    public readonly code: 'ALREADY_DECIDED' | 'DIGEST_MISMATCH' | 'STALE_TARGET' | 'FORBIDDEN' | 'STEP_UP_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}
