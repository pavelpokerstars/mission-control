/**
 * Starter questions for an empty chat, built from what is actually in front of
 * the user.
 *
 * The line above those buttons claims the agent can see five surfaces at once
 * and invites a question no single tool could answer. Four hardcoded strings
 * cannot keep that promise: they name tickets that may be done, they say the
 * same thing on every screen, and the one question that would have proved the
 * claim — the cycle *this* board actually draws — is the one they cannot know.
 * A demo of cross-surface reasoning whose own suggestions are a constant is an
 * advert for the opposite.
 *
 * So they are computed here, from the same joins the findings pass and the
 * skills use, and every one carries a `why`: which two surfaces had to be put
 * together for the question to be worth asking. That line is the product claim,
 * shown rather than asserted.
 *
 * DETERMINISTIC, for the same three reasons `skills.ts` is: it works with no
 * model key at all (mock mode has to stay a complete product, and a starter
 * list that only appears when a token is valid is not one), there is one file
 * to read when a suggestion is wrong, and a box that offers four different
 * questions every time you open it reads as noise rather than as insight. The
 * model is not asked what would be interesting; the state says.
 *
 * SERVER-SIDE, because the browser cannot do this. It has no vault, no event
 * log, and no reason to hold the board's arrows — the five surfaces meet in the
 * gateway and nowhere else. This is the same argument that keeps the dossier
 * and the findings pass assembled here rather than unioned in the browser.
 */

import {
  buildRelationGraph,
  buildTimeline,
  byConcern,
  extractKeys,
  stalenessOf,
  type CanvasSticky,
  type McEvent,
  type Note,
  type RelationGraph,
  type Timeline,
  type Transcript,
  type WorkItem,
  type WorkItemKey,
  type WorkItemStatus,
} from '@mc/domain';
import type { Connectors } from '@mc/connectors';
import type { CanvasConnector } from '@mc/domain';
import type { VaultStore } from '@mc/vault';
import { days, pct } from './format.js';

export interface Suggestion {
  /** The question, phrased as the user would type it. */
  text: string;
  /**
   * Which surfaces had to be joined for this to be worth asking. Shown under
   * the button — it is the evidence for the sentence above them.
   */
  why: string;
}

/**
 * The context envelope, as much of it as this needs. Structurally a subset of
 * `ContextEnvelope` rather than the type itself, so a starter list does not
 * need a caller to assemble a full envelope before it can ask.
 */
export interface SuggestInput {
  focusedKey?: WorkItemKey;
  /**
   * The window to reason over, in days.
   *
   * DERIVE EVERY NUMBER OVER THE WINDOW YOU ARE ASKED ABOUT. This began as a
   * 7 / 14 / 30 selector on a screen that no longer exists, and the RULE
   * outlived the control: lanes used to be built over a fixed 21 days while the
   * caller asked for something else, so "MC-102 spent ten days waiting" could
   * sit beside a chart showing six. If you add another consumer that derives a
   * number from the timeline, derive it over this.
   *
   * Absent for a caller that has no opinion (`scripts/inspect.mjs`, a bare
   * curl), which falls back to the default rather than to the old 21.
   */
  windowDays?: number;
}

/**
 * What survives if the gateway cannot answer, or if there is genuinely nothing
 * to say — a fresh checkout with an empty vault and no seeded history. Better a
 * plausible question than an empty box; these are the four that used to be
 * hardcoded in the shell.
 */
export const FALLBACK: Suggestion[] = [
  { text: 'What is stuck right now, and why?', why: 'Jira status joined to what the vault says about it.' },
  { text: 'Does the board have circular dependencies?', why: 'Arrows drawn on the canvas, read as a graph.' },
  { text: 'What did we decide in the last meeting?', why: 'The recording, against the tickets it produced.' },
  { text: 'Which of our notes have gone stale?', why: 'Dated claims in the vault, past their verify horizon.' },
];

/** How many are offered. Four is what fits above the composer. */
const LIMIT = 4;

/** At most this many about one ticket, so a bad week cannot fill the whole set. */
const PER_KEY = 2;

interface Candidate extends Suggestion {
  /** 0–1, before context boosts. Roughly "how much would this surprise you". */
  score: number;
  /** The ticket it concerns, for the per-key cap and the focus boost. */
  key?: WorkItemKey;
}

/** The question is about the ticket the user has open. Beats everything else. */
const FOCUS_BOOST = 0.4;

/**
 * The window-independent half, which is the expensive half.
 *
 * Everything here costs network — `listConnectors` alone is ~4s against a real
 * board — and none of it changes when a caller asks about 14 days instead of
 * 30. Only the timeline does, so only the timeline is rebuilt per request.
 * Keying the whole cache on the window instead would re-pay every vendor read
 * to answer the same question over a different span.
 */
interface Gathered {
  items: WorkItem[];
  notes: Note[];
  graph: RelationGraph;
  stickies: CanvasSticky[];
  /** The most recent recording, same one `/workshop` reads with no argument. */
  newest?: Transcript;
  /** Raw, over `MAX_LOOKBACK_DAYS`, so any offered window is a filter away. */
  events: McEvent[];
}

interface Facts extends Gathered {
  timeline: Timeline;
}

/**
 * Facts are cached for a minute.
 *
 * Not a micro-optimisation: against a real board `listConnectors` costs one GET
 * per distinct endpoint id (~4s for a dozen arrows), and this endpoint fires
 * every time somebody opens a new chat or changes route. The ranking below is
 * recomputed per request — it is the gathering that is shared, so a suggestion
 * still follows the focused ticket immediately.
 */
const FACTS_TTL_MS = 60_000;
let cache: { at: number; gathered: Gathered } | undefined;

/** The widest window any caller asks for, so one gather serves them all. */
const MAX_LOOKBACK_DAYS = 30;
/** What a caller that names no window gets. */
const DEFAULT_LOOKBACK_DAYS = 14;

async function gatherFacts(
  connectors: Connectors,
  vault: VaultStore,
  /**
   * The arrows to reason over, from the reconciled graph.
   *
   * NOT `listConnectors`. With `MIRO_ACCESS_TOKEN` set that returns whatever is
   * drawn on the live canvas today — an unreconciled and possibly much older
   * account of what depends on what — and a suggestion then names tickets from
   * a board nothing else in the app reads. It was doing exactly that: after the
   * fixture was regenerated it went on offering *"The board draws MC-103 →
   * MC-102 → MC-101 → MC-105"*, four keys that no longer exist, beside three
   * suggestions computed correctly from the graph.
   *
   * Same fix `work.ts`, `findings.ts` and `records.ts` already carry. The board
   * is evidence; the graph is the reconciled result.
   */
  boardArrows?: CanvasConnector[],
): Promise<Gathered> {
  if (cache && Date.now() - cache.at < FACTS_TTL_MS) return cache.gathered;

  const boardId = process.env.MIRO_BOARD_ID ?? 'demo-board';
  // The widest window anything will ask for. Narrower ones filter this in
  // memory, so changing the window costs no I/O at all.
  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000).toISOString();

  const [items, readArrows, pages, stickies, recordings, events] = await Promise.all([
    connectors.jira.listItems(),
    boardArrows ? Promise.resolve(boardArrows) : connectors.miro.listConnectors(boardId),
    connectors.confluence.listPages(process.env.CONFLUENCE_SPACE_KEY ?? 'MC'),
    connectors.miro.listStickies(boardId),
    connectors.zoom.listTranscripts(),
    vault.readEvents({ since, limit: 2_000 }),
  ]);

  const [latest] = [...recordings].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const notes = vault.list();

  const gathered: Gathered = {
    items,
    notes,
    stickies,
    events,
    graph: buildRelationGraph({ items, notes, connectors: readArrows, pages }),
    newest: latest ? await connectors.zoom.getTranscript(latest.id) : undefined,
  };
  cache = { at: Date.now(), gathered };
  return gathered;
}

/**
 * Add the one window-dependent fact.
 *
 * Deliberately the same two steps every other consumer takes — filter the log
 * to the window, then `buildTimeline(events, { items, notes })` — because
 * agreeing with them is the entire point. (`GET /api/timeline` was the third
 * consumer and is deleted; the two steps are the contract, not the route.)
 * `readEvents` treats `since` as `ts >= since`, so filtering the cached 30 days
 * in memory is equivalent to having asked for the narrower window in the first
 * place.
 */
function factsFor(g: Gathered, windowDays: number): Facts {
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const inWindow = g.events.filter((e) => e.ts >= since);
  return { ...g, timeline: buildTimeline(inWindow, { items: g.items, notes: g.notes }) };
}

/**
 * Drop the cache. `main.ts` calls this on every event the log accepts, so the
 * TTL above is only ever the backstop for things that change without emitting
 * one — a note edited straight on disk, say.
 */
export function forgetSuggestionFacts(): void {
  cache = undefined;
}

/**
 * "MC-103 has been ___ for 12 days". A map rather than
 * `status.replace('_', ' ')`, which produces "has been todo" and "has been in
 * in progress" — a suggestion whose grammar is broken reads as generated, which
 * is exactly the impression these are trying to avoid.
 */
const WAITING_PHRASE: Record<WorkItemStatus, string> = {
  blocked: 'blocked',
  todo: 'sitting in todo',
  in_review: 'in review',
  in_progress: 'in progress',
  backlog: 'in the backlog',
  done: 'done',
};

export async function suggestQuestions(
  connectors: Connectors,
  vault: VaultStore,
  input: SuggestInput = {},
  boardArrows?: CanvasConnector[],
): Promise<Suggestion[]> {
  const gathered = await gatherFacts(connectors, vault, boardArrows);
  const facts = factsFor(gathered, input.windowDays ?? DEFAULT_LOOKBACK_DAYS);
  const candidates = [...contextual(facts, input), ...standing(facts)];

  const ranked = candidates
    .map((c) => ({
      c,
      rank:
        c.score + (c.key && c.key === input.focusedKey ? FOCUS_BOOST : 0),
    }))
    .sort((a, b) => b.rank - a.rank);

  const out: Suggestion[] = [];
  const perKey = new Map<WorkItemKey, number>();
  const seen = new Set<string>();
  for (const { c } of ranked) {
    if (out.length >= LIMIT) break;
    if (seen.has(c.text)) continue;
    const used = c.key ? (perKey.get(c.key) ?? 0) : 0;
    if (used >= PER_KEY) continue;
    seen.add(c.text);
    if (c.key) perKey.set(c.key, used + 1);
    out.push({ text: c.text, why: c.why });
  }

  // An empty vault on a fresh checkout is the case this covers, and an Ask box
  // with nothing under it would read as the agent having nothing to offer.
  return out.length ? out : FALLBACK;
}

// ---------------------------------------------------------------------------
// Questions about what the user is pointing at
// ---------------------------------------------------------------------------

function contextual(facts: Facts, input: SuggestInput): Candidate[] {
  const out: Candidate[] = [];
  const key = input.focusedKey;
  const item = key ? facts.items.find((i) => i.key === key) : undefined;

  if (key && item) {
    const lane = facts.timeline.lanes.find((l) => l.key === key);
    const notes = facts.notes.filter((n) => n.relatedKeys.includes(key));

    if (item.status === 'blocked') {
      const explained = notes.some((n) => n.kind === 'impediment');
      out.push({
        text: `Why is ${key} blocked, and what have we already tried?`,
        why: explained
          ? `Jira has the status; the vault has ${notes.length} note${notes.length === 1 ? '' : 's'} on why.`
          : 'Jira has the status and nothing in the vault says why — the board might.',
        score: 1,
        key,
      });
    } else if (lane && lane.flowEfficiency !== null && lane.flowEfficiency < 0.5) {
      out.push({
        text: `${key} has been ${WAITING_PHRASE[item.status]} for ${days(lane.ageDays, 'prose')} — what is it waiting on?`,
        why: `${pct(lane.flowEfficiency)} flow efficiency, from transitions no single tool keeps.`,
        score: 0.92,
        key,
      });
    }

    // Said or drawn, but never written down. The gap the join key exists to find.
    const spoken = facts.newest
      ? extractKeys(facts.newest.segments.map((s) => s.text).join('\n')).includes(key)
      : false;
    const drawn = facts.stickies.filter((s) => s.mentions.includes(key)).length;
    if ((spoken || drawn) && notes.length === 0) {
      const where = [
        spoken && facts.newest ? `"${facts.newest.meetingTopic}"` : '',
        drawn ? `${drawn} stick${drawn === 1 ? 'y' : 'ies'}` : '',
      ]
        .filter(Boolean)
        .join(' and ');
      out.push({
        text: `What did we say about ${key} that never made it into Jira?`,
        why: `Named in ${where}, with nothing about it in the vault.`,
        score: 0.95,
        key,
      });
    }

    out.push({
      text: `Catch me up on ${key} across all five surfaces.`,
      why: 'Jira, the board, the last meeting and the vault, in one answer.',
      score: 0.7,
      key,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Questions the state raises on its own
// ---------------------------------------------------------------------------

function standing(facts: Facts): Candidate[] {
  const out: Candidate[] = [];

  // 1. The cycle. This is the demo's sharpest claim and it is only knowable
  //    because the canvas is machine-readable — so it names the actual chain
  //    rather than asking whether one exists.
  const [cycle] = facts.graph.cycles;
  if (cycle?.length) {
    // findCycles closes the loop already (last key repeats the first).
    const chain = cycle.join(' → ');
    out.push({
      text: `The board draws ${chain}. Which of those arrows is wrong?`,
      why: 'A loop in arrows drawn by hand — Miro cannot see it, and Jira has no arrows.',
      score: 0.9,
    });
  }

  // 2. Blocked with nobody having written down why. Same gap /standup reports.
  const explained = new Set(
    facts.graph.edges
      .filter((e) => e.kind === 'annotates')
      .filter((e) => facts.notes.find((n) => n.id === e.from)?.kind === 'impediment')
      .map((e) => e.to),
  );
  const unexplained = facts.timeline.lanes
    .filter((l) => l.segments.at(-1)?.status === 'blocked' && !explained.has(l.key))
    .sort((a, b) => b.ageDays - a.ageDays)[0];
  if (unexplained) {
    out.push({
      text: `${unexplained.key} has been blocked ${days(unexplained.ageDays, 'prose')} and nothing says why. What happened?`,
      why: "Jira's status against every impediment note in the vault — the gap is the finding.",
      score: 0.86,
      key: unexplained.key,
    });
  }

  // 3. The worst-waiting lane, ranked the way `buildTimeline` ranks it so the
  //    suggestion and the top row of the screen cannot disagree.
  const worst = [...facts.timeline.lanes]
    .filter((l) => l.flowEfficiency !== null && l.waitingDays >= 1 && l.key !== unexplained?.key)
    .sort(byConcern)[0];
  if (worst && worst.flowEfficiency !== null) {
    out.push({
      text: `${worst.key} spent ${days(worst.waitingDays, 'prose')} waiting and ${days(worst.activeDays, 'prose')} being worked. Who is it waiting on?`,
      why: 'Flow efficiency from the event log; the board says who is downstream.',
      score: 0.76,
      key: worst.key,
    });
  }

  // 4. The last meeting, against what it actually produced.
  if (facts.newest) {
    const spoken = extractKeys(facts.newest.segments.map((s) => s.text).join('\n'));
    const known = new Set(facts.items.map((i) => i.key));
    const missing = spoken.filter((k) => !known.has(k)).length;
    out.push({
      text: `What did we decide in "${facts.newest.meetingTopic}" that is not a ticket yet?`,
      why: missing
        ? `${spoken.length} keys named aloud, ${missing} of them not in Jira at all.`
        : `The recording against the sprint — ${spoken.length} tickets came up by name.`,
      score: 0.82,
    });
  }

  // 5. The half of the board Jira has never seen. Stickies mentioning no key are
  //    exactly the ones no vendor can join for you.
  const unjoined = facts.stickies.filter((s) => s.mentions.length === 0);
  if (unjoined.length >= 3) {
    const frames = [...new Set(unjoined.map((s) => s.frameTitle).filter(Boolean))];
    out.push({
      text: `${unjoined.length} stickies on the board mention no ticket. Which of them are real work?`,
      why: frames.length
        ? `Written under ${frames.slice(0, 2).join(' and ')} — the half of the board Jira never sees.`
        : 'The half of the board Jira never sees, read against the sprint.',
      score: 0.72,
    });
  }

  // 6. A promise still open. The oldest is the one worth asking about.
  const commitment = facts.notes
    .filter((n) => n.kind === 'commitment' && n.status === 'open')
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  if (commitment) {
    const stale = stalenessOf(commitment);
    out.push({
      text: `Did we ever follow up on "${commitment.title}"?`,
      why: stale.stale
        ? `An open commitment in the vault, unconfirmed for ${days(stale.days, 'prose')}.`
        : 'An open commitment in the vault, against what Jira has moved since.',
      score: 0.74,
      key: commitment.relatedKeys[0],
    });
  }

  // 7. Decay, as a question. Only worth offering once enough has rotted to be
  //    a pattern rather than one note.
  const stale = facts.notes.filter((n) => stalenessOf(n).stale);
  if (stale.length >= 2) {
    out.push({
      text: `Which of our claims have gone stale — ${stale.length} are past the horizon?`,
      why: 'Dated notes measured against when they were last verified, not when written.',
      score: 0.64,
    });
  }

  // 8. A ticket nobody has written, drawn or documented anything about.
  const orphan = facts.graph.nodes.find(
    (n) =>
      n.kind === 'workitem' &&
      n.degree === 0 &&
      n.status !== 'done' &&
      n.status !== 'backlog',
  );
  if (orphan) {
    out.push({
      text: `${orphan.id} has no notes, no docs and no arrows. Does anyone know what it is?`,
      why: "Jira's sprint against every note, page and arrow the other four surfaces hold.",
      score: 0.66,
      key: orphan.key,
    });
  }

  return out;
}
