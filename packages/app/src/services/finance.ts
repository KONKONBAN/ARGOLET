import {
  appraiseProject,
  compareScenarios,
  D,
  formatMillions,
  formatPercent,
  formatNumber,
  makeCalcRun,
  newId,
  nextCode,
  npvSensitivity,
  type ProjectAssumptions,
} from '@argolet/core';
import { type AppCore, actor, requireFound, requireText } from '../core';
import { AppError, type CallContext, type Emitter, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { FinanceProjectRow } from '../types';
import { financeReport, financeReportXlsx, type ReportQuery } from './report';

const years = (v: string | null) => (v === null ? 'Không hoàn vốn' : `${formatNumber(D(v), 2)} năm`);

function validateAssumptions(a: ProjectAssumptions): ProjectAssumptions {
  const num = (v: unknown, label: string, min: number, max: number) => {
    const s = String(v ?? '')
      .replace(',', '.')
      .trim();
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new AppError('VALIDATION', `${label} phải là số`, { field: label });
    const n = Number(s);
    if (n < min || n > max)
      throw new AppError('VALIDATION', `${label} phải trong khoảng ${min}–${max}`, { field: label });
    return s;
  };
  return {
    investment: num(a.investment, 'Đầu tư ban đầu', 0.001, 1e9),
    annualCashflow: num(a.annualCashflow, 'Dòng tiền thuần / năm', -1e9, 1e9),
    years: Number(num(a.years, 'Thời gian phân tích', 1, 50)),
    discountRate: D(num(a.discountRate, 'Suất chiết khấu', 0, 1)).toFixed(),
    annualDebtService: num(a.annualDebtService, 'Trả nợ / năm', 0.001, 1e9),
    // Giá trị thanh lý cuối dự án (optional): added to the last year's cash flow.
    ...(a.salvageValue !== undefined && String(a.salvageValue).trim() !== ''
      ? { salvageValue: num(a.salvageValue, 'Giá trị thanh lý', 0, 1e9) }
      : {}),
  };
}

export class FinanceService {
  constructor(private readonly core: AppCore) {}

  private async project(tx: Tx, tenantId: string, projectId?: string): Promise<FinanceProjectRow> {
    if (projectId)
      return requireFound(await tx.get('financeProjects', tenantId, projectId), 'dự án tài chính');
    const [first] = (await tx.list('financeProjects', tenantId)).sort((a, b) => a.code.localeCompare(b.code));
    return requireFound(first, 'dự án tài chính');
  }

  private present(p: FinanceProjectRow) {
    const r = appraiseProject(p.assumptions);
    return {
      project: { id: p.id, code: p.code, name: p.name, scenarioName: 'Kịch bản cơ sở' },
      assumptions: { ...p.assumptions, discountRatePct: D(p.assumptions.discountRate).times(100).toFixed() },
      result: {
        ...r,
        npvLabel: formatMillions(r.npv),
        irrLabel: r.irr ? formatPercent(r.irr) : 'Không xác định',
        paybackLabel: years(r.payback),
        dscrLabel: `${formatNumber(D(r.dscr), 2)} lần`,
        mirrLabel: r.mirr ? formatPercent(r.mirr) : 'Không xác định',
        piLabel: r.pi ? `${formatNumber(D(r.pi), 2)} lần` : 'Không xác định',
        discountedPaybackLabel: years(r.discountedPayback),
        eaaLabel: formatMillions(r.eaa),
        piNote: r.pi
          ? D(r.pi).gte(1)
            ? 'Dòng tiền bù đủ vốn đầu tư' : 'Dòng tiền chưa bù đủ vốn đầu tư'
          : 'Chưa có vốn đầu tư',
        npvNote: `Chiết khấu ${formatNumber(D(p.assumptions.discountRate).times(100), 0)}% / năm`,
        irrNote: `So với suất chiết khấu ${formatNumber(D(p.assumptions.discountRate).times(100), 0)}%`,
        dscrNote: 'Khả năng trả nợ từ dòng tiền',
      },
      lastCalcRunId: p.lastCalcRunId,
    };
  }

  private async list(tx: Tx, tenantId: string) {
    return (await tx.list('financeProjects', tenantId)).sort((a, b) => a.code.localeCompare(b.code));
  }

  /** Báo cáo tài chính: kết quả kinh doanh theo tháng từ chứng từ đã xác nhận. */
  async report(call: CallContext, p: ReportQuery = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      return {
        ...(await financeReport(tx, ws, tenant, p)),
        canExport: this.core.can(ws, 'report.export'),
        canAppraise: this.core.can(ws, 'finance.run'),
      };
    });
  }

  /** The same report as an Excel workbook, with every source line (who may export reports). */
  async exportReport(call: CallContext, p: ReportQuery = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'report.export');
      const tenant = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      return financeReportXlsx(tx, ws, tenant, p, this.core.deps.clock());
    });
  }

  /** Màn 27 · Phân tích tài chính. */
  async appraisal(call: CallContext, p: { projectId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = await this.list(tx, ws.tenantId);
      const proj = (p.projectId ? all.find((x) => x.id === p.projectId) : undefined) ?? all[0];
      const projects = all.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
      const canRun = this.core.can(ws, 'finance.run');
      if (!proj) return { empty: true as const, projects, canRun };
      return { empty: false as const, ...this.present(proj), projects, canRun };
    });
  }

  /** Tạo dự án thẩm định: giả định ban đầu, kịch bản thận trọng / cơ sở / tích cực (±1/6 dòng tiền). */
  /** Creates an appraisal project and records its first calculation (a CalcRun, like every recalculation). */
  async createProject(call: CallContext, p: { name: string; assumptions: ProjectAssumptions }) {
    const name = requireText(p.name, 'Tên dự án', 120);
    const assumptions = validateAssumptions(p.assumptions);
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'finance.run');
      const code = nextCode(
        'TD',
        (await tx.list('financeProjects', ws.tenantId)).map((x) => x.code),
        3,
        1,
      );
      const cf = D(assumptions.annualCashflow);
      const id = newId('fin');
      const proj = (await tx.put('financeProjects', {
        id,
        tenantId: ws.tenantId,
        code,
        name,
        assumptions,
        scenarios: [
          { name: 'Thận trọng', annualCashflow: cf.times(5).div(6).toDecimalPlaces(2).toFixed() },
          { name: 'Cơ sở', annualCashflow: cf.toFixed() },
          { name: 'Tích cực', annualCashflow: cf.times(7).div(6).toDecimalPlaces(2).toFixed() },
        ],
        lastCalcRunId: null,
      })) as FinanceProjectRow;
      await em.audit(ws.tenantId, actor(ws), 'finance.project.create', code, name);
      await this.recordRun(tx, em, ws, proj, assumptions, now);
      return { id, code };
    });
  }

  /** Tính lại kịch bản → CalcRun (input_snapshot, rules_version, engine_version). */
  async recalculate(call: CallContext, p: { projectId?: string; assumptions: ProjectAssumptions }) {
    const assumptions = validateAssumptions(p.assumptions);
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'finance.run');
      const proj = await this.project(tx, ws.tenantId, p.projectId);
      const { saved, run } = await this.recordRun(tx, em, ws, proj, assumptions, now);
      await em.audit(ws.tenantId, actor(ws), 'finance.recalculate', proj.code, run.calcRunId);
      return {
        ...this.present(saved),
        calcRun: {
          id: run.calcRunId,
          engineVersion: run.engineVersion,
          inputSnapshotDigest: run.inputSnapshotDigest,
        },
      };
    });
  }

  /** Runs the appraisal and keeps it reproducible: inputs, rules, method and engine version. */
  private async recordRun(
    tx: Tx,
    em: Emitter,
    ws: WorkspaceState,
    proj: FinanceProjectRow,
    assumptions: ProjectAssumptions,
    now: string,
  ) {
    const result = appraiseProject(assumptions);
    const run = makeCalcRun({
      calcRunId: newId('calc'),
      task: 'project_appraisal',
      packageCode: 'G3',
      rulesVersion: 'finance-rules-2026.10',
      assumptions,
      method:
        'NPV, IRR, MIRR, PI, hoàn vốn giản đơn và có chiết khấu, EAA, DSCR',
      result,
      createdAt: now,
    });
    await tx.put('calcRuns', { ...run, id: run.calcRunId, tenantId: ws.tenantId, createdBy: ws.user.id });
    const saved = (await tx.put('financeProjects', {
      ...proj,
      assumptions,
      lastCalcRunId: run.calcRunId,
    })) as FinanceProjectRow;
    await em.emit({
      type: 'CalcRunCompleted',
      tenantId: ws.tenantId,
      entityId: null,
      aggregateType: 'FinanceProject',
      aggregateId: proj.id,
      actorId: ws.user.id,
      dataRef: `calc/${run.calcRunId}`,
      dataVersion: 1,
      data: { calcRunId: run.calcRunId, engineVersion: run.engineVersion },
    });
    return { saved, run };
  }

  /** Màn 28 · So sánh kịch bản + độ nhạy NPV. */
  async scenarios(call: CallContext, p: { projectId?: string } = {}) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      const all = await this.list(tx, ws.tenantId);
      const projects = all.map((x) => ({ id: x.id, label: `${x.code} · ${x.name}` }));
      const found = (p.projectId ? all.find((x) => x.id === p.projectId) : undefined) ?? all[0];
      if (!found)
        return {
          empty: true as const,
          projects,
          scenarios: [],
          sensitivity: '',
          npvPerMillion: '0',
          projectId: '',
          projectName: '',
          ratePct: '',
        };
      const proj = found;
      const res = compareScenarios(proj.assumptions, proj.scenarios);
      const low = res[0];
      const base = res.find((s) => s.annualCashflow === proj.assumptions.annualCashflow) ?? res[1] ?? res[0];
      const sens = npvSensitivity(proj.assumptions, '-1');
      return {
        scenarios: res.map((s) => ({
          name: s.name,
          isBase: s === base,
          annualCashflowLabel: `${formatNumber(D(s.annualCashflow))} triệu đ`,
          npvLabel: formatMillions(s.npv).replace('−', '-').replace(' triệu', ' triệu đ'),
          irrLabel: s.irr ? formatPercent(s.irr) : '—',
          paybackLabel: years(s.payback),
          annualCashflow: s.annualCashflow,
        })),
        sensitivity:
          low && base
            ? `Dòng tiền giảm từ ${formatNumber(D(base.annualCashflow))} xuống ${formatNumber(D(low.annualCashflow))} triệu đồng/năm làm NPV chuyển từ ${D(base.npv).gte(0) ? '+' : ''}${formatNumber(D(base.npv), 2)} xuống ${formatNumber(D(low.npv), 2)} triệu đồng. Các kịch bản cùng vốn đầu tư ${formatNumber(D(proj.assumptions.investment))} triệu, thời hạn ${proj.assumptions.years} năm và suất chiết khấu ${formatNumber(D(proj.assumptions.discountRate).times(100))}%.`
            : '',
        npvPerMillion: sens,
        empty: false as const,
        projects,
        projectId: proj.id,
        projectName: `${proj.code} · ${proj.name}`,
        ratePct: formatNumber(D(proj.assumptions.discountRate).times(100)),
      };
    });
  }

  async calcRuns(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'workspace.read');
      return (await tx.list('calcRuns', ws.tenantId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          task: r.task,
          engineVersion: r.engineVersion,
          inputSnapshotDigest: r.inputSnapshotDigest,
          createdAt: r.createdAt,
        }));
    });
  }
}
