/**
 * What happens when somebody answers an alert.
 *
 * Four actions and two of them are "no", because they are different answers
 * (`DESIGN.md` §7). "Not needed" is a decision and does not come back; "Not now"
 * is a deferral and does, carrying the note somebody left so it makes sense to
 * them when it returns. Collapsing them into one verb is what makes Later empty:
 * everything either nags forever or vanishes.
 *
 * THE MODEL NEVER HOLDS THE BUTTON. Nothing here is reachable by an agent —
 * `HUMAN_ONLY` withholds `accept_proposal` and `reject_proposal` from every
 * provider, and `/api/findings/:id/act` is not a tool. Every path below is a
 * person clicking with the claim, the checklist and every citation on screen
 * above them.
 *
 * SO THE PRIMARY ACTION APPLIES, rather than promising to. `create_issue` and
 * `link_issues` go through `accept_proposal` (see `APPLIES`), which means one
 * click IS a vendor write — the ticket exists, carrying its provenance comment,
 * and the strip reports it in the past tense. A `post_message` is only ever
 * drafted, because those words go out over somebody's name.
 *
 * THERE IS NO QUEUE SCREEN and there must not be one. A proposal nothing applied
 * stays pending on the durable log; the alert page is where it is reviewed.
 *
 * DEFERRALS AND DISMISSALS ARE DURABLE. Both land on the event log, for the
 * reason proposals do: the alert list is a promise that a decision you already
 * made is still made tomorrow, and a restart must not quietly re-raise it.
 */

import {
  newEvent,
  type Evidence,
  type Finding,
  type McEvent,
  type Note,
  type Proposal,
} from '@mc/domain';
import type { VaultStore } from '@mc/vault';
import { eventLog } from './events.js';
import { propose } from './tools.js';

export type ActionName = 'primary' | 'ask' | 'defer' | 'dismiss';

export interface ActionInput {
  action: ActionName;
  /** "Not now": the note you will thank yourself for. */
  note?: string;
  /** "Not now": when it should come back — a date, or a named event. */
  until?: string;
  /** "Not needed": why, recorded against the decision. */
  reason?: string;
}

export interface ActionResult {
  /** One sentence, already phrased, describing exactly what just happened. */
  outcome: string;
  proposal?: Proposal;
  note?: Note;
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * Findings a human has already answered.
 *
 * A dismissal is permanent; a deferral lasts until its return date, and a named
 * event ("when the sprint ends") has no date yet, so it holds until something
 * evaluates the watch — which is `A11`'s job. Holding indefinitely is the right
 * side to fail on: re-raising something somebody explicitly parked is the fastest
 * way to teach them the list is not listening.
 *
 * `forever` is a dismissal **or** a dateless deferral, and `until` is the LATEST
 * date seen rather than the last one written — which is what keeps this
 * equivalent to folding the raw log: any deferral still in the future
 * suppresses, whatever was written after it.
 */
interface Answer {
  forever: boolean;
  /** Epoch ms, the furthest-out deferral seen. */
  until?: number;
}

/** The rule, once. Both the whole-log read and the incremental index fold with this. */
function foldAnswer(into: Map<string, Answer>, e: McEvent): void {
  const p = e.payload as { findingId?: string; until?: string };
  if (!p.findingId) return;
  if (e.type !== 'mc.finding_dismissed' && e.type !== 'mc.finding_deferred') return;

  const a = into.get(p.findingId) ?? { forever: false };
  if (e.type === 'mc.finding_dismissed') a.forever = true;
  else {
    const due = p.until ? Date.parse(p.until) : Number.NaN;
    // No parseable date means an event-based reminder. Held until watched.
    if (!Number.isFinite(due)) a.forever = true;
    else a.until = Math.max(a.until ?? -Infinity, due);
  }
  into.set(p.findingId, a);
}

function resolve(answers: Map<string, Answer>, now: number): Set<string> {
  const out = new Set<string>();
  for (const [id, a] of answers) {
    if (a.forever || (a.until !== undefined && a.until > now)) out.add(id);
  }
  return out;
}

export function suppressedIds(events: McEvent[], now = Date.now()): Set<string> {
  const answers = new Map<string, Answer>();
  for (const e of events) foldAnswer(answers, e);
  return resolve(answers, now);
}

/**
 * The same answer, without re-reading the whole log on every request.
 *
 * `runFindings` needs this on the front door, and the read has to be
 * **unwindowed** — a `since` would silently expire dismissals, which is the one
 * thing an alert list may not do. So it parses every line of
 * `vault/raw/events.jsonl`: measured at ~150ms per request at 70k events, and
 * the front door is where that shows up first.
 *
 * Built once, then kept current by the log itself (`indexAnswer`, wired in
 * `main.ts`). What is cached is the DECISIONS, never the resolved set — a
 * deferral expires with the clock rather than with an event, so `until` is
 * compared per call and a parked finding returns on time with no event to
 * trigger it.
 */
let answers: Map<string, Answer> | undefined;

/** Fold a freshly appended decision in, so the next read costs nothing. */
export function indexAnswer(e: McEvent): void {
  if (answers) foldAnswer(answers, e);
}

/** Drop the index. For anything that rewrites the log out from under it. */
export function forgetAnswered(): void {
  answers = undefined;
}

export async function answeredFindingIds(vault: VaultStore, now = Date.now()): Promise<Set<string>> {
  if (!answers) {
    const built = new Map<string, Answer>();
    for (const e of await vault.readEvents({})) foldAnswer(built, e);
    answers = built;
  }
  return resolve(answers, now);
}

// ---------------------------------------------------------------------------
// The four
// ---------------------------------------------------------------------------

/**
 * The primary action per alert type, as a proposal.
 *
 * Every one is a `Proposal` — the mechanism that carries the write and its
 * provenance. Whether it is then applied or left pending is `APPLIES`' decision
 * and not this function's: a ticket and a link go through, a message is drafted
 * and read before it goes. `DESIGN.md` §7 puts the label on the button so
 * clicking holds no surprise, and this is the other half of that promise — the
 * label says "create the ticket", and the ticket is created.
 */
function primaryProposal(f: Finding, note: Note | undefined): Proposal | undefined {
  const evidence: Evidence[] = f.evidence;

  switch (f.kind) {
    case 'missing_ticket':
      return propose(
        'create_issue',
        `Promised in ${note?.container?.replace(/^sprint:/, '') ?? 'a closed container'} and never filed. ${f.impact}`,
        evidence,
        {
          title: note?.title ?? f.claim,
          type: 'task',
          labels: ['from-alert'],
          // The promise, so accepting closes the loop rather than leaving the
          // note and the ticket ignorant of each other — `accept_proposal`
          // appends the new key to `relatedKeys`, which is what stops this
          // alert firing again.
          noteId: note?.id,
          ...(note?.owner ? { assignee: note.owner } : {}),
        },
        { dedupeKey: f.dedupeKey, confidence: 0.9 },
      );

    /**
     * The ticket exists; the connection does not. So the write is a LINK, not
     * another `create_issue` — offering to create one here would file a
     * duplicate of the thing the alert has just identified.
     *
     * The key comes off the claim rather than the payload because the
     * reconstruction is recomputed each pass and deliberately never stored:
     * the vault is the asserted layer and a derived guess must not accumulate
     * in it. `claimKey` reads it back out of the sentence a person just read,
     * which is also the only version anybody has agreed to.
     */
    case 'unlinked_commitment': {
      const key = claimKey(f);
      if (!key || !note) return undefined;
      return propose(
        'link_commitment',
        `Promised in ${note.container?.replace(/^sprint:/, '') ?? 'a closed container'}, and ${key} is almost certainly the ticket. ${f.impact}`,
        evidence,
        { noteId: note.id, key, why: f.claim },
        { dedupeKey: f.dedupeKey, confidence: 0.7 },
      );
    }

    /**
     * A promise nobody has mentioned since has no correct write either — the
     * only useful act is to ask the person who took it. Same shape as a cycle
     * or a disagreement: the alert states the fact and drafts the question.
     */
    case 'dropped_commitment':
      return askProposal(f);

    case 'undetected_dependency':
      return propose(
        'link_issues',
        `Reconstructed from evidence and never recorded in the tracker. ${f.impact}`,
        evidence,
        { from: subjectKey(f), to: otherKey(f), type: 'blocks' },
        { dedupeKey: f.dedupeKey, confidence: 0.75 },
      );

    // A cycle and a disagreement have no single correct write. Both are
    // questions for people — which arrow is wrong, which record is current —
    // so the primary action drafts the question rather than guessing an answer.
    case 'cycle':
    case 'disagreement':
    case 'suspect_link':
    case 'aging':
      return askProposal(f);
  }
}

/** A message, drafted and not sent. Nothing here posts. */
function askProposal(f: Finding): Proposal {
  const quoted = f.evidence
    .slice(0, 2)
    .map((e) => `> ${e.quote ?? e.label}${e.quote ? ` — ${e.label}` : ''}`)
    .join('\n');

  /**
   * The channel comes from the EVIDENCE, and it used to be `'eng-payments'`
   * hardcoded.
   *
   * That is the fixture's own channel name. Pointed at any other programme it
   * drafts a message addressed to a channel that does not exist — an invented
   * destination, on a product whose whole argument is that it invents nothing,
   * on the one proposal kind a person is most likely to accept without reading
   * the payload.
   *
   * A Slack evidence label is `#channel — author`, so the channel is already in
   * front of us on any alert built from a Slack record. When nothing resolves,
   * the field is OMITTED rather than guessed, and the draft says who to ask
   * instead of pretending to know where.
   */
  const channel = f.evidence
    .map((e) => (e.surface === 'slack' ? /^#([^\s—]+)/.exec(e.label)?.[1] : undefined))
    .find((ch): ch is string => !!ch);

  return propose(
    'post_message',
    channel
      ? `Asks the people involved in #${channel}, quoting both records with their dates and asking only which is current. It does not say which is right — that is the one thing this cannot know.`
      : `Drafts the question, with no channel — nothing in the evidence says where this was discussed, and guessing a channel would be inventing a destination. Pick one before sending.`,
    f.evidence,
    {
      ...(channel ? { channel } : {}),
      text: [`${f.claim}.`, '', quoted, '', 'Which of these is current?'].join('\n'),
    },
    { dedupeKey: `ask:${f.dedupeKey}`, confidence: 0.6 },
  );
}

const subjectKey = (f: Finding): string =>
  f.subject.kind === 'workitem' ? f.subject.key : '';

/**
 * The ticket named in an `unlinked_commitment`'s own claim.
 *
 * Read back out of the sentence rather than recomputed, so the key somebody is
 * about to link is exactly the key they were shown. A second call to the
 * reconstruction could disagree with the page — the graph may have been
 * replaced by a collector run in between — and linking a different ticket from
 * the one on the button is the worst version of this feature.
 */
const claimKey = (f: Finding): string | undefined =>
  /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(f.claim)?.[1];

/** The other end of a two-key finding, read back out of its id. */
const otherKey = (f: Finding): string => f.id.split(':').pop()?.replace(/^issue:/, '') ?? '';

/**
 * Applies a proposal, by id, through the one implementation that exists.
 *
 * Injected rather than imported so this module keeps knowing nothing about
 * connectors or the event log — and so the write, the provenance comment, the
 * echo token and the note ratchet stay in `accept_proposal` where they were
 * already correct, instead of being written a second time here.
 */
export type ApplyProposal = (proposalId: string) => Promise<Record<string, unknown>>;

/**
 * The two kinds the primary action APPLIES, and the one it does not.
 *
 * `design-preview.html` is explicit in both directions. Creating a ticket
 * reports *"MC-112 created … The commitment in the vault now points at it, so
 * this alert will not fire again"* — past tense, done. Asking somebody reports
 * *"Drafted for #eng-platform … Nothing has been sent. Read it before it
 * goes."*
 *
 * The difference is not caution, it is what the button says. "Create the
 * ticket" is a person deciding, in front of the evidence, with the claim and
 * every citation on the screen above them; a second confirmation re-asks a
 * question they have just answered. A message is different — the words go out
 * over somebody's name, and the draft IS the thing being reviewed.
 *
 * `HUMAN_ONLY` is untouched by this: it withholds `accept_proposal` from every
 * provider, and `/api/findings/:id/act` is not a tool, so no model can reach
 * either path.
 */
const APPLIES = new Set(['create_issue', 'link_issues', 'link_commitment']);

export async function actOnFinding(
  f: Finding,
  input: ActionInput,
  vault: VaultStore,
  note?: Note,
  apply?: ApplyProposal,
): Promise<ActionResult> {
  switch (input.action) {
    case 'primary': {
      const p = primaryProposal(f, note);
      if (!p) return { outcome: 'There is no obvious action for this one yet.' };

      if (apply && APPLIES.has(p.kind)) {
        try {
          const out = await apply(p.id);
          if (typeof out.error === 'string') throw new Error(out.error);
          const created = typeof out.created === 'string' ? out.created : undefined;
          const linked = typeof out.linked === 'string' ? out.linked : undefined;
          return {
            proposal: p,
            outcome: created
              ? `${created} created, carrying a comment that names the meeting, the rationale and ` +
                `every citation above. The commitment now points at it, so this alert will not fire again.`
              : linked
                ? typeof out.provenanceFailed === 'string'
                  ? `Linked to ${linked}. The promise records the key as confirmed rather than ` +
                    `guessed, so this alert will not fire again — but the provenance comment could ` +
                    `not be posted: ${out.provenanceFailed}`
                  : `Linked to ${linked}, which now carries a comment naming the meeting and every ` +
                    `citation above. The promise records the key as confirmed rather than guessed, so ` +
                    `this alert will not fire again.`
                : 'Done. The tracker now records it, so this alert will not fire again.',
          };
        } catch (err) {
          /**
           * The vendor refused, or is down. Say so plainly and leave the
           * proposal pending rather than reporting a success that did not
           * happen — this is the one place in the app that reaches outside, and
           * the whole product is an argument against claims nothing backs.
           */
          return {
            proposal: p,
            outcome:
              `That did not go through: ${err instanceof Error ? err.message : String(err)}. ` +
              `Nothing was written, and the draft is still here.`,
          };
        }
      }

      return {
        proposal: p,
        outcome:
          p.kind === 'create_issue'
            ? 'Drafted a ticket. Nothing has been created yet.'
            : p.kind === 'link_issues'
              ? 'Drafted the link. Nothing has been written to the tracker yet.'
              : 'Drafted, addressed to the people in the records above. Nothing has been sent.',
      };
    }

    case 'ask': {
      const p = askProposal(f);
      return { proposal: p, outcome: 'Drafted. Read it before it goes — nothing has been sent.' };
    }

    case 'defer': {
      /**
       * The note is the point, not the date.
       *
       * "Not now" asks two questions and the first one is the note you will
       * thank yourself for. A snooze that records only a date returns the same
       * unexplained alert in a fortnight, to somebody who has forgotten why they
       * pushed it away — which is how a deferral becomes a dismissal with extra
       * steps.
       */
      const parked = await vault.create({
        kind: 'idea',
        title: f.claim,
        about: f.id,
        relatedKeys: f.subject.kind === 'workitem' ? [f.subject.key] : [],
        recency: 'dated',
        verifiedAt: new Date().toISOString(),
        ...(input.until ? { dueAt: input.until } : {}),
        evidence: f.evidence,
        body: input.note?.trim() || 'Parked without a note.',
      });

      eventLog.append(
        newEvent({
          source: 'mc',
          type: 'mc.finding_deferred',
          ...(f.subject.kind === 'workitem' ? { entityKey: f.subject.key } : {}),
          payload: { findingId: f.id, until: input.until, noteId: parked.id },
        }),
      );

      return {
        note: parked,
        outcome: input.until
          ? `Parked. It comes back ${describeWhen(input.until)}, with your note.`
          : 'Parked, with your note. Nothing will bring it back until you ask.',
      };
    }

    case 'dismiss': {
      eventLog.append(
        newEvent({
          source: 'mc',
          type: 'mc.finding_dismissed',
          ...(f.subject.kind === 'workitem' ? { entityKey: f.subject.key } : {}),
          payload: { findingId: f.id, reason: input.reason },
        }),
      );
      return {
        outcome:
          'Dismissed, with today’s date. It will not come back, and there is a record of who decided it was fine.',
      };
    }
  }
}

/** A date reads as a date; a named watch reads as itself. */
function describeWhen(until: string): string {
  const t = Date.parse(until);
  return Number.isFinite(t)
    ? `on ${new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`
    : until;
}
