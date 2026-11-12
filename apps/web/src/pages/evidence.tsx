import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, FileCheck, ShieldCheck, ShieldAlert, Upload } from 'lucide-react';
import { formatShortDateTime, formatTimeDate } from '@argolet/core';
import { useMutation, useQuery } from '../api/hooks';
import { Alert, Button, Card, Chip, DataTable, ErrorNote, KeyValues, PageHeader, PageLoading, Pagination, Timeline, downloadText, readFileAsBase64, useToast } from '../ui/components';
import { useListState } from '../ui/paging';
import { PageFoot, usePeriodLabel } from './overview';

// Danh mục bằng chứng: phiên bản chứng từ đã xác nhận + bộ chốt kỳ.
export function EvidenceIndexPage() {
  const navigate = useNavigate();
  const list = useListState(20);
  const docs = useQuery('documents.list', { status: 'done', page: list.page, pageSize: list.pageSize }, { keepPrevious: true });
  const snaps = useQuery('evidence.snapshots');
  const period = usePeriodLabel();
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Bằng chứng & lịch sử" subtitle="Truy vết nguồn, phiên bản và người xác nhận." period={period} />
      <Card title="Bộ chốt kỳ" subtitle="CloseSnapshot đã duyệt và biên nhận trên mạng có cấp quyền">
        {snaps.data && (
          <DataTable
            rows={snaps.data}
            rowKey={(r) => r.closeId}
            columns={[
              { key: 'c', header: 'Bộ chốt', render: (r) => r.closeId, strong: true },
              { key: 'p', header: 'Kỳ', render: (r) => r.periodId },
              { key: 'v', header: 'Phiên bản', render: (r) => r.version },
              { key: 't', header: 'Thời điểm chốt', render: (r) => formatShortDateTime(r.closedAt) },
              { key: 's', header: 'Bằng chứng', render: (r) => <Chip tone={r.evidenceStatus === 'ANCHORED' ? 'success' : 'warning'}>{r.evidenceStatus === 'ANCHORED' ? 'Đã neo' : r.evidenceStatus === 'FAILED' ? 'Thất bại' : 'Đang tạo'}</Chip> },
            ]}
            empty="Chưa có kỳ nào được chốt"
          />
        )}
      </Card>
      <Card className="mt-24" title="Chứng từ đã xác nhận" subtitle="Mỗi phiên bản có dấu vân tay SHA-256 có muối và Merkle proof">
        {docs.data && (
          <DataTable
            rows={docs.data.items}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/evidence/${r.id}`)}
            columns={[
              { key: 'l', header: 'Chứng từ', render: (r) => r.label, strong: true },
              { key: 's', header: 'Nguồn', render: (r) => r.source },
              { key: 'd', header: 'Ngày', render: (r) => r.dateLabel },
              { key: 'a', header: 'Giá trị', render: (r) => r.amountLabel, align: 'right' },
            ]}
          />
        )}
        {docs.data && <Pagination page={docs.data.page} pageCount={docs.data.pageCount} total={docs.data.total} pageSize={docs.data.pageSize} onPage={list.setPage} onPageSize={list.setPageSize} unit="chứng từ" busy={docs.fetching} />}
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 18 · Bằng chứng & lịch sử ─────────
export function EvidencePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const data = useQuery('evidence.document', { documentId: id });
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const e = data.data;
  const tone = e.integrity === 'VERIFIED' || e.integrity === 'ANCHORED' ? 'success' : e.integrity === 'FAILED' ? 'danger' : 'warning';
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Bằng chứng & lịch sử" subtitle="Truy vết nguồn, phiên bản và người xác nhận." period={period} />
      <div className="grid split-main">
        <Card>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>Bằng chứng hồ sơ {e.document.code}</h2>
          <div className="mt-16">
            <Chip tone={tone}>{e.integrityLabel}</Chip>
          </div>
          {e.version ? (
            <>
              <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--brand)', margin: '22px 0 12px' }}>{e.version.label}</div>
              <p className="muted">{e.version.confirmedAtLabel}</p>
              <div className="mt-24">
                <KeyValues rows={e.rows} />
              </div>
              {e.receipt && (
                <p className="small muted mt-16">
                  Merkle root {e.receipt.merkleRoot.slice(0, 16)}… · tx {e.receipt.transactionId.slice(0, 12)}… · khối #{e.receipt.blockNumber} · kênh {e.receipt.channel} · {e.receipt.validationCode}
                </p>
              )}
            </>
          ) : (
            <div className="mt-24">
              <Alert tone="info">Hồ sơ chưa có phiên bản được xác nhận. Bằng chứng được tạo sau khi người có quyền xác nhận chứng từ.</Alert>
            </div>
          )}
          <div className="grid grid-2" style={{ marginTop: 40 }}>
            <Button onClick={() => navigate(`/documents/${e.document.id}/review`)}>Xem bản gốc</Button>
            <Button variant="primary" icon={<Download size={18} style={{ transform: 'rotate(180deg)' }} />} disabled={!e.receipt} onClick={() => navigate(`/verification/${e.document.id}`)}>
              Kiểm chứng hồ sơ
            </Button>
          </div>
        </Card>
        <Card title="Lịch sử xác nhận">
          <div className="mt-16">
            <Timeline items={e.history.map((h) => ({ title: h.title, sub: `${h.by} · ${formatShortDateTime(h.at)}` }))} />
          </div>
          <div className="note-box">{e.roleNote}</div>
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}

// ───────── 40 · Kiểm tra toàn vẹn ─────────
export function VerificationPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const info = useQuery('evidence.integrity', { documentId: id });
  const verify = useMutation('evidence.verifyDocument', { silent: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof verify.mutate>> | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const period = usePeriodLabel();
  if (!info.data) return info.error ? <div className="page"><ErrorNote error={info.error} /></div> : <PageLoading />;
  const d = info.data;
  const run = async (file?: File) => {
    try {
      let r;
      if (file) {
        setFileName(file.name);
        r = /\.(xml|csv|txt|json)$/i.test(file.name) ? await verify.mutate({ documentId: id, fileText: await file.text() }) : await verify.mutate({ documentId: id, fileBase64: await readFileAsBase64(file) });
      } else r = await verify.mutate({ documentId: id });
      setResult(r);
      toast(r.ok ? 'success' : 'error', r.ok ? 'Toàn vẹn đã xác minh' : 'Phát hiện sai khác so với bằng chứng');
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không kiểm chứng được');
    }
  };
  const status = result ? (result.ok ? 'VERIFIED' : 'FAILED') : d.status;
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Kiểm tra toàn vẹn" subtitle="Đối chiếu bản gốc ngoài chuỗi với dấu vân tay của phiên bản." period={period} />
      <div className="grid split-main">
        <Card title={d.title} subtitle={d.subtitle}>
          <Chip tone={status === 'VERIFIED' ? 'success' : status === 'FAILED' ? 'danger' : 'neutral'} icon={status === 'FAILED' ? <ShieldAlert size={13} /> : status === 'VERIFIED' ? <ShieldCheck size={13} /> : undefined}>
            {status === 'VERIFIED' ? 'Toàn vẹn đã xác minh' : status === 'FAILED' ? 'Phát hiện sai khác' : d.statusLabel}
          </Chip>
          <div className="mt-24">
            <KeyValues stacked rows={d.rows} />
          </div>
          {result && (
            <div className="mt-24">
              <Alert tone={result.ok ? 'success' : 'danger'} title={result.ok ? `Kết quả: trùng khớp${fileName ? ` · ${fileName}` : ''}` : 'Kết quả: không trùng khớp'}>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {result.steps.map((s) => (
                    <li key={s.code}>
                      {s.ok ? '✓' : '✗'} {s.code} · {s.label}: {s.detail}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">{result.statement}</div>
              </Alert>
            </div>
          )}
          <div className="grid grid-2" style={{ marginTop: 36 }}>
            <Button variant="primary" icon={<FileCheck size={18} />} loading={verify.loading} onClick={() => fileRef.current?.click()}>
              Chọn tệp &amp; kiểm chứng
            </Button>
            {d.hasOriginal ? (
              <Button icon={<Upload size={18} style={{ transform: 'rotate(180deg)' }} />} onClick={() => downloadText(d.originalFilename ?? 'ban-goc.xml', d.originalContent ?? '', 'application/xml;charset=utf-8')}>
                Tải bản gốc mẫu XML
              </Button>
            ) : (
              <Button loading={verify.loading} onClick={() => void run()}>
                Kiểm chứng với bản lưu trữ
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(f);
              e.target.value = '';
            }}
          />
          {result && <p className="small muted mt-8">Chuỗi khối sổ cái: {result.chainValid ? 'hợp lệ' : 'BỊ SỬA ĐỔI'} · root tính lại {result.computedRoot.slice(0, 16)}…</p>}
        </Card>
        <Card title="Chuỗi kiểm chứng">
          <div className="mt-16">
            <Timeline
              items={[
                { title: 'Bản gốc ngoài chuỗi', sub: 'Nguồn · quyền truy cập', done: !!result?.steps.find((s) => s.code === 'B1')?.ok },
                { title: 'Băm có muối', sub: 'Dấu vân tay theo phiên bản', done: !!result?.steps.find((s) => s.code === 'B5')?.ok },
                { title: 'Gom lô Merkle', sub: 'Lá · đường dẫn · gốc lô', done: !!result?.steps.find((s) => s.code === 'B6')?.ok },
                { title: 'Mạng có cấp quyền', sub: 'Đối chiếu root đã ghi nhận', done: !!result?.steps.find((s) => s.code === 'B4')?.ok },
              ]}
            />
          </div>
          <p className="small muted" style={{ lineHeight: 1.7 }}>
            Xác minh toàn vẹn dữ liệu không thay thế việc kiểm tra tính đúng đắn của đầu vào.
          </p>
          {d.status !== 'PENDING' && !result && <p className="small muted mt-8">Lần kiểm chứng gần nhất: {d.statusLabel.toLowerCase()} · {formatTimeDate(new Date().toISOString()).slice(8)}</p>}
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}
