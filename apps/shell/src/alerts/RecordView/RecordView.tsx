/**
 * Where a citation lands.
 *
 * Not a vendor pane — one record, opened on the exact line, with context either
 * side. `DIRECTION.md` §3: "a citation that drops you at the top of a
 * ninety-minute transcript has not really been followed." That is the whole
 * design brief, and it is why the ref carries an offset or a message id rather
 * than just a document.
 *
 * There is no browse mode and no search here, deliberately. You arrive from a
 * piece of evidence and the way out is back to the thing that cited it. A menu
 * entry would make this a sixth destination, which is what the vendor panes were
 * deleted for being.
 */

import { Fragment, useEffect, useRef, type JSX } from 'react';
import { explain, dotClass, useJson } from '../api';
import { AppWindow, BackLink, type Counts } from '../Chrome/Chrome';
import type { Route } from '../router';

import './RecordView.css';

interface RecordResult {
  surface: string;
  id: string;
  title: string;
  lines: { id: string; at?: number; who?: string; text: string; when?: string }[];
  cited?: string;
  container?: string;
  /** The vendor's own URL, when a collector wrote one. Never constructed. */
  url?: string;
  /** When the cited thing was said, ISO. */
  when?: string;
}

/**
 * The mark in the left column of every line.
 *
 * TWO KINDS OF TIME, and only one of them was ever rendered. A transcript line
 * has `at` — seconds into the recording — and a Slack line has `when`, a wall
 * clock. The view drew `offset(l.at)` alone, so every Slack line rendered an
 * EMPTY `<time>`: a column of nothing, on the page whose whole job is what was
 * said and when. The preview draws a time on every line; this is building it.
 */
function stamp(l: { at?: number; when?: string }): string {
  if (l.at !== undefined) {
    return `${Math.floor(l.at / 60)}:${String(Math.floor(l.at % 60)).padStart(2, '0')}`;
  }
  if (!l.when) return '';
  const d = new Date(l.when);
  if (Number.isNaN(d.getTime())) return '';
  /**
   * A CLOCK, and only a clock. The day belongs to the divider above — see
   * `dayMark`, which records why it was briefly folded in here and why it is
   * not any more.
   */
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * The day, when it is not the day above — drawn as its own row rather than
 * squeezed into the stamp.
 *
 * A Slack record is a whole channel and not a thread: sixteen messages across
 * fifteen days on this fixture. Without the day they read as one afternoon whose
 * clock jumps backwards, and the two messages the disagreement alert is about,
 * three days apart, both said 07:00.
 *
 * ON EVERY DAY CHANGE, INCLUDING A DAY THAT GROUPS ONE LINE. It was briefly
 * drawn only where a day held several, on the grounds that this fixture's
 * channel is one message per day for seventeen days and the page was more band
 * than message — the date folding into the stamp beside the clock instead.
 * That trades one problem for a worse one, and Slack settles it: a channel is
 * broken by day and each message carries only a time. A date repeated on every
 * line is the thing this divider exists to avoid.
 *
 * What the crowding complaint actually wanted is a divider that costs a
 * HAIRLINE rather than a band, which is what it is now — the date in the stamp
 * column, aligned with the clocks it labels, and a rule across the rest.
 */
function dayMark(l: { when?: string }, prev?: { when?: string }): string | undefined {
  if (!l.when) return undefined;
  const d = new Date(l.when);
  if (Number.isNaN(d.getTime())) return undefined;
  if (prev?.when && new Date(prev.when).toDateString() === d.toDateString()) return undefined;
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long' });
}

/**
 * When the record is from. The head says it; the lines say their own clock.
 *
 * WITH THE HOUR WHEN NOTHING ELSE CARRIES ONE. A Zoom Docs note has no timing at
 * all — `annotateTranscript` derives its segments from the body and `start` is a
 * paragraph INDEX, so rendering it as a clock would put "0:03" beside a sentence
 * nobody timed, on the page whose whole argument is that its citations are
 * checkable. A timed transcript renders `2:00` per line and needs nothing here;
 * an untimed note has exactly one real moment, the meeting's own, and it belongs
 * in the head because that is the granularity the source actually has.
 */
function day(when?: string, withTime = false): string {
  if (!when) return '';
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  return withTime
    ? `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : date;
}

/**
 * The vendor's own name for itself — for the one affordance in this app that
 * leaves it.
 *
 * `data.surface` is our internal lower-case word; a link that says where it goes
 * has to say it the way the reader will recognise it on arrival. Same lesson as
 * an "Ask someone" button that does not say it posts to Slack.
 *
 * `vault` is absent, and the absence IS the gate: a vault note is ours and has
 * no vendor behind it. "The original in vault" would teach the reader that the
 * arrow means nothing in particular.
 *
 * IT PROMISES THE DOCUMENT, NOT THE LINE. Only a Slack permalink lands on the
 * thing cited — a Zoom Docs note carries no timing at all and a Confluence url
 * has no paragraph anchor — so a word like "open" would claim a landing three of
 * five surfaces cannot make. `.why` beside it is where the line is promised, and
 * that promise is ours to keep because we render the record ourselves.
 */
const VENDOR: Record<string, string> = {
  jira: 'Jira',
  slack: 'Slack',
  zoom: 'Zoom',
  confluence: 'Confluence',
  miro: 'Miro',
};

/**
 * What the alert this came from actually CLAIMED.
 *
 * A finding id is machine-shaped, so the kind alone ("cited by the disagreement
 * alert") names a category and not a reason. The claim is the reason, and the
 * page is otherwise a wall of other people's messages with one highlighted and
 * no statement of why it matters.
 */
const KIND_WORDS: Record<string, string> = {
  missing_ticket: 'the promise nobody filed',
  unlinked_commitment: 'the promise that probably has a ticket',
  dropped_commitment: 'the promise that went quiet',
  disagreement: 'the disagreement',
  cycle: 'the dependency loop',
  aging: 'the ticket that has not moved',
  undetected_dependency: 'the unrecorded dependency',
  suspect_link: 'the link nothing supports',
};

export function RecordView({
  refKey,
  parentId,
  at,
  from,
  kind,
  route,
  counts,
}: {
  /** `surface/id` — the record's identity. */
  refKey: string;
  parentId?: string;
  /** Seconds into a recording. What decides which line you land on. */
  at?: number;
  /** The alert that cited this, so "back" goes where you came from. */
  from?: string;
  /** The cited alert's KIND. Not derivable from `from` — see the route. */
  kind?: string;
  route: Route;
  counts: Counts;
}): JSX.Element {
  const query = new URLSearchParams();
  if (parentId) query.set('parentId', parentId);
  if (at !== undefined) query.set('at', String(at));
  const qs = query.toString();
  const { data, error, loading } = useJson<RecordResult>(
    `/api/records/${refKey}${qs ? `?${qs}` : ''}`,
  );
  const hit = useRef<HTMLDivElement>(null);

  /**
   * What the marked line says about itself.
   *
   * A finding id is machine-shaped (`missing_ticket:platform-owns-settled-topic`),
   * so it is turned back into the words a reader would use rather than shown
   * raw — the caption exists to explain why this line is highlighted, and an
   * identifier explains nothing.
   */
  const citedBy = from
    ? `the line ${KIND_WORDS[kind ?? ''] ?? `the ${(kind ?? from).split(':')[0]!.replace(/_/g, ' ')} alert`} is about`
    : 'the line this citation points at';

  /**
   * Scroll the cited line into view once it exists.
   *
   * Marking it is not enough on a long record: a citation that lands on the page
   * holding the line, somewhere below the fold, has the same problem as one that
   * lands at the top. `center` rather than `start` so the context either side is
   * visible, which is the reason for opening the record at all.
   */
  useEffect(() => {
    hit.current?.scrollIntoView({ block: 'center' });
  }, [data]);

  // The hour only when no line carries its own — see `day`.
  const lineStamped = !!data?.lines.some((l) => l.at !== undefined || l.when);
  const when = day(data?.when, !lineStamped);

  return (
    <AppWindow route={route} counts={counts}>
      <BackLink
        to={from ? { name: 'alert', id: from } : { name: 'alerts' }}
        label={from ? 'back to the alert' : 'back to the list'}
      />

      {loading && <div className="greet"><h1>Opening…</h1></div>}
      {error && !data && (
        <div className="greet">
          <h1>That record is not there</h1>
          <p>The citation points at something this system can no longer read. {explain(error)}</p>
        </div>
      )}

      {data && (
        <>
          <div className="rec-head">
            <span className="src">
              <i className={`dot ${dotClass(data.surface)}`} />
              {data.surface} · {data.title}
              {data.container && data.container !== data.title ? ` · ${data.container}` : ''}
            </span>
            {data.cited && <span className="why">opened on {citedBy}{when ? ` · ${when}` : ''}</span>}
            {data.url && VENDOR[data.surface] && (
              <a className="vendor" href={data.url} target="_blank" rel="noopener noreferrer">
                the original in {VENDOR[data.surface]} ↗
              </a>
            )}
          </div>

          <div className="transcript">
            {data.lines.map((l, i) => {
              const isHit = l.id === data.cited;
              const mark = dayMark(l, data.lines[i - 1]);
              return (
                <Fragment key={l.id}>
                  {mark && <div className="daymark">{mark}</div>}
                  <div
                    className={`line${isHit ? ' hit' : ''}`}
                    ref={isHit ? hit : undefined}
                    // The caption under the marked line, read by `.line.hit::after`.
                    // It names the alert that sent you here, which is the only
                    // reason this record is open.
                    {...(isHit ? { 'data-cited-by': citedBy } : {})}
                  >
                    <time>{stamp(l)}</time>
                    <p className="said">
                      {l.who && <b>{l.who}</b>}
                      <span>{l.text}</span>
                    </p>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </>
      )}
    </AppWindow>
  );
}
