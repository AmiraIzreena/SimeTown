import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig, type Config } from '@/server/config';

/** The hosted-model settings, and the exact requests sent to each provider. No real key or network is used. */

const env = { APP_URL: 'http://kita.test', DATABASE_URL: 'pglite://memory' };
let config: Config = parseConfig(env);
vi.mock('@/server/config', async (actual) => ({ ...(await actual<typeof import('@/server/config')>()), getConfig: () => config }));

const { suggestReport } = await import('@/server/ai/classifier');

/** A fake provider: records the request and answers with `reply`. */
function fakeProvider(reply: unknown, status = 200) {
  const calls: [string, RequestInit][] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    return new Response(JSON.stringify(reply), { status });
  }));
  return () => {
    const [url, init] = calls[0]!;
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  config = parseConfig(env);
});

describe('AI provider settings', () => {
  it('needs a key and a model, and fills in each provider’s own endpoint', () => {
    expect(() => parseConfig({ ...env, AI_PROVIDER: 'openai', AI_MODEL: 'gpt-4.1-mini' })).toThrow(/AI_API_KEY and AI_MODEL/);
    expect(parseConfig({ ...env, AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm' }).AI_API_URL).toBe('https://api.openai.com/v1/chat/completions');
    expect(parseConfig({ ...env, AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'm' }).AI_API_URL).toBe('https://api.anthropic.com/v1/messages');
    expect(parseConfig({ ...env, AI_PROVIDER: 'openai', AI_API_KEY: 'k', AI_MODEL: 'm', AI_API_URL: 'https://proxy.example/v1/chat/completions' }).AI_API_URL).toBe('https://proxy.example/v1/chat/completions');
    expect(parseConfig(env).AI_API_URL).toBeUndefined();
    expect(() => parseConfig({ ...env, AI_PROVIDER: 'gemini' })).toThrow(/AI_PROVIDER/);
  });
});

describe('OpenAI requests', () => {
  const photo = { mime: 'image/png' as const, bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) };

  it('sends the report with its photo to Chat Completions and uses the model’s answer', async () => {
    config = parseConfig({ ...env, AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test', AI_MODEL: 'gpt-4.1-mini' });
    const sent = fakeProvider({ choices: [{ message: { content: '{"category": "LIGHTING", "urgency": "HIGH"}' } }] });

    expect(await suggestReport('Lampu jalan rosak', photo)).toEqual({ category: 'LIGHTING', urgency: 'HIGH', source: 'MODEL' });
    const { url, headers, body } = sent();
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(body.model).toBe('gpt-4.1-mini');
    expect(body.max_completion_tokens).toBe(100);
    expect(body.messages[0]).toMatchObject({ role: 'system' });
    expect(body.messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(photo.bytes).toString('base64')}` } },
      { type: 'text', text: 'Report text: "Lampu jalan rosak"' },
    ]);
  });

  it('gives a reasoning model the larger output budget when one is set', async () => {
    expect(() => parseConfig({ ...env, AI_MAX_OUTPUT_TOKENS: '50' })).toThrow(/AI_MAX_OUTPUT_TOKENS/);
    expect(parseConfig(env).AI_TIMEOUT_SECONDS).toBe(8);
    config = parseConfig({ ...env, AI_PROVIDER: 'openai', AI_API_KEY: 'sk-test', AI_MODEL: 'gpt-5.6-luna', AI_MAX_OUTPUT_TOKENS: '2000', AI_TIMEOUT_SECONDS: '30' });
    const sent = fakeProvider({ choices: [{ message: { content: '{"category": "POTHOLE", "urgency": "MEDIUM"}' } }] });
    expect(await suggestReport('Jalan berlubang')).toMatchObject({ category: 'POTHOLE', source: 'MODEL' });
    expect(sent().body.max_completion_tokens).toBe(2000);
  });

  it('falls back to the keyword rules when OpenAI refuses the request', async () => {
    config = parseConfig({ ...env, AI_PROVIDER: 'openai', AI_API_KEY: 'sk-wrong', AI_MODEL: 'gpt-4.1-mini' });
    fakeProvider({ error: { message: 'Incorrect API key provided' } }, 401);
    expect(await suggestReport('Longkang tersumbat')).toMatchObject({ category: 'DRAINAGE', source: 'RULES' });
  });
});

describe('Anthropic requests', () => {
  it('still sends the Messages format', async () => {
    config = parseConfig({ ...env, AI_PROVIDER: 'anthropic', AI_API_KEY: 'ak-test', AI_MODEL: 'claude-sonnet-5-5' });
    const sent = fakeProvider({ content: [{ type: 'text', text: '{"category": "WASTE", "urgency": "LOW"}' }] });
    expect(await suggestReport('Sampah')).toMatchObject({ category: 'WASTE', source: 'MODEL' });
    const { headers, body } = sent();
    expect(headers['x-api-key']).toBe('ak-test');
    expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 100, messages: [{ role: 'user' }] });
  });
});
