import Anthropic from '@anthropic-ai/sdk';
import type { ExtractionProvider, ExtractionResult } from '@argolet/core';
import type { LlmClient, LlmRunInput } from '@argolet/app';

export const CLAUDE_MODEL = process.env.ARGOLET_CLAUDE_MODEL ?? 'claude-opus-5-5';

/**
 * Claude-backed assistant (board 08 "AI có kiểm soát"). Manual tool loop so that every
 * tool call goes through the server-side ToolGateway (permissions, schema, audit).
 * Server-side refusal fallbacks are enabled ("default" routing by refusal category).
 */
export class ClaudeLlmClient implements LlmClient {
  readonly name = `claude:${CLAUDE_MODEL}`;
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async run(input: LlmRunInput): Promise<{ text: string; toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[] }> {
    const tools: Anthropic.Beta.BetaTool[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
    const toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[] = [];
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.client.beta.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        tools,
        messages,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      if (response.stop_reason === 'refusal') {
        return { text: 'Tôi không thể hỗ trợ yêu cầu này.', toolCalls };
      }
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { text, toolCalls };
      }
      messages.push({ role: 'assistant', content: response.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const args = (use.input && typeof use.input === 'object' ? use.input : {}) as Record<string, unknown>;
        let output: unknown;
        let isError = false;
        try {
          output = await input.callTool(use.name, args);
        } catch (e) {
          output = { error: e instanceof Error ? e.message : 'Lỗi công cụ' };
          isError = true;
        }
        toolCalls.push({ name: use.name, input: args, output });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(output), is_error: isError });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: 'Tôi cần thêm thông tin để trả lời câu hỏi này.', toolCalls };
  }
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    supplier: { type: 'string', description: 'Tên nhà cung cấp / người bán' },
    documentNo: { type: 'string', description: 'Số chứng từ / số hóa đơn' },
    documentDate: { type: 'string', description: 'Ngày chứng từ dạng YYYY-MM-DD, rỗng nếu không đọc được' },
    total: { type: 'string', description: 'Tổng thanh toán, chỉ chữ số (VND), rỗng nếu không đọc được' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, amount: { type: 'string' } },
        required: ['description', 'amount'],
        additionalProperties: false,
      },
    },
    confidence: {
      type: 'object',
      properties: { supplier: { type: 'number' }, documentNo: { type: 'number' }, documentDate: { type: 'number' }, total: { type: 'number' } },
      required: ['supplier', 'documentNo', 'documentDate', 'total'],
      additionalProperties: false,
    },
  },
  required: ['supplier', 'documentNo', 'documentDate', 'total', 'lines', 'confidence'],
  additionalProperties: false,
} as const;

interface Extracted {
  supplier: string;
  documentNo: string;
  documentDate: string;
  total: string;
  lines: { description: string; amount: string }[];
  confidence: { supplier: number; documentNo: number; documentDate: number; total: number };
}

/** OCR / VLM extraction of Vietnamese receipts and invoices with Claude vision + structured outputs. */
export class ClaudeVisionExtractionProvider implements ExtractionProvider {
  readonly modelVersion = `vlm:${CLAUDE_MODEL}`;
  private readonly client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
  }

  async extract(input: { bytes: Uint8Array; mime: string; filename: string }): Promise<ExtractionResult> {
    const data = Buffer.from(input.bytes).toString('base64');
    const isPdf = input.mime === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf');
    const media = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(input.mime) ? input.mime : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    const source: Anthropic.Beta.BetaContentBlockParam = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : { type: 'image', source: { type: 'base64', media_type: media, data } };
    const response = await this.client.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              text: 'Trích xuất các trường của chứng từ kế toán Việt Nam trong tệp. Chỉ ghi giá trị đọc được trên chứng từ; để trống nếu không chắc chắn. Số tiền chỉ gồm chữ số. Độ tin cậy từ 0 đến 1 cho từng trường.',
            },
          ],
        },
      ],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (response.stop_reason === 'refusal') throw new Error('Không thể trích xuất chứng từ này');
    const text = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')?.text ?? '{}';
    const parsed = JSON.parse(text) as Extracted;
    const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
    return {
      modelVersion: this.modelVersion,
      fields: [
        { name: 'supplier', value: parsed.supplier ?? '', confidence: clamp(parsed.confidence?.supplier) },
        { name: 'documentNo', value: parsed.documentNo ?? '', confidence: clamp(parsed.confidence?.documentNo) },
        { name: 'documentDate', value: /^\d{4}-\d{2}-\d{2}$/.test(parsed.documentDate ?? '') ? parsed.documentDate : '', confidence: clamp(parsed.confidence?.documentDate) },
        { name: 'total', value: (parsed.total ?? '').replace(/\D/g, ''), confidence: clamp(parsed.confidence?.total) },
      ],
      lines: (parsed.lines ?? []).map((l) => ({ description: l.description, amount: l.amount.replace(/\D/g, '') })).filter((l) => l.amount),
    };
  }
}
