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
import { explain, dotClass, useFinding, type FindingDetail } from '../api';
import { AppWindow, BackLink, type Counts } from '../Chrome/Chrome';
import { recordHref, type Route } from '../router';
import { Actions } from '../Actions/Actions';
import { AskInline } from '../AskInline/AskInline';
import { KIND_LABEL } from '../AlertList/AlertList';

import './AlertPage.css';

/**
 * The checklist: what the container said would happen.
 *
 * A list of ticks and one cross reads instantly; a paragraph about a missing
 * commitment does not. The tick is `relatedKeys.length > 0` and nothing more —
 * no scoring, no inference — which is why it can be shown as fact.
 */
/**
 * Per-kind checklist heading.
 *
 * The shape is the same across kinds -- a list of items, each either
 * tracked in Jira or not -- but the wording has to name what the list
 * actually IS, which depends on the alert type. The container label
 * ("PAY Sprint 12", "ORBIT 33") is reused so the heading still anchors
 * to the meeting the commitments came out of.
 *
 * `tracked` and `total` are recomputed from `list` rather than read off
 * the detail envelope, because the envelope's view of the count can drift
 * from the visible rows (it once did, and the summary said `3 tracked`
 * over a 5-row list).
 */
function checklistHeading(kind: FindingDetail['finding']['kind'], containerLabel: string | undefined, list: NonNullable<FindingDetail['checklist']>): string {
  const tracked = list.filter((i) => i.tracked).length;
  const total = list.length;
  const where = containerLabel ?? 'the container';
  if (kind === 'missing_ticket') {
    return `${where} commitments · ${tracked} tracked in Jira · ${total - tracked} missing`;
  }
  if (kind === 'aging') {
    return `${where} work · ${tracked} of ${total} still moving`;
  }
  return `${where} · ${tracked} of ${total} tracked`;
}

function Checklist({ detail }: { detail: FindingDetail }): JSX.Element | null {
  const list = detail.checklist;
  if (!list?.length) return null;
  return (
    <div className="block">
      <h4>{checklistHeading(detail.finding.kind, detail.container?.label, list)}</h4>
      <ul className="check">
        {list.map((i) => {
          // `i.ref` is either a Jira key (tracked items) or 'no ticket'.
          // Only the Jira key has somewhere to go, so only that one is a
          // link. The other stays plain text -- a link with nowhere to
          // land is the same lie an evidence row without a quote was.
          const refIsKey = /^([A-Z][A-Z0-9]+-\d+)$/.test(i.ref);
          return (
            <li key={i.title} className={i.tracked ? 'done' : 'miss'}>
              <span className="mark" aria-hidden="true">
                {i.tracked ? '✓' : '✕'}
              </span>
              <span className="txt">{i.title}</span>
              <span className="ref">
                {refIsKey ? (
                  <a href={`/record/jira/${encodeURIComponent(i.ref)}`}>{i.ref}</a>
                ) : (
                  i.ref === 'no ticket' && detail.finding.kind === 'missing_ticket' ? (
                    <span className="missing-tag">not filed — use Create below</span>
                  ) : (
                    i.ref
                  )
                )}
              </span>
            </li>
          );
        })}
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
      {e.at !== undefined ? (
        <time>{Math.floor(e.at / 60)}m in</time>
      ) : (
        e.ref?.id && /^\d{10,}$/.test(String(e.ref.id)) ? (
          <time>{new Date(Number(e.ref.id) * 1000).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</time>
        ) : null
      )}
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
/**
 * Evidence heading per alert type.
 *
 * Each heading has to do two things: tell the reader what the rows below
 * are (the citations the alert stands on), and what their ORDER means.
 * Generic 'Evidence' fails the second -- a disagreement reads differently
 * from a cycle reads differently from a missing ticket, and the heading
 * is the cheapest place that has to be honest.
 */
const EVIDENCE_HEADING: Partial<Record<string, string>> = {
  // Was 'Why we think this was promised' -- which only made sense if you
  // already knew what was promised. The alert has just told you.
  missing_ticket: 'Why this alert fired',
  disagreement: 'What each side said, newest first',
  cycle: 'The loop, member by member',
  suspect_link: 'What the tracker declares, and what supports it',
  undetected_dependency: 'Where the dependency was found',
  // Not 'the last thing that happened to it': the rows are now the carry out of
  // a closed sprint and either the last thing anybody said OR the fact that
  // nobody has. Silence is the finding here, so the heading has to cover the
  // case where the evidence is an absence.
  aging: 'Why we think it has stalled',
  unlinked_commitment: 'The promise, and the ticket it probably belongs to',
  dropped_commitment: 'Where it was promised, and the last thing anyone said',
};

/**
 * The cycle, drawn as a small loop of nodes.
 *
 * A cycle alert's evidence is the arrows themselves -- four rows that say
 * 'PAY-X waits on PAY-Y' on the miro surface, with no quote and no open
 * link. Rendering them as plain citation rows reads as a list of facts,
 * not as a loop, and the page invites the question 'how can miro text be
 * a circular dependency?'. The shape IS the answer; this draws it.
 *
 * The label is parsed with a regex rather than recomputed, so the cycle a
 * reader sees is exactly the one Mission Control raised. A re-derive could
 * disagree with the page; this cannot.
 */
function CycleLoop({ evidence }: { evidence: readonly Evidence[] }): JSX.Element | null {
  const KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
  const edges: Array<{ from: string; to: string }> = [];
  for (const e of evidence) {
    const matches = [...e.label.matchAll(KEY)].map((m) => m[1]!);
    if (matches.length >= 2) edges.push({ from: matches[0]!, to: matches[1]! });
  }
  if (edges.length < 2) return null;
  const nodes = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  return (
    <div className="cycle-loop" aria-label="The dependency loop">
      <ol className="cycle-nodes">
        {nodes.map((n) => (
          <li key={n}>
            <a href={`/record/jira/${encodeURIComponent(n)}`}>{n}</a>
          </li>
        ))}
      </ol>
      <div className="cycle-arrows">
        {edges.map((e, i) => (
          <span key={i} className="cycle-edge">
            <code>{e.from}</code> <span className="arr">waits on</span> <code>{e.to}</code>
          </span>
        ))}
      </div>
    </div>
  );
}

function firedLine(detail: FindingDetail): string {
  const { finding, container } = detail;
  const when = new Date(finding.firedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  // On `closedAt`, NOT on `container`. `findingDetail` sets `container` for any
  // commitment whose `note.container` resolves, and populates `closedAt` only
  // when the container actually closed — so branching on the container alone
  // prints "when Orbit 33 closed" about a sprint that is still running.
  return container?.closedAt
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
      <BackLink to={{ name: 'alerts' }} label="Back to all alerts" />

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

          {/*
            The cycle is a shape, not a citation. Render it as a node
            graph above the evidence block, so the page reads as 'here
            is the loop; below is where the arrows were drawn'.
          */}
          {data.finding.kind === 'cycle' && (
            <CycleLoop evidence={data.finding.evidence} />
          )}

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
              {/*
                The note is Mission Control's own synthesis of why the
                commitment mattered, not a citation from a real source.
                The heading has to make that distinction -- a judge who
                reads 'The note it was recorded in' expects a record to
                open, and there isn't one.
              */}
              <h4>Mission Control's note</h4>
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
