import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CircleCheck, GitMerge, Landmark, ListFilter, Package, Play, Send, Receipt } from 'lucide-react';
import { D, formatSignedVnd, formatVnd } from '@argolet/core';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import {
  Alert,
  Button,
  Card,
  Chip,
  DataTable,
  ErrorNote,
  KpiRow,
  Modal,
  PageHeader,
  PageLoading,
  Pagination,
  SearchBox,
  useToast,
} from '../ui/components';
import { useListState, useSearchText } from '../ui/paging';
import { PageFoot, usePeriodLabel } from './overview';

// ───────── 14 · Đối soát đa nguồn ─────────
export function ReconPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useListState(20);
  const [q, setQ] = useSearchText(list);
  const filter = list.get('filter') as '' | 'review' | 'done';
  const data = useQuery(
    'recon.summary',
    { q: list.get('q') || undefined, filter: filter || undefined, page: list.page, pageSize: list.pageSize },
    { keepPrevious: true },
  );
  const run = useMutation('recon.run');
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
        title="Đối soát đa nguồn"
        subtitle="Nối đơn hàng, tiền thực nhận và phí."
        period={period}
      />
      <KpiRow
        items={[
          { label: 'Nhóm đã khớp', value: d.kpis.matched },
          { label: 'Cần xác nhận', value: d.kpis.toConfirm },
          { label: 'Chênh lệch cần xem', value: d.kpis.discrepancies },
        ]}
        action={
          <>
            {d.canRun && (
              <Button
                icon={<Play size={16} />}
                loading={run.loading}
                onClick={async () => {
                  const r = await run.mutate({});
                  if (r.groups) toast('success', `Động cơ đối soát đề xuất ${r.groups} nhóm mới`);
                  else if (r.pendingSources)
                    toast(
                      'info',
                      `Có ${r.pendingSources} tệp đơn hàng / sao kê chưa được xác nhận. Xác nhận trong mục Chứng từ rồi chạy lại.`,
                    );
                  else
                    toast(
                      'info',
                      r.unmatchedOrders
                        ? `Không có giao dịch mới để ghép · ${r.unmatchedOrders} đơn đang chờ tiền về`
                        : 'Không có giao dịch mới để ghép',
                    );
                }}
              >
                Chạy đối soát
              </Button>
            )}
            <Button
              variant="primary"
              icon={<GitMerge size={18} />}
              disabled={!d.firstOpenId}
              onClick={() => d.firstOpenId && navigate(`/match/${d.firstOpenId}`)}
            >
              Ghép nhiều–nhiều
            </Button>
          </>
        }
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <div className="row">
            <ListFilter size={18} color="#536978" aria-hidden />
            <label className="sr-only" htmlFor="recon-filter">
              Lọc
            </label>
            <select
              id="recon-filter"
              className="select"
              style={{ height: 44, width: 180 }}
              value={filter}
              onChange={(e) => list.setFilter('filter', e.target.value)}
            >
              <option value="">Tất cả nhóm</option>
              <option value="review">Cần xử lý</option>
              <option value="done">Đã xác nhận</option>
            </select>
          </div>
        </div>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/reconciliation/${r.id}`)}
          columns={[
            { key: 'label', header: 'Nhóm giao dịch', render: (r) => r.label, strong: true },
            { key: 'source', header: 'Nguồn', render: (r) => r.source },
            { key: 'gross', header: 'Giá trị đơn', render: (r) => r.grossLabel, align: 'right' },
            { key: 'received', header: 'Thực nhận', render: (r) => r.receivedLabel, align: 'right' },
            {
              key: 'status',
              header: 'Trạng thái',
              render: (r) => <Chip tone={r.tone}>{r.statusLabel}</Chip>,
            },
          ]}
        />
        <Pagination
          page={d.page}
          pageCount={d.pageCount}
          total={d.total}
          pageSize={d.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          unit="nhóm"
          busy={data.fetching}
        />
      </Card>
      <PageFoot />
    </div>
  );
}

function useGroupActions(groupId: string, digest: string | undefined, residual: string | undefined) {
  const toast = useToast();
  const confirm = useMutation('recon.confirm', { silent: true });
  const submit = useMutation('recon.submitForApproval', { silent: true });
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const doConfirm = async () => {
    if (residual && !D(residual).isZero() && !note) {
      setNoteOpen(true);
      return;
    }
    try {
      await confirm.mutate({ groupId, digest: digest ?? '', note: note || undefined });
      toast('success', 'Đã xác nhận kết quả đối soát');
      setNoteOpen(false);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không xác nhận được');
    }
  };
  return { confirm, submit, noteOpen, setNoteOpen, note, setNote, doConfirm, toast };
}

// ───────── 15 · Chi tiết đối soát ─────────
export function ReconDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const data = useQuery('recon.getGroup', { groupId: id });
  const a = useGroupActions(id, data.data?.group.digest, data.data?.group.residual);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const { group: g, orders, receipts } = data.data;
  const deductions = D(g.fee).plus(g.refund).plus(g.discount);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Chi tiết đối soát"
        subtitle="Xem từng khoản và căn cứ của gợi ý ghép."
        period={period}
        actions={
          <Chip tone={g.status === 'CONFIRMED' ? 'success' : 'warning'}>
            {g.code} · {g.statusLabel}
          </Chip>
        }
      />
      <KpiRow
        items={[
          {
            label: `Tổng ${orders.length} đơn hàng`,
            value: formatVnd(g.gross),
            note: 'Giá trị đơn trước khi trừ phí',
          },
          { label: 'Phí nền tảng', value: formatVnd(deductions), note: g.feeRule },
          {
            label: 'Tiền thực nhận',
            value: formatVnd(g.received),
            note: `${receipts.length} giao dịch ${receipts[0]?.source.toLowerCase() ?? ''}`,
            highlight: true,
          },
        ]}
      />
      <div className="grid grid-3">
        <Card title="Đơn hàng" subtitle={`${orders.length} bản ghi nguồn`}>
          {orders.map((o) => (
            <div className="list-item" key={o.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
              <Package size={18} color="#536978" />
              <span>
                <div style={{ fontSize: 14 }}>{o.code}</div>
                <div className="li-sub">{o.dateLabel}</div>
              </span>
              <span className="strong num">{formatVnd(o.gross)}</span>
            </div>
          ))}
        </Card>
        <Card title="Phí & phân bổ" subtitle="Quy tắc phí đã chọn">
          <div className="kv">
            <div className="kv-row">
              <span className="k">Phí dịch vụ</span>
              <span className="v strong num">{formatVnd(g.fee)}</span>
            </div>
            <div className="kv-row">
              <span className="k">Hoàn tiền</span>
              <span className="v strong num">{formatVnd(g.refund)}</span>
            </div>
            <div className="kv-row">
              <span className="k">Tiền phải nhận</span>
              <span className="v strong num">{formatVnd(g.net)}</span>
            </div>
          </div>
          <p className="small muted mt-16">Phân bổ ({g.links.length} liên kết):</p>
          {g.links.map((l, i) => (
            <div key={i} className="row-between small" style={{ padding: '6px 0' }}>
              <span>
                {orders.find((o) => o.id === l.orderId)?.code} →{' '}
                {receipts.find((r) => r.id === l.txnId)?.code}
              </span>
              <span className="num">{formatVnd(l.amount)}</span>
            </div>
          ))}
        </Card>
        <Card
          title="Giao dịch tiền"
          subtitle={`${receipts.length} khoản nhận ${receipts.length > 1 ? 'theo đợt' : 'gộp'}`}
        >
          {receipts.map((r) => (
            <div className="list-item" key={r.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
              <Landmark size={18} color="#536978" />
              <span>
                <div style={{ fontSize: 14 }}>{r.code}</div>
                <div className="li-sub">
                  {r.source} · {r.dateLabel}
                </div>
              </span>
              <span className="strong num">{formatVnd(r.amount)}</span>
            </div>
          ))}
          <div className="mt-16">
            <Chip tone={D(g.residual).isZero() ? 'success' : 'warning'}>
              Chênh lệch còn lại: {formatVnd(g.residual)}
            </Chip>
          </div>
        </Card>
      </div>
      <Card className="mt-24" title="Căn cứ gợi ý ghép">
        <div className="row-between wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ maxWidth: 640 }}>
            <p className="muted" style={{ lineHeight: 1.7 }}>
              {g.basis.join('. ')}. Người có quyền cần xác nhận trước khi ghi nhận kết quả đối soát.
            </p>
            <p className="small muted mt-8">
              Điểm tương đồng {Math.round(g.score * 100)}% · {g.rulesVersion} · snapshot đầu vào{' '}
              {g.inputSnapshotVersion}
            </p>
          </div>
          <div className="row">
            {g.status === 'PROPOSED' && (
              <Button icon={<GitMerge size={18} />} onClick={() => navigate(`/match/${g.id}`)}>
                Mở ghép giao dịch
              </Button>
            )}
            {data.data.canConfirm && (
              <Button
                variant="primary"
                icon={<CircleCheck size={18} />}
                loading={a.confirm.loading}
                onClick={a.doConfirm}
              >
                Xác nhận đối soát
              </Button>
            )}
          </div>
        </div>
        {g.status === 'PENDING_APPROVAL' && (
          <div className="mt-16">
            <Alert tone="info">Nhóm đang chờ người có quyền phê duyệt trong hộp công việc.</Alert>
          </div>
        )}
      </Card>
      <NoteModal a={a} />
      <PageFoot />
    </div>
  );
}

function NoteModal({ a }: { a: ReturnType<typeof useGroupActions> }) {
  return (
    <Modal
      open={a.noteOpen}
      onClose={() => a.setNoteOpen(false)}
      title="Giải thích chênh lệch"
      footer={
        <>
          <Button onClick={() => a.setNoteOpen(false)}>Hủy</Button>
          <Button
            variant="primary"
            disabled={!a.note.trim()}
            loading={a.confirm.loading}
            onClick={a.doConfirm}
          >
            Xác nhận kèm giải thích
          </Button>
        </>
      }
    >
      <p className="muted small mb-16">
        Nhóm còn chênh lệch. Ghi rõ nguyên nhân (ví dụ: khách chuyển thiếu, phí chưa có chứng từ) để lưu vào
        căn cứ đối soát.
      </p>
      <textarea
        className="textarea"
        value={a.note}
        onChange={(e) => a.setNote(e.target.value)}
        aria-label="Giải thích"
      />
    </Modal>
  );
}

// ───────── 38 · Ghép giao dịch ─────────
export function MatchWorkspacePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();
  const data = useQuery('recon.getGroup', { groupId: id });
  const a = useGroupActions(id, data.data?.group.digest, data.data?.group.residual);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const { group: g, orders, receipts } = data.data;
  const deductions = D(g.fee).plus(g.refund).plus(g.discount);
  const submitApproval = async () => {
    try {
      await a.submit.mutate({ groupId: g.id });
      a.toast('success', `Đã gửi nhóm ${g.code} xin duyệt`);
      navigate('/inbox');
    } catch (e) {
      a.toast('error', e instanceof Error ? e.message : 'Không gửi được');
    }
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Ghép giao dịch"
        subtitle="Ghép đơn, khoản nhận, phí và chứng từ theo cùng một nhóm."
        period={period}
      />
      <KpiRow
        items={[
          {
            label: `Tổng ${orders.length} đơn hàng`,
            value: formatVnd(g.gross),
            note: `Nhóm ${g.code} · trước phí`,
          },
          {
            label: `${receipts.length} khoản tiền đã nhận`,
            value: formatVnd(g.received),
            note: receipts.map((r) => formatVnd(r.amount)).join(' + '),
          },
          {
            label: 'Chênh lệch sau phí',
            value: formatVnd(g.residual),
            note: `Phí nền tảng: ${formatVnd(deductions)}`,
            highlight: true,
          },
        ]}
      />
      <div className="grid split-even">
        <Card title="Đơn hàng & phí" subtitle="Nhiều bản ghi nguồn trong cùng nhóm ghép">
          {orders.map((o) => (
            <div className="list-item" key={o.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
              <Receipt size={16} color="#087452" />
              <span>{o.code}</span>
              <span className="strong num">{formatVnd(o.gross)}</span>
            </div>
          ))}
          <div className="list-item" style={{ gridTemplateColumns: '22px 1fr auto' }}>
            <Receipt size={16} color="#087452" />
            <span>Phí nền tảng</span>
            <span className="strong num">{formatSignedVnd(deductions.neg())}</span>
          </div>
        </Card>
        <Card
          title="Khoản nhận ngân hàng"
          subtitle={receipts.length > 1 ? 'Hai giao dịch cùng lô thanh toán' : 'Giao dịch theo lô thanh toán'}
        >
          {receipts.map((r) => (
            <div className="list-item" key={r.id} style={{ gridTemplateColumns: '22px 1fr auto' }}>
              <Landmark size={16} color="#087452" />
              <span>
                <div className="strong">{r.code}</div>
                <div className="li-sub">
                  {r.dateLabel} · Mã {r.reference}
                </div>
              </span>
              <span className="strong num">{formatVnd(r.amount)}</span>
            </div>
          ))}
          <div className="mt-16">
            <Chip tone={D(g.residual).isZero() ? 'success' : 'warning'}>
              {D(g.residual).isZero() ? 'Khớp tổng sau phí' : `Lệch ${formatVnd(D(g.residual).abs())}`}
            </Chip>
          </div>
        </Card>
      </div>
      <Card className="mt-24" title="Căn cứ ghép & xác nhận">
        <p className="muted" style={{ maxWidth: 640, lineHeight: 1.7 }}>
          Bộ tính đối chiếu {formatVnd(g.gross).replace(' đ', '')} − {formatVnd(deductions).replace(' đ', '')}{' '}
          = {receipts.map((r) => formatVnd(r.amount).replace(' đ', '')).join(' + ')}. Đơn, phí và{' '}
          {receipts.length === 1 ? 'khoản nhận' : `${receipts.length} khoản nhận`} giữ liên kết với bản gốc và
          phiên bản.
        </p>
        <div className="row-between wrap mt-16">
          <span className="small muted">
            AI đề xuất · Bộ tính xác định tính toán · Người có quyền xác nhận
          </span>
          <div className="row">
            {can('recon.confirm') && g.status !== 'CONFIRMED' && (
              <Button icon={<CircleCheck size={18} />} loading={a.confirm.loading} onClick={a.doConfirm}>
                Xác nhận ngay
              </Button>
            )}
            {g.status === 'PROPOSED' && can('approval.request') && (
              <Button
                variant="primary"
                icon={<Send size={18} />}
                loading={a.submit.loading}
                onClick={submitApproval}
              >
                Gửi nhóm ghép xin duyệt
              </Button>
            )}
          </div>
        </div>
        {g.status !== 'PROPOSED' && (
          <div className="mt-16">
            <Alert tone="info">Trạng thái hiện tại: {g.statusLabel}.</Alert>
          </div>
        )}
      </Card>
      <NoteModal a={a} />
      <PageFoot />
    </div>
  );
}
