import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../src/anthropic.js';
import { createProvider } from '../src/factory.js';
import {
  createOpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from '../src/openaiCompatible.js';

describe('openai-compatible: parameters a model refuses', () => {
  const ok = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
  const rejected = (message: string) =>
    new Response(JSON.stringify({ error: { message } }), { status: 400 });
  const adapter = (fetchMock: unknown, extra: Partial<OpenAICompatibleOptions> = {}) =>
    createOpenAICompatibleProvider({
      baseUrl: 'https://api.example.com/v1',
      model: 'o-reasoner',
      apiKey: 'k',
      timeoutMs: 1000,
      supportsVision: false,
      fetchImpl: fetchMock as typeof fetch,
      ...extra,
    });
  const bodies = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
  const req = {
    messages: [{ role: 'user' as const, content: 'x' }],
    maxTokens: 64,
    purpose: 'unit-test',
  };

  it('drops temperature when the model refuses it, and remembers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        rejected("Unsupported value: 'temperature' does not support 0 with this model."),
      )
      .mockImplementation(async () => ok());
    const p = adapter(fetchMock);
    expect((await p.complete(req)).text).toBe('hi');
    await p.complete(req);
    const sent = bodies(fetchMock);
    expect(sent).toHaveLength(3);
    expect(sent[0].temperature).toBe(0);
    expect(sent[1].temperature).toBeUndefined();
    expect(sent[2].temperature).toBeUndefined();
  });

  it('switches to max_completion_tokens when told to', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        rejected("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'."),
      )
      .mockImplementation(async () => ok());
    await adapter(fetchMock).complete(req);
    const sent = bodies(fetchMock);
    expect(sent[1].max_completion_tokens).toBe(64);
    expect(sent[1].max_tokens).toBeUndefined();
  });

  it('recovers when both are refused in turn', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rejected("Use 'max_completion_tokens' instead of 'max_tokens'."))
      .mockResolvedValueOnce(rejected('temperature is not supported'))
      .mockImplementation(async () => ok());
    expect((await adapter(fetchMock).complete(req)).text).toBe('hi');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('an unrelated 400 fails without retrying', async () => {
    const fetchMock = vi.fn(async () => rejected('model not found'));
    await expect(adapter(fetchMock).complete(req)).rejects.toThrow(/HTTP 400.*model not found/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a persistent temperature 400 cannot loop forever', async () => {
    const fetchMock = vi.fn(async () => rejected('temperature is not supported'));
    await expect(adapter(fetchMock).complete(req)).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('the openai preset starts on max_completion_tokens; others on max_tokens', async () => {
    const run = async (provider: 'openai' | 'openai-compatible') => {
      const fetchMock = vi.fn(async () => ok());
      const { provider: p } = createProvider({
        provider,
        model: 'gpt-5',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'k',
        timeoutMs: 1000,
        maxRetries: 0,
        backoffBaseMs: 1,
        circuitBreakerThreshold: 3,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });
      await p!.complete(req);
      return bodies(fetchMock as unknown as ReturnType<typeof vi.fn>)[0];
    };
    expect(await run('openai')).toMatchObject({ max_completion_tokens: 64 });
    expect(await run('openai-compatible')).toMatchObject({ max_tokens: 64 });
  });
});

describe('anthropic: request shape', () => {
  const reply = () =>
    new Response(
      JSON.stringify({
        content: [{ type: 'text', text: 'ok' }],
        usage: {},
        stop_reason: 'end_turn',
      }),
      { status: 200 },
    );
  const provider = (model: string, fetchMock: unknown) =>
    createAnthropicProvider({
      model,
      apiKey: 'k',
      timeoutMs: 1000,
      supportsVision: false,
      fetchImpl: fetchMock as typeof fetch,
    });
  const sentBody = async (model: string) => {
    const fetchMock = vi.fn(async () => reply());
    await provider(model, fetchMock).complete({
      messages: [{ role: 'user', content: 'x' }],
      purpose: 'unit-test',
    });
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    return JSON.parse(init.body as string);
  };

  it.each([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-opus-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-fable-5-1',
    'claude-some-future-model',
  ])('%s: sends no temperature (a 400 on current models)', async (model) => {
    expect(await sentBody(model)).not.toHaveProperty('temperature');
  });

  it.each([
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
    'claude-opus-4-5-20251101',
    'claude-sonnet-4-20250514',
    'claude-3-5-haiku-20241022',
  ])('%s: keeps temperature 0 for reproducibility', async (model) => {
    expect((await sentBody(model)).temperature).toBe(0);
  });

  it('names the stop reason when thinking used up max_tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ content: [], stop_reason: 'max_tokens' }), { status: 200 }),
    );
    await expect(
      provider('claude-opus-5-5', fetchMock).complete({
        messages: [{ role: 'user', content: 'x' }],
        purpose: 'unit-test',
      }),
    ).rejects.toThrow(/stop_reason: max_tokens/);
  });
});
