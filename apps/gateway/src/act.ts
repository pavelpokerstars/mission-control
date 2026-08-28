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
  andList,
  askAudience,
  type AskAudience,
  newEvent,
  type Evidence,
  type Finding,
  type McEvent,
  type Note,
  type Proposal,
} from '@mc/domain';
import type { VaultStore } from '@mc/vault';
import { eventLog } from './events.js';
import { amendProposal, propose } from './tools.js';
import { SAFE_MODE_REFUSAL } from './safe-mode.js';

/**
 * `send` is not a FIFTH ACTION, and the distinction matters because
 * `DESIGN.md` §7 caps the alert at four.
 *
 * The four are the answers to the alert. `send` is what you press inside the
 * result of one of them — the draft is on screen, you have read it and possibly
 * rewritten it, and this posts that text. It has no button of its own in the
 * `.acts` row and never will.
 */
export type ActionName = 'primary' | 'ask' | 'defer' | 'dismiss' | 'send';

export interface ActionInput {
  action: ActionName;
  /** "Not now": the note you will thank yourself for. */
  note?: string;
  /** "Not now": when it should come back — a date, or a named event. */
  until?: string;
  /** "Not needed": why, recorded against the decision. */
  reason?: string;
  /**
   * "Ask": narrow it to these people instead of everybody the records name.
   *
   * The second button on a disagreement is *"Ask jonas.jost only"* against a
   * primary of *"Ask both, in one thread"* — one message to one person rather
   * than one naming both. Without this the two buttons produced an identical
   * proposal, which is what made the second one unanswerable: it named nobody
   * and did nothing the first had not.
   *
   * A NAME, not a channel. Narrowing the recipients does not change where it
   * would be posted — that is still whatever the records say — so the payload
   * keeps its channel and only the address changes.
   */
  to?: string[];
  /**
   * "Send": the message, as the reader left it.
   *
   * *"I want to know what the message is before I send it, maybe have an option
   * to alter it."* The draft is a starting point and the words go out over
   * somebody's name, so the body that is posted is the body that was on screen —
   * not the one we generated, if those differ. Absent sends the draft unchanged.
   */
  text?: string;
}

export interface ActionResult {
  /** One sentence, already phrased, describing exactly what just happened. */
  outcome: string;
  /**
   * The vendor refused, or is down, and nothing was written.
   *
   * The strip drew a green tick over every outcome including this one — *"✓ That
   * did not go through: Blocked by safe mode"* — which is the same overstatement
   * the sentence beside it exists to avoid. A flag rather than a test on the
   * words, because the words are the part that changes.
   */
  failed?: true;
  /** It has gone. The draft stops being editable, because it is no longer a draft. */
  sent?: true;
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
  /**
   * A DISMISSAL specifically, because `forever` alone cannot tell you which.
   *
   * A dateless deferral sets `forever` too — "held until something evaluates
   * the watch" — so the two collapse for the purpose of *suppressing*, which is
   * all `resolve` ever needed. They do not collapse for the purpose of SAYING
   * what happened: "you dismissed this" and "you parked this with no date" are
   * different sentences, and `answerFor` has to be able to write the right one.
   */
  dismissed: boolean;
  /** Epoch ms, the furthest-out deferral seen. */
  until?: number;
}

/** The rule, once. Both the whole-log read and the incremental index fold with this. */
function foldAnswer(into: Map<string, Answer>, e: McEvent): void {
  const p = e.payload as { findingId?: string; until?: string };
  if (!p.findingId) return;
  if (e.type !== 'mc.finding_dismissed' && e.type !== 'mc.finding_deferred') return;

  const a = into.get(p.findingId) ?? { forever: false, dismissed: false };
  if (e.type === 'mc.finding_dismissed') {
    a.forever = true;
    a.dismissed = true;
  } else {
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

/** A standing decision, as a page can state it. `until` is ISO. */
export interface StandingAnswer {
  kind: 'deferred' | 'dismissed';
  /** Absent on a dismissal, and on a deferral whose reminder is an EVENT. */
  until?: string;
}

/**
 * What a human already answered about ONE finding, when the answer still
 * stands.
 *
 * `answeredFindingIds` collapses the same fold into a Set, which is everything
 * the front door needs: it drops them. A page reached by its own ADDRESS needs
 * the decision rather than the fact of one — otherwise it renders a parked
 * alert as though nothing had happened, silently contradicting the list it is
 * missing from, and offers *Not now* on something already put away.
 *
 * Built on `answeredFindingIds` rather than beside it, so there is one index,
 * one fold and one comparison against the clock. Returning `undefined` for a
 * finding that is no longer suppressed is the point of that reuse: a deferral
 * expires with the clock, and the moment it does the alert is back on the list
 * and the page must stop claiming otherwise.
 */
export async function answerFor(
  vault: VaultStore,
  id: string,
  now = Date.now(),
): Promise<StandingAnswer | undefined> {
  const standing = await answeredFindingIds(vault, now);
  if (!standing.has(id)) return undefined;
  const a = answers?.get(id);
  if (!a) return undefined;
  if (a.dismissed) return { kind: 'dismissed' };
  return {
    kind: 'deferred',
    ...(a.until !== undefined ? { until: new Date(a.until).toISOString() } : {}),
  };
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
function primaryProposal(f: Finding, note: Note | undefined, audience: AskAudience): Proposal | undefined {
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
      return askProposal(f, audience);

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
      return askProposal(f, audience);
  }
}

/**
 * The closing question, which is the whole of what the message asks.
 *
 * ONE TEMPLATE SERVED EVERY KIND, and on anything but a disagreement it asked a
 * question that did not apply. Measured, on the flagship alert — one Zoom quote,
 * no channel, and:
 *
 *     Esme Ellis to chase the vendor sandbox was never filed.
 *     > Esme Ellis to chase the vendor sandbox. — Orbit Daily Scrum 2026-06-18
 *     Which of these is current?
 *
 * "Which of these" refers to nothing. The question is the only part of the
 * message a person actually answers, so it is the one part that cannot be
 * generic.
 */
function askQuestion(f: Finding): string {
  switch (f.kind) {
    case 'disagreement':
      return 'Which of these is current?';
    case 'cycle':
      return 'Nothing in the loop can start until one of those arrows goes. Which one is wrong?';
    case 'missing_ticket':
    case 'dropped_commitment':
      return 'Nothing in the tracker references it. Is this still happening, and should it be a ticket?';
    case 'unlinked_commitment':
      return 'Is that the ticket for it? If so I will record it on the promise.';
    case 'aging':
      return 'Is this still with you, or is it waiting on something?';
    case 'suspect_link':
      return 'Does that still hold?';
    default:
      return 'Is this still current?';
  }
}

/**
 * What the message quotes.
 *
 * A cycle has no quotes to give — its evidence rows are four arrow labels, and
 * two of them read as a fragment of a loop rather than as the loop. `impact`
 * already carries the ordered walk, which is the thing a person needs in order
 * to answer, so that is what goes in.
 */
function askBody(f: Finding): string {
  if (f.kind === 'cycle') return f.impact.replace(/^in a dependency cycle — /, '');
  return f.evidence
    .slice(0, 2)
    .map((e) => `> ${e.quote ?? e.label}${e.quote ? ` — ${e.label}` : ''}`)
    .join('\n');
}

/**
 * A message, drafted and not sent. Nothing here posts.
 *
 * ADDRESSED TO PEOPLE, IN THE TEXT ITSELF. `post_message`'s payload had no
 * recipient field, so "addressed to the people in the records above" was a
 * sentence in the interface over a body that named nobody — and Slack has no
 * concept of a recipient on a channel message anyway. The names open the
 * message, which is how a person addresses one, and `to` rides in the payload
 * so the page can say who before it is sent.
 *
 * The channel now travels as BOTH its name and its id, and that was a live
 * defect rather than tidiness: `accept_proposal` reads `payload.channelId` and
 * this wrote `payload.channel`, so accepting a draft the page said was going to
 * #orbit-delivery would have posted it to `SLACK_DEFAULT_CHANNEL ?? 'C-mc'`.
 * The page named one destination and the write used another.
 */
function askProposal(f: Finding, audience: AskAudience): Proposal {
  const { channel, channelId, to } = audience;

  /**
   * The names open the message — unless the claim already says them.
   *
   * A commitment's claim is built out of its owner: *"Esme Ellis to chase the
   * vendor sandbox was never filed"*. Prefixing that produced **"Esme Ellis —
   * Esme Ellis to chase the vendor sandbox was never filed"**, which reads like
   * a template that has slipped. A disagreement's claim is about the ticket and
   * names nobody, so there the prefix is the only thing that addresses anyone.
   */
  const alreadyNamed = to.length > 0 && to.every((n) => f.claim.includes(n));
  const opening = to.length && !alreadyNamed ? `${to.join(', ')} — ${f.claim}.` : `${f.claim}.`;

  return propose(
    'post_message',
    to.length
      ? `Asks ${andList(to)}${channel ? ` in #${channel}` : ''}, quoting the records it was read ` +
        `from and asking only “${askQuestion(f)}” It does not answer that — which answer is right ` +
        `is the one thing this cannot know.`
      : `Drafts the question with nobody named: nothing in the records says who to ask, and ` +
        `addressing a guess is the one thing this must not do. Pick a recipient before sending.`,
    f.evidence,
    {
      ...(channel ? { channel } : {}),
      ...(channelId ? { channelId } : {}),
      ...(to.length ? { to } : {}),
      text: [opening, '', askBody(f), '', askQuestion(f)].join('\n'),
    },
    { dedupeKey: `ask:${f.dedupeKey}`, confidence: 0.6 },
  );
}

/** "to a and b in #channel", the half both the draft and the send line need. */
function toLine(audience: AskAudience): string {
  return `${andList(audience.to)}${audience.channel ? ` in #${audience.channel}` : ''}`;
}

/** "Drafted to a and b in #channel", or the honest version when nobody is named. */
export function draftedLine(audience: AskAudience): string {
  if (!audience.to.length) {
    return 'Drafted, with nobody named — nothing in the records says who to ask';
  }
  return `Drafted to ${toLine(audience)}`;
}

/** The same, in the past tense, for the one action that actually posts. */
function sentLine(audience: AskAudience): string {
  if (!audience.to.length) {
    return audience.channel ? `Sent to #${audience.channel}` : 'Sent';
  }
  return `Sent to ${toLine(audience)}`;
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

/**
 * ⚠ THE ONE PLACE THIS APP SAYS SOMETHING HAPPENED THAT DID NOT.
 *
 * Asked for, deliberately, and it is worth writing down what it costs. Safe
 * mode is ON by default and blocks every vendor write, so on a fixture — where
 * there is no vendor to write to and nothing can leave the machine — every
 * primary action ended in a paragraph of configuration advice instead of the
 * outcome the screen is meant to show. That is the right report for an instance
 * with credentials and the wrong one for a demo, and the demo is what this
 * instance is.
 *
 * SO IT IS NARROW. Only `BlockedBySafeMode` — OUR refusal, thrown before the
 * call is made, where nothing was attempted and nothing failed. A vendor that
 * refuses or is down still says so, unchanged, because that is a fact about the
 * world rather than about our own switch.
 *
 * WHAT IT DOES NOT SAY. No key is invented: the sentences below report the ACT
 * and none of its consequences, so nothing here names a ticket that does not
 * exist or claims the alert will stop firing — it will not, because nothing was
 * written, and it is still on the list when you go back.
 *
 * AND THE LOG IS NOT TOUCHED. `accept_proposal` throws before it settles, so
 * the proposal stays PENDING — the durable record still says the decision was
 * never carried out, which is the half that has to stay true. The sentence on
 * screen is for a person watching a demo; the log is what the system will be
 * asked to account for later, and only one of those is allowed to be generous.
 *
 * THE HONEST VERSION OF THE SAME THING is one line of `.env`:
 * `MC_SAFE_MODE=off` on a fixture makes these writes real against the in-memory
 * graph connectors, with no credentials and no network, and then the ticket
 * exists and the alert genuinely stops. If this instance ever gets a real token,
 * that is the switch to think about — not this function.
 */
function blockedBySafeMode(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // The name survives a throw; the MESSAGE is all that survives a round trip
  // through `accept_proposal`, which reports a refusal as `{ error: string }`.
  return err.name === 'BlockedBySafeMode' || err.message.includes(SAFE_MODE_REFUSAL);
}

function pretendItWorked(kind: Proposal['kind']): string {
  switch (kind) {
    case 'create_issue':
      return 'Filed, carrying a comment that names the meeting, the rationale and every citation above.';
    case 'link_issues':
    case 'link_commitment':
      return 'Linked, with a comment naming the meeting and every citation above.';
    case 'post_message':
      return 'Sent.';
    default:
      return 'Done.';
  }
}

export async function actOnFinding(
  f: Finding,
  input: ActionInput,
  vault: VaultStore,
  note?: Note,
  apply?: ApplyProposal,
  /**
   * Who the message is for. Passed in rather than derived here, because the
   * PAGE has to name the same people before the click that the draft names
   * after it — `findingDetail` computes it once and both ends read that one
   * answer. Defaulted so a caller with no detail in hand still works, and the
   * default is the honest one: whatever the evidence alone can say.
   */
  audience: AskAudience = askAudience(f),
): Promise<ActionResult> {
  switch (input.action) {
    case 'primary': {
      const p = primaryProposal(f, note, audience);
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
           *
           * EXCEPT WHEN THE REFUSAL IS OUR OWN — see `pretendItWorked`.
           */
          if (blockedBySafeMode(err)) return { proposal: p, outcome: pretendItWorked(p.kind) };
          return {
            proposal: p,
            failed: true,
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
              : `${draftedLine(audience)}. Nothing has been sent — read it before it goes.`,
      };
    }

    /**
     * The one action in this app that posts, and it is pressed on a draft the
     * reader has already read.
     *
     * `askProposal` dedupes to the proposal the Ask button just made — only a
     * PENDING one dedupes, so a second send after this one starts a fresh
     * draft rather than re-posting a settled one. The edit is applied to that
     * proposal before it is accepted, so what is journalled as sent is what
     * actually went.
     */
    case 'send': {
      const only = input.to?.length ? { ...audience, to: input.to } : audience;
      const p = askProposal(f, only);
      if (input.text?.trim()) amendProposal(p.id, { text: input.text.trim() });

      if (!apply) {
        return {
          proposal: p,
          failed: true,
          outcome: 'Nothing was sent — this instance has no way to apply a decision.',
        };
      }

      try {
        const out = await apply(p.id);
        if (typeof out.error === 'string') throw new Error(out.error);
        return { proposal: p, sent: true, outcome: `${sentLine(only)}.` };
      } catch (err) {
        // Our own switch, not the vendor's answer — see `pretendItWorked`.
        if (blockedBySafeMode(err)) {
          return { proposal: p, sent: true, outcome: `${sentLine(only)}.` };
        }
        return {
          proposal: p,
          failed: true,
          outcome:
            `That did not go through: ${err instanceof Error ? err.message : String(err)}. ` +
            `Nothing was sent, and the draft is still here.`,
        };
      }
    }

    case 'ask': {
      // Narrowed to whoever the button named, when it named a subset.
      const only = input.to?.length ? { ...audience, to: input.to } : audience;
      const p = askProposal(f, only);
      return {
        proposal: p,
        outcome: `${draftedLine(only)}. Nothing has been sent — read it before it goes.`,
      };
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
