import { describe, expect, it, vi } from 'vitest';
import { createProvider } from '../src/factory.js';
import { lookupModelPrice } from '../src/pricing.js';
import type { LLMCallRecord } from '../src/types.js';

const base = { timeoutMs: 1000, maxRetries: 0, backoffBaseMs: 1, circuitBreakerThreshold: 3 };

const openAiReply = () =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
    }),
    { status: 200 },
  );

async function costOf(opts: Parameters<typeof createProvider>[0]): Promise<number> {
  const calls: LLMCallRecord[] = [];
  const setup = createProvider(
    { ...opts, fetchImpl: vi.fn(async () => openAiReply()) as unknown as typeof fetch },
    { onCall: (r) => calls.push(r) },
  );
  await setup.provider!.complete({
    messages: [{ role: 'user', content: 'hi' }],
    purpose: 'unit-test',
  });
  return calls[0]!.costUsd;
}

describe('lookupModelPrice', () => {
  it('finds exact ids', () => {
    expect(lookupModelPrice('claude-opus-5-5')).toEqual({ inputPerMTok: 4, outputPerMTok: 20 });
  });
  it('tolerates gateway prefixes and dated snapshots', () => {
    expect(lookupModelPrice('anthropic/claude-opus-5-5')?.inputPerMTok).toBe(4);
    expect(lookupModelPrice('models/gemini-2.5-flash')?.inputPerMTok).toBe(0.3);
    expect(lookupModelPrice('gpt-5-2025-08-07')?.inputPerMTok).toBe(1.25);
  });
  it('does not guess a sibling price for an unknown model', () => {
    expect(lookupModelPrice('gpt-5.9')).toBeNull();
    expect(lookupModelPrice('gemma-4-31b-it')).toBeNull();
  });
});

describe('createProvider pricing', () => {
  const cloud = {
    ...base,
    provider: 'openai-compatible' as const,
    baseUrl: 'https://gateway.example.com/v1',
    apiKey: 'k',
  };

  it('prices a listed model with no config, so the spend cap works by default', async () => {
    const setup = createProvider({ ...cloud, model: 'gpt-5' });
    expect(setup.priceWarning).toBeNull();
    expect(await costOf({ ...cloud, model: 'gpt-5' })).toBeCloseTo(11.25);
  });

  it('explicit rates win over the table, including an explicit 0', async () => {
    const opts = { ...cloud, model: 'gpt-5', inputCostPerMTok: 1, outputCostPerMTok: 2 };
    expect(await costOf(opts)).toBeCloseTo(3);
    expect(await costOf({ ...opts, inputCostPerMTok: 0, outputCostPerMTok: 0 })).toBe(0);
  });

  it('warns when a remote model has no known price', () => {
    const setup = createProvider({ ...cloud, model: 'mystery-1' });
    expect(setup.provider).not.toBeNull();
    expect(setup.priceWarning).toMatch(/no price known.*maxTokensPerRun/);
  });

  it('local backends are free and silent', async () => {
    const local = { ...cloud, baseUrl: 'http://localhost:11434/v1', model: 'gpt-5' };
    expect(createProvider(local).priceWarning).toBeNull();
    expect(await costOf(local)).toBe(0);
  });
});

describe('models named in the docs', () => {
  it.each([
    ['anthropic/claude-sonnet-4.5', 3, 15],
    ['claude-sonnet-4-5', 3, 15],
    ['claude-sonnet-5-5', 2, 10],
  ])('%s is priced', (model, inputPerMTok, outputPerMTok) => {
    expect(lookupModelPrice(model)).toEqual({ inputPerMTok, outputPerMTok });
  });

  it('only rewrites dots for Claude, whose gateway spelling differs', () => {
    expect(lookupModelPrice('openai/gpt-5.1')).toEqual({ inputPerMTok: 1.25, outputPerMTok: 10 });
  });
});
