import type { JSX } from 'react';
import { useLlmCosts } from '../api';

export function LlmCosts(): JSX.Element {
  const { data, isLoading } = useLlmCosts();
  return (
    <div>
      <div className="row-between">
        <h1 className="page-title">LLM usage &amp; cost</h1>
        {data && <span className="badge b-gray">total ${data.totalCostUsd.toFixed(4)}</span>}
      </div>
      <p className="page-sub">
        Spend grouped by provider, model, and purpose across all recorded runs.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Provider / model</th>
              <th>Purpose</th>
              <th>Calls</th>
              <th>Tokens in/out</th>
              <th>Cost</th>
              <th>Avg latency</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((l, i) => (
              <tr key={`${l.provider}/${l.model}/${l.purpose}/${i}`}>
                <td className="mono-sm">
                  {l.provider}/{l.model}
                </td>
                <td>{l.purpose}</td>
                <td>
                  {l.calls}
                  {l.failures > 0 && <span className="badge b-red">{l.failures} failed</span>}
                </td>
                <td>
                  {l.inputTokens} / {l.outputTokens}
                </td>
                <td>${l.costUsd.toFixed(4)}</td>
                <td>{Math.round(l.avgLatencyMs)}ms</td>
              </tr>
            ))}
            {data?.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No LLM calls recorded.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={6} className="empty">
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
