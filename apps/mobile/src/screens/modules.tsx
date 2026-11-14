import { useState, type ReactNode } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { Text } from '../textScale';
import {
  CircleCheck,
  FileText,
  KeyRound,
  MapPin,
  Plus,
  Send,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react-native';
import { formatShortDateTime } from '@argolet/core';
import { useBackend, useMutation, useQuery, type OpResult } from '@argolet/client';
import { useSession } from '../session';
import { C, font } from '../theme';
import {
  Button,
  Card,
  Chip,
  ErrorView,
  Gap,
  Hero,
  Input,
  KV,
  Kpi,
  KpiGrid,
  Loading,
  Notice,
  OtpInput,
  Pager,
  Row,
  Screen,
  Sheet,
  Steps,
  T,
} from '../ui';
import type { ScreenProps } from '../App';
import { shareFile } from '../share';

type Kpis = { label: string; value: string; note?: string | undefined; highlight?: boolean | undefined }[];

const todayVN = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const digits = (s: string) => s.replace(/[^\d]/g, '');
const decimal = (s: string) => s.replace(/[^\d.,]/g, '').replace(',', '.');
const vnd = (s: string) => (s ? `${Number(s).toLocaleString('vi-VN')} đ` : undefined);

function ListCard<R>({
  title,
  subtitle,
  rows,
  render,
  empty = 'Không có dữ liệu',
  right,
}: {
  title?: string;
  subtitle?: string;
  rows: R[];
  render: (r: R, i: number) => ReactNode;
  empty?: string;
  right?: ReactNode;
}) {
  return (
    <Card title={title} subtitle={subtitle} right={right}>
      {rows.length === 0 ? <Text style={[T.muted, { lineHeight: 20 }]}>{empty}</Text> : rows.map(render)}
    </Card>
  );
}

/** Single-choice chips (units, shifts, stages, statuses…). */
export function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label && <Text style={[T.body, { marginBottom: 8 }]}>{label}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: value === o.value }}
            accessibilityLabel={o.label}
          >
            <Chip tone={value === o.value ? 'success' : 'neutral'}>{o.label}</Chip>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Money({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Input
      label={label}
      keyboardType="number-pad"
      value={value}
      onChangeText={(v) => onChange(digits(v))}
      hint={vnd(value)}
    />
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <Card>
      <Text style={[T.muted, { lineHeight: 20, marginBottom: action ? 14 : 0 }]}>{text}</Text>
      {action}
    </Card>
  );
}

function Picker({
  value,
  options,
  onChange,
}: {
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <Choice
      value={value ?? options[0]?.id ?? ''}
      options={options.map((o) => ({ value: o.id, label: o.label }))}
      onChange={onChange}
    />
  );
}

// ───────── 20 · Chốt ca & chốt ngày ─────────
export function DailyCloseScreen() {
  const [shiftId, setShiftId] = useState<string | undefined>();
  const data = useQuery('modules.dailyClose', { shiftId }, { keepPrevious: true });
  const submit = useMutation('modules.submitDailyClose', { silent: true });
  const openShift = useMutation('modules.openShift', { silent: true });
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [form, setForm] = useState({
    entityId: '',
    date: todayVN(),
    shift: 'Ca sáng',
    cash: '',
    transfer: '',
    platform: '',
  });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const shift = d.shift;
  const footer =
    shift && shift.status !== 'SUBMITTED' && d.canSubmit ? (
      <Button
        title="Gửi chốt ca"
        variant="primary"
        icon={<Send size={18} color="#fff" />}
        onPress={() => {
          setCounted(
            Object.fromEntries(shift.lines.map((l) => [l.channel, l.counted === '0' ? '' : l.counted])),
          );
          setNote('');
          submit.reset();
          setOpen(true);
        }}
      />
    ) : d.canSubmit ? (
      <Button
        title="Mở ca mới"
        variant="primary"
        icon={<Plus size={18} color="#fff" />}
        onPress={() => {
          openShift.reset();
          setForm((f) => ({ ...f, entityId: f.entityId || d.units[0]?.id || '' }));
          setNewOpen(true);
        }}
      />
    ) : undefined;
  return (
    <Screen footer={footer}>
      <KpiGrid items={d.kpis as Kpis} />
      {shift ? (
        <ListCard
          title={shift.title}
          right={
            <Chip tone={shift.status === 'SUBMITTED' ? 'success' : 'warning'}>
              {shift.status === 'SUBMITTED' ? 'Đã gửi' : 'Đang mở'}
            </Chip>
          }
          rows={shift.lines}
          render={(l) => (
            <Row
              key={l.channel}
              title={l.channel}
              subtitle={`Hệ thống ${l.systemLabel}, thực kiểm ${l.countedLabel}`}
              right={<Text style={[T.body, T.strong]}>{l.diffLabel}</Text>}
            />
          )}
        />
      ) : (
        <Empty text="Chưa có ca làm việc. Mở ca để ghi nhận doanh thu theo hệ thống, rồi gửi chốt ca với số tiền thực kiểm." />
      )}
      {shift && shift.status === 'SUBMITTED' && d.canSubmit && (
        <Button
          title="Mở ca mới"
          icon={<Plus size={18} color={C.brand} />}
          onPress={() => {
            openShift.reset();
            setForm((f) => ({ ...f, entityId: f.entityId || d.units[0]?.id || '' }));
            setNewOpen(true);
          }}
        />
      )}
      {d.history.length > 1 && (
        <>
          <Gap />
          <ListCard
            title="Lịch sử ca"
            subtitle="Chạm để xem chi tiết"
            rows={d.history}
            render={(h) => (
              <Row
                key={h.id}
                title={h.label}
                subtitle={`${h.unit}, ${h.total}, lệch ${h.diffLabel}`}
                right={<Chip tone={h.tone}>{h.statusLabel}</Chip>}
                onPress={() => setShiftId(h.id)}
              />
            )}
          />
        </>
      )}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Gửi chốt ca">
        {shift?.lines.map((l) => (
          <Money
            key={l.channel}
            label={`${l.channel}, hệ thống ${l.systemLabel}`}
            value={counted[l.channel] ?? ''}
            onChange={(v) => setCounted({ ...counted, [l.channel]: v })}
          />
        ))}
        <Input
          label="Ghi chú (nếu chênh lệch)"
          value={note}
          onChangeText={setNote}
          autoCapitalize="sentences"
        />
        {submit.error && <Notice tone="danger">{submit.error.message}</Notice>}
        <Button
          title="Xác nhận gửi"
          variant="primary"
          loading={submit.loading}
          onPress={async () => {
            const r = await submit
              .mutate({
                shiftId: shift!.id,
                counted: Object.fromEntries(Object.entries(counted).map(([k, v]) => [k, v || '0'])),
                note: note || undefined,
              })
              .catch(() => null);
            if (r) setOpen(false);
          }}
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={newOpen} onClose={() => setNewOpen(false)} title="Mở ca mới">
        {d.units.length > 1 && (
          <Choice
            label="Cơ sở"
            value={form.entityId}
            options={d.units.map((u) => ({ value: u.id, label: u.label }))}
            onChange={(v) => setForm({ ...form, entityId: v })}
          />
        )}
        <Input
          label="Ngày (YYYY-MM-DD)"
          value={form.date}
          onChangeText={(v) => setForm({ ...form, date: v })}
        />
        <Choice
          label="Ca"
          value={form.shift}
          options={['Ca sáng', 'Ca chiều', 'Ca tối', 'Cả ngày'].map((x) => ({ value: x, label: x }))}
          onChange={(v) => setForm({ ...form, shift: v })}
        />
        <Money
          label="Tiền mặt theo hệ thống"
          value={form.cash}
          onChange={(v) => setForm({ ...form, cash: v })}
        />
        <Money
          label="Chuyển khoản theo hệ thống"
          value={form.transfer}
          onChange={(v) => setForm({ ...form, transfer: v })}
        />
        <Money
          label="Nền tảng giao hàng theo hệ thống"
          value={form.platform}
          onChange={(v) => setForm({ ...form, platform: v })}
        />
        {openShift.error && <Notice tone="danger">{openShift.error.message}</Notice>}
        <Button
          title="Mở ca"
          variant="primary"
          loading={openShift.loading}
          onPress={async () => {
            const r = await openShift
              .mutate({
                entityId: form.entityId || undefined,
                date: form.date,
                shift: form.shift,
                system: {
                  cash: form.cash || '0',
                  transfer: form.transfer || '0',
                  platform: form.platform || '0',
                },
              })
              .catch(() => null);
            if (r) {
              setShiftId(r.id);
              setNewOpen(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 21 · Kho & giá thành ─────────
export function InventoryScreen() {
  const [recipeId, setRecipeId] = useState<string | undefined>();
  const data = useQuery('modules.inventory', { recipeId }, { keepPrevious: true });
  const addItem = useMutation('modules.addInventoryItem', { silent: true });
  const adjust = useMutation('modules.adjustStock', { silent: true });
  const saveRecipe = useMutation('modules.saveRecipe', { silent: true });
  const [open, setOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
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
  const [builder, setBuilder] = useState<{
    name: string;
    price: string;
    waste: string;
    lines: { itemId: string; quantity: string }[];
  } | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      footer={
        d.canWrite ? (
          <Button
            title="Thêm nguyên liệu"
            variant="primary"
            icon={<Plus size={18} color="#fff" />}
            onPress={() => {
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
          />
        ) : undefined
      }
    >
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard
        title="Kho nguyên liệu"
        subtitle={d.canWrite && d.items.length ? 'Chạm một dòng để kiểm kê' : 'Định mức và hao hụt'}
        rows={d.items}
        empty="Chưa có nguyên liệu. Thêm nguyên liệu với tồn đầu kỳ và đơn giá vốn."
        render={(r) => (
          <Row
            key={r.id}
            title={r.name}
            subtitle={`${r.onHand} ${r.unit}, ${r.value}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
            onPress={
              d.canWrite
                ? () => {
                    adjust.reset();
                    setCounting({
                      id: r.id,
                      name: r.name,
                      unit: r.unit,
                      value: r.onHand.replace(/\./g, '').replace(',', '.'),
                    });
                  }
                : undefined
            }
          />
        )}
      />
      <Picker
        value={d.recipe?.id}
        options={d.recipes.map((r) => ({ id: r.id, label: r.name }))}
        onChange={setRecipeId}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Xem công thức" disabled={!d.recipe} onPress={() => setOpen(true)} />
        </View>
        {d.canWrite && (
          <View style={{ flex: 1 }}>
            <Button
              title="Tạo công thức"
              disabled={d.itemOptions.length === 0}
              onPress={() => {
                saveRecipe.reset();
                setBuilder({
                  name: '',
                  price: '',
                  waste: '0',
                  lines: [{ itemId: d.itemOptions[0]?.id ?? '', quantity: '' }],
                });
              }}
            />
          </View>
        )}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title={`Công thức ${d.recipe?.name ?? ''}`}>
        {d.recipe?.lines.map((l) => (
          <Row
            key={l.itemId}
            title={l.name}
            subtitle={l.quantity}
            right={<Text style={T.body}>{l.costLabel}</Text>}
          />
        ))}
        {d.recipe && (
          <KV
            rows={[
              { label: 'Giá thành', value: d.recipe.total },
              { label: 'Giá bán', value: d.recipe.price },
              { label: 'Biên lợi nhuận gộp', value: d.recipe.margin },
            ]}
          />
        )}
        <Gap h={24} />
      </Sheet>
      <Sheet visible={itemOpen} onClose={() => setItemOpen(false)} title="Thêm nguyên liệu">
        {d.units.length > 1 && (
          <Choice
            label="Kho / cơ sở"
            value={item.entityId}
            options={d.units.map((u) => ({ value: u.id, label: u.label }))}
            onChange={(v) => setItem({ ...item, entityId: v })}
          />
        )}
        <Input
          label="Tên nguyên liệu"
          value={item.name}
          onChangeText={(v) => setItem({ ...item, name: v })}
          placeholder="Bột mì số 11"
        />
        <Choice
          label="Đơn vị tính"
          value={item.unit}
          options={['kg', 'g', 'lít', 'ml', 'hộp', 'gói', 'chai', 'cái'].map((x) => ({ value: x, label: x }))}
          onChange={(v) => setItem({ ...item, unit: v })}
        />
        <Input
          label="Tồn hiện có"
          keyboardType="decimal-pad"
          value={item.onHand}
          onChangeText={(v) => setItem({ ...item, onHand: decimal(v) })}
        />
        <Money
          label={`Đơn giá vốn / ${item.unit}`}
          value={item.unitCost}
          onChange={(v) => setItem({ ...item, unitCost: v })}
        />
        <Input
          label="Mức cảnh báo sắp hết"
          keyboardType="decimal-pad"
          value={item.reorderLevel}
          onChangeText={(v) => setItem({ ...item, reorderLevel: decimal(v) })}
        />
        {addItem.error && <Notice tone="danger">{addItem.error.message}</Notice>}
        <Button
          title="Thêm vào kho"
          variant="primary"
          loading={addItem.loading}
          onPress={async () =>
            (await addItem
              .mutate({
                name: item.name,
                unit: item.unit,
                onHand: item.onHand || '0',
                unitCost: item.unitCost || '0',
                reorderLevel: item.reorderLevel || '0',
                entityId: item.entityId || undefined,
              })
              .catch(() => null)) && setItemOpen(false)
          }
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={!!counting} onClose={() => setCounting(null)} title={`Kiểm kê ${counting?.name ?? ''}`}>
        <Input
          label={`Tồn thực tế (${counting?.unit ?? ''})`}
          keyboardType="decimal-pad"
          value={counting?.value ?? ''}
          onChangeText={(v) => counting && setCounting({ ...counting, value: decimal(v) })}
        />
        {adjust.error && <Notice tone="danger">{adjust.error.message}</Notice>}
        <Button
          title="Lưu số kiểm kê"
          variant="primary"
          loading={adjust.loading}
          onPress={async () =>
            (await adjust.mutate({ itemId: counting!.id, onHand: counting!.value }).catch(() => null)) &&
            setCounting(null)
          }
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={!!builder} onClose={() => setBuilder(null)} title="Tạo công thức">
        {builder && (
          <>
            <Input
              label="Tên món / sản phẩm"
              value={builder.name}
              onChangeText={(v) => setBuilder({ ...builder, name: v })}
              placeholder="Bánh mì bơ"
            />
            <Money
              label="Giá bán"
              value={builder.price}
              onChange={(v) => setBuilder({ ...builder, price: v })}
            />
            <Input
              label="Tỷ lệ hao hụt (%)"
              keyboardType="decimal-pad"
              value={builder.waste}
              onChangeText={(v) => setBuilder({ ...builder, waste: decimal(v) })}
            />
            {builder.lines.map((l, i) => (
              <View key={i}>
                <Choice
                  label={`Nguyên liệu ${i + 1}`}
                  value={l.itemId}
                  options={d.itemOptions.map((o) => ({ value: o.id, label: o.name }))}
                  onChange={(v) =>
                    setBuilder({
                      ...builder,
                      lines: builder.lines.map((x, j) => (j === i ? { ...x, itemId: v } : x)),
                    })
                  }
                />
                <Input
                  label={`Định lượng (${d.itemOptions.find((o) => o.id === l.itemId)?.unit ?? ''})`}
                  keyboardType="decimal-pad"
                  value={l.quantity}
                  onChangeText={(v) =>
                    setBuilder({
                      ...builder,
                      lines: builder.lines.map((x, j) => (j === i ? { ...x, quantity: decimal(v) } : x)),
                    })
                  }
                />
              </View>
            ))}
            <Button
              small
              title="Thêm nguyên liệu"
              onPress={() =>
                setBuilder({
                  ...builder,
                  lines: [...builder.lines, { itemId: d.itemOptions[0]?.id ?? '', quantity: '' }],
                })
              }
            />
            <Gap />
            {saveRecipe.error && <Notice tone="danger">{saveRecipe.error.message}</Notice>}
            <Button
              title="Lưu công thức"
              variant="primary"
              loading={saveRecipe.loading}
              onPress={async () => {
                const r = await saveRecipe
                  .mutate({
                    name: builder.name,
                    price: builder.price || '0',
                    wasteRate: String(Number(builder.waste || '0') / 100),
                    lines: builder.lines.filter((l) => l.itemId && l.quantity),
                  })
                  .catch(() => null);
                if (r) {
                  setRecipeId(r.id);
                  setBuilder(null);
                }
              }}
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 22 · Mua hàng & công nợ ─────────
export function PurchasingScreen({ navigation }: ScreenProps<'Purchasing'>) {
  const data = useQuery('modules.purchasing');
  const create = useMutation('modules.createPurchaseOrder', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ supplier: '', amount: '', dueDate: '', purpose: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      footer={
        d.canWrite ? (
          <Button
            title="Tạo đơn mua"
            variant="primary"
            icon={<Plus size={18} color="#fff" />}
            onPress={() => {
              create.reset();
              setOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard
        title="Nhà cung cấp & hạn thanh toán"
        rows={d.items}
        empty="Chưa có đơn mua đang mở."
        render={(r) => (
          <Row
            key={r.id}
            title={r.label}
            subtitle={`Hạn ${r.dueDate}, ${r.outstanding}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
          />
        )}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Tạo đơn mua">
        <Input
          label="Nhà cung cấp"
          value={f.supplier}
          onChangeText={(v) => setF({ ...f, supplier: v })}
          autoCapitalize="words"
        />
        <Money label="Giá trị" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} />
        <Input
          label="Hạn thanh toán (YYYY-MM-DD)"
          value={f.dueDate}
          onChangeText={(v) => setF({ ...f, dueDate: v })}
          placeholder={todayVN()}
        />
        <Input
          label="Mục đích"
          value={f.purpose}
          onChangeText={(v) => setF({ ...f, purpose: v })}
          autoCapitalize="sentences"
        />
        {create.error && <Notice tone="danger">{create.error.message}</Notice>}
        <Button
          title="Tạo & gửi duyệt"
          variant="primary"
          loading={create.loading}
          onPress={async () => {
            const r = await create.mutate(f).catch(() => null);
            if (r) {
              setOpen(false);
              navigation.navigate('Approval', { id: r.approvalId });
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 23 · Sổ sách & thuế ─────────
export function BooksScreen() {
  const data = useQuery('modules.booksTax');
  const { backend } = useBackend();
  const [exporting, setExporting] = useState(false);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      footer={
        <Button
          title="Xuất sổ kế toán (Excel)"
          variant="primary"
          loading={exporting}
          onPress={async () => {
            setExporting(true);
            try {
              const f = await backend.call('modules.exportBooks', {});
              await shareFile(f.filename, f.contentBase64, f.mime);
            } catch (e) {
              Alert.alert('Không xuất được sổ', e instanceof Error ? e.message : 'Thử lại sau');
            } finally {
              setExporting(false);
            }
          }}
        />
      }
    >
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard
        title={d.title}
        rows={d.items}
        render={(r) => (
          <Row
            key={r.label}
            title={r.label}
            subtitle={`${r.period}, ${r.action}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
          />
        )}
      />
      <Text style={T.small}>{d.note}</Text>
    </Screen>
  );
}

// ───────── 24 · Không gian khách hàng ─────────
export function ClientsScreen() {
  const data = useQuery('modules.clients', {});
  const add = useMutation('modules.addClient', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', scope: '1 cơ sở', closeDue: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      footer={
        d.canWrite ? (
          <Button
            title="Thêm khách hàng"
            variant="primary"
            onPress={() => {
              add.reset();
              setOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <KpiGrid items={d.kpis} />
      <ListCard
        rows={d.items}
        empty="Chưa có khách hàng ủy quyền."
        render={(r) => (
          <Row
            key={r.id}
            title={r.name}
            subtitle={`${r.scope}, ${r.completion}, hạn ${r.closeDue}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
          />
        )}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm khách hàng ủy quyền">
        <Input
          label="Tên khách hàng"
          value={f.name}
          onChangeText={(v) => setF({ ...f, name: v })}
          autoCapitalize="words"
        />
        <Input label="Phạm vi" value={f.scope} onChangeText={(v) => setF({ ...f, scope: v })} />
        <Input
          label="Hạn chốt (YYYY-MM-DD)"
          value={f.closeDue}
          onChangeText={(v) => setF({ ...f, closeDue: v })}
          placeholder={todayVN()}
        />
        {add.error && <Notice tone="danger">{add.error.message}</Notice>}
        <Button
          title="Thêm"
          variant="primary"
          loading={add.loading}
          onPress={async () => (await add.mutate(f).catch(() => null)) && setOpen(false)}
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 25 · Bán hàng & thu nợ ─────────
export function SalesScreen() {
  const [page, setPage] = useState(1);
  const data = useQuery('modules.sales', { page, pageSize: 20 }, { keepPrevious: true });
  const create = useMutation('modules.createDeal', { silent: true });
  const move = useMutation('modules.updateDealStage', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customer: '', value: '' });
  const [editing, setEditing] = useState<{ id: string; label: string; stage: string; done: boolean } | null>(
    null,
  );
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      key={`sales-${d.page}`}
      footer={
        d.canWrite ? (
          <Button
            title="Tạo cơ hội"
            variant="primary"
            onPress={() => {
              create.reset();
              setOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard
        title="Chuỗi bán hàng & thu nợ"
        subtitle={d.canWrite && d.items.length ? 'Chạm để chuyển bước' : undefined}
        rows={d.items}
        empty="Chưa có cơ hội bán hàng đang mở."
        render={(r) => (
          <Row
            key={r.id}
            title={r.label}
            subtitle={`${r.stage}, ${r.value}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
            onPress={
              d.canWrite
                ? () => {
                    move.reset();
                    setEditing({ id: r.id, label: r.label, stage: r.stageCode, done: false });
                  }
                : undefined
            }
          />
        )}
      />
      <Pager
        page={d.page}
        pageCount={d.pageCount}
        total={d.total}
        pageSize={d.pageSize}
        onPage={setPage}
        unit="cơ hội"
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Tạo cơ hội bán hàng">
        <Input
          label="Khách hàng"
          value={f.customer}
          onChangeText={(v) => setF({ ...f, customer: v })}
          autoCapitalize="words"
        />
        <Money label="Giá trị dự kiến" value={f.value} onChange={(v) => setF({ ...f, value: v })} />
        {create.error && <Notice tone="danger">{create.error.message}</Notice>}
        <Button
          title="Tạo cơ hội"
          variant="primary"
          loading={create.loading}
          onPress={async () => (await create.mutate(f).catch(() => null)) && setOpen(false)}
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={!!editing} onClose={() => setEditing(null)} title={editing?.label ?? ''}>
        {editing && (
          <>
            <Choice
              label="Bước hiện tại"
              value={editing.stage}
              options={d.stages.map((x) => ({ value: x.code, label: x.label }))}
              onChange={(v) => setEditing({ ...editing, stage: v })}
            />
            <Choice
              label="Tình trạng"
              value={editing.done ? 'done' : 'open'}
              options={[
                { value: 'open', label: 'Đang thực hiện' },
                { value: 'done', label: 'Hoàn tất / đã thu đủ' },
              ]}
              onChange={(v) => setEditing({ ...editing, done: v === 'done' })}
            />
            {move.error && <Notice tone="danger">{move.error.message}</Notice>}
            <Button
              title="Lưu"
              variant="primary"
              loading={move.loading}
              onPress={async () =>
                (await move
                  .mutate({ dealId: editing.id, stage: editing.stage as never, done: editing.done })
                  .catch(() => null)) && setEditing(null)
              }
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 26 · Dự án & công việc ─────────
export function ProjectsScreen() {
  const [projectId, setProjectId] = useState<string | undefined>();
  const data = useQuery('modules.projects', { projectId }, { keepPrevious: true });
  const add = useMutation('modules.addWbsTask', { silent: true });
  const create = useMutation('modules.createProject', { silent: true });
  const progress = useMutation('modules.updateWbsTask', { silent: true });
  const cost = useMutation('modules.recordProjectCost', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', owner: '', dependsOn: '' });
  const [newOpen, setNewOpen] = useState(false);
  const [nf, setNf] = useState({ name: '', manager: '', budget: '' });
  const [task, setTask] = useState<{ code: string; label: string; progress: string } | null>(null);
  const [costOpen, setCostOpen] = useState(false);
  const [cf, setCf] = useState({ kind: 'RECORDED', amount: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const openCreate = () => {
    create.reset();
    setNf({ name: '', manager: '', budget: '' });
    setNewOpen(true);
  };
  return (
    <Screen
      footer={
        d.canWrite ? (
          d.project ? (
            <Button
              title="Thêm công việc"
              variant="primary"
              onPress={() => {
                add.reset();
                setOpen(true);
              }}
            />
          ) : (
            <Button title="Tạo dự án" variant="primary" onPress={openCreate} />
          )
        ) : undefined
      }
    >
      <Picker value={d.project?.id} options={d.projects} onChange={setProjectId} />
      {d.project ? (
        <>
          <KpiGrid items={d.kpis as Kpis} />
          <ListCard
            title={d.project.title}
            subtitle={d.project.subtitle}
            rows={d.project.tasks}
            empty="Chưa có công việc. Thêm công việc để lập WBS."
            render={(t) => (
              <Row
                key={t.code}
                title={t.label}
                subtitle={`${t.owner}, ${t.progressLabel}, phụ thuộc ${t.dependsOn}`}
                right={<Chip tone={t.tone}>{t.statusLabel}</Chip>}
                onPress={
                  d.canWrite
                    ? () => {
                        progress.reset();
                        setTask({ code: t.code, label: t.label, progress: String(t.progress) });
                      }
                    : undefined
                }
              />
            )}
          />
          {d.canWrite && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Ghi nhận chi phí"
                  onPress={() => {
                    cost.reset();
                    setCf({ kind: 'RECORDED', amount: '' });
                    setCostOpen(true);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Dự án mới" onPress={openCreate} />
              </View>
            </View>
          )}
        </>
      ) : (
        <Empty text="Chưa có dự án. Tạo dự án với ngân sách được duyệt, sau đó lập công việc (WBS) và ghi nhận chi phí." />
      )}
      <Sheet visible={newOpen} onClose={() => setNewOpen(false)} title="Tạo dự án">
        <Input
          label="Tên dự án"
          value={nf.name}
          onChangeText={(v) => setNf({ ...nf, name: v })}
          autoCapitalize="sentences"
        />
        <Input
          label="Chủ nhiệm"
          value={nf.manager}
          onChangeText={(v) => setNf({ ...nf, manager: v })}
          autoCapitalize="words"
        />
        <Money label="Ngân sách được duyệt" value={nf.budget} onChange={(v) => setNf({ ...nf, budget: v })} />
        {create.error && <Notice tone="danger">{create.error.message}</Notice>}
        <Button
          title="Tạo dự án"
          variant="primary"
          loading={create.loading}
          onPress={async () => {
            const r = await create
              .mutate({ name: nf.name, manager: nf.manager, budget: nf.budget || '0' })
              .catch(() => null);
            if (r) {
              setProjectId(r.id);
              setNewOpen(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm công việc WBS">
        <Input
          label="Tên công việc"
          value={f.name}
          onChangeText={(v) => setF({ ...f, name: v })}
          autoCapitalize="sentences"
        />
        <Input
          label="Phụ trách"
          value={f.owner}
          onChangeText={(v) => setF({ ...f, owner: v })}
          autoCapitalize="words"
        />
        {!!d.project?.tasks.length && (
          <Choice
            label="Phụ thuộc"
            value={f.dependsOn}
            options={[
              { value: '', label: 'Không' },
              ...d.project.tasks.map((t) => ({ value: t.code, label: t.code })),
            ]}
            onChange={(v) => setF({ ...f, dependsOn: v })}
          />
        )}
        {add.error && <Notice tone="danger">{add.error.message}</Notice>}
        <Button
          title="Thêm"
          variant="primary"
          loading={add.loading}
          onPress={async () => {
            if (
              await add
                .mutate({
                  projectId: d.project!.id,
                  name: f.name,
                  owner: f.owner,
                  dependsOn: f.dependsOn || null,
                })
                .catch(() => null)
            ) {
              setF({ name: '', owner: '', dependsOn: '' });
              setOpen(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={!!task} onClose={() => setTask(null)} title={task?.label ?? ''}>
        {task && (
          <>
            <Choice
              label="Tiến độ"
              value={task.progress}
              options={['0', '25', '50', '75', '100'].map((x) => ({ value: x, label: `${x}%` }))}
              onChange={(v) => setTask({ ...task, progress: v })}
            />
            <Input
              label="Hoặc nhập tiến độ (%)"
              keyboardType="number-pad"
              value={task.progress}
              onChangeText={(v) => setTask({ ...task, progress: digits(v).slice(0, 3) })}
            />
            {progress.error && <Notice tone="danger">{progress.error.message}</Notice>}
            <Button
              title="Lưu tiến độ"
              variant="primary"
              loading={progress.loading}
              onPress={async () =>
                (await progress
                  .mutate({ projectId: d.project!.id, code: task.code, progress: Number(task.progress || 0) })
                  .catch(() => null)) && setTask(null)
              }
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
      <Sheet visible={costOpen} onClose={() => setCostOpen(false)} title="Ghi nhận chi phí dự án">
        <Choice
          value={cf.kind}
          options={[
            { value: 'RECORDED', label: 'Chi phí thực tế' },
            { value: 'COMMITTED', label: 'Cam kết' },
          ]}
          onChange={(v) => setCf({ ...cf, kind: v })}
        />
        <Money label="Số tiền" value={cf.amount} onChange={(v) => setCf({ ...cf, amount: v })} />
        {cost.error && <Notice tone="danger">{cost.error.message}</Notice>}
        <Button
          title="Ghi nhận"
          variant="primary"
          loading={cost.loading}
          onPress={async () => {
            const r = await cost
              .mutate({ projectId: d.project!.id, kind: cf.kind as 'RECORDED', amount: cf.amount || '0' })
              .catch(() => null);
            if (r) {
              if (r.overBudget)
                Alert.alert('Vượt ngân sách', 'Tổng chi phí thực tế và cam kết đã vượt ngân sách dự án.');
              setCostOpen(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 27 · Phân tích tài chính ─────────
interface AssumptionForm {
  investment: string;
  annualCashflow: string;
  years: string;
  rate: string;
  debt: string;
  salvage?: string;
}
const toAssumptions = (f: AssumptionForm) => ({
  investment: f.investment,
  annualCashflow: f.annualCashflow,
  years: Number(f.years || 0),
  discountRate: String(Number((f.rate || '0').replace(',', '.')) / 100),
  annualDebtService: f.debt,
  salvageValue: f.salvage ?? '',
});

function AssumptionInputs({ f, setF }: { f: AssumptionForm; setF: (f: AssumptionForm) => void }) {
  return (
    <>
      <Input
        label="Đầu tư ban đầu (triệu đ)"
        keyboardType="number-pad"
        value={f.investment}
        onChangeText={(v) => setF({ ...f, investment: digits(v) })}
      />
      <Input
        label="Dòng tiền thuần / năm (triệu đ)"
        keyboardType="number-pad"
        value={f.annualCashflow}
        onChangeText={(v) => setF({ ...f, annualCashflow: v.replace(/[^\d-]/g, '') })}
      />
      <Input
        label="Thời gian phân tích (năm)"
        keyboardType="number-pad"
        value={f.years}
        onChangeText={(v) => setF({ ...f, years: digits(v) })}
      />
      <Input
        label="Suất chiết khấu (%)"
        keyboardType="decimal-pad"
        value={f.rate}
        onChangeText={(v) => setF({ ...f, rate: v.replace(/[^\d.,]/g, '') })}
      />
      <Input
        label="Trả nợ / năm (triệu đ)"
        keyboardType="number-pad"
        value={f.debt}
        onChangeText={(v) => setF({ ...f, debt: digits(v) })}
      />
      <Input
        label="Giá trị thanh lý cuối dự án (triệu đ, nếu có)"
        keyboardType="number-pad"
        value={f.salvage ?? ''}
        onChangeText={(v) => setF({ ...f, salvage: digits(v) })}
      />
    </>
  );
}

export function FinanceScreen({ navigation }: ScreenProps<'Finance'>) {
  const [projectId, setProjectId] = useState<string | undefined>();
  const data = useQuery('finance.appraisal', { projectId }, { keepPrevious: true });
  const recalc = useMutation('finance.recalculate', { silent: true });
  const create = useMutation('finance.createProject', { silent: true });
  const [edits, setEdits] = useState<{ id: string; f: AssumptionForm } | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [nf, setNf] = useState<AssumptionForm>({
    investment: '',
    annualCashflow: '',
    years: '5',
    rate: '10',
    debt: '',
  });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const openCreate = () => {
    create.reset();
    setNewName('');
    setNf({ investment: '', annualCashflow: '', years: '5', rate: '10', debt: '' });
    setNewOpen(true);
  };
  const createSheet = (
    <Sheet visible={newOpen} onClose={() => setNewOpen(false)} title="Tạo dự án thẩm định">
      <Input label="Tên dự án" value={newName} onChangeText={setNewName} autoCapitalize="sentences" />
      <AssumptionInputs f={nf} setF={setNf} />
      {create.error && <Notice tone="danger">{create.error.message}</Notice>}
      <Button
        title="Tạo và tính"
        variant="primary"
        loading={create.loading}
        onPress={async () => {
          const r = await create.mutate({ name: newName, assumptions: toAssumptions(nf) }).catch(() => null);
          if (r) {
            setProjectId(r.id);
            setNewOpen(false);
          }
        }}
      />
      <Gap h={24} />
    </Sheet>
  );
  if (d.empty) {
    return (
      <Screen
        footer={
          d.canRun ? <Button title="Tạo dự án thẩm định" variant="primary" onPress={openCreate} /> : undefined
        }
      >
        <Empty text="Chưa có dự án thẩm định. Nhập vốn đầu tư, dòng tiền, thời hạn và suất chiết khấu để tính NPV, IRR, thời gian hoàn vốn và DSCR." />
        {createSheet}
      </Screen>
    );
  }
  const r = d.result;
  const a = d.assumptions;
  const f: AssumptionForm =
    edits && edits.id === d.project.id
      ? edits.f
      : {
          investment: a.investment,
          annualCashflow: a.annualCashflow,
          years: String(a.years),
          rate: a.discountRatePct,
          debt: a.annualDebtService,
          salvage: a.salvageValue ?? '',
        };
  return (
    <Screen
      footer={
        <Button
          title="Tính lại kịch bản"
          variant="primary"
          loading={recalc.loading}
          disabled={!d.canRun}
          onPress={async () => {
            if (
              await recalc
                .mutate({ projectId: d.project.id, assumptions: toAssumptions(f) })
                .catch(() => null)
            )
              setEdits(null);
          }}
        />
      }
    >
      <Picker
        value={d.project.id}
        options={d.projects}
        onChange={(id) => {
          setEdits(null);
          setProjectId(id);
        }}
      />
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Kpi label="NPV" value={r.npvLabel} highlight />
        </View>
        <View style={{ flex: 1 }}>
          <Kpi label="IRR" value={r.irrLabel} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1 }}>
          <Kpi label="Hoàn vốn" value={r.paybackLabel} />
        </View>
        <View style={{ flex: 1 }}>
          <Kpi label="DSCR" value={r.dscrLabel} />
        </View>
      </View>
      <Card title="Các chỉ tiêu bổ sung">
        <KV
          rows={[
            { label: 'MIRR', value: r.mirrLabel },
            { label: 'Chỉ số sinh lời PI', value: r.piLabel },
            { label: 'Hoàn vốn có chiết khấu', value: r.discountedPaybackLabel },
            { label: 'Dòng tiền đều tương đương (EAA)', value: r.eaaLabel },
          ]}
        />
      </Card>
      <Card title="Giả định đầu vào" subtitle={d.project.name}>
        <AssumptionInputs f={f} setF={(nf2) => setEdits({ id: d.project.id, f: nf2 })} />
        {recalc.error && <Notice tone="danger">{recalc.error.message}</Notice>}
      </Card>

      <Gap />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="So sánh kịch bản" onPress={() => navigation.navigate('Scenarios')} />
        </View>
        {d.canRun && (
          <View style={{ flex: 1 }}>
            <Button title="Dự án mới" onPress={openCreate} />
          </View>
        )}
      </View>
      <CalcRunHistory />
      {createSheet}
    </Screen>
  );
}

/** Every calculation is reproducible: inputs digest, engine version and time are kept. */
function CalcRunHistory() {
  const runs = useQuery('finance.calcRuns');
  if (!runs.data?.length) return null;
  return (
    <Card title="Lịch sử tính toán">
      {runs.data.slice(0, 10).map((r) => (
        <Row
          key={r.id}
          title={r.taskLabel}
          subtitle={`${formatShortDateTime(r.createdAt)}, ${r.engineVersion}, ${r.inputSnapshotDigest.slice(0, 12)}`}
        />
      ))}
    </Card>
  );
}

// ───────── 28 · So sánh kịch bản ─────────
export function ScenariosScreen({ navigation }: ScreenProps<'Scenarios'>) {
  const [projectId, setProjectId] = useState<string | undefined>();
  const data = useQuery('finance.scenarios', { projectId }, { keepPrevious: true });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  if (d.empty)
    return (
      <Screen>
        <Empty
          text="Chưa có dự án thẩm định để so sánh kịch bản."
          action={
            <Button
              title="Tạo dự án thẩm định"
              variant="primary"
              onPress={() => navigation.navigate('Finance')}
            />
          }
        />
      </Screen>
    );
  return (
    <Screen>
      <Picker value={d.projectId} options={d.projects} onChange={setProjectId} />
      {d.scenarios.map((s) => (
        <Card key={s.name} title={s.name} right={s.isBase ? <Chip tone="success">Cơ sở</Chip> : undefined}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, fontFamily: font }}>
            {s.annualCashflowLabel}
          </Text>
          <KV
            rows={[
              { label: `NPV @ ${d.ratePct}%`, value: s.npvLabel },
              { label: 'IRR', value: s.irrLabel },
              { label: 'Hoàn vốn', value: s.paybackLabel },
            ]}
          />
        </Card>
      ))}
      <Card title="Độ nhạy của NPV">
        <Text style={[T.muted, { lineHeight: 20 }]}>{d.sensitivity}</Text>
      </Card>
    </Screen>
  );
}

// ───────── 29 · Tài sản & đo lường ─────────
export function AssetsScreen() {
  const data = useQuery('modules.assets');
  const add = useMutation('modules.addAsset', { silent: true });
  const done = useMutation('modules.completeMaintenance', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    kind: 'ASSET',
    name: '',
    unit: 'kWh',
    baseline: '',
    reporting: '',
    schedule: '',
    dueDate: '',
  });
  const [maint, setMaint] = useState<{ id: string; name: string; next: string } | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen
      footer={
        d.canWrite ? (
          <Button
            title="Thêm tài sản / chỉ số"
            variant="primary"
            icon={<Plus size={18} color="#fff" />}
            onPress={() => {
              add.reset();
              setF({
                kind: 'ASSET',
                name: '',
                unit: 'kWh',
                baseline: '',
                reporting: '',
                schedule: '',
                dueDate: '',
              });
              setOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard
        title={d.title}
        rows={d.items}
        empty="Chưa có tài sản hoặc chỉ số đo lường."
        render={(r) => (
          <Row
            key={r.id}
            title={r.name}
            subtitle={`${r.baseline}${r.period ? ', ' + r.period : ''}`}
            right={<Chip tone={r.tone}>{r.result}</Chip>}
            onPress={
              d.canWrite && !r.isMetric && r.canComplete
                ? () => {
                    done.reset();
                    setMaint({ id: r.id, name: r.name, next: '' });
                  }
                : undefined
            }
          />
        )}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm tài sản / chỉ số">
        <Choice
          value={f.kind}
          options={[
            { value: 'ASSET', label: 'Tài sản / thiết bị' },
            { value: 'METRIC', label: 'Chỉ số đo lường' },
          ]}
          onChange={(v) => setF({ ...f, kind: v })}
        />
        <Input
          label={f.kind === 'METRIC' ? 'Tên chỉ số' : 'Tên tài sản'}
          value={f.name}
          onChangeText={(v) => setF({ ...f, name: v })}
        />
        {f.kind === 'METRIC' ? (
          <>
            <Choice
              label="Đơn vị"
              value={f.unit}
              options={['kWh', 'm³', 'lít', 'kg', 'giờ'].map((x) => ({ value: x, label: x }))}
              onChange={(v) => setF({ ...f, unit: v })}
            />
            <Input
              label="Đường cơ sở"
              keyboardType="decimal-pad"
              value={f.baseline}
              onChangeText={(v) => setF({ ...f, baseline: decimal(v) })}
            />
            <Input
              label="Kỳ báo cáo"
              keyboardType="decimal-pad"
              value={f.reporting}
              onChangeText={(v) => setF({ ...f, reporting: decimal(v) })}
            />
          </>
        ) : (
          <>
            <Input
              label="Lịch bảo trì"
              value={f.schedule}
              onChangeText={(v) => setF({ ...f, schedule: v })}
              placeholder="Bảo trì 3 tháng"
            />
            <Input
              label="Hạn bảo trì kế tiếp (YYYY-MM-DD)"
              value={f.dueDate}
              onChangeText={(v) => setF({ ...f, dueDate: v })}
            />
          </>
        )}
        {add.error && <Notice tone="danger">{add.error.message}</Notice>}
        <Button
          title="Thêm"
          variant="primary"
          loading={add.loading}
          onPress={async () =>
            (await add
              .mutate(
                f.kind === 'METRIC'
                  ? {
                      kind: 'METRIC',
                      name: f.name,
                      unit: f.unit,
                      baseline: f.baseline || '0',
                      reporting: f.reporting || '0',
                    }
                  : { kind: 'ASSET', name: f.name, schedule: f.schedule, dueDate: f.dueDate || null },
              )
              .catch(() => null)) && setOpen(false)
          }
        />
        <Gap h={24} />
      </Sheet>
      <Sheet visible={!!maint} onClose={() => setMaint(null)} title={`Đã bảo trì: ${maint?.name ?? ''}`}>
        {maint && (
          <Input
            label="Hạn bảo trì kế tiếp (không bắt buộc)"
            value={maint.next}
            onChangeText={(v) => setMaint({ ...maint, next: v })}
            placeholder="YYYY-MM-DD"
          />
        )}
        {done.error && <Notice tone="danger">{done.error.message}</Notice>}
        <Button
          title="Ghi nhận"
          variant="primary"
          icon={<Wrench size={18} color="#fff" />}
          loading={done.loading}
          onPress={async () =>
            (await done.mutate({ assetId: maint!.id, nextDueDate: maint!.next || null }).catch(() => null)) &&
            setMaint(null)
          }
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 30 · Hồ sơ logistics ─────────
function CreateShipmentSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useMutation('modules.createShipment', { silent: true });
  const [f, setF] = useState({
    route: '',
    container: '',
    freeTimeStart: todayVN(),
    freeDays: '5',
    rate: '',
    revenue: '',
    costName: 'Cước vận chuyển',
    costAmount: '',
    items: [{ item: '', share: '100' }],
  });
  return (
    <Sheet visible={visible} onClose={onClose} title="Tạo hồ sơ lô hàng">
      <Input
        label="Tuyến"
        value={f.route}
        onChangeText={(v) => setF({ ...f, route: v })}
        placeholder="Cát Lái đến Kho Thủ Đức"
      />
      <Input
        label="Container / phương tiện"
        value={f.container}
        onChangeText={(v) => setF({ ...f, container: v })}
        placeholder="1x40HC"
      />
      <Input
        label="Bắt đầu tính miễn phí (YYYY-MM-DD)"
        value={f.freeTimeStart}
        onChangeText={(v) => setF({ ...f, freeTimeStart: v })}
      />
      <Input
        label="Số ngày miễn phí"
        keyboardType="number-pad"
        value={f.freeDays}
        onChangeText={(v) => setF({ ...f, freeDays: digits(v) })}
      />
      <Money label="Phí lưu bãi / ngày" value={f.rate} onChange={(v) => setF({ ...f, rate: v })} />
      <Money label="Doanh thu lô hàng" value={f.revenue} onChange={(v) => setF({ ...f, revenue: v })} />
      <Input label="Khoản phí chính" value={f.costName} onChangeText={(v) => setF({ ...f, costName: v })} />
      <Money label="Số tiền" value={f.costAmount} onChange={(v) => setF({ ...f, costAmount: v })} />
      {f.items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 2 }}>
            <Input
              label={`Mặt hàng ${i + 1}`}
              value={it.item}
              onChangeText={(v) =>
                setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, item: v } : x)) })
              }
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              label="Tỷ trọng %"
              keyboardType="decimal-pad"
              value={it.share}
              onChangeText={(v) =>
                setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, share: decimal(v) } : x)) })
              }
            />
          </View>
        </View>
      ))}
      <Button
        small
        title="Thêm mặt hàng"
        onPress={() => setF({ ...f, items: [...f.items, { item: '', share: '' }] })}
      />
      <Gap />
      {create.error && <Notice tone="danger">{create.error.message}</Notice>}
      <Button
        title="Tạo lô hàng"
        variant="primary"
        loading={create.loading}
        onPress={async () => {
          const r = await create
            .mutate({
              route: f.route,
              container: f.container,
              freeTimeStart: f.freeTimeStart,
              freeDays: Number(f.freeDays || 0),
              storageRatePerDay: f.rate || '0',
              revenue: f.revenue || '0',
              costs: f.costName.trim() && f.costAmount ? [{ name: f.costName, amount: f.costAmount }] : [],
              allocation: f.items
                .filter((x) => x.item.trim())
                .map((x) => ({ item: x.item, weightShare: String(Number(x.share || '0') / 100) })),
            })
            .catch(() => null);
          if (r) onCreated(r.id);
        }}
      />
      <Gap h={24} />
    </Sheet>
  );
}

export function LogisticsScreen({ navigation }: ScreenProps<'Logistics'>) {
  const [shipmentId, setShipmentId] = useState<string | undefined>();
  const data = useQuery('modules.logistics', { shipmentId }, { keepPrevious: true });
  const event = useMutation('modules.addShipmentEvent', { silent: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [ev, setEv] = useState<{ title: string; detail: string; status: string; document: string } | null>(
    null,
  );
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const s = d.shipment;
  const sheet = (
    <CreateShipmentSheet
      visible={createOpen}
      onClose={() => setCreateOpen(false)}
      onCreated={(id) => {
        setCreateOpen(false);
        setShipmentId(id);
      }}
    />
  );
  if (!s) {
    return (
      <Screen
        footer={
          d.canWrite ? (
            <Button
              title="Tạo lô hàng"
              variant="primary"
              icon={<Plus size={18} color="#fff" />}
              onPress={() => setCreateOpen(true)}
            />
          ) : undefined
        }
      >
        <Empty text="Chưa có lô hàng. Tạo hồ sơ lô hàng để theo dõi hành trình, thời gian miễn phí lưu bãi, chi phí và phân bổ giá vốn." />
        {sheet}
      </Screen>
    );
  }
  return (
    <Screen
      footer={
        <Button
          title="Xem tài chính lô hàng"
          variant="primary"
          onPress={() => navigation.navigate('LogisticsFinance')}
        />
      }
    >
      <Picker value={s.id} options={d.shipments} onChange={setShipmentId} />
      <Card
        title={s.title}
        subtitle={s.subtitle}
        right={<Chip tone={s.status === 'DELIVERED' ? 'success' : 'warning'}>{s.statusLabel}</Chip>}
      >
        <Steps
          items={s.events.map((e) => ({ title: e.title, sub: `${e.detail}, ${e.atLabel}`, done: e.done }))}
        />
        {d.canWrite && s.status !== 'DELIVERED' && (
          <Button
            small
            title="Cập nhật hành trình"
            icon={<MapPin size={16} color={C.brand} />}
            onPress={() => {
              event.reset();
              setEv({ title: '', detail: '', status: s.status, document: '' });
            }}
          />
        )}
      </Card>
      <ListCard
        title="Chứng từ lô hàng"
        rows={s.documents}
        empty="Chưa có chứng từ đính kèm."
        render={(doc) => (
          <Row
            key={doc.name}
            icon={<FileText size={18} color={C.action} />}
            title={doc.name}
            subtitle={doc.status}
          />
        )}
      />
      <Card title="Hết thời gian miễn phí">
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, fontFamily: font }}>
          {s.freeTimeEnd}
        </Text>
        <Text style={[T.small, { marginTop: 6 }]}>{s.freeTimeNote}</Text>
      </Card>
      {d.canWrite && <Button title="Tạo lô hàng mới" onPress={() => setCreateOpen(true)} />}
      {sheet}
      <Sheet visible={!!ev} onClose={() => setEv(null)} title="Cập nhật hành trình">
        {ev && (
          <>
            <Input
              label="Mốc hành trình"
              value={ev.title}
              onChangeText={(v) => setEv({ ...ev, title: v })}
              placeholder="Container ra cổng"
            />
            <Input label="Chi tiết" value={ev.detail} onChangeText={(v) => setEv({ ...ev, detail: v })} />
            <Choice
              label="Trạng thái lô hàng"
              value={ev.status}
              options={d.statuses.map((x) => ({ value: x.code, label: x.label }))}
              onChange={(v) => setEv({ ...ev, status: v })}
            />
            <Input
              label="Chứng từ đính kèm (không bắt buộc)"
              value={ev.document}
              onChangeText={(v) => setEv({ ...ev, document: v })}
            />
            {event.error && <Notice tone="danger">{event.error.message}</Notice>}
            <Button
              title="Lưu"
              variant="primary"
              loading={event.loading}
              onPress={async () =>
                (await event
                  .mutate({
                    shipmentId: s.id,
                    title: ev.title,
                    detail: ev.detail,
                    status: ev.status as never,
                    document: ev.document || undefined,
                  })
                  .catch(() => null)) && setEv(null)
              }
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 31 · Tài chính logistics ─────────
export function LogisticsFinanceScreen({ navigation }: ScreenProps<'LogisticsFinance'>) {
  const [shipmentId, setShipmentId] = useState<string | undefined>();
  const data = useQuery('modules.logisticsFinance', { shipmentId }, { keepPrevious: true });
  const confirm = useMutation('modules.confirmAllocation');
  const addCost = useMutation('modules.addShipmentCost', { silent: true });
  const [cost, setCost] = useState<{ name: string; basis: string; amount: string } | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const s = data.data.shipment;
  if (!s)
    return (
      <Screen>
        <Empty
          text="Chưa có lô hàng."
          action={
            <Button
              title="Mở hồ sơ logistics"
              variant="primary"
              onPress={() => navigation.navigate('Logistics')}
            />
          }
        />
      </Screen>
    );
  return (
    <Screen
      footer={
        !s.allocationConfirmed && data.data.canWrite ? (
          <Button
            title="Xác nhận phân bổ"
            variant="primary"
            loading={confirm.loading}
            onPress={() => void confirm.mutate({ shipmentId: s.id })}
          />
        ) : undefined
      }
    >
      <Picker value={s.id} options={data.data.shipments} onChange={setShipmentId} />
      <KpiGrid items={s.kpis as Kpis} />
      <ListCard
        title="Chi phí cấu thành"
        subtitle={s.tariff}
        rows={s.costs}
        render={(c) => (
          <Row
            key={c.name}
            icon={<Truck size={18} color={C.action} />}
            title={c.name}
            subtitle={c.basis}
            right={<Text style={[T.body, T.strong]}>{c.amountLabel}</Text>}
          />
        )}
      />
      {!s.allocationConfirmed && data.data.canWrite && (
        <Button
          title="Thêm chi phí"
          icon={<Plus size={18} color={C.brand} />}
          onPress={() => {
            addCost.reset();
            setCost({ name: '', basis: '', amount: '' });
          }}
        />
      )}
      <Gap />
      <ListCard
        title="Phân bổ giá vốn"
        subtitle="Theo trọng lượng"
        rows={s.allocation}
        render={(a) => (
          <Row
            key={a.item}
            title={a.item}
            subtitle={a.share}
            right={<Text style={[T.body, T.strong]}>{a.amount}</Text>}
          />
        )}
      />
      {s.allocationConfirmed && <Notice tone="success">Đã xác nhận phân bổ giá vốn.</Notice>}
      <Sheet visible={!!cost} onClose={() => setCost(null)} title="Thêm chi phí lô hàng">
        {cost && (
          <>
            <Input
              label="Khoản phí"
              value={cost.name}
              onChangeText={(v) => setCost({ ...cost, name: v })}
              placeholder="Phí nội địa"
            />
            <Input label="Căn cứ" value={cost.basis} onChangeText={(v) => setCost({ ...cost, basis: v })} />
            <Money label="Số tiền" value={cost.amount} onChange={(v) => setCost({ ...cost, amount: v })} />
            {addCost.error && <Notice tone="danger">{addCost.error.message}</Notice>}
            <Button
              title="Thêm"
              variant="primary"
              loading={addCost.loading}
              onPress={async () =>
                (await addCost
                  .mutate({
                    shipmentId: s.id,
                    name: cost.name,
                    basis: cost.basis,
                    amount: cost.amount || '0',
                  })
                  .catch(() => null)) && setCost(null)
              }
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 32 · Điều hành tập đoàn ─────────
export function GroupScreen() {
  const data = useQuery('modules.group');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  return (
    <Screen>
      <KpiGrid items={data.data.kpis as Kpis} />
      <ListCard
        title={data.data.title}
        subtitle="Dữ liệu phục vụ hợp nhất, chưa kiểm toán"
        rows={data.data.items}
        render={(r) => (
          <Row
            key={r.id}
            title={`${r.name} (${r.code})`}
            subtitle={`Chứng từ ${r.docs}, ${r.ic}`}
            right={<Chip tone={r.tone}>{r.status}</Chip>}
          />
        )}
      />
      {data.data.canWrite && (
        <Text style={[T.small, { lineHeight: 18 }]}>
          Thêm pháp nhân hoặc cơ sở trong Cài đặt & tích hợp › Cơ cấu tổ chức.
        </Text>
      )}
    </Screen>
  );
}

// ───────── 33 · Đối soát nội bộ ─────────
export function IntercompanyScreen() {
  const [pairId, setPairId] = useState<string | undefined>();
  const data = useQuery('modules.intercompany', { pairId }, { keepPrevious: true });
  const request = useMutation('modules.requestIntercompanyDocs');
  const create = useMutation('modules.createIntercompanyPair', { silent: true });
  const update = useMutation('modules.updateIntercompanyAmounts', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    reference: '',
    contract: '',
    sideAEntityId: '',
    sideAAmount: '',
    sideBEntityId: '',
    sideBAmount: '',
  });
  const [amounts, setAmounts] = useState<{ a: string; b: string } | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const p = d.pair;
  const canCreate = d.canWrite && d.entities.length >= 2;
  const openCreate = () => {
    create.reset();
    setF({
      reference: '',
      contract: '',
      sideAEntityId: d.entities[0]?.id ?? '',
      sideAAmount: '',
      sideBEntityId: d.entities[1]?.id ?? '',
      sideBAmount: '',
    });
    setOpen(true);
  };
  const sheet = (
    <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm cặp đối soát nội bộ">
      <Input
        label="Mã tham chiếu chung"
        value={f.reference}
        onChangeText={(v) => setF({ ...f, reference: v })}
        placeholder="IC-2611-01"
      />
      <Input label="Hợp đồng" value={f.contract} onChangeText={(v) => setF({ ...f, contract: v })} />
      <Choice
        label="Bên ghi phải thu"
        value={f.sideAEntityId}
        options={d.entities.map((e) => ({ value: e.id, label: e.name }))}
        onChange={(v) => setF({ ...f, sideAEntityId: v })}
      />
      <Money label="Số phải thu" value={f.sideAAmount} onChange={(v) => setF({ ...f, sideAAmount: v })} />
      <Choice
        label="Bên ghi phải trả"
        value={f.sideBEntityId}
        options={d.entities.map((e) => ({ value: e.id, label: e.name }))}
        onChange={(v) => setF({ ...f, sideBEntityId: v })}
      />
      <Money label="Số phải trả" value={f.sideBAmount} onChange={(v) => setF({ ...f, sideBAmount: v })} />
      {create.error && <Notice tone="danger">{create.error.message}</Notice>}
      <Button
        title="Đối chiếu"
        variant="primary"
        loading={create.loading}
        onPress={async () => {
          const r = await create
            .mutate({ ...f, sideAAmount: f.sideAAmount || '0', sideBAmount: f.sideBAmount || '0' })
            .catch(() => null);
          if (r) {
            setPairId(r.id);
            setOpen(false);
          }
        }}
      />
      <Gap h={24} />
    </Sheet>
  );
  if (!p) {
    return (
      <Screen
        footer={
          canCreate ? <Button title="Thêm cặp đối soát" variant="primary" onPress={openCreate} /> : undefined
        }
      >
        <Empty
          text={
            d.entities.length < 2
              ? 'Đối soát nội bộ cần ít nhất hai pháp nhân. Thêm pháp nhân trong Cài đặt & tích hợp › Cơ cấu tổ chức.'
              : 'Chưa có cặp giao dịch nội bộ. Nhập số phải thu và phải trả của hai pháp nhân cùng mã tham chiếu để đối chiếu.'
          }
        />
        {sheet}
      </Screen>
    );
  }
  return (
    <Screen
      footer={
        p.status === 'DIFFERENCE' && d.canWrite ? (
          <Button
            title="Gửi yêu cầu bổ sung"
            variant="primary"
            loading={request.loading}
            onPress={() => void request.mutate({ pairId: p.id })}
          />
        ) : undefined
      }
    >
      <Picker value={p.id} options={d.pairs} onChange={setPairId} />
      <KpiGrid items={p.kpis as Kpis} />
      <Card title="Đối chiếu hai phía" subtitle={`Mã tham chiếu chung: ${p.reference}`}>
        {p.rows.map((r) => (
          <View key={r.label} style={{ paddingVertical: 8 }}>
            <Text style={[T.body, T.strong]}>{r.label}</Text>
            <KV
              rows={[
                { label: p.sideAName, value: r.a },
                { label: p.sideBName, value: r.b },
              ]}
            />
            <Gap h={6} />
            <Chip tone={r.tone}>{r.result}</Chip>
          </View>
        ))}
        {d.canWrite && p.status !== 'MATCHED' && (
          <Button
            small
            title="Điều chỉnh số liệu"
            onPress={() => {
              update.reset();
              setAmounts({
                a: p.rows[1]?.a.replace(/[^\d]/g, '') ?? '',
                b: p.rows[1]?.b.replace(/[^\d]/g, '') ?? '',
              });
            }}
          />
        )}
      </Card>
      <Card title="Việc tiếp theo">
        <Text style={[T.muted, { lineHeight: 20 }]}>{p.nextAction}</Text>
      </Card>
      {p.status === 'MATCHED' && <Notice tone="success">Hai phía đã khớp số liệu.</Notice>}
      {p.status === 'REQUESTED' && (
        <Notice tone="success">{`Đã gửi yêu cầu bổ sung cho ${p.sideBName}.`}</Notice>
      )}
      {canCreate && <Button title="Thêm cặp đối soát" onPress={openCreate} />}
      {sheet}
      <Sheet visible={!!amounts} onClose={() => setAmounts(null)} title="Điều chỉnh số liệu hai phía">
        {amounts && (
          <>
            <Money
              label={`Phải thu: ${p.sideAName}`}
              value={amounts.a}
              onChange={(v) => setAmounts({ ...amounts, a: v })}
            />
            <Money
              label={`Phải trả: ${p.sideBName}`}
              value={amounts.b}
              onChange={(v) => setAmounts({ ...amounts, b: v })}
            />
            {update.error && <Notice tone="danger">{update.error.message}</Notice>}
            <Button
              title="Đối chiếu lại"
              variant="primary"
              loading={update.loading}
              onPress={async () =>
                (await update
                  .mutate({ pairId: p.id, sideAAmount: amounts.a || '0', sideBAmount: amounts.b || '0' })
                  .catch(() => null)) && setAmounts(null)
              }
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 34 · Thành viên & phân quyền ─────────
export function MembersScreen() {
  const data = useQuery('org.listMembers');
  const invite = useMutation('org.inviteMember', { silent: true });
  const update = useMutation('org.updateMember', { silent: true });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ACCOUNTANT');
  const [code, setCode] = useState<string | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  return (
    <Screen
      footer={
        data.data.canManage ? (
          <Button
            title="Mời thành viên"
            variant="primary"
            onPress={() => {
              invite.reset();
              setCode(null);
              setEmail('');
              setOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <ListCard
        title="Vai trò theo tổ chức và đơn vị"

        rows={data.data.members}
        render={(m) => (
          <Row
            key={m.id}
            title={m.isSelf ? `${m.name} (bạn)` : m.name}
            subtitle={`${m.roleLabel}, ${m.scopeLabel}, hạn mức ${m.limitLabel}${m.code ? `, mã ${m.code}` : ''}`}
            right={<Chip tone={m.status === 'ACTIVE' ? 'success' : 'info'}>{m.statusLabel}</Chip>}
            onPress={
              data.data!.canManage && m.status !== 'INVITED' && !m.isSelf
                ? () =>
                    Alert.alert(
                      m.name,
                      m.status === 'ACTIVE'
                        ? 'Tạm ngưng quyền truy cập của thành viên này?'
                        : 'Kích hoạt lại thành viên này?',
                      [
                        { text: 'Huỷ', style: 'cancel' },
                        {
                          text: m.status === 'ACTIVE' ? 'Tạm ngưng' : 'Kích hoạt',
                          style: m.status === 'ACTIVE' ? 'destructive' : 'default',
                          onPress: () =>
                            void update
                              .mutate({
                                membershipId: m.id,
                                status: m.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                              })
                              .catch((e: unknown) =>
                                Alert.alert('Không cập nhật được', e instanceof Error ? e.message : ''),
                              ),
                        },
                      ],
                    )
                : undefined
            }
          />
        )}
      />
      <Sheet
        visible={open}
        onClose={() => {
          setOpen(false);
          setCode(null);
        }}
        title="Mời thành viên"
      >
        {code ? (
          <Notice tone="success">{`Mã mời: ${code}. Người được mời đăng ký bằng email ${email} rồi nhập mã.`}</Notice>
        ) : (
          <>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              error={invite.error?.message}
            />
            <Choice
              label="Vai trò"
              value={role}
              options={[
                { value: 'ACCOUNTANT', label: 'Kế toán' },
                { value: 'STAFF', label: 'Nhân viên' },
                { value: 'APPROVER', label: 'Người duyệt' },
                { value: 'VIEWER', label: 'Chỉ xem' },
              ]}
              onChange={setRole}
            />
            <Button
              title="Gửi lời mời"
              variant="primary"
              loading={invite.loading}
              onPress={async () => {
                const r = await invite
                  .mutate({
                    email,
                    role: role as never,
                    entityIds: '*',
                    approvalLimit: role === 'APPROVER' ? '50000000' : null,
                  })
                  .catch(() => null);
                if (r) setCode(r.code);
              }}
            />
          </>
        )}
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 35 · Cài đặt & tích hợp ─────────
export function SettingsScreen({ navigation }: ScreenProps<'Settings'>) {
  const data = useQuery('org.settings');
  const setInt = useMutation('org.setIntegration');
  const addEntity = useMutation('org.addEntity', { silent: true });
  const updateSettings = useMutation('org.updateSettings', { silent: true });
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [ef, setEf] = useState({ kind: 'SITE', name: '' });
  const [editing, setEditing] = useState(false);
  const [sf, setSf] = useState({ regime: '', period: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen>
      <Card title="Thông tin tổ chức">
        <KV
          rows={[
            { label: 'Tên', value: d.tenant.name },
            { label: 'Loại hình', value: d.tenant.orgType },
            { label: 'Mã số thuế', value: d.tenant.taxCode ?? 'Chưa có' },
            { label: 'Chế độ kế toán', value: d.tenant.settings.accountingRegime },
            { label: 'Kỳ hiện tại', value: d.tenant.settings.currentPeriod },
          ]}
        />
        {d.canManage && (
          <Button
            small
            title="Sửa chế độ kế toán & kỳ"
            onPress={() => {
              updateSettings.reset();
              setSf({ regime: d.tenant.settings.accountingRegime, period: d.tenant.settings.currentPeriod });
              setEditing(true);
            }}
          />
        )}
      </Card>
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Cài đặt kế toán">
        <Choice
          label="Chế độ kế toán"
          value={sf.regime}
          options={[
            { value: 'HKD', label: 'Hộ kinh doanh (TT152/2025)' },
            { value: 'TT133', label: 'TT133 (DN nhỏ và vừa)' },
            { value: 'TT99', label: 'TT99/2025 (thay TT200)' },
          ]}
          onChange={(v) => setSf({ ...sf, regime: v })}
        />
        <Input
          label="Kỳ hiện tại (YYYY-MM)"
          value={sf.period}
          onChangeText={(v) => setSf({ ...sf, period: v })}
          error={updateSettings.error?.message}
          keyboardType="numbers-and-punctuation"
        />
        <Button
          title="Lưu cài đặt"
          variant="primary"
          loading={updateSettings.loading}
          onPress={async () => {
            const ok = await updateSettings
              .mutate({
                accountingRegime: sf.regime as 'TT133',
                ...(sf.period !== d.tenant.settings.currentPeriod ? { currentPeriod: sf.period } : {}),
              })
              .catch(() => null);
            if (ok) {
              setEditing(false);
              await refresh();
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
      <ListCard
        title="Cơ cấu tổ chức"
        rows={d.entities}
        right={
          d.canManage ? (
            <Button
              small
              title="Thêm"
              onPress={() => {
                addEntity.reset();
                setEf({ kind: 'SITE', name: '' });
                setOpen(true);
              }}
            />
          ) : undefined
        }
        render={(e) => (
          <Row
            key={e.id}
            title={e.name}
            subtitle={`${e.kindLabel}, ${e.code}${e.parentName ? `, thuộc ${e.parentName}` : ''}`}
          />
        )}
      />
      <ListCard
        title="Kết nối dữ liệu"
        rows={d.integrations}
        render={(i) => (
          <Row
            key={i.id}
            title={i.name}
            subtitle={`${i.description}, ${i.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối'}`}
            right={
              d.canManage ? (
                <Button
                  small
                  title={i.status === 'CONNECTED' ? 'Ngắt' : 'Kết nối'}
                  onPress={() =>
                    void setInt.mutate({ integrationId: i.id, connect: i.status !== 'CONNECTED' })
                  }
                />
              ) : (
                <Chip tone={i.status === 'CONNECTED' ? 'success' : 'neutral'}>
                  {i.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa'}
                </Chip>
              )
            }
          />
        )}
      />
      <Card title="Quản trị">
        <Row title="Thành viên & phân quyền" chevron onPress={() => navigation.navigate('Members')} />
        <Row title="Bảo mật tài khoản" chevron onPress={() => navigation.navigate('Security')} />
        <Row title="Thông báo" chevron onPress={() => navigation.navigate('Notifications')} />
      </Card>
      <ListCard
        title="Nhật ký hoạt động"
        rows={d.audit.slice(0, 15)}
        render={(a, i) => (
          <Row
            key={i}
            title={`${a.actor}, ${a.action}`}
            subtitle={`${a.target}, ${new Date(Date.parse(a.at) + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16)}`}
          />
        )}
      />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm đơn vị">
        <Choice
          value={ef.kind}
          options={[
            { value: 'SITE', label: 'Cơ sở / cửa hàng' },
            { value: 'LEGAL_ENTITY', label: 'Pháp nhân' },
          ]}
          onChange={(v) => setEf({ ...ef, kind: v })}
        />
        <Input
          label="Tên đơn vị"
          value={ef.name}
          onChangeText={(v) => setEf({ ...ef, name: v })}
          autoCapitalize="words"
        />
        {addEntity.error && <Notice tone="danger">{addEntity.error.message}</Notice>}
        <Button
          title="Thêm"
          variant="primary"
          loading={addEntity.loading}
          onPress={async () => {
            if (await addEntity.mutate({ kind: ef.kind as 'SITE', name: ef.name }).catch(() => null)) {
              await refresh();
              setOpen(false);
            }
          }}
        />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── Bảo mật tài khoản ─────────
export function SecurityScreen() {
  const { me, refresh, signOut } = useSession();
  const sessions = useQuery('auth.listSessions');
  const revoke = useMutation('auth.revokeSession');
  const setup = useMutation('auth.setupTotp', { silent: true });
  const enable = useMutation('auth.enableTotp', { silent: true });
  const disable = useMutation('auth.disableTotp', { silent: true });
  const change = useMutation('auth.changePassword', { silent: true });
  const [totp, setTotp] = useState<OpResult<'auth.setupTotp'> | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwDone, setPwDone] = useState(false);
  return (
    <Screen>
      <Card title="Xác thực nhiều lớp (TOTP)">
        {me?.user.mfaEnabled ? (
          <>
            <Notice tone="success">Đã bật xác thực nhiều lớp.</Notice>
            <Text style={[T.small, { marginBottom: 8 }]}>
              Để tắt, nhập mã 6 số đang hiển thị trong ứng dụng xác thực.
            </Text>
            <OtpInput value={code} onChange={setCode} />
            {disable.error && <Notice tone="danger">{disable.error.message}</Notice>}
            <Gap />
            <Button
              title="Tắt TOTP"
              disabled={code.length !== 6}
              loading={disable.loading}
              onPress={async () => {
                if (await disable.mutate({ code }).catch(() => null)) {
                  await refresh();
                  setCode('');
                }
              }}
            />
          </>
        ) : totp ? (
          <>
            <Text style={T.small}>Thêm khóa này vào ứng dụng xác thực:</Text>
            <Text
              selectable
              style={{
                fontFamily: 'monospace',
                backgroundColor: C.soft,
                padding: 10,
                borderRadius: 8,
                marginVertical: 8,
              }}
            >
              {totp.secret}
            </Text>
            <Button
              small
              title="Mở ứng dụng xác thực"
              onPress={() =>
                void Linking.openURL(totp.otpauthUrl).catch(() =>
                  Alert.alert('Không mở được', 'Hãy nhập khóa thủ công.'),
                )
              }
            />
            <Gap />
            <OtpInput value={code} onChange={setCode} />
            {enable.error && <Notice tone="danger">{enable.error.message}</Notice>}
            <Gap />
            <Button
              title="Bật TOTP"
              variant="primary"
              disabled={code.length !== 6}
              loading={enable.loading}
              onPress={async () => {
                if (await enable.mutate({ code }).catch(() => null)) {
                  await refresh();
                  setTotp(null);
                }
              }}
            />
          </>
        ) : (
          <Button
            title="Thiết lập TOTP"
            variant="primary"
            icon={<KeyRound size={18} color="#fff" />}
            loading={setup.loading}
            onPress={async () => setTotp(await setup.mutate())}
          />
        )}
      </Card>
      <Card title="Đổi mật khẩu">
        <Input
          label="Mật khẩu hiện tại"
          secure
          value={pw.current}
          onChangeText={(v) => setPw({ ...pw, current: v })}
        />
        <Input
          label="Mật khẩu mới"
          secure
          value={pw.next}
          onChangeText={(v) => setPw({ ...pw, next: v })}
          hint="Ít nhất 12 ký tự."
        />
        {change.error && <Notice tone="danger">{change.error.message}</Notice>}
        {pwDone && <Notice tone="success">Đã đổi mật khẩu.</Notice>}
        <Button
          title="Cập nhật mật khẩu"
          disabled={!pw.current || pw.next.length < 12}
          loading={change.loading}
          onPress={async () => {
            if (
              await change.mutate({ currentPassword: pw.current, newPassword: pw.next }).catch(() => null)
            ) {
              setPw({ current: '', next: '' });
              setPwDone(true);
            }
          }}
        />
      </Card>
      <ListCard
        title="Phiên đăng nhập"
        rows={sessions.data ?? []}
        render={(s) => (
          <Row
            key={s.id}
            icon={
              s.aal === 2 ? (
                <ShieldCheck size={18} color={C.action} />
              ) : (
                <CircleCheck size={18} color={C.action} />
              )
            }
            title={`${s.channel === 'mobile' ? 'Ứng dụng di động' : 'Web'}${s.current ? ', phiên này' : ''}`}
            subtitle={deviceName(s.userAgent)}
            right={
              s.current ? (
                <Button small title="Đăng xuất" onPress={() => void signOut()} />
              ) : (
                <Button small title="Thu hồi" onPress={() => void revoke.mutate({ sessionId: s.id })} />
              )
            }
          />
        )}
      />
      <Hero label="Tài khoản" value={me?.user.fullName ?? ''} note={me?.user.email ?? me?.user.phone ?? ''} />
    </Screen>
  );
}

/** A readable device name from the user agent ("Chrome · Windows"). */
function deviceName(ua: string) {
  if (!ua) return 'Không rõ thiết bị';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : /okhttp|Expo|Dalvik|CFNetwork/i.test(ua)
            ? 'Ứng dụng ARGOLET'
            : ua.slice(0, 40);
  const os = /iPhone|iPad|iOS/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser}, ${os}` : browser;
}
