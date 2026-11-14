import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Boxes,
  Building2,
  ChartColumn,
  ChevronRight,
  DatabaseBackup,
  FolderKanban,
  GitCompareArrows,
  Handshake,
  History,
  KeyRound,
  Lock,
  Network,
  Plug,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Store,
  Truck,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import type { Role } from '@argolet/core';
import { useBackend, useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import {
  Alert,
  Button,
  Card,
  Chip,
  DataTable,
  ErrorNote,
  KeyValues,
  Modal,
  OtpInput,
  PageHeader,
  PageLoading,
  PasswordInput,
  SelectInput,
  TextInput,
  useToast,
} from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';

const ROLE_OPTIONS: [Role, string][] = [
  ['ACCOUNTANT', 'Kế toán'],
  ['CHIEF_ACCOUNTANT', 'Kế toán trưởng'],
  ['APPROVER', 'Người duyệt'],
  ['STAFF', 'Nhân viên'],
  ['VIEWER', 'Chỉ xem'],
  ['AUDITOR', 'Kiểm toán'],
  ['ORG_ADMIN', 'Quản trị'],
];

// ───────── 34 · Thành viên & phân quyền ─────────
export function MembersPage() {
  const toast = useToast();
  const { ctx } = useSession();
  const data = useQuery('org.listMembers');
  const invite = useMutation('org.inviteMember', { silent: true });
  const update = useMutation('org.updateMember', { silent: true });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ email: string; role: Role; entity: string; limit: string }>({
    email: '',
    role: 'ACCOUNTANT',
    entity: '*',
    limit: '',
  });
  const [created, setCreated] = useState<string | null>(null);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const sites = ctx?.entities ?? [];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Quản trị"
        title="Thành viên & phân quyền"
        subtitle="Cấp đúng vai trò, đơn vị và hạn mức."
        period={period}
        actions={
          data.data.canManage ? (
            <Button icon={<UserPlus size={18} />} onClick={() => setOpen(true)}>
              Mời thành viên
            </Button>
          ) : undefined
        }
      />
      <Card
        title="Vai trò theo tổ chức và đơn vị"
        subtitle="Quyền lập hồ sơ, phê duyệt và chốt kỳ được cấp riêng"
      >
        <DataTable
          rows={data.data.members}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Thành viên', render: (r) => r.name, strong: true },
            { key: 'r', header: 'Vai trò', render: (r) => r.roleLabel },
            { key: 's', header: 'Phạm vi', render: (r) => r.scopeLabel },
            { key: 'l', header: 'Hạn mức duyệt', render: (r) => r.limitLabel },
            {
              key: 't',
              header: 'Trạng thái',
              render: (r) => (
                <span className="row">
                  <Chip
                    tone={r.status === 'ACTIVE' ? 'success' : r.status === 'INVITED' ? 'info' : 'warning'}
                  >
                    {r.statusLabel}
                  </Chip>
                  {r.code && <span className="small muted">{r.code}</span>}
                  {data.data!.canManage && r.status !== 'INVITED' && !r.isSelf && (
                    <button
                      className="link-btn"
                      onClick={async () => {
                        try {
                          await update.mutate({
                            membershipId: r.id,
                            status: r.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                          });
                          toast(
                            'success',
                            r.status === 'ACTIVE' ? 'Đã tạm ngưng thành viên' : 'Đã kích hoạt lại',
                          );
                        } catch (e) {
                          toast('error', e instanceof Error ? e.message : 'Không cập nhật được');
                        }
                      }}
                    >
                      {r.status === 'ACTIVE' ? 'Tạm ngưng' : 'Kích hoạt'}
                    </button>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Card>
      <div className="mt-16">
        <Alert tone="info">
          Quản trị tổ chức được tách khỏi quyền phê duyệt tài chính; người lập hồ sơ không thể tự phê duyệt.
          Mọi thay đổi được ghi nhật ký.
        </Alert>
      </div>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          setCreated(null);
        }}
        title="Mời thành viên"
        footer={
          created ? (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                setCreated(null);
              }}
            >
              Xong
            </Button>
          ) : (
            <Button
              variant="primary"
              loading={invite.loading}
              onClick={async () => {
                try {
                  const r = await invite.mutate({
                    email: form.email,
                    role: form.role,
                    entityIds: form.entity === '*' ? '*' : [form.entity],
                    approvalLimit: form.limit || null,
                  });
                  setCreated(r.code);
                  toast('success', 'Đã tạo lời mời');
                } catch {
                  /* inline */
                }
              }}
            >
              Gửi lời mời
            </Button>
          )
        }
      >
        {created ? (
          <Alert tone="success" title={`Mã mời: ${created}`}>
            Người được mời đăng ký bằng đúng email {form.email} rồi nhập mã này tại “Tôi có mã mời”. Lời mời
            hết hạn sau 7 ngày.
          </Alert>
        ) : (
          <>
            <TextInput
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={invite.error?.details?.field === 'email' ? invite.error.message : undefined}
            />
            <div className="field">
              <label htmlFor="role">Vai trò</label>
              <select
                id="role"
                className="select"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {ROLE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="scope">Phạm vi</label>
              <select
                id="scope"
                className="select"
                value={form.entity}
                onChange={(e) => setForm({ ...form, entity: e.target.value })}
              >
                <option value="*">Toàn tổ chức</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            {(form.role === 'APPROVER' || form.role === 'CHIEF_ACCOUNTANT') && (
              <TextInput
                label="Hạn mức duyệt (đ)"
                inputMode="numeric"
                value={form.limit}
                onChange={(e) => setForm({ ...form, limit: e.target.value.replace(/[^\d]/g, '') })}
              />
            )}
            {invite.error && invite.error.details?.field !== 'email' && <ErrorNote error={invite.error} />}
          </>
        )}
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 35 · Cài đặt & tích hợp ─────────
type HkdForm = {
  method: 'EXEMPT' | 'PERCENT' | 'INCOME' | '';
  lines: { name: string; vatRate?: string; pitRate?: string }[];
  incomePitRate?: string;
};
const hkdForm = (h?: {
  method: 'EXEMPT' | 'PERCENT' | 'INCOME';
  lines: { name: string; vatRate?: string | undefined; pitRate?: string | undefined }[];
  incomePitRate?: string | undefined;
}): HkdForm => ({
  method: h?.method ?? '',
  lines: h?.lines.length
    ? h.lines.map((l) => ({ name: l.name, vatRate: l.vatRate ?? '', pitRate: l.pitRate ?? '' }))
    : [{ name: '', vatRate: '', pitRate: '' }],
  incomePitRate: h?.incomePitRate ?? '',
});

/** How the household pays VAT / PIT decides its books (Thông tư 152/2025/TT-BTC, Điều 4–6). */
function HkdTaxSettings({
  value,
  onChange,
  disabled,
}: {
  value: HkdForm;
  onChange: (v: HkdForm) => void;
  disabled: boolean;
}) {
  const methods = [
    { k: 'EXEMPT', t: 'Không chịu thuế GTGT, không nộp thuế TNCN', s: 'Sổ S1a-HKD' },
    { k: 'PERCENT', t: 'Nộp thuế GTGT và TNCN theo tỷ lệ % trên doanh thu', s: 'Sổ S2a-HKD' },
    {
      k: 'INCOME',
      t: 'Thuế GTGT theo % doanh thu, thuế TNCN trên thu nhập tính thuế',
      s: 'Sổ S2b, S2c, S2e-HKD',
    },
  ] as const;
  const setLine = (i: number, patch: Partial<HkdForm['lines'][number]>) =>
    onChange({ ...value, lines: value.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  return (
    <fieldset className="hkd-tax" disabled={disabled}>
      <legend>Phương pháp nộp thuế (quyết định bộ sổ phải mở)</legend>
      {methods.map((m) => (
        <label key={m.k} className="radio-row">
          <input
            type="radio"
            name="hkd-method"
            checked={value.method === m.k}
            onChange={() => onChange({ ...value, method: m.k })}
          />
          <span>
            {m.t} <span className="muted small">· {m.s}</span>
          </span>
        </label>
      ))}
      {value.method && value.method !== 'EXEMPT' && (
        <>
          <p className="muted small">
            Ngành nghề và tỷ lệ % tính thuế theo thông báo của cơ quan thuế / quy định hiện hành. ARGOLET
            không tự đặt tỷ lệ: ô để trống thì sổ để trống phần thuế.
          </p>
          {value.lines.map((l, i) => (
            <div className="grid hkd-line" key={i}>
              <TextInput
                label={`Ngành nghề ${i + 1}`}
                value={l.name}
                onChange={(e) => setLine(i, { name: e.target.value })}
              />
              <TextInput
                label="Tỷ lệ GTGT (%)"
                inputMode="decimal"
                value={l.vatRate ?? ''}
                onChange={(e) => setLine(i, { vatRate: e.target.value })}
              />
              {value.method === 'PERCENT' && (
                <TextInput
                  label="Tỷ lệ TNCN (%)"
                  inputMode="decimal"
                  value={l.pitRate ?? ''}
                  onChange={(e) => setLine(i, { pitRate: e.target.value })}
                />
              )}
            </div>
          ))}
          {value.lines.length < 10 && (
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                onChange({ ...value, lines: [...value.lines, { name: '', vatRate: '', pitRate: '' }] })
              }
            >
              + Thêm ngành nghề
            </button>
          )}
          {value.method === 'INCOME' && (
            <TextInput
              label="Thuế suất thuế TNCN trên thu nhập tính thuế (%)"
              inputMode="decimal"
              value={value.incomePitRate ?? ''}
              onChange={(e) => onChange({ ...value, incomePitRate: e.target.value })}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

const AI_NAMES = { claude: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)' } as const;

/** Choice of generative AI provider: off by default, only providers configured on the server. */
function AiSettings({
  open,
  onClose,
  ai,
  canManage,
}: {
  open: boolean;
  onClose: () => void;
  ai: { provider: string; available: { provider: string; name: string }[] };
  canManage: boolean;
}) {
  const toast = useToast();
  const update = useMutation('org.updateSettings', { silent: true });
  const [choice, setChoice] = useState<string | null>(null);
  const current = choice ?? ai.provider;
  const options = [
    {
      k: 'off',
      t: 'Tắt Gen AI',
      s: 'Trợ lý trả lời bằng bộ quy tắc trong ARGOLET; không dữ liệu nào ra ngoài.',
    },
    ...(['claude', 'openai'] as const).map((k) => {
      const a = ai.available.find((x) => x.provider === k);
      return {
        k,
        t: AI_NAMES[k],
        s: a ? `Mô hình ${a.name.split(':')[1]}` : 'Máy chủ ARGOLET chưa cấu hình khóa của nhà cung cấp này',
        disabled: !a,
      };
    }),
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Trợ lý AI (Claude / ChatGPT)"
      width={620}
      footer={
        canManage ? (
          <Button
            variant="primary"
            loading={update.loading}
            disabled={current === ai.provider}
            onClick={async () => {
              try {
                await update.mutate({ aiProvider: current as 'off' });
                toast(
                  'success',
                  current === 'off' ? 'Đã tắt Gen AI' : `Đã bật ${AI_NAMES[current as 'claude']}`,
                );
                onClose();
              } catch (e) {
                toast('error', e instanceof Error ? e.message : 'Không lưu được');
              }
            }}
          >
            Lưu
          </Button>
        ) : undefined
      }
    >
      <fieldset className="hkd-tax" disabled={!canManage} style={{ marginTop: 0 }}>
        <legend>Nhà cung cấp cho tổ chức</legend>
        {options.map((o) => (
          <label key={o.k} className="radio-row">
            <input
              type="radio"
              name="ai-provider"
              checked={current === o.k}
              disabled={'disabled' in o && o.disabled}
              onChange={() => setChoice(o.k)}
            />
            <span>
              {o.t} <span className="muted small">· {o.s}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <h3 className="card-title">Bảo vệ khi dùng Gen AI</h3>
      <ul className="small" style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
        <li>Chỉ gửi tới nhà cung cấp tổ chức đã chọn; không tự chuyển sang nhà cung cấp khác khi lỗi.</li>
        <li>
          Email, số điện thoại, mã số thuế, CCCD, số tài khoản và tên nhân sự được thay bằng mã ẩn trước khi
          gửi, rồi khôi phục khi hiển thị cho người hỏi.
        </li>
        <li>
          Chỉ gửi số liệu trong phạm vi quyền của người hỏi; dữ liệu chứng từ được coi là dữ liệu, không phải
          lệnh.
        </li>
        <li>AI chỉ đề xuất; xác nhận, phê duyệt vẫn cần người có quyền.</li>
        <li>Khóa API nằm trên máy chủ ARGOLET, không gửi về trình duyệt hay ứng dụng.</li>
        <li>
          OpenAI: không lưu phản hồi (store: false). Nhà cung cấp chỉ nhận mã định danh ẩn danh của người hỏi.
        </li>
        <li>
          Nhật ký ghi ai hỏi, lúc nào, nhà cung cấp nào và bao nhiêu thông tin được che — không ghi nội dung.
        </li>
        <li>Giới hạn 20 câu hỏi mỗi 10 phút cho mỗi người.</li>
      </ul>
    </Modal>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refresh } = useSession();
  const data = useQuery('org.settings');
  const update = useMutation('org.updateSettings', { silent: true });
  const location = useLocation();
  const [panel, setPanel] = useState<null | 'org' | 'audit' | 'backup' | 'privacy' | 'ai'>(
    location.hash === '#co-cau' ? 'org' : null,
  );
  const [regime, setRegime] = useState<string>('');
  const [address, setAddress] = useState<string | null>(null);
  const [hkd, setHkd] = useState<HkdForm | null>(null);
  const [periodEdit, setPeriodEdit] = useState<string>('');
  const addEntity = useMutation('org.addEntity', { silent: true });
  const [entityForm, setEntityForm] = useState({ kind: 'SITE', name: '' });
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
  const tiles = [
    {
      icon: Building2,
      title: 'Thông tin tổ chức',
      desc: 'Pháp nhân, cơ sở và kỳ dữ liệu',
      act: () => setPanel('org'),
    },
    {
      icon: Smartphone,
      title: 'Bảo mật tài khoản',
      desc: 'Mật khẩu, xác minh và thiết bị',
      act: () => navigate('/security'),
    },
    {
      icon: Users,
      title: 'Thành viên & phân quyền',
      desc: 'Vai trò, phạm vi và hạn mức',
      act: () => navigate('/members'),
    },
    {
      icon: Plug,
      title: 'Kết nối API',
      desc: 'Ngân hàng (SePay), POS (KiotViet), iPOS',
      act: () => navigate('/connections'),
    },
    {
      icon: Bell,
      title: 'Thông báo',
      desc: 'Việc cần làm và kênh nhận',
      act: () => navigate('/notifications'),
    },
    {
      icon: History,
      title: 'Nhật ký hoạt động',
      desc: 'Ai thực hiện, khi nào, trong phạm vi nào',
      act: () => setPanel('audit'),
    },
    {
      icon: DatabaseBackup,
      title: 'Sao lưu & khôi phục',
      desc: 'Phạm vi, lịch chạy và quyền khôi phục',
      act: () => setPanel('backup'),
    },
    {
      icon: Lock,
      title: 'Bảo vệ dữ liệu cá nhân',
      desc: 'Quyền truy cập, lưu trữ và nhật ký',
      act: () => setPanel('privacy'),
    },
    {
      icon: Sparkles,
      title: 'Trợ lý AI (Claude / ChatGPT)',
      desc:
        d.ai.provider === 'off'
          ? 'Đang tắt · dữ liệu không gửi ra ngoài'
          : `Đang dùng ${d.ai.provider === 'claude' ? 'Claude' : 'ChatGPT'} · thông tin cá nhân được che`,
      act: () => setPanel('ai'),
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Quản trị"
        title="Cài đặt & tích hợp"
        subtitle="Quản lý tài khoản, nguồn dữ liệu và bảo mật."
        period={period}
      />
      <div className="grid grid-2">
        {tiles.map((t) => (
          <Card key={t.title} className="tile">
            <div className="tile-head">
              <t.icon size={22} color="#536978" /> {t.title}
            </div>
            <div className="desc">{t.desc}</div>
            <button className="link-btn row-between" onClick={t.act}>
              Quản lý <ChevronRight size={16} />
            </button>
          </Card>
        ))}
      </div>
      <Modal
        open={panel === 'org'}
        onClose={() => setPanel(null)}
        title="Thông tin tổ chức"
        footer={
          d.canManage ? (
            <Button
              variant="primary"
              loading={update.loading}
              onClick={async () => {
                try {
                  const nextRegime = (regime || d.tenant.settings.accountingRegime) as 'TT133';
                  const form = hkd ?? hkdForm(d.tenant.settings.hkd);
                  await update.mutate({
                    accountingRegime: nextRegime,
                    ...(address !== null ? { address } : {}),
                    ...(nextRegime === ('HKD' as string) && form.method
                      ? {
                          hkd: {
                            method: form.method,
                            lines: form.lines.filter((l) => l.name.trim()),
                            incomePitRate: form.incomePitRate,
                          },
                        }
                      : {}),
                    ...(periodEdit && periodEdit !== d.tenant.settings.currentPeriod
                      ? { currentPeriod: periodEdit }
                      : {}),
                  });
                  toast('success', 'Đã lưu cài đặt');
                  setPanel(null);
                } catch (e) {
                  toast('error', e instanceof Error ? e.message : 'Không lưu được');
                }
              }}
            >
              Lưu
            </Button>
          ) : undefined
        }
      >
        <KeyValues
          rows={[
            { label: 'Tên tổ chức', value: d.tenant.name },
            { label: 'Loại hình', value: d.tenant.orgType },
            { label: 'Mã số thuế', value: d.tenant.taxCode ?? '—' },
            {
              label: 'Tiền tệ · múi giờ',
              value: `${d.tenant.settings.currency} · ${d.tenant.settings.timezone}`,
            },
            { label: 'Kỳ hiện tại', value: d.tenant.settings.currentPeriod },
            { label: 'Gói nghiệp vụ', value: d.tenant.settings.packages.join(', ') },
            { label: 'Lưu trữ dữ liệu', value: d.tenant.settings.dataLocation },
          ]}
        />
        <div className="field mt-16">
          <label htmlFor="regime">Chế độ kế toán</label>
          <select
            id="regime"
            className="select"
            disabled={!d.canManage}
            value={regime || d.tenant.settings.accountingRegime}
            onChange={(e) => setRegime(e.target.value)}
          >
            <option value="TT133">Thông tư 133/2016 (doanh nghiệp nhỏ và vừa)</option>
            <option value="TT99">Thông tư 99/2025 (doanh nghiệp, thay Thông tư 200 từ 01/01/2026)</option>
            <option value="HKD">Hộ kinh doanh · Thông tư 152/2025</option>
            {d.tenant.settings.accountingRegime === 'TT200' && (
              <option value="TT200" disabled>
                Thông tư 200/2014 (hết hiệu lực từ 01/01/2026)
              </option>
            )}
          </select>
        </div>
        <TextInput
          label="Địa chỉ (in trên sổ kế toán)"
          value={address ?? d.tenant.settings.address ?? ''}
          onChange={(e) => setAddress(e.target.value)}
          disabled={!d.canManage}
        />
        {(regime || d.tenant.settings.accountingRegime) === 'HKD' && (
          <HkdTaxSettings
            value={hkd ?? hkdForm(d.tenant.settings.hkd)}
            onChange={setHkd}
            disabled={!d.canManage}
          />
        )}
        <TextInput
          label="Kỳ làm việc hiện tại"
          type="month"
          value={periodEdit || d.tenant.settings.currentPeriod}
          onChange={(e) => setPeriodEdit(e.target.value)}
          disabled={!d.canManage}
          hint="Tự chuyển sang tháng kế tiếp khi mọi đơn vị đã chốt kỳ."
        />
        <h3 className="card-title mt-24" id="co-cau">
          Cơ cấu tổ chức
        </h3>
        <DataTable
          rows={d.entities}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Đơn vị', render: (r) => r.name, strong: true },
            { key: 'k', header: 'Loại', render: (r) => r.kindLabel },
            { key: 'c', header: 'Mã', render: (r) => r.code },
            { key: 'p', header: 'Thuộc', render: (r) => r.parentName || '—' },
          ]}
        />
        {d.canManage && (
          <div className="row wrap mt-16" style={{ alignItems: 'flex-end', gap: 10 }}>
            <div style={{ flex: '1 1 160px' }}>
              <SelectInput
                label="Thêm đơn vị"
                value={entityForm.kind}
                onChange={(v) => setEntityForm({ ...entityForm, kind: v })}
                options={[
                  { value: 'SITE', label: 'Cơ sở / cửa hàng / chi nhánh' },
                  { value: 'LEGAL_ENTITY', label: 'Pháp nhân (công ty con)' },
                ]}
              />
            </div>
            <div style={{ flex: '2 1 200px' }}>
              <TextInput
                label="Tên đơn vị"
                value={entityForm.name}
                onChange={(e) => setEntityForm({ ...entityForm, name: e.target.value })}
                placeholder={entityForm.kind === 'SITE' ? 'Cửa hàng Nguyễn Trãi' : 'Công ty TNHH …'}
              />
            </div>
            <div className="field">
              <Button
                loading={addEntity.loading}
                disabled={!entityForm.name.trim()}
                onClick={async () => {
                  try {
                    const r = await addEntity.mutate({
                      kind: entityForm.kind as 'SITE',
                      name: entityForm.name,
                    });
                    toast('success', `Đã thêm ${entityForm.name} (${r.code})`);
                    setEntityForm({ ...entityForm, name: '' });
                    await refresh();
                  } catch {
                    /* inline */
                  }
                }}
              >
                Thêm
              </Button>
            </div>
          </div>
        )}
        {addEntity.error && <ErrorNote error={addEntity.error} />}
      </Modal>
      <Modal open={panel === 'audit'} onClose={() => setPanel(null)} title="Nhật ký hoạt động" width={720}>
        <DataTable
          rows={d.audit}
          rowKey={(r) => `${r.at}-${r.action}-${r.target}`}
          columns={[
            {
              key: 'at',
              header: 'Thời điểm',
              render: (r) =>
                new Date(Date.parse(r.at) + 7 * 3600e3).toISOString().replace('T', ' ').slice(0, 16),
            },
            { key: 'a', header: 'Người thực hiện', render: (r) => r.actor },
            { key: 'x', header: 'Thao tác', render: (r) => r.action },
            { key: 't', header: 'Đối tượng', render: (r) => r.target },
          ]}
          empty="Chưa có hoạt động"
        />
      </Modal>
      <Modal open={panel === 'backup'} onClose={() => setPanel(null)} title="Sao lưu & khôi phục">
        <KeyValues
          rows={[
            { label: 'Cơ sở dữ liệu', value: 'PostgreSQL · giao dịch SERIALIZABLE' },
            { label: 'Bản gốc chứng từ', value: 'Lưu kèm SHA-256, không ghi đè' },
            { label: 'Bằng chứng', value: 'Merkle root neo trên mạng có cấp quyền' },
            { label: 'Quyền khôi phục', value: 'Quản trị tổ chức + phê duyệt' },
          ]}
        />
        <p className="small muted mt-16">
          Lịch sao lưu và điểm khôi phục do quản trị hạ tầng cấu hình khi triển khai (pg_dump / PITR).
        </p>
      </Modal>
      <AiSettings open={panel === 'ai'} onClose={() => setPanel(null)} ai={d.ai} canManage={d.canManage} />
      <Modal open={panel === 'privacy'} onClose={() => setPanel(null)} title="Bảo vệ dữ liệu cá nhân">
        <ul style={{ paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
          <li>Không đưa PII thô vào sự kiện, broker hay nhật ký (kiểm tra tự động).</li>
          <li>Mật khẩu băm Argon2id; mã OTP chỉ lưu dạng băm có khóa.</li>
          <li>
            Phiên web dùng cookie HttpOnly, Secure, SameSite; ứng dụng di động lưu token trong kho bảo mật của
            thiết bị.
          </li>
          <li>Mọi truy vấn được kiểm tra quyền theo tổ chức, pháp nhân và hành động phía máy chủ.</li>
        </ul>
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── Bảo mật tài khoản (02 · quản lý tài khoản và thiết bị) ─────────
export function SecurityPage() {
  const toast = useToast();
  const { me, signOut } = useSession();
  const sessions = useQuery('auth.listSessions');
  const revoke = useMutation('auth.revokeSession');
  const change = useMutation('auth.changePassword', { silent: true });
  const setup = useMutation('auth.setupTotp', { silent: true });
  const enable = useMutation('auth.enableTotp', { silent: true });
  const disable = useMutation('auth.disableTotp', { silent: true });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [totp, setTotp] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState('');
  const period = usePeriodLabel();
  const { refresh } = useSession();
  return (
    <div className="page">
      <PageHeader
        eyebrow="Quản trị"
        title="Bảo mật tài khoản"
        subtitle="Mật khẩu, xác thực nhiều lớp và thiết bị đăng nhập."
        period={period}
      />
      <div className="grid split-even">
        <Card title="Đổi mật khẩu" subtitle="Cần mật khẩu hiện tại · các phiên khác sẽ bị đăng xuất">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await change.mutate({ currentPassword: pw.current, newPassword: pw.next });
                toast('success', 'Đã đổi mật khẩu');
                setPw({ current: '', next: '' });
              } catch {
                /* inline */
              }
            }}
          >
            <PasswordInput
              label="Mật khẩu hiện tại"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              error={change.error?.details?.field === 'currentPassword' ? change.error.message : undefined}
            />
            <PasswordInput
              label="Mật khẩu mới"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              hint="Sử dụng ít nhất 12 ký tự."
              error={change.error?.details?.field === 'newPassword' ? change.error.message : undefined}
            />
            <Button
              type="submit"
              variant="primary"
              loading={change.loading}
              disabled={!pw.current || pw.next.length < 12}
            >
              Cập nhật mật khẩu
            </Button>
          </form>
        </Card>
        <Card
          title="Xác thực nhiều lớp (TOTP)"
          subtitle="Dùng Google Authenticator, Microsoft Authenticator…"
        >
          {me?.user.mfaEnabled ? (
            <>
              <Chip tone="success" icon={<ShieldCheck size={13} />}>
                Đã bật xác thực nhiều lớp
              </Chip>
              <div className="field mt-16">
                <span className="field-label">Nhập mã hiện tại để tắt</span>
                <OtpInput value={code} onChange={setCode} />
              </div>
              <Button
                variant="danger"
                loading={disable.loading}
                disabled={code.length !== 6}
                onClick={async () => {
                  try {
                    await disable.mutate({ code });
                    await refresh();
                    setCode('');
                    toast('success', 'Đã tắt xác thực nhiều lớp');
                  } catch (e) {
                    toast('error', e instanceof Error ? e.message : 'Không tắt được');
                  }
                }}
              >
                Tắt TOTP
              </Button>
            </>
          ) : totp ? (
            <>
              <p className="small muted">Thêm tài khoản thủ công trong ứng dụng xác thực bằng khóa:</p>
              <code
                style={{
                  display: 'block',
                  background: 'var(--soft)',
                  padding: 10,
                  borderRadius: 8,
                  wordBreak: 'break-all',
                  margin: '10px 0',
                }}
              >
                {totp.secret}
              </code>
              <a href={totp.url} className="small">
                Mở bằng ứng dụng xác thực trên thiết bị này
              </a>
              <div className="field mt-16">
                <span className="field-label">Nhập mã 6 số để xác nhận</span>
                <OtpInput value={code} onChange={setCode} />
              </div>
              {enable.error && <ErrorNote error={enable.error} />}
              <Button
                variant="primary"
                loading={enable.loading}
                disabled={code.length !== 6}
                onClick={async () => {
                  try {
                    await enable.mutate({ code });
                    await refresh();
                    setTotp(null);
                    setCode('');
                    toast('success', 'Đã bật xác thực nhiều lớp');
                  } catch {
                    /* inline */
                  }
                }}
              >
                Bật TOTP
              </Button>
            </>
          ) : (
            <>
              <p className="muted small mb-16">
                Khi bật, đăng nhập và thao tác nhạy cảm (phê duyệt lớn, chốt kỳ) yêu cầu mã từ ứng dụng xác
                thực.
              </p>
              <Button
                variant="primary"
                icon={<KeyRound size={18} />}
                loading={setup.loading}
                onClick={async () => {
                  const r = await setup.mutate();
                  setTotp({ secret: r.secret, url: r.otpauthUrl });
                }}
              >
                Thiết lập TOTP
              </Button>
            </>
          )}
        </Card>
      </div>
      <Card
        className="mt-24"
        title="Phiên đăng nhập"
        subtitle="Thu hồi phiên trên thiết bị không còn sử dụng"
      >
        {sessions.data && (
          <DataTable
            rows={sessions.data}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'c',
                header: 'Kênh',
                render: (r) =>
                  (r.channel === 'mobile' ? 'Ứng dụng di động' : 'Web') + (r.current ? ' · phiên này' : ''),
                strong: true,
              },
              { key: 'u', header: 'Thiết bị', render: (r) => (r.userAgent || '—').slice(0, 60) },
              {
                key: 'l',
                header: 'Hoạt động gần nhất',
                render: (r) =>
                  new Date(Date.parse(r.lastSeenAt) + 7 * 3600e3)
                    .toISOString()
                    .replace('T', ' ')
                    .slice(0, 16),
              },
              {
                key: 'a',
                header: 'Mức xác thực',
                render: (r) => (
                  <Chip tone={r.aal === 2 ? 'success' : 'neutral'}>
                    {r.aal === 2 ? 'Đa lớp' : 'Mật khẩu'}
                  </Chip>
                ),
              },
              {
                key: 'x',
                header: '',
                render: (r) =>
                  r.current ? (
                    <button className="link-btn" onClick={() => void signOut()}>
                      Đăng xuất
                    </button>
                  ) : (
                    <button
                      className="link-btn"
                      onClick={async () => {
                        await revoke.mutate({ sessionId: r.id });
                        toast('success', 'Đã thu hồi phiên');
                      }}
                    >
                      Thu hồi
                    </button>
                  ),
              },
            ]}
          />
        )}
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── Tất cả phân hệ ─────────
export function ModulesPage() {
  const navigate = useNavigate();
  const { backend } = useBackend();
  const { ctx } = useSession();
  const period = usePeriodLabel();
  const groups = [
    {
      code: 'Nền tảng',
      items: [
        {
          to: '/documents',
          icon: Boxes,
          t: 'Chứng từ & nhập dữ liệu',
          s: 'Tiếp nhận, trích xuất, kiểm tra, lưu phiên bản',
        },
        {
          to: '/reconciliation',
          icon: GitCompareArrows,
          t: 'Đối soát đa nguồn',
          s: 'Ghép M:N đơn – tiền – phí – chứng từ',
        },
        {
          to: '/close',
          icon: Lock,
          t: 'Chốt kỳ & Decision Pack',
          s: 'Phê duyệt, snapshot theo kỳ và bằng chứng',
        },
        {
          to: '/evidence',
          icon: ShieldCheck,
          t: 'Bằng chứng toàn vẹn',
          s: 'Merkle root, biên nhận, kiểm chứng hồ sơ',
        },
      ],
    },
    {
      code: 'G1 · Cửa hàng / hộ kinh doanh',
      items: [
        {
          to: '/daily-close',
          icon: Store,
          t: 'Chốt ca & chốt ngày',
          s: 'Tiền tại quầy, chuyển khoản, nền tảng',
        },
        { to: '/inventory', icon: Boxes, t: 'Kho & giá thành', s: 'Định mức, hao hụt, giá vốn' },
        { to: '/purchasing', icon: Truck, t: 'Mua hàng & công nợ', s: 'Đơn mua, hạn trả, đề nghị chi' },
        { to: '/books', icon: History, t: 'Sổ sách & thuế', s: 'Sổ, bản kê nháp theo cấu hình' },
      ],
    },
    {
      code: 'G2 · Kế toán / thương mại',
      items: [
        { to: '/clients', icon: Handshake, t: 'Không gian khách hàng', s: 'Ủy quyền có hạn và phạm vi' },
        {
          to: '/sales',
          icon: ChartColumn,
          t: 'Bán hàng & thu nợ',
          s: 'Cơ hội → hợp đồng → giao nhận → thu nợ',
        },
      ],
    },
    {
      code: 'G3 · Dự án / logistics',
      items: [
        { to: '/projects', icon: FolderKanban, t: 'Dự án & công việc', s: 'WBS, ngân sách, cam kết chi' },
        {
          to: '/finance',
          icon: ChartColumn,
          t: 'Phân tích tài chính',
          s: 'NPV, IRR, hoàn vốn, DSCR, kịch bản',
        },
        { to: '/assets', icon: Zap, t: 'Tài sản & đo lường', s: 'Vận hành, bảo trì, M&V năng lượng' },
        { to: '/logistics', icon: Truck, t: 'Logistics', s: 'Sự kiện lô hàng, free time, landed cost' },
      ],
    },
    {
      code: 'G4 · Nhóm công ty',
      items: [
        { to: '/group', icon: Network, t: 'Điều hành tập đoàn', s: 'Pháp nhân, tiến độ dữ liệu kỳ' },
        {
          to: '/intercompany',
          icon: GitCompareArrows,
          t: 'Đối soát nội bộ',
          s: 'Cặp giao dịch, lệch kỳ / FX, loại trừ nháp',
        },
      ],
    },
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Phân hệ"
        title="Tất cả phân hệ"
        subtitle={`Gói nghiệp vụ đang dùng: ${ctx?.tenant.settings.packages.join(', ') ?? ''}`}
        period={period}
      />
      {groups.map((g) => (
        <section key={g.code} className="mb-16">
          <h2 className="eyebrow" style={{ margin: '18px 0 12px' }}>
            {g.code}
          </h2>
          <div className="grid grid-2">
            {g.items.map((it) => (
              <button
                key={it.to}
                className="choice"
                style={{ marginBottom: 0 }}
                onClick={() => navigate(it.to)}
              >
                <it.icon size={22} color="#087452" />
                <span>
                  <div className="choice-title">{it.t}</div>
                  <div className="choice-sub">{it.s}</div>
                </span>
                <ChevronRight size={16} color="#536978" />
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="small muted mt-24">Chế độ chạy: {backend.info.label}</p>
      <PageFoot />
    </div>
  );
}
