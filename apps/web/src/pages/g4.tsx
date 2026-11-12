import { Send } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { Alert, Button, Card, Chip, DataTable, ErrorNote, KpiRow, PageHeader, PageLoading, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import { ModuleTabs } from './g1';

const G4_TABS = [
  { to: '/group', label: 'Điều hành tập đoàn' },
  { to: '/intercompany', label: 'Đối soát nội bộ' },
];

// ───────── 32 · Điều hành tập đoàn ─────────
export function GroupPage() {
  const data = useQuery('modules.group');
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="G4 · Tập đoàn" title="Điều hành tập đoàn" subtitle="Theo dõi pháp nhân và tiến độ gửi dữ liệu." period={period} />
      <ModuleTabs tabs={G4_TABS} current="/group" />
      <KpiRow items={d.kpis} />
      <Card title={d.title} subtitle="Dữ liệu phục vụ hợp nhất · Chưa phải báo cáo hợp nhất đã kiểm toán">
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', header: 'Pháp nhân', render: (r) => r.name, strong: true },
            { key: 'c', header: 'Mã đơn vị', render: (r) => r.code },
            { key: 'd', header: 'Chứng từ', render: (r) => r.docs },
            { key: 's', header: 'Trạng thái kỳ', render: (r) => <Chip tone={r.tone}>{r.status}</Chip> },
            { key: 'i', header: 'Nội bộ', render: (r) => r.ic },
          ]}
        />
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 33 · Đối soát nội bộ ─────────
export function IntercompanyPage() {
  const toast = useToast();
  const data = useQuery('modules.intercompany');
  const request = useMutation('modules.requestIntercompanyDocs');
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const p = data.data.pair;
  if (!p) return <div className="page"><Card>Chưa có cặp giao dịch nội bộ.</Card></div>;
  return (
    <div className="page">
      <PageHeader eyebrow="G4 · Tập đoàn" title="Đối soát nội bộ" subtitle="Đối chiếu giao dịch giữa các pháp nhân." period={period} />
      <ModuleTabs tabs={G4_TABS} current="/intercompany" />
      <KpiRow items={p.kpis} />
      <Card title="Đối chiếu hai phía" subtitle={`Mã tham chiếu chung: ${p.reference}`}>
        <DataTable
          rows={p.rows}
          rowKey={(r) => r.label}
          columns={[
            { key: 'l', header: 'Nội dung', render: (r) => r.label, strong: true },
            { key: 'a', header: p.sideAName, render: (r) => r.a, align: 'right' },
            { key: 'b', header: p.sideBName, render: (r) => r.b, align: 'right' },
            { key: 'r', header: 'Kết quả', render: (r) => <Chip tone={r.tone}>{r.result}</Chip> },
          ]}
        />
        <h3 className="card-title" style={{ marginTop: 32 }}>
          Việc tiếp theo
        </h3>
        <p className="mt-8" style={{ lineHeight: 1.7 }}>
          {p.nextAction}
        </p>
        <p className="small muted mt-8">
          Bút toán loại trừ dạng nháp: Nợ {p.eliminationDraft.debit} / Có {p.eliminationDraft.credit} · {Number(p.eliminationDraft.amount).toLocaleString('vi-VN')} đ
        </p>
        <div className="row mt-24" style={{ justifyContent: 'flex-end' }}>
          {p.status === 'REQUESTED' ? (
            <Alert tone="success">Đã gửi yêu cầu bổ sung chứng từ cho {p.sideBName}.</Alert>
          ) : (
            data.data.canWrite && (
              <Button
                variant="primary"
                icon={<Send size={18} />}
                loading={request.loading}
                onClick={async () => {
                  await request.mutate({ pairId: p.id });
                  toast('success', 'Đã gửi yêu cầu bổ sung chứng từ');
                }}
              >
                Gửi yêu cầu bổ sung
              </Button>
            )
          )}
        </div>
      </Card>
      <PageFoot />
    </div>
  );
}
