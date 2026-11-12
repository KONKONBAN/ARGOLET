import { useEffect, useState } from 'react';
import { Alert, Linking, Share, Text, View } from 'react-native';
import { CircleCheck, FileText, KeyRound, Plus, Send, ShieldCheck, Truck } from 'lucide-react-native';
import { useMutation, useQuery, type OpResult } from '@argolet/client';
import { useSession } from '../session';
import { C, font } from '../theme';
import { Button, Card, Chip, ErrorView, Gap, Hero, Input, KV, Kpi, KpiGrid, Loading, Notice, OtpInput, Row, Screen, Sheet, Steps, T } from '../ui';
import type { ScreenProps } from '../App';

type Kpis = { label: string; value: string; note?: string | undefined; highlight?: boolean | undefined }[];

function ListCard<R>({ title, subtitle, rows, render }: { title?: string; subtitle?: string; rows: R[]; render: (r: R, i: number) => React.ReactNode }) {
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? <Text style={T.muted}>Không có dữ liệu</Text> : rows.map(render)}
    </Card>
  );
}

// ───────── 20 · Chốt ca & chốt ngày ─────────
export function DailyCloseScreen() {
  const data = useQuery('modules.dailyClose');
  const submit = useMutation('modules.submitDailyClose', { silent: true });
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const shift = d.shift;
  return (
    <Screen footer={shift && shift.status !== 'SUBMITTED' && d.canSubmit ? <Button title="Gửi chốt ca" variant="primary" icon={<Send size={18} color="#fff" />} onPress={() => {
      setCounted(Object.fromEntries(shift.lines.map((l) => [l.channel, l.counted])));
      setOpen(true);
    }} /> : undefined}>
      <KpiGrid items={d.kpis as Kpis} />
      {shift && (
        <ListCard title={shift.title} rows={shift.lines} render={(l) => <Row key={l.channel} title={l.channel} subtitle={`Hệ thống ${l.systemLabel} · Thực kiểm ${l.countedLabel}`} right={<Text style={[T.body, T.strong]}>{l.diffLabel}</Text>} />} />
      )}
      {shift?.status === 'SUBMITTED' && <Notice tone="success">Ca đã được gửi chốt.</Notice>}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Gửi chốt ca">
        {shift?.lines.map((l) => (
          <Input key={l.channel} label={`${l.channel} · hệ thống ${l.systemLabel}`} keyboardType="number-pad" value={counted[l.channel] ?? ''} onChangeText={(v) => setCounted({ ...counted, [l.channel]: v.replace(/[^\d]/g, '') })} />
        ))}
        <Input label="Ghi chú (nếu chênh lệch)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
        {submit.error && <Notice tone="danger">{submit.error.message}</Notice>}
        <Button title="Xác nhận gửi" variant="primary" loading={submit.loading} onPress={async () => {
          const r = await submit.mutate({ shiftId: shift!.id, counted, note: note || undefined }).catch(() => null);
          if (r) setOpen(false);
        }} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 21 · Kho & giá thành ─────────
export function InventoryScreen() {
  const data = useQuery('modules.inventory');
  const [open, setOpen] = useState(false);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={d.recipe ? <Button title="Xem công thức" variant="primary" onPress={() => setOpen(true)} /> : undefined}>
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard title="Kho nguyên liệu" subtitle="Định mức và hao hụt" rows={d.items} render={(r) => <Row key={r.id} title={r.name} subtitle={`${r.onHand} ${r.unit} · ${r.value}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={`Công thức · ${d.recipe?.name ?? ''}`}>
        {d.recipe?.lines.map((l) => <Row key={l.itemId} title={l.name} subtitle={l.quantity} right={<Text style={T.body}>{l.costLabel}</Text>} />)}
        {d.recipe && <KV rows={[{ label: 'Giá thành', value: d.recipe.total }, { label: 'Giá bán', value: d.recipe.price }, { label: 'Biên lợi nhuận gộp', value: d.recipe.margin }]} />}
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
    <Screen footer={d.canWrite ? <Button title="Tạo đơn mua" variant="primary" icon={<Plus size={18} color="#fff" />} onPress={() => setOpen(true)} /> : undefined}>
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard title="Nhà cung cấp & hạn thanh toán" rows={d.items} render={(r) => <Row key={r.id} title={r.label} subtitle={`Hạn ${r.dueDate} · ${r.outstanding}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Tạo đơn mua">
        <Input label="Nhà cung cấp" value={f.supplier} onChangeText={(v) => setF({ ...f, supplier: v })} autoCapitalize="words" />
        <Input label="Giá trị (đ)" keyboardType="number-pad" value={f.amount} onChangeText={(v) => setF({ ...f, amount: v.replace(/[^\d]/g, '') })} />
        <Input label="Hạn thanh toán (YYYY-MM-DD)" value={f.dueDate} onChangeText={(v) => setF({ ...f, dueDate: v })} placeholder="2026-11-15" />
        <Input label="Mục đích" value={f.purpose} onChangeText={(v) => setF({ ...f, purpose: v })} autoCapitalize="sentences" />
        {create.error && <Notice tone="danger">{create.error.message}</Notice>}
        <Button title="Tạo & gửi duyệt" variant="primary" loading={create.loading} onPress={async () => {
          const r = await create.mutate(f).catch(() => null);
          if (r) {
            setOpen(false);
            navigation.navigate('Approval', { id: r.approvalId });
          }
        }} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 23 · Sổ sách & thuế ─────────
export function BooksScreen() {
  const data = useQuery('modules.booksTax');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={<Button title="Rà soát trước khi xuất" variant="primary" onPress={() => void Share.share({ title: d.export.filename, message: d.export.csv.slice(0, 50_000) })} />}>
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard title={d.title} rows={d.items} render={(r) => <Row key={r.label} title={r.label} subtitle={`${r.period} · ${r.action}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
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
    <Screen footer={d.canWrite ? <Button title="Thêm khách hàng" variant="primary" onPress={() => setOpen(true)} /> : undefined}>
      <KpiGrid items={d.kpis} />
      <ListCard rows={d.items} render={(r) => <Row key={r.id} title={r.name} subtitle={`${r.scope} · ${r.completion} · hạn ${r.closeDue}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm khách hàng ủy quyền">
        <Input label="Tên khách hàng" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoCapitalize="words" />
        <Input label="Phạm vi" value={f.scope} onChangeText={(v) => setF({ ...f, scope: v })} />
        <Input label="Hạn chốt (YYYY-MM-DD)" value={f.closeDue} onChangeText={(v) => setF({ ...f, closeDue: v })} />
        {add.error && <Notice tone="danger">{add.error.message}</Notice>}
        <Button title="Thêm" variant="primary" loading={add.loading} onPress={async () => (await add.mutate(f).catch(() => null)) && setOpen(false)} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 25 · Bán hàng & thu nợ ─────────
export function SalesScreen() {
  const data = useQuery('modules.sales');
  const create = useMutation('modules.createDeal', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customer: '', value: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={d.canWrite ? <Button title="Tạo cơ hội" variant="primary" onPress={() => setOpen(true)} /> : undefined}>
      <KpiGrid items={d.kpis as Kpis} />
      <ListCard title="Chuỗi bán hàng & thu nợ" rows={d.items} render={(r) => <Row key={r.id} title={r.label} subtitle={`${r.stage} · ${r.value}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
      <Sheet visible={open} onClose={() => setOpen(false)} title="Tạo cơ hội bán hàng">
        <Input label="Khách hàng" value={f.customer} onChangeText={(v) => setF({ ...f, customer: v })} autoCapitalize="words" />
        <Input label="Giá trị dự kiến (đ)" keyboardType="number-pad" value={f.value} onChangeText={(v) => setF({ ...f, value: v.replace(/[^\d]/g, '') })} />
        {create.error && <Notice tone="danger">{create.error.message}</Notice>}
        <Button title="Tạo cơ hội" variant="primary" loading={create.loading} onPress={async () => (await create.mutate(f).catch(() => null)) && setOpen(false)} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 26 · Dự án & công việc ─────────
export function ProjectsScreen() {
  const data = useQuery('modules.projects');
  const add = useMutation('modules.addWbsTask', { silent: true });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', owner: '' });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={d.canWrite ? <Button title="Thêm công việc" variant="primary" onPress={() => setOpen(true)} /> : undefined}>
      <KpiGrid items={d.kpis as Kpis} />
      {d.project && <ListCard title={d.project.title} subtitle={d.project.subtitle} rows={d.project.tasks} render={(t) => <Row key={t.code} title={t.label} subtitle={`${t.owner} · ${t.progressLabel} · phụ thuộc ${t.dependsOn}`} right={<Chip tone={t.tone}>{t.statusLabel}</Chip>} />} />}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Thêm công việc WBS">
        <Input label="Tên công việc" value={f.name} onChangeText={(v) => setF({ ...f, name: v })} autoCapitalize="sentences" />
        <Input label="Phụ trách" value={f.owner} onChangeText={(v) => setF({ ...f, owner: v })} autoCapitalize="words" />
        {add.error && <Notice tone="danger">{add.error.message}</Notice>}
        <Button title="Thêm" variant="primary" loading={add.loading} onPress={async () => (await add.mutate({ projectId: d.project!.id, name: f.name, owner: f.owner }).catch(() => null)) && setOpen(false)} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 27 · Phân tích tài chính ─────────
export function FinanceScreen({ navigation }: ScreenProps<'Finance'>) {
  const data = useQuery('finance.appraisal', {});
  const recalc = useMutation('finance.recalculate', { silent: true });
  const [f, setF] = useState<{ investment: string; annualCashflow: string; years: string; rate: string; debt: string } | null>(null);
  useEffect(() => {
    if (data.data && !f) {
      const a = data.data.assumptions;
      setF({ investment: a.investment, annualCashflow: a.annualCashflow, years: String(a.years), rate: a.discountRatePct, debt: a.annualDebtService });
    }
  }, [data.data, f]);
  if (!data.data || !f) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const r = data.data.result;
  return (
    <Screen footer={<Button title="Tính lại kịch bản" variant="primary" loading={recalc.loading} disabled={!data.data.canRun} onPress={async () => {
      await recalc.mutate({ projectId: data.data!.project.id, assumptions: { investment: f.investment, annualCashflow: f.annualCashflow, years: Number(f.years), discountRate: String(Number(f.rate.replace(',', '.')) / 100), annualDebtService: f.debt } }).catch(() => null);
    }} />}>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
        <View style={{ flex: 1 }}><Kpi label="NPV" value={r.npvLabel} note={r.npvNote} highlight /></View>
        <View style={{ flex: 1 }}><Kpi label="IRR" value={r.irrLabel} note="Suất chiết khấu" /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1 }}><Kpi label="Hoàn vốn" value={r.paybackLabel} /></View>
        <View style={{ flex: 1 }}><Kpi label="DSCR" value={r.dscrLabel} /></View>
      </View>
      <Card title="Giả định đầu vào" subtitle={data.data.project.name}>
        <Input label="Đầu tư ban đầu · triệu đ" keyboardType="number-pad" value={f.investment} onChangeText={(v) => setF({ ...f, investment: v.replace(/[^\d]/g, '') })} />
        <Input label="Dòng tiền thuần / năm · triệu đ" keyboardType="number-pad" value={f.annualCashflow} onChangeText={(v) => setF({ ...f, annualCashflow: v.replace(/[^\d-]/g, '') })} />
        <Input label="Thời gian phân tích · năm" keyboardType="number-pad" value={f.years} onChangeText={(v) => setF({ ...f, years: v.replace(/[^\d]/g, '') })} />
        <Input label="Suất chiết khấu · %" keyboardType="decimal-pad" value={f.rate} onChangeText={(v) => setF({ ...f, rate: v })} />
        <Input label="Trả nợ / năm · triệu đ" keyboardType="number-pad" value={f.debt} onChangeText={(v) => setF({ ...f, debt: v.replace(/[^\d]/g, '') })} />
        {recalc.error && <Notice tone="danger">{recalc.error.message}</Notice>}
      </Card>
      <Text style={T.small}>{r.footnote}</Text>
      <Gap />
      <Button title="So sánh kịch bản" onPress={() => navigation.navigate('Scenarios')} />
    </Screen>
  );
}

// ───────── 28 · So sánh kịch bản ─────────
export function ScenariosScreen() {
  const data = useQuery('finance.scenarios', {});
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  return (
    <Screen>
      {data.data.scenarios.map((s) => (
        <Card key={s.name} title={s.name} right={s.isBase ? <Chip tone="success">Cơ sở</Chip> : undefined}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, fontFamily: font }}>{s.annualCashflowLabel}</Text>
          <KV rows={[{ label: 'NPV @ 10%', value: s.npvLabel }, { label: 'IRR', value: s.irrLabel }, { label: 'Hoàn vốn', value: s.paybackLabel }]} />
        </Card>
      ))}
      <Card title="Độ nhạy của NPV">
        <Text style={[T.muted, { lineHeight: 20 }]}>{data.data.sensitivity}</Text>
      </Card>
    </Screen>
  );
}

// ───────── 29 · Tài sản & đo lường ─────────
export function AssetsScreen() {
  const data = useQuery('modules.assets');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  return (
    <Screen>
      <KpiGrid items={data.data.kpis as Kpis} />
      <ListCard title={data.data.title} rows={data.data.items} render={(r) => <Row key={r.id} title={r.name} subtitle={`${r.baseline}${r.period ? ' · ' + r.period : ''}`} right={<Chip tone={r.tone}>{r.result}</Chip>} />} />
    </Screen>
  );
}

// ───────── 30 · Hồ sơ logistics ─────────
export function LogisticsScreen({ navigation }: ScreenProps<'Logistics'>) {
  const data = useQuery('modules.logistics');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const s = data.data.shipment;
  if (!s) return <Screen><Text style={T.muted}>Chưa có lô hàng.</Text></Screen>;
  return (
    <Screen footer={<Button title="Xem tài chính lô hàng" variant="primary" onPress={() => navigation.navigate('LogisticsFinance')} />}>
      <Card title={s.title} subtitle={s.subtitle} right={<Chip tone="warning">{s.statusLabel}</Chip>}>
        <Steps items={s.events.map((e) => ({ title: e.title, sub: `${e.detail} · ${e.atLabel}`, done: e.done }))} />
      </Card>
      <ListCard title="Chứng từ lô hàng" rows={s.documents} render={(d) => <Row key={d.name} icon={<FileText size={18} color={C.action} />} title={d.name} subtitle={d.status} />} />
      <Card title="Hết thời gian miễn phí">
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.text, fontFamily: font }}>{s.freeTimeEnd}</Text>
        <Text style={[T.small, { marginTop: 6 }]}>{s.freeTimeNote}</Text>
      </Card>
    </Screen>
  );
}

// ───────── 31 · Tài chính logistics ─────────
export function LogisticsFinanceScreen() {
  const data = useQuery('modules.logisticsFinance');
  const confirm = useMutation('modules.confirmAllocation');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const s = data.data.shipment;
  if (!s) return <Screen><Text style={T.muted}>Chưa có lô hàng.</Text></Screen>;
  return (
    <Screen footer={!s.allocationConfirmed && data.data.canWrite ? <Button title="Xác nhận phân bổ" variant="primary" loading={confirm.loading} onPress={() => void confirm.mutate({ shipmentId: s.id })} /> : undefined}>
      <KpiGrid items={s.kpis as Kpis} />
      <ListCard title="Chi phí cấu thành" subtitle={s.tariff} rows={s.costs} render={(c) => <Row key={c.name} icon={<Truck size={18} color={C.action} />} title={c.name} subtitle={c.basis} right={<Text style={[T.body, T.strong]}>{c.amountLabel}</Text>} />} />
      <ListCard title="Phân bổ giá vốn" subtitle="Theo trọng lượng" rows={s.allocation} render={(a) => <Row key={a.item} title={a.item} subtitle={a.share} right={<Text style={[T.body, T.strong]}>{a.amount}</Text>} />} />
      {s.allocationConfirmed && <Notice tone="success">Đã xác nhận phân bổ giá vốn.</Notice>}
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
      <ListCard title={data.data.title} subtitle="Dữ liệu phục vụ hợp nhất · chưa kiểm toán" rows={data.data.items} render={(r) => <Row key={r.id} title={`${r.name} · ${r.code}`} subtitle={`Chứng từ ${r.docs} · ${r.ic}`} right={<Chip tone={r.tone}>{r.status}</Chip>} />} />
    </Screen>
  );
}

// ───────── 33 · Đối soát nội bộ ─────────
export function IntercompanyScreen() {
  const data = useQuery('modules.intercompany');
  const request = useMutation('modules.requestIntercompanyDocs');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const p = data.data.pair;
  if (!p) return <Screen><Text style={T.muted}>Chưa có cặp giao dịch nội bộ.</Text></Screen>;
  return (
    <Screen footer={p.status !== 'REQUESTED' && data.data.canWrite ? <Button title="Gửi yêu cầu bổ sung" variant="primary" loading={request.loading} onPress={() => void request.mutate({ pairId: p.id })} /> : undefined}>
      <KpiGrid items={p.kpis as Kpis} />
      <Card title="Đối chiếu hai phía" subtitle={`Mã tham chiếu chung: ${p.reference}`}>
        {p.rows.map((r) => (
          <View key={r.label} style={{ paddingVertical: 8 }}>
            <Text style={[T.body, T.strong]}>{r.label}</Text>
            <KV rows={[{ label: p.sideAName, value: r.a }, { label: p.sideBName, value: r.b }]} />
            <Gap h={6} />
            <Chip tone={r.tone}>{r.result}</Chip>
          </View>
        ))}
      </Card>
      <Card title="Việc tiếp theo">
        <Text style={[T.muted, { lineHeight: 20 }]}>{p.nextAction}</Text>
      </Card>
      {p.status === 'REQUESTED' && <Notice tone="success">{`Đã gửi yêu cầu bổ sung cho ${p.sideBName}.`}</Notice>}
    </Screen>
  );
}

// ───────── 34 · Thành viên & phân quyền ─────────
export function MembersScreen() {
  const data = useQuery('org.listMembers');
  const invite = useMutation('org.inviteMember', { silent: true });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string | null>(null);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  return (
    <Screen footer={data.data.canManage ? <Button title="Mời thành viên" variant="primary" onPress={() => setOpen(true)} /> : undefined}>
      <ListCard title="Vai trò theo tổ chức và đơn vị" subtitle="Quyền lập hồ sơ, phê duyệt và chốt kỳ được cấp riêng" rows={data.data.members} render={(m) => <Row key={m.id} title={m.name} subtitle={`${m.roleLabel} · ${m.scopeLabel} · hạn mức ${m.limitLabel}`} right={<Chip tone={m.status === 'ACTIVE' ? 'success' : 'info'}>{m.statusLabel}</Chip>} />} />
      <Sheet visible={open} onClose={() => { setOpen(false); setCode(null); }} title="Mời thành viên (vai trò Kế toán)">
        {code ? <Notice tone="success">{`Mã mời: ${code}. Người được mời đăng ký bằng email ${email} rồi nhập mã.`}</Notice> : (
          <>
            <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" error={invite.error?.message} />
            <Button title="Gửi lời mời" variant="primary" loading={invite.loading} onPress={async () => {
              const r = await invite.mutate({ email, role: 'ACCOUNTANT' }).catch(() => null);
              if (r) setCode(r.code);
            }} />
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
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen>
      <Card title="Thông tin tổ chức">
        <KV rows={[{ label: 'Tên', value: d.tenant.name }, { label: 'Loại hình', value: d.tenant.orgType }, { label: 'Mã số thuế', value: d.tenant.taxCode ?? '—' }, { label: 'Chế độ kế toán', value: d.tenant.settings.accountingRegime }, { label: 'Kỳ hiện tại', value: d.tenant.settings.currentPeriod }]} />
      </Card>
      <ListCard
        title="Kết nối dữ liệu"
        rows={d.integrations}
        render={(i) => (
          <Row key={i.id} title={i.name} subtitle={`${i.description} · ${i.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối'}`} right={d.canManage ? <Button small title={i.status === 'CONNECTED' ? 'Ngắt' : 'Kết nối'} onPress={() => void setInt.mutate({ integrationId: i.id, connect: i.status !== 'CONNECTED' })} /> : <Chip tone={i.status === 'CONNECTED' ? 'success' : 'neutral'}>{i.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa'}</Chip>} />
        )}
      />
      <Card title="Quản trị">
        <Row title="Thành viên & phân quyền" chevron onPress={() => navigation.navigate('Members')} />
        <Row title="Bảo mật tài khoản" chevron onPress={() => navigation.navigate('Security')} />
        <Row title="Thông báo" chevron onPress={() => navigation.navigate('Notifications')} />
      </Card>
      <ListCard title="Nhật ký hoạt động" rows={d.audit.slice(0, 15)} render={(a, i) => <Row key={i} title={`${a.actor} · ${a.action}`} subtitle={`${a.target} · ${new Date(Date.parse(a.at) + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16)}`} />} />
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
  const change = useMutation('auth.changePassword', { silent: true });
  const [totp, setTotp] = useState<OpResult<'auth.setupTotp'> | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  return (
    <Screen>
      <Card title="Xác thực nhiều lớp (TOTP)">
        {me?.user.mfaEnabled ? (
          <Notice tone="success">Đã bật xác thực nhiều lớp.</Notice>
        ) : totp ? (
          <>
            <Text style={T.small}>Thêm khóa này vào ứng dụng xác thực:</Text>
            <Text selectable style={{ fontFamily: 'monospace', backgroundColor: C.soft, padding: 10, borderRadius: 8, marginVertical: 8 }}>{totp.secret}</Text>
            <Button small title="Mở ứng dụng xác thực" onPress={() => void Linking.openURL(totp.otpauthUrl).catch(() => Alert.alert('Không mở được', 'Hãy nhập khóa thủ công.'))} />
            <Gap />
            <OtpInput value={code} onChange={setCode} />
            {enable.error && <Notice tone="danger">{enable.error.message}</Notice>}
            <Gap />
            <Button title="Bật TOTP" variant="primary" disabled={code.length !== 6} loading={enable.loading} onPress={async () => {
              if (await enable.mutate({ code }).catch(() => null)) {
                await refresh();
                setTotp(null);
              }
            }} />
          </>
        ) : (
          <Button title="Thiết lập TOTP" variant="primary" icon={<KeyRound size={18} color="#fff" />} loading={setup.loading} onPress={async () => setTotp(await setup.mutate())} />
        )}
      </Card>
      <Card title="Đổi mật khẩu">
        <Input label="Mật khẩu hiện tại" secure value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} />
        <Input label="Mật khẩu mới" secure value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} hint="Ít nhất 12 ký tự." />
        {change.error && <Notice tone="danger">{change.error.message}</Notice>}
        <Button title="Cập nhật mật khẩu" disabled={!pw.current || pw.next.length < 12} loading={change.loading} onPress={async () => {
          if (await change.mutate({ currentPassword: pw.current, newPassword: pw.next }).catch(() => null)) {
            setPw({ current: '', next: '' });
            Alert.alert('Bảo mật', 'Đã đổi mật khẩu');
          }
        }} />
      </Card>
      <ListCard
        title="Phiên đăng nhập"
        rows={sessions.data ?? []}
        render={(s) => (
          <Row key={s.id} icon={s.aal === 2 ? <ShieldCheck size={18} color={C.action} /> : <CircleCheck size={18} color={C.action} />} title={`${s.channel === 'mobile' ? 'Ứng dụng di động' : 'Web'}${s.current ? ' · phiên này' : ''}`} subtitle={s.userAgent.slice(0, 50)} right={s.current ? <Button small title="Đăng xuất" onPress={() => void signOut()} /> : <Button small title="Thu hồi" onPress={() => void revoke.mutate({ sessionId: s.id })} />} />
        )}
      />
      <Hero label="Tài khoản" value={me?.user.fullName ?? ''} note={me?.user.email ?? me?.user.phone ?? ''} />
    </Screen>
  );
}
