import type { JSX } from 'react';
import { useActiveRun, useRuns, useStartRun, useSummary } from '../api';
import { formatTs, healSummary, StatusBadge } from '../ui';

export function RunsList({ onOpenRun }: { onOpenRun: (id: string) => void }): JSX.Element {
  const summary = useSummary();
  const runs = useRuns();
  const active = useActiveRun();
  const startRun = useStartRun();
  const running = active.data?.running ?? false;

  return (
    <div>
      <div className="row-between">
        <h1 className="page-title">Runs</h1>
        <button
          className="btn-primary"
          disabled={running || startRun.isPending}
          onClick={() =>
            startRun.mutate(
              {},
              { onSuccess: (r) => onOpenRun(r.runId) },
            )
          }
        >
          {running ? 'Run in progress…' : '▶ Run suite'}
        </button>
      </div>
      <p className="page-sub">Test runs recorded by Sentinel, most recent first.</p>
      {startRun.isError && (
        <div className="esc-error">Could not start run: {(startRun.error as Error).message}</div>
      )}

      {summary.data && summary.data.status !== 'no-runs' && (
        <div className="tiles">
          <Tile k="Latest status" v={<StatusBadge status={summary.data.status} />} />
          <Tile k="Tests passed" v={`${summary.data.passed}/${summary.data.tests}`} />
          <Tile
            k="Heals"
            v={
              <>
                {summary.data.heals}{' '}
                <small>
                  {summary.data.autoHeals} auto · {summary.data.unverifiedHeals} unverified
                </small>
              </>
            }
          />
          <Tile k="Pending escalations" v={summary.data.pendingEscalations} />
          <Tile
            k="LLM spend"
            v={
              <>
                ${summary.data.llmCostUsd.toFixed(4)} <small>{summary.data.llmCalls} calls</small>
              </>
            }
          />
        </div>
      )}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Started</th>
              <th>Tests</th>
              <th>Heals</th>
              <th>Escalations</th>
              <th>LLM</th>
            </tr>
          </thead>
          <tbody>
            {runs.data?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => onOpenRun(r.id)}>
                <td>
                  <code>{r.id}</code>
                  {r.healingUnavailable && <span className="badge b-red">LLM circuit open</span>}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{formatTs(r.startedAt)}</td>
                <td>
                  {r.passed}/{r.tests}
                </td>
                <td>{healSummary(r.heals)}</td>
                <td>{r.escalations}</td>
                <td>
                  {r.llmCalls > 0 ? `${r.llmCalls} calls / $${r.llmCostUsd.toFixed(4)}` : '—'}
                </td>
              </tr>
            ))}
            {runs.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No runs recorded yet. Run <code>sentinel run</code> to get started.
                </td>
              </tr>
            )}
            {runs.isLoading && (
              <tr>
                <td colSpan={7} className="empty">
                  Loading…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: React.ReactNode }): JSX.Element {
  return (
    <div className="tile">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
