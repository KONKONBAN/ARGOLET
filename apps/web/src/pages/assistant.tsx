import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Files, Plus, SendHorizontal, Sparkles } from 'lucide-react';
import { useBackend, useMutation, useQuery } from '../api/hooks';
import { useSession } from '../app/session';
import { Button, Card, Chip, ErrorNote, PageHeader, PageLoading, useToast } from '../ui/components';
import { PageFoot, usePeriodLabel } from './overview';
import type { ChatMessage } from '@argolet/app';

// ───────── 19 · Trợ lý ARGOLET ─────────
export function AssistantPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useSession();
  const { backend } = useBackend();
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
  if (!list.data) return list.error ? <div className="page"><ErrorNote error={list.error} /></div> : <PageLoading />;
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
  const suggestions = ['Vì sao nhóm DS-1031 được gợi ý khớp?', 'Khoản nào chưa khớp?', 'Hồ sơ còn thiếu tháng 10', 'Giải thích kết quả NPV', 'Doanh thu tháng này bao nhiêu?'];
  return (
    <div className="page">
      <PageHeader eyebrow="Nền tảng" title="Trợ lý ARGOLET" subtitle="Tìm thông tin có căn cứ trong đúng phạm vi." period={period} />
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
          <p className="small muted mt-16">Bộ máy trả lời: {list.data.engine === 'rules' ? 'quy tắc tất định + công cụ nghiệp vụ' : list.data.engine}</p>
        </Card>
        <Card className="chat">
          <Chip>{list.data.scopeLabel}</Chip>
          <div className="chat-scroll mt-16" ref={scroll} aria-live="polite">
            {messages.length === 0 && !pending && (
              <div className="muted" style={{ padding: '24px 0' }}>
                <Sparkles size={20} color="#087452" />
                <p className="mt-8">Hỏi về số liệu, đối soát, chứng từ hoặc kết quả tính toán. Trợ lý chỉ dùng dữ liệu trong phạm vi bạn được cấp và luôn dẫn nguồn.</p>
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
                  <span style={{ width: 18, height: 18, border: '2px solid var(--action)', borderRadius: 4, marginTop: 3 }} aria-hidden />
                  <div>
                    <h4>{m.answer?.headline ?? m.content}</h4>
                    {m.answer?.body && <p>{m.answer.body}</p>}
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
                        <Button key={c.ref} icon={<Files size={16} />} onClick={() => c.route && navigate(c.route)}>
                          {c.label}
                        </Button>
                      ))}
                      {m.answer?.proposal && can('recon.confirm') && (
                        <Button
                          variant="primary"
                          loading={proposal.loading}
                          onClick={async () => {
                            const r = await proposal.mutate({ toolName: m.answer!.proposal!.toolName, args: m.answer!.proposal!.args });
                            navigate(`/match/${r.groupId}`);
                          }}
                        >
                          Xem đề xuất để xác nhận
                        </Button>
                      )}
                    </div>
                    {m.answer?.note && <p className="small" style={{ marginTop: 12 }}>{m.answer.note}</p>}
                  </div>
                </div>
              ),
            )}
            {pending && (
              <>
                <div className="bubble-user">{pending}</div>
                <div className="row muted small">
                  <span className="spinner dark" /> Trợ lý đang tra cứu dữ liệu…
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
            <input id="ask" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Hỏi về dữ liệu hoặc công việc..." maxLength={1000} />
            <button className="icon-btn" type="submit" aria-label="Gửi câu hỏi" disabled={!question.trim() || ask.loading}>
              <SendHorizontal size={18} />
            </button>
          </form>
          {backend.info.mode === 'browser' && <p className="small muted mt-8">Bản trên trình duyệt dùng bộ trả lời quy tắc; khi chạy cùng máy chủ có khóa Claude, trợ lý dùng mô hình ngôn ngữ qua cổng công cụ.</p>}
        </Card>
      </div>
      <PageFoot />
    </div>
  );
}
