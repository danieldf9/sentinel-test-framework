import {
  LLMProviderError,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
} from './types.js';

export interface OpenAICompatibleOptions {
  /** e.g. https://api.openai.com/v1, http://localhost:11434/v1 (Ollama),
   * https://openrouter.ai/api/v1, LM Studio, Z.ai/GLM, Kimi, ... */
  baseUrl: string;
  model: string;
  /** Optional — local backends (Ollama, LM Studio) need no key. */
  apiKey?: string;
  timeoutMs: number;
  supportsVision: boolean;
  /** Display name for audit rows; defaults to 'openai-compatible'. */
  name?: string;
  /** Request field for the output cap. OpenAI itself replaced `max_tokens`;
   * most compatible backends only know the old name, hence the default. */
  tokenParam?: 'max_tokens' | 'max_completion_tokens';
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

function toOpenAIMessages(messages: LLMMessage[], vision: boolean): Array<Record<string, unknown>> {
  return messages.map((m) => {
    if (m.role === 'user' && vision && m.images && m.images.length > 0) {
      const parts: OpenAIContentPart[] = [{ type: 'text', text: m.content }];
      for (const img of m.images) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
        });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });
}

/**
 * Generic OpenAI-compatible Chat Completions adapter (spec §2 adapter #4).
 * Works against any backend exposing POST {baseUrl}/chat/completions.
 */
export function createOpenAICompatibleProvider(opts: OpenAICompatibleOptions): LLMProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  let tokenParam = opts.tokenParam ?? 'max_tokens';
  let sendTemperature = true;
  return {
    name: opts.name ?? 'openai-compatible',
    model: opts.model,
    supportsVision: opts.supportsVision,
    async complete(request: LLMRequest): Promise<LLMResponse> {
      const started = Date.now();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;

      const send = async (): Promise<Response> => {
        const body: Record<string, unknown> = {
          model: opts.model,
          messages: toOpenAIMessages(request.messages, opts.supportsVision),
          [tokenParam]: request.maxTokens ?? 1024,
        };
        if (sendTemperature) body.temperature = request.temperature ?? 0;
        if (request.jsonMode) {
          // Best-effort: many compatible backends honor this, some ignore it.
          // Sentinel always Zod-validates + repair-retries regardless.
          body.response_format = { type: 'json_object' };
        }
        try {
          return await fetchImpl(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(opts.timeoutMs),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new LLMProviderError(
            /abort|timeout/i.test(msg)
              ? `request timed out after ${opts.timeoutMs}ms`
              : `network error: ${msg}`,
          );
        }
      };

      // Which models refuse which parameters varies by vendor and over time, so
      // adapt to the 400 instead of tracking model names. At most one retry per
      // parameter, and what was learned sticks for the rest of the run.
      let res = await send();
      while (res.status === 400) {
        const text = await res.text().catch(() => '');
        if (tokenParam === 'max_tokens' && text.includes('max_completion_tokens')) {
          tokenParam = 'max_completion_tokens';
        } else if (sendTemperature && /temperature/i.test(text)) {
          sendTemperature = false;
        } else {
          throw new LLMProviderError(`HTTP 400: ${text.slice(0, 300)}`, 400);
        }
        res = await send();
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new LLMProviderError(`HTTP ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') {
        throw new LLMProviderError('malformed response: choices[0].message.content missing');
      }
      return {
        text,
        model: data.model ?? opts.model,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - started,
      };
    },
  };
}
