/**
 * API response shapes. These mirror the JSON returned by @sentinel/server, which
 * in turn comes from @sentinel/report's query functions. Kept as local types so
 * the browser bundle stays decoupled from the Node packages; if the server
 * contract changes, update these to match.
 */

export type RunStatus = 'passed' | 'passed_unverified' | 'failed' | 'no-runs' | string;

export interface SummaryData {
  runIds: string[];
  tests: number;
  passed: number;
  failed: number;
  heals: number;
  autoHeals: number;
  unverifiedHeals: number;
  humanHeals: number;
  pendingEscalations: number;
  llmCalls: number;
  llmCostUsd: number;
  healingUnavailable: boolean;
  status: RunStatus;
}

export interface HealModeCount {
  mode: string;
  count: number;
}

export interface RunOverview {
  id: string;
  status: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  gitSha: string | null;
  tests: number;
  passed: number;
  heals: HealModeCount[];
  escalations: number;
  llmCalls: number;
  llmCostUsd: number;
  healingUnavailable: boolean;
}

export interface TestResultRow {
  id: number;
  testId: string;
  title: string;
  file: string;
  status: string;
  durationMs: number;
  error: string | null;
  flakyTagged: boolean;
}

export interface HealRow {
  id: number;
  testId: string;
  stepId: string;
  intent: string;
  oldLocator: string;
  newLocator: string;
  tier: number;
  confidence: number;
  mode: string;
  reasoning: string;
  /** Servable /artifacts URL (or null) — the server rewrites the stored path. */
  screenshotBefore: string | null;
  screenshotAfter: string | null;
  promoted: boolean;
  ts: number;
}

export interface Fingerprint {
  tag: string;
  name: string;
  text: string;
  cssPath: string;
}

export interface EscalationCandidate {
  label: string;
  confidence: number;
  fingerprint: Fingerprint;
}

export interface EscalationQuestion {
  test: string;
  step: string;
  intent: string;
  question: string;
  candidates: EscalationCandidate[];
  context: {
    url?: string;
    classification?: string;
    screenshot?: string | null;
    error?: string;
    oldLocator?: string;
  };
}

export interface EscalationRow {
  id: number;
  testId: string;
  stepId: string;
  status: string;
  answer: string | null;
  answeredBy: string | null;
  question: EscalationQuestion | null;
}

export interface PendingEscalation {
  id: number;
  runId: string;
  testId: string;
  stepId: string;
  question: EscalationQuestion;
}

export interface AnswerResult {
  escalationId: number;
  testId: string;
  stepId: string;
  redesign: boolean;
  appliedDescriptor: string | null;
}

export interface RunDetail {
  tests: TestResultRow[];
  heals: HealRow[];
  escalations: EscalationRow[];
}

export interface FlakeStat {
  testId: string;
  total: number;
  passes: number;
  fails: number;
  shas: number;
  flakyShaFlips: number;
}

export interface LlmCostRow {
  provider: string;
  model: string;
  purpose: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface LlmCosts {
  rows: LlmCostRow[];
  totalCostUsd: number;
}
