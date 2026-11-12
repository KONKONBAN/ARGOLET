import {
  canonicalize, D, DEFAULT_RULES, formatDate, formatVnd, newId, nextCode, runReconciliation, sha256Hex, sum, targetDigest, APPROVAL_POLICY_VERSION,
  type ReconOrder, type ReconTxn,
} from '@argolet/core';
import { type AppCore, actor, paginate, requireFound, type PageParams } from '../core';
import { AppError, type CallContext, type Emitter, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { BusinessRecordRow, MatchGroupRow } from '../types';
import { inScope, scoped } from './documents';
import { closingUnits } from './close';
import { scopeLabel } from './org';

export const GROUP_STATUS_LABEL = (g: Pick<MatchGroupRow, 'status' | 'residual'>): string =>
  g.status === 'CONFIRMED'
    ? 'Đã xác nhận'
    : g.status === 'DISCREPANCY'
      ? `Lệch ${formatVnd(D(g.residual).abs())}`
      : g.status === 'PENDING_APPROVAL'
        ? 'Khớp, chờ duyệt'
        : 'Cần xác nhận';

const toOrder = (r: BusinessRecordRow): ReconOrder => ({
  recordId: r.recordId,
  recordVersion: r.version,
  code: r.code,
  gross: r.amount,
  fee: r.fee,
  refund: r.refund,
  discount: r.discount,
  adjustment: r.adjustment,
  currency: r.currency,
  date: r.date,
  reference: r.reference || undefined,
  payoutBatch: r.payoutBatch || undefined,
  counterparty: r.counterparty || undefined,
  channel: r.channel,
});

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Banks rarely carry the payout batch in a structured field: it is written somewhere in the
 * transfer description ("GF-PAY-1106 thanh toan don hang"). A credit is linked to a batch when
 * its description or reference contains a batch code that the platform's own orders carry.
 */
export function linkPayoutBatches(txns: BusinessRecordRow[], orders: { payoutBatch?: string | undefined }[]): BusinessRecordRow[] {
  const batches = [...new Set(orders.map((o) => o.payoutBatch).filter((b): b is string => !!b && squash(b).length >= 3))].sort((a, b) => squash(b).length - squash(a).length);
  return txns.map((t) => {
    if (t.payoutBatch) return t;
    const text = squash(`${t.description ?? ''} ${t.reference}`);
    const hit = batches.find((b) => text.includes(squash(b)));
    return hit ? { ...t, payoutBatch: hit } : t;
  });
}

const toTxn = (r: BusinessRecordRow): ReconTxn => ({
  recordId: r.recordId,
  recordVersion: r.version,
  code: r.code,
  amount: r.amount,
  currency: r.currency,
  date: r.date,
  source: r.kind === 'CASH' ? 'CASH' : 'BANK',
  reference: r.reference || undefined,
  payoutBatch: r.payoutBatch || undefined,
  counterparty: r.counterparty || undefined,
});

export function groupDigest(g: MatchGroupRow): string {
  return targetDigest({ code: g.code, version: g.version, links: g.links, net: g.net, received: g.received, residual: g.residual, rulesVersion: g.rulesVersion });
}

export class ReconService {
  constructor(private readonly core: AppCore) {}

  async summary(call: CallContext, p: { q?: string; filter?: 'review' | 'done' } & PageParams = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.read');
      const groups = await scoped(tx, ws, 'matchGroups');
      let rows = groups.slice();
      if (p.filter === 'review') rows = rows.filter((g) => g.status !== 'CONFIRMED');
      if (p.filter === 'done') rows = rows.filter((g) => g.status === 'CONFIRMED');
      if (p.q) {
        const q = p.q.toLowerCase();
        rows = rows.filter((g) => `${g.code} ${g.sourceLabel}`.toLowerCase().includes(q));
      }
      rows.sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
      const openOrders = (await scoped(tx, ws, 'records')).filter((r) => r.kind === 'ORDER' && !r.matchGroupId);
      const pg = paginate(rows, p, 20);
      return {
        kpis: {
          matched: groups.filter((g) => g.status === 'CONFIRMED').length,
          toConfirm: groups.filter((g) => g.status === 'PROPOSED' || g.status === 'PENDING_APPROVAL').length,
          discrepancies: groups.filter((g) => g.status === 'DISCREPANCY').length,
          unmatchedOrders: openOrders.length,
        },
        canRun: this.core.can(ws, 'recon.run'),
        firstOpenId: groups.filter((g) => g.status === 'PROPOSED').sort((x, y) => y.code.localeCompare(x.code, undefined, { numeric: true }))[0]?.id ?? null,
        page: pg.page,
        pageSize: pg.pageSize,
        total: pg.total,
        pageCount: pg.pageCount,
        items: pg.items.map((g) => ({
          id: g.id,
          code: g.code,
          label: `${g.code} · ${g.orderIds.length} đơn hàng`,
          source: g.sourceLabel,
          gross: g.gross,
          grossLabel: formatVnd(g.gross),
          received: g.received,
          receivedLabel: formatVnd(g.received),
          status: g.status,
          statusLabel: GROUP_STATUS_LABEL(g),
          tone: g.status === 'CONFIRMED' ? 'success' : g.status === 'DISCREPANCY' ? 'warning' : g.status === 'PENDING_APPROVAL' ? 'success' : 'warning',
        })),
      };
    });
  }

  async getGroup(call: CallContext, p: { groupId: string }) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.read');
      const g = await findGroup(tx, ws.tenantId, p.groupId);
      inScope(ws, g.entityId);
      const recs = async (ids: string[]) => {
        const out: BusinessRecordRow[] = [];
        for (const id of ids) {
          const r = (await tx.get('records', ws.tenantId, id)) ?? (await tx.list('recordHistory', ws.tenantId, { recordId: id }))[0];
          if (r) out.push(r);
        }
        return out;
      };
      const orders = await recs(g.orderIds);
      const txns = await recs(g.txnIds);
      const approval = g.approvalId ? await tx.get('approvals', ws.tenantId, g.approvalId) : undefined;
      return {
        group: {
          id: g.id,
          code: g.code,
          kind: g.kind,
          status: g.status,
          statusLabel: GROUP_STATUS_LABEL(g),
          gross: g.gross,
          fee: g.fee,
          refund: g.refund,
          discount: g.discount,
          net: g.net,
          received: g.received,
          residual: g.residual,
          score: g.score,
          feeRule: g.feeRule,
          explanation: g.explanation,
          basis: g.basis,
          links: g.links,
          allocations: g.allocations,
          rulesVersion: g.rulesVersion,
          inputSnapshotVersion: g.inputSnapshotVersion,
          confirmedAt: g.confirmedAt,
          version: g.version,
          digest: groupDigest(g),
          entityLabel: await scopeLabel(tx, ws.tenantId, g.entityId),
          approvalStatus: approval?.status ?? null,
        },
        orders: orders.map((o) => ({ id: o.recordId, code: o.code, date: o.date, dateLabel: formatDate(o.date), gross: o.amount, fee: o.fee, refund: o.refund, channel: o.channel })),
        receipts: txns.map((t) => ({ id: t.recordId, code: t.code, date: t.date, dateLabel: formatDate(t.date), amount: t.amount, source: t.kind === 'CASH' ? 'Tiền mặt' : 'Ngân hàng', reference: t.payoutBatch || t.reference })),
        canConfirm: this.core.can(ws, 'recon.confirm', g.entityId) && (g.status === 'PROPOSED' || g.status === 'DISCREPANCY'),
      };
    });
  }

  /** 03 · Động cơ đối soát: chụp đầu vào → khoanh vùng → chấm điểm → ghép/ phân bổ → nhóm đề xuất. */
  async run(call: CallContext, p: { entityId?: string; periodId?: string } = {}) {
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'recon.run');
      const tenant = requireFound(await tx.get('tenants', ws0.tenantId, ws0.tenantId), 'tổ chức');
      const periodId = p.periodId ?? tenant.settings.currentPeriod;
      // One run per unit: a specific unit, the member's own scope, or every unit when viewing the whole organisation.
      const units = p.entityId ? [p.entityId] : ws0.entityId !== '*' ? [ws0.entityId] : await closingUnits(tx, ws0.tenantId);
      const total = { groups: 0, unmatchedOrders: 0, unmatchedTxns: 0, pendingSources: 0, runIds: [] as string[], inputSnapshotDigest: '' };
      for (const entityId of units) {
        const ws = await this.core.requireWorkspace(tx, call, 'recon.run', { entityId });
        const r = await this.runUnit(tx, em, now, ws, entityId, periodId);
        total.groups += r.groups;
        total.unmatchedOrders += r.unmatchedOrders;
        total.unmatchedTxns += r.unmatchedTxns;
        total.pendingSources += r.pendingSources;
        total.runIds.push(r.runId);
        total.inputSnapshotDigest = r.inputSnapshotDigest;
      }
      return { runId: total.runIds[0] ?? '', runIds: total.runIds, units: units.length, groups: total.groups, unmatchedOrders: total.unmatchedOrders, unmatchedTxns: total.unmatchedTxns, pendingSources: total.pendingSources, inputSnapshotDigest: total.inputSnapshotDigest };
    });
  }

  private async runUnit(tx: Tx, em: Emitter, now: string, ws: WorkspaceState, entityId: string, periodId: string) {
      const open = (await tx.list('records', ws.tenantId, { entityId })).filter((r) => !r.matchGroupId && r.periodId === periodId);
      const orders = open.filter((r) => r.kind === 'ORDER').map(toOrder);
      const txns = linkPayoutBatches(open.filter((r) => r.kind === 'BANK_TXN' || r.kind === 'CASH'), orders).map(toTxn);
      const inputSnapshotDigest = sha256Hex(canonicalize({ orders, txns, periodId, entityId }));
      const result = runReconciliation(orders, txns, DEFAULT_RULES);
      const runId = newId('run');
      let codes = (await tx.list('matchGroups', ws.tenantId)).map((g) => g.code);
      const groupIds: string[] = [];
      for (const g of result.groups) {
        const code = nextCode('DS', codes);
        codes = [...codes, code];
        const id = newId('grp');
        const sources = new Set(g.txnIds.map((tid) => open.find((r) => r.recordId === tid)?.kind));
        const channels = new Set(g.orderIds.map((oid) => open.find((r) => r.recordId === oid)?.channel));
        const feePct = D(g.gross).isZero() ? D(0) : D(g.fee).div(g.gross).times(100);
        const row: MatchGroupRow = {
          id,
          tenantId: ws.tenantId,
          code,
          runId,
          entityId,
          periodId,
          kind: g.kind,
          status: g.status === 'MATCHED' ? 'PROPOSED' : 'DISCREPANCY',
          sourceLabel: sources.has('CASH') ? 'Tiền mặt' : [...channels].some((c) => c && /nền tảng|grab|shopee|food|be/i.test(c)) ? 'Nền tảng' : 'Ngân hàng',
          orderIds: g.orderIds,
          txnIds: g.txnIds,
          gross: g.gross,
          fee: g.fee,
          refund: g.refund,
          discount: g.discount,
          adjustment: g.adjustment,
          net: g.net,
          received: g.received,
          residual: g.residual,
          score: g.score,
          links: g.links,
          allocations: g.allocations,
          explanation: g.explanation,
          basis: g.basis,
          feeRule: `${feePct.toDecimalPlaces(1).toFixed().replace('.', ',')}% · ${result.rulesVersion}`,
          inputSnapshotVersion: inputSnapshotDigest.slice(0, 16),
          rulesVersion: result.rulesVersion,
          confirmedBy: null,
          confirmedAt: null,
          approvalId: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          rev: 0,
        };
        await tx.put('matchGroups', row);
        groupIds.push(id);
        // Lock records to the proposed group (prevents double allocation in later runs).
        for (const rid of [...g.orderIds, ...g.txnIds]) {
          const rec = await tx.get('records', ws.tenantId, rid);
          if (rec) await tx.put('records', { ...rec, matchGroupId: id });
        }
      }
      await tx.put('reconRuns', { id: runId, tenantId: ws.tenantId, entityId, periodId, inputSnapshotDigest, rulesVersion: result.rulesVersion, groupIds, unmatchedOrders: result.unmatchedOrders, unmatchedTxns: result.unmatchedTxns, createdBy: ws.user.id });
      await em.emit({ type: 'ReconciliationProposed', tenantId: ws.tenantId, entityId, aggregateType: 'ReconRun', aggregateId: runId, actorId: ws.user.id, dataRef: `recon-run/${runId}`, dataVersion: 1, data: { runId, groups: groupIds.length } });
      await em.audit(ws.tenantId, actor(ws), 'recon.run', runId, `${groupIds.length} nhóm đề xuất`);
      // Source files (POS / platform / bank) only feed the engine once someone has confirmed them.
      const pendingSources = (await tx.list('documents', ws.tenantId, { entityId })).filter((d) => (d.rowKind === 'POS' || d.rowKind === 'BANK') && d.date.slice(0, 7) === periodId && d.status !== 'VALIDATED' && d.status !== 'REJECTED').length;
      return { runId, groups: groupIds.length, unmatchedOrders: result.unmatchedOrders.length, unmatchedTxns: result.unmatchedTxns.length, pendingSources, inputSnapshotDigest };
  }

  /** "Kế toán xác nhận kết quả đối soát" → MatchResolved. */
  async confirm(call: CallContext, p: { groupId: string; digest: string; note?: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'recon.read');
      const g = await findGroup(tx, ws0.tenantId, p.groupId);
      const ws = await this.core.requireWorkspace(tx, call, 'recon.confirm', { entityId: g.entityId });
      if (g.status === 'PENDING_APPROVAL') throw new AppError('CONFLICT', 'Nhóm đang chờ phê duyệt, hãy xử lý trong hộp công việc');
      return this.confirmInTx(tx, ws, g, p.digest, now, em, p.note);
    });
  }

  async confirmInTx(tx: Tx, ws: WorkspaceState, g: MatchGroupRow, digest: string, now: string, em: Emitter, note?: string) {
    if (g.status === 'CONFIRMED') throw new AppError('CONFLICT', 'Nhóm đã được xác nhận');
    if (digest !== groupDigest(g)) throw new AppError('CONFLICT', 'Phương án ghép đã thay đổi, vui lòng tải lại trước khi xác nhận');
    if (g.status === 'DISCREPANCY' && !note) throw new AppError('VALIDATION', 'Nhóm còn chênh lệch: cần ghi chú giải thích trước khi xác nhận', { field: 'note' });
    const next: MatchGroupRow = { ...g, status: 'CONFIRMED', confirmedBy: ws.user.id, confirmedAt: now, version: g.version + 1, basis: note ? [...g.basis, `Ghi chú xác nhận: ${note}`] : g.basis };
    await tx.put('matchGroups', next);
    await em.emit({ type: 'MatchResolved', tenantId: ws.tenantId, entityId: g.entityId, aggregateType: 'MatchGroup', aggregateId: g.id, actorId: ws.user.id, dataRef: `match-group/${g.id}`, dataVersion: next.version, data: { groupId: g.id, code: g.code, net: g.net, received: g.received } });
    await em.audit(ws.tenantId, actor(ws), 'recon.confirm', g.code);
    return { ok: true, status: next.status };
  }

  /** Màn 38 · Gửi nhóm ghép xin duyệt: tạo Approval gắn digest của phương án ghép. */
  async submitForApproval(call: CallContext, p: { groupId: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'recon.read');
      const g = await findGroup(tx, ws0.tenantId, p.groupId);
      const ws = await this.core.requireWorkspace(tx, call, 'approval.request', { entityId: g.entityId });
      if (g.status === 'CONFIRMED') throw new AppError('CONFLICT', 'Nhóm đã được xác nhận');
      if (g.status === 'PENDING_APPROVAL') throw new AppError('CONFLICT', 'Nhóm đang chờ phê duyệt');
      if (g.status === 'DISCREPANCY') throw new AppError('VALIDATION', 'Nhóm còn chênh lệch, cần giải thích trước khi gửi duyệt');
      const approvalId = newId('apv');
      const entityLabel = await scopeLabel(tx, ws.tenantId, g.entityId);
      await tx.put('approvals', {
        id: approvalId,
        tenantId: ws.tenantId,
        approvalId,
        entityId: g.entityId,
        targetType: 'MATCH_GROUP',
        targetId: g.id,
        targetVersion: g.version,
        digest: groupDigest(g),
        amount: g.received,
        title: `Xác nhận nhóm ${g.code}`,
        makerId: ws.user.id,
        status: 'PENDING',
        policyVersion: APPROVAL_POLICY_VERSION,
        requesterName: ws.membership.displayName,
        entityLabel,
        details: [
          { label: 'Nhóm giao dịch', value: `${g.code} · ${g.orderIds.length} đơn hàng` },
          { label: 'Tổng đơn', value: formatVnd(g.gross) },
          { label: 'Phí & hoàn tiền', value: formatVnd(sum([g.fee, g.refund, g.discount])) },
          { label: 'Tiền thực nhận', value: formatVnd(g.received) },
          { label: 'Chênh lệch', value: formatVnd(g.residual) },
        ],
        timeline: [{ title: 'Đã lập hồ sơ', by: ws.membership.displayName, at: now }],
        dueDate: now.slice(0, 10),
        createdAt: now,
      });
      await tx.put('matchGroups', { ...g, status: 'PENDING_APPROVAL', approvalId });
      await em.emit({ type: 'ApprovalRequested', tenantId: ws.tenantId, entityId: g.entityId, aggregateType: 'Approval', aggregateId: approvalId, actorId: ws.user.id, dataRef: `approval/${approvalId}`, dataVersion: 1, data: { approvalId, targetType: 'MATCH_GROUP', code: g.code } });
      await em.audit(ws.tenantId, actor(ws), 'approval.request', g.code);
      return { approvalId };
    });
  }
}

export async function findGroup(tx: Tx, tenantId: string, idOrCode: string): Promise<MatchGroupRow> {
  const byId = await tx.get('matchGroups', tenantId, idOrCode ?? '');
  if (byId) return byId;
  const [byCode] = await tx.list('matchGroups', tenantId, { code: (idOrCode ?? '').toUpperCase() });
  return requireFound(byCode, 'nhóm đối soát');
}
