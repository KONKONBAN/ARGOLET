import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  FileSpreadsheet,
  FileText,
  Landmark,
  ListFilter,
  MonitorSmartphone,
  Plus,
  ScanLine,
  Store,
  Truck,
  Files,
  Receipt,
  CloudUpload,
  TriangleAlert,
  History,
  QrCode,
} from 'lucide-react';
import { formatVnd, formatDate, readQrContent } from '@argolet/core';
import { ApiError } from '../api/backend';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import { AuthenticityPanel } from '../ui/authenticity';
import { analyzePhoto, QualityList, type PhotoQuality } from '../ui/photo';
import { readQrFromImage } from '../ui/qr';
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
  TextInput,
  readFileAsBase64,
  useToast,
} from '../ui/components';
import { useListState, useSearchText } from '../ui/paging';
import { PageFoot, usePeriodLabel } from './overview';

const toneOf = (status: string) =>
  status === 'VALIDATED'
    ? 'success'
    : status === 'NEEDS_REVIEW' || status === 'NEEDS_RECON'
      ? 'warning'
      : 'neutral';

// ───────── 11 · Chứng từ ─────────
export function DocumentsPage() {
  const navigate = useNavigate();
  const list = useListState(10);
  const [q, setQ] = useSearchText(list);
  const status = list.get('status') as '' | 'review' | 'done';
  const data = useQuery(
    'documents.list',
    { q: list.get('q') || undefined, status: status || undefined, page: list.page, pageSize: list.pageSize },
    { keepPrevious: true },
  );
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
        title="Chứng từ"
        subtitle="Một nơi lưu trữ, tìm kiếm và kiểm tra nguồn gốc."
        period={period}
      />
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
            <select
              id="doc-status"
              className="select"
              style={{ height: 44, width: 180 }}
              value={status}
              onChange={(e) => list.setFilter('status', e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="review">Cần kiểm tra</option>
              <option value="done">Đã xác nhận</option>
            </select>
          </div>
        </div>
        <DataTable
          rows={d.items}
          rowKey={(r) => r.id}
          onRowClick={(r) =>
            navigate(r.status === 'VALIDATED' ? `/evidence/${r.id}` : `/documents/${r.id}/review`)
          }
          columns={[
            { key: 'label', header: 'Chứng từ / đối tác', render: (r) => r.label, strong: true },
            { key: 'source', header: 'Nguồn', render: (r) => r.source },
            { key: 'date', header: 'Ngày', render: (r) => r.dateLabel },
            { key: 'amount', header: 'Giá trị', render: (r) => r.amountLabel, align: 'right' },
            {
              key: 'status',
              header: 'Trạng thái',
              render: (r) => <Chip tone={toneOf(r.status)}>{r.statusLabel}</Chip>,
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
          unit="chứng từ"
          busy={data.fetching}
        />
      </Card>
      <PageFoot />
    </div>
  );
}

/** What the QR code on a photo says: the invoice identity (checked with its CRC), a link, or nothing. */
function QrNote({ raw }: { raw: string | null | undefined }) {
  if (raw === undefined) return <p className="muted small">Đang tìm mã QR hóa đơn…</p>;
  const c = raw === null ? null : readQrContent(raw);
  const ok = c?.kind === 'INVOICE' && c.qr.crcOk && c.qr.problems.length === 0;
  const text =
    c === null
      ? 'Không thấy mã QR hóa đơn trên ảnh — nhập các trường khi kiểm tra'
      : c.kind === 'INVOICE'
        ? ok
          ? `Mã QR hóa đơn: ${c.qr.symbol} · số ${c.qr.documentNo} · ${formatDate(c.qr.issueDate)} · ${formatVnd(c.qr.total)} · MST ${c.qr.sellerTaxCode}`
          : `Mã QR hóa đơn bị lỗi: ${c.qr.problems[0]}`
        : c.kind === 'URL'
          ? `Mã QR là đường dẫn tra cứu của nhà cung cấp hóa đơn (${c.host})`
          : 'Mã QR không chứa thông tin hóa đơn (có thể là mã thanh toán)';
  return (
    <ul className="quality-list" aria-label="Mã QR hóa đơn">
      <li className={ok ? 'ok' : c === null ? 'muted' : 'warn'}>
        {ok ? <QrCode size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
        <span>{text}</span>
      </li>
    </ul>
  );
}

/** A file waiting to be sent: photos show a thumbnail, the quality check and the QR code read. */
function PickedFile({
  file,
  quality,
  qr,
  onRemove,
}: {
  file: File;
  quality: PhotoQuality | undefined;
  qr: string | null | undefined;
  onRemove: () => void;
}) {
  const isImage = file.type.startsWith('image/');
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage]);
  return (
    <div className="picked-file">
      {url ? <img src={url} alt="" className="picked-thumb" /> : <FileText size={18} color="#536978" />}
      <div style={{ minWidth: 0 }}>
        <div className="row-between">
          <span className="picked-name">{file.name}</span>
          <span className="row">
            <span className="muted small">{Math.max(1, Math.round(file.size / 1024))} KB</span>
            <button className="link-btn" onClick={onRemove}>
              Bỏ
            </button>
          </span>
        </div>
        {isImage &&
          (quality ? <QualityList q={quality} /> : <span className="muted small">Đang kiểm tra ảnh…</span>)}
        {isImage && <QrNote raw={qr} />}
      </div>
    </div>
  );
}

// ───────── 12 · Tiếp nhận chứng từ ─────────
export function CapturePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { ctx } = useSession();
  // Receiving units: stores/branches, or the legal entity itself when the organisation has no branches.
  const allSites = ctx?.entities.filter((e) => e.kind === 'SITE') ?? [];
  const sites = allSites.length ? allSites : (ctx?.entities.filter((e) => e.kind === 'LEGAL_ENTITY') ?? []);
  const [entityId, setEntityId] = useState(
    ctx?.scope.entityId !== '*' ? (ctx?.scope.entityId ?? '') : (sites[0]?.id ?? ''),
  );
  const [location, setLocation] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(() => new Map<File, PhotoQuality>());
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rate = (f: File, q: PhotoQuality) => setQuality((m) => new Map(m).set(f, q));
  // The e-invoice QR printed on a photo: read in the browser, verified (CRC) and used on the server.
  const [qrs, setQrs] = useState(() => new Map<File, string | null>());
  const qrJobs = useRef(new Map<File, Promise<string | null>>());
  const scanQr = (f: File) => {
    const job = readQrFromImage(f).catch(() => null);
    qrJobs.current.set(f, job);
    return job.then((raw) => setQrs((m) => new Map(m).set(f, raw)));
  };
  const intake = useMutation('documents.intake', { silent: true });
  const [result, setResult] = useState<Awaited<ReturnType<typeof intake.mutate>> | null>(null);
  const period = usePeriodLabel();
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const picked = Array.from(list);
    setFiles((f) => [...f, ...picked].slice(0, 50));
    // Photos are checked (resolution, light, sharpness) before they are sent.
    for (const f of picked)
      if (f.type.startsWith('image/')) {
        analyzePhoto(f)
          .then((q) => rate(f, q))
          .catch(() => undefined);
        void scanQr(f);
      }
  };
  const submit = async () => {
    try {
      const payload = await Promise.all(
        files.map(async (f) => {
          // Raw bytes for every file: the fingerprint must cover exactly what was received.
          const qr = await (qrJobs.current.get(f) ?? Promise.resolve(null));
          return {
            name: f.name,
            mime: f.type,
            contentBase64: await readFileAsBase64(f),
            ...(qr ? { qr } : {}),
          };
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
      <PageHeader
        eyebrow="Nền tảng"
        title="Tiếp nhận chứng từ"
        subtitle="Chụp ảnh, tải tệp hoặc tiếp nhận theo lô."
        period={period}
      />
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
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              accept=".xml,.csv,.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.json"
              onChange={(e) => add(e.target.files)}
            />
          </div>
          {files.length > 0 && (
            <div className="mt-16">
              {files.map((f, i) => (
                <PickedFile
                  key={`${f.name}-${f.size}-${f.lastModified}-${i}`}
                  file={f}
                  quality={quality.get(f)}
                  qr={qrs.get(f)}
                  onRemove={() => setFiles((s) => s.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
          <div className="grid grid-2 mt-24">
            <div className="field">
              <label htmlFor="site">Cơ sở nhận dữ liệu</label>
              <select
                id="site"
                className="select"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {(ctx?.entities.find((x) => x.id === s.parentId)?.shortName ?? '') + ' · ' + s.shortName}
                  </option>
                ))}
              </select>
            </div>
            <TextInput
              label="Mã lô / vị trí bản giấy"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="VD: Kệ A-02, hộp tháng này"
            />
          </div>
          {intake.error && <ErrorNote error={intake.error} />}
          <Button
            variant="primary"
            block
            size="lg"
            disabled={files.length === 0}
            loading={intake.loading}
            onClick={submit}
            icon={<CloudUpload size={18} />}
          >
            Tiếp nhận {files.length ? `${files.length} tệp` : ''}
          </Button>
          {result && (
            <div className="mt-24">
              <Alert tone={result.needsReview ? 'warning' : 'success'} title={`Lô ${result.code}`}>
                {result.normalized} tệp sẵn sàng · {result.needsReview} cần kiểm tra · {result.duplicates} tệp
                trùng đã tách
              </Alert>
              {result.files.map((f, i) => (
                <div key={i} className="list-item">
                  <span className={`icon-tile${f.duplicate || f.status === 'NEEDS_REVIEW' ? ' warn' : ''}`}>
                    {f.duplicate ? <Copy size={18} /> : <FileText size={18} />}
                  </span>
                  <span>
                    <div className="li-title">{f.duplicate ? f.filename : `${f.code} · ${f.filename}`}</div>
                    <div className="li-sub">
                      {f.duplicate
                        ? 'Trùng dấu vân tay với chứng từ đã tiếp nhận'
                        : f.status === 'NEEDS_REVIEW'
                          ? 'Cần kiểm tra trường dữ liệu'
                          : 'Sẵn sàng xác nhận'}
                    </div>
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
              {
                icon: ScanLine,
                t: 'Ảnh / bản scan hóa đơn',
                s: 'Kiểm tra ảnh, đọc mã QR hóa đơn tự động',
                act: () => inputRef.current?.click(),
              },
              {
                icon: FileSpreadsheet,
                t: 'Nhập tệp nguồn',
                s: 'Sao kê, POS hoặc dữ liệu nền tảng',
                act: () => inputRef.current?.click(),
              },
              {
                icon: Receipt,
                t: 'Hóa đơn điện tử',
                s: 'Tải XML và bản thể hiện',
                act: () => inputRef.current?.click(),
              },
            ].map((x) => (
              <div
                key={x.t}
                className="list-item clickable"
                onClick={x.act}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && x.act()}
                style={{ gridTemplateColumns: '24px 1fr' }}
              >
                <x.icon size={18} color="#536978" />
                <span>
                  <div style={{ fontSize: 13 }}>{x.t}</div>
                  <div className="li-sub" style={{ fontSize: 11 }}>
                    {x.s}
                  </div>
                </span>
              </div>
            ))}
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
  const reject = useMutation('documents.reject', { silent: true });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<{
    supplier: string;
    documentNo: string;
    documentDate: string;
    total: string;
    taxCode?: string | undefined;
    series?: string | undefined;
  } | null>(null);
  const [ack, setAck] = useState(false);
  const period = usePeriodLabel();
  useEffect(() => {
    if (doc.data && !fields) {
      const f = doc.data.document.fields;
      setFields({
        ...f,
        documentDate: f.documentDate ? formatDate(f.documentDate) : '',
        total: f.total ? formatVnd(f.total) : '',
      });
    }
  }, [doc.data, fields]);
  if (!doc.data || !fields)
    return doc.error ? (
      <div className="page">
        <ErrorNote error={doc.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = doc.data.document;
  const issues = d.issues;
  const plain = () => ({ ...fields, total: fields.total.replace(/[^\d]/g, '') });
  const fieldIssue = (name: string) => issues.find((i) => i.field === name);
  const set = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields({ ...fields, [k]: e.target.value });
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
        <Card
          title={`Bản gốc · ${d.code}`}
          subtitle={`${d.sourceLabel} · Tiếp nhận ${formatDate(d.receivedAt)}, ${new Date(Date.parse(d.receivedAt) + 7 * 3600e3).toISOString().slice(11, 16)}`}
        >
          <OriginalPreview doc={d} artifact={doc.data.artifact} />
          {doc.data.authenticity && <AuthenticityPanel result={doc.data.authenticity} />}
        </Card>
        <Card title="Nội dung trích xuất">
          <TextInput
            label="Nhà cung cấp"
            value={fields.supplier}
            onChange={set('supplier')}
            disabled={readOnly}
            error={fieldIssue('supplier')?.message}
          />
          <div className="grid grid-2">
            <TextInput
              label="MST người bán"
              value={fields.taxCode ?? ''}
              onChange={set('taxCode')}
              placeholder="10 hoặc 13 chữ số"
              inputMode="numeric"
              disabled={readOnly}
              error={fieldIssue('taxCode')?.severity === 'error' ? fieldIssue('taxCode')?.message : undefined}
            />
            <TextInput
              label="Ký hiệu hóa đơn"
              value={fields.series ?? ''}
              onChange={set('series')}
              placeholder="VD: 1C26TAA"
              disabled={readOnly}
            />
          </div>
          <TextInput
            label="Số chứng từ"
            value={fields.documentNo}
            onChange={set('documentNo')}
            disabled={readOnly}
            error={
              fieldIssue('documentNo')?.severity === 'error' ? fieldIssue('documentNo')?.message : undefined
            }
          />
          <TextInput
            label="Ngày chứng từ"
            value={fields.documentDate}
            onChange={set('documentDate')}
            placeholder="dd/mm/yyyy"
            disabled={readOnly}
            error={
              fieldIssue('documentDate')?.severity === 'error'
                ? fieldIssue('documentDate')?.message
                : undefined
            }
          />
          <TextInput
            label="Tổng thanh toán"
            value={fields.total}
            onChange={set('total')}
            inputMode="numeric"
            disabled={readOnly}
            error={fieldIssue('total')?.severity === 'error' ? fieldIssue('total')?.message : undefined}
          />
          {issues
            .filter((i) => i.severity === 'warning')
            .map((i, k) => (
              <div className="mb-16" key={k}>
                <Alert>{i.message}</Alert>
              </div>
            ))}
          {confirm.error && (
            <div className="mb-16">
              <ErrorNote error={confirm.error} />
              {confirm.error.details?.needsAcknowledge === true && (
                <label className="checkbox mt-8">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi đã
                  kiểm tra và xác nhận cảnh báo trên
                </label>
              )}
            </div>
          )}
          {d.status === 'VALIDATED' ? (
            <Button
              block
              size="lg"
              icon={<History size={18} />}
              onClick={() => navigate(`/evidence/${d.id}`)}
            >
              Xem bằng chứng & lịch sử
            </Button>
          ) : (
            <Button
              variant="primary"
              block
              size="lg"
              icon={<CircleCheck size={18} />}
              loading={confirm.loading}
              disabled={readOnly}
              onClick={doConfirm}
            >
              Xác nhận chứng từ
            </Button>
          )}
          {d.status === 'REJECTED' && (
            <div className="mt-16">
              <Alert tone="danger" title="Chứng từ đã bị từ chối">
                {issues[0]?.message ?? 'Không ghi lý do'}
              </Alert>
            </div>
          )}
          {!readOnly && (
            <Button block className="mt-8" variant="ghost" onClick={() => setRejecting(true)}>
              Từ chối chứng từ
            </Button>
          )}
          {!doc.data.canValidate && d.status !== 'VALIDATED' && (
            <p className="muted small mt-8">
              Vai trò hiện tại chỉ được lưu nháp; người có quyền kế toán sẽ xác nhận.
            </p>
          )}
          <Modal
            title={`Từ chối ${d.code}`}
            open={rejecting}
            onClose={() => setRejecting(false)}
            footer={
              <>
                <Button onClick={() => setRejecting(false)}>Huỷ</Button>
                <Button
                  variant="danger"
                  loading={reject.loading}
                  disabled={!reason.trim()}
                  onClick={async () => {
                    try {
                      await reject.mutate({ documentId: d.id, reason: reason.trim() });
                      setRejecting(false);
                      toast('success', `Đã từ chối ${d.code}`);
                      navigate('/documents');
                    } catch {
                      /* shown in the dialog */
                    }
                  }}
                >
                  Từ chối
                </Button>
              </>
            }
          >
            <p className="muted small" style={{ marginTop: 0 }}>
              Chứng từ bị từ chối không tạo bản ghi kế toán và không thể xác nhận lại; lý do được lưu trong
              nhật ký kiểm toán.
            </p>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
              {[
                'Trùng với chứng từ đã tiếp nhận',
                'Ảnh mờ, không đọc được',
                'Không thuộc đơn vị này',
                'Sai thông tin, cần lập lại',
              ].map((r) => (
                <button key={r} type="button" className="chip-btn" onClick={() => setReason(r)}>
                  {r}
                </button>
              ))}
            </div>
            <TextInput label="Lý do từ chối" value={reason} onChange={(e) => setReason(e.target.value)} />
            {reject.error && <ErrorNote error={reject.error} />}
          </Modal>
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}

function OriginalPreview({
  doc,
  artifact,
}: {
  doc: {
    title: string;
    counterparty: string;
    date: string;
    fields: { documentNo: string; total: string };
    lines: { description: string; amount: string }[];
    rows: { code: string; date: string; amount: string }[];
    sourceKind: string;
  };
  artifact: { filename: string; content: string | null; rawSha256: string } | null;
}) {
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
        {artifact ? artifact.filename : 'Không có tệp gốc'}
      </p>
    </div>
  );
}

// ───────── 37 · Nhập dữ liệu ─────────
const SOURCE_ICON = {
  POS: Store,
  PLATFORM: Truck,
  BANK: Landmark,
  EINVOICE: FileText,
  PAPER: ScanLine,
  EXCEL: Files,
} as const;

export function IngestionPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useQuery('documents.listBatches');
  const settings = useQuery('org.settings');
  const setInt = useMutation('org.setIntegration');
  const [source, setSource] = useState<string | null>(null);
  const period = usePeriodLabel();
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const b = data.data.latest;
  const sel = data.data.sources.find((s) => s.id === source);
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Nhập dữ liệu"
        subtitle="Trích xuất, kiểm tra, chống trùng và lưu nguồn dữ liệu."
        period={period}
      />
      <div className="grid split-even">
        <Card title="Nguồn dữ liệu được phép sử dụng" subtitle="Ảnh · PDF · XML · Excel / CSV">
          {data.data.sources.map((s) => {
            const Icon = SOURCE_ICON[s.kind as keyof typeof SOURCE_ICON] ?? Files;
            return (
              <div
                key={s.id}
                className="list-item clickable"
                onClick={() => setSource(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setSource(s.id)}
              >
                <span className="icon-tile" style={{ borderRadius: '50%' }}>
                  <Icon size={18} />
                </span>
                <span>
                  <div className="li-title">{s.name}</div>
                  <div className="li-sub">{s.description}</div>
                </span>
                <Chip tone={s.status === 'CONNECTED' ? 'success' : 'neutral'}>
                  {s.status === 'CONNECTED' ? 'Đã kết nối' : 'Chưa kết nối'}
                </Chip>
              </div>
            );
          })}
        </Card>
        <Card
          title={b ? `Lô ${b.code}` : 'Chưa có lô dữ liệu'}
          subtitle={b ? `${b.entityLabel} · ${b.fileCount} tệp đã tiếp nhận` : 'Tiếp nhận tệp để bắt đầu'}
        >
          {b && (
            <>
              <div className="kpi highlight" style={{ marginBottom: 18 }}>
                <div className="kpi-label">
                  {b.needsReview ? 'Đã chuẩn hóa, sẵn sàng' : 'Đã chuẩn hóa toàn bộ'}
                </div>
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
              <Button
                variant="primary"
                block
                size="lg"
                className="mt-16"
                onClick={() => navigate('/documents')}
              >
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
                  toast(
                    'success',
                    sel.status === 'CONNECTED' ? 'Đã tạm ngắt kết nối' : 'Đã cấp kết nối nguồn',
                  );
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
      </Modal>
      <PageFoot />
    </div>
  );
}
