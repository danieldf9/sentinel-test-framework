import { useState, type JSX } from 'react';
import { useApplyPromotion, usePromotePreview } from '../api';
import type { PromotionPlan } from '../types';

const statusClass: Record<string, string> = {
  ready: 'b-green',
  conflict: 'b-red',
  'not-found': 'b-gray',
  'missing-file': 'b-gray',
};

export function Promote(): JSX.Element {
  const [includeUnverified, setIncludeUnverified] = useState(false);
  const preview = usePromotePreview(includeUnverified);
  const apply = useApplyPromotion();

  const plans = preview.data?.plans ?? [];
  const ready = plans.filter((p) => p.status === 'ready');
  const result = apply.data;

  return (
    <div>
      <h1 className="page-title">Promote heals</h1>
      <p className="page-sub">
        Write reviewed heals back into your spec files, commit them to a new branch, and open a pull
        request. Set <code>GITHUB_TOKEN</code> before launching Studio to open the PR automatically;
        otherwise the change is committed locally for you to push.
      </p>

      <label className="toggle">
        <input
          type="checkbox"
          checked={includeUnverified}
          onChange={(e) => setIncludeUnverified(e.target.checked)}
        />
        Include UNVERIFIED heals (review carefully)
      </label>

      {preview.isError && <div className="esc-error">{(preview.error as Error).message}</div>}

      <div className="card">
        <h2>Planned changes</h2>
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>File</th>
              <th>Locator change</th>
              <th>×</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p, i) => (
              <PlanRow key={`${p.file}-${i}`} plan={p} />
            ))}
            {plans.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {preview.isLoading ? 'Loading…' : 'Nothing to promote.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {ready.length > 0 && (
        <div className="card">
          <div className="row-between" style={{ padding: '13px 16px' }}>
            <strong>
              {ready.length} group(s) ready — {ready.reduce((n, p) => n + p.occurrences, 0)}{' '}
              occurrence(s)
            </strong>
            <button
              className="btn-primary"
              disabled={apply.isPending}
              onClick={() => apply.mutate({ includeUnverified, push: true })}
            >
              {apply.isPending ? 'Promoting…' : 'Commit & open PR'}
            </button>
          </div>
        </div>
      )}

      {apply.isError && <div className="esc-error">{(apply.error as Error).message}</div>}

      {result && (
        <div className="card">
          <h2>Result</h2>
          <div style={{ padding: '4px 16px 16px' }}>
            <p>
              Applied <strong>{result.applied}</strong> locator group(s)
              {result.branch && (
                <>
                  {' '}
                  on branch <code>{result.branch}</code>
                </>
              )}
              . {result.note}
            </p>
            {result.prUrl ? (
              <p>
                <a href={result.prUrl} target="_blank" rel="noreferrer">
                  → View pull request
                </a>
              </p>
            ) : (
              result.committed && (
                <p className="mono-sm">
                  Push <code>{result.branch}</code> and open a PR, or set a GitHub token and re-run.
                </p>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanRow({ plan }: { plan: PromotionPlan }): JSX.Element {
  return (
    <tr>
      <td>
        <span className={`badge ${statusClass[plan.status] ?? 'b-gray'}`}>{plan.status}</span>
      </td>
      <td className="mono-sm">{plan.file}</td>
      <td>
        <div className="loc">
          <code>{plan.oldCode}</code>
          <span className="arrow">→</span>
          <code>{plan.newCode}</code>
        </div>
        {plan.status !== 'ready' && <div className="mono-sm">{plan.note}</div>}
      </td>
      <td>{plan.occurrences || '—'}</td>
    </tr>
  );
}
