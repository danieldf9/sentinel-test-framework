import type { JSX } from 'react';

/** Status → badge color, mirroring @sentinel/report's statusBadge(). */
export function StatusBadge({ status }: { status: string | null }): JSX.Element {
  const s = status ?? 'in-progress';
  const cls = /^passed$/.test(s)
    ? 'b-green'
    : /passed_unverified/.test(s)
      ? 'b-amber'
      : /failed/.test(s)
        ? 'b-red'
        : 'b-gray';
  return <span className={`badge ${cls}`}>{s}</span>;
}

/** Heal mode → badge color, mirroring @sentinel/report's modeBadge(). */
export function ModeBadge({ mode }: { mode: string }): JSX.Element {
  const cls =
    mode === 'AUTO'
      ? 'b-green'
      : mode === 'UNVERIFIED'
        ? 'b-amber'
        : mode === 'HUMAN'
          ? 'b-blue'
          : 'b-gray';
  return <span className={`badge ${cls}`}>{mode}</span>;
}

/** Per-step status → badge color for the live run timeline. */
export function StepBadge({ status }: { status: string }): JSX.Element {
  const cls =
    status === 'passed' || status === 'healed_auto'
      ? 'b-green'
      : status === 'healed_unverified'
        ? 'b-amber'
        : status === 'failed' || status === 'escalated'
          ? 'b-red'
          : 'b-gray';
  return <span className={`badge ${cls}`}>{status}</span>;
}

export function formatTs(ms: number | null): string {
  return typeof ms === 'number' && ms > 0
    ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
    : '—';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function healSummary(heals: { mode: string; count: number }[]): string {
  return heals.map((h) => `${h.count}× ${h.mode}`).join(', ') || '—';
}
