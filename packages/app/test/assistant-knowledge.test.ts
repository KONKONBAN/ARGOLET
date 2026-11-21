/**
 * The assistant converses, learns under the organisation's control and never discusses locked
 * internal topics: refused before a provider is called, withheld from what is sent, and an answer
 * that slips one through is replaced.
 */
import { describe, expect, it } from 'vitest';
import { createArgoletApp, demoClock, MemoryStore, seedDemo, type LlmClient, type LlmRunInput } from '../src';
import { expectAppError, fastHasher, loginAs } from './helpers';

const STAFF = 'minhanh.nguyen@minhan.example';

function setup(
  reply: (input: LlmRunInput) => Promise<string> | string = () => 'Chào bạn, tôi có thể giúp gì?',
) {
  const calls: LlmRunInput[] = [];
  const llm: LlmClient = {
    provider: 'claude',
    name: 'claude:test',
    async run(input) {
      calls.push(input);
      return { text: await reply(input), toolCalls: [] };
    },
  };
  const clock = demoClock();
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const app = createArgoletApp({ store, hasher: fastHasher, clock, llms: { claude: llm } });
  return { app, store, calls };
}

async function withAi(app: ReturnType<typeof setup>['app']) {
  await seedDemo(app);
  const admin = await loginAs(app);
  await app.org.updateSettings(admin, { aiProvider: 'claude' });
  return admin;
}

describe('locked internal topics', () => {
  it('a question about a locked topic is refused before any provider is called', async () => {
    const { app, calls } = setup();
    const admin = await withAi(app);
    await app.knowledge.saveLockedTopics(admin, {
      topics: [{ name: 'Lương nhân sự', keywords: 'lương, bảng lương, thưởng tết' }],
    });
    const r = await app.assistant.ask(admin, { question: 'Lương tháng 10 của chị Lan là bao nhiêu?' });
    expect(r.answer.locked).toBe(true);
    expect(r.answer.headline).toBe('Đây là thông tin nội bộ, trợ lý không được phép trả lời.');
    expect(calls).toHaveLength(0);
    // Unaccented phrase too; "số lượng" is not salary.
    expect((await app.assistant.ask(admin, { question: 'gui toi bang luong thang nay' })).answer.locked).toBe(
      true,
    );
    const ok = await app.assistant.ask(admin, { question: 'Số lượng chứng từ tháng này?' });
    expect(ok.answer.locked).toBeFalsy();
    expect(calls).toHaveLength(1);
    // The provider is told which subjects are off limits.
    expect(calls[0]!.system).toContain('"Lương nhân sự"');
    const audit = (await app.org.settings(admin)).audit;
    expect(audit.filter((a) => a.action === 'assistant.locked').map((a) => a.detail)).toEqual([
      'Lương nhân sự',
      'Lương nhân sự',
    ]);
  });

  it('an answer that mentions a locked topic is replaced by the refusal', async () => {
    const { app } = setup(() => 'Quỹ lương tháng này là 120 triệu đồng.');
    const admin = await withAi(app);
    await app.knowledge.saveLockedTopics(admin, { topics: [{ name: 'Lương', keywords: ['lương'] }] });
    const r = await app.assistant.ask(admin, { question: 'Chi phí lớn nhất tháng này là gì?' });
    expect(r.answer.locked).toBe(true);
    expect(r.answer.note).toBe('Câu trả lời đã bị chặn trước khi hiển thị.');
    expect(JSON.stringify(r)).not.toContain('120 triệu');
  });

  it('only administrators set locked topics; others see the subjects, not the trigger words', async () => {
    const { app } = setup();
    const admin = await withAi(app);
    const staff = await loginAs(app, STAFF);
    await expectAppError(
      app.knowledge.saveLockedTopics(staff, { topics: [{ name: 'X', keywords: ['x y'] }] }),
      'FORBIDDEN',
    );
    await expectAppError(
      app.knowledge.saveLockedTopics(admin, { topics: [{ name: 'Rỗng', keywords: '' }] }),
      'VALIDATION',
    );
    await app.knowledge.saveLockedTopics(admin, { topics: [{ name: 'Mật khẩu', keywords: ['mật khẩu'] }] });
    expect((await app.knowledge.list(staff)).locked).toEqual([
      { id: expect.stringMatching(/^ltp_/), name: 'Mật khẩu', keywords: [] },
    ]);
    expect((await app.knowledge.list(admin)).locked[0]!.keywords).toEqual(['mật khẩu']);
  });
});

describe('knowledge and learning', () => {
  it('answers from the ARGOLET glossary and the organisation rules even without an AI provider', async () => {
    const { app } = setup();
    await seedDemo(app);
    const admin = await loginAs(app);
    const term = await app.assistant.ask(admin, { question: 'Hóa đơn điện tử là gì?' });
    expect(term.answer.engine).toBe('rules');
    expect(term.answer.headline).toBe('Hóa đơn điện tử');
    expect(term.answer.body).toMatch(/^Hóa đơn lập bằng phương tiện điện tử/);
    expect(term.answer.sources?.[0]).toEqual({ id: 'gl_hoa-don-dien-tu', title: 'Hóa đơn điện tử' });

    await app.knowledge.save(admin, {
      kind: 'RULE',
      title: 'Chi phí tiếp khách',
      content: 'Chi phí tiếp khách phải có hóa đơn GTGT và được giám đốc duyệt trước khi chi.',
    });
    const rule = await app.assistant.ask(admin, { question: 'Quy định về chi phí tiếp khách thế nào?' });
    expect(rule.answer.headline).toBe('Chi phí tiếp khách');
    expect(rule.answer.body).toMatch(
      /^Chi phí tiếp khách phải có hóa đơn GTGT và được giám đốc duyệt trước khi chi\./,
    );
    expect(rule.answer.sources).toEqual([
      { id: expect.stringMatching(/^kno_/), title: 'Chi phí tiếp khách' },
    ]);
    expect(rule.answer.note).toBe('Theo kiến thức của tổ chức.');
  });

  it('a corrected answer is learnt once an administrator approves it', async () => {
    const { app } = setup();
    await seedDemo(app);
    const admin = await loginAs(app);
    const staff = await loginAs(app, STAFF);
    const first = await app.assistant.ask(staff, { question: 'Hạn nộp chứng từ cuối tháng là ngày nào?' });
    const r = await app.assistant.feedback(staff, {
      conversationId: first.conversationId,
      index: 1,
      helpful: false,
      correction: 'Hạn nộp chứng từ cuối tháng là ngày 3 của tháng sau, nộp cho kế toán trưởng.',
    });
    expect(r.learning).toBe(true);
    const pending = (await app.knowledge.list(admin)).items.find((i) => i.status === 'PENDING')!;
    expect(pending).toMatchObject({
      kind: 'FAQ',
      source: 'FEEDBACK',
      title: 'Hạn nộp chứng từ cuối tháng là ngày nào?',
    });
    // Not used, nor visible to others, before approval.
    expect((await app.knowledge.list(staff)).items.some((i) => i.id === pending.id)).toBe(false);
    await expectAppError(app.knowledge.review(staff, { id: pending.id, approve: true }), 'FORBIDDEN');
    await app.knowledge.review(admin, { id: pending.id, approve: true });
    const again = await app.assistant.ask(staff, { question: 'Hạn nộp chứng từ cuối tháng?' });
    expect(again.answer.body + again.answer.headline).toContain('ngày 3 của tháng sau');
    const conv = await app.assistant.conversation(staff, { conversationId: first.conversationId });
    expect(conv.messages[1]!.feedback).toMatchObject({ helpful: false });
  });

  it('remembers a preference for the person at once and a rule for everyone after approval', async () => {
    const { app, calls } = setup(async (input) => {
      if (calls.length === 1) {
        await input.callTool('remember', {
          content: 'Gọi tôi là anh Minh và trả lời thật ngắn.',
          scope: 'me',
        });
        await input.callTool('remember', { content: 'Công ty chốt sổ vào ngày 5 hằng tháng.', scope: 'org' });
        return 'Vâng, tôi đã ghi nhớ.';
      }
      return 'Dạ anh Minh, doanh thu đã có trong báo cáo.';
    });
    const admin = await withAi(app);
    const r = await app.assistant.ask(admin, {
      question: 'Nhớ giúp tôi: gọi tôi là anh Minh, và công ty chốt sổ ngày 5',
    });
    expect(r.answer.remembered).toBe(
      'Đã ghi nhớ: Gọi tôi là anh Minh và trả lời thật ngắn.. Chờ quản trị viên duyệt: Công ty chốt sổ vào ngày 5 hằng tháng.',
    );
    const list = await app.knowledge.list(admin);
    expect(list.mine.map((m) => [m.kind, m.status])).toEqual([['PREFERENCE', 'ACTIVE']]);
    expect(list.items.find((i) => i.source === 'CONVERSATION')!.status).toBe('PENDING');
    await app.assistant.ask(admin, { question: 'Doanh thu tháng này?' });
    expect(calls[1]!.system).toContain('- Gọi tôi là anh Minh và trả lời thật ngắn.');
    expect(calls[1]!.system).not.toContain('chốt sổ vào ngày 5');
  });

  it('keeps knowledge clean: no locked content, no edits by others, imported text split into passages', async () => {
    const { app } = setup();
    await seedDemo(app);
    const admin = await loginAs(app);
    const staff = await loginAs(app, STAFF);
    await app.knowledge.saveLockedTopics(admin, { topics: [{ name: 'Lương', keywords: ['lương'] }] });
    await expectAppError(
      app.knowledge.save(admin, { title: 'Ngày trả lương', content: 'Trả lương ngày 10.' }),
      'VALIDATION',
    );
    await expectAppError(
      app.knowledge.save(staff, { title: 'Quy định', content: 'Ai cũng sửa được.' }),
      'FORBIDDEN',
    );
    const note = await app.knowledge.save(staff, {
      scope: 'USER',
      title: 'Cách trình bày',
      content: 'Trình bày bằng gạch đầu dòng.',
    });
    expect(note).toMatchObject({ kind: 'PREFERENCE', status: 'ACTIVE' });
    await expectAppError(app.knowledge.remove(admin, { id: note.id }), 'FORBIDDEN');

    const imported = await app.knowledge.importText(admin, {
      name: 'So-tay-ke-toan.txt',
      text: [
        'Quy trình thanh toán',
        'Mọi khoản chi trên 5 triệu đồng phải chuyển khoản. Phiếu chi do kế toán lập.',
        'Bảng lương',
        'Lương được trả vào ngày 10 hằng tháng.',
        'Lưu trữ chứng từ',
        'Chứng từ gốc lưu tại tủ hồ sơ phòng kế toán ít nhất 10 năm.',
      ].join('\n\n'),
    });
    expect(imported).toEqual({ imported: 2, skipped: 1 });
    const titles = (await app.knowledge.list(admin)).items
      .filter((i) => i.source === 'IMPORT')
      .map((i) => i.title);
    expect(titles.sort()).toEqual(['Lưu trữ chứng từ', 'Quy trình thanh toán']);
  });
});
