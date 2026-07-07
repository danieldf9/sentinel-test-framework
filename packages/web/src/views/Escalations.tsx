import { useState, type JSX } from 'react';
import { useAnswerEscalation, useEscalations } from '../api';
import type { PendingEscalation } from '../types';

export function Escalations(): JSX.Element {
  const { data, isLoading } = useEscalations();

  return (
    <div>
      <h1 className="page-title">Escalations</h1>
      <p className="page-sub">
        Failures Sentinel could not confidently heal. Pick the candidate that matches the original
        intent — it becomes the cached locator and the next run heals at Tier 0 — or mark the change
        as an intentional redesign.
      </p>

      {isLoading && <div className="state">Loading…</div>}
      {data?.length === 0 && (
        <div className="card">
          <div className="empty">🎉 No pending escalations. Everything healed cleanly.</div>
        </div>
      )}
      {data?.map((e) => (
        <EscalationCard key={e.id} esc={e} />
      ))}
    </div>
  );
}

function EscalationCard({ esc }: { esc: PendingEscalation }): JSX.Element {
  const answer = useAnswerEscalation();
  const [choice, setChoice] = useState<string | null>(null);
  const q = esc.question;

  const submit = (c: string) => {
    setChoice(c);
    answer.mutate({ id: esc.id, choice: c });
  };

  return (
    <div className="card esc">
      <div className="esc-head">
        <div>
          <strong>#{esc.id}</strong> · <span className="mono-sm">{esc.testId}</span>
          {q.context?.classification && (
            <span className="badge b-gray">{q.context.classification}</span>
          )}
        </div>
      </div>
      <div className="esc-body">
        <div className="esc-intent">{q.intent}</div>
        <div className="esc-q">{q.question}</div>
        {q.context?.oldLocator && (
          <div className="loc">
            broke: <code>{q.context.oldLocator}</code>
          </div>
        )}

        <div className="cand-list">
          {q.candidates.map((c) => (
            <button
              key={c.label}
              className="cand"
              disabled={answer.isPending}
              onClick={() => submit(c.label)}
            >
              <span className="badge b-blue">{c.label}</span>
              <span className="cand-desc">
                &lt;{c.fingerprint.tag}&gt; “{c.fingerprint.name || c.fingerprint.text}”
              </span>
              <span className="cand-conf">conf {c.confidence.toFixed(2)}</span>
            </button>
          ))}
          <button
            className="cand cand-redesign"
            disabled={answer.isPending}
            onClick={() => submit('REDESIGN')}
          >
            Intentional redesign — the test needs updating
          </button>
        </div>

        {q.context?.screenshot && (
          <div className="shots">
            <figure>
              <img src={q.context.screenshot} alt="failure screenshot" />
              <figcaption>at failure</figcaption>
            </figure>
          </div>
        )}

        {answer.isError && (
          <div className="esc-error">Could not apply: {(answer.error as Error).message}</div>
        )}
        {answer.isPending && <div className="mono-sm">Applying {choice}…</div>}
      </div>
    </div>
  );
}
