import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Landmark, Lock, RefreshCw, ShieldCheck, Store, Unplug } from 'lucide-react';
import type { ProviderInfo } from '@argolet/app';
import { formatShortDateTime } from '@argolet/core';
import { useMutation, useQuery, type OpResult } from '../api/hooks';
import {
  Alert,
  Button,
  Card,
  Chip,
  DataTable,
  ErrorNote,
  Modal,
  PageHeader,
  PageLoading,
  TextInput,
  useToast,
} from '../ui/components';
import { usePeriodLabel } from './overview';

type Conn = OpResult<'connections.list'>['connections'][number];

const STATUS = {
  ACTIVE: { tone: 'success', label: 'Đang hoạt động' },
  ERROR: { tone: 'danger', label: 'Lỗi kết nối' },
  DISCONNECTED: { tone: 'neutral', label: 'Đã ngắt' },
} as const;
const RUN = {
  SUCCESS: { tone: 'success', label: 'Thành công' },
  NO_CHANGE: { tone: 'neutral', label: 'Không có mới' },
  FAILED: { tone: 'danger', label: 'Thất bại' },
} as const;
const TRIGGER = { MANUAL: 'Đồng bộ', SCHEDULE: 'Tự động', TEST: 'Kiểm tra' } as const;

/** Connect form: credentials are sent once, checked with the partner, then sealed on the server. */
function ConnectModal({ provider, onClose }: { provider: ProviderInfo | null; onClose: () => void }) {
  const toast = useToast();
  const connect = useMutation('connections.connect', { silent: true });
  const [values, setValues] = useState<Record<string, string>>({});
  if (!provider) return null;
  const missing = provider.fields.some((f) => !(values[f.key] ?? '').trim());
  const close = () => {
    setValues({});
    connect.reset();
    onClose();
  };
  return (
    <Modal
      open
      onClose={close}
      title={`Kết nối ${provider.name}`}
      width={560}
      footer={
        <>
          <Button onClick={close}>Huỷ</Button>
          <Button
            variant="primary"
            icon={<ShieldCheck size={16} />}
            loading={connect.loading}
            disabled={missing}
            onClick={async () => {
              try {
                const r = await connect.mutate({ provider: provider.provider, credentials: values });
                toast('success', r.run.message);
                close();
              } catch {
                /* shown below */
              }
            }}
          >
            Kiểm tra & kết nối
          </Button>
        </>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {provider.howTo}{' '}
        <a href={provider.docsUrl} target="_blank" rel="noreferrer">
          Tài liệu của đối tác <ExternalLink size={12} aria-hidden />
        </a>
      </p>
      {provider.fields.map((f) => (
        <TextInput
          key={f.key}
          label={f.label}
          type={f.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          placeholder={f.placeholder}
          hint={f.help || undefined}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
        />
      ))}
      <div className="conn-secure small">
        <Lock size={14} aria-hidden />
        <span>
          ARGOLET kiểm tra ngay với {provider.name.replace(/^.* qua /, '')}, rồi mã hóa khóa bằng AES-256 trên
          máy chủ. Khóa không bao giờ hiển thị lại và không gửi về trình duyệt.
        </span>
      </div>
      {connect.error && <ErrorNote error={connect.error} />}
    </Modal>
  );
}

function ConnectionCard({ c, provider }: { c: Conn; provider: ProviderInfo | undefined }) {
  const navigate = useNavigate();
  const toast = useToast();
  const sync = useMutation('connections.sync', { silent: true });
  const test = useMutation('connections.test', { silent: true });
  const disconnect = useMutation('connections.disconnect', { silent: true });
  const [confirming, setConfirming] = useState(false);
  const Icon = provider?.kind === 'BANK' ? Landmark : Store;
  const active = c.status !== 'DISCONNECTED';
  return (
    <Card
      title={
        <span className="row" style={{ gap: 8 }}>
          <Icon size={18} aria-hidden /> {c.label}
        </span>
      }
      subtitle={`Khóa ${c.secretHint}, kết nối bởi ${c.connectedByName}, ${formatShortDateTime(c.connectedAt)}`}
      actions={<Chip tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Chip>}
    >
      {c.lastError && c.status === 'ERROR' && (
        <div className="mb-16">
          <Alert tone="danger" title="Lần gần nhất không thành công">
            {c.lastError}
          </Alert>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 0 }}>
        {c.lastSyncAt
          ? `Đồng bộ gần nhất ${formatShortDateTime(c.lastSyncAt)}, lần sau lấy tiếp từ điểm đã dừng`
          : 'Chưa đồng bộ: lần đầu lấy dữ liệu từ đầu kỳ hiện tại'}
      </p>
      {active && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            icon={<RefreshCw size={16} />}
            loading={sync.loading}
            onClick={async () => {
              try {
                const r = await sync.mutate({ connectionId: c.id });
                toast(r.status === 'FAILED' ? 'error' : 'success', r.message);
              } catch (e) {
                toast('error', e instanceof Error ? e.message : 'Đồng bộ không thành công');
              }
            }}
          >
            Đồng bộ ngay
          </Button>
          <Button
            loading={test.loading}
            onClick={async () => {
              try {
                const r = await test.mutate({ connectionId: c.id });
                toast('success', r.message);
              } catch (e) {
                toast('error', e instanceof Error ? e.message : 'Kiểm tra không thành công');
              }
            }}
          >
            Kiểm tra kết nối
          </Button>
          <Button variant="ghost" icon={<Unplug size={16} />} onClick={() => setConfirming(true)}>
            Ngắt kết nối
          </Button>
        </div>
      )}
      {c.runs.length > 0 && (
        <div className="mt-16">
          <DataTable
            rows={c.runs}
            rowKey={(r) => r.id}
            columns={[
              { key: 'at', header: 'Thời điểm', render: (r) => formatShortDateTime(r.startedAt) },
              { key: 'kind', header: 'Loại', render: (r) => TRIGGER[r.trigger] },
              {
                key: 'status',
                header: 'Kết quả',
                render: (r) => <Chip tone={RUN[r.status].tone}>{RUN[r.status].label}</Chip>,
              },
              { key: 'n', header: 'Bản ghi', align: 'right', render: (r) => `${r.imported}/${r.fetched}` },
              {
                key: 'doc',
                header: 'Chứng từ',
                render: (r) =>
                  r.documentId ? (
                    <button
                      className="link-btn"
                      onClick={() => navigate(`/documents/${r.documentId}/review`)}
                    >
                      {r.documentCode}
                    </button>
                  ) : (
                    'Chưa có'
                  ),
              },
              { key: 'msg', header: 'Ghi chú', render: (r) => <span className="small">{r.message}</span> },
            ]}
          />
        </div>
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Ngắt ${c.label}?`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Huỷ</Button>
            <Button
              variant="danger"
              loading={disconnect.loading}
              onClick={async () => {
                await disconnect.mutate({ connectionId: c.id });
                setConfirming(false);
                toast('success', `Đã ngắt ${c.label}`);
              }}
            >
              Ngắt và xoá khóa
            </Button>
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          ARGOLET xoá khóa đã lưu và ngừng lấy dữ liệu. Chứng từ đã nhận và lịch sử đồng bộ vẫn được giữ.
        </p>
      </Modal>
    </Card>
  );
}

// ───────── Kết nối API đối tác ─────────
export function ConnectionsPage() {
  const q = useQuery('connections.list');
  const period = usePeriodLabel();
  const [connecting, setConnecting] = useState<ProviderInfo | null>(null);
  if (!q.data)
    return q.error ? (
      <div className="page">
        <ErrorNote error={q.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = q.data;
  const live = d.connections.filter((c) => c.status !== 'DISCONNECTED');
  const past = d.connections.filter((c) => c.status === 'DISCONNECTED');
  return (
    <div className="page">
      <PageHeader
        eyebrow="Quản trị"
        title="Kết nối API"
        subtitle="Tự lấy giao dịch ngân hàng và hóa đơn bán hàng từ đối tác."
        period={period}
      />
      {!d.serverReady && (
        <div className="mb-16">
          <Alert tone="info">Kết nối đối tác hoạt động khi dùng ARGOLET trên máy chủ.</Alert>
        </div>
      )}
      {live.map((c) => (
        <div className="mb-16" key={c.id}>
          <ConnectionCard c={c} provider={d.providers.find((p) => p.provider === c.provider)} />
        </div>
      ))}
      <Card title="Thêm kết nối">
        <div className="conn-grid">
          {d.providers.map((p) => {
            const Icon = p.kind === 'BANK' ? Landmark : Store;
            const has = live.some((c) => c.provider === p.provider);
            return (
              <div key={p.provider} className="conn-tile">
                <div className="row" style={{ gap: 8 }}>
                  <Icon size={20} aria-hidden />
                  <strong>{p.name}</strong>
                </div>
                <p className="muted small">{p.description}</p>
                {p.available ? (
                  <Button
                    size="sm"
                    variant={has ? 'default' : 'primary'}
                    disabled={!d.serverReady}
                    onClick={() => setConnecting(p)}
                  >
                    {has ? 'Thêm tài khoản khác' : 'Kết nối'}
                  </Button>
                ) : (
                  <Chip tone="warning">Cần tài liệu từ đối tác</Chip>
                )}
              </div>
            );
          })}
        </div>
      </Card>
      {past.length > 0 && (
        <p className="muted small mt-16">
          Đã ngắt: {past.map((c) => `${c.label} (${formatShortDateTime(c.connectedAt)})`).join(', ')}
        </p>
      )}
      <ConnectModal provider={connecting} onClose={() => setConnecting(null)} />
    </div>
  );
}
