import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Check, FileUp, Lock, Plus, Trash2, X } from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import {
  Button,
  Card,
  Chip,
  ErrorNote,
  PageHeader,
  PageLoading,
  SelectInput,
  TextInput,
  useToast,
} from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';

type Topic = { id?: string; name: string; keywords: string };

const KINDS = [
  { value: 'RULE', label: 'Quy định nội bộ' },
  { value: 'TERM', label: 'Thuật ngữ' },
  { value: 'FAQ', label: 'Hỏi đáp' },
];

/**
 * What the assistant knows and must never discuss: locked internal topics, the organisation's
 * knowledge (with what it learnt from corrections, awaiting approval) and each person's notes.
 */
export function KnowledgePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const period = usePeriodLabel();
  const data = useQuery('knowledge.list');
  const save = useMutation('knowledge.save', { silent: true });
  const review = useMutation('knowledge.review', { silent: true });
  const remove = useMutation('knowledge.remove', { silent: true });
  const importText = useMutation('knowledge.import', { silent: true });
  const saveTopics = useMutation('knowledge.saveLockedTopics', { silent: true });
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [form, setForm] = useState({ kind: 'RULE', title: '', content: '' });
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState('');
  useEffect(() => {
    if (data.data && topics === null)
      setTopics(data.data.locked.map((t) => ({ id: t.id, name: t.name, keywords: t.keywords.join(', ') })));
  }, [data.data, topics]);
  if (!data.data)
    return data.error ? (
      <div className="page">
        <ErrorNote error={data.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const d = data.data;
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast('success', ok);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Không lưu được');
    }
  };
  const pending = d.items.filter((i) => i.status === 'PENDING');
  const active = d.items.filter(
    (i) =>
      i.status === 'ACTIVE' &&
      (!filter.trim() || `${i.title} ${i.content}`.toLowerCase().includes(filter.trim().toLowerCase())),
  );
  const list = topics ?? [];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Trợ lý ARGOLET"
        title="Kiến thức của trợ lý"
        subtitle="Điều trợ lý được học, điều trợ lý ghi nhớ và thông tin nội bộ trợ lý không được trả lời."
        period={period}
        actions={<Button onClick={() => navigate('/assistant')}>Mở trợ lý</Button>}
      />

      <Card
        title="Thông tin nội bộ bị khóa"
        subtitle="Trợ lý từ chối mọi câu hỏi về các chủ đề này, với cả Claude, ChatGPT lẫn bộ quy tắc của ARGOLET"
      >
        {d.canManage ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  saveTopics.mutate({
                    topics: list.map((t) => ({ id: t.id ?? null, name: t.name, keywords: t.keywords })),
                  }),
                'Đã lưu chủ đề khóa',
              ).then(() => setTopics(null));
            }}
          >
            {list.length === 0 && <p className="muted small">Chưa khóa chủ đề nào.</p>}
            {list.map((t, i) => (
              <div className="lock-row" key={t.id ?? `new-${i}`}>
                <TextInput
                  label={`Chủ đề ${i + 1}`}
                  value={t.name}
                  onChange={(e) =>
                    setTopics(list.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))
                  }
                />
                <TextInput
                  label="Từ khóa nhận biết, cách nhau bằng dấu phẩy"
                  value={t.keywords}
                  onChange={(e) =>
                    setTopics(list.map((x, k) => (k === i ? { ...x, keywords: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Bỏ chủ đề ${t.name || i + 1}`}
                  onClick={() => setTopics(list.filter((_, k) => k !== i))}
                >
                  <X size={18} />
                </button>
              </div>
            ))}
            <div className="row wrap mt-8">
              <Button
                type="button"
                size="sm"
                icon={<Plus size={16} />}
                onClick={() => setTopics([...list, { name: '', keywords: '' }])}
              >
                Thêm chủ đề
              </Button>
              {d.presets
                .filter((p) => !list.some((t) => t.name === p.name))
                .map((p) => (
                  <Button
                    key={p.name}
                    type="button"
                    size="sm"
                    onClick={() => setTopics([...list, { name: p.name, keywords: p.keywords.join(', ') }])}
                  >
                    {p.name}
                  </Button>
                ))}
            </div>
            <p className="small muted mt-8">
              Từ khóa một tiếng có dấu như &quot;lương&quot; chỉ khớp khi viết đúng dấu (không chặn nhầm
              &quot;số lượng&quot;); cụm từ như &quot;bảng lương&quot; khớp cả khi gõ không dấu.
            </p>
            <Button type="submit" variant="primary" className="mt-16" loading={saveTopics.loading}>
              Lưu chủ đề khóa
            </Button>
          </form>
        ) : d.locked.length ? (
          <div className="row wrap">
            {d.locked.map((t) => (
              <Chip key={t.id} tone="warning" icon={<Lock size={13} />}>
                {t.name}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="muted small">Tổ chức chưa khóa chủ đề nào.</p>
        )}
      </Card>

      {d.canManage && pending.length > 0 && (
        <Card
          className="mt-24"
          title={`Trợ lý học được, chờ duyệt (${pending.length})`}
          subtitle="Câu trả lời người dùng đã sửa và quy ước họ nhờ ghi nhớ; chỉ dùng sau khi bạn duyệt"
        >
          <ul className="kn-list">
            {pending.map((i) => (
              <li key={i.id}>
                <div className="kn-head">
                  <span className="strong">{i.title}</span>
                  <Chip tone="info">{i.sourceLabel}</Chip>
                </div>
                <p className="kn-content">{i.content}</p>
                <p className="small muted">Từ {i.createdByName}</p>
                <div className="row mt-8">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Check size={16} />}
                    onClick={() =>
                      void run(() => review.mutate({ id: i.id, approve: true }), 'Đã duyệt, trợ lý sẽ dùng')
                    }
                  >
                    Duyệt
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void run(() => review.mutate({ id: i.id, approve: false }), 'Đã từ chối')}
                  >
                    Từ chối
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        className="mt-24"
        title="Kiến thức của tổ chức"
        subtitle={`Trợ lý tra ở đây và trong từ điển nghiệp vụ ARGOLET (${d.glossary} thuật ngữ kế toán, thuế) trước khi trả lời`}
        actions={
          d.canManage ? (
            <label className="btn btn-sm">
              <FileUp size={16} aria-hidden /> Nhập tài liệu (.txt, .md)
              <input
                type="file"
                accept=".txt,.md,text/plain,text/markdown"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  const text = await f.text();
                  await run(async () => {
                    const r = await importText.mutate({ name: f.name, text });
                    toast(
                      'success',
                      `Đã nhập ${r.imported} đoạn${r.skipped ? `, bỏ ${r.skipped} đoạn chạm chủ đề khóa` : ''}`,
                    );
                  }, 'Đã nhập tài liệu');
                }}
              />
            </label>
          ) : undefined
        }
      >
        {d.canManage && (
          <form
            className="kn-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => save.mutate({ kind: form.kind as 'RULE', title: form.title, content: form.content }),
                'Đã thêm kiến thức',
              ).then(() => setForm({ kind: form.kind, title: '', content: '' }));
            }}
          >
            <SelectInput
              label="Loại"
              value={form.kind}
              onChange={(v) => setForm({ ...form, kind: v })}
              options={KINDS}
            />
            <TextInput
              label="Tiêu đề"
              value={form.title}
              maxLength={200}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ví dụ: Chi phí tiếp khách"
            />
            <label className="field">
              <span className="field-label">Nội dung</span>
              <textarea
                className="textarea"
                value={form.content}
                maxLength={4000}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Ví dụ: Chi phí tiếp khách phải có hóa đơn GTGT và được giám đốc duyệt trước khi chi."
              />
            </label>
            <Button
              type="submit"
              variant="primary"
              disabled={!form.title.trim() || !form.content.trim()}
              loading={save.loading}
            >
              Thêm vào kiến thức
            </Button>
          </form>
        )}
        <TextInput
          label="Tìm trong kiến thức"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          type="search"
        />
        {active.length === 0 ? (
          <p className="muted small">Chưa có mục kiến thức nào{filter ? ' khớp với từ tìm' : ''}.</p>
        ) : (
          <ul className="kn-list">
            {active.slice(0, 60).map((i) => (
              <li key={i.id}>
                <div className="kn-head">
                  <span className="strong">{i.title}</span>
                  <Chip>{i.kindLabel}</Chip>
                  <span className="small muted">{i.sourceLabel}</span>
                  {d.canManage && (
                    <button
                      className="icon-btn"
                      aria-label={`Xóa ${i.title}`}
                      onClick={() => void run(() => remove.mutate({ id: i.id }), 'Đã xóa')}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <p className="kn-content">{i.content}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted mt-8">
          Chỉ nhập tài liệu tổ chức có quyền sử dụng (quy chế, sổ tay nội bộ, bảng thuật ngữ của công ty).
          Sách, từ điển có bản quyền cần giấy phép của đơn vị giữ bản quyền.
        </p>
      </Card>

      <Card
        className="mt-24"
        title="Trợ lý ghi nhớ về bạn"
        subtitle="Cách xưng hô, cách trình bày bạn muốn; chỉ dùng trong các cuộc trò chuyện của bạn"
      >
        {d.mine.length === 0 && (
          <p className="muted small">
            Chưa ghi nhớ điều gì. Bạn có thể nói với trợ lý: &quot;Nhớ giúp tôi...&quot;
          </p>
        )}
        <ul className="kn-list">
          {d.mine.map((i) => (
            <li key={i.id}>
              <div className="kn-head">
                <span>{i.content}</span>
                <button
                  className="icon-btn"
                  aria-label={`Quên: ${i.title}`}
                  onClick={() => void run(() => remove.mutate({ id: i.id }), 'Trợ lý đã quên điều này')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form
          className="kn-note mt-8"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => save.mutate({ scope: 'USER', title: note.slice(0, 80), content: note }),
              'Trợ lý đã ghi nhớ',
            ).then(() => setNote(''));
          }}
        >
          <TextInput
            label="Điều trợ lý cần nhớ"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ví dụ: Trình bày số tiền theo triệu đồng"
          />
          <Button type="submit" icon={<BookOpen size={16} />} disabled={!note.trim()} loading={save.loading}>
            Ghi nhớ
          </Button>
        </form>
      </Card>
      <PageFoot />
    </div>
  );
}
