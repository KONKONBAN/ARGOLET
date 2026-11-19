/**
 * An organisation connects Claude or ChatGPT with its own API key: checked live first, sealed in the
 * key box, never shown again, used for that organisation's assistant only, removable at any time.
 */
import { describe, expect, it } from 'vitest';
import {
  createArgoletApp,
  demoClock,
  MemoryStore,
  seedDemo,
  type AiKeys,
  type AiProvider,
  type LlmClient,
  type SecretBox,
} from '../src';
import { expectAppError, fastHasher, loginAs } from './helpers';

const GOOD_CLAUDE = 'sk-ant-api03-good-key-0000000000000000AB12';
const GOOD_OPENAI = 'sk-proj-good-key-00000000000000000000CD34';

function setup(opts: { withKeyBox?: boolean } = {}) {
  const withKeyBox = opts.withKeyBox ?? true;
  const used: { provider: AiProvider; key: string }[] = [];
  const checked: string[] = [];
  const aiKeys: AiKeys = {
    model: (p) => (p === 'claude' ? 'claude-opus-5-5' : 'gpt-6.1-sol'),
    create(provider, key): LlmClient {
      used.push({ provider, key });
      return {
        provider,
        name: `${provider}:own`,
        async run(input) {
          await input.callTool('document_status', { code: 'CT-1028' });
          return { text: `Trả lời bằng ${provider}.`, toolCalls: [] };
        },
      };
    },
    async check(provider, key) {
      checked.push(key);
      if (!key.includes('good'))
        throw new Error('Khóa API không đúng hoặc đã bị thu hồi trên Anthropic (Claude)');
    },
  };
  // A key box that keeps plaintext out of the stored settings.
  const vault = new Map<string, string>();
  const secrets: SecretBox = {
    async seal(plain) {
      const id = `kc:${vault.size + 1}`;
      vault.set(id, plain);
      return id;
    },
    async open(sealed) {
      return vault.get(sealed)!;
    },
  };
  const clock = demoClock();
  const store = new MemoryStore(undefined, undefined, () => clock().toISOString());
  const app = createArgoletApp({
    store,
    hasher: fastHasher,
    clock,
    ...(withKeyBox ? { aiKeys, secrets } : {}),
  });
  return { app, store, used, checked };
}

describe('organisation AI keys', () => {
  it('connects Claude after a live check, seals the key and answers with it', async () => {
    const { app, store, used, checked } = setup();
    await seedDemo(app);
    const admin = await loginAs(app);
    let s = await app.org.settings(admin);
    expect(s.ai.canConnect).toBe(true);
    expect(s.ai.provider).toBe('off');

    await expectAppError(app.org.connectAi(admin, { provider: 'claude', apiKey: 'abc' }), 'VALIDATION');
    await expectAppError(
      app.org.connectAi(admin, { provider: 'claude', apiKey: 'sk-ant-api03-bad-key-000000000000000' }),
      'VALIDATION',
    );
    expect(checked).toEqual(['sk-ant-api03-bad-key-000000000000000']);

    const r = await app.org.connectAi(admin, { provider: 'claude', apiKey: GOOD_CLAUDE });
    expect(r).toMatchObject({ provider: 'claude', model: 'claude-opus-5-5', keyHint: 'AB12' });
    s = await app.org.settings(admin);
    expect(s.ai.provider).toBe('claude');
    expect(s.ai.providers.find((p) => p.provider === 'claude')).toMatchObject({
      source: 'org',
      keyHint: 'AB12',
      model: 'claude-opus-5-5',
    });
    // The key itself is nowhere in what is stored or shown.
    expect(JSON.stringify(s)).not.toContain(GOOD_CLAUDE);
    expect(JSON.stringify(store.dump())).not.toContain(GOOD_CLAUDE);

    const answer = await app.assistant.ask(admin, { question: 'CT-1028 đã xác nhận chưa?' });
    expect(answer.answer.engine).toBe('claude');
    expect(used).toEqual([{ provider: 'claude', key: GOOD_CLAUDE }]);

    // ChatGPT can be connected too; the organisation picks which one answers.
    await app.org.connectAi(admin, { provider: 'openai', apiKey: GOOD_OPENAI });
    expect((await app.org.settings(admin)).ai.provider).toBe('openai');
    await app.org.updateSettings(admin, { aiProvider: 'claude' });
    expect((await app.org.settings(admin)).ai.provider).toBe('claude');

    await app.org.disconnectAi(admin, { provider: 'claude' });
    s = await app.org.settings(admin);
    expect(s.ai.provider).toBe('off');
    expect(s.ai.providers.find((p) => p.provider === 'claude')!.source).toBeNull();
    expect((await app.assistant.ask(admin, { question: 'CT-1028 đã xác nhận chưa?' })).answer.engine).toBe(
      'rules',
    );
    const audit = (await app.org.settings(admin)).audit.map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['ai.connect', 'ai.disconnect']));
  });

  it('only administrators connect a key, and only where a key box exists', async () => {
    const { app } = setup();
    await seedDemo(app);
    const staff = await loginAs(app, 'minhanh.nguyen@minhan.example');
    await expectAppError(app.org.connectAi(staff, { provider: 'claude', apiKey: GOOD_CLAUDE }), 'FORBIDDEN');

    const bare = setup({ withKeyBox: false });
    await seedDemo(bare.app);
    const admin = await loginAs(bare.app);
    expect((await bare.app.org.settings(admin)).ai.canConnect).toBe(false);
    await expectAppError(
      bare.app.org.connectAi(admin, { provider: 'claude', apiKey: GOOD_CLAUDE }),
      'VALIDATION',
    );
  });
});
