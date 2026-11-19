import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, ChevronRight, Landmark, MailCheck, Plus, Store, Upload, Warehouse } from 'lucide-react';
import { ApiError } from '../api/backend';
import { useBackend, useMutation, useQuery } from '../api/hooks';
import { AuthLayout } from '../app/layouts';
import { useSession } from '../app/session';
import { Alert, Button, KeyValues, OtpInput, PasswordInput, TextInput, useToast } from '../ui/components';

const fieldError = (err: ApiError | undefined, field: string) =>
  err && err.details?.field === field ? err.message : undefined;

// ───────── 01 · Đăng nhập ─────────
export function LoginPage() {
  const { backend } = useBackend();
  const { refresh } = useSession();
  const navigate = useNavigate();
  const demo = backend.info.demo;
  // The demo deployment opens with its account filled in: one tap on "Đăng nhập" is enough.
  const [contact, setContact] = useState(demo?.email ?? '');
  const [password, setPassword] = useState(demo?.password ?? '');
  const [remember, setRemember] = useState(true);
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [missing, setMissing] = useState(false);
  const login = useMutation('auth.login', { silent: true });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!contact.trim() || !password) {
      setMissing(true);
      return;
    }
    try {
      const r = await login.mutate({ contact, password, remember, totpCode: needTotp ? totp : undefined });
      await refresh();
      if (r.pendingInvitationCode) navigate(`/invite?code=${encodeURIComponent(r.pendingInvitationCode)}`);
      else navigate(r.session.activeTenantId ? '/overview' : '/workspaces');
    } catch (err) {
      if (err instanceof ApiError && err.details?.reason === 'MFA_REQUIRED') setNeedTotp(true);
      if (err instanceof ApiError && err.details?.reason === 'UNVERIFIED')
        navigate(`/verify?contact=${encodeURIComponent(contact)}`);
    }
  };
  return (
    <AuthLayout>
      <h1 className="auth-title">Đăng nhập</h1>
      <p className="auth-sub">
        {demo
          ? 'Dữ liệu mẫu của Minh An Commerce, bấm Đăng nhập để xem.'
          : 'Đăng nhập vào không gian làm việc của bạn.'}
      </p>
      <form onSubmit={submit} noValidate>
        <TextInput
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Nhập email hoặc số điện thoại"
          error={missing && !contact.trim() ? 'Vui lòng nhập email hoặc số điện thoại' : undefined}
          required
        />
        <PasswordInput
          label="Mật khẩu"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Nhập mật khẩu"
          error={missing && !password ? 'Vui lòng nhập mật khẩu' : undefined}
          required
        />
        {needTotp && (
          <div className="field">
            <span className="field-label">Mã xác thực (Authenticator)</span>
            <OtpInput value={totp} onChange={setTotp} autoFocus />
          </div>
        )}
        <div className="row-between" style={{ margin: '4px 0 24px' }}>
          <label className="checkbox">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Giữ
            đăng nhập
          </label>
          <Link to="/reset" className="small">
            Quên mật khẩu?
          </Link>
        </div>
        {login.error && login.error.details?.reason !== 'MFA_REQUIRED' && (
          <div className="mb-16">
            <Alert tone="danger">{login.error.message}</Alert>
          </div>
        )}
        <Button type="submit" variant="primary" block size="lg" loading={login.loading}>
          Đăng nhập
        </Button>
      </form>
      <p className="muted" style={{ textAlign: 'center', margin: '26px 0 18px' }}>
        Chưa có tài khoản?
      </p>
      <Button block size="lg" onClick={() => navigate('/register')}>
        Tạo tài khoản ARGOLET
      </Button>
      {demo && (contact !== demo.email || password !== demo.password) && (
        <div className="demo-box">
          <button
            className="link-btn"
            onClick={() => {
              setContact(demo.email);
              setPassword(demo.password);
              setMissing(false);
            }}
          >
            Điền lại tài khoản trải nghiệm
          </button>
        </div>
      )}
    </AuthLayout>
  );
}

// ───────── 02 · Tạo tài khoản ─────────
export function RegisterPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [accept, setAccept] = useState(false);
  const reg = useMutation('auth.register', { silent: true });
  const invitationCode = params.get('invite');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await reg.mutate({ fullName, contact, password, acceptTerms: accept, invitationCode });
      sessionStorage.setItem('argolet.devCode', r.devCode ?? '');
      navigate(`/verify?contact=${encodeURIComponent(r.sentTo)}`);
    } catch {
      /* shown inline */
    }
  };
  return (
    <AuthLayout>
      <h1 className="auth-title">Tạo tài khoản</h1>
      <p className="auth-sub">Bắt đầu bằng tài khoản cá nhân của bạn.</p>
      <form onSubmit={submit} noValidate>
        <TextInput
          label="Họ và tên"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Họ và tên của bạn"
          error={fieldError(reg.error, 'Họ và tên')}
        />
        <TextInput
          label="Email hoặc số điện thoại"
          autoComplete="email"
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Nhập email hoặc số điện thoại"
          error={fieldError(reg.error, 'contact')}
        />
        <PasswordInput
          label="Mật khẩu"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Sử dụng ít nhất 12 ký tự."
          error={fieldError(reg.error, 'password')}
        />
        <label className="checkbox" style={{ margin: '4px 0 26px' }}>
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> Tôi đồng ý
          với Điều khoản sử dụng và Chính sách bảo mật.
        </label>
        {reg.error && !reg.error.details?.field?.toString().match(/Họ và tên|contact|password/) && (
          <div className="mb-16">
            <Alert tone="danger">{reg.error.message}</Alert>
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          block
          size="lg"
          loading={reg.loading}
          disabled={!fullName || !contact || !password || !accept}
        >
          Tạo tài khoản
        </Button>
      </form>
      <div className="mt-16">
        <Button block size="lg" onClick={() => navigate('/login')}>
          Đã có tài khoản? Đăng nhập
        </Button>
      </div>
    </AuthLayout>
  );
}

// ───────── 03 · Xác minh tài khoản ─────────
export function VerifyPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const contact = params.get('contact') ?? '';
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(() => sessionStorage.getItem('argolet.devCode') ?? '');
  const [wait, setWait] = useState(30);
  const verify = useMutation('auth.verifyContact', { silent: true });
  const resend = useMutation('auth.resendCode', { silent: true });
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  const submit = async () => {
    try {
      const r = await verify.mutate({ contact, code });
      sessionStorage.removeItem('argolet.devCode');
      await refresh();
      toast('success', 'Tài khoản đã được xác minh');
      navigate(
        r.pendingInvitationCode
          ? `/invite?code=${encodeURIComponent(r.pendingInvitationCode)}`
          : '/workspaces',
      );
    } catch {
      /* inline */
    }
  };
  return (
    <AuthLayout>
      <h1 className="auth-title">Xác minh tài khoản</h1>
      <p className="auth-sub">Xác nhận email trước khi tham gia tổ chức.</p>
      <MailCheck size={30} color="#087452" aria-hidden />
      <p className="muted small" style={{ margin: '18px 0 8px' }}>
        Mã xác minh đã gửi đến
      </p>
      <p className="strong" style={{ marginBottom: 22 }}>
        {contact || 'email của bạn'}
      </p>
      <OtpInput value={code} onChange={setCode} autoFocus />
      {verify.error && (
        <div className="mt-16">
          <Alert tone="danger">{verify.error.message}</Alert>
        </div>
      )}
      <div style={{ marginTop: 30 }}>
        <Button
          variant="primary"
          block
          size="lg"
          loading={verify.loading}
          disabled={code.length !== 6 || !contact}
          onClick={submit}
        >
          Xác minh &amp; tiếp tục
        </Button>
      </div>
      <div className="mt-16">
        <Button
          block
          size="lg"
          disabled={wait > 0 || resend.loading}
          onClick={async () => {
            try {
              const r = await resend.mutate({ contact });
              setDevCode(r.devCode ?? '');
              setWait(r.resendAfterSeconds);
              toast('success', 'Đã gửi lại mã xác minh');
            } catch (e) {
              toast('error', e instanceof Error ? e.message : 'Không gửi được mã');
            }
          }}
        >
          {wait > 0 ? `Gửi lại mã sau 00:${String(wait).padStart(2, '0')}` : 'Gửi lại mã'}
        </Button>
      </div>
      <p className="muted small" style={{ marginTop: 26 }}>
        Quyền truy cập tổ chức được xác định theo lời mời hoặc ủy quyền.
      </p>
      {devCode && (
        <div className="demo-box">
          Mã xác minh của bạn: <b>{devCode}</b>
        </div>
      )}
    </AuthLayout>
  );
}

// ───────── 04 · Khôi phục mật khẩu ─────────
export function ResetPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [contact, setContact] = useState(params.get('contact') ?? '');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [stage, setStage] = useState<'request' | 'confirm'>(params.get('code') ? 'confirm' : 'request');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [newPassword, setNewPassword] = useState('');
  const req = useMutation('auth.requestPasswordReset', { silent: true });
  const confirm = useMutation('auth.resetPassword', { silent: true });
  return (
    <AuthLayout>
      <h1 className="auth-title">Khôi phục mật khẩu</h1>
      <p className="auth-sub">Nhận liên kết đặt lại mật khẩu qua email.</p>
      {stage === 'request' ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await req.mutate({ contact }).catch(() => null);
            if (r) {
              setDevCode(r.devCode);
              setStage('confirm');
            }
          }}
        >
          <TextInput
            label="Email tài khoản"
            type="email"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Nhập email hoặc số điện thoại"
          />
          {req.error && <Alert tone="danger">{req.error.message}</Alert>}
          <div style={{ marginTop: 28 }}>
            <Button type="submit" variant="primary" block size="lg" loading={req.loading} disabled={!contact}>
              Gửi liên kết khôi phục
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await confirm.mutate({ contact, code, newPassword }).catch(() => null);
            if (r) {
              toast('success', 'Đã đặt lại mật khẩu. Vui lòng đăng nhập.');
              navigate('/login');
            }
          }}
        >
          <Alert tone="info">
            Nếu email tồn tại trong hệ thống, liên kết và mã đặt lại đã được gửi. Mã có hiệu lực trong 10
            phút.
          </Alert>
          <div className="field mt-16">
            <span className="field-label">Mã đặt lại</span>
            <OtpInput value={code} onChange={setCode} />
          </div>
          <PasswordInput
            label="Mật khẩu mới"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            hint="Sử dụng ít nhất 12 ký tự."
            error={fieldError(confirm.error, 'newPassword')}
          />
          {confirm.error && confirm.error.details?.field !== 'newPassword' && (
            <Alert tone="danger">{confirm.error.message}</Alert>
          )}
          <div style={{ marginTop: 24 }}>
            <Button
              type="submit"
              variant="primary"
              block
              size="lg"
              loading={confirm.loading}
              disabled={code.length !== 6 || newPassword.length < 12}
            >
              Đặt mật khẩu mới
            </Button>
          </div>
          {devCode && (
            <div className="demo-box">
              Mã đặt lại mật khẩu: <b>{devCode}</b>
            </div>
          )}
        </form>
      )}
      <div className="mt-16">
        <Button block size="lg" onClick={() => navigate('/login')}>
          Quay lại đăng nhập
        </Button>
      </div>
    </AuthLayout>
  );
}

// ───────── 05 · Chọn không gian làm việc ─────────
export function WorkspacesPage() {
  const navigate = useNavigate();
  const { refresh, signOut } = useSession();
  const list = useQuery('org.listWorkspaces');
  const select = useMutation('org.selectWorkspace');
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <AuthLayout>
      <h1 className="auth-title">Chọn không gian làm việc</h1>
      <p className="auth-sub">Mỗi tổ chức có dữ liệu và quyền truy cập riêng.</p>
      {list.loading && <p className="muted">Đang tải</p>}
      {list.data?.length === 0 && (
        <Alert tone="info">Bạn chưa thuộc tổ chức nào. Tạo tổ chức mới hoặc nhập mã mời.</Alert>
      )}
      {list.data?.map((w, i) => (
        <button
          key={w.tenantId}
          className="choice"
          disabled={!!busy}
          onClick={async () => {
            setBusy(w.tenantId);
            try {
              await select.mutate({ tenantId: w.tenantId });
              await refresh();
              navigate('/overview');
            } finally {
              setBusy(null);
            }
          }}
        >
          {i % 2 === 0 ? <Building2 size={24} color="#536978" /> : <Warehouse size={24} color="#536978" />}
          <span>
            <div className="choice-title">{w.name}</div>
            <div className="choice-sub">
              {w.roleLabel}, {w.scopeLabel}
            </div>
          </span>
          {busy === w.tenantId ? (
            <span className="spinner dark" />
          ) : (
            <ChevronRight size={16} color="#536978" />
          )}
        </button>
      ))}
      <div style={{ marginTop: 28 }}>
        <Button
          variant="primary"
          block
          size="lg"
          icon={<Plus size={18} />}
          onClick={() => navigate('/create-org')}
        >
          Tạo tổ chức mới
        </Button>
      </div>
      <div className="mt-16">
        <Button block size="lg" onClick={() => navigate('/invite')}>
          Tôi có mã mời
        </Button>
      </div>
      <p style={{ textAlign: 'center', marginTop: 20 }}>
        <button className="link-btn" onClick={() => void signOut()}>
          Đăng xuất
        </button>
      </p>
    </AuthLayout>
  );
}

// ───────── 06 · Tạo tổ chức ─────────
export function CreateOrgPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const [orgType, setOrgType] = useState('Doanh nghiệp thương mại');
  const [taxCode, setTaxCode] = useState('');
  const create = useMutation('org.createOrganization', { silent: true });
  return (
    <AuthLayout>
      <h1 className="auth-title">Tạo tổ chức</h1>
      <p className="auth-sub">Thiết lập thông tin và phạm vi sử dụng ARGOLET.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await create.mutate({ name, orgType, taxCode }).catch(() => null);
          if (r) {
            await refresh();
            navigate('/connect');
          }
        }}
      >
        <TextInput
          label="Tên tổ chức"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tên cửa hàng hoặc công ty"
          error={fieldError(create.error, 'Tên tổ chức')}
        />
        <div className="field">
          <label htmlFor="orgType">Loại hình</label>
          <select
            id="orgType"
            className="select"
            value={orgType}
            onChange={(e) => setOrgType(e.target.value)}
          >
            <option>Doanh nghiệp thương mại</option>
            <option>Hộ kinh doanh</option>
            <option>Dịch vụ kế toán</option>
            <option>Dự án / Logistics</option>
            <option>Nhóm công ty</option>
          </select>
        </div>
        <TextInput
          label="Mã số thuế / mã đơn vị"
          value={taxCode}
          onChange={(e) => setTaxCode(e.target.value)}
          placeholder="Nhập để xác minh thông tin"
          error={fieldError(create.error, 'taxCode')}
          inputMode="numeric"
        />
        <p className="small" style={{ marginTop: 26 }}>
          Vai trò khởi tạo: quản trị tổ chức
        </p>
        <p className="muted small" style={{ margin: '10px 0 30px' }}>
          Thành viên nhận quyền theo lời mời hoặc ủy quyền được xác nhận.
        </p>
        {create.error && !create.error.details?.field && <Alert tone="danger">{create.error.message}</Alert>}
        <Button type="submit" variant="primary" block size="lg" loading={create.loading} disabled={!name}>
          Tạo tổ chức &amp; tiếp tục
        </Button>
      </form>
      <div className="mt-16">
        <Button block size="lg" onClick={() => navigate('/workspaces')}>
          Quay lại
        </Button>
      </div>
    </AuthLayout>
  );
}

// ───────── 07 · Tham gia theo lời mời ─────────
export function InvitePage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [lookup, setLookup] = useState(params.get('code') ?? '');
  const inv = useQuery('org.getInvitation', { code: lookup }, { enabled: !!lookup });
  const respond = useMutation('org.respondInvitation', { silent: true });
  const act = async (accept: boolean) => {
    const r = await respond.mutate({ code: lookup, accept }).catch(() => null);
    if (!r) return;
    await refresh();
    if (accept) {
      toast('success', `Đã tham gia ${inv.data?.orgName ?? 'tổ chức'}`);
      navigate('/overview');
    } else navigate('/workspaces');
  };
  return (
    <AuthLayout>
      <h1 className="auth-title">{inv.data ? 'Tham gia theo lời mời' : 'Nhập mã mời'}</h1>
      <p className="auth-sub">Xem rõ vai trò và phạm vi trước khi chấp nhận.</p>
      {!inv.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setLookup(code.trim());
          }}
        >
          <TextInput
            label="Mã mời"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="VD: MOI-2026"
          />
          {inv.error && <Alert tone="danger">{inv.error.message}</Alert>}
          <div className="mt-16">
            <Button
              type="submit"
              variant="primary"
              block
              size="lg"
              disabled={!code.trim()}
              loading={inv.loading}
            >
              Xem lời mời
            </Button>
          </div>
        </form>
      )}
      {inv.data && (
        <div className="card">
          <div className="strong" style={{ fontSize: 16 }}>
            {inv.data.orgName}
          </div>
          <div className="muted small mt-8">Lời mời từ {inv.data.inviterName}</div>
          <div className="mt-16">
            <KeyValues
              rows={[
                { label: 'Vai trò', value: inv.data.roleLabel },
                { label: 'Phạm vi', value: inv.data.scopeLabel },
                { label: 'Quyền', value: inv.data.permissionsLabel },
                { label: 'Duyệt / chốt', value: inv.data.approvalLabel },
              ]}
            />
          </div>
          {inv.data.status !== 'PENDING' && (
            <div className="mt-16">
              <Alert tone="danger">
                Lời mời đã {inv.data.status === 'EXPIRED' ? 'hết hạn' : 'được xử lý'}.
              </Alert>
            </div>
          )}
        </div>
      )}
      {respond.error && (
        <div className="mt-16">
          <Alert tone="danger">{respond.error.message}</Alert>
        </div>
      )}
      {inv.data && inv.data.status === 'PENDING' && (
        <>
          <div style={{ marginTop: 28 }}>
            <Button variant="primary" block size="lg" loading={respond.loading} onClick={() => act(true)}>
              Chấp nhận lời mời
            </Button>
          </div>
          <div className="mt-16">
            <Button block size="lg" disabled={respond.loading} onClick={() => act(false)}>
              Từ chối
            </Button>
          </div>
        </>
      )}
      <p style={{ textAlign: 'center', marginTop: 20 }}>
        <Link to="/workspaces">Quay lại danh sách không gian</Link>
      </p>
    </AuthLayout>
  );
}

// ───────── 08 · Kết nối dữ liệu đầu tiên ─────────
export function ConnectPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const settings = useQuery('org.settings');
  const setInt = useMutation('org.setIntegration');
  const [selected, setSelected] = useState<string[]>([]);
  const options = [
    { kind: 'BANK', title: 'Ngân hàng', sub: 'Nhập sao kê hoặc kết nối được cấp quyền', icon: Landmark },
    { kind: 'POS', title: 'POS và nền tảng bán hàng', sub: 'Nhập đơn hàng, doanh thu và phí', icon: Store },
    { kind: 'EINVOICE', title: 'Tải chứng từ', sub: 'Ảnh, PDF hoặc hóa đơn điện tử XML', icon: Upload },
  ];
  const integrations = settings.data?.integrations ?? [];
  const toggle = (kind: string) =>
    setSelected((s) => (s.includes(kind) ? s.filter((k) => k !== kind) : [...s, kind]));
  const finish = async () => {
    for (const kind of selected) {
      const integ = integrations.find((i) => i.kind === kind);
      if (integ && integ.status !== 'CONNECTED' && settings.data?.canManage)
        await setInt.mutate({ integrationId: integ.id, connect: true });
    }
    if (selected.length) toast('success', 'Đã kết nối nguồn dữ liệu');
    navigate(selected.includes('EINVOICE') ? '/capture' : '/overview');
  };
  return (
    <AuthLayout>
      <h1 className="auth-title">Kết nối dữ liệu đầu tiên</h1>
      <p className="auth-sub">Chọn nguồn hoặc tải tệp để bắt đầu làm việc.</p>
      {options.map((o) => {
        const connected = integrations.find((i) => i.kind === o.kind)?.status === 'CONNECTED';
        return (
          <button
            key={o.kind}
            className={`choice${selected.includes(o.kind) ? ' selected' : ''}`}
            onClick={() => toggle(o.kind)}
            aria-pressed={selected.includes(o.kind)}
          >
            <o.icon size={22} color="#087452" />
            <span>
              <div className="choice-title">{o.title}</div>
              <div className="choice-sub">{connected ? 'Đã kết nối' : o.sub}</div>
            </span>
            <span />
          </button>
        );
      })}
      <div style={{ marginTop: 28 }}>
        <Button variant="primary" block size="lg" onClick={finish} loading={setInt.loading}>
          Vào không gian làm việc
        </Button>
      </div>
      <div className="mt-16">
        <Button block size="lg" onClick={() => navigate('/overview')}>
          Thiết lập sau
        </Button>
      </div>
    </AuthLayout>
  );
}
