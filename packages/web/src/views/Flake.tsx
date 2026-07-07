import type { JSX } from 'react';
import { useFlake } from '../api';

export function Flake(): JSX.Element {
  const { data, isLoading } = useFlake();
  return (
    <div>
      <h1 className="page-title">Flake dashboard</h1>
      <p className="page-sub">
        Per-test pass/fail history. A verdict of <span className="badge b-amber">@flaky</span> means
        the same commit both passed and failed.
      </p>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Runs</th>
              <th>Passes</th>
              <th>Fails</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((f) => (
              <tr key={f.testId}>
                <td className="mono-sm">{f.testId}</td>
                <td>{f.total}</td>
                <td>{f.passes}</td>
                <td>{f.fails}</td>
                <td>
                  {f.flakyShaFlips > 0 ? (
                    <span className="badge b-amber">
                      @flaky ({f.flakyShaFlips} SHA{f.flakyShaFlips > 1 ? 's' : ''} flip)
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No flake history yet.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={5} className="empty">
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
