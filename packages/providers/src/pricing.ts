export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Date the table below was last checked against the vendors' pricing pages. */
export const PRICES_AS_OF = '2026-10-31';

// USD per million tokens, standard tier, shortest-prompt rate. Where a vendor
// has announced a dated increase the higher rate is used: the spend cap may
// trip early, never late. llm.inputCostPerMTok/outputCostPerMTok override this.
const PRICES: Record<string, readonly [input: number, output: number]> = {
  'claude-fable-5-1': [10, 50],
  'claude-fable-5': [10, 50],
  'claude-opus-5-5': [4, 20],
  'claude-opus-5': [5, 25],
  'claude-opus-4-8': [5, 25],
  'claude-opus-4-7': [5, 25],
  'claude-opus-4-6': [5, 25],
  'claude-opus-4-5': [5, 25],
  'claude-sonnet-5-5': [2, 10],
  'claude-sonnet-5': [2, 10],
  'claude-sonnet-4-6': [3, 15],
  'claude-sonnet-4-5': [3, 15],
  'claude-haiku-5-5': [0.1, 0.5],
  'claude-haiku-4-5': [1, 5],

  'gpt-6-astra': [10, 50],
  'gpt-6.1-sol': [2, 10],
  'gpt-6.1-terra': [1, 5],
  'gpt-6-sol': [2, 10],
  'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-sol': [4, 20],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.5': [5, 30],
  'gpt-5.4': [2.5, 15],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-5.4-nano': [0.2, 1.25],
  'gpt-5.2': [1.75, 14],
  'gpt-5.1': [1.25, 10],
  'gpt-5': [1.25, 10],
  'gpt-5-mini': [0.25, 2],
  'gpt-5-nano': [0.05, 0.4],
  'gpt-4.1': [2, 8],
  'gpt-4.1-mini': [0.4, 1.6],
  'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4o': [2.5, 10],
  'gpt-4o-mini': [0.15, 0.6],
  o3: [2, 8],
  'o3-mini': [1.1, 4.4],
  'o4-mini': [1.1, 4.4],

  'gemini-4-argon': [4, 20],
  'gemini-3.8-flash': [1.5, 7.5],
  'gemini-3.6-flash': [1.5, 7.5],
  'gemini-3.5-flash-lite': [0.3, 2.5],
  'gemini-3.1-flash-lite': [0.25, 1.5],
  'gemini-3.1-pro-preview': [2, 12],
  'gemini-3-flash-preview': [0.5, 3],
  'gemini-2.5-pro': [1.25, 10],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.5-flash-lite': [0.1, 0.4],
};

/** List price for a model id, or null when unknown. Tolerates gateway prefixes
 * (openrouter's `anthropic/...`, Gemini's `models/...`) and dated snapshots. */
export function lookupModelPrice(model: string): ModelPrice | null {
  let bare = model.slice(model.lastIndexOf('/') + 1).toLowerCase();
  // Gateways spell Claude versions with a dot: anthropic/claude-sonnet-4.5.
  if (bare.startsWith('claude-')) bare = bare.replaceAll('.', '-');
  const price = PRICES[bare] ?? PRICES[bare.replace(/[-@](\d{8}|\d{4}-\d{2}-\d{2})$/, '')];
  return price ? { inputPerMTok: price[0], outputPerMTok: price[1] } : null;
}
