import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Check,
  Files,
  Lock,
  MessageCircle,
  Plus,
  SendHorizontal,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import { Button, Card, Chip, ErrorNote, PageHeader, PageLoading, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import type { ChatMessage } from '@argolet/app';

// ───────── 19 · Trợ lý ARGOLET ─────────
export function AssistantPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useSession();
  const list = useQuery('assistant.conversations');
  const [active, setActive] = useState<string | null>(null);
  const [draftNew, setDraftNew] = useState(false);
  const conv = useQuery('assistant.conversation', { conversationId: active ?? '' }, { enabled: !!active });
  const ask = useMutation('assistant.ask', { silent: true });
  const proposal = useMutation('assistant.submitProposal', { silent: true });
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const period = usePeriodLabel();
  useEffect(() => {
    if (!active && !draftNew && list.data?.items[0]) setActive(list.data.items[0].id);
  }, [list.data, active, draftNew]);
  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
  }, [conv.data, pending]);
  if (!list.data)
    return list.error ? (
      <div className="page">
        <ErrorNote error={list.error} />
      </div>
    ) : (
      <PageLoading />
    );
  const messages: ChatMessage[] = active && conv.data ? conv.data.messages : [];
  const send = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    setQuestion('');
    setPending(q);
    try {
      const r = await ask.mutate({ conversationId: draftNew ? null : active, question: q });
      setDraftNew(false);
      setActive(r.conversationId);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Trợ lý không phản hồi');
    } finally {
      setPending(null);
    }
  };
  const suggestions = list.data?.suggestions ?? [
    'Khoản nào chưa khớp?',
    'Giải thích kết quả NPV',
    'Doanh thu tháng này bao nhiêu?',
  ];
  return (
    <div className="page">
      <PageHeader
        eyebrow="Nền tảng"
        title="Trợ lý ARGOLET"
        subtitle="Trò chuyện, tra số liệu có căn cứ và hỏi nghiệp vụ kế toán, thuế."
        period={period}
        actions={
          <Button icon={<BookOpen size={18} />} onClick={() => navigate('/assistant-knowledge')}>
            Kiến thức của trợ lý
          </Button>
        }
      />
      <div className="grid split-side">
        <Card title="Cuộc trò chuyện">
          <Button
            block
            icon={<Plus size={18} />}
            onClick={() => {
              setActive(null);
              setDraftNew(true);
            }}
          >
            Cuộc trò chuyện mới
          </Button>
          <div className="mt-16">
            {list.data.items.map((c) => (
              <button
                key={c.id}
                className={`conv-item${c.id === active ? ' active' : ''}`}
                onClick={() => {
                  setDraftNew(false);
                  setActive(c.id);
                }}
              >
                {c.title}
              </button>
            ))}
          </div>
        </Card>
        <Card className="chat">
          <Chip>{list.data.scopeLabel}</Chip>
          <div className="chat-scroll mt-16" ref={scroll} aria-live="polite">
            {messages.length === 0 && !pending && (
              <div className="muted" style={{ padding: '24px 0' }}>
                <MessageCircle size={20} color="#087452" />
                <p className="mt-8">
                  Hỏi về số liệu, đối soát, chứng từ, kết quả tính toán hoặc nghiệp vụ kế toán, thuế. Trợ lý
                  chỉ dùng dữ liệu trong phạm vi bạn được cấp, luôn dẫn nguồn và học từ những câu trả lời bạn
                  sửa.
                </p>
                <div className="row wrap mt-16">
                  {suggestions.map((s) => (
                    <Button key={s} size="sm" onClick={() => void send(s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) =>
              m.role === 'user' ? (
                <div className="bubble-user" key={i}>
                  {m.content}
                </div>
              ) : (
                <div className="answer" key={i}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      border: '2px solid var(--action)',
                      borderRadius: 4,
                      marginTop: 3,
                    }}
                    aria-hidden
                  />
                  <div>
                    {m.answer?.locked && (
                      <Chip tone="warning" icon={<Lock size={13} />}>
                        Thông tin nội bộ
                      </Chip>
                    )}
                    <h4>{m.answer?.headline ?? m.content}</h4>
                    {m.answer?.body && <p className="answer-body">{m.answer.body}</p>}
                    {m.answer && m.answer.facts.length > 0 && (
                      <div className="kv mt-16">
                        {m.answer.facts.map((f) => (
                          <div className="kv-row" key={f.label} style={{ borderBottom: 0, padding: '8px 0' }}>
                            <span className="k" style={{ fontSize: 13 }}>
                              {f.label}
                            </span>
                            <span className="v strong num">{f.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="row wrap mt-16">
                      {m.answer?.citations.map((c) => (
                        <Button
                          key={c.ref}
                          icon={<Files size={16} />}
                          onClick={() => c.route && navigate(c.route)}
                        >
                          {c.label}
                        </Button>
                      ))}
                      {m.answer?.proposal && can('recon.confirm') && (
                        <Button
                          variant="primary"
                          loading={proposal.loading}
                          onClick={async () => {
                            const r = await proposal.mutate({
                              toolName: m.answer!.proposal!.toolName,
                              args: m.answer!.proposal!.args,
                            });
                            navigate(`/match/${r.groupId}`);
                          }}
                        >
                          Xem đề xuất để xác nhận
                        </Button>
                      )}
                    </div>
                    {m.answer?.sources && m.answer.sources.length > 0 && (
                      <p className="small muted answer-sources">
                        <BookOpen size={13} aria-hidden /> Theo:{' '}
                        {m.answer.sources.map((x) => x.title).join(', ')}
                      </p>
                    )}
                    {m.answer?.remembered && (
                      <p className="small answer-remembered" role="status">
                        <Check size={13} aria-hidden /> {m.answer.remembered}
                      </p>
                    )}
                    {m.answer?.note && (
                      <p className="small" style={{ marginTop: 12 }}>
                        {m.answer.note}
                      </p>
                    )}
                    {active && m.answer && !m.answer.locked && (
                      <Feedback conversationId={active} index={i} given={m.feedback} />
                    )}
                  </div>
                </div>
              ),
            )}
            {pending && (
              <>
                <div className="bubble-user">{pending}</div>
                <div className="row muted small">
                  <span className="spinner dark" /> Trợ lý đang suy nghĩ
                </div>
              </>
            )}
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(question);
            }}
          >
            <label className="sr-only" htmlFor="ask">
              Câu hỏi
            </label>
            <input
              id="ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Nhắn cho trợ lý..."
              maxLength={1000}
            />
            <button
              className="icon-btn"
              type="submit"
              aria-label="Gửi câu hỏi"
              disabled={!question.trim() || ask.loading}
            >
              <SendHorizontal size={18} />
            </button>
          </form>
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}

/**
 * "Hữu ích" / "Chưa đúng" under an answer. A correction teaches the assistant once an administrator
 * approves it.
 */
function Feedback({
  conversationId,
  index,
  given,
}: {
  conversationId: string;
  index: number;
  given: ChatMessage['feedback'];
}) {
  const send = useMutation('assistant.feedback', { silent: true });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const verdict = given ? (given.helpful ? 'yes' : 'no') : null;
  const submit = async (helpful: boolean, correction?: string) => {
    try {
      const r = await send.mutate({ conversationId, index, helpful, correction: correction ?? null });
      setOpen(false);
      setDone(
        r.learning
          ? 'Cảm ơn bạn. Câu trả lời đúng đã được gửi quản trị viên duyệt; sau khi duyệt trợ lý sẽ dùng cho mọi người.'
          : 'Cảm ơn bạn đã đánh giá.',
      );
    } catch (e) {
      setDone(e instanceof Error ? e.message : 'Không gửi được đánh giá');
    }
  };
  return (
    <div className="answer-feedback">
      <div className="row" role="group" aria-label="Đánh giá câu trả lời">
        <button
          type="button"
          className={`fb-btn${verdict === 'yes' ? ' on' : ''}`}
          aria-pressed={verdict === 'yes'}
          disabled={send.loading}
          onClick={() => void submit(true)}
        >
          <ThumbsUp size={14} aria-hidden /> Hữu ích
        </button>
        <button
          type="button"
          className={`fb-btn${verdict === 'no' || open ? ' on' : ''}`}
          aria-pressed={verdict === 'no'}
          aria-expanded={open}
          disabled={send.loading}
          onClick={() => setOpen((o) => !o)}
        >
          <ThumbsDown size={14} aria-hidden /> Chưa đúng
        </button>
      </div>
      {open && (
        <form
          className="fb-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false, text.trim() || undefined);
          }}
        >
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Câu trả lời đúng là gì? Trợ lý sẽ học sau khi quản trị viên duyệt."
            aria-label="Câu trả lời đúng"
            maxLength={2000}
          />
          <div className="row mt-8">
            <Button type="submit" size="sm" variant="primary" loading={send.loading}>
              {text.trim() ? 'Gửi để trợ lý học' : 'Gửi đánh giá'}
            </Button>
            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Hủy
            </Button>
          </div>
        </form>
      )}
      {done && (
        <p className="small muted mt-8" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
