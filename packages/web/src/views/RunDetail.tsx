import type { JSX } from 'react';
import { useActiveRun, useRun } from '../api';
import type { HealRow } from '../types';
import { formatDuration, ModeBadge, StatusBadge, StepBadge } from '../ui';

export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }): JSX.Element {
  const { data, isLoading, isError } = useRun(runId);
  const active = useActiveRun();

  if (isLoading) return <div className="state">Loading run…</div>;
  if (isError || !data) return <div className="state">Run not found.</div>;

  const { overview, detail, running } = data;
  const liveOutput = running && active.data?.runId === runId ? (active.data.output ?? []) : [];

  return (
    <div>
      <button className="back" onClick={onBack}>
        ← All runs
      </button>
      <div className="row-between">
        <h1 className="page-title">
          <code>{overview.id}</code>
        </h1>
        {running ? (
          <span className="badge b-blue running-dot">running…</span>
        ) : (
          <StatusBadge status={overview.status} />
        )}
      </div>
      <p className="page-sub">
        {overview.passed}/{overview.tests} passed · {detail.heals.length} heal(s) ·{' '}
        {detail.escalations.length} escalation(s)
        {overview.gitSha ? ` · ${overview.gitSha.slice(0, 8)}` : ''}
      </p>

      {liveOutput.length > 0 && (
        <div className="card">
          <h2>Live output</h2>
          <pre className="log">{liveOutput.join('\n')}</pre>
        </div>
      )}

      {detail.steps.length > 0 && (
        <div className="card">
          <h2>Steps</h2>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Intent</th>
                <th>Status</th>
                <th>Tier / conf</th>
              </tr>
            </thead>
            <tbody>
              {detail.steps.map((s) => (
                <tr key={s.id}>
                  <td>
                    <code>{s.action}</code>
                  </td>
                  <td>{s.intent}</td>
                  <td>
                    <StepBadge status={s.status} />
                  </td>
                  <td>
                    {s.tier != null
                      ? `tier ${s.tier}${s.confidence != null ? ` · ${s.confidence.toFixed(2)}` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Tests</h2>
        <table>
          <thead>
            <tr>
              <th>Test</th>
              <th>Status</th>
              <th>Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {detail.tests.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>
                  <StatusBadge status={t.status} />
                </td>
                <td>{formatDuration(t.durationMs)}</td>
                <td>{t.flakyTagged && <span className="badge b-amber">@flaky</span>}</td>
              </tr>
            ))}
            {detail.tests.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No tests recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail.heals.length > 0 && (
        <div className="card">
          <h2>Heals</h2>
          {detail.heals.map((h) => (
            <HealCard key={h.id} heal={h} />
          ))}
        </div>
      )}

      {detail.escalations.length > 0 && (
        <div className="card">
          <h2>Escalations</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Intent</th>
                <th>Question</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {detail.escalations.map((e) => (
                <tr key={e.id}>
                  <td>#{e.id}</td>
                  <td>{e.question?.intent ?? ''}</td>
                  <td>{e.question?.question ?? '(unparseable)'}</td>
                  <td>
                    {e.status === 'pending' ? (
                      <span className="badge b-amber">pending</span>
                    ) : (
                      <>
                        <span className="badge b-blue">answered</span> {e.answer}{' '}
                        <em>by {e.answeredBy}</em>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HealCard({ heal }: { heal: HealRow }): JSX.Element {
  return (
    <div className="heal">
      <ModeBadge mode={heal.mode} />
      <span className="badge b-gray">tier {heal.tier}</span>
      <span className="badge b-gray">conf {heal.confidence.toFixed(2)}</span>
      {heal.promoted && <span className="badge b-blue">promoted</span>}
      <strong> {heal.intent}</strong>
      <div className="loc">
        <code>{heal.oldLocator}</code>
        <span className="arrow">→</span>
        <code>{heal.newLocator}</code>
      </div>
      <div className="reason">{heal.reasoning}</div>
      {(heal.screenshotBefore || heal.screenshotAfter) && (
        <div className="shots">
          {heal.screenshotBefore && (
            <figure>
              <img src={heal.screenshotBefore} alt="before healing" />
              <figcaption>before (at failure)</figcaption>
            </figure>
          )}
          {heal.screenshotAfter && (
            <figure>
              <img src={heal.screenshotAfter} alt="after healing" />
              <figcaption>after (healed)</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  );
}
