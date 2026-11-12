import { useState } from 'react';
import { ListFilter, Plus } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { Button, Card, Chip, DataTable, ErrorNote, KpiRow, Modal, MoneyInput, PageHeader, PageLoading, Pagination, SearchBox, SelectInput, TextInput, useToast } from '../ui/components';
import { useListState } from '../ui/paging';
import { PageFoot, usePeriodLabel } from './overview';
import { ModuleTabs } from './g1';

const G2_TABS = [
  { to: '/clients', label: 'Không gian khách hàng' },
  { to: '/sales', label: 'Bán hàng & thu nợ' },
];

// ───────── 24 · Không gian khách hàng ─────────
export function ClientsPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const data = useQuery('modules.clients', { q });
  const add = useMutation('modules.addClient', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', scope: '1 cơ sở', closeDue: '' });
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  const rows = d.items.filter((r) => !onlyMissing || r.tone === 'warning');
  return (
    <div className="page">
      <PageHeader eyebrow="G2 · Doanh nghiệp" title="Không gian khách hàng" subtitle="Quản lý hồ sơ theo từng phạm vi ủy quyền." period={period} />
      <ModuleTabs tabs={G2_TABS} current="/clients" />
      <KpiRow
        items={d.kpis}
        action={
          d.canWrite ? (
            <Button icon={<Plus size={18} />} onClick={() => setOpen(true)}>
              Thêm khách hàng
            </Button>
          ) : undefined
        }
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <Button icon={<ListFilter size={18} />} onClick={() => setOnlyMissing((s) => !s)} aria-pressed={onlyMissing}>
            {onlyMissing ? 'Đang thiếu hồ sơ' : 'Bộ lọc'}
          </Button>
        </div>
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Khách hàng', render: (r) => r.name, strong: true },
            { key: 's', header: 'Phạm vi', render: (r) => r.scope },
            { key: 'c', header: 'Hoàn tất', render: (r) => r.completion, align: 'right' },
            { key: 'd', header: 'Hạn chốt', render: (r) => r.closeDue },
            { key: 't', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
        />
        <p className="table-foot">
          Hiển thị {rows.length} bản ghi · Kỳ {period.toLowerCase()}
        </p>
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Thêm khách hàng ủy quyền"
        footer={
          <Button
            variant="primary"
            loading={add.loading}
            onClick={async () => {
              try {
                await add.mutate(form);
                toast('success', `Đã thêm ${form.name}`);
                setOpen(false);
                setForm({ name: '', scope: '1 cơ sở', closeDue: '' });
              } catch {
                /* inline */
              }
            }}
          >
            Thêm khách hàng
          </Button>
        }
      >
        <TextInput label="Tên khách hàng" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextInput label="Phạm vi ủy quyền" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
        <TextInput label="Hạn chốt" type="date" value={form.closeDue} onChange={(e) => setForm({ ...form, closeDue: e.target.value })} />
        {add.error && <ErrorNote error={add.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 25 · Bán hàng & thu nợ ─────────
export function SalesPage() {
  const toast = useToast();
  const list = useListState(20);
  const data = useQuery('modules.sales', { page: list.page, pageSize: list.pageSize }, { keepPrevious: true });
  const create = useMutation('modules.createDeal', { silent: true });
  const move = useMutation('modules.updateDealStage', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer: '', value: '' });
  const [editing, setEditing] = useState<{ id: string; label: string; stage: string; done: boolean } | null>(null);
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G2 · Doanh nghiệp" title="Bán hàng & thu nợ" subtitle="Nối cơ hội, hợp đồng, giao nhận và thu tiền." period={period} />
      <ModuleTabs tabs={G2_TABS} current="/sales" />
      <KpiRow items={d.kpis} />
      <Card title="Chuỗi bán hàng & thu nợ">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={d.canWrite ? (r) => { move.reset(); setEditing({ id: r.id, label: r.label, stage: r.stageCode, done: false }); } : undefined}
          columns={[
            { key: 'l', header: 'Khách hàng / hợp đồng', render: (r) => r.label, strong: true },
            { key: 's', header: 'Bước hiện tại', render: (r) => r.stage },
            { key: 'v', header: 'Giá trị', render: (r) => r.value, align: 'right' },
            { key: 't', header: 'Tình trạng', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
          empty="Chưa có cơ hội bán hàng đang mở"
        />
        <Pagination page={d.page} pageCount={d.pageCount} total={d.total} pageSize={d.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} unit="cơ hội" busy={data.fetching} />
        {d.canWrite && d.items.length > 0 && <p className="table-foot">Chọn một dòng để chuyển bước hoặc đánh dấu hoàn tất.</p>}
      </Card>
      {d.canWrite && (
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button variant="primary" icon={<Plus size={18} />} onClick={() => setOpen(true)}>
            Tạo cơ hội
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Tạo cơ hội bán hàng"
        footer={
          <Button
            variant="primary"
            loading={create.loading}
            onClick={async () => {
              try {
                const r = await create.mutate(form);
                toast('success', `Đã tạo cơ hội ${r.code}`);
                setOpen(false);
                setForm({ customer: '', value: '' });
              } catch {
                /* inline */
              }
            }}
          >
            Tạo cơ hội
          </Button>
        }
      >
        <TextInput label="Khách hàng" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
        <MoneyInput label="Giá trị dự kiến" value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
        {create.error && <ErrorNote error={create.error} />}
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.label ?? ''}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Hủy</Button>
            <Button
              variant="primary"
              loading={move.loading}
              onClick={async () => {
                if (!editing) return;
                try {
                  await move.mutate({ dealId: editing.id, stage: editing.stage as never, done: editing.done });
                  toast('success', editing.done ? 'Đã đánh dấu hoàn tất' : 'Đã cập nhật bước bán hàng');
                  setEditing(null);
                } catch {
                  /* inline */
                }
              }}
            >
              Lưu
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <SelectInput label="Bước hiện tại" value={editing.stage} onChange={(v) => setEditing({ ...editing, stage: v })} options={d.stages.map((x) => ({ value: x.code, label: x.label }))} />
            <label className="checkbox" style={{ display: 'flex', margin: '6px 0 12px' }}>
              <input type="checkbox" checked={editing.done} onChange={(e) => setEditing({ ...editing, done: e.target.checked })} /> Đã thu đủ tiền / hoàn tất hợp đồng
            </label>
            {move.error && <ErrorNote error={move.error} />}
          </>
        )}
      </Modal>
      <PageFoot />
    </div>
  );
}
