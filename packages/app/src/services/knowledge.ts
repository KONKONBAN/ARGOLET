/**
 * What the assistant learns, under the organisation's control, and what it must never discuss.
 *
 *  - Knowledge of the organisation: terms, rules and answers written by an administrator, pages of
 *    a handbook imported as text, and corrections people make to answers. A correction is only a
 *    proposal (PENDING) until an administrator approves it, so nobody can teach the assistant
 *    something wrong for everyone.
 *  - Preferences: what one person asked the assistant to remember (how to address them, how to
 *    present answers); used only in that person's conversations.
 *  - Locked topics: internal subjects (salaries, passwords...) the assistant refuses to discuss,
 *    whichever provider answers, enforced in AssistantService.
 */
import {
  GLOSSARY,
  LOCKED_TOPIC_PRESETS,
  lockedTopicIn,
  newId,
  searchKnowledge,
  type KnowledgePassage,
  type LockedTopic,
} from '@argolet/core';
import { type AppCore, requireFound, requireText } from '../core';
import { AppError, type CallContext, type WorkspaceState } from '../runtime';
import type { Tx } from '../store';
import type { KnowledgeRow, LockedTopicSetting } from '../types';

export const KNOWLEDGE_LIMITS = {
  orgItems: 500,
  userItems: 50,
  title: 200,
  content: 4000,
  importChars: 200_000,
  importPassages: 150,
  topics: 30,
  keywords: 30,
};

const KIND_LABEL: Record<KnowledgeRow['kind'], string> = {
  TERM: 'Thuật ngữ',
  RULE: 'Quy định nội bộ',
  FAQ: 'Hỏi đáp',
  DOCUMENT: 'Tài liệu',
  PREFERENCE: 'Sở thích',
};
const SOURCE_LABEL: Record<KnowledgeRow['source'], string> = {
  ADMIN: 'Quản trị viên nhập',
  FEEDBACK: 'Học từ câu trả lời được sửa',
  CONVERSATION: 'Ghi nhớ trong trò chuyện',
  IMPORT: 'Nhập từ tệp',
};

const actor = (ws: WorkspaceState) => ({ id: ws.user.id, name: ws.membership.displayName });

/** The locked topics of an organisation (empty when none). */
export function lockedTopicsOf(settings: { lockedTopics?: LockedTopicSetting[] | undefined }): LockedTopic[] {
  return settings.lockedTopics ?? [];
}

/**
 * Knowledge relevant to a question for this person: the organisation's approved items, the
 * ARGOLET glossary and the person's own notes, never anything touching a locked topic. The
 * person's preferences are returned separately: they always apply.
 */
export async function knowledgeFor(
  tx: Tx,
  ws: WorkspaceState,
  question: string,
  locked: LockedTopic[],
  limit = 4,
): Promise<{ passages: KnowledgePassage[]; preferences: KnowledgePassage[] }> {
  const rows = (await tx.list('knowledge', ws.tenantId)).filter(
    (r) => r.status === 'ACTIVE' && (r.scope === 'ORG' || r.userId === ws.user.id),
  );
  const open = (p: KnowledgePassage) => !lockedTopicIn(`${p.title}\n${p.content}`, locked);
  const preferences = rows
    .filter((r) => r.kind === 'PREFERENCE')
    .slice(0, 10)
    .map((r) => ({ id: r.id, title: r.title, content: r.content }))
    .filter(open);
  const pool: KnowledgePassage[] = [
    ...rows
      .filter((r) => r.kind !== 'PREFERENCE')
      .map((r) => ({ id: r.id, title: r.title, content: r.content })),
    ...GLOSSARY,
  ].filter(open);
  const passages = searchKnowledge(question, pool, limit).map(({ id, title, content }) => ({
    id,
    title,
    content,
  }));
  return { passages, preferences };
}

/** Splits imported text into passages of at most about 1,200 characters, at headings and paragraphs. */
export function splitPassages(name: string, text: string): { title: string; content: string }[] {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
  const out: { title: string; content: string }[] = [];
  let heading = '';
  let buf = '';
  const flush = () => {
    if (!buf.trim()) return;
    out.push({ title: (heading || `${name}, phần ${out.length + 1}`).slice(0, 200), content: buf.trim() });
    buf = '';
  };
  for (const p of paragraphs) {
    // A short line without a final full stop reads as a heading.
    const isHeading = p.length <= 90 && !/[.:;!?]$/.test(p) && !p.includes('\n');
    if (isHeading) {
      flush();
      heading = p.replace(/^#+\s*/, '');
      continue;
    }
    for (const piece of p.match(/[\s\S]{1,1200}(?:\s|$)/g) ?? [p]) {
      if (buf.length + piece.length > 1200) flush();
      buf += (buf ? '\n' : '') + piece.trim();
    }
  }
  flush();
  return out;
}

export class KnowledgeService {
  constructor(private readonly core: AppCore) {}

  private view(r: KnowledgeRow) {
    return {
      id: r.id,
      scope: r.scope,
      kind: r.kind,
      kindLabel: KIND_LABEL[r.kind],
      title: r.title,
      content: r.content,
      source: r.source,
      sourceLabel: SOURCE_LABEL[r.source],
      status: r.status,
      createdByName: r.createdByName,
      createdAt: r.createdAt,
    };
  }

  /** The settings page: knowledge (pending first for administrators), own notes and locked topics. */
  async list(call: CallContext) {
    return this.core.query(async (tx) => {
      const ws = await this.core.requireWorkspace(tx, call, 'assistant.use');
      const admin = this.core.can(ws, 'settings.manage');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const rows = await tx.list('knowledge', ws.tenantId);
      const rank = { PENDING: 0, ACTIVE: 1, REJECTED: 2 } as const;
      const org = rows
        .filter((r) => r.scope === 'ORG' && (admin ? r.status !== 'REJECTED' : r.status === 'ACTIVE'))
        .sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt.localeCompare(a.updatedAt));
      const mine = rows
        .filter((r) => r.scope === 'USER' && r.userId === ws.user.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const topics = lockedTopicsOf(t.settings);
      return {
        canManage: admin,
        items: org.map((r) => this.view(r)),
        mine: mine.map((r) => this.view(r)),
        pending: org.filter((r) => r.status === 'PENDING').length,
        glossary: GLOSSARY.length,
        // Everyone sees which subjects are off limits; only administrators see the trigger words.
        locked: topics.map((x) => ({ id: x.id, name: x.name, keywords: admin ? x.keywords : [] })),
        presets: admin ? LOCKED_TOPIC_PRESETS : [],
        limits: KNOWLEDGE_LIMITS,
      };
    });
  }

  /** Adds or edits an item: organisation knowledge (administrators) or a personal note (anyone). */
  async save(
    call: CallContext,
    p: {
      id?: string | null;
      scope?: 'ORG' | 'USER';
      kind?: KnowledgeRow['kind'];
      title: string;
      content: string;
    },
  ) {
    const title = requireText(p.title, 'Tiêu đề', KNOWLEDGE_LIMITS.title);
    const content = requireText(p.content, 'Nội dung', KNOWLEDGE_LIMITS.content);
    const scope = p.scope === 'USER' ? 'USER' : 'ORG';
    const kind = scope === 'USER' ? 'PREFERENCE' : (p.kind ?? 'RULE');
    if (
      !['TERM', 'RULE', 'FAQ', 'DOCUMENT', 'PREFERENCE'].includes(kind) ||
      (scope === 'ORG' && kind === 'PREFERENCE')
    )
      throw new AppError('VALIDATION', 'Loại kiến thức không hợp lệ');
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(
        tx,
        call,
        scope === 'ORG' ? 'settings.manage' : 'assistant.use',
      );
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const hit = lockedTopicIn(`${title}\n${content}`, lockedTopicsOf(t.settings));
      if (hit)
        throw new AppError(
          'VALIDATION',
          `Nội dung chạm chủ đề nội bộ đã khóa "${hit.topic.name}": trợ lý không được dùng nên không lưu`,
          { field: 'content' },
        );
      const rows = await tx.list('knowledge', ws.tenantId);
      const existing = p.id ? rows.find((r) => r.id === p.id) : undefined;
      if (p.id && !existing) throw new AppError('NOT_FOUND', 'Không tìm thấy mục kiến thức');
      if (existing && (existing.scope !== scope || (scope === 'USER' && existing.userId !== ws.user.id)))
        throw new AppError('FORBIDDEN', 'Bạn không sửa được mục kiến thức này');
      if (!existing) {
        const count = rows.filter((r) =>
          scope === 'ORG' ? r.scope === 'ORG' && r.status !== 'REJECTED' : r.userId === ws.user.id,
        ).length;
        if (count >= (scope === 'ORG' ? KNOWLEDGE_LIMITS.orgItems : KNOWLEDGE_LIMITS.userItems))
          throw new AppError('VALIDATION', 'Kho kiến thức đã đầy, hãy xóa bớt mục cũ');
      }
      const row = await tx.put('knowledge', {
        ...(existing ?? {}),
        id: existing?.id ?? newId('kno'),
        tenantId: ws.tenantId,
        scope,
        userId: scope === 'USER' ? ws.user.id : null,
        kind,
        title,
        content,
        source: existing?.source ?? (scope === 'USER' ? 'CONVERSATION' : 'ADMIN'),
        // An administrator's own words need no second approval.
        status: 'ACTIVE',
        createdBy: existing?.createdBy ?? ws.user.id,
        createdByName: existing?.createdByName ?? ws.membership.displayName,
        reviewedBy: scope === 'ORG' ? ws.user.id : null,
        reviewedAt: scope === 'ORG' ? this.core.now() : null,
      } as KnowledgeRow);
      if (scope === 'ORG')
        await em.audit(
          ws.tenantId,
          actor(ws),
          existing ? 'knowledge.update' : 'knowledge.add',
          row.id,
          title,
        );
      return this.view(row);
    });
  }

  /** An administrator approves or rejects what the assistant learnt from a correction. */
  async review(call: CallContext, p: { id: string; approve: boolean }) {
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const r = requireFound(await tx.get('knowledge', ws.tenantId, p.id), 'mục kiến thức');
      if (r.scope !== 'ORG' || r.status !== 'PENDING')
        throw new AppError('CONFLICT', 'Mục này không còn chờ duyệt');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      if (p.approve && lockedTopicIn(`${r.title}\n${r.content}`, lockedTopicsOf(t.settings)))
        throw new AppError('VALIDATION', 'Nội dung chạm chủ đề nội bộ đã khóa, không thể duyệt');
      const row = await tx.put('knowledge', {
        ...r,
        status: p.approve ? 'ACTIVE' : 'REJECTED',
        reviewedBy: ws.user.id,
        reviewedAt: now,
      });
      await em.audit(
        ws.tenantId,
        actor(ws),
        p.approve ? 'knowledge.approve' : 'knowledge.reject',
        r.id,
        r.title,
      );
      return this.view(row);
    });
  }

  async remove(call: CallContext, p: { id: string }) {
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'assistant.use');
      const r = requireFound(await tx.get('knowledge', ws.tenantId, p.id), 'mục kiến thức');
      if (r.scope === 'USER' ? r.userId !== ws.user.id : !this.core.can(ws, 'settings.manage'))
        throw new AppError('FORBIDDEN', 'Bạn không xóa được mục kiến thức này');
      await tx.delete('knowledge', ws.tenantId, r.id);
      if (r.scope === 'ORG') await em.audit(ws.tenantId, actor(ws), 'knowledge.remove', r.id, r.title);
      return { id: r.id };
    });
  }

  /**
   * Imports a handbook or glossary the organisation owns (plain text): split into passages the
   * assistant can look up. Passages touching a locked topic are left out.
   */
  async importText(call: CallContext, p: { name: string; text: string }) {
    const name = requireText(p.name, 'Tên tài liệu', 120).replace(/\.(txt|md|csv)$/i, '');
    if (typeof p.text !== 'string' || !p.text.trim())
      throw new AppError('VALIDATION', 'Tài liệu không có nội dung');
    if (p.text.length > KNOWLEDGE_LIMITS.importChars)
      throw new AppError('VALIDATION', 'Tài liệu quá dài (tối đa khoảng 200.000 ký tự mỗi lần nhập)');
    const passages = splitPassages(name, p.text);
    if (passages.length > KNOWLEDGE_LIMITS.importPassages)
      throw new AppError(
        'VALIDATION',
        `Tài liệu chia thành quá nhiều đoạn (${passages.length}), hãy tách nhỏ`,
      );
    return this.core.command(call, async (tx, em, now) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      const locked = lockedTopicsOf(t.settings);
      const count = (await tx.list('knowledge', ws.tenantId)).filter(
        (r) => r.scope === 'ORG' && r.status !== 'REJECTED',
      ).length;
      const keep = passages.filter((x) => !lockedTopicIn(`${x.title}\n${x.content}`, locked));
      if (count + keep.length > KNOWLEDGE_LIMITS.orgItems)
        throw new AppError('VALIDATION', 'Kho kiến thức không đủ chỗ cho tài liệu này, hãy xóa bớt mục cũ');
      for (const x of keep)
        await tx.put('knowledge', {
          id: newId('kno'),
          tenantId: ws.tenantId,
          scope: 'ORG',
          userId: null,
          kind: 'DOCUMENT',
          title: x.title,
          content: x.content.slice(0, KNOWLEDGE_LIMITS.content),
          source: 'IMPORT',
          status: 'ACTIVE',
          createdBy: ws.user.id,
          createdByName: ws.membership.displayName,
          reviewedBy: ws.user.id,
          reviewedAt: now,
        } as KnowledgeRow);
      await em.audit(
        ws.tenantId,
        actor(ws),
        'knowledge.import',
        name,
        `${keep.length} đoạn${passages.length > keep.length ? `, bỏ ${passages.length - keep.length} đoạn chạm chủ đề khóa` : ''}`,
      );
      return { imported: keep.length, skipped: passages.length - keep.length };
    });
  }

  /** Replaces the organisation's locked topics (administrators). */
  async saveLockedTopics(
    call: CallContext,
    p: { topics: { id?: string | null; name: string; keywords: string[] | string }[] },
  ) {
    if (!Array.isArray(p.topics)) throw new AppError('VALIDATION', 'Danh sách chủ đề không hợp lệ');
    if (p.topics.length > KNOWLEDGE_LIMITS.topics)
      throw new AppError('VALIDATION', `Tối đa ${KNOWLEDGE_LIMITS.topics} chủ đề khóa`);
    const topics: LockedTopicSetting[] = p.topics.map((x, i) => {
      const name = requireText(x.name, `Tên chủ đề ${i + 1}`, 120);
      const list = (Array.isArray(x.keywords) ? x.keywords : String(x.keywords ?? '').split(/[,;\n]/))
        .map((k) => String(k).trim())
        .filter((k) => k.length >= 2);
      const keywords = [...new Set(list)];
      if (!keywords.length)
        throw new AppError('VALIDATION', `Chủ đề "${name}" cần ít nhất một từ khóa`, { field: `topic${i}` });
      if (keywords.length > KNOWLEDGE_LIMITS.keywords || keywords.some((k) => k.length > 60))
        throw new AppError('VALIDATION', `Từ khóa của chủ đề "${name}" quá nhiều hoặc quá dài`);
      return { id: x.id && /^ltp_/.test(x.id) ? x.id : newId('ltp'), name, keywords };
    });
    return this.core.command(call, async (tx, em) => {
      const ws = await this.core.requireWorkspace(tx, call, 'settings.manage');
      const t = requireFound(await tx.get('tenants', ws.tenantId, ws.tenantId), 'tổ chức');
      await tx.put('tenants', { ...t, settings: { ...t.settings, lockedTopics: topics } });
      await em.audit(
        ws.tenantId,
        actor(ws),
        'assistant.locked_topics',
        ws.tenantId,
        topics
          .map((x) => x.name)
          .join(', ')
          .slice(0, 300) || 'không còn chủ đề khóa',
      );
      return { topics };
    });
  }
}
