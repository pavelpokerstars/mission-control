/**
 * One alert: the claim, the checklist, the evidence, four actions.
 *
 * `DIRECTION.md` §3 — one page per alert type, nothing inherited between them.
 * That is a rule about CONTENT rather than about components: every type gets the
 * blocks that make its own argument and no others, which is why the checklist
 * appears on a missing ticket and nowhere else. What they share is the shape —
 * a claim, its evidence, and something you can do — because a reader who has
 * seen one alert should not have to learn the next.
 *
 * A reader may arrive here cold, from a notification, having never seen the
 * list. So the page states its own case: what fired, when, why we think so, and
 * what to do — with no context borrowed from the screen before it.
 */

import type { JSX } from 'react';
import type { Evidence } from '@mc/domain';
import { explain, dotClass, useFinding, type FindingDetail } from './api';
import { AppWindow, BackLink, type Counts } from './Chrome';
import { recordHref, type Route } from './router';
import { Actions } from './Actions';
import { AskInline } from './AskInline';
import { KIND_LABEL } from './AlertList';

/**
 * The checklist: what the container said would happen.
 *
 * A list of ticks and one cross reads instantly; a paragraph about a missing
 * commitment does not. The tick is `relatedKeys.length > 0` and nothing more —
 * no scoring, no inference — which is why it can be shown as fact.
 */
function Checklist({ detail }: { detail: FindingDetail }): JSX.Element | null {
  const list = detail.checklist;
  if (!list?.length) return null;
  return (
    <div className="block">
      <h4>What {detail.container?.label ?? 'the sprint'} said would happen</h4>
      <ul className="check">
        {list.map((i) => (
          <li key={i.title} className={i.tracked ? 'done' : 'miss'}>
            <span className="mark" aria-hidden="true">
              {i.tracked ? '✓' : '✕'}
            </span>
            <span className="txt">{i.title}</span>
            <span className="ref">{i.ref}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The records the claim stands on.
 *
 * A row with a quote is a citation and will open the record it came from. A row
 * without one is our own observation — "no issue references this" — and is
 * deliberately NOT a link, because there is nothing to open and a dead link on
 * an evidence row is worse than a plain sentence. That distinction is in the
 * preview and it is the difference between citing and asserting.
 */
/**
 * `RecordRef` → the route that opens it on the right line.
 *
 * The channel and the offset are query parameters rather than path segments
 * because they are *modifiers* on a record rather than part of its identity:
 * the same transcript opened at two different moments is one record, and two
 * citations of it should not look like two documents.
 */

function EvidenceRow({ e, from }: { e: Evidence; from: string }): JSX.Element {
  /**
   * `label` moves between the two halves depending on whether there is a quote,
   * and that is not a style choice.
   *
   * With a quote, `label` is a POINTER — "#eng-payments — dana", "sprint-12
   * planning" — and belongs in the small metadata line above the words somebody
   * actually said. Without one, `label` IS the observation ("PAY-9042 waits on
   * PAY-9041") and belongs in the readable body.
   *
   * Rendering it in both, which is what this did first, printed every quote-less
   * citation twice: once as grey mono metadata and again underneath in body
   * text. It reads as a template bug, and on the cycle page — where no row has a
   * quote — it happened four times in a row.
   */
  const body = e.quote ? <q>{e.quote}</q> : <p className="plain">{e.label}</p>;
  const head = (
    <div className="hd">
      <span className="src">{e.surface}</span>
      {e.quote && <span className="src">{e.label}</span>}
      {e.at !== undefined && <time>{Math.floor(e.at / 60)}m in</time>}
      {e.ref && <span className="open">open →</span>}
    </div>
  );

  /**
   * A row with somewhere to go is a link; one without is a sentence.
   *
   * The test is `ref`, not `quote`. "No issue references this" is our own
   * observation and has no record behind it, and the arrows in a cycle are a
   * shape rather than a document — a dead link on either is worse than plain
   * text, because it promises evidence and delivers a 404. That distinction is
   * the difference between citing and asserting, and it is in the preview.
   */
  if (!e.ref) {
    return (
      <article>
        <i className={`dot ${dotClass(e.surface)}`} aria-hidden="true" />
        <div>
          {head}
          {body}
        </div>
      </article>
    );
  }
  return (
    <a className="evrow" href={recordHref(e, from)}>
      <i className={`dot ${dotClass(e.surface)}`} aria-hidden="true" />
      <div>
        {head}
        {body}
      </div>
    </a>
  );
}

/**
 * What the evidence block is called, per alert type.
 *
 * It was one hardcoded string — "Why we think this was promised" — which is
 * right for a missing ticket and wrong for every other kind: a disagreement's
 * records are not a promise, and a cycle's arrows are not a claim about one.
 * `DIRECTION.md` §3 asks for a purpose-built page per alert type, and the
 * heading over the evidence is the cheapest place that stops being true.
 */
const EVIDENCE_HEADING: Partial<Record<string, string>> = {
  missing_ticket: 'Why we think this was promised',
  disagreement: 'Both records, newest first',
  cycle: 'The four links, and who is waiting on whom',
  suspect_link: 'What the tracker declares, and what supports it',
  undetected_dependency: 'Where the dependency was found',
  aging: 'The last thing that happened to it',
};

function firedLine(detail: FindingDetail): string {
  const { finding, container } = detail;
  const when = new Date(finding.firedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  return container
    ? `Fired ${when}, when ${container.label} closed`
    : `Fired ${when}`;
}

export function AlertPage({
  id,
  route,
  counts,
  onActed,
}: {
  id: string;
  route: Route;
  counts: Counts;
  /**
   * Answering an alert changes what the toolbar counts.
   *
   * The counts re-read on NAVIGATION (`DESIGN.md` §8, and see `AlertApp`), which
   * covers every way a count changes except this one: acting resolves an alert
   * without going anywhere, so the badge went on saying four while the list it
   * counts held three, on the very screen that had just changed it.
   */
  onActed?: () => void;
}): JSX.Element {
  const { data, error, loading, reload } = useFinding(id);

  return (
    <AppWindow route={route} counts={counts}>
      <BackLink to={{ name: 'alerts' }} label="back to the list" />

      {loading && <div className="greet"><h1>Looking…</h1></div>}

      {/* `!data` — a failed refetch must not replace an alert that is on screen. */}
      {error && !data && (
        <div className="greet">
          <h1>That alert is not there</h1>
          <p>
            It may have been resolved since the link was sent — which is the good outcome.{' '}
            {explain(error)}
          </p>
        </div>
      )}

      {data && (
        <div className="page">
          <div className="head">
            <div className="meta">
              <span className={`chip ${data.finding.severity}`}>{KIND_LABEL[data.finding.kind]}</span>
              <span className="when">{firedLine(data)}</span>
            </div>
            <h1 className="claim">{data.finding.claim}</h1>
            <p className="impact">{data.finding.impact}</p>
          </div>

          <Checklist detail={data} />

          <div className="block">
            <h4>{EVIDENCE_HEADING[data.finding.kind] ?? 'The records this stands on'}</h4>
            <div className="ev">
              {data.finding.evidence.map((e, i) => (
                <EvidenceRow key={`${e.surface}-${i}`} e={e} from={data.finding.id} />
              ))}
              {/* Our own observation, and the only line here that is not a
                  citation: the tracker's silence is exactly what makes this a
                  finding, and it has no record to open. */}
              {data.finding.kind === 'missing_ticket' && (
                <article>
                  <i className="dot jira" aria-hidden="true" />
                  <div>
                    <div className="hd">
                      <span className="src">jira</span>
                      <span className="src">searched every issue in the programme</span>
                      <time>now</time>
                    </div>
                    <p className="plain">No issue references this, and none is assigned to its owner.</p>
                  </div>
                </article>
              )}
            </div>
          </div>

          {data.note?.body && (
            <div className="block">
              <h4>The note it was recorded in</h4>
              <p className="blocklead">{data.note.body}</p>
            </div>
          )}

          <Actions
            finding={data.finding}
            onDone={() => {
              reload();
              onActed?.();
            }}
          />

          {/*
            BELOW the actions, and that is the order `DIRECTION.md` §8 asks for:
            "The composer sits at the foot of the alert, below the actions… the
            citation you were reading, the checklist and your question stay on
            screen together, and *Create the ticket* is still directly above
            you."
          */}
          <AskInline finding={data.finding} />
        </div>
      )}
    </AppWindow>
  );
}
