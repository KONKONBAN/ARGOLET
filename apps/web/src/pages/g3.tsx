import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Calculator, CircleCheck, Columns3, FileText, MapPin, Plus, Wrench } from 'lucide-react';
import { formatShortDateTime } from '@argolet/core';
import { useMutation, useQuery } from '../api/hooks';
import { CashflowColumns } from '../ui/charts';
import {
  Alert,
  Button,
  Card,
  Chip,
  DataTable,
  ErrorNote,
  Kpi,
  KpiRow,
  Modal,
  MoneyInput,
  PageHeader,
  PageLoading,
  SelectInput,
  TextInput,
  Timeline,
  useToast,
} from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import { ModuleTabs, todayVN } from './g1';

const G3_TABS = [
  { to: '/projects', label: 'Dự án & công việc' },
  { to: '/finance', label: 'Phân tích tài chính' },
  { to: '/scenarios', label: 'So sánh kịch bản' },
  { to: '/assets', label: 'Tài sản & đo lường' },
  { to: '/logistics', label: 'Hồ sơ logistics' },
  { to: '/logistics-finance', label: 'Tài chính logistics' },
];

/** Selected record of a module, kept in the URL so links and the back button keep it. */
function useSelected(key: string): [string | undefined, (id: string) => void] {
  const [sp, setSp] = useSearchParams();
  const value = sp.get(key) ?? undefined;
  return [
    value,
    (id: string) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(key, id);
          return next;
        },
        { replace: true },
      ),
  ];
}

function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <label className="row mb-16" style={{ gap: 10 }}>
      <span className="small muted">{label}</span>
      <select
        className="select"
        style={{ height: 40, width: 'min(360px, 100%)' }}
        value={value ?? options[0]?.id ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyModule({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <Card>
      <div style={{ textAlign: 'center', padding: '28px 12px' }}>
        <p className="muted" style={{ maxWidth: 520, margin: '0 auto 18px', lineHeight: 1.6 }}>
          {text}
        </p>
        {action}
      </div>
    </Card>
  );
}

const digits = (s: string) => s.replace(/[^\d]/g, '');
const decimal = (s: string) => s.replace(/[^\d.,]/g, '').replace(',', '.');

// ───────── 26 · Dự án & công việc ─────────
export function ProjectsPage() {
  const toast = useToast();
  const [projectId, setProjectId] = useSelected('project');
  const data = useQuery('modules.projects', { projectId }, { keepPrevious: true });
  const add = useMutation('modules.addWbsTask', { silent: true });
  const create = useMutation('modules.createProject', { silent: true });
  const progress = useMutation('modules.updateWbsTask', { silent: true });
  const cost = useMutation('modules.recordProjectCost', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', owner: '', dependsOn: '' });
  const [newOpen, setNewOpen] = useState(false);
  const [newForm, setNewForm] = useState({ name: '', manager: '', budget: '' });
  const [task, setTask] = useState<{ code: string; label: string; progress: string } | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [costForm, setCostForm] = useState({ kind: 'RECORDED', amount: '' });
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  const openCreate = () => {
    create.reset();
    setNewForm({ name: '', manager: '', budget: '' });
    setNewOpen(true);
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="Dự án & công việc"
        subtitle="Tiến độ, ngân sách và công việc theo WBS."
        period={period}
        actions={
          d.canWrite ? (
            <Button icon={<Plus size={18} />} onClick={openCreate}>
              Tạo dự án
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs tabs={G3_TABS} current="/projects" />
      <Picker label="Dự án" value={d.project?.id} options={d.projects} onChange={setProjectId} />
      {d.project ? (
        <>
          <KpiRow items={d.kpis} />
          <Card
            title={d.project.title}
            subtitle={d.project.subtitle}
            actions={
              d.canWrite ? (
                <div className="row wrap">
                  <Button
                    size="sm"
                    onClick={() => {
                      cost.reset();
                      setCostForm({ kind: 'RECORDED', amount: '' });
                      setCostOpen(true);
                    }}
                  >
                    Ghi nhận chi phí
                  </Button>
                  <Button
                    size="sm"
                    icon={<Plus size={16} />}
                    onClick={() => {
                      add.reset();
                      setOpen(true);
                    }}
                  >
                    Thêm công việc
                  </Button>
                </div>
              ) : undefined
            }
          >
            <DataTable
              rows={d.project.tasks}
              rowKey={(r) => r.code}
              onRowClick={
                d.canWrite
                  ? (r) => {
                      progress.reset();
                      setTask({ code: r.code, label: r.label, progress: String(r.progress) });
                    }
                  : undefined
              }
              columns={[
                { key: 'l', header: 'WBS / Công việc', render: (r) => r.label, strong: true },
                { key: 'd', header: 'Phụ thuộc', render: (r) => r.dependsOn },
                { key: 'o', header: 'Phụ trách', render: (r) => r.owner },
                { key: 'p', header: 'Tiến độ', render: (r) => r.progressLabel, align: 'right' },
                { key: 's', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.statusLabel}</Chip> },
              ]}
              empty="Chưa có công việc. Thêm công việc để lập WBS."
            />
            {d.canWrite && d.project.tasks.length > 0 && (
              <p className="table-foot">Chọn một công việc để cập nhật tiến độ.</p>
            )}
          </Card>
        </>
      ) : (
        <EmptyModule
          text="Chưa có dự án. Tạo dự án với ngân sách được duyệt, sau đó lập công việc (WBS) và ghi nhận chi phí thực tế."
          action={
            d.canWrite && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={openCreate}>
                Tạo dự án
              </Button>
            )
          }
        />
      )}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Tạo dự án"
        footer={
          <>
            <Button onClick={() => setNewOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={create.loading}
              onClick={async () => {
                try {
                  const r = await create.mutate({
                    name: newForm.name,
                    manager: newForm.manager,
                    budget: newForm.budget || '0',
                  });
                  toast('success', `Đã tạo dự án ${r.code}`);
                  setProjectId(r.id);
                  setNewOpen(false);
                } catch {
                  /* inline */
                }
              }}
            >
              Tạo dự án
            </Button>
          </>
        }
      >
        <TextInput
          label="Tên dự án"
          value={newForm.name}
          onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
          placeholder="Mở cửa hàng thứ hai"
        />
        <TextInput
          label="Chủ nhiệm"
          value={newForm.manager}
          onChange={(e) => setNewForm({ ...newForm, manager: e.target.value })}
        />
        <MoneyInput
          label="Ngân sách được duyệt"
          value={newForm.budget}
          onChange={(v) => setNewForm({ ...newForm, budget: v })}
        />
        {create.error && <ErrorNote error={create.error} />}
      </Modal>
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
                const r = await add.mutate({
                  projectId: d.project!.id,
                  name: form.name,
                  owner: form.owner,
                  dependsOn: form.dependsOn || null,
                });
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
        <TextInput
          label="Tên công việc"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <TextInput
          label="Phụ trách"
          value={form.owner}
          onChange={(e) => setForm({ ...form, owner: e.target.value })}
        />
        <SelectInput
          label="Phụ thuộc"
          value={form.dependsOn}
          onChange={(v) => setForm({ ...form, dependsOn: v })}
          options={[
            { value: '', label: 'Không phụ thuộc' },
            ...(d.project?.tasks.map((t) => ({ value: t.code, label: t.label })) ?? []),
          ]}
        />
        {add.error && <ErrorNote error={add.error} />}
      </Modal>
      <Modal
        open={!!task}
        onClose={() => setTask(null)}
        title={task?.label ?? ''}
        footer={
          <Button
            variant="primary"
            loading={progress.loading}
            onClick={async () => {
              if (!task) return;
              try {
                await progress.mutate({
                  projectId: d.project!.id,
                  code: task.code,
                  progress: Number(task.progress || 0),
                });
                toast('success', 'Đã cập nhật tiến độ');
                setTask(null);
              } catch {
                /* inline */
              }
            }}
          >
            Lưu tiến độ
          </Button>
        }
      >
        {task && (
          <>
            <TextInput
              label="Tiến độ (%)"
              type="number"
              min={0}
              max={100}
              step={5}
              value={task.progress}
              onChange={(e) => setTask({ ...task, progress: e.target.value })}
            />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Number(task.progress || 0)}
              onChange={(e) => setTask({ ...task, progress: e.target.value })}
              style={{ width: '100%' }}
              aria-label="Kéo để chọn tiến độ"
            />
            {progress.error && <ErrorNote error={progress.error} />}
          </>
        )}
      </Modal>
      <Modal
        open={costOpen}
        onClose={() => setCostOpen(false)}
        title="Ghi nhận chi phí dự án"
        footer={
          <Button
            variant="primary"
            loading={cost.loading}
            onClick={async () => {
              try {
                const r = await cost.mutate({
                  projectId: d.project!.id,
                  kind: costForm.kind as 'RECORDED' | 'COMMITTED',
                  amount: costForm.amount || '0',
                });
                toast(
                  r.overBudget ? 'error' : 'success',
                  r.overBudget ? 'Đã ghi nhận · tổng chi phí vượt ngân sách dự án' : 'Đã ghi nhận chi phí',
                );
                setCostOpen(false);
              } catch {
                /* inline */
              }
            }}
          >
            Ghi nhận
          </Button>
        }
      >
        <SelectInput
          label="Loại"
          value={costForm.kind}
          onChange={(v) => setCostForm({ ...costForm, kind: v })}
          options={[
            { value: 'RECORDED', label: 'Chi phí thực tế (đã có chứng từ)' },
            { value: 'COMMITTED', label: 'Cam kết (hợp đồng / đơn mua đã ký)' },
          ]}
        />
        <MoneyInput
          label="Số tiền"
          value={costForm.amount}
          onChange={(v) => setCostForm({ ...costForm, amount: v })}
        />
        {cost.error && <ErrorNote error={cost.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 27 · Phân tích tài chính ─────────
interface AssumptionForm {
  investment: string;
  annualCashflow: string;
  years: string;
  discountRatePct: string;
  annualDebtService: string;
}
const fmtThousands = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const toAssumptions = (f: AssumptionForm) => ({
  investment: f.investment.replace(/\./g, ''),
  annualCashflow: f.annualCashflow.replace(/\./g, ''),
  years: Number(f.years || 0),
  discountRate: String(Number((f.discountRatePct || '0').replace(',', '.')) / 100),
  annualDebtService: f.annualDebtService.replace(/\./g, ''),
});

function AssumptionFields({ form, setForm }: { form: AssumptionForm; setForm: (f: AssumptionForm) => void }) {
  return (
    <>
      <TextInput
        label="Đầu tư ban đầu · triệu đ"
        inputMode="decimal"
        value={fmtThousands(form.investment)}
        onChange={(e) => setForm({ ...form, investment: digits(e.target.value) })}
      />
      <TextInput
        label="Dòng tiền thuần / năm · triệu đ"
        inputMode="decimal"
        value={fmtThousands(form.annualCashflow)}
        onChange={(e) => setForm({ ...form, annualCashflow: e.target.value.replace(/[^\d-]/g, '') })}
      />
      <TextInput
        label="Thời gian phân tích · năm"
        inputMode="numeric"
        value={form.years}
        onChange={(e) => setForm({ ...form, years: digits(e.target.value) })}
      />
      <TextInput
        label="Suất chiết khấu · % / năm"
        inputMode="decimal"
        value={form.discountRatePct}
        onChange={(e) => setForm({ ...form, discountRatePct: e.target.value.replace(/[^\d.,]/g, '') })}
      />
      <TextInput
        label="Trả nợ / năm · triệu đ"
        inputMode="decimal"
        value={fmtThousands(form.annualDebtService)}
        onChange={(e) => setForm({ ...form, annualDebtService: digits(e.target.value) })}
      />
    </>
  );
}

export function FinancePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [projectId, setProjectId] = useSelected('project');
  const data = useQuery('finance.appraisal', { projectId }, { keepPrevious: true });
  const recalc = useMutation('finance.recalculate', { silent: true });
  const create = useMutation('finance.createProject', { silent: true });
  const [edits, setEdits] = useState<{ id: string; form: AssumptionForm } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newForm, setNewForm] = useState<AssumptionForm>({
    investment: '',
    annualCashflow: '',
    years: '5',
    discountRatePct: '10',
    annualDebtService: '',
  });
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  const openCreate = () => {
    create.reset();
    setNewName('');
    setNewForm({
      investment: '',
      annualCashflow: '',
      years: '5',
      discountRatePct: '10',
      annualDebtService: '',
    });
    setNewOpen(true);
  };
  const createModal = (
    <Modal
      open={newOpen}
      onClose={() => setNewOpen(false)}
      title="Tạo dự án thẩm định"
      footer={
        <>
          <Button onClick={() => setNewOpen(false)}>Hủy</Button>
          <Button
            variant="primary"
            loading={create.loading}
            onClick={async () => {
              try {
                const r = await create.mutate({ name: newName, assumptions: toAssumptions(newForm) });
                toast('success', `Đã tạo dự án ${r.code}`);
                setProjectId(r.id);
                setNewOpen(false);
              } catch {
                /* inline */
              }
            }}
          >
            Tạo và tính
          </Button>
        </>
      }
    >
      <TextInput
        label="Tên dự án"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        placeholder="Lắp điện mặt trời áp mái"
      />
      <AssumptionFields form={newForm} setForm={setNewForm} />
      <p className="small muted">
        Kịch bản thận trọng và tích cực được lập tự động với dòng tiền ±1/6 so với kịch bản cơ sở.
      </p>
      {create.error && <ErrorNote error={create.error} />}
    </Modal>
  );
  if (d.empty) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="G3 · Dự án"
          title="Phân tích tài chính"
          subtitle="Finance Engine · Tính hiệu quả từ giả định minh bạch."
          period={period}
        />
        <ModuleTabs tabs={G3_TABS} current="/finance" />
        <EmptyModule
          text="Chưa có dự án thẩm định. Nhập vốn đầu tư, dòng tiền, thời hạn và suất chiết khấu để tính NPV, IRR, thời gian hoàn vốn và DSCR."
          action={
            d.canRun && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={openCreate}>
                Tạo dự án thẩm định
              </Button>
            )
          }
        />
        {createModal}
        <PageFoot />
      </div>
    );
  }
  const r = d.result;
  const a = d.assumptions;
  const form: AssumptionForm =
    edits && edits.id === d.project.id
      ? edits.form
      : {
          investment: a.investment,
          annualCashflow: a.annualCashflow,
          years: String(a.years),
          discountRatePct: a.discountRatePct,
          annualDebtService: a.annualDebtService,
        };
  const setForm = (f: AssumptionForm) => setEdits({ id: d.project.id, form: f });
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="Phân tích tài chính"
        subtitle="Finance Engine · Tính hiệu quả từ giả định minh bạch."
        period={period}
        actions={
          <div className="row wrap">
            {d.canRun && (
              <Button icon={<Plus size={18} />} onClick={openCreate}>
                Dự án mới
              </Button>
            )}
            <Button
              icon={<Columns3 size={18} />}
              onClick={() => navigate(`/scenarios?project=${d.project.id}`)}
            >
              So sánh kịch bản
            </Button>
          </div>
        }
      />
      <ModuleTabs tabs={G3_TABS} current="/finance" />
      <Picker
        label="Dự án"
        value={d.project.id}
        options={d.projects}
        onChange={(id) => {
          setEdits(null);
          setProjectId(id);
        }}
      />
      <div className="grid split-side">
        <Card title="Giả định đầu vào" subtitle={`${d.project.name} · ${d.project.scenarioName}`}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await recalc.mutate({
                  projectId: d.project.id,
                  assumptions: toAssumptions(form),
                });
                toast(
                  'success',
                  `Đã tính lại · CalcRun ${res.calcRun.id.slice(-8)} · ${res.calcRun.engineVersion}`,
                );
                setEdits(null);
              } catch {
                /* inline */
              }
            }}
          >
            <AssumptionFields form={form} setForm={setForm} />
            {recalc.error && <ErrorNote error={recalc.error} />}
            <Button
              type="submit"
              variant="primary"
              block
              size="lg"
              icon={<Calculator size={18} />}
              loading={recalc.loading}
              disabled={!d.canRun}
              className="mt-16"
            >
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
      <CalcRunHistory />
      {createModal}
      <PageFoot />
    </div>
  );
}

/** Every calculation is reproducible: inputs digest, engine version and time are kept. */
function CalcRunHistory() {
  const runs = useQuery('finance.calcRuns');
  if (!runs.data?.length) return null;
  return (
    <Card
      className="mt-24"
      title="Lịch sử tính toán"
      subtitle="20 lần tính gần nhất · có thể tái lập từ dữ liệu đầu vào"
    >
      <DataTable
        rows={runs.data}
        rowKey={(r) => r.id}
        columns={[
          { key: 't', header: 'Thời điểm', render: (r) => formatShortDateTime(r.createdAt), strong: true },
          { key: 'k', header: 'Phép tính', render: (r) => CALC_TASK[r.task] ?? r.task },
          { key: 'e', header: 'Phiên bản động cơ', render: (r) => r.engineVersion },
          {
            key: 'd',
            header: 'Dấu vân tay đầu vào',
            render: (r) => <code className="mono-wrap">{r.inputSnapshotDigest.slice(0, 16)}…</code>,
          },
        ]}
      />
    </Card>
  );
}

const CALC_TASK: Record<string, string> = {
  project_appraisal: 'Thẩm định dự án (NPV, IRR, hoàn vốn, DSCR)',
};

// ───────── 28 · So sánh kịch bản ─────────
export function ScenariosPage() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useSelected('project');
  const data = useQuery('finance.scenarios', { projectId }, { keepPrevious: true });
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="So sánh kịch bản"
        subtitle="Hiểu tác động của thay đổi giả định."
        period={period}
      />
      <ModuleTabs tabs={G3_TABS} current="/scenarios" />
      {d.empty ? (
        <EmptyModule
          text="Chưa có dự án thẩm định để so sánh kịch bản."
          action={
            <Button variant="primary" onClick={() => navigate('/finance')}>
              Tạo dự án thẩm định
            </Button>
          }
        />
      ) : (
        <>
          <Picker label="Dự án" value={d.projectId} options={d.projects} onChange={setProjectId} />
          <div className="grid grid-3">
            {d.scenarios.map((s) => (
              <Card key={s.name}>
                <Chip tone={s.isBase ? 'success' : 'neutral'}>{s.name}</Chip>
                <p className="small muted" style={{ marginTop: 34 }}>
                  Dòng tiền thuần / năm
                </p>
                <div
                  className="num"
                  style={{ fontSize: 24, fontWeight: 700, color: 'var(--text)', marginTop: 10 }}
                >
                  {s.annualCashflowLabel}
                </div>
                <div className="kv mt-24">
                  <div className="kv-row" style={{ padding: '16px 0' }}>
                    <span className="k">NPV @ {d.ratePct}%</span>
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
                <Button
                  variant={s.isBase ? 'primary' : 'default'}
                  block
                  className="mt-24"
                  onClick={() => navigate(`/finance?project=${d.projectId}`)}
                >
                  Mở kịch bản
                </Button>
              </Card>
            ))}
          </div>
          <Card className="mt-24" title="Độ nhạy của NPV">
            <p className="muted" style={{ lineHeight: 1.7 }}>
              {d.sensitivity}
            </p>
            <p className="small muted mt-8">
              Mỗi 1 triệu đồng dòng tiền/năm thay đổi NPV khoảng{' '}
              {Math.abs(Number(d.npvPerMillion)).toFixed(2).replace('.', ',')} triệu đồng.
            </p>
          </Card>
        </>
      )}
      <PageFoot />
    </div>
  );
}

// ───────── 29 · Tài sản & đo lường ─────────
export function AssetsPage() {
  const toast = useToast();
  const data = useQuery('modules.assets');
  const add = useMutation('modules.addAsset', { silent: true });
  const done = useMutation('modules.completeMaintenance', { silent: true });
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    kind: 'ASSET',
    name: '',
    unit: 'kWh',
    baseline: '',
    reporting: '',
    schedule: '',
    dueDate: '',
  });
  const [maint, setMaint] = useState<{ id: string; name: string; next: string } | null>(null);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="Tài sản & đo lường"
        subtitle="Theo dõi vận hành và kiểm chứng hiệu quả."
        period={period}
        actions={
          d.canWrite ? (
            <Button
              icon={<Plus size={18} />}
              onClick={() => {
                add.reset();
                setForm({
                  kind: 'ASSET',
                  name: '',
                  unit: 'kWh',
                  baseline: '',
                  reporting: '',
                  schedule: '',
                  dueDate: '',
                });
                setAddOpen(true);
              }}
            >
              Thêm tài sản / chỉ số
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs tabs={G3_TABS} current="/assets" />
      <KpiRow items={d.kpis} />
      <Card title={d.title}>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={
            d.canWrite
              ? (r) => {
                  if (!r.isMetric && r.canComplete) {
                    done.reset();
                    setMaint({ id: r.id, name: r.name, next: '' });
                  }
                }
              : undefined
          }
          columns={[
            { key: 'n', header: 'Chỉ tiêu / tài sản', render: (r) => r.name, strong: true },
            { key: 'b', header: 'Đường cơ sở', render: (r) => r.baseline },
            { key: 'p', header: 'Kỳ đo', render: (r) => r.period },
            {
              key: 'r',
              header: 'Kết quả',
              render: (r) =>
                r.isMetric ? (
                  <span className="strong">{r.result}</span>
                ) : (
                  <Chip tone={r.tone}>{r.result}</Chip>
                ),
              align: 'right',
            },
          ]}
          empty="Chưa có tài sản hoặc chỉ số đo lường."
        />
        {d.canWrite && d.items.some((i) => !i.isMetric && i.canComplete) && (
          <p className="table-foot">Chọn tài sản đến hạn để ghi nhận đã bảo trì.</p>
        )}
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
            { title: `Kỳ đo ${period.toLowerCase()}`, sub: 'Dữ liệu công tơ đã xác nhận', done: true },
            { title: 'Tính tiết kiệm', sub: 'Finance Engine · energy_savings', done: true },
            { title: 'Phê duyệt kết quả', sub: 'Chờ người có quyền', done: false },
          ]}
        />
        <Alert tone="info">
          Tiết kiệm = đường cơ sở đã điều chỉnh − năng lượng kỳ báo cáo. Kết quả gắn phiên bản quy tắc và
          nguồn dữ liệu đo.
        </Alert>
      </Modal>
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Thêm tài sản / chỉ số đo lường"
        footer={
          <>
            <Button onClick={() => setAddOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={add.loading}
              onClick={async () => {
                try {
                  await add.mutate(
                    form.kind === 'METRIC'
                      ? {
                          kind: 'METRIC',
                          name: form.name,
                          unit: form.unit,
                          baseline: form.baseline || '0',
                          reporting: form.reporting || '0',
                        }
                      : {
                          kind: 'ASSET',
                          name: form.name,
                          schedule: form.schedule,
                          dueDate: form.dueDate || null,
                        },
                  );
                  toast('success', `Đã thêm ${form.name}`);
                  setAddOpen(false);
                } catch {
                  /* inline */
                }
              }}
            >
              Thêm
            </Button>
          </>
        }
      >
        <SelectInput
          label="Loại"
          value={form.kind}
          onChange={(v) => setForm({ ...form, kind: v })}
          options={[
            { value: 'ASSET', label: 'Tài sản / thiết bị (lịch bảo trì)' },
            { value: 'METRIC', label: 'Chỉ số đo lường (điện, nước, sản lượng…)' },
          ]}
        />
        <TextInput
          label={form.kind === 'METRIC' ? 'Tên chỉ số' : 'Tên tài sản'}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder={form.kind === 'METRIC' ? 'Điện năng cửa hàng' : 'Lò nướng đối lưu'}
        />
        {form.kind === 'METRIC' ? (
          <div className="grid grid-3">
            <SelectInput
              label="Đơn vị"
              value={form.unit}
              onChange={(v) => setForm({ ...form, unit: v })}
              options={['kWh', 'm³', 'lít', 'kg', 'giờ'].map((x) => ({ value: x, label: x }))}
            />
            <TextInput
              label="Đường cơ sở"
              inputMode="decimal"
              value={form.baseline}
              onChange={(e) => setForm({ ...form, baseline: decimal(e.target.value) })}
            />
            <TextInput
              label="Kỳ báo cáo"
              inputMode="decimal"
              value={form.reporting}
              onChange={(e) => setForm({ ...form, reporting: decimal(e.target.value) })}
            />
          </div>
        ) : (
          <div className="grid grid-2">
            <TextInput
              label="Lịch bảo trì"
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              placeholder="Bảo trì 3 tháng"
            />
            <TextInput
              label="Hạn bảo trì kế tiếp"
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
        )}
        {add.error && <ErrorNote error={add.error} />}
      </Modal>
      <Modal
        open={!!maint}
        onClose={() => setMaint(null)}
        title={`Đã bảo trì · ${maint?.name ?? ''}`}
        footer={
          <Button
            variant="primary"
            icon={<Wrench size={16} />}
            loading={done.loading}
            onClick={async () => {
              if (!maint) return;
              try {
                await done.mutate({ assetId: maint.id, nextDueDate: maint.next || null });
                toast('success', 'Đã ghi nhận bảo trì');
                setMaint(null);
              } catch {
                /* inline */
              }
            }}
          >
            Ghi nhận
          </Button>
        }
      >
        {maint && (
          <TextInput
            label="Hạn bảo trì kế tiếp (không bắt buộc)"
            type="date"
            value={maint.next}
            onChange={(e) => setMaint({ ...maint, next: e.target.value })}
          />
        )}
        {done.error && <ErrorNote error={done.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 30 · Hồ sơ logistics ─────────
interface ShipmentForm {
  route: string;
  container: string;
  freeTimeStart: string;
  freeDays: string;
  storageRatePerDay: string;
  tariffCode: string;
  revenue: string;
  costs: { name: string; amount: string }[];
  allocation: { item: string; share: string }[];
}
const blankShipment = (): ShipmentForm => ({
  route: '',
  container: '',
  freeTimeStart: todayVN(),
  freeDays: '5',
  storageRatePerDay: '',
  tariffCode: '',
  revenue: '',
  costs: [{ name: 'Cước vận chuyển', amount: '' }],
  allocation: [{ item: '', share: '100' }],
});

function CreateShipmentModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const create = useMutation('modules.createShipment', { silent: true });
  const [f, setF] = useState<ShipmentForm>(blankShipment);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo hồ sơ lô hàng"
      width={680}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant="primary"
            loading={create.loading}
            onClick={async () => {
              try {
                const r = await create.mutate({
                  route: f.route,
                  container: f.container,
                  freeTimeStart: f.freeTimeStart,
                  freeDays: Number(f.freeDays || 0),
                  storageRatePerDay: f.storageRatePerDay || '0',
                  tariffCode: f.tariffCode,
                  revenue: f.revenue || '0',
                  costs: f.costs
                    .filter((c) => c.name.trim() && c.amount)
                    .map((c) => ({ name: c.name, amount: c.amount })),
                  allocation: f.allocation
                    .filter((a) => a.item.trim())
                    .map((a) => ({
                      item: a.item,
                      weightShare: String(Number((a.share || '0').replace(',', '.')) / 100),
                    })),
                });
                toast('success', `Đã tạo lô hàng ${r.code}`);
                setF(blankShipment());
                onCreated(r.id);
              } catch {
                /* inline */
              }
            }}
          >
            Tạo lô hàng
          </Button>
        </>
      }
    >
      <div className="grid grid-2">
        <TextInput
          label="Tuyến"
          value={f.route}
          onChange={(e) => setF({ ...f, route: e.target.value })}
          placeholder="Cát Lái → Kho Thủ Đức"
        />
        <TextInput
          label="Container / phương tiện"
          value={f.container}
          onChange={(e) => setF({ ...f, container: e.target.value })}
          placeholder="1×40HC"
        />
      </div>
      <div className="grid grid-3">
        <TextInput
          label="Bắt đầu tính miễn phí"
          type="date"
          value={f.freeTimeStart}
          onChange={(e) => setF({ ...f, freeTimeStart: e.target.value })}
        />
        <TextInput
          label="Số ngày miễn phí"
          inputMode="numeric"
          value={f.freeDays}
          onChange={(e) => setF({ ...f, freeDays: digits(e.target.value) })}
        />
        <TextInput
          label="Mã biểu phí"
          value={f.tariffCode}
          onChange={(e) => setF({ ...f, tariffCode: e.target.value })}
          placeholder="BPL-11"
        />
      </div>
      <div className="grid grid-2">
        <MoneyInput
          label="Phí lưu bãi / ngày (sau miễn phí)"
          value={f.storageRatePerDay}
          onChange={(v) => setF({ ...f, storageRatePerDay: v })}
        />
        <MoneyInput
          label="Doanh thu lô hàng"
          value={f.revenue}
          onChange={(v) => setF({ ...f, revenue: v })}
        />
      </div>
      <p className="strong small mb-8">Chi phí đã biết</p>
      {f.costs.map((c, i) => (
        <div key={i} className="grid grid-2">
          <TextInput
            label={`Khoản phí ${i + 1}`}
            value={c.name}
            onChange={(e) =>
              setF({ ...f, costs: f.costs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })
            }
          />
          <MoneyInput
            label="Số tiền"
            value={c.amount}
            onChange={(v) =>
              setF({ ...f, costs: f.costs.map((x, j) => (j === i ? { ...x, amount: v } : x)) })
            }
          />
        </div>
      ))}
      <Button
        size="sm"
        icon={<Plus size={16} />}
        onClick={() => setF({ ...f, costs: [...f.costs, { name: '', amount: '' }] })}
      >
        Thêm khoản phí
      </Button>
      <p className="strong small mb-8 mt-16">Phân bổ giá vốn theo trọng lượng (%)</p>
      {f.allocation.map((a, i) => (
        <div key={i} className="grid grid-2">
          <TextInput
            label={`Mặt hàng ${i + 1}`}
            value={a.item}
            onChange={(e) =>
              setF({
                ...f,
                allocation: f.allocation.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)),
              })
            }
          />
          <TextInput
            label="Tỷ trọng (%)"
            inputMode="decimal"
            value={a.share}
            onChange={(e) =>
              setF({
                ...f,
                allocation: f.allocation.map((x, j) =>
                  j === i ? { ...x, share: e.target.value.replace(/[^\d.,]/g, '') } : x,
                ),
              })
            }
          />
        </div>
      ))}
      <Button
        size="sm"
        icon={<Plus size={16} />}
        onClick={() => setF({ ...f, allocation: [...f.allocation, { item: '', share: '' }] })}
      >
        Thêm mặt hàng
      </Button>
      {create.error && <ErrorNote error={create.error} />}
    </Modal>
  );
}

export function LogisticsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [shipmentId, setShipmentId] = useSelected('shipment');
  const data = useQuery('modules.logistics', { shipmentId }, { keepPrevious: true });
  const event = useMutation('modules.addShipmentEvent', { silent: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [ev, setEv] = useState<{ title: string; detail: string; status: string; document: string } | null>(
    null,
  );
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  const s = d.shipment;
  const header = (
    <PageHeader
      eyebrow="G3 · Dự án"
      title="Hồ sơ logistics"
      subtitle="Nối sự kiện lô hàng với hồ sơ và người phụ trách."
      period={period}
      actions={
        d.canWrite ? (
          <Button icon={<Plus size={18} />} onClick={() => setCreateOpen(true)}>
            Tạo lô hàng
          </Button>
        ) : undefined
      }
    />
  );
  const modal = (
    <CreateShipmentModal
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      onCreated={(id) => {
        setCreateOpen(false);
        setShipmentId(id);
      }}
    />
  );
  if (!s) {
    return (
      <div className="page">
        {header}
        <ModuleTabs tabs={G3_TABS} current="/logistics" />
        <EmptyModule
          text="Chưa có lô hàng. Tạo hồ sơ lô hàng để theo dõi hành trình, thời gian miễn phí lưu bãi, chi phí và phân bổ giá vốn."
          action={
            d.canWrite && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreateOpen(true)}>
                Tạo lô hàng
              </Button>
            )
          }
        />
        {modal}
        <PageFoot />
      </div>
    );
  }
  return (
    <div className="page">
      {header}
      <ModuleTabs tabs={G3_TABS} current="/logistics" />
      <Picker label="Lô hàng" value={s.id} options={d.shipments} onChange={setShipmentId} />
      <div className="grid split-main">
        <Card
          title={s.title}
          subtitle={s.subtitle}
          actions={
            <div className="row wrap">
              <Chip tone={s.status === 'DELIVERED' ? 'success' : 'warning'}>{s.statusLabel}</Chip>
              {d.canWrite && s.status !== 'DELIVERED' && (
                <Button
                  size="sm"
                  icon={<MapPin size={16} />}
                  onClick={() => {
                    event.reset();
                    setEv({ title: '', detail: '', status: s.status, document: '' });
                  }}
                >
                  Cập nhật hành trình
                </Button>
              )}
            </div>
          }
        >
          <div className="mt-16">
            {s.events.map((e, i) => (
              <div key={i} className="list-item" style={{ gridTemplateColumns: '28px 1fr auto' }}>
                <span className={`tl-num${e.done ? ' done' : ''}`}>
                  {e.done ? <CircleCheck size={14} /> : i + 1}
                </span>
                <span>
                  <div className="li-title" style={{ fontSize: 16 }}>
                    {e.title}
                  </div>
                  <div className="li-sub">{e.detail}</div>
                </span>
                <span className="small muted">{e.atLabel}</span>
              </div>
            ))}
          </div>
        </Card>
        <div className="stack">
          <Card title="Chứng từ lô hàng">
            {s.documents.length === 0 && <p className="muted small">Chưa có chứng từ đính kèm.</p>}
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
            <Button
              variant="primary"
              block
              className="mt-16"
              onClick={() => navigate(`/logistics-finance?shipment=${s.id}`)}
            >
              Xem tài chính lô hàng
            </Button>
          </Card>
        </div>
      </div>
      <Modal
        open={!!ev}
        onClose={() => setEv(null)}
        title="Cập nhật hành trình"
        footer={
          <Button
            variant="primary"
            loading={event.loading}
            onClick={async () => {
              if (!ev) return;
              try {
                await event.mutate({
                  shipmentId: s.id,
                  title: ev.title,
                  detail: ev.detail,
                  status: ev.status as never,
                  document: ev.document || undefined,
                });
                toast('success', 'Đã cập nhật hành trình');
                setEv(null);
              } catch {
                /* inline */
              }
            }}
          >
            Lưu
          </Button>
        }
      >
        {ev && (
          <>
            <TextInput
              label="Mốc hành trình"
              value={ev.title}
              onChange={(e) => setEv({ ...ev, title: e.target.value })}
              placeholder="Container ra cổng"
            />
            <TextInput
              label="Chi tiết"
              value={ev.detail}
              onChange={(e) => setEv({ ...ev, detail: e.target.value })}
              placeholder="EIR-1031 · đính kèm biên bản"
            />
            <SelectInput
              label="Trạng thái lô hàng"
              value={ev.status}
              onChange={(v) => setEv({ ...ev, status: v })}
              options={d.statuses.map((x) => ({ value: x.code, label: x.label }))}
            />
            <TextInput
              label="Chứng từ đính kèm (không bắt buộc)"
              value={ev.document}
              onChange={(e) => setEv({ ...ev, document: e.target.value })}
              placeholder="Phiếu EIR"
            />
            {event.error && <ErrorNote error={event.error} />}
          </>
        )}
      </Modal>
      {modal}
      <PageFoot />
    </div>
  );
}

// ───────── 31 · Tài chính logistics ─────────
export function LogisticsFinancePage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [shipmentId, setShipmentId] = useSelected('shipment');
  const data = useQuery('modules.logisticsFinance', { shipmentId }, { keepPrevious: true });
  const confirm = useMutation('modules.confirmAllocation');
  const addCost = useMutation('modules.addShipmentCost', { silent: true });
  const [cost, setCost] = useState<{ name: string; basis: string; amount: string } | null>(null);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const s = data.data.shipment;
  if (!s) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="G3 · Dự án"
          title="Tài chính logistics"
          subtitle="Xem biểu phí, giá vốn và lợi nhuận theo lô."
          period={period}
        />
        <ModuleTabs tabs={G3_TABS} current="/logistics-finance" />
        <EmptyModule
          text="Chưa có lô hàng. Tạo lô hàng trong Hồ sơ logistics để tính chi phí và phân bổ giá vốn."
          action={
            <Button variant="primary" onClick={() => navigate('/logistics')}>
              Mở hồ sơ logistics
            </Button>
          }
        />
        <PageFoot />
      </div>
    );
  }
  return (
    <div className="page">
      <PageHeader
        eyebrow="G3 · Dự án"
        title="Tài chính logistics"
        subtitle="Xem biểu phí, giá vốn và lợi nhuận theo lô."
        period={period}
      />
      <ModuleTabs tabs={G3_TABS} current="/logistics-finance" />
      <Picker label="Lô hàng" value={s.id} options={data.data.shipments} onChange={setShipmentId} />
      <KpiRow items={s.kpis} />
      <div className="grid split-main">
        <Card
          title="Chi phí cấu thành"
          subtitle={s.tariff}
          actions={
            !s.allocationConfirmed && data.data.canWrite ? (
              <Button
                size="sm"
                icon={<Plus size={16} />}
                onClick={() => {
                  addCost.reset();
                  setCost({ name: '', basis: '', amount: '' });
                }}
              >
                Thêm chi phí
              </Button>
            ) : undefined
          }
        >
          <DataTable
            rows={s.costs}
            rowKey={(r) => r.name}
            columns={[
              { key: 'n', header: 'Khoản phí', render: (r) => r.name, strong: true },
              { key: 'b', header: 'Căn cứ', render: (r) => r.basis },
              { key: 'a', header: 'Số tiền', render: (r) => r.amountLabel, align: 'right' },
            ]}
          />
          <p className="table-foot">
            {s.tariff.replace('Biểu phí: ', 'Biểu phí ').replace(' · Hiệu lực từ', ' · Áp dụng từ')}.
          </p>
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
      <Modal
        open={!!cost}
        onClose={() => setCost(null)}
        title="Thêm chi phí lô hàng"
        footer={
          <Button
            variant="primary"
            loading={addCost.loading}
            onClick={async () => {
              if (!cost) return;
              try {
                await addCost.mutate({
                  shipmentId: s.id,
                  name: cost.name,
                  basis: cost.basis,
                  amount: cost.amount || '0',
                });
                toast('success', `Đã thêm ${cost.name}`);
                setCost(null);
              } catch {
                /* inline */
              }
            }}
          >
            Thêm
          </Button>
        }
      >
        {cost && (
          <>
            <TextInput
              label="Khoản phí"
              value={cost.name}
              onChange={(e) => setCost({ ...cost, name: e.target.value })}
              placeholder="Phí nội địa"
            />
            <TextInput
              label="Căn cứ"
              value={cost.basis}
              onChange={(e) => setCost({ ...cost, basis: e.target.value })}
              placeholder="Hồ sơ + vận chuyển"
            />
            <MoneyInput
              label="Số tiền"
              value={cost.amount}
              onChange={(v) => setCost({ ...cost, amount: v })}
            />
            <p className="small muted">Phí lưu bãi được tính tự động theo số ngày vượt thời gian miễn phí.</p>
            {addCost.error && <ErrorNote error={addCost.error} />}
          </>
        )}
      </Modal>
      <PageFoot />
    </div>
  );
}
