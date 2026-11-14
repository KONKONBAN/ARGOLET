import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, FileSpreadsheet, Plus, Send } from 'lucide-react';
import { useBackend, useMutation, useQuery } from '../api/hooks';
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
  downloadBase64,
  useToast,
} from '../ui/components';
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
        <Button
          key={t.to}
          size="sm"
          variant={t.to === current ? 'primary' : 'default'}
          role="tab"
          aria-selected={t.to === current}
          onClick={() => navigate(t.to)}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}

/** Today in Vietnam (YYYY-MM-DD), used as the default date of new records. */
export const todayVN = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

// ───────── 20 · Chốt ca & chốt ngày ─────────
export function DailyClosePage() {
  const toast = useToast();
  const [shiftId, setShiftId] = useState<string | undefined>();
  const data = useQuery('modules.dailyClose', { shiftId }, { keepPrevious: true });
  const submit = useMutation('modules.submitDailyClose', { silent: true });
  const openShift = useMutation('modules.openShift', { silent: true });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({
    entityId: '',
    date: todayVN(),
    shift: 'Ca sáng',
    cash: '',
    transfer: '',
    platform: '',
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
  const shift = d.shift;
  return (
    <div className="page">
      <PageHeader
        eyebrow="G1 · Vận hành"
        title="Chốt ca & chốt ngày"
        subtitle="Tổng hợp tiền bán hàng tại từng cơ sở."
        period={period}
        actions={
          d.canSubmit ? (
            <Button
              icon={<Plus size={18} />}
              onClick={() => {
                openShift.reset();
                setForm((f) => ({ ...f, entityId: f.entityId || d.units[0]?.id || '' }));
                setNewOpen(true);
              }}
            >
              Mở ca mới
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs tabs={G1_TABS} current="/daily-close" />
      <KpiRow items={d.kpis} />
      {shift ? (
        <Card
          title={shift.title}
          actions={
            shift.status === 'SUBMITTED' ? (
              <Chip tone="success">Đã gửi chốt ca</Chip>
            ) : (
              <Chip tone="warning">Đang mở</Chip>
            )
          }
        >
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
          <div className="empty">
            <p className="muted">
              Chưa có ca làm việc. Mở ca để ghi nhận doanh thu theo hệ thống, rồi gửi chốt ca với số tiền thực
              kiểm.
            </p>
          </div>
        </Card>
      )}
      {shift && shift.status !== 'SUBMITTED' && d.canSubmit && (
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            icon={<Send size={18} />}
            onClick={() => {
              setCounted(
                Object.fromEntries(shift.lines.map((l) => [l.channel, l.counted === '0' ? '' : l.counted])),
              );
              setNote('');
              submit.reset();
              setOpen(true);
            }}
          >
            Gửi chốt ca
          </Button>
        </div>
      )}
      {d.history.length > 1 && (
        <Card className="mt-24" title="Lịch sử ca" subtitle="Chọn một ca để xem chi tiết">
          <DataTable
            rows={d.history}
            rowKey={(r) => r.id}
            onRowClick={(r) => setShiftId(r.id)}
            columns={[
              {
                key: 'l',
                header: 'Ca',
                render: (r) => (r.id === shift?.id ? <b>{r.label}</b> : r.label),
                strong: true,
              },
              { key: 'u', header: 'Cơ sở', render: (r) => r.unit },
              { key: 't', header: 'Theo hệ thống', render: (r) => r.total, align: 'right' },
              { key: 'd', header: 'Chênh lệch', render: (r) => r.diffLabel, align: 'right' },
              { key: 's', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.statusLabel}</Chip> },
            ]}
          />
        </Card>
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
                  const r = await submit.mutate({
                    shiftId: shift!.id,
                    counted: Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, v || '0'])),
                    note: note || undefined,
                  });
                  toast(
                    'success',
                    r.difference === '0'
                      ? 'Đã gửi chốt ca, không có chênh lệch'
                      : 'Đã gửi chốt ca kèm giải thích chênh lệch',
                  );
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
          <MoneyInput
            key={l.channel}
            label={`${l.channel} · hệ thống ${l.systemLabel}`}
            value={counted[l.channel] ?? ''}
            onChange={(v) => setCounted({ ...counted, [l.channel]: v })}
          />
        ))}
        <TextInput
          label="Ghi chú (bắt buộc nếu có chênh lệch)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {submit.error && <ErrorNote error={submit.error} />}
      </Modal>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Mở ca mới"
        footer={
          <>
            <Button onClick={() => setNewOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={openShift.loading}
              onClick={async () => {
                try {
                  const r = await openShift.mutate({
                    entityId: form.entityId || undefined,
                    date: form.date,
                    shift: form.shift,
                    system: {
                      cash: form.cash || '0',
                      transfer: form.transfer || '0',
                      platform: form.platform || '0',
                    },
                  });
                  toast('success', `Đã mở ${form.shift.toLowerCase()}`);
                  setShiftId(r.id);
                  setNewOpen(false);
                } catch {
                  /* inline */
                }
              }}
            >
              Mở ca
            </Button>
          </>
        }
      >
        {d.units.length > 1 && (
          <SelectInput
            label="Cơ sở"
            value={form.entityId}
            onChange={(v) => setForm({ ...form, entityId: v })}
            options={d.units.map((u) => ({ value: u.id, label: u.label }))}
          />
        )}
        <div className="grid grid-2">
          <TextInput
            label="Ngày"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
          <SelectInput
            label="Ca"
            value={form.shift}
            onChange={(v) => setForm({ ...form, shift: v })}
            options={['Ca sáng', 'Ca chiều', 'Ca tối', 'Cả ngày'].map((x) => ({ value: x, label: x }))}
          />
        </div>
        <p className="muted small mb-16">
          Doanh thu theo hệ thống (máy POS / báo cáo nền tảng). Tiền thực kiểm nhập khi gửi chốt ca.
        </p>
        <MoneyInput
          label="Tiền mặt theo hệ thống"
          value={form.cash}
          onChange={(v) => setForm({ ...form, cash: v })}
        />
        <MoneyInput
          label="Chuyển khoản theo hệ thống"
          value={form.transfer}
          onChange={(v) => setForm({ ...form, transfer: v })}
        />
        <MoneyInput
          label="Nền tảng giao hàng theo hệ thống"
          value={form.platform}
          onChange={(v) => setForm({ ...form, platform: v })}
        />
        {openShift.error && <ErrorNote error={openShift.error} />}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 21 · Kho & giá thành ─────────
export function InventoryPage() {
  const toast = useToast();
  const [recipeId, setRecipeId] = useState<string | undefined>();
  const data = useQuery('modules.inventory', { recipeId }, { keepPrevious: true });
  const adjust = useMutation('modules.adjustStock', { silent: true });
  const addItem = useMutation('modules.addInventoryItem', { silent: true });
  const saveRecipe = useMutation('modules.saveRecipe', { silent: true });
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [builder, setBuilder] = useState<{
    name: string;
    price: string;
    waste: string;
    lines: { itemId: string; quantity: string }[];
  } | null>(null);
  const [item, setItem] = useState({
    name: '',
    unit: 'kg',
    onHand: '',
    unitCost: '',
    reorderLevel: '',
    entityId: '',
  });
  const [counting, setCounting] = useState<{ id: string; name: string; unit: string; value: string } | null>(
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
  return (
    <div className="page">
      <PageHeader
        eyebrow="G1 · Vận hành"
        title="Kho & giá thành"
        subtitle="Theo dõi nguyên liệu, công thức và hao hụt."
        period={period}
        actions={
          d.canWrite ? (
            <Button
              icon={<Plus size={18} />}
              onClick={() => {
                addItem.reset();
                setItem({
                  name: '',
                  unit: 'kg',
                  onHand: '',
                  unitCost: '',
                  reorderLevel: '',
                  entityId: d.units[0]?.id ?? '',
                });
                setItemOpen(true);
              }}
            >
              Thêm nguyên liệu
            </Button>
          ) : undefined
        }
      />
      <ModuleTabs tabs={G1_TABS} current="/inventory" />
      <KpiRow items={d.kpis} />
      <Card title="Kho nguyên liệu · Định mức và hao hụt">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={
            d.canWrite
              ? (r) =>
                  setCounting({
                    id: r.id,
                    name: r.name,
                    unit: r.unit,
                    value: r.onHand.replace(/\./g, '').replace(',', '.'),
                  })
              : undefined
          }
          columns={[
            { key: 'n', header: 'Nguyên liệu', render: (r) => r.name, strong: true },
            { key: 'o', header: 'Tồn thực tế', render: (r) => r.onHand },
            { key: 'u', header: 'Đơn vị', render: (r) => r.unit },
            { key: 'v', header: 'Giá trị tồn', render: (r) => r.value, align: 'right' },
            { key: 's', header: 'Tình trạng', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
          empty="Chưa có nguyên liệu. Thêm nguyên liệu với tồn đầu kỳ và đơn giá vốn."
        />
        {d.canWrite && d.items.length > 0 && (
          <p className="table-foot">Chọn một dòng để cập nhật số kiểm kê.</p>
        )}
      </Card>
      <div className="row wrap mt-24" style={{ justifyContent: 'flex-end' }}>
        {d.recipes.length > 1 && (
          <label className="row">
            <span className="small muted">Công thức</span>
            <select
              className="select"
              style={{ height: 44, width: 220 }}
              value={d.recipe?.id ?? ''}
              onChange={(e) => setRecipeId(e.target.value)}
              aria-label="Chọn công thức"
            >
              {d.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {d.canWrite && (
          <Button
            icon={<Plus size={18} />}
            disabled={d.itemOptions.length === 0}
            onClick={() => {
              saveRecipe.reset();
              setBuilder({
                name: '',
                price: '',
                waste: '0',
                lines: [{ itemId: d.itemOptions[0]?.id ?? '', quantity: '' }],
              });
            }}
          >
            Tạo công thức
          </Button>
        )}
        <Button
          variant="primary"
          icon={<BookOpen size={18} />}
          onClick={() => setRecipeOpen(true)}
          disabled={!d.recipe}
        >
          Xem công thức
        </Button>
      </div>
      <Modal
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        title={`Công thức · ${d.recipe?.name ?? ''}`}
        width={560}
      >
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
                <span className="k">Giá thành / {d.recipe.name.toLowerCase()}</span>
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
            <p className="small muted mt-16">
              Tính bởi Finance Engine (Decimal, định mức × đơn giá bình quân di động, cộng tỷ lệ hao hụt).
            </p>
          </>
        )}
      </Modal>
      <Modal
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        title="Thêm nguyên liệu"
        footer={
          <>
            <Button onClick={() => setItemOpen(false)}>Hủy</Button>
            <Button
              variant="primary"
              loading={addItem.loading}
              onClick={async () => {
                try {
                  await addItem.mutate({
                    name: item.name,
                    unit: item.unit,
                    onHand: item.onHand || '0',
                    unitCost: item.unitCost || '0',
                    reorderLevel: item.reorderLevel || '0',
                    entityId: item.entityId || undefined,
                  });
                  toast('success', `Đã thêm ${item.name}`);
                  setItemOpen(false);
                } catch {
                  /* inline */
                }
              }}
            >
              Thêm vào kho
            </Button>
          </>
        }
      >
        {d.units.length > 1 && (
          <SelectInput
            label="Kho / cơ sở"
            value={item.entityId}
            onChange={(v) => setItem({ ...item, entityId: v })}
            options={d.units.map((u) => ({ value: u.id, label: u.label }))}
          />
        )}
        <TextInput
          label="Tên nguyên liệu"
          value={item.name}
          onChange={(e) => setItem({ ...item, name: e.target.value })}
          placeholder="Bột mì số 11"
        />
        <div className="grid grid-2">
          <SelectInput
            label="Đơn vị tính"
            value={item.unit}
            onChange={(v) => setItem({ ...item, unit: v })}
            options={['kg', 'g', 'lít', 'ml', 'hộp', 'gói', 'chai', 'thùng', 'cái'].map((x) => ({
              value: x,
              label: x,
            }))}
          />
          <TextInput
            label="Tồn hiện có"
            inputMode="decimal"
            value={item.onHand}
            onChange={(e) => setItem({ ...item, onHand: e.target.value.replace(/[^\d.,]/g, '') })}
          />
        </div>
        <div className="grid grid-2">
          <MoneyInput
            label={`Đơn giá vốn / ${item.unit}`}
            value={item.unitCost}
            onChange={(v) => setItem({ ...item, unitCost: v })}
          />
          <TextInput
            label="Mức cảnh báo sắp hết"
            inputMode="decimal"
            value={item.reorderLevel}
            onChange={(e) => setItem({ ...item, reorderLevel: e.target.value.replace(/[^\d.,]/g, '') })}
          />
        </div>
        {addItem.error && <ErrorNote error={addItem.error} />}
      </Modal>
      <Modal
        open={!!builder}
        onClose={() => setBuilder(null)}
        title="Tạo công thức"
        width={620}
        footer={
          <>
            <Button onClick={() => setBuilder(null)}>Hủy</Button>
            <Button
              variant="primary"
              loading={saveRecipe.loading}
              onClick={async () => {
                if (!builder) return;
                try {
                  const r = await saveRecipe.mutate({
                    name: builder.name,
                    price: builder.price || '0',
                    wasteRate: String(Number((builder.waste || '0').replace(',', '.')) / 100),
                    lines: builder.lines.filter((l) => l.itemId && l.quantity),
                  });
                  toast('success', `Đã lưu công thức ${builder.name}`);
                  setRecipeId(r.id);
                  setBuilder(null);
                } catch {
                  /* inline */
                }
              }}
            >
              Lưu công thức
            </Button>
          </>
        }
      >
        {builder && (
          <>
            <div className="grid grid-2">
              <TextInput
                label="Tên món / sản phẩm"
                value={builder.name}
                onChange={(e) => setBuilder({ ...builder, name: e.target.value })}
                placeholder="Bánh mì bơ"
              />
              <MoneyInput
                label="Giá bán"
                value={builder.price}
                onChange={(v) => setBuilder({ ...builder, price: v })}
              />
            </div>
            <TextInput
              label="Tỷ lệ hao hụt (%)"
              inputMode="decimal"
              value={builder.waste}
              onChange={(e) => setBuilder({ ...builder, waste: e.target.value.replace(/[^\d.,]/g, '') })}
            />
            <p className="strong small mb-8">Định lượng cho một đơn vị sản phẩm</p>
            {builder.lines.map((l, i) => (
              <div key={i} className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
                <div style={{ flex: 2 }}>
                  <SelectInput
                    label={`Nguyên liệu ${i + 1}`}
                    value={l.itemId}
                    onChange={(v) =>
                      setBuilder({
                        ...builder,
                        lines: builder.lines.map((x, j) => (j === i ? { ...x, itemId: v } : x)),
                      })
                    }
                    options={d.itemOptions.map((o) => ({ value: o.id, label: `${o.name} (${o.unit})` }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <TextInput
                    label="Định lượng"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) =>
                      setBuilder({
                        ...builder,
                        lines: builder.lines.map((x, j) =>
                          j === i
                            ? { ...x, quantity: e.target.value.replace(/[^\d.,]/g, '').replace(',', '.') }
                            : x,
                        ),
                      })
                    }
                  />
                </div>
                {builder.lines.length > 1 && (
                  <Button
                    size="sm"
                    onClick={() => setBuilder({ ...builder, lines: builder.lines.filter((_, j) => j !== i) })}
                    aria-label={`Bỏ nguyên liệu ${i + 1}`}
                  >
                    Bỏ
                  </Button>
                )}
              </div>
            ))}
            <Button
              size="sm"
              icon={<Plus size={16} />}
              onClick={() =>
                setBuilder({
                  ...builder,
                  lines: [...builder.lines, { itemId: d.itemOptions[0]?.id ?? '', quantity: '' }],
                })
              }
            >
              Thêm nguyên liệu
            </Button>
            {saveRecipe.error && <ErrorNote error={saveRecipe.error} />}
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
        <TextInput
          label={`Tồn thực tế (${counting?.unit ?? ''})`}
          inputMode="decimal"
          value={counting?.value ?? ''}
          onChange={(e) => counting && setCounting({ ...counting, value: e.target.value.replace(',', '.') })}
        />
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
        eyebrow="G1 · Vận hành"
        title="Mua hàng & công nợ"
        subtitle="Theo dõi mua vào, hạn trả và chứng từ đi kèm."
        period={period}
      />
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
        <TextInput
          label="Nhà cung cấp"
          value={form.supplier}
          onChange={(e) => setForm({ ...form, supplier: e.target.value })}
          placeholder="Sữa Xanh"
        />
        <TextInput
          label="Giá trị (đ)"
          inputMode="numeric"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^\d]/g, '') })}
          placeholder="3200000"
        />
        <TextInput
          label="Hạn thanh toán"
          type="date"
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
        />
        <TextInput
          label="Mục đích"
          value={form.purpose}
          onChange={(e) => setForm({ ...form, purpose: e.target.value })}
          placeholder="Mua sữa tuần 45"
        />
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
  const { backend } = useBackend();
  const [exporting, setExporting] = useState(false);
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
        eyebrow="G1 · Vận hành"
        title="Sổ sách & thuế"
        subtitle="Số liệu và hồ sơ thuế theo kỳ."
        period={period}
      />
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
        <span className="small muted">
          {d.regime === 'HKD'
            ? d.hkdMethod
              ? 'Sổ theo mẫu Thông tư 152/2025/TT-BTC, lập từ chứng từ đã xác nhận.'
              : 'Chọn phương pháp nộp thuế trong Cài đặt để xuất đúng bộ sổ theo Thông tư 152/2025/TT-BTC.'
            : 'Doanh nghiệp: bảng kê chứng từ đã xác nhận để kế toán định khoản và ghi Sổ Nhật ký chung.'}
        </span>
        <Button
          variant="primary"
          icon={<FileSpreadsheet size={18} />}
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const f = await backend.call('modules.exportBooks', {});
              downloadBase64(f.filename, f.contentBase64, f.mime);
              toast('success', `Đã xuất ${f.filename} · ${f.forms.join(', ')}`);
            } catch (e) {
              toast('error', e instanceof Error ? e.message : 'Không xuất được sổ');
            } finally {
              setExporting(false);
            }
          }}
        >
          {d.regime === 'HKD' ? 'Xuất sổ kế toán (Excel)' : 'Xuất bảng kê chứng từ (Excel)'}
        </Button>
      </div>
      <div className="mt-16">
        <Alert tone="info">
          Bản kê khai thuế chỉ được lập sau khi kỳ đã rà soát và có người có chuyên môn xác nhận phương pháp.
        </Alert>
      </div>
      <PageFoot />
    </div>
  );
}
