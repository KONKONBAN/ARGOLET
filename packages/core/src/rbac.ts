/**
 * RBAC / ABAC (board 03): permissions by role, scoped to legal entities, with approval
 * limits, delegations with expiry and separation of duties. The server evaluates the
 * effective permission on every request and resource — never trusting client/prompt scope.
 */
export type Role =
  | 'ORG_ADMIN'
  | 'ACCOUNTANT'
  | 'CHIEF_ACCOUNTANT'
  | 'APPROVER'
  | 'STAFF'
  | 'VIEWER'
  | 'AUDITOR'
  | 'CLIENT_DELEGATE'
  | 'GROUP_CONTROLLER';

export const ROLE_LABELS: Record<Role, string> = {
  ORG_ADMIN: 'Quản trị',
  ACCOUNTANT: 'Kế toán',
  CHIEF_ACCOUNTANT: 'Kế toán trưởng',
  APPROVER: 'Người duyệt',
  STAFF: 'Nhân viên',
  VIEWER: 'Chỉ xem',
  AUDITOR: 'Kiểm toán',
  CLIENT_DELEGATE: 'Ủy quyền khách hàng',
  GROUP_CONTROLLER: 'Kiểm soát tập đoàn',
};

export type Action =
  | 'workspace.read'
  | 'document.read'
  | 'document.create'
  | 'document.validate'
  | 'recon.read'
  | 'recon.run'
  | 'recon.confirm'
  | 'approval.request'
  | 'approval.decide'
  | 'period.read'
  | 'period.close'
  | 'evidence.read'
  | 'evidence.anchor'
  | 'evidence.verify'
  | 'finance.run'
  | 'module.write'
  | 'member.manage'
  | 'settings.manage'
  | 'assistant.use'
  | 'report.export'
  | 'audit.read';

const ALL_READ: Action[] = [
  'workspace.read',
  'document.read',
  'recon.read',
  'period.read',
  'evidence.read',
  'evidence.verify',
];

export const ROLE_PERMISSIONS: Record<Role, Action[]> = {
  // OrgAdmin manages the organisation but is deliberately separated from financial approval.
  ORG_ADMIN: [
    ...ALL_READ,
    'document.create',
    'member.manage',
    'settings.manage',
    'assistant.use',
    'report.export',
    'audit.read',
    'module.write',
    'approval.request',
  ],
  ACCOUNTANT: [
    ...ALL_READ,
    'document.create',
    'document.validate',
    'recon.run',
    'recon.confirm',
    'approval.request',
    'finance.run',
    'module.write',
    'assistant.use',
    'report.export',
  ],
  CHIEF_ACCOUNTANT: [
    ...ALL_READ,
    'document.create',
    'document.validate',
    'recon.run',
    'recon.confirm',
    'approval.request',
    'approval.decide',
    'period.close',
    'evidence.anchor',
    'finance.run',
    'module.write',
    'assistant.use',
    'report.export',
    'audit.read',
  ],
  APPROVER: [
    ...ALL_READ,
    'approval.decide',
    'period.close',
    'evidence.anchor',
    'assistant.use',
    'report.export',
  ],
  STAFF: [
    'workspace.read',
    'document.read',
    'document.create',
    'approval.request',
    'module.write',
    'assistant.use',
  ],
  VIEWER: [...ALL_READ, 'assistant.use'],
  AUDITOR: [...ALL_READ, 'audit.read', 'report.export'],
  CLIENT_DELEGATE: ['workspace.read', 'document.read', 'document.create', 'evidence.read', 'evidence.verify'],
  GROUP_CONTROLLER: [
    ...ALL_READ,
    'recon.run',
    'recon.confirm',
    'finance.run',
    'report.export',
    'assistant.use',
    'audit.read',
  ],
};

export interface RoleBinding {
  role: Role;
  /** Legal entities in scope; '*' = whole tenant. */
  entityIds: string[] | '*';
  /** Max amount the member may approve (VND). null = cannot approve, 'POLICY' = per policy table. */
  approvalLimit: string | null;
  validFrom?: string | undefined;
  validUntil?: string | undefined;
}

export interface AccessContext {
  userId: string;
  tenantId: string;
  bindings: RoleBinding[];
  now?: string;
  /** Authentication assurance level of the current session (1 = password, 2 = MFA / step-up). */
  aal: 1 | 2;
}

export interface AccessRequest {
  action: Action;
  entityId?: string | undefined;
  amount?: string | undefined;
  /** For approvals: the user that prepared the target (maker). */
  makerId?: string | undefined;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  requiresStepUp?: boolean;
}

export const STEP_UP_THRESHOLD_VND = 50_000_000;

function bindingActive(b: RoleBinding, now: string): boolean {
  if (b.validFrom && now < b.validFrom) return false;
  if (b.validUntil && now > b.validUntil) return false;
  return true;
}

export function authorize(ctx: AccessContext, req: AccessRequest): AccessDecision {
  const now = ctx.now ?? new Date().toISOString();
  const candidates = ctx.bindings.filter(
    (b) =>
      bindingActive(b, now) &&
      ROLE_PERMISSIONS[b.role].includes(req.action) &&
      (req.entityId === undefined || b.entityIds === '*' || b.entityIds.includes(req.entityId)),
  );
  if (candidates.length === 0) {
    const anyRole = ctx.bindings.some((b) => ROLE_PERMISSIONS[b.role].includes(req.action));
    return {
      allowed: false,
      reason: anyRole
        ? 'Ngoài phạm vi pháp nhân được cấp hoặc quyền đã hết hạn'
        : 'Vai trò hiện tại chưa có quyền thực hiện thao tác này',
    };
  }
  if (req.action === 'approval.decide') {
    if (req.makerId && req.makerId === ctx.userId) {
      return { allowed: false, reason: 'Người lập hồ sơ không được tự phê duyệt (tách biệt nhiệm vụ)' };
    }
    if (req.amount !== undefined) {
      const amount = Number(req.amount);
      const withinLimit = candidates.some(
        (b) =>
          b.approvalLimit === 'POLICY' || (b.approvalLimit !== null && Number(b.approvalLimit) >= amount),
      );
      if (!withinLimit) return { allowed: false, reason: 'Giá trị hồ sơ vượt hạn mức phê duyệt được cấp' };
      if (amount >= STEP_UP_THRESHOLD_VND && ctx.aal < 2) {
        return {
          allowed: false,
          reason: 'Chính sách yêu cầu xác thực bổ sung trước khi phê duyệt',
          requiresStepUp: true,
        };
      }
    }
  }
  return { allowed: true, reason: 'Được phép' };
}

export function permissionsOf(bindings: RoleBinding[]): Action[] {
  return [...new Set(bindings.flatMap((b) => ROLE_PERMISSIONS[b.role]))].sort();
}
