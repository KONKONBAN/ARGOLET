import {
  allocateByDriver,
  chargeAfterFreeTime,
  D,
  dec,
  dueWithin,
  energySavings,
  formatDate,
  formatNumber,
  formatPercent,
  formatPeriod,
  formatVnd,
  freeTimeEnd,
  matchIntercompany,
  movingAverage,
  newId,
  nextCode,
  recipeCost,
  sum,
  targetDigest,
  APPROVAL_POLICY_VERSION,
  formatShortDateTime,
} from '@argolet/core';
import {
  type AppCore,
  actor,
  paginate,
  requireAmount,
  requireDate,
  requireDecimal,
  requireFound,
  requireNonNegative,
  requireText,
  type PageParams,
} from '../core';
import { AppError, type CallContext, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { AssetRow, DealRow, IntercompanyRow, PurchaseOrderRow, ShipmentRow, WbsTask } from '../types';
import { buildBooks } from './books';
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
const DEAL_STAGE: Record<DealRow['stage'], string> = {
  OPPORTUNITY: 'Cơ hội',
  QUOTE: 'Báo giá',
  CONTRACT: 'Hợp đồng',
  DELIVERY: 'Giao nhận',
  INVOICE: 'Hóa đơn',
  COLLECTION: 'Thu nợ',
};
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
  async dailyClose(call: CallContext, p: { shiftId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const shifts = (await scoped(tx, ws, 'dailyCloses')).sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      );
      const current =
        (p.shiftId ? shifts.find((x) => x.id === p.shiftId) : undefined) ??
        shifts.find((x) => x.status === 'OPEN') ??
        shifts[0];
      const counter = sum(
        (current?.lines ?? []).filter((l) => l.channel !== 'Nền tảng giao hàng').map((l) => l.system),
      );
      const platform = sum(
        (current?.lines ?? []).filter((l) => l.channel === 'Nền tảng giao hàng').map((l) => l.system),
      );
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
              lines: current.lines.map((l) => ({
                ...l,
                systemLabel: formatVnd(l.system),
                countedLabel: formatVnd(l.counted),
                diff: dec(D(l.counted).minus(l.system)),
                diffLabel: formatVnd(D(l.counted).minus(l.system)),
              })),
              submittedAt: current.submittedAt,
            }
          : null,
        history: await Promise.all(
          shifts.slice(0, 12).map(async (x) => {
            const diff = sum(x.lines.map((l) => D(l.counted).minus(l.system)));
            return {
              id: x.id,
              label: `${x.shift} · ${formatDate(x.date)}`,
              unit: await scopeLabel(tx, ws.tenantId, x.entityId),
              status: x.status,
              statusLabel: x.status === 'OPEN' ? 'Đang mở' : 'Đã gửi chốt',
              tone: x.status === 'OPEN' ? 'warning' : 'success',
              total: formatVnd(sum(x.lines.map((l) => l.system))),
              diffLabel: x.status === 'OPEN' ? '—' : formatVnd(diff),
            };
          }),
        ),
        units: await unitOptions(tx, ws),
        canSubmit: this.core.can(ws, 'module.write'),
      };
    });
  }

  async submitDailyClose(
    call: CallContext,
    p: { shiftId: string; counted: Record<string, string>; note?: string },
  ) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const shift = requireFound(await tx.get('dailyCloses', ws.tenantId, p.shiftId), 'ca làm việc');
      if (shift.status === 'SUBMITTED') throw new AppError('CONFLICT', 'Ca đã được gửi chốt');
      const lines = shift.lines.map((l) => ({
        ...l,
        counted:
          p.counted?.[l.channel] !== undefined
            ? requireAmount(p.counted[l.channel], `Thực kiểm ${l.channel}`)
            : l.counted,
      }));
      const diff = sum(lines.map((l) => D(l.counted).minus(l.system)));
      if (!diff.isZero() && !p.note?.trim())
        throw new AppError('VALIDATION', `Chênh lệch ${formatVnd(diff)}: cần ghi chú trước khi gửi chốt ca`, {
          field: 'note',
        });
      await tx.put('dailyCloses', {
        ...shift,
        lines,
        status: 'SUBMITTED',
        submittedBy: ws.user.id,
        submittedAt: now,
      });
      await em.audit(ws.tenantId, actor(ws), 'daily_close.submit', shift.shift, p.note ?? '');
      return { ok: true, difference: diff.toFixed() };
    });
  }

  /** Màn 21 · Kho & giá thành (moving average + định mức công thức). */
  async inventory(call: CallContext, p: { recipeId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const items = (await scoped(tx, ws, 'inventoryItems')).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const byId = new Map(items.map((i) => [i.id, i]));
      const recipes = (await tx.list('recipes', ws.tenantId)).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const recipe = (p.recipeId ? recipes.find((r) => r.id === p.recipeId) : undefined) ?? recipes[0];
      // Recipe cost always uses today's moving-average cost of each ingredient.
      const cost = recipe
        ? recipeCost(
            recipe.lines,
            recipe.lines.map((l) => ({
              itemId: l.itemId,
              unitCost: byId.get(l.itemId)?.unitCost ?? l.unitCost,
            })),
            recipe.wasteRate,
          )
        : null;
      const low = items.filter((i) => D(i.onHand).lte(i.reorderLevel));
      const value = sum(
        items.map((i) => movingAverage([{ type: 'IN', quantity: i.onHand, unitCost: i.unitCost }]).value),
      );
      return {
        kpis: [
          {
            label: recipe ? `Giá thành / ${recipe.name.toLowerCase()}` : 'Giá thành',
            value: cost ? formatVnd(cost.total) : '—',
            note: scopeNote(periodId),
          },
          { label: 'Nguyên liệu sắp hết', value: `${low.length} mặt hàng`, note: scopeNote(periodId) },
          { label: 'Tồn kho ghi nhận', value: formatVnd(value), note: scopeNote(periodId) },
        ],
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          onHand: formatNumber(D(i.onHand), D(i.onHand).isInteger() ? 0 : 1),
          unit: i.unit,
          status: D(i.onHand).lte(i.reorderLevel) ? 'Sắp hết' : 'Đủ tồn',
          tone: D(i.onHand).lte(i.reorderLevel) ? 'warning' : 'success',
          value: formatVnd(D(i.onHand).times(i.unitCost)),
        })),
        recipes: recipes.map((r) => ({ id: r.id, name: r.name })),
        itemOptions: items.map((i) => ({ id: i.id, name: i.name, unit: i.unit })),
        units: await unitOptions(tx, ws),
        recipe:
          recipe && cost
            ? {
                id: recipe.id,
                name: recipe.name,
                price: formatVnd(recipe.price),
                margin: formatPercent(D(recipe.price).minus(cost.total).div(recipe.price), 1),
                total: formatVnd(cost.total),
                lines: cost.lines.map((l, idx) => ({
                  ...l,
                  quantity: `${recipe.lines[idx]!.quantity} ${recipe.lines[idx]!.unit}`,
                  costLabel: formatVnd(l.cost),
                })),
              }
            : null,
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async adjustStock(call: CallContext, p: { itemId: string; onHand: string }) {
    const qty = requireDecimal(p.onHand, 'Tồn thực tế');
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
      const pos = (await scoped(tx, ws, 'purchaseOrders')).sort((a, b) =>
        b.code.localeCompare(a.code, undefined, { numeric: true }),
      );
      const open = pos.filter((p) => p.status !== 'PAID');
      const today = localDate(now);
      return {
        kpis: [
          {
            label: 'Công nợ phải trả',
            value: formatVnd(sum(open.map((p) => p.outstanding))),
            note: scopeNote(periodId),
          },
          {
            label: 'Đến hạn trong 7 ngày',
            value: formatVnd(
              dueWithin(
                open.map((p) => ({ id: p.id, dueDate: p.dueDate, amount: p.outstanding })),
                today,
                7,
              ),
            ),
            note: scopeNote(periodId),
          },
          { label: 'Đơn mua đang mở', value: `${open.length} đơn`, note: scopeNote(periodId) },
        ],
        items: open.map((p) => ({
          id: p.id,
          label: `${p.supplier} · ${p.code}`,
          dueDate: formatDate(p.dueDate),
          outstanding: formatVnd(p.outstanding),
          status: PO_STATUS[p.status].label,
          tone: PO_STATUS[p.status].tone,
        })),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  /** Tạo đơn mua → hồ sơ đề nghị chi gắn digest, vào hộp công việc của người duyệt. */
  async createPurchaseOrder(
    call: CallContext,
    p: { supplier: string; amount: string; dueDate: string; purpose?: string },
  ) {
    const supplier = requireText(p.supplier, 'Nhà cung cấp', 120);
    const amount = requireAmount(p.amount, 'Giá trị');
    if (D(amount).lte(0)) throw new AppError('VALIDATION', 'Giá trị phải lớn hơn 0', { field: 'amount' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate ?? ''))
      throw new AppError('VALIDATION', 'Hạn thanh toán không hợp lệ', { field: 'dueDate' });
    return this.core.command(call, async (tx, em, now) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'module.write');
      const entityId = ws0.entityId !== '*' ? ws0.entityId : await defaultSite(tx, ws0.tenantId);
      const ws = await this.core.requireWorkspace(tx, call, 'approval.request', { entityId });
      const codes = (await tx.list('purchaseOrders', ws.tenantId)).map((x) => x.code);
      const code = nextCode('PO', codes, 3, 1);
      const id = newId('po');
      const po = await tx.put('purchaseOrders', {
        id,
        tenantId: ws.tenantId,
        code,
        supplier,
        entityId,
        orderDate: localDate(now),
        dueDate: p.dueDate,
        amount,
        outstanding: amount,
        status: 'PENDING_APPROVAL',
      });
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
      await em.emit({
        type: 'ApprovalRequested',
        tenantId: ws.tenantId,
        entityId,
        aggregateType: 'Approval',
        aggregateId: approvalId,
        actorId: ws.user.id,
        dataRef: `approval/${approvalId}`,
        dataVersion: 1,
        data: { approvalId, targetType: 'EXPENSE', code },
      });
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
      const needs = docs.filter(
        (d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON' || d.status === 'EXTRACTED',
      ).length;
      const p = formatPeriod(periodId);
      return {
        kpis: [
          {
            label: 'Doanh thu đã ghi nhận',
            value: formatVnd(sum(revenueRecs.map((r) => r.amount))),
            note: scopeNote(periodId),
          },
          {
            label: 'Chi phí có chứng từ',
            value: formatVnd(sum(records.filter((r) => r.kind === 'EXPENSE').map((r) => r.amount))),
            note: scopeNote(periodId),
          },
          { label: 'Hồ sơ cần bổ sung', value: `${needs} hồ sơ`, note: scopeNote(periodId) },
        ],
        title: `Sổ kế toán & dữ liệu kỳ tháng ${Number(periodId.slice(5))}`,
        items: [
          {
            label: 'Sổ doanh thu',
            period: p,
            status: `Có ${docs.filter((d) => d.status === 'VALIDATED').length} bản ghi`,
            tone: 'success',
            action: 'Xem dữ liệu',
            route: '/documents',
          },
          {
            label: 'Sổ chi phí',
            period: p,
            status: needs ? `Cần soát ${needs} hồ sơ` : 'Đã soát',
            tone: needs ? 'warning' : 'success',
            action: 'Rà soát',
            route: '/documents',
          },
          {
            label: 'Phương pháp tính thuế',
            period: `Năm ${periodId.slice(0, 4)}`,
            status: tenant.settings.accountingRegime === 'HKD' ? 'Đã cấu hình' : 'Cần cấu hình',
            tone: tenant.settings.accountingRegime === 'HKD' ? 'success' : 'neutral',
            action: 'Chọn phương pháp',
            route: '/settings',
          },
          {
            label: 'Bản kê khai dự thảo',
            period: p,
            status: 'Chưa lập',
            tone: 'neutral',
            action: 'Lập sau rà soát',
            route: '/decision-pack',
          },
        ],
        note: 'Phương pháp và quy tắc thuế cần được chuyên môn xác nhận trước khi áp dụng.',
        regime: tenant.settings.accountingRegime,
        hkdMethod: tenant.settings.hkd?.method ?? null,
      };
    });
  }

  /** Sổ kế toán của kỳ dưới dạng tệp Excel (.xlsx) theo mẫu của Bộ Tài chính. */
  async exportBooks(call: CallContext, p: { periodId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'report.export');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const periodId = p.periodId ?? tenant.settings.currentPeriod;
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodId))
        throw new AppError('VALIDATION', 'Kỳ phải có dạng YYYY-MM');
      return buildBooks(tx, ws, tenant, periodId, this.core.deps.clock());
    });
  }

  // ───────── G2 · Doanh nghiệp ─────────

  async clients(call: CallContext, p: { q?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('clients', ws.tenantId)).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const rows = p.q ? all.filter((c) => c.name.toLowerCase().includes(p.q!.toLowerCase())) : all;
      const label = {
        MISSING_DOCS: ['Thiếu', 'warning'],
        READY: ['Sẵn sàng chốt', 'success'],
        REVIEWED: ['Đã rà soát', 'success'],
        WAITING: ['Chờ bổ sung', 'warning'],
      } as const;
      return {
        kpis: [
          { label: 'Khách hàng ủy quyền', value: String(all.length) },
          {
            label: 'Đang thiếu hồ sơ',
            value: String(all.filter((c) => c.status === 'MISSING_DOCS' || c.status === 'WAITING').length),
          },
          {
            label: 'Đã sẵn sàng chốt',
            value: String(all.filter((c) => c.status === 'READY' || c.status === 'REVIEWED').length),
          },
        ],
        items: rows.map((c) => ({
          id: c.id,
          name: c.name,
          scope: c.scope,
          completion: `${c.completion}%`,
          closeDue: formatDate(c.closeDue),
          status: c.status === 'MISSING_DOCS' ? `Thiếu ${c.missingDocs} hồ sơ` : label[c.status][0],
          tone: label[c.status][1],
        })),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async addClient(
    call: CallContext,
    p: { name: string; scope: string; closeDue: string; delegationValidUntil?: string },
  ) {
    const name = requireText(p.name, 'Tên khách hàng', 120);
    const scope = requireText(p.scope, 'Phạm vi', 80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.closeDue ?? ''))
      throw new AppError('VALIDATION', 'Hạn chốt không hợp lệ', { field: 'closeDue' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const id = newId('cli');
      await tx.put('clients', {
        id,
        tenantId: ws.tenantId,
        name,
        scope,
        completion: 0,
        closeDue: p.closeDue,
        status: 'WAITING',
        missingDocs: 0,
        delegationValidUntil: p.delegationValidUntil ?? addDays(p.closeDue, 365),
      });
      await em.audit(ws.tenantId, actor(ws), 'client.add', name);
      return { id };
    });
  }

  async sales(call: CallContext, p: PageParams = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const deals = (await tx.list('deals', ws.tenantId)).sort((a, b) =>
        b.code.localeCompare(a.code, undefined, { numeric: true }),
      );
      const contracts = deals.filter(
        (d) => ['CONTRACT', 'DELIVERY', 'INVOICE', 'COLLECTION'].includes(d.stage) && d.status !== 'DONE',
      );
      const receivable = deals.filter(
        (d) => ['DELIVERY', 'INVOICE', 'COLLECTION'].includes(d.stage) && d.status !== 'DONE',
      );
      return {
        kpis: [
          {
            label: 'Giá trị cơ hội',
            value: formatVnd(sum(deals.filter((d) => d.status !== 'DONE').map((d) => d.value))),
            note: scopeNote(periodId),
          },
          {
            label: 'Hợp đồng đang thực hiện',
            value: `${contracts.length} hợp đồng`,
            note: scopeNote(periodId),
          },
          {
            label: 'Công nợ phải thu',
            value: formatVnd(sum(receivable.map((d) => d.value))),
            note: scopeNote(periodId),
          },
        ],
        ...(() => {
          const pg = paginate(
            deals.filter((d) => d.status !== 'DONE'),
            p,
            20,
          );
          return {
            ...pg,
            items: pg.items.map((d) => ({
              id: d.id,
              label: `${d.customer} · ${d.code}`,
              stage: DEAL_STAGE[d.stage],
              stageCode: d.stage,
              value: formatVnd(d.value),
              status: DEAL_STATUS[d.status].label,
              tone: DEAL_STATUS[d.status].tone,
            })),
          };
        })(),
        stages: Object.entries(DEAL_STAGE).map(([code, label]) => ({ code, label })),
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
      await tx.put('deals', {
        id,
        tenantId: ws.tenantId,
        code,
        customer,
        stage: 'OPPORTUNITY',
        value,
        status: 'IN_PROGRESS',
        dueDate: addDays(localDate(now), 30),
      });
      await em.audit(ws.tenantId, actor(ws), 'deal.create', code, value);
      return { id, code };
    });
  }

  // ───────── G3 · Dự án ─────────

  async projects(call: CallContext, p: { projectId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('projects', ws.tenantId)).sort((a, b) => a.code.localeCompare(b.code));
      const proj = (p.projectId ? all.find((x) => x.id === p.projectId) : undefined) ?? all[0];
      const list = all.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
      if (!proj)
        return { kpis: [], project: null, projects: list, canWrite: this.core.can(ws, 'module.write') };
      const available = D(proj.budget).minus(proj.recorded).minus(proj.committed);
      return {
        kpis: [
          { label: 'Ngân sách dự án', value: millions(proj.budget), note: 'Đã phê duyệt' },
          {
            label: 'Đã ghi nhận',
            value: millions(proj.recorded),
            note: `${D(proj.budget).isZero() ? '0' : formatNumber(D(proj.recorded).div(proj.budget).times(100), 0)}% ngân sách`,
          },
          {
            label: 'Cam kết chưa ghi nhận',
            value: millions(proj.committed),
            note: `Còn khả dụng ${millions(available.toFixed())}`,
          },
        ],
        project: {
          id: proj.id,
          title: proj.name,
          subtitle: `WBS · ${proj.wbs.length} công việc · Chủ nhiệm: ${proj.manager}`,
          tasks: proj.wbs.map((t) => ({
            ...t,
            label: `${t.code} · ${t.name}`,
            dependsOn: t.dependsOn ?? '—',
            progressLabel: `${t.progress}%`,
            statusLabel: WBS_STATUS[t.status].label,
            tone: WBS_STATUS[t.status].tone,
          })),
        },
        projects: list,
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async addWbsTask(
    call: CallContext,
    p: { projectId: string; name: string; owner: string; dependsOn?: string | null },
  ) {
    const name = requireText(p.name, 'Tên công việc', 120);
    const owner = requireText(p.owner, 'Phụ trách', 80);
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const proj = requireFound(await tx.get('projects', ws.tenantId, p.projectId), 'dự án');
      if (p.dependsOn && !proj.wbs.some((t) => t.code === p.dependsOn))
        throw new AppError('VALIDATION', 'Công việc phụ thuộc không tồn tại', { field: 'dependsOn' });
      const major = proj.wbs[0]?.code.split('.')[0] ?? '1';
      const code = `${major}.${proj.wbs.length + 1}`;
      await tx.put('projects', {
        ...proj,
        wbs: [
          ...proj.wbs,
          { code, name, dependsOn: p.dependsOn ?? null, owner, progress: 0, status: 'NOT_STARTED' },
        ],
      });
      await em.audit(ws.tenantId, actor(ws), 'wbs.add', proj.code, `${code} ${name}`);
      return { code };
    });
  }

  async assets(call: CallContext) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const periodId = await this.period(ws.tenantId, tx);
      const rows = (await tx.list('assets', ws.tenantId)).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const metrics = rows.filter((r) => r.kind === 'METRIC');
      const assets = rows.filter((r) => r.kind === 'ASSET');
      const savings = sum(metrics.map((m) => energySavings(m.baseline, m.reporting).savingsKwh));
      const today = localDate(now);
      const isDue = (a: AssetRow) =>
        a.kind === 'ASSET' && !!a.dueDate && a.dueDate <= addDays(today, 7) && a.status !== 'OK';
      const due = assets.filter(isDue);
      return {
        kpis: [
          { label: 'Tài sản đang vận hành', value: `${assets.length} tài sản`, note: scopeNote(periodId) },
          { label: 'Tiết kiệm năng lượng', value: `${formatNumber(savings)} kWh`, note: scopeNote(periodId) },
          { label: 'Lịch bảo trì đến hạn', value: `${due.length} lịch`, note: scopeNote(periodId) },
        ],
        title: `Đo lường & kiểm chứng · ${requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức').name}`,
        items: rows
          .filter((r) => r.kind === 'METRIC' || r.status !== 'OK')
          .map((r) => {
            if (r.kind === 'METRIC') {
              const s = energySavings(r.baseline, r.reporting);
              return {
                id: r.id,
                name: r.name,
                baseline: `${formatNumber(D(r.baseline))} ${r.unit}`,
                period: `${formatNumber(D(r.reporting))} ${r.unit}`,
                result: `Giảm ${formatPercent(s.savingsRatio, 0)}`,
                tone: 'success',
                isMetric: true,
              };
            }
            const dueNow = isDue(r) || r.status === 'MAINTENANCE_DUE';
            return {
              id: r.id,
              name: r.name,
              baseline: r.schedule || r.projectCode,
              period: r.dueDate ? formatDate(r.dueDate) : '',
              result: dueNow ? 'Đến hạn bảo trì' : 'Đang theo dõi',
              tone: dueNow ? 'warning' : 'success',
              isMetric: false,
              canComplete: dueNow,
            };
          }),
        canWrite: this.core.can(ws, 'module.write'),
      };
    });
  }

  async logistics(call: CallContext, p: { shipmentId?: string } = {}) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('shipments', ws.tenantId)).sort((a, b) =>
        b.code.localeCompare(a.code, undefined, { numeric: true }),
      );
      const sh = (p.shipmentId ? all.find((x) => x.id === p.shipmentId) : undefined) ?? all[0];
      const shipments = all.map((x) => ({ id: x.id, label: `${x.code} · ${x.route}` }));
      const canWrite = this.core.can(ws, 'module.write');
      if (!sh) return { shipment: null, shipments, canWrite };
      const end = freeTimeEnd(sh.freeTimeStart, sh.freeDays);
      const daysLeft = Math.round((Date.parse(end) - Date.parse(localDate(now))) / 86_400_000);
      const statusLabel = SHIPMENT_STATUS[sh.status];
      return {
        shipment: {
          id: sh.id,
          title: `Lô hàng ${sh.code}`,
          subtitle: `${sh.route} · ${sh.container}`,
          statusLabel,
          events: sh.events.map((e) => ({ ...e, atLabel: formatShortDateTime(e.at).replace(', ', ' · ') })),
          documents: sh.documents,
          freeTimeEnd: formatDate(end),
          freeTimeNote:
            daysLeft >= 0
              ? `Còn ${daysLeft} ngày theo biểu phí ${sh.tariffCode}. Xem chi tiết để dự kiến chi phí phát sinh.`
              : `Đã quá ${-daysLeft} ngày miễn phí theo biểu phí ${sh.tariffCode}. Chi phí lưu bãi đang phát sinh.`,
          status: sh.status,
        },
        shipments,
        statuses: Object.entries(SHIPMENT_STATUS).map(([code, label]) => ({ code, label })),
        canWrite,
      };
    });
  }

  async logisticsFinance(call: CallContext, p: { shipmentId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('shipments', ws.tenantId)).sort((a, b) =>
        b.code.localeCompare(a.code, undefined, { numeric: true }),
      );
      const sh = (p.shipmentId ? all.find((x) => x.id === p.shipmentId) : undefined) ?? all[0];
      const shipments = all.map((x) => ({ id: x.id, label: `${x.code} · ${x.route}` }));
      if (!sh) return { shipment: null, shipments, canWrite: this.core.can(ws, 'module.write') };
      const storage = chargeAfterFreeTime(sh.freeDays + sh.storageDays, sh.freeDays, [
        { fromDay: 1, toDay: null, ratePerDay: sh.storageRatePerDay },
      ]);
      const costs = sh.costs.map((c) =>
        c.name === 'Lưu bãi'
          ? {
              ...c,
              amount: storage.amount,
              basis: `${storage.chargeableDays} ngày × ${formatNumber(D(sh.storageRatePerDay))}`,
            }
          : c,
      );
      const totalCost = sum(costs.map((c) => c.amount));
      const profit = D(sh.revenue).minus(totalCost);
      const alloc = allocateByDriver(
        totalCost,
        sh.allocation.map((a) => ({ id: a.item, driver: a.weightShare })),
      );
      const short = (v: string) =>
        `${formatNumber(D(v).div(1_000_000), D(v).div(1_000_000).isInteger() ? 0 : 1)}tr`;
      return {
        shipment: {
          id: sh.id,
          code: sh.code,
          kpis: [
            { label: 'Doanh thu lô hàng', value: formatVnd(sh.revenue), note: sh.code },
            {
              label: 'Giá vốn sau phân bổ',
              value: formatVnd(totalCost),
              note: costs
                .map(
                  (c) =>
                    `${c.name.replace('Cước vận chuyển', 'Cước').replace('Phí nội địa', 'Nội địa')} ${short(c.amount)}`,
                )
                .join(' · '),
            },
            {
              label: 'Lợi nhuận gộp',
              value: formatVnd(profit),
              note: D(sh.revenue).isZero()
                ? 'Chưa có doanh thu lô hàng'
                : `Biên lợi nhuận gộp ${formatPercent(profit.div(sh.revenue))}`,
            },
          ],
          tariff: `Biểu phí: ${sh.tariffCode} · Hiệu lực từ ${formatDate(sh.tariffFrom)}`,
          costs: costs.map((c) => ({ ...c, amountLabel: formatVnd(c.amount) })),
          allocation: alloc.map((a) => ({
            item: a.id,
            share: `${formatNumber(D(a.share).times(100), 0)}% trọng lượng`,
            amount: formatVnd(a.amount),
          })),
          allocationConfirmed: sh.allocationConfirmed,
        },
        shipments,
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
      const ics = await tx.list('intercompany', ws.tenantId);
      const register = (await tx.list('groupEntities', ws.tenantId))
        .sort((a, b) => a.code.localeCompare(b.code, 'vi'))
        .sort((a, b) => order(a.code) - order(b.code));
      const rows = register.length
        ? register
        : await deriveGroupRows(tx, ws, tenant.settings.currentPeriod, ics);
      const diffs = ics.map((ic) =>
        matchIntercompany(
          { ...ic.sideA, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
          { ...ic.sideB, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
        ),
      );
      const totalDiff = sum(diffs.map((d) => D(d.difference).abs()));
      const submitted = rows.filter((r) => r.periodStatus === 'SUBMITTED').length;
      return {
        kpis: [
          {
            label: 'Pháp nhân trong phạm vi',
            value: `${rows.length} đơn vị`,
            note: 'Quyền truy xuống theo pháp nhân',
          },
          {
            label: 'Đã gửi dữ liệu kỳ',
            value: `${submitted} / ${rows.length} đơn vị`,
            note: `Còn ${rows.length - submitted} đơn vị chờ hoàn tất`,
          },
          {
            label: 'Chênh lệch nội bộ',
            value: formatVnd(totalDiff),
            note: `${diffs.filter((d) => d.status === 'DIFFERENCE').length} cặp cần đối chiếu`,
            highlight: true,
          },
        ],
        title: `Tiến độ kỳ ${formatPeriod(tenant.settings.currentPeriod).toLowerCase()}`,
        canWrite: this.core.can(ws, 'settings.manage'),
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          docs: `${r.docsSubmitted} / ${r.docsTotal}`,
          status: r.periodStatus === 'SUBMITTED' ? 'Đã gửi' : 'Chờ hoàn tất',
          tone: r.periodStatus === 'SUBMITTED' ? 'success' : 'warning',
          ic: r.icStatus,
        })),
      };
    });
  }

  async intercompany(call: CallContext, p: { pairId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('intercompany', ws.tenantId)).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
      const ic = (p.pairId ? all.find((x) => x.id === p.pairId) : undefined) ?? all[0];
      const pairs = all.map((x) => ({
        id: x.id,
        label: `${x.reference} · ${x.sideA.name} ↔ ${x.sideB.name}`,
        status: x.status,
      }));
      const legal = (await tx.list('entities', ws.tenantId, { kind: 'LEGAL_ENTITY' })).map((e) => ({
        id: e.id,
        name: e.name,
      }));
      const canWrite = this.core.can(ws, 'recon.confirm');
      if (!ic) return { pair: null, pairs, entities: legal, canWrite };
      const m = matchIntercompany(
        { ...ic.sideA, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
        { ...ic.sideB, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
      );
      const period = `T${Number(ic.periodId.slice(5))}/${ic.periodId.slice(0, 4)}`;
      return {
        pair: {
          id: ic.id,
          reference: ic.reference,
          kpis: [
            {
              label: `Phải thu · ${ic.sideA.name}`,
              value: formatVnd(ic.sideA.amount),
              note: `Đối tác nội bộ: ${ic.sideB.name}`,
            },
            {
              label: `Phải trả · ${ic.sideB.name}`,
              value: formatVnd(ic.sideB.amount),
              note: `Cùng kỳ ${formatPeriod(ic.periodId).toLowerCase()}`,
            },
            {
              label: 'Chênh lệch',
              value: formatVnd(D(m.difference).abs()),
              note:
                ic.status === 'REQUESTED'
                  ? 'Đã gửi yêu cầu bổ sung chứng từ'
                  : m.status === 'MATCHED'
                    ? 'Hai phía đã khớp'
                    : 'Chờ xác minh chứng từ phí',
            },
          ],
          sideAName: ic.sideA.name,
          sideBName: ic.sideB.name,
          rows: [
            {
              label: 'Hợp đồng / kỳ',
              a: `${ic.contract} · ${period}`,
              b: `${ic.contract} · ${period}`,
              result: m.sameReference && m.samePeriod ? 'Cùng tham chiếu' : 'Khác tham chiếu',
              tone: m.sameReference ? 'success' : 'warning',
            },
            {
              label: 'Giá trị ghi nhận',
              a: formatVnd(ic.sideA.amount),
              b: formatVnd(ic.sideB.amount),
              result: m.status === 'MATCHED' ? 'Đã khớp' : `Lệch ${formatVnd(D(m.difference).abs())}`,
              tone: m.status === 'MATCHED' ? 'success' : 'warning',
            },
          ],
          nextAction: ic.nextAction,
          status: ic.status,
          eliminationDraft: m.eliminationDraft,
        },
        pairs,
        entities: legal,
        canWrite,
      };
    });
  }

  async requestIntercompanyDocs(call: CallContext, p: { pairId: string }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.confirm');
      const ic = requireFound(await tx.get('intercompany', ws.tenantId, p.pairId), 'cặp đối soát nội bộ');
      if (ic.status === 'REQUESTED') throw new AppError('CONFLICT', 'Đã gửi yêu cầu bổ sung trước đó');
      await tx.put('intercompany', { ...ic, status: 'REQUESTED', requestedAt: now });
      await tx.put('notifications', {
        id: newId('ntf'),
        tenantId: ws.tenantId,
        userId: null,
        title: `Yêu cầu ${ic.sideB.name} bổ sung chứng từ`,
        unitLabel: ic.sideB.name,
        refCode: ic.reference,
        route: '/intercompany',
        status: 'UNREAD',
        actionRequired: true,
        statusLabel: 'Cần xem',
      });
      await em.audit(ws.tenantId, actor(ws), 'intercompany.request_docs', ic.reference);
      return { ok: true };
    });
  }

  // ───────── Ghi dữ liệu phân hệ (tạo / cập nhật) ─────────

  /** Mở ca: số hệ thống theo từng kênh (máy POS / nền tảng), thực kiểm nhập khi gửi chốt. */
  async openShift(
    call: CallContext,
    p: {
      entityId?: string;
      date: string;
      shift: string;
      system: { cash?: string; transfer?: string; platform?: string };
    },
  ) {
    const date = requireDate(p.date, 'Ngày');
    const shift = requireText(p.shift, 'Ca làm việc', 40);
    const system = [p.system?.cash ?? '0', p.system?.transfer ?? '0', p.system?.platform ?? '0'].map((v, i) =>
      requireNonNegative(v || '0', `Hệ thống · ${SHIFT_CHANNELS[i]}`),
    );
    return this.core.command(call, async (tx, em) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'module.write');
      const entityId = await resolveUnit(tx, ws0, p.entityId);
      const ws = await this.core.requireWorkspace(tx, call, 'module.write', { entityId });
      const dup = (await tx.list('dailyCloses', ws.tenantId)).some(
        (x) => x.entityId === entityId && x.date === date && x.shift.toLowerCase() === shift.toLowerCase(),
      );
      if (dup) throw new AppError('CONFLICT', `${shift} ngày ${formatDate(date)} đã được mở`);
      const id = newId('shift');
      await tx.put('dailyCloses', {
        id,
        tenantId: ws.tenantId,
        entityId,
        date,
        shift,
        lines: SHIFT_CHANNELS.map((channel, i) => ({ channel, system: system[i]!, counted: '0' })),
        status: 'OPEN',
        submittedBy: null,
        submittedAt: null,
      });
      await em.audit(ws.tenantId, actor(ws), 'daily_close.open', `${shift} ${date}`);
      return { id };
    });
  }

  async addInventoryItem(
    call: CallContext,
    p: {
      name: string;
      unit: string;
      onHand: string;
      unitCost: string;
      reorderLevel?: string;
      entityId?: string;
    },
  ) {
    const name = requireText(p.name, 'Tên nguyên liệu', 120);
    const unit = requireText(p.unit, 'Đơn vị tính', 20);
    const onHand = requireDecimal(p.onHand, 'Tồn hiện có');
    const unitCost = requireNonNegative(p.unitCost, 'Đơn giá vốn');
    const reorderLevel = requireDecimal(p.reorderLevel || '0', 'Mức cảnh báo');
    return this.core.command(call, async (tx, em) => {
      const ws0 = await this.core.requireWorkspace(tx, call, 'module.write');
      const entityId = await resolveUnit(tx, ws0, p.entityId);
      const ws = await this.core.requireWorkspace(tx, call, 'module.write', { entityId });
      if (
        (await tx.list('inventoryItems', ws.tenantId)).some(
          (i) => i.entityId === entityId && i.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new AppError('CONFLICT', `Nguyên liệu "${name}" đã có trong kho`, { field: 'name' });
      }
      const id = newId('itm');
      await tx.put('inventoryItems', {
        id,
        tenantId: ws.tenantId,
        entityId,
        name,
        unit,
        onHand,
        reorderLevel,
        unitCost,
      });
      await em.audit(ws.tenantId, actor(ws), 'inventory.add', name, `${onHand} ${unit}`);
      return { id };
    });
  }

  /** Công thức (định mức): giá bán, tỷ lệ hao hụt và lượng từng nguyên liệu. */
  async saveRecipe(
    call: CallContext,
    p: {
      recipeId?: string;
      name: string;
      price: string;
      wasteRate?: string;
      lines: { itemId: string; quantity: string }[];
    },
  ) {
    const name = requireText(p.name, 'Tên món / sản phẩm', 120);
    const price = requireNonNegative(p.price, 'Giá bán');
    if (D(price).lte(0)) throw new AppError('VALIDATION', 'Giá bán phải lớn hơn 0', { field: 'price' });
    const wasteRate = requireDecimal(p.wasteRate || '0', 'Tỷ lệ hao hụt');
    if (D(wasteRate).gte(1))
      throw new AppError('VALIDATION', 'Tỷ lệ hao hụt phải nhỏ hơn 100%', { field: 'wasteRate' });
    if (!Array.isArray(p.lines) || p.lines.length === 0)
      throw new AppError('VALIDATION', 'Công thức cần ít nhất một nguyên liệu', { field: 'lines' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const lines = await Promise.all(
        p.lines.map(async (l) => {
          const item = requireFound(await tx.get('inventoryItems', ws.tenantId, l.itemId), 'nguyên liệu');
          const quantity = requireDecimal(l.quantity, `Định lượng ${item.name}`);
          if (D(quantity).lte(0))
            throw new AppError('VALIDATION', `Định lượng ${item.name} phải lớn hơn 0`, { field: 'lines' });
          return { itemId: item.id, name: item.name, quantity, unit: item.unit, unitCost: item.unitCost };
        }),
      );
      const existing = p.recipeId
        ? requireFound(await tx.get('recipes', ws.tenantId, p.recipeId), 'công thức')
        : undefined;
      const id = existing?.id ?? newId('rcp');
      await tx.put('recipes', {
        ...(existing ?? {}),
        id,
        tenantId: ws.tenantId,
        name,
        price,
        wasteRate,
        lines,
      });
      await em.audit(ws.tenantId, actor(ws), existing ? 'recipe.update' : 'recipe.create', name);
      return { id };
    });
  }

  async updateDealStage(call: CallContext, p: { dealId: string; stage: DealRow['stage']; done?: boolean }) {
    if (!(p.stage in DEAL_STAGE))
      throw new AppError('VALIDATION', 'Giai đoạn không hợp lệ', { field: 'stage' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const deal = requireFound(await tx.get('deals', ws.tenantId, p.dealId), 'cơ hội bán hàng');
      const status: DealRow['status'] = p.done
        ? 'DONE'
        : p.stage === 'COLLECTION' || p.stage === 'INVOICE'
          ? 'DUE'
          : p.stage === 'QUOTE'
            ? 'WAITING_REPLY'
            : 'IN_PROGRESS';
      await tx.put('deals', { ...deal, stage: p.stage, status });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'deal.stage',
        deal.code,
        `${DEAL_STAGE[deal.stage]} → ${DEAL_STAGE[p.stage]}${p.done ? ' (hoàn tất)' : ''}`,
      );
      return { ok: true };
    });
  }

  async createProject(call: CallContext, p: { name: string; manager: string; budget: string }) {
    const name = requireText(p.name, 'Tên dự án', 120);
    const manager = requireText(p.manager, 'Chủ nhiệm', 80);
    const budget = requireNonNegative(p.budget, 'Ngân sách');
    if (D(budget).lte(0)) throw new AppError('VALIDATION', 'Ngân sách phải lớn hơn 0', { field: 'budget' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const code = nextCode(
        'DA',
        (await tx.list('projects', ws.tenantId)).map((x) => x.code),
        3,
        1,
      );
      const id = newId('prj');
      await tx.put('projects', {
        id,
        tenantId: ws.tenantId,
        code,
        name,
        manager,
        budget,
        recorded: '0',
        committed: '0',
        wbs: [],
      });
      await em.audit(ws.tenantId, actor(ws), 'project.create', code, name);
      return { id, code };
    });
  }

  async updateWbsTask(call: CallContext, p: { projectId: string; code: string; progress: number | string }) {
    const progress = Number(p.progress);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100)
      throw new AppError('VALIDATION', 'Tiến độ phải từ 0 đến 100', { field: 'progress' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const proj = requireFound(await tx.get('projects', ws.tenantId, p.projectId), 'dự án');
      const task = requireFound(
        proj.wbs.find((t) => t.code === p.code),
        'công việc',
      );
      if (task.dependsOn && progress > 0) {
        const dep = proj.wbs.find((t) => t.code === task.dependsOn);
        if (dep && dep.status === 'NOT_STARTED')
          throw new AppError('VALIDATION', `Công việc ${dep.code} cần được bắt đầu trước`, {
            field: 'progress',
          });
      }
      const status: WbsTask['status'] =
        progress === 0 ? 'NOT_STARTED' : progress === 100 ? 'DONE' : 'IN_PROGRESS';
      await tx.put('projects', {
        ...proj,
        wbs: proj.wbs.map((t) => (t.code === p.code ? { ...t, progress, status } : t)),
      });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'wbs.progress',
        `${proj.code} ${task.code}`,
        `${task.progress}% → ${progress}%`,
      );
      return { ok: true };
    });
  }

  /** Ghi nhận chi phí thực tế hoặc cam kết (hợp đồng / đơn mua) vào ngân sách dự án. */
  async recordProjectCost(
    call: CallContext,
    p: { projectId: string; kind: 'RECORDED' | 'COMMITTED'; amount: string },
  ) {
    const amount = requireNonNegative(p.amount, 'Số tiền');
    if (D(amount).lte(0)) throw new AppError('VALIDATION', 'Số tiền phải lớn hơn 0', { field: 'amount' });
    if (p.kind !== 'RECORDED' && p.kind !== 'COMMITTED')
      throw new AppError('VALIDATION', 'Loại chi phí không hợp lệ', { field: 'kind' });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const proj = requireFound(await tx.get('projects', ws.tenantId, p.projectId), 'dự án');
      const next =
        p.kind === 'RECORDED'
          ? { ...proj, recorded: dec(D(proj.recorded).plus(amount)) }
          : { ...proj, committed: dec(D(proj.committed).plus(amount)) };
      await tx.put('projects', next);
      await em.audit(
        ws.tenantId,
        actor(ws),
        p.kind === 'RECORDED' ? 'project.cost' : 'project.commit',
        proj.code,
        amount,
      );
      const over = D(next.recorded).plus(next.committed).gt(next.budget);
      return { ok: true, overBudget: over };
    });
  }

  async addAsset(
    call: CallContext,
    p: {
      kind: AssetRow['kind'];
      name: string;
      unit?: string;
      baseline?: string;
      reporting?: string;
      schedule?: string;
      dueDate?: string | null;
    },
  ) {
    if (p.kind !== 'ASSET' && p.kind !== 'METRIC')
      throw new AppError('VALIDATION', 'Loại tài sản không hợp lệ', { field: 'kind' });
    const name = requireText(p.name, p.kind === 'METRIC' ? 'Tên chỉ số' : 'Tên tài sản', 120);
    const baseline = p.kind === 'METRIC' ? requireDecimal(p.baseline, 'Đường cơ sở') : '0';
    const reporting = p.kind === 'METRIC' ? requireDecimal(p.reporting, 'Kỳ báo cáo') : '0';
    const unit = p.kind === 'METRIC' ? requireText(p.unit, 'Đơn vị đo', 20) : '';
    const dueDate = p.kind === 'ASSET' && p.dueDate ? requireDate(p.dueDate, 'Hạn bảo trì') : null;
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const code = nextCode(
        p.kind === 'METRIC' ? 'CS' : 'TS',
        (await tx.list('assets', ws.tenantId)).map((a) => a.code),
        3,
        1,
      );
      const id = newId('ast');
      await tx.put('assets', {
        id,
        tenantId: ws.tenantId,
        code,
        name,
        kind: p.kind,
        projectCode: code,
        baseline,
        reporting,
        unit,
        schedule: (p.schedule ?? '').trim().slice(0, 80),
        dueDate,
        status: 'MONITORING',
      });
      await em.audit(ws.tenantId, actor(ws), 'asset.add', code, name);
      return { id, code };
    });
  }

  async completeMaintenance(call: CallContext, p: { assetId: string; nextDueDate?: string | null }) {
    const next = p.nextDueDate ? requireDate(p.nextDueDate, 'Hạn bảo trì kế tiếp') : null;
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const asset = requireFound(await tx.get('assets', ws.tenantId, p.assetId), 'tài sản');
      if (asset.kind !== 'ASSET') throw new AppError('VALIDATION', 'Chỉ áp dụng cho tài sản');
      if (next && next <= localDate(now))
        throw new AppError('VALIDATION', 'Hạn bảo trì kế tiếp phải sau hôm nay', { field: 'nextDueDate' });
      await tx.put('assets', { ...asset, status: 'MONITORING', dueDate: next });
      await em.audit(ws.tenantId, actor(ws), 'asset.maintenance', asset.code, next ? `kế tiếp ${next}` : '');
      return { ok: true };
    });
  }

  async createShipment(
    call: CallContext,
    p: {
      route: string;
      container: string;
      freeTimeStart: string;
      freeDays: number | string;
      storageRatePerDay: string;
      tariffCode?: string;
      revenue: string;
      costs?: { name: string; basis?: string; amount: string }[];
      allocation?: { item: string; weightShare: string }[];
    },
  ) {
    const route = requireText(p.route, 'Tuyến', 120);
    const container = requireText(p.container, 'Container / phương tiện', 60);
    const freeTimeStart = requireDate(p.freeTimeStart, 'Ngày bắt đầu tính miễn phí');
    const freeDays = Number(p.freeDays);
    if (!Number.isInteger(freeDays) || freeDays < 0 || freeDays > 60)
      throw new AppError('VALIDATION', 'Số ngày miễn phí phải từ 0 đến 60', { field: 'freeDays' });
    const storageRatePerDay = requireNonNegative(p.storageRatePerDay, 'Phí lưu bãi / ngày');
    const revenue = requireNonNegative(p.revenue, 'Doanh thu lô hàng');
    const costs = (p.costs ?? [])
      .filter((c) => c.name?.trim())
      .map((c) => ({
        name: requireText(c.name, 'Tên chi phí', 60),
        basis: (c.basis ?? '').trim().slice(0, 80),
        amount: requireNonNegative(c.amount, `Chi phí ${c.name}`),
      }));
    const allocation = (p.allocation ?? [])
      .filter((a) => a.item?.trim())
      .map((a) => ({
        item: requireText(a.item, 'Mặt hàng', 80),
        weightShare: requireDecimal(a.weightShare, `Tỷ trọng ${a.item}`),
      }));
    if (allocation.length && !sum(allocation.map((a) => a.weightShare)).gt(0))
      throw new AppError('VALIDATION', 'Tổng tỷ trọng phân bổ phải lớn hơn 0', { field: 'allocation' });
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const code = nextCode(
        'LH',
        (await tx.list('shipments', ws.tenantId)).map((x) => x.code),
        3,
        1,
      );
      const id = newId('shp');
      await tx.put('shipments', {
        id,
        tenantId: ws.tenantId,
        code,
        route,
        container,
        status: 'IN_TRANSIT',
        events: [{ title: 'Đã tạo hồ sơ lô hàng', detail: `${route} · ${container}`, at: now, done: true }],
        documents: [],
        freeTimeStart,
        freeDays,
        tariffCode: (p.tariffCode ?? '').trim() || 'Theo hợp đồng',
        tariffFrom: freeTimeStart,
        storageRatePerDay,
        storageDays: 0,
        revenue,
        costs: [...costs.filter((c) => c.name !== 'Lưu bãi'), { name: 'Lưu bãi', basis: '', amount: '0' }],
        allocation: allocation.length ? allocation : [{ item: 'Toàn bộ lô hàng', weightShare: '1' }],
        allocationConfirmed: false,
      });
      await em.audit(ws.tenantId, actor(ws), 'shipment.create', code, route);
      return { id, code };
    });
  }

  /** Cập nhật hành trình: thêm mốc, đổi trạng thái; số ngày lưu bãi tính theo ngày thực tế. */
  async addShipmentEvent(
    call: CallContext,
    p: {
      shipmentId: string;
      title: string;
      detail?: string;
      status?: ShipmentRow['status'];
      document?: string;
    },
  ) {
    const title = requireText(p.title, 'Mốc hành trình', 120);
    if (p.status && !(p.status in SHIPMENT_STATUS))
      throw new AppError('VALIDATION', 'Trạng thái không hợp lệ', { field: 'status' });
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const sh = requireFound(await tx.get('shipments', ws.tenantId, p.shipmentId), 'lô hàng');
      if (sh.status === 'DELIVERED')
        throw new AppError('CONFLICT', 'Lô hàng đã giao, không thể cập nhật hành trình');
      const elapsed = Math.max(
        0,
        Math.round((Date.parse(localDate(now)) - Date.parse(sh.freeTimeStart)) / 86_400_000),
      );
      const next: ShipmentRow = {
        ...sh,
        status: p.status ?? sh.status,
        events: [...sh.events, { title, detail: (p.detail ?? '').trim().slice(0, 160), at: now, done: true }],
        documents: p.document?.trim()
          ? [...sh.documents, { name: p.document.trim().slice(0, 80), status: 'Đã đính kèm' }]
          : sh.documents,
        storageDays: Math.max(0, elapsed - sh.freeDays),
      };
      await tx.put('shipments', next);
      await em.audit(ws.tenantId, actor(ws), 'shipment.event', sh.code, title);
      return { ok: true };
    });
  }

  async addShipmentCost(
    call: CallContext,
    p: { shipmentId: string; name: string; basis?: string; amount: string },
  ) {
    const name = requireText(p.name, 'Tên chi phí', 60);
    if (name === 'Lưu bãi')
      throw new AppError('VALIDATION', 'Phí lưu bãi được tính tự động theo biểu phí', { field: 'name' });
    const amount = requireNonNegative(p.amount, 'Số tiền');
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'module.write');
      const sh = requireFound(await tx.get('shipments', ws.tenantId, p.shipmentId), 'lô hàng');
      if (sh.allocationConfirmed)
        throw new AppError('CONFLICT', 'Phân bổ giá vốn đã xác nhận, không thể thêm chi phí');
      await tx.put('shipments', {
        ...sh,
        costs: [
          ...sh.costs.filter((c) => c.name !== 'Lưu bãi'),
          { name, basis: (p.basis ?? '').trim().slice(0, 80), amount },
          ...sh.costs.filter((c) => c.name === 'Lưu bãi'),
        ],
      });
      await em.audit(ws.tenantId, actor(ws), 'shipment.cost', sh.code, `${name} ${amount}`);
      return { ok: true };
    });
  }

  async createIntercompanyPair(
    call: CallContext,
    p: {
      reference: string;
      contract?: string;
      sideAEntityId: string;
      sideAAmount: string;
      sideBEntityId: string;
      sideBAmount: string;
      periodId?: string;
    },
  ) {
    const reference = requireText(p.reference, 'Mã tham chiếu chung', 40);
    const sideAAmount = requireNonNegative(p.sideAAmount, 'Phải thu');
    const sideBAmount = requireNonNegative(p.sideBAmount, 'Phải trả');
    if (p.sideAEntityId === p.sideBEntityId)
      throw new AppError('VALIDATION', 'Hai phía phải là hai pháp nhân khác nhau', {
        field: 'sideBEntityId',
      });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.confirm');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const periodId =
        p.periodId && /^\d{4}-\d{2}$/.test(p.periodId) ? p.periodId : tenant.settings.currentPeriod;
      const a = requireFound(await tx.get('entities', ws.tenantId, p.sideAEntityId), 'pháp nhân phải thu');
      const b = requireFound(await tx.get('entities', ws.tenantId, p.sideBEntityId), 'pháp nhân phải trả');
      if (a.kind !== 'LEGAL_ENTITY' || b.kind !== 'LEGAL_ENTITY')
        throw new AppError('VALIDATION', 'Đối soát nội bộ áp dụng giữa các pháp nhân');
      if (
        (await tx.list('intercompany', ws.tenantId)).some(
          (x) => x.reference === reference && x.periodId === periodId,
        )
      )
        throw new AppError('CONFLICT', `Mã tham chiếu ${reference} đã có trong kỳ`, { field: 'reference' });
      const sideA = { entityId: a.id, name: a.name, role: 'RECEIVABLE' as const, amount: sideAAmount };
      const sideB = { entityId: b.id, name: b.name, role: 'PAYABLE' as const, amount: sideBAmount };
      const m = matchIntercompany(
        { ...sideA, reference, currency: 'VND', periodId },
        { ...sideB, reference, currency: 'VND', periodId },
      );
      const id = newId('ic');
      await tx.put('intercompany', {
        id,
        tenantId: ws.tenantId,
        reference,
        contract: (p.contract ?? '').trim() || reference,
        periodId,
        sideA,
        sideB,
        status: m.status === 'MATCHED' ? 'MATCHED' : 'DIFFERENCE',
        nextAction:
          m.status === 'MATCHED'
            ? 'Hai phía đã khớp. Bút toán loại trừ nội bộ sẵn sàng cho hợp nhất.'
            : `Lệch ${formatVnd(D(m.difference).abs())}. Đề nghị ${b.name} rà soát chứng từ và điều chỉnh số ghi nhận.`,
        requestedAt: null,
      });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'intercompany.create',
        reference,
        `${sideAAmount} / ${sideBAmount}`,
      );
      return { id };
    });
  }

  async updateIntercompanyAmounts(
    call: CallContext,
    p: { pairId: string; sideAAmount: string; sideBAmount: string },
  ) {
    const sideAAmount = requireNonNegative(p.sideAAmount, 'Phải thu');
    const sideBAmount = requireNonNegative(p.sideBAmount, 'Phải trả');
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'recon.confirm');
      const ic = requireFound(await tx.get('intercompany', ws.tenantId, p.pairId), 'cặp đối soát nội bộ');
      const sideA = { ...ic.sideA, amount: sideAAmount };
      const sideB = { ...ic.sideB, amount: sideBAmount };
      const m = matchIntercompany(
        { ...sideA, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
        { ...sideB, reference: ic.reference, currency: 'VND', periodId: ic.periodId },
      );
      const matched = m.status === 'MATCHED';
      await tx.put('intercompany', {
        ...ic,
        sideA,
        sideB,
        status: matched ? 'MATCHED' : ic.status === 'REQUESTED' ? 'REQUESTED' : 'DIFFERENCE',
        nextAction: matched
          ? 'Hai phía đã khớp. Bút toán loại trừ nội bộ sẵn sàng cho hợp nhất.'
          : `Còn lệch ${formatVnd(D(m.difference).abs())}. Tiếp tục rà soát chứng từ hai phía.`,
      });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'intercompany.update',
        ic.reference,
        `${sideAAmount} / ${sideBAmount}`,
      );
      return { ok: true, matched };
    });
  }
}

const SHIPMENT_STATUS: Record<ShipmentRow['status'], string> = {
  IN_TRANSIT: 'Đang vận chuyển',
  CUSTOMS: 'Đang thông quan',
  DELIVERING: 'Đang giao nhận',
  DELIVERED: 'Đã giao',
};
const SHIFT_CHANNELS = ['Tiền mặt', 'Chuyển khoản', 'Nền tảng giao hàng'] as const;

/** Units a member can record operations for: sites, or the legal entities when the organisation has no sites. */
async function unitOptions(tx: Tx, ws: WorkspaceState): Promise<{ id: string; label: string }[]> {
  const all = await tx.list('entities', ws.tenantId);
  const sites = all.filter((e) => e.kind === 'SITE');
  const pool = sites.length ? sites : all.filter((e) => e.kind === 'LEGAL_ENTITY');
  return pool
    .filter((e) => ws.entityId === '*' || e.id === ws.entityId || e.parentId === ws.entityId)
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((e) => ({ id: e.id, label: e.name }));
}

async function resolveUnit(tx: Tx, ws: WorkspaceState, entityId: string | undefined): Promise<string> {
  const units = await unitOptions(tx, ws);
  if (entityId) {
    if (!units.some((u) => u.id === entityId))
      throw new AppError('VALIDATION', 'Đơn vị không thuộc phạm vi của bạn', { field: 'entityId' });
    return entityId;
  }
  if (ws.entityId !== '*' && units.some((u) => u.id === ws.entityId)) return ws.entityId;
  const first = units[0];
  if (!first) throw new AppError('VALIDATION', 'Tổ chức chưa có đơn vị nào', { field: 'entityId' });
  return first.id;
}

/** Group view for organisations without a separate group register: one row per legal entity, from live data. */
async function deriveGroupRows(tx: Tx, ws: WorkspaceState, periodId: string, ics: IntercompanyRow[]) {
  const entities = await tx.list('entities', ws.tenantId);
  const docs = (await tx.list('documents', ws.tenantId)).filter(
    (d) => d.date.slice(0, 7) === periodId && d.status !== 'REJECTED',
  );
  const periods = await tx.list('periods', ws.tenantId);
  return Promise.all(
    entities
      .filter((e) => e.kind === 'LEGAL_ENTITY')
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(async (e) => {
        const unitIds = new Set([e.id, ...entities.filter((x) => x.parentId === e.id).map((x) => x.id)]);
        const own = docs.filter((d) => unitIds.has(d.entityId));
        const closed = [...unitIds].some((u) =>
          periods.some((p) => p.entityId === u && p.periodId === periodId && p.status === 'CLOSED'),
        );
        const pairs = ics.filter((ic) => ic.sideA.entityId === e.id || ic.sideB.entityId === e.id);
        const open = pairs.filter((ic) => ic.status !== 'MATCHED').length;
        return {
          id: e.id,
          entityId: e.id,
          name: e.name,
          code: e.code,
          docsSubmitted: own.filter((d) => d.status === 'VALIDATED').length,
          docsTotal: own.length,
          periodStatus: (closed ? 'SUBMITTED' : 'PENDING') as 'SUBMITTED' | 'PENDING',
          icStatus:
            pairs.length === 0 ? 'Không có giao dịch nội bộ' : open ? `${open} cặp cần đối chiếu` : 'Đã khớp',
        };
      }),
  );
}

const ENTITY_ORDER = ['MAH', 'MAR', 'MAL', 'MAE'];
const order = (c: string) => (ENTITY_ORDER.indexOf(c) < 0 ? 99 : ENTITY_ORDER.indexOf(c));
