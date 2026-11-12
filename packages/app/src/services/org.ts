import { isValidTaxCode, newId, nextCode, normalizeEmail, isValidEmail, ROLE_LABELS, formatVnd, permissionsOf, type Role, type RoleBinding } from '@argolet/core';
import { type AppCore, actor, requireFound, requireText } from '../core';
import { AppError, type CallContext } from '../runtime';
import type { Tx } from '../store';
import { GLOBAL, type IntegrationRow, type LegalEntityRow, type MembershipRow, type TenantRow } from '../types';

export interface WorkspaceSummary {
  tenantId: string;
  name: string;
  roleLabel: string;
  scopeLabel: string;
  sites: number;
}

export interface WorkspaceContext {
  tenant: { id: string; name: string; orgType: string; settings: TenantRow['settings'] };
  member: { userId: string; displayName: string; title: string; roles: Role[]; roleLabel: string; permissions: string[] };
  scope: { entityId: string; label: string };
  entities: { id: string; name: string; shortName: string; code: string; kind: LegalEntityRow['kind']; parentId: string | null }[];
  counts: { inbox: number; unreadNotifications: number };
}

const ROLE_ORDER: Role[] = ['ORG_ADMIN', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT', 'APPROVER', 'GROUP_CONTROLLER', 'STAFF', 'AUDITOR', 'CLIENT_DELEGATE', 'VIEWER'];

export function primaryRole(bindings: RoleBinding[]): Role {
  return ROLE_ORDER.find((r) => bindings.some((b) => b.role === r)) ?? 'VIEWER';
}

export async function siteCount(tx: Tx, tenantId: string): Promise<number> {
  return (await tx.list('entities', tenantId, { kind: 'SITE' })).length;
}

export async function scopeLabel(tx: Tx, tenantId: string, entityId: string): Promise<string> {
  if (entityId === '*') return 'Tất cả cơ sở';
  const e = await tx.get('entities', tenantId, entityId);
  return e?.name ?? 'Tất cả cơ sở';
}

export class OrgService {
  constructor(private readonly core: AppCore) {}

  async listWorkspaces(call: CallContext): Promise<WorkspaceSummary[]> {
    return this.core.query(async (tx) => {
      const auth = await this.core.requireAuth(tx, call);
      const ms = await tx.findGlobal('memberships', { userId: auth.user.id, status: 'ACTIVE' });
      const out: WorkspaceSummary[] = [];
      for (const m of ms) {
        const t = await tx.get('tenants', m.tenantId, m.tenantId);
        if (!t) continue;
        const sites = await siteCount(tx, t.id);
        const entities = (await tx.list('entities', t.id, { kind: 'LEGAL_ENTITY' })).length;
        out.push({
          tenantId: t.id,
          name: t.name,
          roleLabel: ROLE_LABELS[primaryRole(m.bindings)] === 'Quản trị' ? 'Quản trị' : ROLE_LABELS[primaryRole(m.bindings)],
          scopeLabel: sites > 0 ? `${sites} cơ sở` : `${entities} pháp nhân`,
          sites,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    });
  }

  /** 03 · Chọn hoặc đổi tổ chức / pháp nhân (lưu trong phiên phía máy chủ). */
  async selectWorkspace(call: CallContext, p: { tenantId: string; entityId?: string }) {
    return this.core.command(call, async (tx) => {
      const auth = await this.core.requireAuth(tx, call);
      const [m] = await tx.list('memberships', p.tenantId ?? '', { userId: auth.user.id });
      if (!m || m.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Bạn không có quyền truy cập tổ chức này');
      const entityId = p.entityId ?? '*';
      if (entityId !== '*') {
        requireFound(await tx.get('entities', p.tenantId, entityId), 'cơ sở');
        const allowed = m.bindings.some((b) => b.entityIds === '*' || b.entityIds.includes(entityId));
        if (!allowed) throw new AppError('FORBIDDEN', 'Cơ sở nằm ngoài phạm vi được cấp');
      }
      await tx.put('sessions', { ...auth.session, activeTenantId: p.tenantId, activeEntityId: entityId });
      return { ok: true };
    });
  }

  async context(call: CallContext): Promise<WorkspaceContext> {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const entities = (await tx.list('entities', ws.tenantId)).sort((a, b) => a.code.localeCompare(b.code));
      const roles = [...new Set(ws.membership.bindings.map((b) => b.role))];
      const pendingApprovals = (await tx.list('approvals', ws.tenantId, { status: 'PENDING' })).filter((a) => a.makerId !== ws.user.id).length;
      const unread = (await tx.list('notifications', ws.tenantId, { status: 'UNREAD' })).filter((n) => !n.userId || n.userId === ws.user.id).length;
      return {
        tenant: { id: t.id, name: t.name, orgType: t.orgType, settings: t.settings },
        member: {
          userId: ws.user.id,
          displayName: ws.membership.displayName,
          title: ws.membership.title,
          roles,
          roleLabel: ROLE_LABELS[primaryRole(ws.membership.bindings)],
          permissions: permissionsOf(ws.membership.bindings),
        },
        scope: { entityId: ws.entityId, label: await scopeLabel(tx, ws.tenantId, ws.entityId) },
        entities: entities.map((e) => ({ id: e.id, name: e.name, shortName: e.shortName, code: e.code, kind: e.kind, parentId: e.parentId })),
        counts: { inbox: pendingApprovals, unreadNotifications: unread },
      };
    });
  }

  /** 03 · Khai báo tổ chức → tenant_id + legal_entity_id; người tạo là OrgAdmin. */
  async createOrganization(call: CallContext, p: { name: string; orgType: string; taxCode?: string }) {
    const name = requireText(p.name, 'Tên tổ chức', 120);
    const orgType = requireText(p.orgType, 'Loại hình', 80);
    const taxCode = (p.taxCode ?? '').trim();
    if (taxCode && !isValidTaxCode(taxCode)) throw new AppError('VALIDATION', 'Mã số thuế phải gồm 10 hoặc 13 chữ số', { field: 'taxCode' });
    return this.core.command(call, async (tx, em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      const tenantId = newId('ten');
      await tx.put('tenants', {
        id: tenantId,
        tenantId,
        name,
        orgType,
        taxCode: taxCode || null,
        policyVersion: 'policy-2026.10',
        settings: { currency: 'VND', timezone: 'Asia/Ho_Chi_Minh', periodType: 'MONTH', accountingRegime: 'TT133', packages: ['G1'], currentPeriod: now.slice(0, 7), dataLocation: 'Việt Nam' },
        createdBy: auth.user.id,
      });
      const entityId = newId('ent');
      await tx.put('entities', { id: entityId, tenantId, name, shortName: name, code: 'HQ', kind: 'LEGAL_ENTITY', parentId: null, baseCurrency: 'VND', timezone: 'Asia/Ho_Chi_Minh' });
      await tx.put('memberships', {
        id: newId('mem'),
        tenantId,
        userId: auth.user.id,
        displayName: auth.user.fullName,
        title: 'Quản trị tổ chức',
        // The founder runs the books of a new organisation: administration plus accounting
        // rights. Separation of duties still applies (nobody approves their own request).
        bindings: [
          { role: 'ORG_ADMIN', entityIds: '*', approvalLimit: null },
          { role: 'CHIEF_ACCOUNTANT', entityIds: '*', approvalLimit: 'POLICY' },
        ],
        status: 'ACTIVE',
        scopeLabel: 'Toàn tổ chức',
        limitLabel: 'Theo chính sách',
      });
      await tx.put('periods', { id: `per_${now.slice(0, 7)}_${entityId}`, tenantId, entityId, periodId: now.slice(0, 7), status: 'OPEN', closeMemoPrepared: false, closeId: null, version: 1 });
      for (const integ of defaultIntegrations(tenantId)) await tx.put('integrations', integ);
      await tx.put('sessions', { ...auth.session, activeTenantId: tenantId, activeEntityId: '*' });
      await em.emit({ type: 'TenantCreated', tenantId, entityId, aggregateType: 'Tenant', aggregateId: tenantId, actorId: auth.user.id, dataRef: `tenant/${tenantId}`, dataVersion: 1, data: { tenantId, entityId } });
      await em.audit(tenantId, { id: auth.user.id, name: auth.user.fullName }, 'tenant.create', tenantId, name);
      return { tenantId, entityId };
    });
  }

  async getInvitation(call: CallContext, p: { code: string }) {
    return this.core.query(async (tx, now) => {
      await this.core.requireAuth(tx, call);
      const [inv] = await tx.findGlobal('invitations', { code: (p.code ?? '').trim().toUpperCase() });
      if (!inv) throw new AppError('NOT_FOUND', 'Mã mời không tồn tại');
      const expired = inv.expiresAt < now;
      return {
        code: inv.code,
        orgName: inv.orgName,
        inviterName: inv.inviterName,
        roleLabel: ROLE_LABELS[inv.role],
        scopeLabel: inv.scopeLabel,
        permissionsLabel: inv.permissionsLabel,
        approvalLabel: inv.approvalLimit ? formatVnd(inv.approvalLimit) : 'Chưa cấp quyền',
        status: expired && inv.status === 'PENDING' ? 'EXPIRED' : inv.status,
        expiresAt: inv.expiresAt,
      };
    });
  }

  /** Đối chiếu lời mời còn hiệu lực với danh tính đã xác minh. */
  async respondInvitation(call: CallContext, p: { code: string; accept: boolean }) {
    return this.core.command(call, async (tx, em, now) => {
      const auth = await this.core.requireAuth(tx, call);
      const [inv] = await tx.findGlobal('invitations', { code: (p.code ?? '').trim().toUpperCase() });
      if (!inv) throw new AppError('NOT_FOUND', 'Mã mời không tồn tại');
      if (inv.status !== 'PENDING' || inv.expiresAt < now) throw new AppError('CONFLICT', 'Lời mời đã hết hiệu lực');
      if (auth.user.email && normalizeEmail(inv.email) !== auth.user.email) {
        throw new AppError('FORBIDDEN', 'Lời mời được gửi cho một email khác với tài khoản đang đăng nhập');
      }
      await tx.put('invitations', { ...inv, status: p.accept ? 'ACCEPTED' : 'DECLINED' });
      await tx.put('users', { ...auth.user, pendingInvitationCode: null });
      if (!p.accept) return { ok: true, tenantId: null };
      const [existing] = await tx.list('memberships', inv.orgTenantId, { userId: auth.user.id });
      await tx.put('memberships', {
        id: existing?.id ?? newId('mem'),
        tenantId: inv.orgTenantId,
        userId: auth.user.id,
        displayName: auth.user.fullName,
        title: ROLE_LABELS[inv.role],
        bindings: [{ role: inv.role, entityIds: inv.entityIds, approvalLimit: inv.approvalLimit }],
        status: 'ACTIVE',
        scopeLabel: inv.scopeLabel,
        limitLabel: inv.approvalLimit ? formatVnd(inv.approvalLimit) : 'Không cấp',
      });
      await tx.put('sessions', { ...auth.session, activeTenantId: inv.orgTenantId, activeEntityId: '*' });
      await em.audit(inv.orgTenantId, { id: auth.user.id, name: auth.user.fullName }, 'member.join', inv.code, ROLE_LABELS[inv.role]);
      return { ok: true, tenantId: inv.orgTenantId };
    });
  }

  async listMembers(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const ms = await tx.list('memberships', ws.tenantId);
      const invites = (await tx.findGlobal('invitations', { orgTenantId: ws.tenantId, status: 'PENDING' })).map((i) => ({
        id: i.id,
        name: i.email,
        roleLabel: ROLE_LABELS[i.role],
        scopeLabel: i.scopeLabel,
        limitLabel: i.approvalLimit ? formatVnd(i.approvalLimit) : 'Không cấp',
        statusLabel: 'Đã gửi lời mời',
        status: 'INVITED' as const,
        code: i.code,
      }));
      return {
        canManage: this.core.can(ws, 'member.manage'),
        members: [
          ...ms
            .sort((a, b) => ROLE_ORDER.indexOf(primaryRole(a.bindings)) - ROLE_ORDER.indexOf(primaryRole(b.bindings)) || a.createdAt.localeCompare(b.createdAt))
            .map((m) => ({
              id: m.id,
              name: m.displayName,
              roleLabel: ROLE_LABELS[primaryRole(m.bindings)],
              scopeLabel: m.scopeLabel,
              limitLabel: m.limitLabel,
              statusLabel: m.status === 'ACTIVE' ? 'Đang hoạt động' : 'Tạm ngưng',
              status: m.status,
              code: null as string | null,
              isSelf: m.userId === ws.user.id,
            })),
          ...invites.map((i) => ({ ...i, isSelf: false })),
        ],
      };
    });
  }

  async inviteMember(call: CallContext, p: { email: string; role: Role; entityIds?: string[] | '*'; approvalLimit?: string | null }) {
    const email = normalizeEmail(p.email ?? '');
    if (!isValidEmail(email)) throw new AppError('VALIDATION', 'Email không hợp lệ', { field: 'email' });
    if (!ROLE_LABELS[p.role]) throw new AppError('VALIDATION', 'Vai trò không hợp lệ', { field: 'role' });
    if (p.approvalLimit && !/^\d+$/.test(p.approvalLimit)) throw new AppError('VALIDATION', 'Hạn mức duyệt phải là số', { field: 'approvalLimit' });
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'member.manage');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const entityIds = p.entityIds ?? '*';
      let scope = 'Toàn tổ chức';
      if (entityIds !== '*') {
        const names: string[] = [];
        for (const id of entityIds) names.push(requireFound(await tx.get('entities', ws.tenantId, id), 'cơ sở').name);
        scope = names.join(', ');
      }
      const code = `INV-${newId('x').slice(-6)}`;
      await tx.put('invitations', {
        id: newId('inv'),
        tenantId: GLOBAL,
        orgTenantId: ws.tenantId,
        orgName: t.name,
        code,
        email,
        role: p.role,
        entityIds,
        scopeLabel: scope,
        permissionsLabel: describePermissions(p.role),
        approvalLimit: p.approvalLimit ?? null,
        invitedBy: ws.user.id,
        inviterName: ws.membership.displayName,
        expiresAt: new Date(Date.parse(now) + 7 * 86_400_000).toISOString(),
        status: 'PENDING',
      });
      await em.emit({ type: 'MemberInvited', tenantId: ws.tenantId, entityId: null, aggregateType: 'Tenant', aggregateId: ws.tenantId, actorId: ws.user.id, dataRef: `invitation/${code}`, dataVersion: 1, data: { code, role: p.role } });
      await em.audit(ws.tenantId, actor(ws), 'member.invite', code, ROLE_LABELS[p.role]);
      const base = this.core.deps.config.publicBaseUrl.replace(/\/$/, '');
      await this.core.deps.notifier.sendInvitation?.(email, { organization: t.name, inviter: ws.membership.displayName, roleLabel: ROLE_LABELS[p.role], code, link: `${base}/#/invite?code=${encodeURIComponent(code)}` });
      return { code };
    });
  }

  async updateMember(call: CallContext, p: { membershipId: string; status?: 'ACTIVE' | 'SUSPENDED'; role?: Role; approvalLimit?: string | null }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'member.manage');
      const m = requireFound(await tx.get('memberships', ws.tenantId, p.membershipId), 'thành viên');
      if (m.userId === ws.user.id && p.status === 'SUSPENDED') throw new AppError('VALIDATION', 'Không thể tự tạm ngưng tài khoản của mình');
      const next: MembershipRow = { ...m };
      if (p.status) next.status = p.status;
      if (p.role) {
        next.bindings = [{ role: p.role, entityIds: m.bindings[0]?.entityIds ?? '*', approvalLimit: p.approvalLimit ?? null }];
        next.title = ROLE_LABELS[p.role];
        next.limitLabel = p.approvalLimit ? formatVnd(p.approvalLimit) : 'Không cấp';
      }
      // Never leave the tenant without an organisation administrator.
      const all = await tx.list('memberships', ws.tenantId);
      const admins = all.filter((x) => (x.id === next.id ? next : x)).filter((x) => x.status === 'ACTIVE' && x.bindings.some((b) => b.role === 'ORG_ADMIN'));
      if (admins.length === 0) throw new AppError('VALIDATION', 'Tổ chức cần ít nhất một quản trị đang hoạt động');
      await tx.put('memberships', next);
      await em.audit(ws.tenantId, actor(ws), 'member.update', m.displayName, JSON.stringify({ status: p.status, role: p.role }));
      return { ok: true };
    });
  }

  async settings(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const integrations = await tx.list('integrations', ws.tenantId);
      const audit = (await tx.list('audit', ws.tenantId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
      return {
        canManage: this.core.can(ws, 'settings.manage'),
        tenant: { name: t.name, orgType: t.orgType, taxCode: t.taxCode, settings: t.settings },
        entities: await (async () => {
          const all = await tx.list('entities', ws.tenantId);
          const byId = new Map(all.map((e) => [e.id, e]));
          return all
            .sort((a, b) => (a.kind === b.kind ? a.code.localeCompare(b.code) : a.kind === 'LEGAL_ENTITY' ? -1 : 1))
            .map((e) => ({ id: e.id, name: e.name, code: e.code, kind: e.kind, kindLabel: e.kind === 'LEGAL_ENTITY' ? 'Pháp nhân' : 'Cơ sở', parentName: e.parentId ? byId.get(e.parentId)?.name ?? '' : '' }));
        })(),
        integrations: integrations.sort((a, b) => a.name.localeCompare(b.name, 'vi')),
        audit: audit.map((a) => ({ at: a.createdAt, actor: a.actorName, action: a.action, target: a.target, detail: a.detail })),
      };
    });
  }

  async updateSettings(call: CallContext, p: { name?: string; accountingRegime?: TenantRow['settings']['accountingRegime']; packages?: TenantRow['settings']['packages']; currentPeriod?: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const next = { ...t, settings: { ...t.settings } };
      if (p.name !== undefined) next.name = requireText(p.name, 'Tên tổ chức', 120);
      if (p.accountingRegime) {
        if (!['TT133', 'TT200', 'HKD'].includes(p.accountingRegime)) throw new AppError('VALIDATION', 'Chế độ kế toán không hợp lệ');
        next.settings.accountingRegime = p.accountingRegime;
      }
      if (p.packages) {
        if (p.packages.length === 0 || p.packages.some((x) => !['G1', 'G2', 'G3', 'G4'].includes(x))) throw new AppError('VALIDATION', 'Gói nghiệp vụ không hợp lệ');
        next.settings.packages = p.packages;
      }
      if (p.currentPeriod !== undefined) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.currentPeriod)) throw new AppError('VALIDATION', 'Kỳ làm việc phải có dạng YYYY-MM', { field: 'currentPeriod' });
        next.settings.currentPeriod = p.currentPeriod;
      }
      await tx.put('tenants', next);
      await em.audit(ws.tenantId, actor(ws), 'settings.update', ws.tenantId, JSON.stringify(p));
      return { ok: true };
    });
  }

  /** Thêm cơ sở (cửa hàng, chi nhánh) hoặc pháp nhân (công ty con) vào cơ cấu tổ chức. */
  async addEntity(call: CallContext, p: { kind: 'SITE' | 'LEGAL_ENTITY'; name: string; parentId?: string }) {
    if (p.kind !== 'SITE' && p.kind !== 'LEGAL_ENTITY') throw new AppError('VALIDATION', 'Loại đơn vị không hợp lệ', { field: 'kind' });
    const name = requireText(p.name, p.kind === 'SITE' ? 'Tên cơ sở' : 'Tên pháp nhân', 120);
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const all = await tx.list('entities', ws.tenantId);
      if (all.some((e) => e.name.toLowerCase() === name.toLowerCase())) throw new AppError('CONFLICT', `Đơn vị "${name}" đã tồn tại`, { field: 'name' });
      const legal = all.filter((e) => e.kind === 'LEGAL_ENTITY');
      let parentId: string | null = null;
      if (p.kind === 'SITE') {
        const parent = p.parentId ? legal.find((e) => e.id === p.parentId) : legal[0];
        parentId = requireFound(parent, 'pháp nhân quản lý').id;
      }
      const prefix = p.kind === 'SITE' ? 'CS' : 'PN';
      const code = nextCode(prefix, all.map((e) => e.code), 2, 1);
      const id = newId('ent');
      await tx.put('entities', { id, tenantId: ws.tenantId, name, shortName: name, code, kind: p.kind, parentId, baseCurrency: 'VND', timezone: 'Asia/Ho_Chi_Minh' });
      await em.audit(ws.tenantId, actor(ws), 'entity.add', code, name);
      return { id, code };
    });
  }

  /** Cấp kết nối nguồn theo tenant / phạm vi dữ liệu. */
  async setIntegration(call: CallContext, p: { integrationId: string; connect: boolean }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const integ = requireFound(await tx.get('integrations', ws.tenantId, p.integrationId), 'kết nối');
      const next: IntegrationRow = { ...integ, status: p.connect ? 'CONNECTED' : 'AVAILABLE', connectedAt: p.connect ? now : null };
      await tx.put('integrations', next);
      await em.audit(ws.tenantId, actor(ws), p.connect ? 'integration.connect' : 'integration.disconnect', integ.name);
      return next;
    });
  }
}

export function describePermissions(role: Role): string {
  return (
    {
      ORG_ADMIN: 'Quản trị tổ chức, thành viên, cài đặt',
      ACCOUNTANT: 'Xem, lập, gửi hồ sơ',
      CHIEF_ACCOUNTANT: 'Xem, lập, duyệt, chốt kỳ',
      APPROVER: 'Xem và phê duyệt trong hạn mức',
      STAFF: 'Lập và gửi chứng từ',
      VIEWER: 'Chỉ xem',
      AUDITOR: 'Xem và kiểm chứng',
      CLIENT_DELEGATE: 'Gửi chứng từ theo ủy quyền',
      GROUP_CONTROLLER: 'Xem và đối soát nội bộ',
    } as Record<Role, string>
  )[role];
}

export function defaultIntegrations(tenantId: string): (Omit<IntegrationRow, 'createdAt' | 'updatedAt' | 'rev'>)[] {
  const mk = (kind: IntegrationRow['kind'], name: string, description: string): Omit<IntegrationRow, 'createdAt' | 'updatedAt' | 'rev'> => ({
    id: `int_${kind.toLowerCase()}`,
    tenantId,
    kind,
    name,
    description,
    status: 'AVAILABLE',
    scope: 'Toàn tổ chức',
    connectedAt: null,
  });
  return [
    mk('POS', 'Máy bán hàng / POS', 'Đơn hàng · doanh thu · chốt ca'),
    mk('PLATFORM', 'Nền tảng giao đồ ăn', 'Đơn gộp · chiết khấu · phí'),
    mk('BANK', 'Ngân hàng & QR', 'Sao kê · tiền về theo đợt'),
    mk('EINVOICE', 'Hóa đơn điện tử', 'XML · email · bản thể hiện'),
    mk('PAPER', 'Chứng từ giấy / ảnh', 'Phiếu giao · biên nhận'),
    mk('EXCEL', 'Hợp đồng & Excel', 'Dự án · lô hàng · nội bộ'),
  ];
}
