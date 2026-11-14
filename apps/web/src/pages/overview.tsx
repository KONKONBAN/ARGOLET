import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChartColumn,
  ArrowUpRight,
  ChevronRight,
  CircleCheck,
  FileSearch,
  Files,
  GitCompareArrows,
  ListFilter,
  Plus,
} from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import { CashflowLineChart, ChartLegend } from '../ui/charts';
import {
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

export function usePeriodLabel(): string {
  const { ctx } = useSession();
  const p = ctx?.tenant.settings.currentPeriod ?? '';
  return p ? `Tháng ${Number(p.slice(5))}/${p.slice(0, 4)}` : '';
}

export function PageFoot() {
  const period = usePeriodLabel();
  return <p className="page-foot">ARGOLET · Đơn vị tiền: VND · Kỳ dữ liệu: {period.replace('Tháng ', '')}</p>;
}

// ───────── 09 · Tổng quan kinh doanh ─────────
export function OverviewPage() {
  const navigate = useNavigate();
  const q = useQuery('dashboard.overview');
  if (!q.data)
    return q.error ? (
      <div className="page">
        <ErrorNote error={q.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const o = q.data;
  const maxChannel = 250_000_000;
  const icons = [CircleCheck, GitCompareArrows, FileSearch];
  const totalTasks = o.tasks.filter((t) => t.count > 0).length;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Tổng quan kinh doanh"
        subtitle="Nắm tình hình, nhận biết việc cần làm tiếp theo."
        period={o.periodLabel}
        actions={
          <>
            <Button icon={<Files size={18} />} onClick={() => navigate('/decision-pack')}>
              Bộ hồ sơ
            </Button>
            <Button icon={<ChartColumn size={18} />} onClick={() => navigate('/finance-report')}>
              Tài chính
            </Button>
            {o.canCreate && (
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => navigate('/capture')}>
                Thêm chứng từ
              </Button>
            )}
          </>
        }
      />
      <section className="hero" aria-label="Dòng tiền trong kỳ">
        {[
          {
            label: 'Dòng tiền thuần',
            value: o.netLabel,
            note: `Doanh thu − chi phí · ${o.periodLabel}`,
            net: true,
          },
          { label: 'Doanh thu', value: o.revenueLabel, note: o.revenueNote },
          { label: 'Chi phí', value: o.expenseLabel, note: o.expenseNote },
        ].map((x) => (
          <div key={x.label} className="hero-col">
            <div className="hero-label">{x.label}</div>
            <div className={`hero-value num${x.net ? ' net' : ''}`}>{x.value}</div>
            <div className="hero-label small">{x.note}</div>
          </div>
        ))}
        <div className="hero-ring" aria-hidden />
      </section>
      <div className="grid split-main" style={{ marginTop: 24 }}>
        <Card title="Dòng tiền trong 7 ngày" subtitle={o.seriesLabel} actions={<ChartLegend />}>
          <CashflowLineChart data={o.series} />
        </Card>
        <Card title="Cần xử lý" actions={<Chip tone="warning">{totalTasks} việc</Chip>}>
          {o.tasks.map((t, i) => {
            const Icon = icons[i] ?? CircleCheck;
            return (
              <div
                key={t.key}
                className="list-item clickable"
                role="link"
                tabIndex={0}
                onClick={() => navigate(t.route)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(t.route)}
              >
                <span className="icon-tile">
                  <Icon size={18} />
                </span>
                <span>
                  <div className="li-title">{t.title}</div>
                  <div className="li-sub">{t.detail}</div>
                </span>
                <ChevronRight size={18} color="#536978" />
              </div>
            );
          })}
        </Card>
      </div>
      <Card
        className="mt-24"
        title={<span style={{ fontSize: 18 }}>Doanh thu theo kênh</span>}
        actions={
          <button className="link-btn row" onClick={() => navigate('/reconciliation')} style={{ gap: 40 }}>
            Xem đối soát <ArrowUpRight size={16} />
          </button>
        }
      >
        {o.channels.map((c) => (
          <div className="barlist-row" key={c.key}>
            <span className="strong">{c.label}</span>
            <div className="bar-track" role="img" aria-label={`${c.label}: ${c.amountLabel}`}>
              <div
                className="bar-fill"
                style={{
                  width: `${Math.min(100, (Number(c.amount) / maxChannel) * 100)}%`,
                  background: c.key === 'counter' ? 'var(--action)' : 'var(--info)',
                }}
              />
            </div>
            <span className="strong num" style={{ color: 'var(--brand)', textAlign: 'right' }}>
              {c.amountLabel}
            </span>
            <span>
              <Chip tone={c.tone}>{c.status}</Chip>
            </span>
          </div>
        ))}
        <div className="bar-axis" aria-hidden>
          <span />
          <span className="ticks">
            {[0, 50, 100, 150, 200, 250].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </span>
          <span>triệu đồng</span>
          <span />
        </div>
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 10 · Việc cần xử lý ─────────
export function InboxPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useListState(20);
  const [q, setQ] = useSearchText(list);
  const filter = (list.get('kind') || 'ALL') as 'ALL' | 'APPROVAL' | 'MATCH' | 'DOCUMENT' | 'PERIOD';
  const [filterOpen, setFilterOpen] = useState(false);
  const data = useQuery(
    'approvals.inbox',
    {
      q: list.get('q') || undefined,
      kind: filter === 'ALL' ? undefined : filter,
      page: list.page,
      pageSize: list.pageSize,
    },
    { keepPrevious: true },
  );
  const markRead = useMutation('dashboard.markRead');
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const items = data.data.items;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Việc cần xử lý"
        subtitle="Ưu tiên các hồ sơ cần bạn xử lý."
        period={period}
      />
      <KpiRow
        items={[
          { label: 'Cần tôi phê duyệt', value: data.data.kpis.toApprove },
          { label: 'Cần bổ sung', value: data.data.kpis.toSupplement },
          { label: 'Đến hạn hôm nay', value: data.data.kpis.dueToday },
        ]}
        action={
          <Button
            loading={markRead.loading}
            onClick={async () => {
              const r = await markRead.mutate({});
              toast(
                'success',
                r.updated ? `Đã đánh dấu ${r.updated} thông báo là đã đọc` : 'Không có thông báo chưa đọc',
              );
            }}
          >
            Đánh dấu đã đọc
          </Button>
        }
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <Button icon={<ListFilter size={18} />} onClick={() => setFilterOpen(true)}>
            Bộ lọc{filter !== 'ALL' ? ' (1)' : ''}
          </Button>
        </div>
        <DataTable
          rows={items}
          rowKey={(r) => `${r.kind}:${r.id}`}
          onRowClick={(r) => navigate(r.route)}
          columns={[
            { key: 'title', header: 'Công việc', render: (r) => r.title, strong: true },
            { key: 'sender', header: 'Người gửi', render: (r) => r.sender },
            { key: 'due', header: 'Hạn xử lý', render: (r) => r.dueLabel },
            { key: 'value', header: 'Giá trị', render: (r) => r.value, align: 'right' },
            { key: 'status', header: 'Trạng thái', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
          ]}
          empty="Không còn việc cần xử lý"
        />
        <Pagination
          page={data.data.page}
          pageCount={data.data.pageCount}
          total={data.data.total}
          pageSize={data.data.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          unit="việc"
          busy={data.fetching}
        />
      </Card>
      <Modal
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Bộ lọc công việc"
        footer={
          <Button variant="primary" onClick={() => setFilterOpen(false)}>
            Áp dụng
          </Button>
        }
      >
        {(
          [
            ['ALL', 'Tất cả'],
            ['APPROVAL', 'Chờ phê duyệt'],
            ['MATCH', 'Cần xác nhận đối soát'],
            ['DOCUMENT', 'Cần bổ sung chứng từ'],
            ['PERIOD', 'Rà soát chốt kỳ'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="checkbox" style={{ display: 'flex', padding: '8px 0' }}>
            <input
              type="radio"
              name="inbox-filter"
              checked={filter === k}
              onChange={() => list.setFilter('kind', k === 'ALL' ? '' : k)}
            />{' '}
            {label}
          </label>
        ))}
      </Modal>
      <DecidedApprovals />
      <PageFoot />
    </div>
  );
}

/** Approvals already decided (approved, rejected, changes requested), newest first. */
function DecidedApprovals() {
  const navigate = useNavigate();
  const all = useQuery('approvals.list');
  const decided = (all.data ?? []).filter((a) => a.status !== 'PENDING').slice(0, 10);
  if (!decided.length) return null;
  return (
    <Card
      className="mt-24"
      title="Đã xử lý gần đây"
      subtitle="Quyết định phê duyệt được lưu cùng người lập, số tiền và thời điểm"
    >
      <DataTable
        rows={decided}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/approvals/${r.id}`)}
        columns={[
          { key: 't', header: 'Hồ sơ', render: (r) => r.title, strong: true },
          { key: 'r', header: 'Người lập', render: (r) => r.requesterName },
          { key: 'a', header: 'Số tiền', render: (r) => r.amountLabel, align: 'right' },
          {
            key: 's',
            header: 'Kết quả',
            render: (r) => (
              <Chip
                tone={r.status === 'APPROVED' ? 'success' : r.status === 'REJECTED' ? 'danger' : 'warning'}
              >
                {r.statusLabel}
              </Chip>
            ),
          },
        ]}
      />
    </Card>
  );
}

// ───────── 36 · Thông báo ─────────
export function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const list = useListState(20);
  const [q, setQ] = useSearchText(list);
  const onlyUnread = list.get('unread') === '1';
  const data = useQuery(
    'dashboard.notifications',
    {
      q: list.get('q') || undefined,
      unread: onlyUnread || undefined,
      page: list.page,
      pageSize: list.pageSize,
    },
    { keepPrevious: true },
  );
  const mark = useMutation('dashboard.markRead');
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const items = data.data.items;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Quản trị"
        title="Thông báo"
        subtitle="Theo dõi các thay đổi liên quan đến bạn."
        period={period}
      />
      <KpiRow
        items={[
          { label: 'Chưa đọc', value: data.data.kpis.unread },
          { label: 'Cần hành động', value: data.data.kpis.actionRequired },
          { label: 'Hôm nay', value: data.data.kpis.today },
        ]}
        action={
          <Button
            loading={mark.loading}
            onClick={async () => {
              const r = await mark.mutate({});
              toast('success', `Đã đánh dấu ${r.updated} thông báo`);
            }}
          >
            Đánh dấu đã đọc
          </Button>
        }
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <Button
            icon={<ListFilter size={18} />}
            onClick={() => list.setFilter('unread', onlyUnread ? '' : '1')}
            aria-pressed={onlyUnread}
          >
            {onlyUnread ? 'Chỉ chưa đọc' : 'Bộ lọc'}
          </Button>
        </div>
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          onRowClick={async (r) => {
            if (r.status === 'UNREAD') await mark.mutate({ ids: [r.id] }).catch(() => undefined);
            navigate(r.route);
          }}
          columns={[
            { key: 't', header: 'Thông báo', render: (r) => r.title, strong: true },
            { key: 'u', header: 'Đơn vị', render: (r) => r.unit },
            { key: 'time', header: 'Thời gian', render: (r) => r.time },
            { key: 'ref', header: 'Hồ sơ', render: (r) => r.ref },
            {
              key: 's',
              header: 'Trạng thái',
              render: (r) => (
                <Chip
                  tone={r.status === 'READ' ? 'neutral' : r.statusLabel === 'Cần xem' ? 'warning' : 'success'}
                >
                  {r.statusLabel}
                </Chip>
              ),
            },
          ]}
          empty="Không có thông báo"
        />
        <Pagination
          page={data.data.page}
          pageCount={data.data.pageCount}
          total={data.data.total}
          pageSize={data.data.pageSize}
          onPage={list.setPage}
          onPageSize={list.setPageSize}
          unit="thông báo"
          busy={data.fetching}
        />
      </Card>
      <PageFoot />
    </div>
  );
}
