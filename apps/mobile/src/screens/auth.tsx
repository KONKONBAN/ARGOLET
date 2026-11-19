import { useEffect, useState, type ReactNode } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from 'react-native';
import { Text } from '../textScale';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Building2, ChevronRight, Landmark, MailCheck, Plus, Store, Upload } from 'lucide-react-native';
import { ApiError, useBackend, useMutation, useQuery } from '@argolet/client';
import { IS_PRODUCTION, saveServer, getSavedServer } from '../backend';
import { useSession } from '../session';
import { useDeviceMode } from '../deviceMode';
import { C, font } from '../theme';
import { Button, Card, Gap, Input, KV, Notice, OtpInput, Row, T, TextSizePicker } from '../ui';
import type { ScreenProps } from '../App';

/** Mobile auth layout: shield banner + logo (Figma Android/iOS 01–08). */
function AuthFrame({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <ImageBackground
          source={require('../../assets/banner.jpg')}
          style={{
            height: 96,
            borderRadius: 14,
            overflow: 'hidden',
            justifyContent: 'center',
            paddingHorizontal: 10,
          }}
          imageStyle={{ borderRadius: 14 }}
          resizeMode="cover"
        >
          <View style={{ backgroundColor: '#fff', borderRadius: 10, padding: 6, width: 108 }}>
            <Image
              source={require('../../assets/logo.jpg')}
              style={{ width: 96, height: 64 }}
              resizeMode="contain"
              accessibilityLabel="ARGOLET"
            />
          </View>
        </ImageBackground>
        <Gap h={20} />
        <Text style={[T.title, { fontSize: 26 }]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[T.muted, { marginTop: 8, marginBottom: 24 }]}>{subtitle}</Text>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const fieldErr = (e: ApiError | undefined, f: string) =>
  e && e.details?.field === f ? e.message : undefined;

// 01 · Đăng nhập
export function LoginScreen({ navigation }: ScreenProps<'Login'>) {
  const { backend } = useBackend();
  const { refresh } = useSession();
  const demo = backend.info.demo;
  const { switchTo } = useDeviceMode();
  // The sample company opens with its account filled in: one tap on "Đăng nhập" is enough.
  const [contact, setContact] = useState(demo?.email ?? '');
  const [password, setPassword] = useState(demo?.password ?? '');
  const [remember, setRemember] = useState(true);
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [missing, setMissing] = useState(false);
  const login = useMutation('auth.login', { silent: true });
  const submit = async () => {
    if (!contact.trim() || !password) {
      setMissing(true);
      return;
    }
    try {
      await login.mutate({ contact, password, remember, totpCode: needTotp ? totp : undefined });
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.details?.reason === 'MFA_REQUIRED') setNeedTotp(true);
      if (e instanceof ApiError && e.details?.reason === 'UNVERIFIED')
        navigation.navigate('Verify', { contact });
    }
  };
  return (
    <AuthFrame
      title="Đăng nhập"
      subtitle={
        demo
          ? 'Dữ liệu mẫu của Minh An Commerce, chạm Đăng nhập để xem.'
          : 'Đăng nhập vào không gian làm việc của bạn.'
      }
    >
      <Input
        label="Email"
        value={contact}
        onChangeText={setContact}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        placeholder="Nhập email hoặc số điện thoại"
        error={missing && !contact.trim() ? 'Vui lòng nhập email hoặc số điện thoại' : undefined}
      />
      <Input
        label="Mật khẩu"
        value={password}
        onChangeText={setPassword}
        secure
        autoComplete="password"
        placeholder="Nhập mật khẩu"
        error={missing && !password ? 'Vui lòng nhập mật khẩu' : undefined}
      />
      {needTotp && (
        <View style={{ marginBottom: 14 }}>
          <Text style={[T.body, { marginBottom: 8 }]}>Mã xác thực (Authenticator)</Text>
          <OtpInput value={totp} onChange={setTotp} />
        </View>
      )}
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch
            value={remember}
            onValueChange={setRemember}
            trackColor={{ true: C.action, false: C.line }}
            accessibilityLabel="Giữ đăng nhập"
          />
          <Text style={T.small}>Giữ đăng nhập</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('Reset')} accessibilityRole="link">
          <Text style={{ color: C.action, fontSize: 12 }}>Quên mật khẩu?</Text>
        </Pressable>
      </View>
      {login.error && login.error.details?.reason !== 'MFA_REQUIRED' && (
        <Notice tone="danger">{login.error.message}</Notice>
      )}
      <Button title="Đăng nhập" variant="primary" loading={login.loading} onPress={submit} />
      <Gap />
      <Button title="Tạo tài khoản" onPress={() => navigation.navigate('Register')} />
      {backend.info.mode === 'device' && (
        <Pressable
          onPress={() => switchTo(demo ? 'own' : 'sample')}
          style={{ alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 12 }}
          accessibilityRole="button"
        >
          <Text style={{ color: C.action, fontFamily: font, fontSize: 14, fontWeight: '600' }}>
            {demo ? 'Quay lại dữ liệu của tôi' : 'Dùng thử với dữ liệu mẫu'}
          </Text>
        </Pressable>
      )}
      <Gap h={18} />
      <Text style={[T.small, { marginBottom: 8 }]}>Cỡ chữ</Text>
      <TextSizePicker />
    </AuthFrame>
  );
}

// Cấu hình máy chủ (API) cho bản cài đặt doanh nghiệp
export function ServerScreen() {
  const [url, setUrl] = useState('');
  const [invalid, setInvalid] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    getSavedServer().then((s) => {
      setSaved(s);
      setUrl(s ?? '');
    });
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={T.muted}>
        {IS_PRODUCTION
          ? 'Nhập địa chỉ máy chủ ARGOLET riêng của tổ chức (bắt đầu bằng https://). Để trống để dùng máy chủ mặc định của bản cài đặt.'
          : 'Nhập địa chỉ máy chủ ARGOLET của tổ chức (ví dụ https://api.argolet.vn) để nhiều người cùng làm việc. Để trống để dữ liệu lưu ngay trên điện thoại này.'}
      </Text>
      <Gap />
      <Input
        label="Địa chỉ máy chủ"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        placeholder="https://..."
      />
      <Button
        title="Lưu & khởi động lại kết nối"
        variant="primary"
        onPress={async () => {
          const next = url.trim();
          if (next && IS_PRODUCTION && !next.startsWith('https://')) {
            setInvalid('Máy chủ phải dùng kết nối bảo mật (https://)');
            return;
          }
          setInvalid(null);
          await saveServer(next || null);
          setSaved(next || null);
        }}
      />
      {invalid && <Notice tone="danger">{invalid}</Notice>}
      {saved !== null && (
        <Notice tone="info">
          Đã lưu. Đóng và mở lại ứng dụng để áp dụng máy chủ{' '}
          {saved || (IS_PRODUCTION ? '(mặc định của bản cài đặt)' : '(dữ liệu trên điện thoại)')}.
        </Notice>
      )}
    </ScrollView>
  );
}

// 02 · Tạo tài khoản
export function RegisterScreen({ navigation, route }: ScreenProps<'Register'>) {
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const reg = useMutation('auth.register', { silent: true });
  return (
    <AuthFrame title="Tạo tài khoản" subtitle="Bắt đầu bằng tài khoản cá nhân của bạn.">
      <Input
        label="Họ và tên"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        placeholder="Họ và tên của bạn"
        error={fieldErr(reg.error, 'Họ và tên')}
      />
      <Input
        label="Email hoặc số điện thoại"
        value={contact}
        onChangeText={setContact}
        keyboardType="email-address"
        placeholder="Nhập email hoặc số điện thoại"
        error={fieldErr(reg.error, 'contact')}
      />
      <Input
        label="Mật khẩu"
        value={password}
        onChangeText={setPassword}
        secure
        hint="Sử dụng ít nhất 12 ký tự."
        error={fieldErr(reg.error, 'password')}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Switch
          value={accept}
          onValueChange={setAccept}
          trackColor={{ true: C.action, false: C.line }}
          accessibilityLabel="Đồng ý điều khoản"
        />
        <Text style={[T.small, { flex: 1 }]}>Đồng ý Điều khoản và Chính sách bảo mật.</Text>
      </View>
      {reg.error && !reg.error.details?.field && <Notice tone="danger">{reg.error.message}</Notice>}
      <Button
        title="Tạo tài khoản"
        variant="primary"
        loading={reg.loading}
        disabled={!fullName || !contact || !password || !accept}
        onPress={async () => {
          try {
            const r = await reg.mutate({
              fullName,
              contact,
              password,
              acceptTerms: accept,
              invitationCode: route.params?.invite ?? null,
            });
            navigation.navigate('Verify', { contact: r.sentTo, devCode: r.devCode });
          } catch {
            /* inline */
          }
        }}
      />
      <Gap />
      <Button title="Đã có tài khoản? Đăng nhập" onPress={() => navigation.navigate('Login')} />
    </AuthFrame>
  );
}

// 03 · Xác minh tài khoản
export function VerifyScreen({ route }: ScreenProps<'Verify'>) {
  const { refresh } = useSession();
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(route.params.devCode);
  const [wait, setWait] = useState(30);
  const verify = useMutation('auth.verifyContact', { silent: true });
  const resend = useMutation('auth.resendCode', { silent: true });
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return (
    <AuthFrame title="Xác minh tài khoản" subtitle="Xác nhận email trước khi tham gia tổ chức.">
      <MailCheck size={28} color={C.action} />
      <Text style={[T.small, { marginTop: 14 }]}>Mã xác minh đã gửi đến</Text>
      <Text style={[T.body, T.strong, { marginTop: 6, marginBottom: 18 }]}>{route.params.contact}</Text>
      <OtpInput value={code} onChange={setCode} />
      {verify.error && <Notice tone="danger">{verify.error.message}</Notice>}
      <Gap h={22} />
      <Button
        title="Xác minh & tiếp tục"
        variant="primary"
        loading={verify.loading}
        disabled={code.length !== 6}
        onPress={async () => {
          try {
            await verify.mutate({ contact: route.params.contact, code });
            await refresh();
          } catch {
            /* inline */
          }
        }}
      />
      <Gap />
      <Button
        title={wait > 0 ? `Gửi lại mã sau 00:${String(wait).padStart(2, '0')}` : 'Gửi lại mã'}
        disabled={wait > 0}
        loading={resend.loading}
        onPress={async () => {
          const r = await resend.mutate({ contact: route.params.contact }).catch(() => null);
          if (r) {
            setDevCode(r.devCode);
            setWait(r.resendAfterSeconds);
          }
        }}
      />
      <Text style={[T.small, { marginTop: 18 }]}>
        Quyền truy cập tổ chức được xác định theo lời mời hoặc ủy quyền.
      </Text>
      {devCode ? <Notice tone="info">{`Mã xác minh của bạn: ${devCode}`}</Notice> : null}
    </AuthFrame>
  );
}

// 04 · Khôi phục mật khẩu
export function ResetScreen({ navigation }: ScreenProps<'Reset'>) {
  const [contact, setContact] = useState('');
  const [stage, setStage] = useState<'request' | 'confirm'>('request');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const req = useMutation('auth.requestPasswordReset', { silent: true });
  const confirm = useMutation('auth.resetPassword', { silent: true });
  const [done, setDone] = useState(false);
  return (
    <AuthFrame title="Khôi phục mật khẩu" subtitle="Nhận liên kết đặt lại mật khẩu qua email.">
      {stage === 'request' ? (
        <>
          <Input
            label="Email tài khoản"
            value={contact}
            onChangeText={setContact}
            keyboardType="email-address"
            placeholder="Nhập email hoặc số điện thoại"
          />
          <Button
            title="Gửi liên kết khôi phục"
            variant="primary"
            loading={req.loading}
            disabled={!contact}
            onPress={async () => {
              const r = await req.mutate({ contact }).catch(() => null);
              if (r) {
                setDevCode(r.devCode);
                setStage('confirm');
              }
            }}
          />
        </>
      ) : done ? (
        <Notice tone="success">Đã đặt lại mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới.</Notice>
      ) : (
        <>
          <Notice tone="info">Nếu email tồn tại, mã đặt lại đã được gửi (hiệu lực 10 phút).</Notice>
          <OtpInput value={code} onChange={setCode} />
          <Gap />
          <Input
            label="Mật khẩu mới"
            value={pw}
            onChangeText={setPw}
            secure
            hint="Sử dụng ít nhất 12 ký tự."
            error={fieldErr(confirm.error, 'newPassword')}
          />
          {confirm.error && confirm.error.details?.field !== 'newPassword' && (
            <Notice tone="danger">{confirm.error.message}</Notice>
          )}
          <Button
            title="Đặt mật khẩu mới"
            variant="primary"
            loading={confirm.loading}
            disabled={code.length !== 6 || pw.length < 12}
            onPress={async () => {
              const r = await confirm.mutate({ contact, code, newPassword: pw }).catch(() => null);
              if (r) setDone(true);
            }}
          />
          {devCode ? <Notice tone="info">{`Mã đặt lại mật khẩu: ${devCode}`}</Notice> : null}
        </>
      )}
      <Gap />
      <Button title="Quay lại đăng nhập" onPress={() => navigation.navigate('Login')} />
    </AuthFrame>
  );
}

// 05 · Chọn không gian làm việc
export function WorkspacesScreen({ navigation }: ScreenProps<'Workspaces'>) {
  const { refresh, signOut } = useSession();
  const list = useQuery('org.listWorkspaces');
  const select = useMutation('org.selectWorkspace');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <AuthFrame title="Không gian làm việc" subtitle="Mỗi tổ chức có dữ liệu và quyền truy cập riêng.">
      {list.data?.length === 0 && (
        <Notice tone="info">Bạn chưa thuộc tổ chức nào. Tạo tổ chức mới hoặc nhập mã mời.</Notice>
      )}
      {list.data?.map((w) => (
        <Card key={w.tenantId} style={{ padding: 4, paddingHorizontal: 12 }}>
          <Row
            icon={<Building2 size={18} color={C.action} />}
            title={w.name}
            subtitle={`${w.roleLabel}, ${w.scopeLabel}`}
            chevron
            onPress={async () => {
              setBusy(w.tenantId);
              try {
                await select.mutate({ tenantId: w.tenantId });
                await refresh();
                if (navigation.canGoBack()) navigation.goBack();
              } finally {
                setBusy(null);
              }
            }}
            right={busy === w.tenantId ? <Text style={T.small}>Đang mở</Text> : undefined}
          />
        </Card>
      ))}
      <Gap />
      <Button
        title="Tạo tổ chức mới"
        variant="primary"
        icon={<Plus size={18} color="#fff" />}
        onPress={() => navigation.navigate('CreateOrg')}
      />
      <Gap />
      <Button title="Tôi có mã mời" onPress={() => navigation.navigate('Invite')} />
      <Gap />
      <Button title="Đăng xuất" onPress={() => void signOut()} />
    </AuthFrame>
  );
}

// 06 · Tạo tổ chức
export function CreateOrgScreen() {
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState('Doanh nghiệp thương mại');
  const [taxCode, setTaxCode] = useState('');
  const create = useMutation('org.createOrganization', { silent: true });
  return (
    <AuthFrame title="Tạo tổ chức" subtitle="Thiết lập thông tin và phạm vi sử dụng ARGOLET.">
      <Input
        label="Tên tổ chức"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="Tên cửa hàng hoặc công ty"
        error={fieldErr(create.error, 'Tên tổ chức')}
      />
      <Input label="Loại hình" value={orgType} onChangeText={setOrgType} autoCapitalize="sentences" />
      <Input
        label="Mã số thuế / mã đơn vị"
        value={taxCode}
        onChangeText={setTaxCode}
        keyboardType="number-pad"
        placeholder="Nhập để xác minh thông tin"
        error={fieldErr(create.error, 'taxCode')}
      />
      <Text style={[T.small, { marginBottom: 18 }]}>
        Bạn quản trị tổ chức do mình tạo. Thành viên nhận quyền theo lời mời được xác nhận.
      </Text>
      {create.error && !create.error.details?.field && <Notice tone="danger">{create.error.message}</Notice>}
      <Button
        title="Tạo tổ chức & tiếp tục"
        variant="primary"
        loading={create.loading}
        disabled={!name}
        onPress={async () => {
          const r = await create.mutate({ name, orgType, taxCode }).catch(() => null);
          if (r) await refresh();
        }}
      />
    </AuthFrame>
  );
}

// 07 · Tham gia theo lời mời
export function InviteScreen({ route }: ScreenProps<'Invite'>) {
  const { refresh } = useSession();
  const [code, setCode] = useState(route.params?.code ?? '');
  const [lookup, setLookup] = useState(route.params?.code ?? '');
  const inv = useQuery('org.getInvitation', { code: lookup }, { enabled: !!lookup });
  const respond = useMutation('org.respondInvitation', { silent: true });
  return (
    <AuthFrame
      title={inv.data ? 'Bạn được mời tham gia' : 'Nhập mã mời'}
      subtitle="Xem rõ vai trò và phạm vi trước khi chấp nhận."
    >
      {!inv.data && (
        <>
          <Input
            label="Mã mời"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            placeholder="VD: MOI-2026"
          />
          {inv.error && <Notice tone="danger">{inv.error.message}</Notice>}
          <Button
            title="Xem lời mời"
            variant="primary"
            disabled={!code.trim()}
            onPress={() => setLookup(code.trim())}
          />
        </>
      )}
      {inv.data && (
        <>
          <Card>
            <Text style={[T.h2]}>{inv.data.orgName}</Text>
            <Text style={[T.small, { marginTop: 4, marginBottom: 8 }]}>
              Người mời: {inv.data.inviterName}
            </Text>
            <KV
              rows={[
                { label: 'Vai trò', value: inv.data.roleLabel },
                { label: 'Phạm vi', value: inv.data.scopeLabel },
                { label: 'Quyền', value: inv.data.permissionsLabel },
                { label: 'Duyệt / chốt', value: inv.data.approvalLabel },
              ]}
            />
          </Card>
          {respond.error && <Notice tone="danger">{respond.error.message}</Notice>}
          {inv.data.status === 'PENDING' ? (
            <>
              <Button
                title="Chấp nhận lời mời"
                variant="primary"
                loading={respond.loading}
                onPress={async () => {
                  const r = await respond.mutate({ code: lookup, accept: true }).catch(() => null);
                  if (r) await refresh();
                }}
              />
              <Gap />
              <Button
                title="Từ chối"
                onPress={async () => {
                  await respond.mutate({ code: lookup, accept: false }).catch(() => null);
                  setLookup('');
                }}
              />
            </>
          ) : (
            <Notice tone="danger">Lời mời đã hết hiệu lực.</Notice>
          )}
        </>
      )}
    </AuthFrame>
  );
}

// 08 · Kết nối dữ liệu
export function ConnectScreen({ navigation }: ScreenProps<'Connect'>) {
  const settings = useQuery('org.settings');
  const setInt = useMutation('org.setIntegration');
  const [sel, setSel] = useState<string[]>([]);
  const options = [
    { kind: 'BANK', title: 'Ngân hàng', sub: 'Nhập sao kê hoặc kết nối được cấp quyền', icon: Landmark },
    { kind: 'POS', title: 'POS & nền tảng', sub: 'Đơn hàng, doanh thu và phí', icon: Store },
    { kind: 'EINVOICE', title: 'Chứng từ & tệp', sub: 'Ảnh, PDF, XML, Excel', icon: Upload },
  ];
  return (
    <AuthFrame title="Kết nối dữ liệu" subtitle="Chọn nguồn hoặc tải tệp để bắt đầu làm việc.">
      {options.map((o) => (
        <Card
          key={o.kind}
          style={{ padding: 4, paddingHorizontal: 12, borderColor: sel.includes(o.kind) ? C.action : C.line }}
        >
          <Row
            icon={<o.icon size={18} color={C.action} />}
            title={o.title}
            subtitle={o.sub}
            onPress={() =>
              setSel((s) => (s.includes(o.kind) ? s.filter((k) => k !== o.kind) : [...s, o.kind]))
            }
            right={sel.includes(o.kind) ? <ChevronRight size={16} color={C.action} /> : undefined}
          />
        </Card>
      ))}
      <Gap />
      <Button
        title="Vào không gian làm việc"
        variant="primary"
        loading={setInt.loading}
        onPress={async () => {
          for (const k of sel) {
            const i = settings.data?.integrations.find((x) => x.kind === k);
            if (i && i.status !== 'CONNECTED' && settings.data?.canManage)
              await setInt.mutate({ integrationId: i.id, connect: true });
          }
          navigation.navigate('Main');
        }}
      />
      <Gap />
      <Button title="Thiết lập sau" onPress={() => navigation.navigate('Main')} />
      <Text style={{ fontFamily: font }} />
    </AuthFrame>
  );
}
