import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calculator, CircleCheck, Columns3, FileText, Plus } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { CashflowColumns } from '../ui/charts';
import { Alert, Button, Card, Chip, DataTable, ErrorNote, Kpi, KpiRow, Modal, PageHeader, PageLoading, TextInput, Timeline, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import { ModuleTabs } from './g1';

const G3_TABS = [
  { to: '/projects', label: 'Dự án & công việc' },
  { to: '/finance', label: 'Phân tích tài chính' },
  { to: '/scenarios', label: 'So sánh kịch bản' },
  { to: '/assets', label: 'Tài sản & đo lường' },
  { to: '/logistics', label: 'Hồ sơ logistics' },
  { to: '/logistics-finance', label: 'Tài chính logistics' },
];

// ───────── 26 · Dự án & công việc ─────────
export function ProjectsPage() {
  const toast = useToast();
  const data = useQuery('modules.projects');
  const add = useMutation('modules.addWbsTask', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', owner: '', dependsOn: '' });
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G3 · Dự án" title="Dự án & công việc" subtitle="Tiến độ, ngân sách và công việc theo WBS." period={period} />
      <ModuleTabs tabs={G3_TABS} current="/projects" />
      <KpiRow items={d.kpis} />
      {d.project && (
        <Card
          title={d.project.title}
          subtitle={d.project.subtitle}
          actions={
            d.canWrite ? (
              <Button icon={<Plus size={18} />} onClick={() => setOpen(true)}>
                Thêm công việc
              </Button>
            ) : undefined
          }
        >
          <DataTable
            rows={d.project.tasks}
            rowKey={(r) => r.code}
            columns={[
              { key: 'l', header: 'WBS / Công việc', render: (r) => r.label, strong: true },
              { key: 'd', header: 'Phụ thuộc', render: (r) => r.dependsOn },
              { key: 'o', header: 'Phụ trách', render: (r) => r.owner },
              { key: 'p', header: 'Tiến độ', render: (r) => r.progressLabel, align: 'right' },
              { key: 's', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.statusLabel}</Chip> },
            ]}
          />
        </Card>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm công việc WBS"
        footer={
          <Button
            variant="primary"
            loading={add.loading}
            onClick={async () => {
              try {
                const r = await add.mutate({ projectId: d.project!.id, name: form.name, owner: form.owner, dependsOn: form.dependsOn || null });
                toast('success', `Đã thêm công việc ${r.code}`);
                setOpen(false);
                setForm({ name: '', owner: '', dependsOn: '' });
              } catch {
                /* inline */
              }
            }}
          >
            Thêm
          </Button>
        }
      >
        <TextInput label="Tên công việc" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextInput label="Phụ trách" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
        <div className="field">
          <label htmlFor="dep">Phụ thuộc</label>
          <select id="dep" className="select" value={form.dependsOn} onChange={(e) => setForm({ ...form, dependsOn: e.target.value })}>
            <option value="">Không phụ thuộc</option>
            {d.project?.tasks.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {add.error && <ErrorNote error={add.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 27 · Phân tích tài chính ─────────
export function FinancePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery('finance.appraisal', {});
  const recalc = useMutation('finance.recalculate', { silent: true });
  const [form, setForm] = useState<{ investment: string; annualCashflow: string; years: string; discountRatePct: string; annualDebtService: string } | null>(null);
  const period = usePeriodLabel();
  useEffect(() => {
    if (data.data && !form) {
      const a = data.data.assumptions;
      setForm({ investment: a.investment, annualCashflow: a.annualCashflow, years: String(a.years), discountRatePct: a.discountRatePct, annualDebtService: a.annualDebtService });
    }
  }, [data.data, form]);
  if (!data.data || !form) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  const r = d.result;
  const fmtInput = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="Phân tích tài chính"
        subtitle="Finance Engine · Tính hiệu quả từ giả định minh bạch."
        period={period}
        actions={
          <Button icon={<Columns3 size={18} />} onClick={() => navigate('/scenarios')}>
            So sánh kịch bản
          </Button>
        }
      />
      <ModuleTabs tabs={G3_TABS} current="/finance" />
      <div className="grid split-side">
        <Card title="Giả định đầu vào" subtitle={`${d.project.name} · ${d.project.scenarioName}`}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await recalc.mutate({
                  projectId: d.project.id,
                  assumptions: { investment: form.investment.replace(/\./g, ''), annualCashflow: form.annualCashflow.replace(/\./g, ''), years: Number(form.years), discountRate: String(Number(form.discountRatePct.replace(',', '.')) / 100), annualDebtService: form.annualDebtService.replace(/\./g, '') },
                });
                toast('success', `Đã tính lại · CalcRun ${res.calcRun.id.slice(-8)} · ${res.calcRun.engineVersion}`);
              } catch {
                /* inline */
              }
            }}
          >
            <TextInput label="Đầu tư ban đầu · triệu đ" inputMode="decimal" value={fmtInput(form.investment)} onChange={(e) => setForm({ ...form, investment: e.target.value.replace(/[^\d]/g, '') })} />
            <TextInput label="Dòng tiền thuần / năm · triệu đ" inputMode="decimal" value={fmtInput(form.annualCashflow)} onChange={(e) => setForm({ ...form, annualCashflow: e.target.value.replace(/[^\d-]/g, '') })} />
            <TextInput label="Thời gian phân tích · năm" inputMode="numeric" value={form.years} onChange={(e) => setForm({ ...form, years: e.target.value.replace(/[^\d]/g, '') })} />
            <TextInput label="Suất chiết khấu · % / năm" inputMode="decimal" value={form.discountRatePct} onChange={(e) => setForm({ ...form, discountRatePct: e.target.value.replace(/[^\d.,]/g, '') })} />
            <TextInput label="Trả nợ / năm · triệu đ" inputMode="decimal" value={fmtInput(form.annualDebtService)} onChange={(e) => setForm({ ...form, annualDebtService: e.target.value.replace(/[^\d]/g, '') })} />
            {recalc.error && <ErrorNote error={recalc.error} />}
            <Button type="submit" variant="primary" block size="lg" icon={<Calculator size={18} />} loading={recalc.loading} disabled={!d.canRun} className="mt-16">
              Tính lại kịch bản
            </Button>
          </form>
        </Card>
        <div className="stack">
          <div className="grid grid-2">
            <Kpi label="NPV" value={r.npvLabel} note={r.npvNote} highlight />
            <Kpi label="IRR" value={r.irrLabel} note={r.irrNote} />
          </div>
          <Card title="Dòng tiền dự án" subtitle="Đơn vị: triệu đồng · Dòng tiền cuối mỗi năm">
            <CashflowColumns flows={r.cashflows.map(Number)} />
          </Card>
          <div className="grid grid-2">
            <Kpi label="Thời gian hoàn vốn" value={r.paybackLabel} note="Chưa chiết khấu" />
            <Kpi label="DSCR" value={r.dscrLabel} note={r.dscrNote} />
          </div>
          <p className="small muted">{r.footnote}</p>
        </div>
      </div>
      <PageFoot />
    </div>
  );
}

// ───────── 28 · So sánh kịch bản ─────────
export function ScenariosPage() {
  const navigate = useNavigate();
  const data = useQuery('finance.scenarios', {});
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G3 · Dự án" title="So sánh kịch bản" subtitle="Hiểu tác động của thay đổi giả định." period={period} />
      <ModuleTabs tabs={G3_TABS} current="/scenarios" />
      <div className="grid grid-3">
        {d.scenarios.map((s) => (
          <Card key={s.name}>
            <Chip tone={s.isBase ? 'success' : 'neutral'}>{s.name}</Chip>
            <p className="small muted" style={{ marginTop: 34 }}>
              Dòng tiền thuần / năm
            </p>
            <div className="num" style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 10 }}>
              {s.annualCashflowLabel}
            </div>
            <div className="kv mt-24">
              <div className="kv-row" style={{ padding: '16px 0' }}>
                <span className="k">NPV @ 10%</span>
                <span className="v strong num">{s.npvLabel}</span>
              </div>
              <div className="kv-row" style={{ padding: '16px 0' }}>
                <span className="k">IRR</span>
                <span className="v strong num">{s.irrLabel}</span>
              </div>
              <div className="kv-row" style={{ padding: '16px 0' }}>
                <span className="k">Hoàn vốn</span>
                <span className="v strong num">{s.paybackLabel}</span>
              </div>
            </div>
            <Button variant={s.isBase ? 'primary' : 'default'} block className="mt-24" onClick={() => navigate('/finance')}>
              Mở kịch bản
            </Button>
          </Card>
        ))}
      </div>
      <Card className="mt-24" title="Độ nhạy của NPV">
        <p className="muted" style={{ lineHeight: 1.7 }}>
          {d.sensitivity}
        </p>
        <p className="small muted mt-8">Mỗi 1 triệu đồng dòng tiền/năm thay đổi NPV khoảng {Math.abs(Number(d.npvPerMillion)).toFixed(2).replace('.', ',')} triệu đồng.</p>
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 29 · Tài sản & đo lường ─────────
export function AssetsPage() {
  const data = useQuery('modules.assets');
  const [open, setOpen] = useState(false);
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G3 · Dự án" title="Tài sản & đo lường" subtitle="Theo dõi vận hành và kiểm chứng hiệu quả." period={period} />
      <ModuleTabs tabs={G3_TABS} current="/assets" />
      <KpiRow items={d.kpis} />
      <Card title={d.title}>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Chỉ tiêu / tài sản', render: (r) => r.name, strong: true },
            { key: 'b', header: 'Đường cơ sở', render: (r) => r.baseline },
            { key: 'p', header: 'Kỳ đo', render: (r) => r.period },
            { key: 'r', header: 'Kết quả', render: (r) => (r.isMetric ? <span className="strong">{r.result}</span> : <Chip tone={r.tone}>{r.result}</Chip>), align: 'right' },
          ]}
        />
      </Card>
      <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={<FileText size={18} />} onClick={() => setOpen(true)}>
          Xem hồ sơ đo lường
        </Button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Hồ sơ đo lường & kiểm chứng (M&V)">
        <Timeline
          items={[
            { title: 'Đường cơ sở đã điều chỉnh', sub: 'Theo thời tiết và sản lượng', done: true },
            { title: 'Kỳ đo tháng 10/2026', sub: 'Dữ liệu công tơ đã xác nhận', done: true },
            { title: 'Tính tiết kiệm', sub: 'Finance Engine · energy_savings', done: true },
            { title: 'Phê duyệt kết quả', sub: 'Chờ người có quyền', done: false },
          ]}
        />
        <Alert tone="info">Tiết kiệm = đường cơ sở đã điều chỉnh − năng lượng kỳ báo cáo. Kết quả gắn phiên bản quy tắc và nguồn dữ liệu đo.</Alert>
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 30 · Hồ sơ logistics ─────────
export function LogisticsPage() {
  const navigate = useNavigate();
  const data = useQuery('modules.logistics');
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const s = data.data.shipment;
  if (!s) return <div className="page"><Card>Chưa có lô hàng.</Card></div>;
  return (
    <div className="page">
      <PageHeader eyebrow="G3 · Dự án" title="Hồ sơ logistics" subtitle="Nối sự kiện lô hàng với hồ sơ và người phụ trách." period={period} />
      <ModuleTabs tabs={G3_TABS} current="/logistics" />
      <div className="grid split-main">
        <Card title={s.title} subtitle={s.subtitle} actions={<Chip tone="warning">{s.statusLabel}</Chip>}>
          <div className="mt-16">
            {s.events.map((e, i) => (
              <div key={i} className="list-item" style={{ gridTemplateColumns: '28px 1fr auto' }}>
                <span className={`tl-num${e.done ? ' done' : ''}`}>{e.done ? <CircleCheck size={14} /> : i + 1}</span>
                <span>
                  <div className="li-title" style={{ fontSize: 16 }}>{e.title}</div>
                  <div className="li-sub">{e.detail}</div>
                </span>
                <span className="small muted">{e.atLabel}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="stack">
          <Card title="Chứng từ lô hàng">
            {s.documents.map((doc) => (
              <div key={doc.name} className="list-item" style={{ gridTemplateColumns: '22px 1fr' }}>
                <FileText size={18} color="#536978" />
                <span>
                  <div>{doc.name}</div>
                  <div className="li-sub">{doc.status}</div>
                </span>
              </div>
            ))}
          </Card>
          <Card title="Chi phí & thời hạn">
            <p className="muted small">Hết thời gian miễn phí</p>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 10 }}>{s.freeTimeEnd}</div>
            <p className="muted small mt-16" style={{ lineHeight: 1.7 }}>
              {s.freeTimeNote}
            </p>
            <Button variant="primary" block className="mt-16" onClick={() => navigate('/logistics-finance')}>
              Xem tài chính lô hàng
            </Button>
          </Card>
        </div>
      </div>
      <PageFoot />
    </div>
  );
}

// ───────── 31 · Tài chính logistics ─────────
export function LogisticsFinancePage() {
  const toast = useToast();
  const data = useQuery('modules.logisticsFinance');
  const confirm = useMutation('modules.confirmAllocation');
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const s = data.data.shipment;
  if (!s) return <div className="page"><Card>Chưa có lô hàng.</Card></div>;
  return (
    <div className="page">
      <PageHeader eyebrow="G3 · Dự án" title="Tài chính logistics" subtitle="Xem biểu phí, giá vốn và lợi nhuận theo lô." period={period} />
      <ModuleTabs tabs={G3_TABS} current="/logistics-finance" />
      <KpiRow items={s.kpis} />
      <div className="grid split-main">
        <Card title="Chi phí cấu thành" subtitle={s.tariff}>
          <DataTable
            rows={s.costs}
            rowKey={(r) => r.name}
            columns={[
              { key: 'n', header: 'Khoản phí', render: (r) => r.name, strong: true },
              { key: 'b', header: 'Căn cứ', render: (r) => r.basis },
              { key: 'a', header: 'Số tiền', render: (r) => r.amountLabel, align: 'right' },
            ]}
          />
          <p className="table-foot">{s.tariff.replace('Biểu phí: ', 'Biểu phí ').replace(' · Hiệu lực từ', ' · Áp dụng từ')}.</p>
        </Card>
        <Card title="Phân bổ giá vốn" subtitle="Theo trọng lượng">
          {s.allocation.map((a) => (
            <div key={a.item} className="list-item" style={{ gridTemplateColumns: '1fr auto' }}>
              <span>
                <div className="li-title">{a.item}</div>
                <div className="li-sub">{a.share}</div>
              </span>
              <span className="strong num" style={{ fontSize: 16 }}>
                {a.amount}
              </span>
            </div>
          ))}
          {s.allocationConfirmed ? (
            <div className="mt-16">
              <Chip tone="success">Đã xác nhận phân bổ</Chip>
            </div>
          ) : (
            data.data.canWrite && (
              <Button
                variant="primary"
                block
                className="mt-24"
                loading={confirm.loading}
                onClick={async () => {
                  await confirm.mutate({ shipmentId: s.id });
                  toast('success', 'Đã xác nhận phân bổ giá vốn');
                }}
              >
                Xác nhận phân bổ
              </Button>
            )
          )}
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}
