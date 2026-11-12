import { decide, formatDate, formatVnd, ApprovalError, sum, D, type ApprovalRequest } from '@argolet/core';
import { type AppCore, actor, requireFound, paginate, type PageParams } from '../core';
import { AppError, type CallContext, type Emitter, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { ApprovalRow } from '../types';
import { scoped } from './documents';
import { findGroup, groupDigest, type ReconService } from './recon';

export const APPROVAL_STATUS_LABEL: Record<ApprovalRow['status'], string> = {
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã phê duyệt',
  REJECTED: 'Đã từ chối',
  CHANGES_REQUESTED: 'Yêu cầu bổ sung',
};

export function relativeDay(date: string, today: string): string {
  if (date === today) return 'Hôm nay';
  const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86_400_000);
  if (diff === 1) return 'Ngày mai';
  if (diff === -1) return 'Hôm qua';
  return formatDate(date);
}

export class ApprovalService {
  constructor(private readonly core: AppCore, private readonly recon: ReconService) {}

  /** Màn 10 · Hộp công việc: phê duyệt, xác nhận đối soát, bổ sung chứng từ, rà soát chốt kỳ. */
  async inbox(call: CallContext, p: { q?: string; kind?: 'APPROVAL' | 'MATCH' | 'DOCUMENT' | 'PERIOD' } & PageParams = {}) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const today = localDate(now);
      const approvals = (await scoped(tx, ws, 'approvals')).filter((a) => a.status === 'PENDING');
      const mine = approvals.filter((a) => a.makerId !== ws.user.id && this.core.can(ws, 'approval.decide', a.entityId));
      const groups = (await scoped(tx, ws, 'matchGroups')).filter((g) => g.status === 'PROPOSED');
      const docs = (await scoped(tx, ws, 'documents')).filter((d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON');
      const periods = (await tx.list('periods', ws.tenantId)).filter((x) => x.status === 'REVIEW' && (ws.entityId === '*' || x.entityId === ws.entityId));
      const sites = new Map((await tx.list('entities', ws.tenantId)).map((e) => [e.id, e]));
      const users = new Map((await tx.list('memberships', ws.tenantId)).map((m) => [m.userId, m.displayName]));
      type Item = { id: string; kind: 'APPROVAL' | 'MATCH' | 'DOCUMENT' | 'PERIOD'; title: string; sender: string; due: string; dueLabel: string; value: string; status: string; tone: 'warning' | 'neutral' | 'success'; route: string };
      const items: Item[] = [
        ...mine.map((a) => ({ id: a.id, kind: 'APPROVAL' as const, title: a.title, sender: a.requesterName, due: a.dueDate, dueLabel: relativeDay(a.dueDate, today), value: formatVnd(a.amount), status: 'Chờ duyệt', tone: 'warning' as const, route: `/approvals/${a.id}` })),
        ...groups.map((g) => ({ id: g.id, kind: 'MATCH' as const, title: `Xác nhận nhóm ${g.code}`, sender: users.get(g.confirmedBy ?? '') ?? 'Động cơ đối soát', due: g.createdAt.slice(0, 10) > today ? g.createdAt.slice(0, 10) : today, dueLabel: relativeDay(g.createdAt.slice(0, 10) > today ? g.createdAt.slice(0, 10) : today, today), value: formatVnd(g.received), status: 'Cần xác nhận', tone: 'warning' as const, route: `/reconciliation/${g.id}` })),
        ...docs.map((d) => ({ id: d.id, kind: 'DOCUMENT' as const, title: `Bổ sung ${d.title.toLowerCase()}`, sender: users.get(d.receivedBy) ?? '—', due: addDays(d.receivedAt.slice(0, 10), 1), dueLabel: relativeDay(addDays(d.receivedAt.slice(0, 10), 1), today), value: formatVnd(d.amount), status: 'Cần bổ sung', tone: 'neutral' as const, route: `/documents/${d.id}/review` })),
        ...periods.map((pr) => ({ id: pr.id, kind: 'PERIOD' as const, title: `Chốt kỳ ${sites.get(pr.entityId)?.name.replace('Cơ sở ', 'cơ sở ') ?? ''}`.trim(), sender: 'Kế toán', due: closeDueDate(pr.periodId), dueLabel: relativeDay(closeDueDate(pr.periodId), today), value: `Tháng ${Number(pr.periodId.slice(5))}`, status: 'Chờ rà soát', tone: 'neutral' as const, route: '/close' })),
      ];
      const order = { APPROVAL: 0, MATCH: 1, DOCUMENT: 2, PERIOD: 3 };
      items.sort((a, b) => order[a.kind] - order[b.kind] || a.due.localeCompare(b.due));
      let shown = p.kind ? items.filter((i) => i.kind === p.kind) : items;
      if (p.q) {
        const q = p.q.toLowerCase();
        shown = shown.filter((i) => `${i.title} ${i.sender}`.toLowerCase().includes(q));
      }
      return {
        kpis: {
          toApprove: mine.length,
          toSupplement: docs.length,
          dueToday: items.filter((i) => i.due === today).length,
          approvalsAmount: formatVnd(sum(mine.map((a) => a.amount))),
          discrepancies: (await scoped(tx, ws, 'matchGroups')).filter((g) => g.status === 'DISCREPANCY').length,
        },
        ...paginate(shown, p, 20),
      };
    });
  }

  async get(call: CallContext, p: { approvalId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const a = requireFound(await tx.get('approvals', ws.tenantId, p.approvalId), 'hồ sơ phê duyệt');
      if (ws.entityId !== '*' && a.entityId !== ws.entityId) throw new AppError('NOT_FOUND', 'Không tìm thấy hồ sơ phê duyệt');
      const canDecide = a.status === 'PENDING' && a.makerId !== ws.user.id && this.core.can(ws, 'approval.decide', a.entityId);
      const decision = this.core.can(ws, 'approval.decide', a.entityId)
        ? (await import('@argolet/core')).authorize(ws.access, { action: 'approval.decide', entityId: a.entityId, amount: a.amount, makerId: a.makerId })
        : { allowed: false, reason: 'Vai trò hiện tại chưa có quyền phê duyệt', requiresStepUp: false };
      return {
        approval: { ...a, amountLabel: formatVnd(a.amount), statusLabel: a.status === 'PENDING' && canDecide ? 'Chờ bạn phê duyệt' : APPROVAL_STATUS_LABEL[a.status] },
        canDecide,
        requiresStepUp: !!decision.requiresStepUp,
        blockedReason: canDecide ? (decision.allowed || decision.requiresStepUp ? null : decision.reason) : a.status !== 'PENDING' ? null : a.makerId === ws.user.id ? 'Người lập hồ sơ không được tự phê duyệt' : decision.reason,
        roleNote: `Quyền hiện tại: ${ws.membership.title.toLowerCase()}. Mỗi quyết định được ghi lại cùng người thực hiện, thời gian và phạm vi.`,
      };
    });
  }

  async list(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      return (await scoped(tx, ws, 'approvals'))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((a) => ({ id: a.id, title: a.title, amountLabel: formatVnd(a.amount), status: a.status, statusLabel: APPROVAL_STATUS_LABEL[a.status], requesterName: a.requesterName, createdAt: a.createdAt }));
    });
  }

  /** Quyết định phê duyệt gắn target_version + digest; thực thi lệnh đã duyệt trong cùng giao dịch. */
  async decide(call: CallContext, p: { approvalId: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES'; digest: string; comment?: string }) {
    if (!['APPROVE', 'REJECT', 'REQUEST_CHANGES'].includes(p.decision)) throw new AppError('VALIDATION', 'Quyết định không hợp lệ');
    if ((p.decision === 'REJECT' || p.decision === 'REQUEST_CHANGES') && !p.comment?.trim()) {
      throw new AppError('VALIDATION', 'Vui lòng ghi rõ nội dung cần bổ sung hoặc lý do từ chối', { field: 'comment' });
    }
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const a = requireFound(await tx.get('approvals', ws.tenantId, p.approvalId), 'hồ sơ phê duyệt');
      const current = await this.currentTarget(tx, ws, a);
      let decided: ApprovalRequest;
      try {
        decided = decide({ ...a, tenantId: ws.tenantId }, ws.access, {
          decision: p.decision,
          seenDigest: p.digest,
          currentDigest: current.digest,
          currentVersion: current.version,
          comment: p.comment ?? '',
          now,
        });
      } catch (e) {
        if (e instanceof ApprovalError) {
          const code = e.code === 'STEP_UP_REQUIRED' ? 'STEP_UP_REQUIRED' : e.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'CONFLICT';
          throw new AppError(code, e.message, { reason: e.code });
        }
        throw e;
      }
      const label = { APPROVE: 'Đã phê duyệt', REJECT: 'Đã từ chối', REQUEST_CHANGES: 'Yêu cầu bổ sung' }[p.decision];
      const saved = await tx.put('approvals', {
        ...a,
        status: decided.status,
        decidedAt: now,
        actorId: ws.user.id,
        comment: p.comment ?? '',
        timeline: [...a.timeline, { title: label, by: ws.membership.displayName, at: now }],
      });
      if (decided.status === 'APPROVED') {
        await this.executeApproved(tx, ws, saved, now, em);
        await em.emit({ type: 'ApprovalGranted', tenantId: ws.tenantId, entityId: a.entityId, aggregateType: 'Approval', aggregateId: a.id, actorId: ws.user.id, dataRef: `approval/${a.id}`, dataVersion: a.targetVersion, data: { approvalId: a.id, targetType: a.targetType, targetId: a.targetId, digest: a.digest, policyVersion: a.policyVersion } });
      } else {
        await this.revertTarget(tx, ws, saved);
        await em.emit({ type: 'ApprovalRejected', tenantId: ws.tenantId, entityId: a.entityId, aggregateType: 'Approval', aggregateId: a.id, actorId: ws.user.id, dataRef: `approval/${a.id}`, dataVersion: a.targetVersion, data: { approvalId: a.id, decision: p.decision } });
      }
      await em.audit(ws.tenantId, actor(ws), `approval.${p.decision.toLowerCase()}`, a.title, a.digest.slice(0, 16));
      return { status: decided.status };
    });
  }

  private async currentTarget(tx: Tx, ws: WorkspaceState, a: ApprovalRow): Promise<{ digest: string; version: number }> {
    if (a.targetType === 'MATCH_GROUP') {
      const g = await findGroup(tx, ws.tenantId, a.targetId);
      // The group moved to PENDING_APPROVAL without changing its content/version.
      return { digest: groupDigest(g), version: g.version };
    }
    if (a.targetType === 'EXPENSE') {
      const po = await tx.get('purchaseOrders', ws.tenantId, a.targetId);
      if (po) {
        const { targetDigest } = await import('@argolet/core');
        return { digest: targetDigest({ code: po.code, supplier: po.supplier, amount: po.amount, dueDate: po.dueDate }), version: po.rev };
      }
    }
    // Other targets are immutable once submitted (digest pinned at request time).
    return { digest: a.digest, version: a.targetVersion };
  }

  private async executeApproved(tx: Tx, ws: WorkspaceState, a: ApprovalRow, now: string, em: Emitter): Promise<void> {
    if (a.targetType === 'MATCH_GROUP') {
      const g = await findGroup(tx, ws.tenantId, a.targetId);
      await this.recon.confirmInTx(tx, ws, { ...g, status: 'PROPOSED' }, groupDigest(g), now, em);
    } else if (a.targetType === 'EXPENSE') {
      const po = await tx.get('purchaseOrders', ws.tenantId, a.targetId);
      if (po && po.status === 'PENDING_APPROVAL') await tx.put('purchaseOrders', { ...po, status: 'AWAITING_INVOICE' });
    } else if (a.targetType === 'DAILY_CLOSE') {
      const dc = await tx.get('dailyCloses', ws.tenantId, a.targetId);
      if (dc) await tx.put('dailyCloses', { ...dc, status: 'SUBMITTED' });
    } else if (a.targetType === 'ALLOCATION') {
      const sh = await tx.get('shipments', ws.tenantId, a.targetId);
      if (sh) await tx.put('shipments', { ...sh, allocationConfirmed: true });
    }
  }

  private async revertTarget(tx: Tx, ws: WorkspaceState, a: ApprovalRow): Promise<void> {
    if (a.targetType === 'MATCH_GROUP') {
      const g = await findGroup(tx, ws.tenantId, a.targetId);
      if (g.status === 'PENDING_APPROVAL') await tx.put('matchGroups', { ...g, status: D(g.residual).isZero() ? 'PROPOSED' : 'DISCREPANCY', approvalId: null });
    }
  }
}

export function localDate(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date.slice(0, 10) + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

/** Close deadline: the 2nd day of the following month. */
export function closeDueDate(periodId: string): string {
  const [y, m] = periodId.split('-').map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-02`;
}
