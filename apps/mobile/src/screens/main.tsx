import { useEffect, useState } from 'react';
import { Alert, Pressable, Share, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import {
  Bell, BookOpen, Building2, Camera, ChartColumn, CircleCheck, ClipboardCheck, FileSearch, FileText, Files, FolderKanban, GitCompareArrows, Grid2x2, Handshake,
  Landmark, Lock, LogOut, Network, Package, Plug, ScanLine, Send, Settings, ShieldCheck, Sparkles, Store, Truck, Upload, Users, Zap,
} from 'lucide-react-native';
import { D, formatDate, formatSignedVnd, formatVnd, formatShortDateTime } from '@argolet/core';
import { ApiError, useBackend, useMutation, useQuery } from '@argolet/client';
import { useSession } from '../session';
import { C, font } from '../theme';
import { Button, Card, Chip, ErrorView, Gap, Hero, Input, KV, KpiGrid, Loading, Notice, OtpInput, Row, Screen, Sheet, Steps, T, Title } from '../ui';
import type { ScreenProps } from '../App';

const toneOf = (s: string) => (s === 'VALIDATED' ? 'success' : s === 'NEEDS_REVIEW' || s === 'NEEDS_RECON' ? 'warning' : 'neutral');

/** Navigate from a tab screen to a root stack screen. */
type Nav = { navigate: (name: string, params?: object) => void };
const asNav = (n: unknown) => n as Nav;

async function uriToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Không đọc được tệp'));
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.readAsDataURL(blob);
  });
}

// ───────── 09 · Tổng quan ─────────
function MiniChart({ series }: { series: { label: string; inflow: number; outflow: number }[] }) {
  const W = 320;
  const H = 120;
  const max = Math.max(10, ...series.flatMap((s) => [s.inflow, s.outflow]));
  const top = Math.ceil(max / 10) * 10;
  const x = (i: number) => 24 + (i * (W - 60)) / Math.max(1, series.length - 1);
  const y = (v: number) => 8 + (H - 30) * (1 - v / top);
  const path = (k: 'inflow' | 'outflow') => series.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s[k])}`).join(' ');
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} accessibilityLabel="Biểu đồ dòng tiền 7 ngày">
      {[0, top / 2, top].map((t) => (
        <Line key={t} x1={24} x2={W - 36} y1={y(t)} y2={y(t)} stroke="#E7EDF0" strokeWidth={1} />
      ))}
      <Path d={path('inflow')} stroke={C.chartIn} strokeWidth={2} fill="none" />
      <Path d={path('outflow')} stroke={C.chartOut} strokeWidth={2} fill="none" />
      {series.map((s, i) => (
        <Circle key={`i${i}`} cx={x(i)} cy={y(s.inflow)} r={3.5} fill={C.chartIn} stroke="#fff" strokeWidth={1.5} />
      ))}
      {series.map((s, i) => (
        <Circle key={`o${i}`} cx={x(i)} cy={y(s.outflow)} r={3.5} fill={C.chartOut} stroke="#fff" strokeWidth={1.5} />
      ))}
      {[0, Math.floor(series.length / 2), series.length - 1].map((i) => (
        <SvgText key={i} x={x(i)} y={H - 4} fontSize={10} fill={C.muted} textAnchor="middle" fontFamily={font}>
          {series[i]?.label}
        </SvgText>
      ))}
    </Svg>
  );
}

export function OverviewScreen({ navigation }: { navigation: unknown }) {
  const nav = asNav(navigation);
  const q = useQuery('dashboard.overview');
  if (!q.data) return q.error ? <ErrorView error={q.error} onRetry={q.refetch} /> : <Loading />;
  const o = q.data;
  return (
    <Screen>
      <Title title="Tổng quan kinh doanh" subtitle={`${o.periodLabel} · VND`} />
      <Hero label="Dòng tiền thuần" value={o.netLabel} note={o.netNote} />
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
        {[
          { icon: Camera, label: 'Chụp chứng từ', to: 'Capture' },
          { icon: GitCompareArrows, label: 'Đối soát', to: 'Reconcile' },
          { icon: CircleCheck, label: 'Phê duyệt', to: 'Inbox' },
        ].map((a) => (
          <Pressable key={a.label} style={{ flex: 1, alignItems: 'center', gap: 8 }} onPress={() => nav.navigate(a.to === 'Inbox' ? 'Main' : a.to, a.to === 'Inbox' ? { screen: 'Inbox' } : undefined)} accessibilityRole="button" accessibilityLabel={a.label}>
            <View style={{ width: 52, height: 40, borderRadius: 12, backgroundColor: C.successBg, alignItems: 'center', justifyContent: 'center' }}>
              <a.icon size={20} color={C.action} />
            </View>
            <Text style={[T.small, { textAlign: 'center' }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <Card title="Dòng tiền 7 ngày" subtitle={o.seriesLabel} right={<Text style={T.small}><Text style={{ color: C.chartIn }}>●</Text> Thu  <Text style={{ color: C.chartOut }}>●</Text> Chi</Text>}>
        <MiniChart series={o.series} />
      </Card>
      <Card title="Cần xử lý" right={<Chip tone="warning">{`${o.tasks.filter((t) => t.count > 0).length} việc`}</Chip>}>
        {o.tasks.map((t, i) => {
          const Icon = [CircleCheck, GitCompareArrows, FileSearch][i] ?? CircleCheck;
          return <Row key={t.key} icon={<Icon size={18} color={C.action} />} title={t.title} subtitle={t.detail} chevron onPress={() => nav.navigate(t.key === 'approvals' ? 'Main' : t.key === 'recon' ? 'Reconcile' : 'Main', t.key === 'approvals' ? { screen: 'Inbox' } : t.key === 'documents' ? { screen: 'Documents' } : undefined)} />;
        })}
      </Card>
      <Card title="Doanh thu theo kênh">
        {o.channels.map((c) => (
          <View key={c.key} style={{ paddingVertical: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[T.body, T.strong]}>{c.label}</Text>
              <Text style={[T.body, T.strong, { color: C.brand }]}>{c.amountLabel}</Text>
            </View>
            <View style={{ height: 10, backgroundColor: C.soft, borderRadius: 4, marginVertical: 8, overflow: 'hidden' }}>
              <View style={{ height: 10, width: `${Math.min(100, (Number(c.amount) / 250_000_000) * 100)}%`, backgroundColor: c.key === 'counter' ? C.action : C.info }} />
            </View>
            <Chip tone={c.tone}>{c.status}</Chip>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

// ───────── 10 · Việc cần xử lý ─────────
export function InboxScreen({ navigation }: { navigation: unknown }) {
  const nav = asNav(navigation);
  const [q, setQ] = useState('');
  const data = useQuery('approvals.inbox', { q });
  if (!data.data) return data.error ? <ErrorView error={data.error} onRetry={data.refetch} /> : <Loading />;
  const routeOf = (r: { kind: string; id: string }) =>
    r.kind === 'APPROVAL' ? (['Approval', { id: r.id }] as const) : r.kind === 'MATCH' ? (['ReconDetail', { id: r.id }] as const) : r.kind === 'DOCUMENT' ? (['Review', { id: r.id }] as const) : (['Close', undefined] as const);
  return (
    <Screen>
      <Title title="Việc cần xử lý" subtitle={`${data.data.kpis.toApprove} cần duyệt · ${data.data.kpis.toSupplement} cần bổ sung · ${data.data.kpis.dueToday} đến hạn hôm nay`} />
      <TextInput value={q} onChangeText={setQ} placeholder="Tìm kiếm trong danh sách" placeholderTextColor="#8EA2AE" style={{ height: 44, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, marginBottom: 14, fontFamily: font }} accessibilityLabel="Tìm kiếm" />
      {data.data.items.length === 0 && <Notice tone="success">Không còn việc cần xử lý.</Notice>}
      {data.data.items.map((r) => {
        const [to, params] = routeOf(r);
        return (
          <Card key={`${r.kind}:${r.id}`} style={{ paddingVertical: 4 }}>
            <Row
              icon={r.kind === 'APPROVAL' ? <CircleCheck size={18} color={C.action} /> : r.kind === 'MATCH' ? <GitCompareArrows size={18} color={C.action} /> : r.kind === 'DOCUMENT' ? <FileText size={18} color={C.action} /> : <Lock size={18} color={C.action} />}
              title={r.title}
              subtitle={`${r.value} · ${r.sender} · ${r.dueLabel}`}
              right={<Chip tone={r.tone}>{r.status}</Chip>}
              onPress={() => nav.navigate(to, params)}
            />
          </Card>
        );
      })}
    </Screen>
  );
}

// ───────── 11 · Chứng từ ─────────
export function DocumentsScreen({ navigation }: { navigation: unknown }) {
  const nav = asNav(navigation);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'review' | 'done'>('');
  const [limit, setLimit] = useState(20);
  const data = useQuery('documents.list', { q, status: status || undefined, limit });
  if (!data.data) return data.error ? <ErrorView error={data.error} onRetry={data.refetch} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={d.canCreate ? <Button title="Thêm chứng từ" variant="primary" onPress={() => nav.navigate('Capture')} /> : undefined}>
      <Title title="Chứng từ" subtitle={`${d.kpis.total} chứng từ · ${d.kpis.needsReview} cần kiểm tra · ${d.kpis.validated} đã xác nhận`} />
      <TextInput value={q} onChangeText={setQ} placeholder="Tìm kiếm trong danh sách" placeholderTextColor="#8EA2AE" style={{ height: 44, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, marginBottom: 10, fontFamily: font }} accessibilityLabel="Tìm kiếm chứng từ" />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {(
          [
            ['review', 'Cần xử lý'],
            ['done', 'Hoàn tất'],
            ['', 'Tất cả'],
          ] as const
        ).map(([k, l]) => (
          <Pressable key={k} onPress={() => setStatus(k)} accessibilityRole="button" accessibilityState={{ selected: status === k }}>
            <Chip tone={status === k ? 'success' : 'neutral'}>{l}</Chip>
          </Pressable>
        ))}
      </View>
      {d.items.map((r) => (
        <Card key={r.id} style={{ paddingVertical: 4 }}>
          <Row icon={<FileText size={18} color={C.action} />} title={r.label} subtitle={`${r.amountLabel} · ${r.source} · ${r.dateLabel}`} right={<Chip tone={toneOf(r.status)}>{r.statusLabel}</Chip>} onPress={() => nav.navigate(r.status === 'VALIDATED' ? 'Evidence' : 'Review', { id: r.id })} />
        </Card>
      ))}
      {d.totalShown < d.totalMatching && <Button title="Xem thêm" onPress={() => setLimit((l) => l + 30)} />}
    </Screen>
  );
}

// ───────── Thêm (menu phân hệ) ─────────
export function MoreScreen({ navigation }: { navigation: unknown }) {
  const nav = asNav(navigation);
  const { ctx, signOut } = useSession();
  const { backend } = useBackend();
  const groups: { title: string; items: { icon: typeof Files; label: string; to: string }[] }[] = [
    { title: 'Nền tảng', items: [
      { icon: GitCompareArrows, label: 'Đối soát đa nguồn', to: 'Reconcile' },
      { icon: Upload, label: 'Nhập dữ liệu', to: 'Ingestion' },
      { icon: Lock, label: 'Chốt kỳ dữ liệu', to: 'Close' },
      { icon: ClipboardCheck, label: 'Bộ hồ sơ quyết định', to: 'DecisionPack' },
      { icon: Sparkles, label: 'Trợ lý ARGOLET', to: 'Assistant' },
      { icon: Bell, label: 'Thông báo', to: 'Notifications' },
    ] },
    { title: 'G1 · Vận hành', items: [
      { icon: Store, label: 'Chốt ca & chốt ngày', to: 'DailyClose' },
      { icon: Package, label: 'Kho & giá thành', to: 'Inventory' },
      { icon: Truck, label: 'Mua hàng & công nợ', to: 'Purchasing' },
      { icon: BookOpen, label: 'Sổ sách & thuế', to: 'Books' },
    ] },
    { title: 'G2 · Doanh nghiệp', items: [
      { icon: Handshake, label: 'Không gian khách hàng', to: 'Clients' },
      { icon: ChartColumn, label: 'Bán hàng & thu nợ', to: 'Sales' },
    ] },
    { title: 'G3 · Dự án', items: [
      { icon: FolderKanban, label: 'Dự án & công việc', to: 'Projects' },
      { icon: ChartColumn, label: 'Phân tích tài chính', to: 'Finance' },
      { icon: Grid2x2, label: 'So sánh kịch bản', to: 'Scenarios' },
      { icon: Zap, label: 'Tài sản & đo lường', to: 'Assets' },
      { icon: Truck, label: 'Hồ sơ logistics', to: 'Logistics' },
      { icon: Landmark, label: 'Tài chính logistics', to: 'LogisticsFinance' },
    ] },
    { title: 'G4 · Tập đoàn', items: [
      { icon: Network, label: 'Điều hành tập đoàn', to: 'Group' },
      { icon: GitCompareArrows, label: 'Đối soát nội bộ', to: 'Intercompany' },
    ] },
    { title: 'Quản trị', items: [
      { icon: Users, label: 'Thành viên & phân quyền', to: 'Members' },
      { icon: Settings, label: 'Cài đặt & tích hợp', to: 'Settings' },
      { icon: Plug, label: 'Kết nối dữ liệu', to: 'Connect' },
      { icon: ShieldCheck, label: 'Bảo mật tài khoản', to: 'Security' },
      { icon: Building2, label: 'Đổi không gian làm việc', to: 'Workspaces' },
    ] },
  ];
  return (
    <Screen>
      <Title title="Thêm" subtitle={`${ctx?.member.displayName ?? ''} · ${ctx?.member.title ?? ''}`} />
      {groups.map((g) => (
        <Card key={g.title} title={g.title}>
          {g.items.map((it) => (
            <Row key={it.to} icon={<it.icon size={18} color={C.action} />} title={it.label} chevron onPress={() => nav.navigate(it.to)} />
          ))}
        </Card>
      ))}
      <Button title="Đăng xuất" icon={<LogOut size={18} color={C.brand} />} onPress={() => void signOut()} />
      <Text style={[T.small, { textAlign: 'center', marginTop: 14 }]}>{backend.info.label}</Text>
    </Screen>
  );
}

// ───────── 12 · Tiếp nhận chứng từ ─────────
export function CaptureScreen({ navigation }: ScreenProps<'Capture'>) {
  const { ctx } = useSession();
  const sites = ctx?.entities.filter((e) => e.kind === 'SITE') ?? [];
  const [entityId, setEntityId] = useState(ctx?.scope.entityId !== '*' ? ctx?.scope.entityId ?? '' : sites[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [files, setFiles] = useState<{ name: string; mime: string; base64: string }[]>([]);
  const intake = useMutation('documents.intake', { silent: true });
  const [result, setResult] = useState<Awaited<ReturnType<typeof intake.mutate>> | null>(null);
  const takePhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Cần quyền truy cập', camera ? 'Cho phép camera để chụp chứng từ.' : 'Cho phép truy cập ảnh để chọn chứng từ.');
      return;
    }
    const r = camera ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.7, allowsMultipleSelection: true });
    if (r.canceled) return;
    setFiles((f) => [...f, ...r.assets.map((a, i) => ({ name: a.fileName ?? `anh-chung-tu-${Date.now()}-${i}.jpg`, mime: a.mimeType ?? 'image/jpeg', base64: a.base64 ?? '' }))]);
  };
  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (r.canceled) return;
    const next = await Promise.all(r.assets.map(async (a) => ({ name: a.name, mime: a.mimeType ?? '', base64: await uriToBase64(a.uri) })));
    setFiles((f) => [...f, ...next]);
  };
  return (
    <Screen footer={<Button title={`Tiếp nhận ${files.length ? files.length + ' tệp' : ''}`} variant="primary" disabled={!files.length} loading={intake.loading} onPress={async () => {
      try {
        const r = await intake.mutate({ entityId, location, files: files.map((f) => ({ name: f.name, mime: f.mime, contentBase64: f.base64 })) });
        setResult(r);
        setFiles([]);
      } catch {
        /* inline */
      }
    }} />}>
      <Title title="Tiếp nhận chứng từ" subtitle="Chụp ảnh, tải tệp hoặc tiếp nhận theo lô." />
      <Card>
        <View style={{ alignItems: 'center', paddingVertical: 18, backgroundColor: C.brand, borderRadius: 12, marginBottom: 14 }}>
          <ScanLine size={36} color={C.heroStrong} />
          <Text style={{ color: '#fff', marginTop: 10, fontFamily: font }}>Đặt chứng từ vào trong khung</Text>
        </View>
        <Button title="Chụp & kiểm tra ảnh" variant="primary" icon={<Camera size={18} color="#fff" />} onPress={() => void takePhoto(true)} />
        <Gap />
        <Button title="Chọn từ thư viện / tệp" icon={<Files size={18} color={C.brand} />} onPress={() => void pickFile()} />
        <Gap h={8} />
        <Button title="Chọn ảnh có sẵn" small onPress={() => void takePhoto(false)} />
      </Card>
      {files.map((f, i) => (
        <Row key={i} icon={<FileText size={18} color={C.action} />} title={f.name} subtitle={`${Math.max(1, Math.round((f.base64.length * 0.75) / 1024))} KB`} right={<Pressable onPress={() => setFiles((s) => s.filter((_, j) => j !== i))}><Text style={{ color: C.action }}>Bỏ</Text></Pressable>} />
      ))}
      <Card title="Cơ sở nhận dữ liệu">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {sites.map((s) => (
            <Pressable key={s.id} onPress={() => setEntityId(s.id)} accessibilityRole="button" accessibilityState={{ selected: entityId === s.id }}>
              <Chip tone={entityId === s.id ? 'success' : 'neutral'}>{s.name}</Chip>
            </Pressable>
          ))}
        </View>
        <Input label="Mã lô / vị trí bản giấy" value={location} onChangeText={setLocation} placeholder="LO-20261031 · Kệ A-02" />
      </Card>
      {intake.error && <Notice tone="danger">{intake.error.message}</Notice>}
      {result && (
        <Card title={`Lô ${result.code}`} subtitle={`${result.normalized} sẵn sàng · ${result.needsReview} cần kiểm tra · ${result.duplicates} trùng`}>
          {result.files.map((f, i) => (
            <Row key={i} title={f.duplicate ? f.filename : `${f.code} · ${f.filename}`} subtitle={f.duplicate ? 'Trùng dấu vân tay' : f.status === 'NEEDS_REVIEW' ? 'Cần kiểm tra trường dữ liệu' : 'Sẵn sàng xác nhận'} chevron={!f.duplicate} onPress={f.duplicate ? undefined : () => navigation.navigate('Review', { id: f.documentId })} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

// ───────── 13 · Kiểm tra chứng từ ─────────
export function ReviewScreen({ route, navigation }: ScreenProps<'Review'>) {
  const doc = useQuery('documents.get', { documentId: route.params.id });
  const save = useMutation('documents.saveDraft');
  const confirm = useMutation('documents.confirm', { silent: true });
  const [f, setF] = useState<{ supplier: string; documentNo: string; documentDate: string; total: string; taxCode?: string | undefined } | null>(null);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    if (doc.data && !f) {
      const x = doc.data.document.fields;
      setF({ ...x, documentDate: x.documentDate ? formatDate(x.documentDate) : '', total: x.total ? formatVnd(x.total) : '' });
    }
  }, [doc.data, f]);
  if (!doc.data || !f) return doc.error ? <ErrorView error={doc.error} /> : <Loading />;
  const d = doc.data.document;
  const plain = () => ({ ...f, total: f.total.replace(/[^\d]/g, '') });
  const issue = (k: string) => d.issues.find((i) => i.field === k && i.severity === 'error')?.message;
  const ro = d.status === 'VALIDATED' || !doc.data.canValidate;
  return (
    <Screen footer={d.status === 'VALIDATED' ? <Button title="Xem bằng chứng & lịch sử" onPress={() => navigation.navigate('Evidence', { id: d.id })} /> : (
      <>
        <Button title="Xác nhận chứng từ" variant="primary" loading={confirm.loading} disabled={ro} onPress={async () => {
          try {
            await confirm.mutate({ documentId: d.id, fields: plain(), acknowledgeWarnings: ack });
            navigation.replace('Evidence', { id: d.id });
          } catch (e) {
            if (e instanceof ApiError && e.details?.needsAcknowledge) setAck(true);
          }
        }} />
      </>
    )}>
      {d.issues.length > 0 && <Chip tone="warning">{`Cần kiểm tra ${d.issues.length} trường`}</Chip>}
      <Gap />
      <Card style={{ backgroundColor: '#FCFBF7' }}>
        <Text style={[T.body, T.strong]}>{d.title.toUpperCase()}</Text>
        <Text style={[T.small, { marginTop: 4 }]}>{`${d.counterparty || '—'} · ${d.fields.documentNo || '—'}`}</Text>
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.brand, marginTop: 8, fontFamily: font }}>{formatVnd(d.amount || '0')}</Text>
        <Text style={[T.small, { marginTop: 6 }]}>{`${d.sourceLabel} · ${doc.data.artifact?.filename ?? ''}`}</Text>
      </Card>
      <Input label="Nhà cung cấp" value={f.supplier} onChangeText={(v) => setF({ ...f, supplier: v })} editable={!ro} error={issue('supplier')} autoCapitalize="words" />
      <Input label="Số chứng từ" value={f.documentNo} onChangeText={(v) => setF({ ...f, documentNo: v })} editable={!ro} error={issue('documentNo')} autoCapitalize="characters" />
      <Input label="Ngày chứng từ · cần kiểm tra" value={f.documentDate} onChangeText={(v) => setF({ ...f, documentDate: v })} editable={!ro} error={issue('documentDate')} placeholder="dd/mm/yyyy" />
      <Input label="Tổng thanh toán" value={f.total} onChangeText={(v) => setF({ ...f, total: v })} editable={!ro} error={issue('total')} keyboardType="number-pad" />
      {d.issues.filter((i) => i.severity === 'warning').map((i, k) => (
        <Notice key={k}>{i.message}</Notice>
      ))}
      {confirm.error && <Notice tone="danger">{confirm.error.message}{ack ? ' — chạm Xác nhận lần nữa để xác nhận cảnh báo.' : ''}</Notice>}
      {d.status !== 'VALIDATED' && <Button title="Lưu nháp" small loading={save.loading} onPress={() => void save.mutate({ documentId: d.id, fields: plain() }).catch(() => undefined)} />}
      {!doc.data.canValidate && d.status !== 'VALIDATED' && <Text style={[T.small, { marginTop: 10 }]}>Vai trò hiện tại chỉ lưu nháp; người có quyền kế toán sẽ xác nhận.</Text>}
    </Screen>
  );
}

// ───────── 14 · Đối soát ─────────
export function ReconcileScreen({ navigation }: ScreenProps<'Reconcile'>) {
  const [filter, setFilter] = useState<'' | 'review' | 'done'>('review');
  const data = useQuery('recon.summary', { filter: filter || undefined });
  const run = useMutation('recon.run');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  const first = d.items.find((i) => i.status === 'PROPOSED');
  return (
    <Screen footer={<Button title="Ghép nhiều–nhiều" variant="primary" disabled={!first} onPress={() => first && navigation.navigate('Match', { id: first.id })} />}>
      <Title title="Đối soát đa nguồn" subtitle={`${d.kpis.matched} đã khớp · ${d.kpis.toConfirm} cần xác nhận · ${d.kpis.discrepancies} chênh lệch`} />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        {(
          [
            ['review', 'Cần xử lý'],
            ['done', 'Hoàn tất'],
            ['', 'Tất cả'],
          ] as const
        ).map(([k, l]) => (
          <Pressable key={k} onPress={() => setFilter(k)} accessibilityRole="button">
            <Chip tone={filter === k ? 'success' : 'neutral'}>{l}</Chip>
          </Pressable>
        ))}
        {d.canRun && (
          <Pressable onPress={() => void run.mutate({}).then((r) => Alert.alert('Đối soát', r.groups ? `Đề xuất ${r.groups} nhóm mới` : 'Không có giao dịch mới để ghép'))} style={{ marginLeft: 'auto' }}>
            <Text style={{ color: C.action, fontWeight: '700' }}>Chạy đối soát</Text>
          </Pressable>
        )}
      </View>
      {d.items.map((r) => (
        <Card key={r.id} style={{ paddingVertical: 4 }}>
          <Row icon={<GitCompareArrows size={18} color={C.action} />} title={r.label} subtitle={`${r.statusLabel} · ${r.receivedLabel}`} right={<Chip tone={r.tone}>{r.source}</Chip>} onPress={() => navigation.navigate('ReconDetail', { id: r.id })} />
        </Card>
      ))}
    </Screen>
  );
}

function useConfirmGroup(id: string, digest?: string, residual?: string) {
  const confirm = useMutation('recon.confirm', { silent: true });
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const run = async () => {
    if (residual && !D(residual).isZero() && !note) return setNoteOpen(true);
    try {
      await confirm.mutate({ groupId: id, digest: digest ?? '', note: note || undefined });
      setNoteOpen(false);
      Alert.alert('Đối soát', 'Đã xác nhận kết quả đối soát');
    } catch (e) {
      Alert.alert('Không xác nhận được', e instanceof Error ? e.message : '');
    }
  };
  const sheet = (
    <Sheet visible={noteOpen} onClose={() => setNoteOpen(false)} title="Giải thích chênh lệch">
      <Input label="Nguyên nhân chênh lệch" value={note} onChangeText={setNote} multiline autoCapitalize="sentences" />
      <Button title="Xác nhận kèm giải thích" variant="primary" disabled={!note.trim()} loading={confirm.loading} onPress={run} />
      <Gap h={24} />
    </Sheet>
  );
  return { confirm, run, sheet };
}

// ───────── 15 · Chi tiết đối soát ─────────
export function ReconDetailScreen({ route, navigation }: ScreenProps<'ReconDetail'>) {
  const data = useQuery('recon.getGroup', { groupId: route.params.id });
  const c = useConfirmGroup(route.params.id, data.data?.group.digest, data.data?.group.residual);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const { group: g, orders, receipts } = data.data;
  return (
    <Screen footer={data.data.canConfirm ? <Button title="Xác nhận đối soát" variant="primary" loading={c.confirm.loading} onPress={c.run} /> : g.status === 'PROPOSED' ? <Button title="Mở ghép giao dịch" onPress={() => navigation.navigate('Match', { id: g.id })} /> : undefined}>
      <Text style={[T.small, { marginBottom: 8 }]}>{`${g.code} · ${g.statusLabel} · ${formatDate(orders[0]?.date ?? receipts[0]?.date ?? new Date().toISOString())}`}</Text>
      <Hero label="Tiền thực nhận" value={formatVnd(g.received)} note={`Tổng đơn ${formatVnd(g.gross)} − Phí ${formatVnd(D(g.fee).plus(g.refund).plus(g.discount))}`} />
      <Card title="Cấu thành khoản nhận">
        <KV rows={[{ label: `${orders.length} đơn hàng`, value: formatVnd(g.gross) }, { label: `Phí nền tảng · ${g.feeRule.split(' · ')[0]}`, value: formatSignedVnd(D(g.fee).neg()) }, { label: 'Hoàn tiền', value: formatVnd(g.refund) }, { label: 'Chênh lệch còn lại', value: formatVnd(g.residual) }]} />
      </Card>
      <Card title="Vì sao được gợi ý ghép?">
        <Text style={[T.muted, { lineHeight: 20 }]}>{g.basis.join('. ')}.</Text>
      </Card>
      <Card title="Phân bổ">
        {g.links.map((l, i) => (
          <Row key={i} title={`${orders.find((o) => o.id === l.orderId)?.code} → ${receipts.find((r) => r.id === l.txnId)?.code}`} right={<Text style={[T.body, T.strong]}>{formatVnd(l.amount)}</Text>} />
        ))}
      </Card>
      {g.status === 'PENDING_APPROVAL' && <Notice tone="info">Nhóm đang chờ phê duyệt trong hộp công việc.</Notice>}
      {c.sheet}
    </Screen>
  );
}

// ───────── 38 · Ghép giao dịch ─────────
export function MatchScreen({ route, navigation }: ScreenProps<'Match'>) {
  const { can } = useSession();
  const data = useQuery('recon.getGroup', { groupId: route.params.id });
  const submit = useMutation('recon.submitForApproval', { silent: true });
  const c = useConfirmGroup(route.params.id, data.data?.group.digest, data.data?.group.residual);
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const { group: g, orders, receipts } = data.data;
  const deductions = D(g.fee).plus(g.refund).plus(g.discount);
  return (
    <Screen footer={g.status === 'PROPOSED' && can('approval.request') ? <Button title="Gửi nhóm ghép xin duyệt" variant="primary" icon={<Send size={18} color="#fff" />} loading={submit.loading} onPress={async () => {
      try {
        await submit.mutate({ groupId: g.id });
        navigation.navigate('Main', { screen: 'Inbox' });
      } catch (e) {
        Alert.alert('Không gửi được', e instanceof Error ? e.message : '');
      }
    }} /> : undefined}>
      <KpiGrid items={[{ label: `Tổng ${orders.length} đơn hàng`, value: formatVnd(g.gross), note: `Nhóm ${g.code} · trước phí` }, { label: `${receipts.length} khoản tiền đã nhận`, value: formatVnd(g.received), note: receipts.map((r) => formatVnd(r.amount)).join(' + ') }, { label: 'Chênh lệch sau phí', value: formatVnd(g.residual), note: `Phí nền tảng: ${formatVnd(deductions)}`, highlight: true }]} />
      <Card title="Đơn hàng & phí">
        {orders.map((o) => <Row key={o.id} title={o.code} right={<Text style={[T.body, T.strong]}>{formatVnd(o.gross)}</Text>} />)}
        <Row title="Phí nền tảng" right={<Text style={[T.body, T.strong]}>{formatSignedVnd(deductions.neg())}</Text>} />
      </Card>
      <Card title="Khoản nhận ngân hàng">
        {receipts.map((r) => <Row key={r.id} title={r.code} subtitle={`${r.dateLabel} · Mã ${r.reference}`} right={<Text style={[T.body, T.strong]}>{formatVnd(r.amount)}</Text>} />)}
        <Gap h={8} />
        <Chip tone={D(g.residual).isZero() ? 'success' : 'warning'}>{D(g.residual).isZero() ? 'Khớp tổng sau phí' : `Lệch ${formatVnd(D(g.residual).abs())}`}</Chip>
      </Card>
      {can('recon.confirm') && (g.status === 'PROPOSED' || g.status === 'DISCREPANCY') && <Button title="Xác nhận ngay" loading={c.confirm.loading} onPress={c.run} />}
      <Text style={[T.small, { marginTop: 12 }]}>AI đề xuất · Bộ tính xác định tính toán · Người có quyền xác nhận</Text>
      {c.sheet}
    </Screen>
  );
}

// ───────── 16 · Phê duyệt hồ sơ ─────────
export function ApprovalScreen({ route, navigation }: ScreenProps<'Approval'>) {
  const { withStepUp } = useSession();
  const data = useQuery('approvals.get', { approvalId: route.params.id });
  const decide = useMutation('approvals.decide', { silent: true });
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const { approval: a, canDecide, blockedReason, roleNote } = data.data;
  const act = async (decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    try {
      await withStepUp(() => decide.mutate({ approvalId: a.id, decision, digest: a.digest, comment: comment || undefined }));
      setOpen(false);
      navigation.goBack();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED')) Alert.alert('Không thực hiện được', e instanceof Error ? e.message : '');
    }
  };
  return (
    <Screen footer={canDecide ? (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button title="Bổ sung" onPress={() => setOpen(true)} /></View>
        <View style={{ flex: 1.4 }}><Button title="Phê duyệt" variant="primary" loading={decide.loading} onPress={() => void act('APPROVE')} /></View>
      </View>
    ) : undefined}>
      <Chip tone={a.status === 'PENDING' ? 'warning' : a.status === 'APPROVED' ? 'success' : 'danger'}>{a.statusLabel}</Chip>
      <Text style={{ fontSize: 30, fontWeight: '700', color: C.brand, marginTop: 14, fontFamily: font }}>{a.amountLabel}</Text>
      <Text style={[T.muted, { marginTop: 6, marginBottom: 14 }]}>{`${a.title} · ${a.entityLabel}`}</Text>
      <Card>
        <KV rows={a.details.map((d) => ({ label: d.label, value: d.value }))} />
      </Card>
      <Card title="Luồng phê duyệt">
        <Steps items={a.timeline.map((t) => ({ title: t.title, sub: `${t.by} · ${formatShortDateTime(t.at)}`, done: true }))} />
        <Text style={T.small}>{roleNote}</Text>
      </Card>
      {blockedReason && <Notice tone="info">{blockedReason}</Notice>}
      {decide.error && <Notice tone="danger">{decide.error.message}</Notice>}
      <Sheet visible={open} onClose={() => setOpen(false)} title="Yêu cầu bổ sung / từ chối">
        <Input label="Nội dung" value={comment} onChangeText={setComment} multiline autoCapitalize="sentences" placeholder="Ví dụ: Bổ sung hóa đơn VAT bản gốc" />
        <Button title="Gửi yêu cầu bổ sung" variant="primary" disabled={!comment.trim()} loading={decide.loading} onPress={() => void act('REQUEST_CHANGES')} />
        <Gap />
        <Button title="Từ chối" variant="danger" disabled={!comment.trim()} onPress={() => void act('REJECT')} />
        <Gap h={24} />
      </Sheet>
    </Screen>
  );
}

// ───────── 17 · Chốt kỳ ─────────
export function CloseScreen({ navigation }: ScreenProps<'Close'>) {
  const { withStepUp, ctx } = useSession();
  const sites = ctx?.entities.filter((e) => e.kind === 'SITE') ?? [];
  const [entityId, setEntityId] = useState<string | undefined>(ctx?.scope.entityId !== '*' ? ctx?.scope.entityId : undefined);
  const data = useQuery('close.status', { entityId });
  const close = useMutation('close.close', { silent: true });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const s = data.data;
  return (
    <Screen footer={s.status === 'CLOSED' ? undefined : s.ready && s.canClose ? (
      <Button title="Chốt kỳ & lưu phiên bản" variant="primary" loading={close.loading} onPress={async () => {
        try {
          const r = await withStepUp(() => close.mutate({ entityId: s.entityId, periodId: s.periodId, digest: s.draftDigest }));
          Alert.alert('Đã chốt kỳ', r.closeId);
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'CANCELLED')) Alert.alert('Không chốt được kỳ', e instanceof Error ? e.message : '');
        }
      }} />
    ) : <Button title={`Mở ${s.blocking} việc đang chờ`} variant="primary" disabled={!s.blocking} onPress={() => navigation.navigate('Main', { screen: 'Inbox' })} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {sites.map((x) => (
          <Pressable key={x.id} onPress={() => setEntityId(x.id)}>
            <Chip tone={s.entityId === x.id ? 'success' : 'neutral'}>{x.shortName}</Chip>
          </Pressable>
        ))}
      </View>
      <Hero label={s.periodLabel} value={s.scopeLabel.split(' · ').pop() ?? ''} note={s.status === 'CLOSED' ? 'Đã chốt · bằng chứng đã neo' : s.blocking ? `Cần hoàn tất ${s.blocking} việc trước khi chốt` : 'Đủ điều kiện chốt kỳ'} />
      {s.checklist.map((c) => (
        <Card key={c.key} style={{ paddingVertical: 4 }}>
          <Row icon={c.done || s.status === 'CLOSED' ? <CircleCheck size={18} color={C.action} /> : <FileSearch size={18} color={C.warning} />} title={c.title} subtitle={c.detail} />
        </Card>
      ))}
      <Button title="Xem Decision Pack" onPress={() => navigation.navigate('DecisionPack')} />
      {close.error && <Notice tone="danger">{close.error.message}</Notice>}
    </Screen>
  );
}

// ───────── 39 · Decision Pack ─────────
export function DecisionPackScreen() {
  const data = useQuery('close.decisionPack', {});
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const d = data.data;
  return (
    <Screen footer={<Button title={d.status === 'CLOSED' ? 'Chia sẻ Decision Pack' : 'Chia sẻ Decision Pack nháp'} variant="primary" onPress={() => void Share.share({ title: d.export.filename, message: d.export.csv })} />}>
      <Hero label="Dòng tiền thuần" value={d.kpis.netLabel} note={d.kpis.netNote} />
      <Chip tone={d.status === 'CLOSED' ? 'success' : 'warning'}>{d.statusLabel}</Chip>
      <Gap />
      <Card title="Số liệu & căn cứ">
        <KV rows={d.rows.map((r) => ({ label: r.label, value: r.value }))} />
      </Card>
      <Card title="Điều kiện khóa bộ chốt">
        {d.conditions.map((c) => <Row key={c.title} icon={c.done ? <CircleCheck size={18} color={C.action} /> : <FileSearch size={18} color={C.warning} />} title={c.title} subtitle={c.detail} />)}
      </Card>
    </Screen>
  );
}

// ───────── 18 · Bằng chứng & lịch sử ─────────
export function EvidenceScreen({ route, navigation }: ScreenProps<'Evidence'>) {
  const data = useQuery('evidence.document', { documentId: route.params.id });
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const e = data.data;
  return (
    <Screen footer={e.receipt ? <Button title="Kiểm chứng hồ sơ" variant="primary" icon={<ShieldCheck size={18} color="#fff" />} onPress={() => navigation.navigate('Verification', { id: e.document.id })} /> : undefined}>
      <Card style={{ backgroundColor: C.successBg, borderColor: '#D2E9DC' }}>
        <ShieldCheck size={22} color={C.action} />
        <Text style={{ fontSize: 22, fontWeight: '700', color: C.action, marginTop: 8, fontFamily: font }}>{e.integrityLabel}</Text>
        <Text style={[T.small, { marginTop: 4 }]}>{`${e.document.code} · ${e.version?.label ?? 'Chưa có phiên bản'}`}</Text>
      </Card>
      {e.version && (
        <Card>
          <KV rows={e.rows.map((r) => ({ label: r.label, value: r.value }))} />
        </Card>
      )}
      <Card title="Lịch sử hồ sơ">
        <Steps items={e.history.map((h) => ({ title: h.title, sub: `${formatShortDateTime(h.at)} · ${h.by}`, done: true }))} />
      </Card>
    </Screen>
  );
}

// ───────── 40 · Kiểm tra toàn vẹn ─────────
export function VerificationScreen({ route }: ScreenProps<'Verification'>) {
  const info = useQuery('evidence.integrity', { documentId: route.params.id });
  const verify = useMutation('evidence.verifyDocument', { silent: true });
  const [result, setResult] = useState<Awaited<ReturnType<typeof verify.mutate>> | null>(null);
  if (!info.data) return info.error ? <ErrorView error={info.error} /> : <Loading />;
  const d = info.data;
  const run = async (file?: { base64: string }) => {
    try {
      setResult(await verify.mutate(file ? { documentId: route.params.id, fileBase64: file.base64 } : { documentId: route.params.id }));
    } catch (e) {
      Alert.alert('Không kiểm chứng được', e instanceof Error ? e.message : '');
    }
  };
  return (
    <Screen footer={
      <>
        <Button title="Chọn tệp & kiểm chứng" variant="primary" loading={verify.loading} onPress={async () => {
          const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
          if (!r.canceled && r.assets[0]) await run({ base64: await uriToBase64(r.assets[0].uri) });
        }} />
        <Button title="Kiểm chứng với bản lưu trữ" onPress={() => void run()} />
      </>
    }>
      <Text style={[T.h2]}>{d.title}</Text>
      <Text style={[T.small, { marginTop: 4, marginBottom: 10 }]}>{d.subtitle}</Text>
      <Chip tone={result ? (result.ok ? 'success' : 'danger') : d.status === 'VERIFIED' ? 'success' : 'neutral'}>{result ? (result.ok ? 'Toàn vẹn đã xác minh' : 'Phát hiện sai khác') : d.statusLabel}</Chip>
      <Gap />
      <Card>
        <KV rows={d.rows.map((r) => ({ label: r.label, value: r.value }))} />
      </Card>
      {result && (
        <Card title="Chuỗi kiểm chứng">
          <Steps items={result.steps.map((s) => ({ title: `${s.code} · ${s.label}`, sub: s.detail, done: s.ok }))} />
          <Text style={T.small}>{result.statement}</Text>
        </Card>
      )}
    </Screen>
  );
}

// ───────── 19 · Trợ lý ─────────
export function AssistantScreen({ navigation }: ScreenProps<'Assistant'>) {
  const list = useQuery('assistant.conversations');
  const [active, setActive] = useState<string | null>(null);
  const conv = useQuery('assistant.conversation', { conversationId: active ?? '' }, { enabled: !!active });
  const ask = useMutation('assistant.ask', { silent: true });
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!active && list.data?.items[0]) setActive(list.data.items[0].id);
  }, [list.data, active]);
  if (!list.data) return list.error ? <ErrorView error={list.error} /> : <Loading />;
  const send = async (text: string) => {
    if (!text.trim()) return;
    setQ('');
    const r = await ask.mutate({ conversationId: active, question: text }).catch((e: Error) => {
      Alert.alert('Trợ lý', e.message);
      return null;
    });
    if (r) setActive(r.conversationId);
  };
  return (
    <Screen footer={
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput value={q} onChangeText={setQ} placeholder="Hỏi về dữ liệu hoặc công việc..." placeholderTextColor="#8EA2AE" style={{ flex: 1, height: 46, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff', paddingHorizontal: 14, fontFamily: font }} onSubmitEditing={() => void send(q)} accessibilityLabel="Câu hỏi" />
        <Button title="Gửi" variant="primary" small loading={ask.loading} disabled={!q.trim()} onPress={() => void send(q)} />
      </View>
    }>
      <Chip>{list.data.scopeLabel}</Chip>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
        {list.data.items.map((c) => (
          <Pressable key={c.id} onPress={() => setActive(c.id)}>
            <Chip tone={c.id === active ? 'success' : 'neutral'}>{c.title}</Chip>
          </Pressable>
        ))}
      </View>
      {(conv.data?.messages ?? []).map((m, i) =>
        m.role === 'user' ? (
          <View key={i} style={{ alignSelf: 'flex-end', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 12, maxWidth: '85%', borderWidth: 1, borderColor: C.line }}>
            <Text style={T.body}>{m.content}</Text>
          </View>
        ) : (
          <Card key={i}>
            <Text style={[T.h2]}>{m.answer?.headline ?? m.content}</Text>
            {m.answer?.body ? <Text style={[T.muted, { marginTop: 8, lineHeight: 20 }]}>{m.answer.body}</Text> : null}
            {m.answer && m.answer.facts.length > 0 && <View style={{ marginTop: 8 }}><KV rows={m.answer.facts} /></View>}
            {m.answer?.citations.map((c) => (
              <Pressable key={c.ref} onPress={() => {
                if (c.route?.startsWith('/reconciliation/')) navigation.navigate('ReconDetail', { id: c.route.split('/').pop()! });
                else if (c.route === '/finance') navigation.navigate('Finance');
                else if (c.route === '/decision-pack') navigation.navigate('DecisionPack');
                else if (c.route === '/reconciliation') navigation.navigate('Reconcile');
                else navigation.navigate('Main', { screen: 'Documents' });
              }} style={{ marginTop: 10 }}>
                <Text style={{ color: C.action, fontWeight: '700' }}>{c.label} ›</Text>
              </Pressable>
            ))}
            {m.answer?.note ? <Text style={[T.small, { marginTop: 10 }]}>{m.answer.note}</Text> : null}
          </Card>
        ),
      )}
    </Screen>
  );
}

// ───────── 36 · Thông báo ─────────
export function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const data = useQuery('dashboard.notifications', {});
  const mark = useMutation('dashboard.markRead');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const go = (route: string) => {
    const [, a, b] = route.split('/');
    if (a === 'approvals' && b) navigation.navigate('Approval', { id: b });
    else if (a === 'reconciliation' && b) navigation.navigate('ReconDetail', { id: b });
    else if (a === 'reconciliation') navigation.navigate('Reconcile');
    else if (a === 'evidence' && b) navigation.navigate('Evidence', { id: b });
    else if (a === 'documents' && b) navigation.navigate('Review', { id: b });
    else if (a === 'logistics') navigation.navigate('Logistics');
    else if (a === 'projects') navigation.navigate('Projects');
    else if (a === 'ingestion') navigation.navigate('Ingestion');
    else navigation.navigate('Main', { screen: 'Inbox' });
  };
  return (
    <Screen footer={<Button title="Đánh dấu đã đọc" onPress={() => void mark.mutate({})} loading={mark.loading} />}>
      <Text style={[T.muted, { marginBottom: 12 }]}>{`${data.data.kpis.unread} chưa đọc · ${data.data.kpis.actionRequired} cần hành động · ${data.data.kpis.today} hôm nay`}</Text>
      {data.data.items.map((n) => (
        <Card key={n.id} style={{ paddingVertical: 4 }}>
          <Row icon={<Bell size={18} color={C.action} />} title={n.title} subtitle={`${n.unit} · ${n.time} · ${n.ref}`} right={<Chip tone={n.status === 'READ' ? 'neutral' : 'success'}>{n.statusLabel}</Chip>} onPress={() => {
            if (n.status === 'UNREAD') void mark.mutate({ ids: [n.id] });
            go(n.route);
          }} />
        </Card>
      ))}
    </Screen>
  );
}

// ───────── 37 · Nhập dữ liệu ─────────
export function IngestionScreen({ navigation }: ScreenProps<'Ingestion'>) {
  const data = useQuery('documents.listBatches');
  if (!data.data) return data.error ? <ErrorView error={data.error} /> : <Loading />;
  const b = data.data.latest;
  return (
    <Screen footer={<Button title="Rà soát các trường cần kiểm tra" variant="primary" onPress={() => navigation.navigate('Main', { screen: 'Documents' })} />}>
      {b && <Hero label={b.needsReview ? 'Đã chuẩn hóa, sẵn sàng' : 'Đã chuẩn hóa toàn bộ'} value={`${b.normalized} tệp`} note={`Lô ${b.code} · ${b.needsReview} cần rà soát · ${b.duplicates} trùng`} />}
      <Card title="Nguồn dữ liệu được phép sử dụng">
        {data.data.sources.map((s) => (
          <Row key={s.id} icon={<Upload size={18} color={C.action} />} title={s.name} subtitle={s.description} right={<Chip tone={s.status === 'CONNECTED' ? 'success' : 'neutral'}>{s.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối'}</Chip>} />
        ))}
      </Card>
      <Button title="Tiếp nhận chứng từ mới" onPress={() => navigation.navigate('Capture')} />
    </Screen>
  );
}

export function OtpDemo() {
  const [v, setV] = useState('');
  return <OtpInput value={v} onChange={setV} />;
}
