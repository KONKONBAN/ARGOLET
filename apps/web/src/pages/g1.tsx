import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ClipboardCheck, Plus, Send } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { Alert, Button, Card, Chip, DataTable, ErrorNote, KpiRow, Modal, PageHeader, PageLoading, TextInput, downloadText, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';

export const G1_TABS = [
  { to: '/daily-close', label: 'Chốt ca & ngày' },
  { to: '/inventory', label: 'Kho & giá thành' },
  { to: '/purchasing', label: 'Mua hàng & công nợ' },
  { to: '/books', label: 'Sổ sách & thuế' },
];

export function ModuleTabs({ tabs, current }: { tabs: { to: string; label: string }[]; current: string }) {
  const navigate = useNavigate();
  return (
    <div className="row wrap mb-16" role="tablist" aria-label="Phân hệ">
      {tabs.map((t) => (
        <Button key={t.to} size="sm" variant={t.to === current ? 'primary' : 'default'} role="tab" aria-selected={t.to === current} onClick={() => navigate(t.to)}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

// ───────── 20 · Chốt ca & chốt ngày ─────────
export function DailyClosePage() {
  const toast = useToast();
  const data = useQuery('modules.dailyClose');
  const submit = useMutation('modules.submitDailyClose', { silent: true });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  const shift = d.shift;
  return (
    <div className="page">
      <PageHeader eyebrow="G1 · Vận hành" title="Chốt ca & chốt ngày" subtitle="Tổng hợp tiền bán hàng tại từng cơ sở." period={period} />
      <ModuleTabs tabs={G1_TABS} current="/daily-close" />
      <KpiRow items={d.kpis} />
      {shift ? (
        <Card title={shift.title} actions={shift.status === 'SUBMITTED' ? <Chip tone="success">Đã gửi chốt ca</Chip> : undefined}>
          <DataTable
            rows={shift.lines}
            rowKey={(r) => r.channel}
            columns={[
              { key: 'c', header: 'Kênh / phương thức', render: (r) => r.channel, strong: true },
              { key: 's', header: 'Theo hệ thống', render: (r) => r.systemLabel, align: 'right' },
              { key: 'k', header: 'Thực kiểm', render: (r) => r.countedLabel, align: 'right' },
              { key: 'd', header: 'Chênh lệch', render: (r) => r.diffLabel, align: 'right' },
            ]}
          />
        </Card>
      ) : (
        <Card>
          <p className="muted">Chưa có ca làm việc trong kỳ.</p>
        </Card>
      )}
      {shift && shift.status !== 'SUBMITTED' && d.canSubmit && (
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            icon={<Send size={18} />}
            onClick={() => {
              setCounted(Object.fromEntries(shift.lines.map((l) => [l.channel, l.counted])));
              setOpen(true);
            }}
          >
            Gửi chốt ca
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Gửi chốt ca"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={submit.loading}
              onClick={async () => {
                try {
                  const r = await submit.mutate({ shiftId: shift!.id, counted, note: note || undefined });
                  toast('success', r.difference === '0' ? 'Đã gửi chốt ca, không có chênh lệch' : 'Đã gửi chốt ca kèm giải thích chênh lệch');
                  setOpen(false);
                } catch {
                  /* inline */
                }
              }}
            >
              Xác nhận gửi
            </Button>
          </>
        }
      >
        <p className="muted small mb-16">Nhập số tiền thực kiểm theo từng kênh.</p>
        {shift?.lines.map((l) => (
          <TextInput key={l.channel} label={`${l.channel} · hệ thống ${l.systemLabel}`} inputMode="numeric" value={counted[l.channel] ?? ''} onChange={(e) => setCounted({ ...counted, [l.channel]: e.target.value.replace(/[^\d]/g, '') })} />
        ))}
        <TextInput label="Ghi chú (bắt buộc nếu có chênh lệch)" value={note} onChange={(e) => setNote(e.target.value)} />
        {submit.error && <ErrorNote error={submit.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 21 · Kho & giá thành ─────────
export function InventoryPage() {
  const toast = useToast();
  const data = useQuery('modules.inventory');
  const adjust = useMutation('modules.adjustStock', { silent: true });
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [counting, setCounting] = useState<{ id: string; name: string; unit: string; value: string } | null>(null);
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G1 · Vận hành" title="Kho & giá thành" subtitle="Theo dõi nguyên liệu, công thức và hao hụt." period={period} />
      <ModuleTabs tabs={G1_TABS} current="/inventory" />
      <KpiRow items={d.kpis} />
      <Card title="Kho nguyên liệu · Định mức và hao hụt">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={d.canWrite ? (r) => setCounting({ id: r.id, name: r.name, unit: r.unit, value: r.onHand.replace(/\./g, '').replace(',', '.') }) : undefined}
          columns={[
            { key: 'n', header: 'Nguyên liệu', render: (r) => r.name, strong: true },
            { key: 'o', header: 'Tồn thực tế', render: (r) => r.onHand },
            { key: 'u', header: 'Đơn vị', render: (r) => r.unit },
            { key: 'v', header: 'Giá trị tồn', render: (r) => r.value, align: 'right' },
            { key: 's', header: 'Tình trạng', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
        />
        {d.canWrite && <p className="table-foot">Chọn một dòng để cập nhật số kiểm kê.</p>}
      </Card>
      <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
        <Button variant="primary" icon={<BookOpen size={18} />} onClick={() => setRecipeOpen(true)} disabled={!d.recipe}>
          Xem công thức
        </Button>
      </div>
      <Modal open={recipeOpen} onClose={() => setRecipeOpen(false)} title={`Công thức · ${d.recipe?.name ?? ''}`} width={560}>
        {d.recipe && (
          <>
            <DataTable
              rows={d.recipe.lines}
              rowKey={(r) => r.itemId}
              columns={[
                { key: 'n', header: 'Nguyên liệu', render: (r) => r.name },
                { key: 'q', header: 'Định mức', render: (r) => r.quantity },
                { key: 'c', header: 'Giá vốn', render: (r) => r.costLabel, align: 'right' },
              ]}
            />
            <div className="kv mt-16">
              <div className="kv-row">
                <span className="k">Giá thành / ly</span>
                <span className="v strong">{d.recipe.total}</span>
              </div>
              <div className="kv-row">
                <span className="k">Giá bán</span>
                <span className="v">{d.recipe.price}</span>
              </div>
              <div className="kv-row">
                <span className="k">Biên lợi nhuận gộp</span>
                <span className="v">{d.recipe.margin}</span>
              </div>
            </div>
            <p className="small muted mt-16">Tính bởi Finance Engine (Decimal, định mức × đơn giá bình quân di động).</p>
          </>
        )}
      </Modal>
      <Modal
        open={!!counting}
        onClose={() => setCounting(null)}
        title={`Kiểm kê · ${counting?.name ?? ''}`}
        footer={
          <Button
            variant="primary"
            loading={adjust.loading}
            onClick={async () => {
              try {
                await adjust.mutate({ itemId: counting!.id, onHand: counting!.value });
                toast('success', 'Đã cập nhật tồn kho');
                setCounting(null);
              } catch {
                /* inline */
              }
            }}
          >
            Lưu số kiểm kê
          </Button>
        }
      >
        <TextInput label={`Tồn thực tế (${counting?.unit ?? ''})`} inputMode="decimal" value={counting?.value ?? ''} onChange={(e) => counting && setCounting({ ...counting, value: e.target.value.replace(',', '.') })} />
        {adjust.error && <ErrorNote error={adjust.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 22 · Mua hàng & công nợ ─────────
export function PurchasingPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const data = useQuery('modules.purchasing');
  const create = useMutation('modules.createPurchaseOrder', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ supplier: '', amount: '', dueDate: '', purpose: '' });
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G1 · Vận hành" title="Mua hàng & công nợ" subtitle="Theo dõi mua vào, hạn trả và chứng từ đi kèm." period={period} />
      <ModuleTabs tabs={G1_TABS} current="/purchasing" />
      <KpiRow items={d.kpis} />
      <Card title="Nhà cung cấp & hạn thanh toán">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          columns={[
            { key: 'l', header: 'Nhà cung cấp / hồ sơ', render: (r) => r.label, strong: true },
            { key: 'd', header: 'Hạn trả', render: (r) => r.dueDate },
            { key: 'o', header: 'Còn phải trả', render: (r) => r.outstanding, align: 'right' },
            { key: 's', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
        />
      </Card>
      {d.canWrite && (
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setOpen(true)}>
            Tạo đơn mua
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tạo đơn mua"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={create.loading}
              onClick={async () => {
                try {
                  const r = await create.mutate(form);
                  toast('success', `Đã tạo ${r.code} và gửi đề nghị chi chờ duyệt`);
                  setOpen(false);
                  setForm({ supplier: '', amount: '', dueDate: '', purpose: '' });
                  navigate(`/approvals/${r.approvalId}`);
                } catch {
                  /* inline */
                }
              }}
            >
              Tạo & gửi duyệt
            </Button>
          </>
        }
      >
        <TextInput label="Nhà cung cấp" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="Sữa Xanh" />
        <TextInput label="Giá trị (đ)" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, '') })} placeholder="3200000" />
        <TextInput label="Hạn thanh toán" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
        <TextInput label="Mục đích" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Mua sữa tuần 45" />
        {create.error && <ErrorNote error={create.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 23 · Sổ sách & thuế ─────────
export function BooksPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery('modules.booksTax');
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G1 · Vận hành" title="Sổ sách & thuế" subtitle="Số liệu và hồ sơ thuế theo kỳ." period={period} />
      <ModuleTabs tabs={G1_TABS} current="/books" />
      <KpiRow items={d.kpis} />
      <Card title={d.title}>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.label}
          columns={[
            { key: 'l', header: 'Sổ / báo cáo', render: (r) => r.label, strong: true },
            { key: 'p', header: 'Kỳ dữ liệu', render: (r) => r.period },
            { key: 's', header: 'Tình trạng', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
            {
              key: 'a',
              header: 'Thao tác',
              render: (r) => (
                <button className="link-btn" onClick={() => navigate(r.route)}>
                  {r.action}
                </button>
              ),
            },
          ]}
        />
      </Card>
      <div className="row-between wrap mt-24">
        <span className="small muted">{d.note}</span>
        <Button
          variant="primary"
          icon={<ClipboardCheck size={18} />}
          onClick={() => {
            downloadText(d.export.filename, d.export.csv);
            toast('success', 'Đã xuất dữ liệu sổ để rà soát');
          }}
        >
          Rà soát trước khi xuất
        </Button>
      </div>
      <div className="mt-16">
        <Alert tone="info">Bản kê khai thuế chỉ được lập sau khi kỳ đã rà soát và có người có chuyên môn xác nhận phương pháp.</Alert>
      </div>
      <PageFoot />
    </div>
  );
}
