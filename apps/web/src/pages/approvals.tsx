import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleCheck, Download, Lock, ShieldCheck } from 'lucide-react';
import { formatShortDateTime } from '@argolet/core';
import { ApiError } from '../api/backend';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import {
  Alert,
  Button,
  Card,
  CheckItem,
  Chip,
  DataTable,
  ErrorNote,
  KeyValues,
  KpiRow,
  Modal,
  PageHeader,
  PageLoading,
  Timeline,
  downloadBase64,
  useToast,
} from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';

// ───────── 16 · Phê duyệt hồ sơ ─────────
export function ApprovalPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { withStepUp } = useSession();
  const data = useQuery('approvals.get', { approvalId: id });
  const decide = useMutation('approvals.decide', { silent: true });
  const [changes, setChanges] = useState(false);
  const [comment, setComment] = useState('');
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const { approval: a, canDecide, blockedReason, roleNote } = data.data;
  const act = async (decision: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES') => {
    try {
      await withStepUp(() =>
        decide.mutate({ approvalId: a.id, decision, digest: a.digest, comment: comment || undefined }),
      );
      toast(
        'success',
        decision === 'APPROVE'
          ? 'Đã phê duyệt hồ sơ'
          : decision === 'REJECT'
            ? 'Đã từ chối hồ sơ'
            : 'Đã gửi yêu cầu bổ sung',
      );
      setChanges(false);
      navigate('/inbox');
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED'))
        toast('error', e instanceof Error ? e.message : 'Không thực hiện được');
    }
  };
  const timeline = [
    ...a.timeline.map((t) => ({ title: t.title, sub: `${t.by} · ${formatShortDateTime(t.at)}`, done: true })),
    ...(a.status === 'PENDING'
      ? [
          {
            title: 'Chờ phê duyệt',
            sub: `${canDecide ? 'Bạn' : 'Người có quyền'} · Đến hạn ${a.dueDate === new Date().toISOString().slice(0, 10) ? 'hôm nay' : a.dueDate.split('-').reverse().join('/')}`,
            done: false,
          },
        ]
      : []),
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Phê duyệt hồ sơ"
        subtitle="Đủ thông tin trước khi xác nhận quyết định."
        period={period}
      />
      <div className="grid split-main">
        <Card>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{a.title}</h2>
          <div className="mt-16">
            <Chip tone={a.status === 'PENDING' ? 'warning' : a.status === 'APPROVED' ? 'success' : 'danger'}>
              {a.statusLabel}
            </Chip>
          </div>
          <div
            className="num"
            style={{ fontSize: 34, fontWeight: 700, color: 'var(--brand)', margin: '22px 0 12px' }}
          >
            {a.amountLabel}
          </div>
          <p className="muted">{a.entityLabel}</p>
          <div className="mt-24">
            <KeyValues rows={a.details.map((d) => ({ label: d.label, value: d.value }))} />
          </div>
          <p className="small muted mt-16">
            Dấu nội dung trình duyệt: <code>{a.digest.slice(0, 16)}…</code> · phiên bản {a.targetVersion} ·{' '}
            {a.policyVersion}
          </p>
          {blockedReason && (
            <div className="mt-16">
              <Alert tone="info">{blockedReason}</Alert>
            </div>
          )}
          {decide.error && (
            <div className="mt-16">
              <ErrorNote error={decide.error} />
            </div>
          )}
          {canDecide && (
            <div className="grid grid-2" style={{ marginTop: 40 }}>
              <Button onClick={() => setChanges(true)}>Yêu cầu bổ sung</Button>
              <Button
                variant="primary"
                icon={<CircleCheck size={18} />}
                loading={decide.loading}
                onClick={() => act('APPROVE')}
              >
                Phê duyệt hồ sơ
              </Button>
            </div>
          )}
          {a.status !== 'PENDING' && a.comment && <p className="muted small mt-16">Ghi chú: {a.comment}</p>}
        </Card>
        <Card title="Luồng phê duyệt">
          <div className="mt-16">
            <Timeline items={timeline} />
          </div>
          <div className="note-box">{roleNote}</div>
        </Card>
      </div>
      <Modal
        open={changes}
        onClose={() => setChanges(false)}
        title="Yêu cầu bổ sung / từ chối"
        footer={
          <>
            <Button
              variant="danger"
              disabled={!comment.trim()}
              loading={decide.loading}
              onClick={() => act('REJECT')}
            >
              Từ chối
            </Button>
            <Button
              variant="primary"
              disabled={!comment.trim()}
              loading={decide.loading}
              onClick={() => act('REQUEST_CHANGES')}
            >
              Gửi yêu cầu bổ sung
            </Button>
          </>
        }
      >
        <p className="muted small mb-16">Nội dung sẽ được gửi cho {a.requesterName} và lưu cùng hồ sơ.</p>
        <textarea
          className="textarea"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Ví dụ: Bổ sung hóa đơn VAT bản gốc"
          aria-label="Nội dung"
        />
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 17 · Chốt kỳ dữ liệu ─────────
export function ClosePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx, withStepUp } = useSession();
  const sites = ctx?.entities.filter((e) => e.kind === 'SITE') ?? [];
  const [entityId, setEntityId] = useState<string | undefined>(
    ctx?.scope.entityId !== '*' ? ctx?.scope.entityId : undefined,
  );
  const data = useQuery('close.status', { entityId });
  const close = useMutation('close.close', { silent: true });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const s = data.data;
  const doClose = async () => {
    try {
      const r = await withStepUp(() =>
        close.mutate({ entityId: s.entityId, periodId: s.periodId, digest: s.draftDigest }),
      );
      toast('success', `Đã chốt kỳ · ${r.closeId}`);
      setConfirmOpen(false);
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'CANCELLED'))
        toast('error', e instanceof Error ? e.message : 'Không chốt được kỳ');
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Chốt kỳ dữ liệu"
        subtitle="Rà soát điều kiện và xác nhận phạm vi chốt."
        period={period}
      />
      <div className="grid split-main">
        <Card>
          <div className="row-between wrap">
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>{s.periodLabel}</h2>
            {sites.length > 1 && (
              <select
                className="select"
                style={{ width: 200, height: 40 }}
                value={s.entityId}
                onChange={(e) => setEntityId(e.target.value)}
                aria-label="Cơ sở chốt kỳ"
              >
                {sites.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="muted mt-16">Phạm vi: {s.scopeLabel}</p>
          <div className="mt-16">
            {s.status === 'CLOSED' ? (
              <Chip tone="success" icon={<Lock size={12} />}>
                Đã chốt ·{' '}
                {s.snapshot?.evidenceStatus === 'ANCHORED' ? 'bằng chứng đã neo' : 'đang tạo bằng chứng'}
              </Chip>
            ) : s.blocking > 0 ? (
              <Chip tone="warning">Cần hoàn tất {s.blocking} việc trước khi chốt</Chip>
            ) : (
              <Chip tone="success">Đủ điều kiện chốt kỳ</Chip>
            )}
          </div>
          <div className="mt-24">
            {s.checklist.map((c) => (
              <CheckItem key={c.key} done={c.done || s.status === 'CLOSED'} title={c.title} sub={c.detail} />
            ))}
          </div>
          {s.snapshot && (
            <div className="mt-16">
              <Alert tone="success" title={`Bộ chốt ${s.snapshot.closeId} · phiên bản ${s.snapshot.version}`}>
                Dấu manifest {s.snapshot.digest.slice(0, 16)}… · doanh thu{' '}
                {Number(s.snapshot.totals.revenue ?? 0).toLocaleString('vi-VN')} đ · chi phí{' '}
                {Number(s.snapshot.totals.expense ?? 0).toLocaleString('vi-VN')} đ
              </Alert>
            </div>
          )}
          {close.error && (
            <div className="mt-16">
              <ErrorNote error={close.error} />
            </div>
          )}
          <div className="grid grid-2" style={{ marginTop: 36 }}>
            {s.status === 'CLOSED' ? (
              <Button
                variant="primary"
                icon={<ShieldCheck size={18} />}
                onClick={() => navigate('/evidence')}
              >
                Xem bằng chứng bộ chốt
              </Button>
            ) : s.ready && s.canClose ? (
              <Button variant="primary" icon={<Lock size={18} />} onClick={() => setConfirmOpen(true)}>
                Chốt kỳ & lưu phiên bản
              </Button>
            ) : (
              <Button variant="primary" onClick={() => navigate('/inbox')} disabled={s.blocking === 0}>
                Mở {s.blocking} việc đang chờ
              </Button>
            )}
            <Button onClick={() => navigate('/decision-pack')}>Xem Decision Pack</Button>
          </div>
          {!s.canClose && s.status !== 'CLOSED' && (
            <p className="muted small mt-8">
              Vai trò hiện tại không có quyền chốt kỳ; người duyệt hoặc kế toán trưởng sẽ thực hiện.
            </p>
          )}
        </Card>
        <Card title="Trình tự chốt kỳ">
          <div className="mt-16">
            <Timeline
              items={[
                {
                  title: 'Rà soát dữ liệu',
                  sub: 'Chứng từ · Đối soát · Phê duyệt',
                  done: s.blocking === 0 || s.status === 'CLOSED',
                },
                {
                  title: 'Xác nhận phạm vi',
                  sub: 'Đơn vị · Kỳ · Người có quyền',
                  done: s.status === 'CLOSED',
                },
                {
                  title: 'Lưu phiên bản chốt',
                  sub: 'Bằng chứng và lịch sử truy vết',
                  done: s.status === 'CLOSED',
                },
              ]}
            />
          </div>
          <div className="note-box">{s.roleNote}</div>
        </Card>
      </div>
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Xác nhận chốt kỳ"
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>Hủy</Button>
            <Button variant="primary" loading={close.loading} onClick={doClose}>
              Xác nhận chốt
            </Button>
          </>
        }
      >
        <p>
          Chốt <b>{s.periodLabel.toLowerCase()}</b> cho <b>{s.scopeLabel}</b>. Sau khi chốt, số liệu được khóa
          theo phiên bản, ghi phê duyệt, tạo manifest và neo Merkle root lên mạng có cấp quyền.
        </p>
        <p className="small muted mt-16">
          Dấu số liệu đang rà soát: {s.draftDigest.slice(0, 24)}… · Chính sách yêu cầu xác thực bổ sung.
        </p>
      </Modal>
      <PageFoot />
    </div>
  );
}

// ───────── 39 · Bộ hồ sơ quyết định ─────────
export function DecisionPackPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery('close.decisionPack', {});
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
        eyebrow="Nền tảng"
        title="Bộ hồ sơ quyết định"
        subtitle="Decision Pack · Số liệu và căn cứ theo đơn vị, kỳ và phiên bản."
        period={period}
      />
      <KpiRow
        items={[
          { label: 'Doanh thu trong kỳ', value: d.kpis.revenueLabel, note: d.scopeLabel },
          { label: 'Chi phí đã ghi nhận', value: d.kpis.expenseLabel, note: 'Có nguồn và phiên bản' },
          { label: 'Dòng tiền thuần', value: d.kpis.netLabel, note: d.kpis.netNote, highlight: true },
        ]}
      />
      <div className="grid split-main">
        <Card title="Số liệu & căn cứ">
          <Chip tone={d.status === 'CLOSED' ? 'success' : 'warning'}>{d.statusLabel}</Chip>
          <div className="mt-24">
            <DataTable
              rows={d.rows}
              rowKey={(r) => r.label}
              columns={[
                { key: 'l', header: 'Nội dung', render: (r) => r.label, strong: true },
                { key: 'v', header: 'Giá trị / trạng thái', render: (r) => r.value, align: 'right' },
                { key: 's', header: 'Nguồn', render: (r) => r.source },
              ]}
            />
          </div>
        </Card>
        <Card title="Điều kiện khóa bộ chốt">
          {d.conditions.map((c) => (
            <CheckItem key={c.title} done={c.done} title={c.title} sub={c.detail} />
          ))}
        </Card>
      </div>
      <div className="row-between wrap mt-24">
        <div className="row wrap">
          <Button
            variant="primary"
            icon={<Download size={18} />}
            onClick={() => {
              downloadBase64(d.export.filename, d.export.contentBase64, d.export.mime);
              toast('success', `Đã xuất ${d.export.filename}`);
            }}
          >
            {d.status === 'CLOSED' ? 'Xuất Decision Pack' : 'Xuất Decision Pack nháp'}
          </Button>
          <Button onClick={() => navigate('/inbox')} disabled={d.pendingApprovals === 0}>
            Hoàn tất việc chờ duyệt
          </Button>
        </div>
        <Button onClick={() => navigate('/close')}>Xem quy trình chốt kỳ</Button>
      </div>
      <PageFoot />
    </div>
  );
}
