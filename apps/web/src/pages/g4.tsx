import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Send } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import {
  Alert,
  Button,
  Card,
  Chip,
  DataTable,
  ErrorNote,
  KpiRow,
  Modal,
  MoneyInput,
  PageHeader,
  PageLoading,
  SelectInput,
  TextInput,
  useToast,
} from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import { ModuleTabs } from './g1';

const G4_TABS = [
  { to: '/group', label: 'Điều hành tập đoàn' },
  { to: '/intercompany', label: 'Đối soát nội bộ' },
];

// ───────── 32 · Điều hành tập đoàn ─────────
export function GroupPage() {
  const navigate = useNavigate();
  const data = useQuery('modules.group');
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
        eyebrow="G4 · Tập đoàn"
        title="Điều hành tập đoàn"
        subtitle="Theo dõi pháp nhân và tiến độ gửi dữ liệu."
        period={period}
        actions={
          d.canWrite ? (
            <Button icon={<Plus size={18} />} onClick={() => navigate('/settings#co-cau')}>
              Thêm pháp nhân
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs tabs={G4_TABS} current="/group" />
      <KpiRow items={d.kpis} />
      <Card title={d.title} subtitle="Dữ liệu phục vụ hợp nhất · Chưa phải báo cáo hợp nhất đã kiểm toán">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Pháp nhân', render: (r) => r.name, strong: true },
            { key: 'c', header: 'Mã đơn vị', render: (r) => r.code },
            { key: 'd', header: 'Chứng từ', render: (r) => r.docs },
            { key: 's', header: 'Trạng thái kỳ', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
            { key: 'i', header: 'Nội bộ', render: (r) => r.ic },
          ]}
        />
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 33 · Đối soát nội bộ ─────────
export function IntercompanyPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const pairId = sp.get('pair') ?? undefined;
  const data = useQuery('modules.intercompany', { pairId }, { keepPrevious: true });
  const request = useMutation('modules.requestIntercompanyDocs');
  const create = useMutation('modules.createIntercompanyPair', { silent: true });
  const update = useMutation('modules.updateIntercompanyAmounts', { silent: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    reference: '',
    contract: '',
    sideAEntityId: '',
    sideAAmount: '',
    sideBEntityId: '',
    sideBAmount: '',
  });
  const [amounts, setAmounts] = useState<{ a: string; b: string } | null>(null);
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
  const p = d.pair;
  const selectPair = (id: string) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('pair', id);
        return n;
      },
      { replace: true },
    );
  const openCreate = () => {
    create.reset();
    setForm({
      reference: '',
      contract: '',
      sideAEntityId: d.entities[0]?.id ?? '',
      sideAAmount: '',
      sideBEntityId: d.entities[1]?.id ?? '',
      sideBAmount: '',
    });
    setCreateOpen(true);
  };
  const canCreate = d.canWrite && d.entities.length >= 2;
  const header = (
    <PageHeader
      eyebrow="G4 · Tập đoàn"
      title="Đối soát nội bộ"
      subtitle="Đối chiếu giao dịch giữa các pháp nhân."
      period={period}
      actions={
        canCreate ? (
          <Button icon={<Plus size={18} />} onClick={openCreate}>
            Thêm cặp đối soát
          </Button>
        ) : undefined
      }
    />
  );
  const createModal = (
    <Modal
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      title="Thêm cặp đối soát nội bộ"
      footer={
        <>
          <Button onClick={() => setCreateOpen(false)}>Hủy</Button>
          <Button
            variant="primary"
            loading={create.loading}
            onClick={async () => {
              try {
                const r = await create.mutate({
                  ...form,
                  sideAAmount: form.sideAAmount || '0',
                  sideBAmount: form.sideBAmount || '0',
                });
                toast('success', `Đã thêm cặp ${form.reference}`);
                selectPair(r.id);
                setCreateOpen(false);
              } catch {
                /* inline */
              }
            }}
          >
            Đối chiếu
          </Button>
        </>
      }
    >
      <div className="grid grid-2">
        <TextInput
          label="Mã tham chiếu chung"
          value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })}
          placeholder="IC-2611-01"
        />
        <TextInput
          label="Hợp đồng"
          value={form.contract}
          onChange={(e) => setForm({ ...form, contract: e.target.value })}
          placeholder="HD-018"
        />
      </div>
      <div className="grid grid-2">
        <SelectInput
          label="Bên ghi phải thu"
          value={form.sideAEntityId}
          onChange={(v) => setForm({ ...form, sideAEntityId: v })}
          options={d.entities.map((e) => ({ value: e.id, label: e.name }))}
        />
        <MoneyInput
          label="Số phải thu"
          value={form.sideAAmount}
          onChange={(v) => setForm({ ...form, sideAAmount: v })}
        />
      </div>
      <div className="grid grid-2">
        <SelectInput
          label="Bên ghi phải trả"
          value={form.sideBEntityId}
          onChange={(v) => setForm({ ...form, sideBEntityId: v })}
          options={d.entities.map((e) => ({ value: e.id, label: e.name }))}
        />
        <MoneyInput
          label="Số phải trả"
          value={form.sideBAmount}
          onChange={(v) => setForm({ ...form, sideBAmount: v })}
        />
      </div>
      {create.error && <ErrorNote error={create.error} />}
    </Modal>
  );
  if (!p) {
    return (
      <div className="page">
        {header}
        <ModuleTabs tabs={G4_TABS} current="/intercompany" />
        <Card>
          <div style={{ textAlign: 'center', padding: '28px 12px' }}>
            <p className="muted" style={{ maxWidth: 540, margin: '0 auto 18px', lineHeight: 1.6 }}>
              {d.entities.length < 2
                ? 'Đối soát nội bộ cần ít nhất hai pháp nhân. Thêm công ty con hoặc pháp nhân liên quan trong Cài đặt › Cơ cấu tổ chức.'
                : 'Chưa có cặp giao dịch nội bộ. Nhập số phải thu và phải trả của hai pháp nhân cùng mã tham chiếu để đối chiếu.'}
            </p>
            {d.entities.length < 2
              ? d.canWrite && (
                  <Button variant="primary" onClick={() => navigate('/settings#co-cau')}>
                    Mở cơ cấu tổ chức
                  </Button>
                )
              : canCreate && (
                  <Button variant="primary" icon={<Plus size={18} />} onClick={openCreate}>
                    Thêm cặp đối soát
                  </Button>
                )}
          </div>
        </Card>
        {createModal}
        <PageFoot />
      </div>
    );
  }
  return (
    <div className="page">
      {header}
      <ModuleTabs tabs={G4_TABS} current="/intercompany" />
      {d.pairs.length > 1 && (
        <label className="row mb-16" style={{ gap: 10 }}>
          <span className="small muted">Cặp đối soát</span>
          <select
            className="select"
            style={{ height: 40, width: 'min(420px, 100%)' }}
            value={p.id}
            onChange={(e) => selectPair(e.target.value)}
            aria-label="Cặp đối soát"
          >
            {d.pairs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <KpiRow items={p.kpis} />
      <Card
        title="Đối chiếu hai phía"
        subtitle={`Mã tham chiếu chung: ${p.reference}`}
        actions={
          d.canWrite && p.status !== 'MATCHED' ? (
            <Button
              size="sm"
              icon={<Pencil size={16} />}
              onClick={() => {
                update.reset();
                setAmounts({
                  a: p.rows[1]?.a.replace(/[^\d]/g, '') ?? '',
                  b: p.rows[1]?.b.replace(/[^\d]/g, '') ?? '',
                });
              }}
            >
              Điều chỉnh số liệu
            </Button>
          ) : undefined
        }
      >
        <DataTable
          rows={p.rows}
          rowKey={(r) => r.label}
          columns={[
            { key: 'l', header: 'Nội dung', render: (r) => r.label, strong: true },
            { key: 'a', header: p.sideAName, render: (r) => r.a, align: 'right' },
            { key: 'b', header: p.sideBName, render: (r) => r.b, align: 'right' },
            { key: 'r', header: 'Kết quả', render: (r) => <Chip tone={r.tone}>{r.result}</Chip> },
          ]}
        />
        <h3 className="card-title" style={{ marginTop: 32 }}>
          Việc tiếp theo
        </h3>
        <p className="mt-8" style={{ lineHeight: 1.7 }}>
          {p.nextAction}
        </p>
        <p className="small muted mt-8">
          Bút toán loại trừ dạng nháp: Nợ {p.eliminationDraft.debit} / Có {p.eliminationDraft.credit} ·{' '}
          {Number(p.eliminationDraft.amount).toLocaleString('vi-VN')} đ
        </p>
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          {p.status === 'MATCHED' ? (
            <Alert tone="success">Hai phía đã khớp số liệu.</Alert>
          ) : p.status === 'REQUESTED' ? (
            <Alert tone="success">Đã gửi yêu cầu bổ sung chứng từ cho {p.sideBName}.</Alert>
          ) : (
            d.canWrite && (
              <Button
                variant="primary"
                icon={<Send size={18} />}
                loading={request.loading}
                onClick={async () => {
                  await request.mutate({ pairId: p.id });
                  toast('success', 'Đã gửi yêu cầu bổ sung chứng từ');
                }}
              >
                Gửi yêu cầu bổ sung
              </Button>
            )
          )}
        </div>
      </Card>
      <Modal
        open={!!amounts}
        onClose={() => setAmounts(null)}
        title="Điều chỉnh số liệu hai phía"
        footer={
          <Button
            variant="primary"
            loading={update.loading}
            onClick={async () => {
              if (!amounts) return;
              try {
                const r = await update.mutate({
                  pairId: p.id,
                  sideAAmount: amounts.a || '0',
                  sideBAmount: amounts.b || '0',
                });
                toast('success', r.matched ? 'Hai phía đã khớp' : 'Đã cập nhật · vẫn còn chênh lệch');
                setAmounts(null);
              } catch {
                /* inline */
              }
            }}
          >
            Đối chiếu lại
          </Button>
        }
      >
        {amounts && (
          <>
            <MoneyInput
              label={`Phải thu · ${p.sideAName}`}
              value={amounts.a}
              onChange={(v) => setAmounts({ ...amounts, a: v })}
            />
            <MoneyInput
              label={`Phải trả · ${p.sideBName}`}
              value={amounts.b}
              onChange={(v) => setAmounts({ ...amounts, b: v })}
            />
            {update.error && <ErrorNote error={update.error} />}
          </>
        )}
      </Modal>
      {createModal}
      <PageFoot />
    </div>
  );
}
