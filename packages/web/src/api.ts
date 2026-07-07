import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActiveRun,
  AnswerResult,
  FlakeStat,
  LlmCosts,
  PendingEscalation,
  RunDetailResponse,
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
    queryFn: () => getJson<RunDetailResponse>(`/api/runs/${id}`),
    // Poll fast while the run is still in flight, then relax.
    refetchInterval: (query) => (query.state.data?.running ? 1500 : POLL_MS),
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

export function useActiveRun() {
  return useQuery({
    queryKey: ['active-run'],
    queryFn: () => getJson<ActiveRun>('/api/runs/active'),
    refetchInterval: 1500,
  });
}

/** Trigger a suite run. Refreshes the active-run + runs views on success. */
export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (opts: { grep?: string; project?: string; heal?: string }) => {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const body = await res.json();
      if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
      return body as { runId: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-run'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    },
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
