import { D, formatPeriod, formatSignedVnd, formatVnd, newId, sum, type DomainEvent } from '@argolet/core';
import { type AppCore, requireFound, paginate, type PageParams } from '../core';
import type { CallContext, Emitter, WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import { scoped } from './documents';
import { localDate, relativeDay } from './approvals';
import { compact } from './close';

export class DashboardService {
  constructor(private readonly core: AppCore) {}

  async computeOverview(tx: Tx, ws: WorkspaceState, periodId: string) {
    const records = (await scoped(tx, ws, 'records')).filter((r) => r.periodId === periodId);
    const counter = records.filter((r) => r.kind === 'REVENUE');
    const platform = records.filter((r) => r.kind === 'ORDER');
    const expenses = records.filter((r) => r.kind === 'EXPENSE');
    const revenue = sum([...counter, ...platform].map((r) => r.amount));
    const expense = sum(expenses.map((r) => r.amount));
    // Last 7 days of the period (or up to today) — inflow vs outflow, in millions.
    const lastDay =
      records
        .map((r) => r.date)
        .sort()
        .pop() ?? `${periodId}-28`;
    const days: string[] = [];
    for (let i = 6; i >= 0; i--)
      days.push(new Date(Date.parse(lastDay + 'T00:00:00Z') - i * 86_400_000).toISOString().slice(0, 10));
    const series = days.map((d) => ({
      date: d,
      label: `${d.slice(8)}/${d.slice(5, 7)}`,
      inflow: D(sum([...counter, ...platform].filter((r) => r.date === d).map((r) => r.amount)))
        .div(1_000_000)
        .toDecimalPlaces(1)
        .toNumber(),
      outflow: D(sum(expenses.filter((r) => r.date === d).map((r) => r.amount)))
        .div(1_000_000)
        .toDecimalPlaces(1)
        .toNumber(),
    }));
    const groups = await scoped(tx, ws, 'matchGroups');
    // Platform/transfer orders are reconciled by match groups; counter sales by shift closes.
    const platformIssues = groups.filter((g) => g.periodId === periodId && g.status === 'DISCREPANCY').length;
    const shifts = (await scoped(tx, ws, 'dailyCloses')).filter((s) => s.date.startsWith(periodId));
    const counterIssues = shifts.filter((s) => s.lines.some((l) => !D(l.counted).eq(l.system))).length;
    const pending = (await scoped(tx, ws, 'approvals')).filter(
      (a) => a.status === 'PENDING' && a.makerId !== ws.user.id && a.targetType === 'EXPENSE',
    );
    const discrepancies = groups.filter((g) => g.status === 'DISCREPANCY').length;
    const docsToReview = (await scoped(tx, ws, 'documents')).filter(
      (d) => d.status === 'NEEDS_REVIEW' || d.status === 'NEEDS_RECON' || d.status === 'EXTRACTED',
    ).length;
    return {
      periodId,
      periodLabel: formatPeriod(periodId),
      revenue: revenue.toFixed(),
      expense: expense.toFixed(),
      net: revenue.minus(expense).toFixed(),
      revenueLabel: formatVnd(revenue),
      expenseLabel: formatVnd(expense),
      netLabel: formatSignedVnd(revenue.minus(expense)),
      netNote: `Thu ${compact(revenue)} · Chi ${compact(expense)}`,
      series,
      seriesLabel: `${days[0]!.slice(8)}–${days[6]!.slice(8)}/${days[6]!.slice(5, 7)}/${days[6]!.slice(0, 4)} · Đơn vị: triệu đồng`,
      tasks: [
        {
          key: 'approvals',
          title: 'Phê duyệt chi phí',
          detail: `${pending.length} hồ sơ · ${formatVnd(sum(pending.map((a) => a.amount)))}`,
          count: pending.length,
          route: '/inbox',
        },
        {
          key: 'recon',
          title: 'Đối soát chênh lệch',
          detail: `${discrepancies} nhóm giao dịch cần xác nhận`,
          count: discrepancies,
          route: '/reconciliation',
        },
        {
          key: 'documents',
          title: 'Kiểm tra chứng từ',
          detail: `${docsToReview} hồ sơ cần bổ sung thông tin`,
          count: docsToReview,
          route: '/documents',
        },
      ],
      channels: [
        {
          key: 'counter',
          label: 'Tại quầy',
          amount: sum(counter.map((r) => r.amount)).toFixed(),
          amountLabel: formatVnd(sum(counter.map((r) => r.amount))),
          status: counterIssues ? `${counterIssues} ca lệch tiền` : 'Đã đối soát',
          tone: counterIssues ? 'warning' : 'success',
        },
        {
          key: 'platform',
          label: 'Nền tảng giao hàng',
          amount: sum(platform.map((r) => r.amount)).toFixed(),
          amountLabel: formatVnd(sum(platform.map((r) => r.amount))),
          status: platformIssues ? `${platformIssues} nhóm cần xem` : 'Đã đối soát',
          tone: platformIssues ? 'warning' : 'success',
        },
      ],
    };
  }

  /** Màn 09 · Tổng quan kinh doanh (đọc từ read model + ProjectionVersion). */
  async overview(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const data = await this.computeOverview(tx, ws, tenant.settings.currentPeriod);
      const projection = await tx.get(
        'projections',
        ws.tenantId,
        `dashboard:${tenant.settings.currentPeriod}`,
      );
      return {
        ...data,
        projection: { asOfSeq: projection?.asOfSeq ?? 0, updatedAt: projection?.updatedAt ?? null },
        canCreate: this.core.can(ws, 'document.create'),
      };
    });
  }

  /** Projection consumer: tổng hợp trạng thái và chỉ tiêu theo tenant / kỳ, ghi as_of_seq. */
  async onEvent(event: DomainEvent, tx: Tx): Promise<void> {
    if (event.tenantId === '_global') return;
    const tenant = await tx.get('tenants', event.tenantId, event.tenantId);
    if (!tenant) return;
    const id = `dashboard:${tenant.settings.currentPeriod}`;
    const existing = await tx.get('projections', event.tenantId, id);
    const records = (await tx.list('records', event.tenantId)).filter(
      (r) => r.periodId === tenant.settings.currentPeriod,
    );
    const revenue = sum(
      records.filter((r) => r.kind === 'ORDER' || r.kind === 'REVENUE').map((r) => r.amount),
    );
    const expense = sum(records.filter((r) => r.kind === 'EXPENSE').map((r) => r.amount));
    await tx.put('projections', {
      id,
      tenantId: event.tenantId,
      name: 'dashboard',
      asOfSeq: (existing?.asOfSeq ?? 0) + 1,
      data: {
        revenue: revenue.toFixed(),
        expense: expense.toFixed(),
        lastEvent: event.type,
        lastEventId: event.eventId,
      },
    });
  }

  async notifications(call: CallContext, p: { q?: string; unread?: boolean | string } & PageParams = {}) {
    return this.core.query(async (tx, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const today = localDate(now);
      const all = (await tx.list('notifications', ws.tenantId))
        .filter((n) => !n.userId || n.userId === ws.user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      let items = p.unread === true || p.unread === 'true' ? all.filter((n) => n.status === 'UNREAD') : all;
      if (p.q) {
        const q = p.q.toLowerCase();
        items = items.filter((n) => `${n.title} ${n.refCode} ${n.unitLabel}`.toLowerCase().includes(q));
      }
      const pg = paginate(items, p, 20);
      return {
        kpis: {
          unread: all.filter((n) => n.status === 'UNREAD').length,
          actionRequired: all.filter((n) => n.actionRequired && n.status === 'UNREAD').length,
          today: all.filter((n) => localDate(n.createdAt) === today).length,
        },
        page: pg.page,
        pageSize: pg.pageSize,
        total: pg.total,
        pageCount: pg.pageCount,
        items: pg.items.map((n) => {
          const d = localDate(n.createdAt);
          const t = new Date(Date.parse(n.createdAt) + 7 * 3_600_000).toISOString().slice(11, 16);
          return {
            id: n.id,
            title: n.title,
            unit: n.unitLabel,
            time: d === today ? t : relativeDay(d, today),
            ref: n.refCode,
            route: n.route,
            status: n.status,
            statusLabel:
              n.status === 'READ' ? 'Đã đọc' : (n.statusLabel ?? (n.actionRequired ? 'Cần xem' : 'Chưa đọc')),
          };
        }),
      };
    });
  }

  async markNotificationsRead(call: CallContext, p: { ids?: string[] } = {}) {
    return this.core.command(call, async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = (await tx.list('notifications', ws.tenantId, { status: 'UNREAD' })).filter(
        (n) => !n.userId || n.userId === ws.user.id,
      );
      let count = 0;
      for (const n of all) {
        if (p.ids && !p.ids.includes(n.id)) continue;
        await tx.put('notifications', { ...n, status: 'READ' });
        count++;
      }
      return { updated: count };
    });
  }

  /** Notification consumer driven by domain events. */
  async onNotify(event: DomainEvent, tx: Tx, _em: Emitter): Promise<void> {
    if (event.tenantId === '_global') return;
    const site = event.entityId ? await tx.get('entities', event.tenantId, event.entityId) : undefined;
    const unit = site?.shortName ?? 'Tất cả';
    const mk = async (
      title: string,
      refCode: string,
      route: string,
      actionRequired: boolean,
      statusLabel?: string,
    ) =>
      tx.put('notifications', {
        id: newId('ntf'),
        tenantId: event.tenantId,
        userId: null,
        title,
        unitLabel: unit,
        refCode,
        route,
        status: 'UNREAD',
        actionRequired,
        statusLabel,
      });
    const actorName = event.actorId
      ? ((await tx.list('memberships', event.tenantId, { userId: event.actorId }))[0]?.displayName ??
        'Hệ thống')
      : 'Hệ thống';
    switch (event.type) {
      case 'ApprovalRequested':
        await mk(
          `${actorName} gửi hồ sơ chờ duyệt`,
          String(event.data.code ?? ''),
          `/approvals/${event.aggregateId}`,
          true,
          'Chưa đọc',
        );
        break;
      case 'ReconciliationProposed':
        await mk(
          'Đối soát hoàn tất, cần xác nhận',
          `${String(event.data.groups)} nhóm`,
          '/reconciliation',
          true,
          'Cần xem',
        );
        break;
      case 'BatchReceived':
        await mk('Dữ liệu nhập đã sẵn sàng', String(event.data.code ?? ''), '/ingestion', false);
        break;
      case 'PeriodClosed':
        await mk('Kỳ dữ liệu đã được chốt', String(event.data.periodId ?? ''), '/decision-pack', false);
        break;
      case 'EvidenceAnchored':
        await mk(
          event.data.validationCode === 'VALID' ? 'Bằng chứng đã được neo' : 'Neo bằng chứng thất bại',
          String(event.data.batchCode ?? ''),
          '/evidence',
          event.data.validationCode !== 'VALID',
        );
        break;
      case 'ApprovalGranted':
        await mk(`${actorName} đã phê duyệt hồ sơ`, String(event.data.targetType ?? ''), '/inbox', false);
        break;
      default:
        break;
    }
  }
}
