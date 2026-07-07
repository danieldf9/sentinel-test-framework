import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AnswerResult,
  FlakeStat,
  LlmCosts,
  PendingEscalation,
  RunDetail,
  RunOverview,
  SummaryData,
} from './types';

async function getJson<T>(pathname: string): Promise<T> {
  const res = await fetch(pathname, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Polling cadence for the live-ish dashboard (a run writes to the DB we read). */
const POLL_MS = 4000;

export function useSummary() {
  return useQuery({
    queryKey: ['summary'],
    queryFn: () => getJson<SummaryData>('/api/summary'),
    refetchInterval: POLL_MS,
  });
}

export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => getJson<RunOverview[]>('/api/runs'),
    refetchInterval: POLL_MS,
  });
}

export function useRun(id: string | null) {
  return useQuery({
    queryKey: ['run', id],
    enabled: id != null,
    queryFn: () => getJson<{ overview: RunOverview; detail: RunDetail }>(`/api/runs/${id}`),
    refetchInterval: POLL_MS,
  });
}

export function useFlake() {
  return useQuery({
    queryKey: ['flake'],
    queryFn: () => getJson<FlakeStat[]>('/api/flake'),
    refetchInterval: POLL_MS,
  });
}

export function useLlmCosts() {
  return useQuery({
    queryKey: ['llm-costs'],
    queryFn: () => getJson<LlmCosts>('/api/llm-costs'),
    refetchInterval: POLL_MS,
  });
}

export function useEscalations() {
  return useQuery({
    queryKey: ['escalations'],
    queryFn: () => getJson<PendingEscalation[]>('/api/escalations'),
    refetchInterval: POLL_MS,
  });
}

/** Answer an escalation (candidate label or REDESIGN); refreshes affected views. */
export function useAnswerEscalation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, choice }: { id: number; choice: string }) => {
      const res = await fetch(`/api/escalations/${id}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choice }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
      return body as AnswerResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['escalations'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}
