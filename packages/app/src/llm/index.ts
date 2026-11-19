/**
 * Claude and ChatGPT with the organisation's own API key, or the server's. The SDKs load only when a
 * provider is actually used, so the browser and phone apps stay light until an administrator
 * connects one.
 */
import type { AiKeys, AiProvider, LlmClient, LlmRunInput } from '../runtime';
import { CLAUDE_MODEL, DEFAULT_OPENAI_MODEL } from './models';

export { CLAUDE_MODEL, DEFAULT_OPENAI_MODEL } from './models';

export interface AiKeyOptions {
  /** Running in a browser with a key typed on this device (the SDKs ask for an explicit opt-in). */
  browser?: boolean | undefined;
  fetch?: typeof fetch | undefined;
  models?: Partial<Record<AiProvider, string | undefined>> | undefined;
}

type Checked = LlmClient & { check(): Promise<void> };

async function load(provider: AiProvider, apiKey: string, o: AiKeyOptions, model: string): Promise<Checked> {
  const opts = { model, browser: o.browser, fetch: o.fetch };
  if (provider === 'claude') {
    const { ClaudeLlmClient } = await import('./claude');
    return new ClaudeLlmClient(apiKey, opts);
  }
  const { OpenAiLlmClient } = await import('./openai');
  return new OpenAiLlmClient(apiKey, opts);
}

/** Turns an SDK failure into a reason the administrator can act on (never echoes the key). */
async function reason(provider: AiProvider, e: unknown, model: string): Promise<string> {
  const who = provider === 'claude' ? 'Anthropic (Claude)' : 'OpenAI (ChatGPT)';
  const sdk =
    provider === 'claude' ? (await import('@anthropic-ai/sdk')).default : (await import('openai')).default;
  if (e instanceof sdk.AuthenticationError) return `Khóa API không đúng hoặc đã bị thu hồi trên ${who}`;
  if (e instanceof sdk.PermissionDeniedError)
    return `Khóa API chưa được ${who} cho phép dùng mô hình ${model}`;
  if (e instanceof sdk.NotFoundError) return `Tài khoản ${who} chưa có quyền dùng mô hình ${model}`;
  if (e instanceof sdk.RateLimitError) return `Tài khoản ${who} đang bị giới hạn tốc độ hoặc đã hết hạn mức`;
  if (e instanceof sdk.APIConnectionError) return `Không kết nối được tới ${who}. Kiểm tra mạng rồi thử lại`;
  if (e instanceof sdk.APIError) return `${who} báo lỗi ${e.status ?? ''}`.trim();
  return `Không kiểm tra được khóa với ${who}`;
}

export function createAiKeys(o: AiKeyOptions = {}): AiKeys {
  const model = (p: AiProvider) => o.models?.[p] || (p === 'claude' ? CLAUDE_MODEL : DEFAULT_OPENAI_MODEL);
  return {
    model,
    create(provider, apiKey): LlmClient {
      let client: Promise<Checked> | null = null;
      return {
        provider,
        name: `${provider}:${model(provider)}`,
        run(input: LlmRunInput) {
          client ??= load(provider, apiKey, o, model(provider));
          return client.then((c) => c.run(input));
        },
      };
    },
    async check(provider, apiKey) {
      const c = await load(provider, apiKey, o, model(provider));
      try {
        await c.check();
      } catch (e) {
        throw new Error(await reason(provider, e, model(provider)), { cause: e });
      }
    },
  };
}
