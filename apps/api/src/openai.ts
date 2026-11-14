import OpenAI from 'openai';
import type { LlmClient, LlmRunInput } from '@argolet/app';

/** Overridable per deployment (ARGOLET_OPENAI_MODEL); a high-capability reasoning model by default. */
const DEFAULT_MODEL = process.env.ARGOLET_OPENAI_MODEL || 'gpt-6.1-sol';

/**
 * ChatGPT-backed assistant (OpenAI Responses API) behind the same controls as Claude: the tool loop
 * runs here so every tool call goes through ARGOLET's ToolGateway (permissions, schema, audit).
 *  - store: false — responses are not kept on OpenAI's side for later retrieval;
 *  - stateless turns: reasoning items travel back encrypted (include reasoning.encrypted_content);
 *  - safety_identifier: the pseudonymous user reference only, never a name or e-mail;
 *  - one tool call at a time, bounded turns, output and time.
 */
export class OpenAiLlmClient implements LlmClient {
  readonly provider = 'openai' as const;
  readonly name: string;
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, opts: { model?: string; fetch?: typeof fetch } = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = `openai:${this.model}`;
    this.client = new OpenAI({
      apiKey,
      timeout: 60_000,
      maxRetries: 2,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async run(input: LlmRunInput): Promise<{
    text: string;
    toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[];
  }> {
    const tools: OpenAI.Responses.FunctionTool[] = input.tools.map((t) => {
      const schema = t.input_schema as { properties?: Record<string, unknown>; required?: string[] };
      const props = Object.keys(schema.properties ?? {});
      return {
        type: 'function',
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
        // Strict schemas need every property required; tools with optional arguments run non-strict
        // and are validated by the ToolGateway anyway.
        strict: props.every((p) => schema.required?.includes(p)),
      };
    });
    const items: OpenAI.Responses.ResponseInputItem[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[] = [];
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.client.responses.create({
        model: this.model,
        instructions: input.system,
        input: items,
        tools,
        parallel_tool_calls: false,
        store: false,
        include: ['reasoning.encrypted_content'],
        safety_identifier: input.userRef,
        max_output_tokens: 4096,
      });
      const calls = response.output.filter(
        (o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === 'function_call',
      );
      if (calls.length === 0) {
        const refused = response.output.some(
          (o) => o.type === 'message' && o.content.some((c) => c.type === 'refusal'),
        );
        return {
          text: refused ? 'Tôi không thể hỗ trợ yêu cầu này.' : response.output_text.trim(),
          toolCalls,
        };
      }
      items.push(...(response.output as OpenAI.Responses.ResponseInputItem[]));
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(call.arguments || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }
        let output: unknown;
        try {
          output = await input.callTool(call.name, args);
        } catch (e) {
          output = { error: e instanceof Error ? e.message : 'Lỗi công cụ' };
        }
        toolCalls.push({ name: call.name, input: args, output });
        items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      }
    }
    return { text: 'Tôi cần thêm thông tin để trả lời câu hỏi này.', toolCalls };
  }
}
