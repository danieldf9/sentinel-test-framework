import { useQuery } from '@tanstack/react-query';
import type {
  FlakeStat,
  LlmCosts,
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
