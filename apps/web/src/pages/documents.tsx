import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CircleCheck, Copy, FileSpreadsheet, FileText, Info, Landmark, ListFilter, MonitorSmartphone, Plus, ScanLine, Store, Truck, Files, Receipt, CloudUpload, TriangleAlert, History } from 'lucide-react';
import { formatVnd, formatDate } from '@argolet/core';
import { ApiError } from '../api/backend';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import { Alert, Button, Card, Chip, DataTable, ErrorNote, KpiRow, Modal, PageHeader, PageLoading, SearchBox, TextInput, Timeline, readFileAsBase64, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';

const toneOf = (status: string) => (status === 'VALIDATED' ? 'success' : status === 'NEEDS_REVIEW' || status === 'NEEDS_RECON' ? 'warning' : 'neutral');

// ───────── 11 · Chứng từ ─────────
export function DocumentsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'review' | 'done'>('');
  const [limit, setLimit] = useState(20);
  const data = useQuery('documents.list', { q, status: status || undefined, limit });
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const d = data.data;
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Chứng từ" subtitle="Một nơi lưu trữ, tìm kiếm và kiểm tra nguồn gốc." period={period} />
      <KpiRow
        items={[
          { label: 'Tất cả chứng từ', value: d.kpis.total },
          { label: 'Cần kiểm tra', value: d.kpis.needsReview },
          { label: 'Đã xác nhận', value: d.kpis.validated },
        ]}
        action={
          d.canCreate ? (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => navigate('/capture')}>
              Thêm chứng từ
            </Button>
          ) : undefined
        }
      />
      <Card>
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <div className="row">
            <ListFilter size={18} color="#536978" aria-hidden />
            <label className="sr-only" htmlFor="doc-status">
              Lọc trạng thái
            </label>
            <select id="doc-status" className="select" style={{ height: 44, width: 180 }} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">Tất cả trạng thái</option>
              <option value="review">Cần kiểm tra</option>
              <option value="done">Đã xác nhận</option>
            </select>
          </div>
        </div>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(r.status === 'VALIDATED' ? `/evidence/${r.id}` : `/documents/${r.id}/review`)}
          columns={[
            { key: 'label', header: 'Chứng từ / đối tác', render: (r) => r.label, strong: true },
            { key: 'source', header: 'Nguồn', render: (r) => r.source },
            { key: 'date', header: 'Ngày', render: (r) => r.dateLabel },
            { key: 'amount', header: 'Giá trị', render: (r) => r.amountLabel, align: 'right' },
            { key: 'status', header: 'Trạng thái', render: (r) => <Chip tone={toneOf(r.status)}>{r.statusLabel}</Chip> },
          ]}
        />
        <div className="row-between wrap" style={{ marginTop: 18 }}>
          <p className="table-foot" style={{ margin: 0 }}>
            Hiển thị {d.totalShown} / {d.totalMatching} bản ghi · Kỳ {period.toLowerCase()}
          </p>
          {d.totalShown < d.totalMatching && (
            <Button size="sm" onClick={() => setLimit((l) => l + 30)}>
              Xem thêm
            </Button>
          )}
        </div>
      </Card>
      <PageFoot />
    </div>
  );
}

// ───────── 12 · Tiếp nhận chứng từ ─────────
export function CapturePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx } = useSession();
  const sites = ctx?.entities.filter((e) => e.kind === 'SITE') ?? [];
  const [entityId, setEntityId] = useState(ctx?.scope.entityId !== '*' ? ctx?.scope.entityId ?? '' : sites[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const intake = useMutation('documents.intake', { silent: true });
  const [result, setResult] = useState<Awaited<ReturnType<typeof intake.mutate>> | null>(null);
  const period = usePeriodLabel();
  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, 50));
  };
  const submit = async () => {
    try {
      const payload = await Promise.all(
        files.map(async (f) => {
          const isText = /\.(xml|csv)$/i.test(f.name);
          return isText ? { name: f.name, mime: f.type, text: await f.text() } : { name: f.name, mime: f.type, contentBase64: await readFileAsBase64(f) };
        }),
      );
      const r = await intake.mutate({ entityId, location, files: payload });
      setResult(r);
      setFiles([]);
      toast('success', `Đã tiếp nhận lô ${r.code}: ${r.files.length} tệp`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không tiếp nhận được');
    }
  };
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Tiếp nhận chứng từ" subtitle="Chụp ảnh, tải tệp hoặc tiếp nhận theo lô." period={period} />
      <div className="grid split-main">
        <Card title="Thêm chứng từ vào hồ sơ" subtitle="Ảnh, PDF, XML, Excel · Nhiều tệp trong cùng một lô">
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              add(e.dataTransfer.files);
            }}
          >
            <MonitorSmartphone size={34} color="#087452" style={{ margin: '0 auto' }} aria-hidden />
            <h3>Kéo thả tệp vào đây</h3>
            <p className="muted small">Hoặc chọn tệp từ thiết bị của bạn</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => inputRef.current?.click()} style={{ minWidth: 156 }}>
                Chọn tệp
              </Button>
              <Button icon={<Camera size={18} />} onClick={() => cameraRef.current?.click()}>
                Chụp ảnh
              </Button>
            </div>
            <input ref={inputRef} type="file" multiple hidden accept=".xml,.csv,.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.json" onChange={(e) => add(e.target.files)} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => add(e.target.files)} />
          </div>
          {files.length > 0 && (
            <div className="mt-16">
              {files.map((f, i) => (
                <div key={i} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="row" style={{ minWidth: 0 }}>
                    <FileText size={16} color="#536978" /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  </span>
                  <span className="row">
                    <span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                    <button className="link-btn" onClick={() => setFiles((s) => s.filter((_, j) => j !== i))}>
                      Bỏ
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-2 mt-24">
            <div className="field">
              <label htmlFor="site">Cơ sở nhận dữ liệu</label>
              <select id="site" className="select" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(ctx?.entities.find((x) => x.id === s.parentId)?.shortName ?? '') + ' · ' + s.shortName}
                  </option>
                ))}
              </select>
            </div>
            <TextInput label="Mã lô / vị trí bản giấy" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="LO-20261031 · Kệ A-02" />
          </div>
          {intake.error && <ErrorNote error={intake.error} />}
          <Button variant="primary" block size="lg" disabled={files.length === 0} loading={intake.loading} onClick={submit} icon={<CloudUpload size={18} />}>
            Tiếp nhận {files.length ? `${files.length} tệp` : ''}
          </Button>
          {result && (
            <div className="mt-24">
              <Alert tone={result.needsReview ? 'warning' : 'success'} title={`Lô ${result.code}`}>
                {result.normalized} tệp sẵn sàng · {result.needsReview} cần kiểm tra · {result.duplicates} tệp trùng đã tách
              </Alert>
              {result.files.map((f, i) => (
                <div key={i} className="list-item">
                  <span className={`icon-tile${f.duplicate || f.status === 'NEEDS_REVIEW' ? ' warn' : ''}`}>{f.duplicate ? <Copy size={18} /> : <FileText size={18} />}</span>
                  <span>
                    <div className="li-title">{f.duplicate ? f.filename : `${f.code} · ${f.filename}`}</div>
                    <div className="li-sub">{f.duplicate ? 'Trùng dấu vân tay với chứng từ đã tiếp nhận' : f.status === 'NEEDS_REVIEW' ? 'Cần kiểm tra trường dữ liệu' : 'Sẵn sàng xác nhận'}</div>
                  </span>
                  {!f.duplicate && (
                    <Button size="sm" onClick={() => navigate(`/documents/${f.documentId}/review`)}>
                      Kiểm tra
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="stack">
          <Card title="Tiếp nhận theo nhu cầu">
            {[
              { icon: Camera, t: 'Chụp chứng từ', s: 'Chụp từng trang và kiểm tra ảnh', act: () => cameraRef.current?.click() },
              { icon: FileSpreadsheet, t: 'Nhập tệp nguồn', s: 'Sao kê, POS hoặc dữ liệu nền tảng', act: () => inputRef.current?.click() },
              { icon: Receipt, t: 'Hóa đơn điện tử', s: 'Tải XML và bản thể hiện', act: () => inputRef.current?.click() },
            ].map((x) => (
              <div key={x.t} className="list-item clickable" onClick={x.act} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && x.act()} style={{ gridTemplateColumns: '24px 1fr' }}>
                <x.icon size={18} color="#536978" />
                <span>
                  <div style={{ fontSize: 13 }}>{x.t}</div>
                  <div className="li-sub" style={{ fontSize: 11 }}>{x.s}</div>
                </span>
              </div>
            ))}
          </Card>
          <Card title="Quy trình tiếp nhận">
            <Timeline
              items={[
                { title: 'Tiếp nhận', sub: 'Chọn nguồn và bản gốc' },
                { title: 'Trích xuất', sub: 'Ảnh · XML · Excel' },
                { title: 'Kiểm tra', sub: 'Số tiền · Ngày · Mã · Trùng' },
                { title: 'Chuẩn hóa', sub: 'Nối đơn, tiền và chứng từ' },
                { title: 'Lưu phiên bản', sub: 'Giữ nguồn và lịch sử' },
              ]}
            />
          </Card>
        </div>
      </div>
      <PageFoot />
    </div>
  );
}

// ───────── 13 · Kiểm tra chứng từ ─────────
export function ReviewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const doc = useQuery('documents.get', { documentId: id });
  const save = useMutation('documents.saveDraft');
  const confirm = useMutation('documents.confirm', { silent: true });
  const [fields, setFields] = useState<{ supplier: string; documentNo: string; documentDate: string; total: string; taxCode?: string | undefined } | null>(null);
  const [ack, setAck] = useState(false);
  const period = usePeriodLabel();
  useEffect(() => {
    if (doc.data && !fields) {
      const f = doc.data.document.fields;
      setFields({ ...f, documentDate: f.documentDate ? formatDate(f.documentDate) : '', total: f.total ? formatVnd(f.total) : '' });
    }
  }, [doc.data, fields]);
  if (!doc.data || !fields) return doc.error ? <div className="page"><ErrorNote error={doc.error} /></div> : <PageLoading />;
  const d = doc.data.document;
  const issues = d.issues;
  const plain = () => ({ ...fields, total: fields.total.replace(/[^\d]/g, '') });
  const fieldIssue = (name: string) => issues.find((i) => i.field === name);
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [k]: e.target.value });
  const doConfirm = async () => {
    try {
      const r = await confirm.mutate({ documentId: d.id, fields: plain(), acknowledgeWarnings: ack });
      toast('success', `Đã xác nhận ${d.code} · phiên bản ${String(r.version).padStart(2, '0')}`);
      navigate(`/evidence/${d.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.needsAcknowledge) setAck(false);
    }
  };
  const readOnly = d.status === 'VALIDATED' || d.status === 'REJECTED' || !doc.data.canValidate;
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Kiểm tra chứng từ"
        subtitle="Đối chiếu nội dung trích xuất với bản gốc."
        period={period}
        actions={
          <>
            {issues.length > 0 && <Chip tone="warning">Cần kiểm tra {issues.length} trường</Chip>}
            {d.status !== 'VALIDATED' && (
              <Button
                loading={save.loading}
                onClick={async () => {
                  await save.mutate({ documentId: d.id, fields: plain() });
                  toast('success', 'Đã lưu nháp');
                }}
              >
                Lưu nháp
              </Button>
            )}
          </>
        }
      />
      <div className="grid split-even">
        <Card title={`Bản gốc · ${d.code}`} subtitle={`${d.sourceLabel} · Tiếp nhận ${formatDate(d.receivedAt)}, ${new Date(Date.parse(d.receivedAt) + 7 * 3600e3).toISOString().slice(11, 16)}`}>
          <OriginalPreview doc={d} artifact={doc.data.artifact} />
        </Card>
        <Card title="Nội dung trích xuất" subtitle="Đối chiếu từng trường trước khi xác nhận">
          <TextInput label="Nhà cung cấp" value={fields.supplier} onChange={set('supplier')} disabled={readOnly} error={fieldIssue('supplier')?.message} />
          <TextInput label="Số chứng từ" value={fields.documentNo} onChange={set('documentNo')} disabled={readOnly} error={fieldIssue('documentNo')?.severity === 'error' ? fieldIssue('documentNo')?.message : undefined} />
          <TextInput label="Ngày chứng từ" value={fields.documentDate} onChange={set('documentDate')} placeholder="dd/mm/yyyy" disabled={readOnly} error={fieldIssue('documentDate')?.severity === 'error' ? fieldIssue('documentDate')?.message : undefined} />
          <TextInput label="Tổng thanh toán" value={fields.total} onChange={set('total')} inputMode="numeric" disabled={readOnly} error={fieldIssue('total')?.severity === 'error' ? fieldIssue('total')?.message : undefined} />
          {issues.filter((i) => i.severity === 'warning').map((i, k) => (
            <div className="mb-16" key={k}>
              <Alert>{i.message}</Alert>
            </div>
          ))}
          {confirm.error && (
            <div className="mb-16">
              <ErrorNote error={confirm.error} />
              {confirm.error.details?.needsAcknowledge === true && (
                <label className="checkbox mt-8">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi đã kiểm tra và xác nhận cảnh báo trên
                </label>
              )}
            </div>
          )}
          {d.status === 'VALIDATED' ? (
            <Button block size="lg" icon={<History size={18} />} onClick={() => navigate(`/evidence/${d.id}`)}>
              Xem bằng chứng & lịch sử
            </Button>
          ) : (
            <Button variant="primary" block size="lg" icon={<CircleCheck size={18} />} loading={confirm.loading} disabled={readOnly} onClick={doConfirm}>
              Xác nhận chứng từ
            </Button>
          )}
          {!doc.data.canValidate && d.status !== 'VALIDATED' && <p className="muted small mt-8">Vai trò hiện tại chỉ được lưu nháp; người có quyền kế toán sẽ xác nhận.</p>}
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}

function OriginalPreview({ doc, artifact }: { doc: { title: string; counterparty: string; date: string; fields: { documentNo: string; total: string }; lines: { description: string; amount: string }[]; rows: { code: string; date: string; amount: string }[]; sourceKind: string }; artifact: { filename: string; content: string | null; rawSha256: string } | null }) {
  if (doc.rows.length) {
    return (
      <div className="receipt" style={{ maxWidth: '100%' }}>
        <h3>{doc.title.toUpperCase()}</h3>
        <p className="small muted">{artifact?.filename}</p>
        <hr />
        {doc.rows.slice(0, 12).map((r, i) => (
          <div className="line" key={i}>
            <span>
              {r.code} · {formatDate(r.date)}
            </span>
            <span className="num">{formatVnd(r.amount)}</span>
          </div>
        ))}
        {doc.rows.length > 12 && <p className="muted small">… và {doc.rows.length - 12} dòng khác</p>}
      </div>
    );
  }
  return (
    <div className="receipt">
      <h3>{doc.sourceKind === 'XML_EINVOICE' ? 'HÓA ĐƠN ĐIỆN TỬ' : doc.title.toUpperCase()}</h3>
      <p className="small strong">{(doc.counterparty || 'Nhà cung cấp chưa xác định').toUpperCase()}</p>
      <p className="small muted" style={{ marginTop: 12 }}>
        Ngày {doc.date ? formatDate(doc.date) : '—'} · Mã {doc.fields.documentNo || '—'}
      </p>
      <hr />
      {doc.lines.map((l, i) => (
        <div className="line" key={i}>
          <span>{l.description}</span>
          <span className="num">{Number(l.amount).toLocaleString('vi-VN')}</span>
        </div>
      ))}
      <hr />
      <div className="row-between">
        <span className="small strong">TỔNG THANH TOÁN</span>
        <span className="strong num" style={{ fontSize: 18 }}>
          {formatVnd(doc.fields.total || '0')}
        </span>
      </div>
      <p className="small muted" style={{ marginTop: 20 }}>
        {artifact ? `${artifact.filename} · SHA-256 ${artifact.rawSha256.slice(0, 12)}…` : 'Không có tệp gốc'}
      </p>
    </div>
  );
}

// ───────── 37 · Nhập dữ liệu ─────────
const SOURCE_ICON = { POS: Store, PLATFORM: Truck, BANK: Landmark, EINVOICE: FileText, PAPER: ScanLine, EXCEL: Files } as const;

export function IngestionPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery('documents.listBatches');
  const settings = useQuery('org.settings');
  const setInt = useMutation('org.setIntegration');
  const [source, setSource] = useState<string | null>(null);
  const period = usePeriodLabel();
  if (!data.data) return data.error ? <div className="page"><ErrorNote error={data.error} /></div> : <PageLoading />;
  const b = data.data.latest;
  const sel = data.data.sources.find((s) => s.id === source);
  const stage = b ? (b.needsReview ? 2 : 4) : -1;
  const steps = ['Tiếp nhận', 'Trích xuất', 'Kiểm tra', 'Chuẩn hóa', 'Lưu phiên bản'];
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Nhập dữ liệu" subtitle="Trích xuất, kiểm tra, chống trùng và lưu nguồn dữ liệu." period={period} />
      <div className="grid split-even">
        <Card title="Nguồn dữ liệu được phép sử dụng" subtitle="Ảnh · PDF · XML · Excel / CSV">
          {data.data.sources.map((s) => {
            const Icon = SOURCE_ICON[s.kind as keyof typeof SOURCE_ICON] ?? Files;
            return (
              <div key={s.id} className="list-item clickable" onClick={() => setSource(s.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSource(s.id)}>
                <span className="icon-tile" style={{ borderRadius: '50%' }}>
                  <Icon size={18} />
                </span>
                <span>
                  <div className="li-title">{s.name}</div>
                  <div className="li-sub">{s.description}</div>
                </span>
                <Chip tone={s.status === 'CONNECTED' ? 'success' : 'neutral'}>{s.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối'}</Chip>
              </div>
            );
          })}
        </Card>
        <Card title={b ? `Lô ${b.code}` : 'Chưa có lô dữ liệu'} subtitle={b ? `${b.entityLabel} · ${b.fileCount} tệp đã tiếp nhận` : 'Tiếp nhận tệp để bắt đầu'}>
          {b && (
            <>
              <div className="kpi highlight" style={{ marginBottom: 18 }}>
                <div className="kpi-label">{b.needsReview ? 'Đã chuẩn hóa, sẵn sàng' : 'Đã chuẩn hóa toàn bộ'}</div>
                <div className="kpi-value">{b.normalized} tệp</div>
                <div className="kpi-note">
                  {b.needsReview} tệp cần rà soát · {b.duplicates} tệp trùng
                </div>
              </div>
              <div className="list-item">
                <span className="icon-tile warn">
                  <TriangleAlert size={18} />
                </span>
                <span>
                  <div className="li-title">{b.needsReview} trường cần kiểm tra</div>
                  <div className="li-sub">Số tiền, ngày hoặc mã trên bản gốc</div>
                </span>
                <span />
              </div>
              <div className="list-item">
                <span className="icon-tile">
                  <Copy size={18} />
                </span>
                <span>
                  <div className="li-title">{b.duplicates} bản trùng đã tách</div>
                  <div className="li-sub">Đối chiếu dấu vân tay và mã chứng từ</div>
                </span>
                <span />
              </div>
              <div className="list-item">
                <span className="icon-tile">
                  <Info size={18} />
                </span>
                <span>
                  <div className="li-title">Nguồn và phiên bản được lưu</div>
                  <div className="li-sub">Liên kết đơn · chứng từ · tiền · công nợ · {b.parserVersion}</div>
                </span>
                <span />
              </div>
              <Button variant="primary" block size="lg" className="mt-16" onClick={() => navigate('/documents')}>
                Rà soát các trường cần kiểm tra
              </Button>
            </>
          )}
          {!b && (
            <Button variant="primary" onClick={() => navigate('/capture')}>
              Tiếp nhận chứng từ
            </Button>
          )}
        </Card>
      </div>
      <div className="pipeline" aria-label="Tiến trình xử lý lô">
        {steps.map((s, i) => (
          <div key={s} className={`step${i < stage ? ' done' : i === stage ? ' current' : ''}`}>
            {s}
          </div>
        ))}
      </div>
      <Modal
        open={!!sel}
        onClose={() => setSource(null)}
        title={sel?.name ?? ''}
        footer={
          <>
            <Button onClick={() => navigate('/capture')}>Tải tệp thủ công</Button>
            {settings.data?.canManage && sel && (
              <Button
                variant="primary"
                loading={setInt.loading}
                onClick={async () => {
                  await setInt.mutate({ integrationId: sel.id, connect: sel.status !== 'CONNECTED' });
                  toast('success', sel.status === 'CONNECTED' ? 'Đã tạm ngắt kết nối' : 'Đã cấp kết nối nguồn');
                  setSource(null);
                }}
              >
                {sel.status === 'CONNECTED' ? 'Ngắt kết nối' : 'Cấp kết nối'}
              </Button>
            )}
          </>
        }
      >
        <p className="muted">{sel?.description}</p>
        <p className="mt-16 small">Kết nối được cấp theo tổ chức, pháp nhân và phạm vi dữ liệu. ARGOLET chỉ đọc nguồn đã được cấp quyền và lưu bản gốc cùng SHA-256.</p>
      </Modal>
      <PageFoot />
    </div>
  );
}
