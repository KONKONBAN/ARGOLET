import {
  allocateByDriver, chargeAfterFreeTime, D, dec, dueWithin, energySavings, formatDate, formatNumber, formatPercent, formatPeriod, formatVnd, freeTimeEnd,
  matchIntercompany, movingAverage, newId, nextCode, recipeCost, sum, targetDigest, APPROVAL_POLICY_VERSION, formatShortDateTime,
} from '@argolet/core';
import { type AppCore, actor, requireAmount, requireFound, requireText } from '../core';
import { AppError, type CallContext } from '../runtime';
import type { DealRow, PurchaseOrderRow, WbsTask } from '../types';
import { defaultSite, scoped } from './documents';
import { localDate, addDays } from './approvals';
import { scopeLabel } from './org';

const PO_STATUS: Record<PurchaseOrderRow['status'], { label: string; tone: string }> = {
  DRAFT: { label: 'Bản nháp', tone: 'neutral' },
  PENDING_APPROVAL: { label: 'Chờ phê duyệt', tone: 'warning' },
  RECEIVED: { label: 'Đã nhận hàng', tone: 'success' },
  AWAITING_INVOICE: { label: 'Chờ hóa đơn', tone: 'neutral' },
  PAID: { label: 'Đã thanh toán', tone: 'success' },
};
const DEAL_STAGE: Record<DealRow['stage'], string> = { OPPORTUNITY: 'Cơ hội', QUOTE: 'Báo giá', CONTRACT: 'Hợp đồng', DELIVERY: 'Giao nhận', INVOICE: 'Hóa đơn', COLLECTION: 'Thu nợ' };
const DEAL_STATUS: Record<DealRow['status'], { label: string; tone: string }> = {
  WAITING_REPLY: { label: 'Chờ phản hồi', tone: 'warning' },
  IN_PROGRESS: { label: 'Đang thực hiện', tone: 'success' },
  DUE: { label: 'Đến hạn', tone: 'warning' },
  DONE: { label: 'Hoàn tất', tone: 'success' },
};
const WBS_STATUS: Record<WbsTask['status'], { label: string; tone: string }> = {
  DONE: { label: 'Hoàn tất', tone: 'success' },
  IN_PROGRESS: { label: 'Đang thực hiện', tone: 'warning' },
  NOT_STARTED: { label: 'Chưa bắt đầu', tone: 'neutral' },
};

const scopeNote = (periodId: string) => `Phạm vi kỳ ${formatPeriod(periodId).toLowerCase()}`;
const millions = (v: string) => `${formatNumber(D(v).div(1_000_000), 0)} triệu đ`;

export class ModuleService {
  constructor(private readonly core: AppCore) {}

  private async period(tenantId: string, tx: Parameters<Parameters<AppCore['query']>[0]>[0]) {
    return requireFound(await tx.get('tenants', tenantId, tenantId), 'tổ chức').settings.currentPeriod;
  }

  // ───────── G1 · Vận hành ─────────

  /** Màn 20 · Chốt ca & chốt ngày. */
  async dailyClose(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const shifts = (await scoped(tx, ws, 'dailyCloses')).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
      const current = shifts[0];
      const counter = sum((current?.lines ?? []).filter((l) => l.channel !== 'Nền tảng giao hàng').map((l) => l.system));
      const platform = sum((current?.lines ?? []).filter((l) => l.channel === 'Nền tảng giao hàng').map((l) => l.system));
      const counted = sum((current?.lines ?? []).map((l) => l.counted));
      return {
        kpis: [
          { label: 'Thu tại quầy', value: formatVnd(counter), note: scopeNote(periodId), highlight: true },
          { label: 'Thu qua nền tảng', value: formatVnd(platform), note: scopeNote(periodId) },
          { label: 'Tiền thực kiểm', value: formatVnd(counted), note: scopeNote(periodId) },
        ],
        shift: current
          ? {
              id: current.id,
              title: `${current.shift} · ${await scopeLabel(tx, ws.tenantId, current.entityId)}`,
              status: current.status,
              lines: current.lines.map((l) => ({ ...l, systemLabel: formatVnd(l.system), countedLabel: formatVnd(l.counted), diff: dec(D(l.counted).minus(l.system)), diffLabel: formatVnd(D(l.counted).minus(l.system)) })),
              submittedAt: current.submittedAt,
            }
          : null,
        canSubmit: this.core.can(ws, 'module.write'),
      };
    });
  }

  async submitDailyClose(call: CallContext, p: { shiftId: string; counted: Record<string, string>; note?: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const shift = requireFound(await tx.get('dailyCloses', ws.tenantId, p.shiftId), 'ca làm việc');
      if (shift.status === 'SUBMITTED') throw new AppError('CONFLICT', 'Ca đã được gửi chốt');
      const lines = shift.lines.map((l) => ({ ...l, counted: p.counted?.[l.channel] !== undefined ? requireAmount(p.counted[l.channel], `Thực kiểm ${l.channel}`) : l.counted }));
      const diff = sum(lines.map((l) => D(l.counted).minus(l.system)));
      if (!diff.isZero() && !p.note?.trim()) throw new AppError('VALIDATION', `Chênh lệch ${formatVnd(diff)}: cần ghi chú trước khi gửi chốt ca`, { field: 'note' });
      await tx.put('dailyCloses', { ...shift, lines, status: 'SUBMITTED', submittedBy: ws.user.id, submittedAt: now });
      await em.audit(ws.tenantId, actor(ws), 'daily_close.submit', shift.shift, p.note ?? '');
      return { ok: true, difference: diff.toFixed() };
    });
  }

  /** Màn 21 · Kho & giá thành (moving average + định mức công thức). */
  async inventory(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const items = (await scoped(tx, ws, 'inventoryItems')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const recipes = await tx.list('recipes', ws.tenantId);
      const recipe = recipes[0];
      const cost = recipe ? recipeCost(recipe.lines, recipe.lines.map((l) => ({ itemId: l.itemId, unitCost: l.unitCost })), recipe.wasteRate) : null;
      const low = items.filter((i) => D(i.onHand).lte(i.reorderLevel));
      const value = sum(items.map((i) => movingAverage([{ type: 'IN', quantity: i.onHand, unitCost: i.unitCost }]).value));
      return {
        kpis: [
          { label: recipe ? `Giá thành / ${recipe.name.toLowerCase()}` : 'Giá thành', value: cost ? formatVnd(cost.total) : '—', note: scopeNote(periodId) },
          { label: 'Nguyên liệu sắp hết', value: `${low.length} mặt hàng`, note: scopeNote(periodId) },
          { label: 'Tồn kho ghi nhận', value: formatVnd(value), note: scopeNote(periodId) },
        ],
        items: items.map((i) => ({ id: i.id, name: i.name, onHand: formatNumber(D(i.onHand), D(i.onHand).isInteger() ? 0 : 1), unit: i.unit, status: D(i.onHand).lte(i.reorderLevel) ? 'Sắp hết' : 'Đủ tồn', tone: D(i.onHand).lte(i.reorderLevel) ? 'warning' : 'success', value: formatVnd(D(i.onHand).times(i.unitCost)) })),
        recipe: recipe && cost ? { name: recipe.name, price: formatVnd(recipe.price), margin: formatPercent(D(recipe.price).minus(cost.total).div(recipe.price), 1), total: formatVnd(cost.total), lines: cost.lines.map((l, idx) => ({ ...l, quantity: `${recipe.lines[idx]!.quantity} ${recipe.lines[idx]!.unit}`, costLabel: formatVnd(l.cost) })) } : null,
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async adjustStock(call: CallContext, p: { itemId: string; onHand: string }) {
    const qty = requireAmount(p.onHand, 'Tồn thực tế');
    if (D(qty).lt(0)) throw new AppError('VALIDATION', 'Tồn thực tế không được âm', { field: 'onHand' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const item = requireFound(await tx.get('inventoryItems', ws.tenantId, p.itemId), 'nguyên liệu');
      await tx.put('inventoryItems', { ...item, onHand: qty });
      await em.audit(ws.tenantId, actor(ws), 'inventory.count', item.name, `${item.onHand} → ${qty}`);
      return { ok: true };
    });
  }

  /** Màn 22 · Mua hàng & công nợ. */
  async purchasing(call: CallContext) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const pos = (await scoped(tx, ws, 'purchaseOrders')).sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
      const open = pos.filter((p) => p.status !== 'PAID');
      const today = localDate(now);
      return {
        kpis: [
          { label: 'Công nợ phải trả', value: formatVnd(sum(open.map((p) => p.outstanding))), note: scopeNote(periodId) },
          { label: 'Đến hạn trong 7 ngày', value: formatVnd(dueWithin(open.map((p) => ({ id: p.id, dueDate: p.dueDate, amount: p.outstanding })), today, 7)), note: scopeNote(periodId) },
          { label: 'Đơn mua đang mở', value: `${open.length} đơn`, note: scopeNote(periodId) },
        ],
        items: open.map((p) => ({ id: p.id, label: `${p.supplier} · ${p.code}`, dueDate: formatDate(p.dueDate), outstanding: formatVnd(p.outstanding), status: PO_STATUS[p.status].label, tone: PO_STATUS[p.status].tone })),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  /** Tạo đơn mua → hồ sơ đề nghị chi gắn digest, vào hộp công việc của người duyệt. */
  async createPurchaseOrder(call: CallContext, p: { supplier: string; amount: string; dueDate: string; purpose?: string }) {
    const supplier = requireText(p.supplier, 'Nhà cung cấp', 120);
    const amount = requireAmount(p.amount, 'Giá trị');
    if (D(amount).lte(0)) throw new AppError('VALIDATION', 'Giá trị phải lớn hơn 0', { field: 'amount' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate ?? '')) throw new AppError('VALIDATION', 'Hạn thanh toán không hợp lệ', { field: 'dueDate' });
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'module.write');
      const entityId = ws0.entityId !== '*' ? ws0.entityId : await defaultSite(tx, ws0.tenantId);
      const ws = await this.core.requireWorkspace(tx, call, 'approval.request', { entityId });
      const codes = (await tx.list('purchaseOrders', ws.tenantId)).map((x) => x.code);
      const code = nextCode('PO', codes, 3, 1);
      const id = newId('po');
      const po = await tx.put('purchaseOrders', { id, tenantId: ws.tenantId, code, supplier, entityId, orderDate: localDate(now), dueDate: p.dueDate, amount, outstanding: amount, status: 'PENDING_APPROVAL' });
      const approvalId = newId('apv');
      await tx.put('approvals', {
        id: approvalId,
        tenantId: ws.tenantId,
        approvalId,
        entityId,
        targetType: 'EXPENSE',
        targetId: id,
        targetVersion: po.rev,
        digest: targetDigest({ code, supplier, amount, dueDate: p.dueDate }),
        amount,
        title: `Đề nghị chi ${p.purpose?.trim() ? p.purpose.trim().toLowerCase() : 'mua hàng'}`,
        makerId: ws.user.id,
        status: 'PENDING',
        policyVersion: APPROVAL_POLICY_VERSION,
        requesterName: ws.membership.displayName,
        entityLabel: await scopeLabel(tx, ws.tenantId, entityId),
        details: [
          { label: 'Người đề nghị', value: ws.membership.displayName },
          { label: 'Người nhận', value: supplier },
          { label: 'Mục đích', value: p.purpose?.trim() || 'Mua hàng' },
          { label: 'Phương thức', value: 'Chuyển khoản' },
          { label: 'Chứng từ kèm theo', value: `${code} · Chờ hóa đơn` },
        ],
        timeline: [{ title: 'Đã lập hồ sơ', by: ws.membership.displayName, at: now }],
        dueDate: addDays(localDate(now), 1),
        createdAt: now,
      });
      await em.emit({ type: 'ApprovalRequested', tenantId: ws.tenantId, entityId, aggregateType: 'Approval', aggregateId: approvalId, actorId: ws.user.id, dataRef: `approval/${approvalId}`, dataVersion: 1, data: { approvalId, targetType: 'EXPENSE', code } });
      await em.audit(ws.tenantId, actor(ws), 'purchase.create', code, amount);
      return { id, code, approvalId };
    });
  }

  /** Màn 23 · Sổ sách & thuế. */
  async booksTax(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const periodId = tenant.settings.currentPeriod;
      const records = (await scoped(tx, ws, 'records')).filter((r) => r.periodId === periodId);
      const docs = await scoped(tx, ws, 'documents');
      const revenueRecs = records.filter((r) => r.kind === 'ORDER' || r.kind === 'REVENUE');
      const needs = docs.filter((d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON' || d.status === 'EXTRACTED').length;
      const p = formatPeriod(periodId);
      return {
        kpis: [
          { label: 'Doanh thu đã ghi nhận', value: formatVnd(sum(revenueRecs.map((r) => r.amount))), note: scopeNote(periodId) },
          { label: 'Chi phí có chứng từ', value: formatVnd(sum(records.filter((r) => r.kind === 'EXPENSE').map((r) => r.amount))), note: scopeNote(periodId) },
          { label: 'Hồ sơ cần bổ sung', value: `${needs} hồ sơ`, note: scopeNote(periodId) },
        ],
        title: `Sổ kế toán & dữ liệu kỳ ${p.toLowerCase().replace('/2026', '')}`,
        items: [
          { label: 'Sổ doanh thu', period: p, status: `Có ${docs.filter((d) => d.status === 'VALIDATED').length} bản ghi`, tone: 'success', action: 'Xem dữ liệu', route: '/documents' },
          { label: 'Sổ chi phí', period: p, status: needs ? `Cần soát ${needs} hồ sơ` : 'Đã soát', tone: needs ? 'warning' : 'success', action: 'Rà soát', route: '/documents' },
          { label: 'Phương pháp tính thuế', period: `Năm ${periodId.slice(0, 4)}`, status: tenant.settings.accountingRegime === 'HKD' ? 'Đã cấu hình' : 'Cần cấu hình', tone: tenant.settings.accountingRegime === 'HKD' ? 'success' : 'neutral', action: 'Chọn phương pháp', route: '/settings' },
          { label: 'Bản kê khai dự thảo', period: p, status: 'Chưa lập', tone: 'neutral', action: 'Lập sau rà soát', route: '/decision-pack' },
        ],
        note: 'Phương pháp và quy tắc thuế cần được chuyên môn xác nhận trước khi áp dụng.',
        export: {
          filename: `so-ke-toan-${periodId}.csv`,
          csv: ['Ngày;Mã;Loại;Đối tác;Số tiền', ...records.sort((a, b) => a.date.localeCompare(b.date)).map((r) => `${r.date};${r.code};${r.kind};${r.counterparty.replace(/;/g, ',')};${r.amount}`)].join('\n'),
        },
      };
    });
  }

  // ───────── G2 · Doanh nghiệp ─────────

  async clients(call: CallContext, p: { q?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('clients', ws.tenantId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const rows = p.q ? all.filter((c) => c.name.toLowerCase().includes(p.q!.toLowerCase())) : all;
      const label = { MISSING_DOCS: ['Thiếu', 'warning'], READY: ['Sẵn sàng chốt', 'success'], REVIEWED: ['Đã rà soát', 'success'], WAITING: ['Chờ bổ sung', 'warning'] } as const;
      return {
        kpis: [
          { label: 'Khách hàng ủy quyền', value: String(all.length) },
          { label: 'Đang thiếu hồ sơ', value: String(all.filter((c) => c.status === 'MISSING_DOCS' || c.status === 'WAITING').length) },
          { label: 'Đã sẵn sàng chốt', value: String(all.filter((c) => c.status === 'READY' || c.status === 'REVIEWED').length) },
        ],
        items: rows.map((c) => ({ id: c.id, name: c.name, scope: c.scope, completion: `${c.completion}%`, closeDue: formatDate(c.closeDue), status: c.status === 'MISSING_DOCS' ? `Thiếu ${c.missingDocs} hồ sơ` : label[c.status][0], tone: label[c.status][1] })),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async addClient(call: CallContext, p: { name: string; scope: string; closeDue: string; delegationValidUntil?: string }) {
    const name = requireText(p.name, 'Tên khách hàng', 120);
    const scope = requireText(p.scope, 'Phạm vi', 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.closeDue ?? '')) throw new AppError('VALIDATION', 'Hạn chốt không hợp lệ', { field: 'closeDue' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const id = newId('cli');
      await tx.put('clients', { id, tenantId: ws.tenantId, name, scope, completion: 0, closeDue: p.closeDue, status: 'WAITING', missingDocs: 0, delegationValidUntil: p.delegationValidUntil ?? addDays(p.closeDue, 365) });
      await em.audit(ws.tenantId, actor(ws), 'client.add', name);
      return { id };
    });
  }

  async sales(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const deals = (await tx.list('deals', ws.tenantId)).sort((a, b) => b.code.localeCompare(a.code, undefined, { numeric: true }));
      const contracts = deals.filter((d) => ['CONTRACT', 'DELIVERY', 'INVOICE', 'COLLECTION'].includes(d.stage) && d.status !== 'DONE');
      const receivable = deals.filter((d) => ['DELIVERY', 'INVOICE', 'COLLECTION'].includes(d.stage) && d.status !== 'DONE');
      return {
        kpis: [
          { label: 'Giá trị cơ hội', value: formatVnd(sum(deals.filter((d) => d.status !== 'DONE').map((d) => d.value))), note: scopeNote(periodId) },
          { label: 'Hợp đồng đang thực hiện', value: `${contracts.length} hợp đồng`, note: scopeNote(periodId) },
          { label: 'Công nợ phải thu', value: formatVnd(sum(receivable.map((d) => d.value))), note: scopeNote(periodId) },
        ],
        items: deals.filter((d) => d.status !== 'DONE').slice(0, 20).map((d) => ({ id: d.id, label: `${d.customer} · ${d.code}`, stage: DEAL_STAGE[d.stage], value: formatVnd(d.value), status: DEAL_STATUS[d.status].label, tone: DEAL_STATUS[d.status].tone })),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async createDeal(call: CallContext, p: { customer: string; value: string }) {
    const customer = requireText(p.customer, 'Khách hàng', 120);
    const value = requireAmount(p.value, 'Giá trị');
    if (D(value).lte(0)) throw new AppError('VALIDATION', 'Giá trị phải lớn hơn 0', { field: 'value' });
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const codes = (await tx.list('deals', ws.tenantId)).map((d) => d.code);
      const code = nextCode('CH', codes, 3, 1);
      const id = newId('deal');
      await tx.put('deals', { id, tenantId: ws.tenantId, code, customer, stage: 'OPPORTUNITY', value, status: 'IN_PROGRESS', dueDate: addDays(localDate(now), 30) });
      await em.audit(ws.tenantId, actor(ws), 'deal.create', code, value);
      return { id, code };
    });
  }

  // ───────── G3 · Dự án ─────────

  async projects(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const [proj] = (await tx.list('projects', ws.tenantId)).sort((a, b) => a.code.localeCompare(b.code));
      if (!proj) return { kpis: [], project: null, canWrite: false };
      const available = D(proj.budget).minus(proj.recorded).minus(proj.committed);
      return {
        kpis: [
          { label: 'Ngân sách dự án', value: millions(proj.budget), note: 'Đã phê duyệt' },
          { label: 'Đã ghi nhận', value: millions(proj.recorded), note: `${formatNumber(D(proj.recorded).div(proj.budget).times(100), 0)}% ngân sách` },
          { label: 'Cam kết chưa ghi nhận', value: millions(proj.committed), note: `Còn khả dụng ${millions(available.toFixed())}` },
        ],
        project: {
          id: proj.id,
          title: proj.name,
          subtitle: `WBS · ${proj.wbs.length} công việc · Chủ nhiệm: ${proj.manager}`,
          tasks: proj.wbs.map((t) => ({ ...t, label: `${t.code} · ${t.name}`, dependsOn: t.dependsOn ?? '—', progressLabel: `${t.progress}%`, statusLabel: WBS_STATUS[t.status].label, tone: WBS_STATUS[t.status].tone })),
        },
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async addWbsTask(call: CallContext, p: { projectId: string; name: string; owner: string; dependsOn?: string | null }) {
    const name = requireText(p.name, 'Tên công việc', 120);
    const owner = requireText(p.owner, 'Phụ trách', 80);
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const proj = requireFound(await tx.get('projects', ws.tenantId, p.projectId), 'dự án');
      if (p.dependsOn && !proj.wbs.some((t) => t.code === p.dependsOn)) throw new AppError('VALIDATION', 'Công việc phụ thuộc không tồn tại', { field: 'dependsOn' });
      const major = proj.wbs[0]?.code.split('.')[0] ?? '1';
      const code = `${major}.${proj.wbs.length + 1}`;
      await tx.put('projects', { ...proj, wbs: [...proj.wbs, { code, name, dependsOn: p.dependsOn ?? null, owner, progress: 0, status: 'NOT_STARTED' }] });
      await em.audit(ws.tenantId, actor(ws), 'wbs.add', proj.code, `${code} ${name}`);
      return { code };
    });
  }

  async assets(call: CallContext) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const rows = (await tx.list('assets', ws.tenantId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const metrics = rows.filter((r) => r.kind === 'METRIC');
      const assets = rows.filter((r) => r.kind === 'ASSET');
      const savings = sum(metrics.map((m) => energySavings(m.baseline, m.reporting).savingsKwh));
      const today = localDate(now);
      const due = assets.filter((a) => a.dueDate && a.dueDate <= addDays(today, 7) && a.status === 'MAINTENANCE_DUE');
      return {
        kpis: [
          { label: 'Tài sản đang vận hành', value: `${assets.length} tài sản`, note: scopeNote(periodId) },
          { label: 'Tiết kiệm năng lượng', value: `${formatNumber(savings)} kWh`, note: scopeNote(periodId) },
          { label: 'Lịch bảo trì đến hạn', value: `${due.length} lịch`, note: scopeNote(periodId) },
        ],
        title: 'Đo lường & kiểm chứng · Nhà máy Minh An',
        items: rows
          .filter((r) => r.kind === 'METRIC' || r.status !== 'OK')
          .map((r) => {
            if (r.kind === 'METRIC') {
              const s = energySavings(r.baseline, r.reporting);
              return { id: r.id, name: r.name, baseline: `${formatNumber(D(r.baseline))} ${r.unit}`, period: `${formatNumber(D(r.reporting))} ${r.unit}`, result: `Giảm ${formatPercent(s.savingsRatio, 0)}`, tone: 'success', isMetric: true };
            }
            return { id: r.id, name: r.name, baseline: r.schedule || r.projectCode, period: r.dueDate ? formatDate(r.dueDate) : '', result: r.status === 'MAINTENANCE_DUE' ? 'Đến hạn bảo trì' : 'Đang theo dõi', tone: r.status === 'MAINTENANCE_DUE' ? 'warning' : 'success', isMetric: false };
          }),
      };
    });
  }

  async logistics(call: CallContext) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const [sh] = (await tx.list('shipments', ws.tenantId)).sort((a, b) => b.code.localeCompare(a.code));
      if (!sh) return { shipment: null };
      const end = freeTimeEnd(sh.freeTimeStart, sh.freeDays);
      const daysLeft = Math.round((Date.parse(end) - Date.parse(localDate(now))) / 86_400_000);
      const statusLabel = { IN_TRANSIT: 'Đang vận chuyển', CUSTOMS: 'Đang thông quan', DELIVERING: 'Đang giao nhận', DELIVERED: 'Đã giao' }[sh.status];
      return {
        shipment: {
          id: sh.id,
          title: `Lô hàng ${sh.code}`,
          subtitle: `${sh.route} · ${sh.container}`,
          statusLabel,
          events: sh.events.map((e) => ({ ...e, atLabel: formatShortDateTime(e.at).replace(', ', ' · ') })),
          documents: sh.documents,
          freeTimeEnd: formatDate(end),
          freeTimeNote: daysLeft >= 0 ? `Còn ${daysLeft} ngày theo biểu phí ${sh.tariffCode}. Xem chi tiết để dự kiến chi phí phát sinh.` : `Đã quá ${-daysLeft} ngày miễn phí theo biểu phí ${sh.tariffCode}. Chi phí lưu bãi đang phát sinh.`,
        },
      };
    });
  }

  async logisticsFinance(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const [sh] = (await tx.list('shipments', ws.tenantId)).sort((a, b) => b.code.localeCompare(a.code));
      if (!sh) return { shipment: null };
      const storage = chargeAfterFreeTime(sh.freeDays + sh.storageDays, sh.freeDays, [{ fromDay: 1, toDay: null, ratePerDay: sh.storageRatePerDay }]);
      const costs = sh.costs.map((c) => (c.name === 'Lưu bãi' ? { ...c, amount: storage.amount, basis: `${storage.chargeableDays} ngày × ${formatNumber(D(sh.storageRatePerDay))}` } : c));
      const totalCost = sum(costs.map((c) => c.amount));
      const profit = D(sh.revenue).minus(totalCost);
      const alloc = allocateByDriver(totalCost, sh.allocation.map((a) => ({ id: a.item, driver: a.weightShare })));
      const short = (v: string) => `${formatNumber(D(v).div(1_000_000), D(v).div(1_000_000).isInteger() ? 0 : 1)}tr`;
      return {
        shipment: {
          id: sh.id,
          code: sh.code,
          kpis: [
            { label: 'Doanh thu lô hàng', value: formatVnd(sh.revenue), note: sh.code },
            { label: 'Giá vốn sau phân bổ', value: formatVnd(totalCost), note: costs.map((c) => `${c.name.replace('Cước vận chuyển', 'Cước').replace('Phí nội địa', 'Nội địa')} ${short(c.amount)}`).join(' · ') },
            { label: 'Lợi nhuận gộp', value: formatVnd(profit), note: `Biên lợi nhuận gộp ${formatPercent(profit.div(sh.revenue))}` },
          ],
          tariff: `Biểu phí: ${sh.tariffCode} · Hiệu lực từ ${formatDate(sh.tariffFrom)}`,
          costs: costs.map((c) => ({ ...c, amountLabel: formatVnd(c.amount) })),
          allocation: alloc.map((a) => ({ item: a.id, share: `${formatNumber(D(a.share).times(100), 0)}% trọng lượng`, amount: formatVnd(a.amount) })),
          allocationConfirmed: sh.allocationConfirmed,
        },
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async confirmAllocation(call: CallContext, p: { shipmentId: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const sh = requireFound(await tx.get('shipments', ws.tenantId, p.shipmentId), 'lô hàng');
      if (sh.allocationConfirmed) throw new AppError('CONFLICT', 'Phân bổ đã được xác nhận');
      await tx.put('shipments', { ...sh, allocationConfirmed: true });
      await em.audit(ws.tenantId, actor(ws), 'logistics.allocation.confirm', sh.code);
      return { ok: true };
    });
  }

  // ───────── G4 · Tập đoàn ─────────

  async group(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const rows = (await tx.list('groupEntities', ws.tenantId)).sort((a, b) => a.code.localeCompare(b.code, 'vi')).sort((a, b) => order(a.code) - order(b.code));
      const ics = await tx.list('intercompany', ws.tenantId);
      const diffs = ics.map((ic) => matchIntercompany({ ...ic.sideA, reference: ic.reference, currency: 'VND', periodId: ic.periodId }, { ...ic.sideB, reference: ic.reference, currency: 'VND', periodId: ic.periodId }));
      const totalDiff = sum(diffs.map((d) => D(d.difference).abs()));
      const submitted = rows.filter((r) => r.periodStatus === 'SUBMITTED').length;
      return {
        kpis: [
          { label: 'Pháp nhân trong phạm vi', value: `${rows.length} đơn vị`, note: 'Quyền truy xuống theo pháp nhân' },
          { label: 'Đã gửi dữ liệu kỳ', value: `${submitted} / ${rows.length} đơn vị`, note: `Còn ${rows.length - submitted} đơn vị chờ hoàn tất` },
          { label: 'Chênh lệch nội bộ', value: formatVnd(totalDiff), note: `${diffs.filter((d) => d.status === 'DIFFERENCE').length} cặp cần đối chiếu`, highlight: true },
        ],
        title: `Tiến độ kỳ ${formatPeriod(tenant.settings.currentPeriod).toLowerCase()}`,
        items: rows.map((r) => ({ id: r.id, name: r.name, code: r.code, docs: `${r.docsSubmitted} / ${r.docsTotal}`, status: r.periodStatus === 'SUBMITTED' ? 'Đã gửi' : 'Chờ hoàn tất', tone: r.periodStatus === 'SUBMITTED' ? 'success' : 'warning', ic: r.icStatus })),
      };
    });
  }

  async intercompany(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const [ic] = await tx.list('intercompany', ws.tenantId);
      if (!ic) return { pair: null };
      const m = matchIntercompany({ ...ic.sideA, reference: ic.reference, currency: 'VND', periodId: ic.periodId }, { ...ic.sideB, reference: ic.reference, currency: 'VND', periodId: ic.periodId });
      const period = `T${Number(ic.periodId.slice(5))}/${ic.periodId.slice(0, 4)}`;
      return {
        pair: {
          id: ic.id,
          reference: ic.reference,
          kpis: [
            { label: `Phải thu · ${ic.sideA.name}`, value: formatVnd(ic.sideA.amount), note: `Đối tác nội bộ: ${ic.sideB.name}` },
            { label: `Phải trả · ${ic.sideB.name}`, value: formatVnd(ic.sideB.amount), note: `Cùng kỳ ${formatPeriod(ic.periodId).toLowerCase()}` },
            { label: 'Chênh lệch', value: formatVnd(D(m.difference).abs()), note: ic.status === 'REQUESTED' ? 'Đã gửi yêu cầu bổ sung chứng từ' : 'Chờ xác minh chứng từ phí' },
          ],
          sideAName: ic.sideA.name,
          sideBName: ic.sideB.name,
          rows: [
            { label: 'Hợp đồng / kỳ', a: `${ic.contract} · ${period}`, b: `${ic.contract} · ${period}`, result: m.sameReference && m.samePeriod ? 'Cùng tham chiếu' : 'Khác tham chiếu', tone: m.sameReference ? 'success' : 'warning' },
            { label: 'Giá trị ghi nhận', a: formatVnd(ic.sideA.amount), b: formatVnd(ic.sideB.amount), result: m.status === 'MATCHED' ? 'Đã khớp' : `Lệch ${formatVnd(D(m.difference).abs())}`, tone: m.status === 'MATCHED' ? 'success' : 'warning' },
          ],
          nextAction: ic.nextAction,
          status: ic.status,
          eliminationDraft: m.eliminationDraft,
        },
        canWrite: this.core.can(ws, 'recon.confirm'),
      };
    });
  }

  async requestIntercompanyDocs(call: CallContext, p: { pairId: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.confirm');
      const ic = requireFound(await tx.get('intercompany', ws.tenantId, p.pairId), 'cặp đối soát nội bộ');
      if (ic.status === 'REQUESTED') throw new AppError('CONFLICT', 'Đã gửi yêu cầu bổ sung trước đó');
      await tx.put('intercompany', { ...ic, status: 'REQUESTED', requestedAt: now });
      await tx.put('notifications', { id: newId('ntf'), tenantId: ws.tenantId, userId: null, title: `Yêu cầu ${ic.sideB.name} bổ sung chứng từ`, unitLabel: ic.sideB.name.replace('Minh An ', ''), refCode: ic.reference, route: '/intercompany', status: 'UNREAD', actionRequired: true, statusLabel: 'Cần xem' });
      await em.audit(ws.tenantId, actor(ws), 'intercompany.request_docs', ic.reference);
      return { ok: true };
    });
  }
}

const ENTITY_ORDER = ['MAH', 'MAR', 'MAL', 'MAE'];
const order = (c: string) => (ENTITY_ORDER.indexOf(c) < 0 ? 99 : ENTITY_ORDER.indexOf(c));
