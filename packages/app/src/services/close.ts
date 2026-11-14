import {
  buildXlsx,
  XLSX_MIME,
  type XCell,
  buildSnapshotManifest,
  closeChecklist,
  formatPeriod,
  formatVnd,
  manifestDigest,
  newId,
  sum,
  targetDigest,
  APPROVAL_POLICY_VERSION,
  DEFAULT_RULES,
  formatSignedVnd,
  D,
} from '@argolet/core';
import { type AppCore, actor, requireFound } from '../core';
import { AppError, type CallContext, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { PeriodRow } from '../types';
import { defaultSite } from './documents';
import { scopeLabel } from './org';

async function periodFor(tx: Tx, ws: WorkspaceState, entityId: string, periodId: string): Promise<PeriodRow> {
  const id = `per_${periodId}_${entityId}`;
  const existing = await tx.get('periods', ws.tenantId, id);
  if (existing) return existing;
  return {
    id,
    tenantId: ws.tenantId,
    entityId,
    periodId,
    status: 'OPEN',
    closeMemoPrepared: false,
    closeId: null,
    version: 1,
    createdAt: '',
    updatedAt: '',
    rev: 0,
  };
}

function nextPeriodId(periodId: string): string {
  const [y, m] = periodId.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Units that close their own books: sites, or the legal entities when there are no sites. */
export async function closingUnits(tx: Tx, tenantId: string): Promise<string[]> {
  const sites = await tx.list('entities', tenantId, { kind: 'SITE' });
  if (sites.length) return sites.map((s) => s.id);
  return (await tx.list('entities', tenantId, { kind: 'LEGAL_ENTITY' })).map((e) => e.id);
}

/** Once every unit has closed the organisation's current period, work moves on to the next month. */
async function advancePeriodIfComplete(tx: Tx, tenantId: string, periodId: string): Promise<void> {
  const tenant = requireFound(await tx.get('tenants', tenantId, tenantId), 'tổ chức');
  if (tenant.settings.currentPeriod !== periodId) return;
  const units = await closingUnits(tx, tenantId);
  for (const u of units) {
    const row = await tx.get('periods', tenantId, `per_${periodId}_${u}`);
    if (row?.status !== 'CLOSED') return;
  }
  await tx.put('tenants', {
    ...tenant,
    settings: { ...tenant.settings, currentPeriod: nextPeriodId(periodId) },
  });
}

export class CloseService {
  constructor(private readonly core: AppCore) {}

  private async gather(tx: Tx, ws: WorkspaceState, entityId: string | '*', periodId: string) {
    const inScope = (e: string) => entityId === '*' || e === entityId;
    const docs = (await tx.list('documents', ws.tenantId)).filter(
      (d) => inScope(d.entityId) && d.date.startsWith(periodId) && d.status !== 'REJECTED',
    );
    const groups = (await tx.list('matchGroups', ws.tenantId)).filter(
      (g) => inScope(g.entityId) && g.periodId === periodId,
    );
    const approvals = (await tx.list('approvals', ws.tenantId)).filter(
      (a) => inScope(a.entityId) && a.status === 'PENDING' && a.targetType !== 'PERIOD_CLOSE',
    );
    const records = (await tx.list('records', ws.tenantId)).filter(
      (r) => inScope(r.entityId) && r.periodId === periodId,
    );
    return { docs, groups, approvals, records };
  }

  private checklistFrom(g: Awaited<ReturnType<CloseService['gather']>>, memo: boolean) {
    return closeChecklist({
      documentsTotal: g.docs.length,
      documentsValidated: g.docs.filter((d) => d.status === 'VALIDATED').length,
      groupsTotal: g.groups.length,
      groupsConfirmed: g.groups.filter((x) => x.status === 'CONFIRMED').length,
      unexplainedDiscrepancies: g.groups.filter((x) => x.status === 'DISCREPANCY').length,
      pendingApprovals: g.approvals.length,
      closeMemoPrepared: memo,
    });
  }

  /** Màn 17 · Chốt kỳ dữ liệu: rà soát điều kiện và phạm vi. */
  async status(call: CallContext, p: { entityId?: string; periodId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'period.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const entityId = p.entityId ?? (ws.entityId !== '*' ? ws.entityId : await defaultSite(tx, ws.tenantId));
      const periodId = p.periodId ?? tenant.settings.currentPeriod;
      const period = await periodFor(tx, ws, entityId, periodId);
      const g = await this.gather(tx, ws, entityId, periodId);
      const memo = period.status === 'CLOSED' || this.checklistFrom(g, false).ready;
      const cl = this.checklistFrom(g, memo);
      const snapshot = period.closeId
        ? await tx.get('closeSnapshots', ws.tenantId, period.closeId)
        : undefined;
      const draft = await this.draftManifest(tx, ws, entityId, periodId, g);
      const entityLabel = await scopeLabel(tx, ws.tenantId, entityId);
      const site = await tx.get('entities', ws.tenantId, entityId);
      const legal = site?.parentId ? await tx.get('entities', ws.tenantId, site.parentId) : site;
      return {
        periodId,
        periodLabel: `Kỳ ${formatPeriod(periodId).replace('Tháng', 'tháng')}`,
        scopeLabel: legal && legal.id !== entityId ? `${legal.shortName} · ${entityLabel}` : entityLabel,
        entityId,
        status: period.status,
        checklist: cl.items,
        blocking: cl.blocking,
        ready: cl.ready && period.status !== 'CLOSED',
        pendingApprovals: g.approvals.map((a) => ({ id: a.id, title: a.title })),
        draftDigest: manifestDigest(draft),
        canClose: this.core.can(ws, 'period.close', entityId),
        aal: ws.session.aal,
        snapshot: snapshot
          ? {
              closeId: snapshot.id,
              version: snapshot.version,
              closedAt: snapshot.closedAt,
              evidenceStatus: snapshot.evidenceStatus,
              digest: snapshot.manifestDigest,
              totals: snapshot.manifest.totals,
            }
          : null,
        roleNote: `Quyền hiện tại: ${ws.membership.title.toLowerCase()}. Mỗi quyết định được ghi lại cùng người thực hiện, thời gian và phạm vi.`,
      };
    });
  }

  private async draftManifest(
    tx: Tx,
    ws: WorkspaceState,
    entityId: string,
    periodId: string,
    g: Awaited<ReturnType<CloseService['gather']>>,
  ) {
    const period = await periodFor(tx, ws, entityId, periodId);
    const previous = (await tx.list('closeSnapshots', ws.tenantId, { entityId })).sort((a, b) =>
      b.closedAt.localeCompare(a.closedAt),
    )[0];
    const artifacts = new Map((await tx.list('artifacts', ws.tenantId)).map((a) => [a.id, a]));
    const docs = new Map(g.docs.map((d) => [d.id, d]));
    return buildSnapshotManifest({
      tenantId: ws.tenantId,
      closeId: `close_${periodId}_${entityId}`,
      entityId,
      periodId,
      closeVersion: period.version,
      previousCloseId: previous?.id ?? null,
      rulesVersion: DEFAULT_RULES.rulesVersion,
      members: g.records.map((r) => {
        const d = r.documentId ? docs.get(r.documentId) : undefined;
        const art = d?.artifactId ? artifacts.get(d.artifactId) : undefined;
        return {
          recordId: r.recordId,
          recordVersion: r.version,
          kind:
            r.kind === 'ORDER' || r.kind === 'REVENUE'
              ? 'REVENUE'
              : r.kind === 'EXPENSE'
                ? 'EXPENSE'
                : r.kind,
          amount: r.amount,
          artifactId: art?.id,
          rawSha256: art?.rawSha256,
        };
      }),
      approvals: [],
    });
  }

  /**
   * Xác lập bộ chốt: kiểm tra điều kiện, xác thực bổ sung, rồi trong MỘT giao dịch ghi
   * Approval (gắn digest), CloseSnapshot, trạng thái CLOSED, PeriodClosed + Outbox.
   */
  async close(call: CallContext, p: { entityId: string; periodId: string; digest: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'period.close', { entityId: p.entityId });
      requireFound(await tx.get('entities', ws.tenantId, p.entityId), 'cơ sở');
      const period = await periodFor(tx, ws, p.entityId, p.periodId);
      if (period.status === 'CLOSED') throw new AppError('CONFLICT', 'Kỳ đã được chốt');
      if (ws.session.aal < 2)
        throw new AppError('STEP_UP_REQUIRED', 'Chính sách yêu cầu xác thực bổ sung trước khi chốt kỳ', {
          reason: 'STEP_UP',
        });
      const g = await this.gather(tx, ws, p.entityId, p.periodId);
      const cl = this.checklistFrom(g, true);
      if (!cl.ready)
        throw new AppError('VALIDATION', `Cần hoàn tất ${cl.blocking} việc trước khi chốt`, {
          checklist: cl.items,
        });
      const draft = await this.draftManifest(tx, ws, p.entityId, p.periodId, g);
      if (manifestDigest(draft) !== p.digest)
        throw new AppError('CONFLICT', 'Số liệu kỳ đã thay đổi sau khi bạn rà soát, vui lòng tải lại');
      const approvalId = newId('apv');
      const digest = targetDigest(draft);
      await tx.put('approvals', {
        id: approvalId,
        tenantId: ws.tenantId,
        approvalId,
        entityId: p.entityId,
        targetType: 'PERIOD_CLOSE',
        targetId: draft.closeId,
        targetVersion: draft.closeVersion,
        digest,
        amount: draft.totals.net ?? '0',
        title: `Chốt ${formatPeriod(p.periodId).toLowerCase()}`,
        makerId: 'system',
        status: 'APPROVED',
        policyVersion: APPROVAL_POLICY_VERSION,
        requesterName: 'Hệ thống',
        entityLabel: await scopeLabel(tx, ws.tenantId, p.entityId),
        details: [
          { label: 'Doanh thu', value: formatVnd(draft.totals.revenue ?? '0') },
          { label: 'Chi phí', value: formatVnd(draft.totals.expense ?? '0') },
          { label: 'Bản ghi', value: String(draft.members.length) },
        ],
        timeline: [{ title: 'Đã phê duyệt chốt kỳ', by: ws.membership.displayName, at: now }],
        dueDate: now.slice(0, 10),
        decidedAt: now,
        actorId: ws.user.id,
        createdAt: now,
      });
      const manifest = { ...draft, approvals: [{ approvalId, digest, actorId: ws.user.id }] };
      const closeId = draft.closeId + (period.version > 1 ? `_v${period.version}` : '');
      await tx.put('closeSnapshots', {
        id: closeId,
        tenantId: ws.tenantId,
        entityId: p.entityId,
        periodId: p.periodId,
        version: period.version,
        previousCloseId: draft.previousCloseId,
        rulesVersion: draft.rulesVersion,
        manifest: { ...manifest, closeId },
        manifestDigest: manifestDigest({ ...manifest, closeId }),
        approvalIds: [approvalId],
        closedBy: ws.user.id,
        closedAt: now,
        evidenceStatus: 'PENDING',
      });
      await tx.put('periods', {
        ...period,
        status: 'CLOSED',
        closeMemoPrepared: true,
        closeId,
        version: period.version,
      });
      await advancePeriodIfComplete(tx, ws.tenantId, p.periodId);
      await em.emit({
        type: 'PeriodClosed',
        tenantId: ws.tenantId,
        entityId: p.entityId,
        aggregateType: 'Period',
        aggregateId: period.id,
        actorId: ws.user.id,
        dataRef: `close/${closeId}`,
        dataVersion: period.version,
        data: { closeId, periodId: p.periodId, version: period.version },
      });
      await em.audit(ws.tenantId, actor(ws), 'period.close', closeId, digest.slice(0, 16));
      return { closeId, version: period.version };
    });
  }

  /** Màn 39 · Bộ hồ sơ quyết định (Decision Pack) theo đơn vị, kỳ và phiên bản. */
  async decisionPack(call: CallContext, p: { periodId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'period.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const periodId = p.periodId ?? tenant.settings.currentPeriod;
      const entityId = ws.entityId;
      const g = await this.gather(tx, ws, entityId, periodId);
      const revenue = sum(
        g.records.filter((r) => r.kind === 'ORDER' || r.kind === 'REVENUE').map((r) => r.amount),
      );
      const expense = sum(g.records.filter((r) => r.kind === 'EXPENSE').map((r) => r.amount));
      const net = D(revenue).minus(expense);
      const validated = g.docs.filter((d) => d.status === 'VALIDATED').length;
      const confirmed = g.groups.filter((x) => x.status === 'CONFIRMED').length;
      const periods = (await tx.list('periods', ws.tenantId)).filter(
        (x) => x.periodId === periodId && (entityId === '*' || x.entityId === entityId),
      );
      const closed = periods.length > 0 && periods.every((x) => x.status === 'CLOSED');
      const snapshots = (await tx.list('closeSnapshots', ws.tenantId)).filter(
        (s) => s.periodId === periodId && (entityId === '*' || s.entityId === entityId),
      );
      const anchored = snapshots.length > 0 && snapshots.every((s) => s.evidenceStatus === 'ANCHORED');
      const cl = this.checklistFrom(g, closed);
      const label = await scopeLabel(tx, ws.tenantId, entityId);
      return {
        periodId,
        scopeLabel: label,
        status: closed ? 'CLOSED' : 'DRAFT',
        statusLabel: closed ? `Đã chốt · ${snapshots.length} bộ chốt` : 'Bản nháp · Chưa chốt',
        kpis: {
          revenue: revenue.toFixed(),
          expense: expense.toFixed(),
          net: net.toFixed(),
          revenueLabel: formatVnd(revenue),
          expenseLabel: formatVnd(expense),
          netLabel: formatSignedVnd(net),
          netNote: `Thu ${compact(revenue)} · Chi ${compact(expense)}`,
        },
        rows: [
          { label: 'Doanh thu', value: formatVnd(revenue), source: 'Chứng từ · POS' },
          { label: 'Chi phí', value: formatVnd(expense), source: 'Chứng từ · ngân hàng' },
          { label: 'Chứng từ đã soát', value: `${validated} / ${g.docs.length}`, source: 'Hồ sơ xác nhận' },
          { label: 'Nhóm đối soát', value: `${confirmed} nhóm`, source: 'Đơn · tiền · phí' },
        ],
        conditions: [
          {
            title: 'Rà soát dữ liệu',
            detail: cl.items[0]!.done ? 'Đã hoàn tất' : cl.items[0]!.title,
            done: cl.items[0]!.done,
          },
          { title: 'Đối soát giao dịch', detail: `${confirmed} nhóm đã khớp`, done: cl.items[1]!.done },
          {
            title: 'Phê duyệt theo vai trò',
            detail: g.approvals.length ? `Còn ${g.approvals.length} hồ sơ chờ` : 'Đã hoàn tất',
            done: g.approvals.length === 0,
          },
          { title: 'Khóa kỳ & lưu phiên bản', detail: closed ? 'Đã khóa' : 'Chờ đủ điều kiện', done: closed },
          {
            title: 'Bằng chứng bộ chốt',
            detail: anchored ? 'Đã neo lên mạng có cấp quyền' : 'Chờ tạo sau khi chốt',
            done: anchored,
          },
        ],
        pendingApprovals: g.approvals.length,
        export: decisionPackXlsx({
          periodId,
          closed,
          tenantName: tenant.name,
          scope: label,
          rows: [
            ['Doanh thu', revenue.toFixed(), 'Chứng từ · POS'],
            ['Chi phí', expense.toFixed(), 'Chứng từ · ngân hàng'],
            ['Dòng tiền thuần', net.toFixed(), 'Tính toán = doanh thu − chi phí'],
            ['Chứng từ đã soát', `${validated}/${g.docs.length}`, 'Hồ sơ xác nhận'],
            ['Nhóm đối soát đã xác nhận', String(confirmed), 'Đơn · tiền · phí'],
            ['Trạng thái', closed ? 'Đã chốt' : 'Bản nháp', label],
          ],
          now: this.core.deps.clock(),
        }),
      };
    });
  }
}

export function compact(v: ReturnType<typeof sum>): string {
  const m = v.div(1_000_000);
  const s = m.toDecimalPlaces(1).toFixed().replace('.', ',');
  return `${s.endsWith(',0') ? s.slice(0, -2) : s} triệu`;
}

/** Decision Pack as a real Excel file (a management report, not a statutory form). */
function decisionPackXlsx(p: {
  periodId: string;
  closed: boolean;
  tenantName: string;
  scope: string;
  rows: [string, string, string][];
  now: Date;
}) {
  const month = `Tháng ${p.periodId.slice(5)}/${p.periodId.slice(0, 4)}`;
  const cells: (XCell | null)[][] = [
    [{ v: p.tenantName, s: 'unit' }],
    [],
    [{ v: `BỘ HỒ SƠ QUYẾT ĐỊNH (DECISION PACK)${p.closed ? '' : ' · BẢN NHÁP'}`, s: 'title' }],
    [{ v: `${month} · ${p.scope}`, s: 'subtitle' }],
    [{ v: 'Đơn vị tính: đồng', s: 'unitNote' }],
    [
      { v: 'Nội dung', s: 'head' },
      { v: 'Giá trị', s: 'head' },
      { v: 'Nguồn', s: 'head' },
    ],
    ...p.rows.map(([k, v, src]): XCell[] => [
      { v: k, s: 'cellBold' },
      /^-?\d+$/.test(v) ? { v: Number(v), s: 'money' } : { v, s: 'cellCenter' },
      { v: src, s: 'cell' },
    ]),
  ];
  const bytes = buildXlsx(
    [
      {
        name: 'Decision Pack',
        cols: [34, 22, 36],
        rows: cells,
        merges: ['A1:C1', 'A3:C3', 'A4:C4', 'A5:C5'],
        heights: { 3: 24 },
      },
    ],
    { title: `Decision Pack ${month}`, author: 'ARGOLET', created: p.now },
  );
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return {
    filename: `decision-pack-${p.periodId}${p.closed ? '' : '-nhap'}.xlsx`,
    mime: XLSX_MIME,
    contentBase64: btoa(bin),
  };
}
