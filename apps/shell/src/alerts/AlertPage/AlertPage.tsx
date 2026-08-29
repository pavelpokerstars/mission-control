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

import { useState, type JSX } from 'react';
import type { Evidence } from '@mc/domain';
import { explain, dotClass, useFinding, type FindingDetail } from '../api';
import { AppWindow, BackLink, type Counts } from '../Chrome/Chrome';
import { recordHref, type Route } from '../router';
import { Actions } from '../Actions/Actions';
import { AskInline } from '../AskInline/AskInline';
import { KIND_LABEL } from '../AlertList/AlertList';

import './AlertPage.css';

/**
 * The checklist: every promise made in this container, and which ones reached
 * the tracker.
 *
 * A list of ticks and one cross reads instantly; a paragraph about a missing
 * commitment does not. The tick is `relatedKeys.length > 0` and nothing more —
 * no scoring, no inference — which is why it can be shown as fact.
 *
 * THE HEADING HAD TO SAY WHAT THE TICK MEANS. It read "What {container} said
 * would happen", which a reader takes as *the sprint's plan, ticked for what
 * shipped* — and it is neither. No row is ever a ticket, and ✓ means "somebody
 * filed one", not "it is done". `.blocklead` under it says so in the one place
 * a reader is looking, because a legend they have to infer is a legend they
 * infer wrongly.
 *
 * The tense follows the container. `dropped_commitment` fires while the sprint
 * is still OPEN — that is the whole difference between it and `missing_ticket`
 * — so a past-tense heading over it is wrong about the one fact that separates
 * the two alerts.
 */
function Checklist({
  detail,
  onFile,
}: {
  detail: FindingDetail;
  /**
   * File the ticket from the row that says there is none.
   *
   * *"If it says 'no ticket', I would be able to open a ticket right there"* —
   * and the point is the distance: the cross is the sentence that states the
   * problem, and the button that answers it was two bands and a scroll below.
   * The row does not grow a second result surface; it presses the same primary
   * action and `Actions` reports it where it always does.
   */
  onFile: () => void;
}): JSX.Element | null {
  const list = detail.checklist;
  if (!list?.length) return null;
  const where = detail.container?.label ?? 'the sprint';
  const closed = !!detail.container?.closedAt;
  const missing = list.filter((i) => !i.tracked).length;
  return (
    <div className="block">
      <h4>
        Every promise made in {where}
        {closed ? ', and which ones reached the tracker' : ' so far'}
      </h4>
      <p className="blocklead">
        {missing === 1
          ? 'One of these has no ticket. '
          : missing > 1
            ? `${missing} of these have no ticket. `
            : ''}
        A tick means somebody filed one — not that the work is done.
      </p>
      <ul className="check">
        {list.map((i) => (
          <li key={i.title} className={i.tracked ? 'done' : 'miss'}>
            <span className="mark" aria-hidden="true">
              {i.tracked ? '✓' : '✕'}
            </span>
            <span className="txt">{i.title}</span>
            {/*
              ONLY ON THE ROW THIS ALERT IS ABOUT. The list is every promise in
              the container and more than one of them can be untracked, while
              the primary action files a ticket for this finding's own note
              whatever was pressed — so an inline button on somebody else's row
              would create the wrong ticket and report success. `subject` is set
              from the note id by `findingDetail`, not matched on the title.

              `rowmain` is the button reset the row components share; `.check
              .ref` still supplies the mono, the size and the crit colour, and
              both are selectors the preview already draws.
            */}
            {!i.tracked && i.subject ? (
              <button type="button" className="ref rowmain" onClick={onFile}>
                {/*
                  UNDERLINED, because it looked exactly like the two plain
                  `no ticket` labels above it — same mono, same size, same crit
                  red — and nothing said the third one was a button. `<u>` and
                  not a class: the underline is the affordance and it needs no
                  rule, which keeps this off a stylesheet the preview would then
                  have to grow a matching one for.
                */}
                {i.ref} · <u>file it →</u>
              </button>
            ) : (
              <span className="ref">{i.ref}</span>
            )}
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

function EvidenceRow({ e, from, kind }: { e: Evidence; from: string; kind: string }): JSX.Element {
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
      <article data-surface={dotClass(e.surface)}>
        <i className={`dot ${dotClass(e.surface)}`} aria-hidden="true" />
        <div>
          {head}
          {body}
        </div>
      </article>
    );
  }
  return (
    <a className="evrow" data-surface={dotClass(e.surface)} href={recordHref(e, from, kind)}>
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
  // Not "the last thing that happened to it": the rows are now the carry out of
  // a closed sprint and either the last thing anybody said OR the fact that
  // nobody has. Silence is the finding here, so the heading has to cover the
  // case where the evidence is an absence.
  aging: 'Why we think it has stalled',
  unlinked_commitment: 'The promise, and the ticket it probably belongs to',
  dropped_commitment: 'Where it was promised, and the last thing anyone said',
};

/**
 * That this alert is one you already put away, said where the page already says
 * when it fired.
 *
 * Reachable only by ADDRESS — a parked alert is not on the list, so you got
 * here from the `Open the alert` link on your own note, or from a notification
 * sent before you answered. Without this line the page renders as though
 * nothing had happened and offers *Not now* on something already parked, which
 * is the page quietly disagreeing with the list it is missing from.
 *
 * A `.when` span beside `firedLine`, deliberately: it is a fact about the
 * alert's history in the same mono and the same muted ink, not a banner. The
 * reader chose this state and does not need to be alarmed about it.
 */
function answeredLine(detail: FindingDetail): string | undefined {
  const a = detail.answered;
  if (!a) return undefined;
  if (a.kind === 'dismissed') return 'Dismissed — you said this was not needed';
  if (!a.until) return 'Parked — nothing brings it back until you ask';
  const when = new Date(a.until).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
  return `Parked until ${when}`;
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
  /**
   * A counter and not a boolean, because the same request can be made twice.
   *
   * The checklist's inline `file it` is a second way to press the primary
   * action; `Actions` owns whether it is running and what it reported, and this
   * is the whole of what has to cross between them. Bumping it fires once —
   * `Actions` remembers the value it last acted on.
   */
  const [fileNow, setFileNow] = useState(0);

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
              {/*
                THE SEPARATOR IS IN THE TEXT, not a gap. Three mono spans of the
                same size and colour, nine pixels apart, read as one string —
                "Fired August 17 Batch the nav rewrite" is two facts and looks
                like one, and adding "Parked until August 27" between them made
                it three. A middot is what every other multi-part line in this
                app uses, and it needs no rule the preview does not have.
              */}
              {answeredLine(data) && <span className="when">· {answeredLine(data)}</span>}
              {/*
                WHAT THE TICKET ACTUALLY IS, which the page never said.
                "ORB-1641 has not moved" names a key and nothing else, and the
                reader's first question is which piece of work that is.
                `FindingDetail.item` has carried the title all along and nothing
                read it — the same omission on `cycle` and `disagreement`, whose
                headlines are also bare keys.
              */}
              {data.item?.title && <span className="when">· {data.item.title}</span>}
            </div>
            <h1 className="claim">{data.finding.claim}</h1>
            <p className="impact">{data.finding.impact}</p>
          </div>

          <Checklist detail={data} onFile={() => setFileNow((n) => n + 1)} />

          <div className="block">
            <h4>{EVIDENCE_HEADING[data.finding.kind] ?? 'The records this stands on'}</h4>
            <div className="ev">
              {data.finding.evidence.map((e, i) => (
                <EvidenceRow key={`${e.surface}-${i}`} e={e} from={data.finding.id} kind={data.finding.kind} />
              ))}
              {/* Our own observation, and the only line here that is not a
                  citation: the tracker's silence is exactly what makes this a
                  finding, and it has no record to open. */}
              {data.finding.kind === 'missing_ticket' && (
                /*
                 * `data-surface` because this row is hand-written and drifted
                 * without it. Every other row in this block gets one from
                 * `EvidenceRow`, and `.ev [data-surface]` is what draws the
                 * source's colour down the left edge — so the one row not built
                 * by that component was the one row with no segment, in a list
                 * whose whole job is to look like one list. The preview sets it
                 * on the quote-less `article` exactly as it does on a linked
                 * row; this is the app catching up.
                 */
                <article data-surface="jira">
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

          {/*
            THE NOTE'S BODY IS NOT A BAND, and it never was in the design: the
            preview's alert is head → checklist → evidence → actions → ask, and
            `How it was recorded when it was said` was a sixth band this file
            grew on its own.

            It cost 137px between the evidence and the answer, and every clause
            of it was already on screen — measured on `missing_ticket:promise-005`,
            where the body reads "Dev Dunne to confirm the migration window.
            Promised in Orbit Sprint Review 2026-07-30. Dev Dunne took it. No
            date was given, so it is checked against Orbit 32's close. Nothing in
            the tracker references it yet." The first sentence is the claim AND
            the evidence quote directly above; the meeting is that quote's label;
            the date clause is the impact line; the tail is both the impact's
            tail and the jira observation row.

            A HAND-WRITTEN NOTE CAN SAY MORE, and on `fixtures/` one does —
            "he moved to Payments Core on 31 July, so whoever picks this up is
            not who agreed it" is on no other part of the page. The design's
            answer to that is not a band either: the preview puts that exact
            fact in an ANSWER to a suggested question. The note is untouched in
            the vault, is what the agent reads, and the ask box is directly
            below.
          */}

          <Actions
            finding={data.finding}
            audience={data.audience}
            safeMode={data.safeMode}
            fileNow={fileNow}
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
