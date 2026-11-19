/**
 * Claude and ChatGPT clients against stand-in HTTP endpoints: what actually leaves the server
 * (no storage at OpenAI, opaque user reference, tool results as data) and the tool loop.
 */
import { describe, expect, it } from 'vitest';
import type { LlmRunInput } from '@argolet/app';
import { ClaudeLlmClient, OpenAiLlmClient } from '@argolet/app/llm/clients';

function stand(responses: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    const body = responses[Math.min(bodies.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  return { fetch, bodies, urls };
}

const input = (calls: unknown[]): LlmRunInput => ({
  system: 'Bạn là Trợ lý ARGOLET.',
  messages: [{ role: 'user', content: 'Chứng từ CT-1028 của [NGƯỜI_1] đã xác nhận chưa?' }],
  tools: [
    {
      name: 'document_status',
      description: 'Trạng thái chứng từ',
      input_schema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'Mã chứng từ' } },
        required: ['code'],
        additionalProperties: false,
      },
    },
  ],
  callTool: async (name, args) => {
    calls.push({ name, args });
    return { summary: 'CT-1028 đang chờ xác nhận', data: { status: 'NEEDS_REVIEW' } };
  },
  userRef: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
});

describe('ChatGPT (OpenAI Responses API)', () => {
  it('runs the tool loop statelessly: store false, encrypted reasoning, opaque safety id', async () => {
    const s = stand([
      {
        id: 'resp_1',
        object: 'response',
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'document_status',
            arguments: '{"code":"CT-1028"}',
            status: 'completed',
          },
        ],
      },
      {
        id: 'resp_2',
        object: 'response',
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'CT-1028 đang chờ xác nhận.', annotations: [] }],
          },
        ],
      },
    ]);
    const calls: unknown[] = [];
    const client = new OpenAiLlmClient('sk-test', { model: 'gpt-6.1-sol', fetch: s.fetch });
    const r = await client.run(input(calls));
    expect(r.text).toBe('CT-1028 đang chờ xác nhận.');
    expect(calls).toEqual([{ name: 'document_status', args: { code: 'CT-1028' } }]);
    expect(s.urls[0]).toMatch(/\/responses$/);
    expect(s.bodies[0]).toMatchObject({
      model: 'gpt-6.1-sol',
      instructions: 'Bạn là Trợ lý ARGOLET.',
      store: false,
      include: ['reasoning.encrypted_content'],
      safety_identifier: '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
      parallel_tool_calls: false,
      tools: [{ type: 'function', name: 'document_status', strict: true }],
    });
    // The second turn carries the call and its output back (nothing kept server-side at OpenAI).
    const second = s.bodies[1]!.input as { type?: string; call_id?: string; output?: string }[];
    expect(second.at(-1)).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: JSON.stringify({ summary: 'CT-1028 đang chờ xác nhận', data: { status: 'NEEDS_REVIEW' } }),
    });
  });
});

describe('Claude (Anthropic Messages API)', () => {
  it('sends the opaque user reference as metadata and returns after the tool loop', async () => {
    const s = stand([
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'document_status', input: { code: 'CT-1028' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      {
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text: 'CT-1028 đang chờ xác nhận.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ]);
    const calls: unknown[] = [];
    const client = new ClaudeLlmClient('sk-ant-test', { fetch: s.fetch });
    const r = await client.run(input(calls));
    expect(r.text).toBe('CT-1028 đang chờ xác nhận.');
    expect(calls).toEqual([{ name: 'document_status', args: { code: 'CT-1028' } }]);
    expect(s.bodies[0]).toMatchObject({
      metadata: { user_id: '0f1e2d3c4b5a69788796a5b4c3d2e1f0' },
      thinking: { type: 'adaptive' },
    });
    const turn2 = s.bodies[1]!.messages as { role: string; content: unknown }[];
    expect(turn2.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1' }],
    });
  });
});
