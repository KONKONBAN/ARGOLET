import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmRunInput } from '../runtime';

import { CLAUDE_MODEL } from './models';

/**
 * Claude-backed assistant (board 08 "AI có kiểm soát"). Manual tool loop so that every
 * tool call goes through the server-side ToolGateway (permissions, schema, audit).
 * Server-side refusal fallbacks are enabled ("default" routing by refusal category).
 */
export class ClaudeLlmClient implements LlmClient {
  readonly provider = 'claude' as const;
  readonly name: string;
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    apiKey?: string,
    opts: {
      model?: string | undefined;
      fetch?: typeof fetch | undefined;
      browser?: boolean | undefined;
    } = {},
  ) {
    this.model = opts.model || CLAUDE_MODEL;
    this.name = `claude:${this.model}`;
    this.client = new Anthropic({
      ...(apiKey ? { apiKey } : {}),
      timeout: 60_000,
      maxRetries: 2,
      // The organisation's own key, typed by its administrator on this device: allowed in the browser.
      ...(opts.browser ? { dangerouslyAllowBrowser: true } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  /** Checks the key against the model ARGOLET uses, without generating anything (Models API). */
  async check(): Promise<void> {
    await this.client.models.retrieve(this.model);
  }

  async run(input: LlmRunInput): Promise<{
    text: string;
    toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[];
  }> {
    const tools: Anthropic.Beta.BetaTool[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
    }));
    const messages: Anthropic.Beta.BetaMessageParam[] = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const toolCalls: { name: string; input: Record<string, unknown>; output: unknown }[] = [];
    for (let turn = 0; turn < 6; turn++) {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
        thinking: { type: 'adaptive' },
        // Opaque, pseudonymous reference for abuse detection — never a name or e-mail.
        metadata: { user_id: input.userRef },
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
      const uses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
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
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
          is_error: isError,
        });
      }
      messages.push({ role: 'user', content: results });
    }
    return { text: 'Tôi cần thêm thông tin để trả lời câu hỏi này.', toolCalls };
  }
}
