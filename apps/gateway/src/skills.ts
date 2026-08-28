/**
 * Skills — the ceremonies, as procedures.
 *
 * A tool answers one question. A skill runs a whole piece of the scrum master's
 * week: it gathers from every surface in a fixed order, says what it found, and
 * proposes what to do about it.
 *
 * THE DESIGN DECISION THAT MATTERS: a skill is deterministic. It does not ask a
 * model to remember to call six tools in the right sequence — it calls them
 * itself and hands the assembled material back. Three reasons, and all three
 * are load-bearing:
 *
 *   1. It works with no LLM at all. `MC_MODE=mock` has to stay a complete
 *      product, and a standup brief that only appears when a token is valid is
 *      not one.
 *   2. There is one file to read when the brief is wrong.
 *   3. A ceremony that renders differently every morning is worthless. Same
 *      input, same brief.
 *
 * The agent is still in the loop — the brief lands in the transcript, so the
 * next question is asked against it. But the gathering is ours.
 *
 * This is also the substrate the scheduler will stand on. Nightly consolidation
 * is not new machinery; it is `tidy` on a timer.
 */

import {
  activeSprintOf,
  buildRelationGraph,
  buildTimeline,
  byConcern,
  extractKeys,
  slugify,
  stalenessOf,
  type CanvasSticky,
  type Evidence,
  type Note,
  type Proposal,
  type Timeline,
  type Transcript,
  type WorkItem,
  type WorkItemKey,
} from '@mc/domain';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { lookupStatusWord } from '@mc/connectors';
import type { ConfluencePage, Connectors } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import type { StoredContainer } from '@mc/domain';
import { days, pct, stripHtml, zoomEvidence } from './format.js';
import { propose } from './tools.js';
import { emitVaultEvent, VAULT_DIR } from './vault.js';

/**
 * An action item a model found that the cue regexes did not.
 *
 * The seam exists because recall, not precision, is what limits the pack: the
 * cues drop "we should write it down as a pattern" (no cue word) and "I suggest
 * we pull MC-104" (likewise), and no amount of tuning a word list fixes that.
 * A model reads the sentence instead.
 */
export interface ExtractedAction {
  text: string;
  speaker?: string;
  /** Seconds into the recording, when the model can place it. */
  at?: number;
  /**
   * The precision gate — `DIRECTION.md` §5. A promise with a named owner and a
   * date is unambiguously trackable; "someone should look at that" is not.
   *
   * Both are optional and both must STAY optional. Their absence is the signal
   * that a promise is not trackable yet, and a required field is one a model
   * fills in rather than leaves out — which would turn the gate into a
   * rubber stamp and make every alert it produces unbelievable.
   */
  owner?: string;
  /** ISO date, `YYYY-MM-DD`, only when the transcript actually said one. */
  dueAt?: string;
}

export interface Extractor {
  actions(t: Transcript): Promise<ExtractedAction[]>;
}

export interface SkillContext {
  connectors: Connectors;
  vault: VaultStore;
  /**
   * Optional model-backed extraction. Injected by `main.ts` only when a key
   * exists, so the deterministic path stays the floor rather than the fallback:
   * with no extractor every skill still runs, and mock mode stays a complete
   * product. See `cachedActions` for how it stays reproducible.
   */
  extract?: Extractor;
  /** How far back to look. Skills pick their own sensible default. */
  days?: number;
  /**
   * An explicit window, which beats `days` when present — "run /catchup over
   * THAT week" rather than over the last seven days.
   *
   * It arrived from the timeline's brush; that control is gone and the field is
   * not, because it is live over `POST /api/skills/:name`, which is a documented
   * curl target. Deleting a working parameter of an HTTP interface because the
   * UI that once fed it went would be the shipped-code-is-not-the-spec mistake
   * in reverse.
   */
  from?: string;
  to?: string;
  /**
   * The sprints and releases, from the same `StoredGraph` the detector reads.
   *
   * `findMissingTickets` looks a note's `container` up **by node id** in that
   * graph, so a writer that invents its own container string produces a note
   * whose alert can never fire — silently, which is the worst way to lose one.
   * Passing the real list is what keeps the writer and the reader honest about
   * what a container is.
   *
   * Optional: a skill with no graph behind it still runs, and simply records no
   * container. That costs the promise its trigger, which is visible, rather
   * than giving it one that does not resolve, which is not.
   */
  containers?: StoredContainer[];
  /**
   * The rest of the slash line, when the user typed one: `/workshop zoom-001`.
   *
   * One free-text argument rather than a per-skill parameter object, because
   * the transport is a chat input box and that is genuinely all it can carry.
   * A skill that does not take one ignores it.
   */
  arg?: string;
}

export interface SkillResult {
  skill: string;
  ranAt: string;
  /**
   * The brief, as text.
   *
   * Text rather than a block tree on purpose: it goes straight into the chat
   * transcript, which means it is replayed to the agent as history for free.
   * A structured render would look better and would have to be translated back
   * into prose for the model anyway.
   */
  brief: string;
  proposals: Proposal[];
  /**
   * The vault note the brief was written to, when the skill keeps one. This is
   * what makes a pack editable: the chat transcript shows it, the note page
   * edits it, and the publish proposal points at it rather than at a frozen
   * copy of the text.
   */
  noteId?: string;
  /**
   * The board this run was actually about.
   *
   * A ceremony is about *a* board, not about whichever one the gateway booted
   * with — `MIRO_BOARD_ID` is the last resort, not the default, because one
   * process-wide board makes every retro look like it was drawn on the same
   * canvas. It was returned so the shell could frame it; no caller reads it
   * today, and it stays because the pairing is a fact about the run and
   * `/api/skills/:name` is a documented interface.
   */
  boardId?: string;
}

export interface Skill {
  name: string;
  label: string;
  /** One line, shown in the slash menu. */
  description: string;
  run(ctx: SkillContext): Promise<SkillResult>;
}

// ---------------------------------------------------------------------------
// Shared gathering
// ---------------------------------------------------------------------------

interface Gathered {
  items: WorkItem[];
  notes: Note[];
  /** Kept alongside the graph: doc nodes carry a label, not the page's keys. */
  pages: ConfluencePage[];
  timeline: Timeline;
  graph: ReturnType<typeof buildRelationGraph>;
}

async function gather(ctx: SkillContext, days: number): Promise<Gathered> {
  const since = ctx.from ?? new Date(Date.now() - days * 86_400_000).toISOString();
  const [items, arrows, pages, events] = await Promise.all([
    ctx.connectors.jira.listItems(),
    ctx.connectors.miro.listConnectors(process.env.MIRO_BOARD_ID ?? 'demo-board'),
    ctx.connectors.confluence.listPages(process.env.CONFLUENCE_SPACE_KEY ?? 'MC'),
    ctx.vault.readEvents({ since, limit: 2_000 }),
  ]);
  const notes = ctx.vault.list();
  return {
    items,
    notes,
    pages,
    timeline: buildTimeline(events, { items, notes, mapStatus: lookupStatusWord }),
    graph: buildRelationGraph({ items, notes, connectors: arrows, pages }),
  };
}

/** A section, dropped entirely when it has nothing in it. */
function section(heading: string, lines: string[], emptyNote?: string): string[] {
  if (!lines.length) return emptyNote ? [`## ${heading}`, emptyNote, ''] : [];
  return [`## ${heading}`, ...lines, ''];
}

// ---------------------------------------------------------------------------
// /standup
// ---------------------------------------------------------------------------

const standup: Skill = {
  name: 'standup',
  label: 'Standup brief',
  description: 'What moved, what is stuck, who owes what — before the meeting, not after it.',

  async run(ctx) {
    const g = await gather(ctx, ctx.days ?? 14);
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    // 1. What actually moved. "Nothing" is a finding, not an empty state.
    const moved = g.timeline.lanes
      .flatMap((l) => l.segments.filter((s) => s.from > dayAgo).map((s) => ({ key: l.key, s })))
      .map(({ key, s }) => `- **${key}** → ${s.status.replace('_', ' ')}`);

    // 2. What needs attention, in the same `byConcern` order every other
    //    consumer uses — an agent that ranks differently from the screen is
    //    worse than either.
    const concerns = [...g.timeline.lanes]
      .sort(byConcern)
      .slice(0, 5)
      .map((l) => {
        const now = l.segments.at(-1)?.status.replace('_', ' ') ?? 'unknown';
        const flow = l.flowEfficiency === null ? '' : ` · ${pct(l.flowEfficiency)} flow`;
        return `- **${l.key}** ${now} for ${days(l.ageDays)}${flow} — ${l.title ?? ''}`;
      });

    // 3. Anything blocked that nobody has written down. The graph knows which
    //    tickets have an impediment note hanging off them; this is the gap.
    const explained = new Set(
      g.graph.edges
        .filter((e) => e.kind === 'annotates')
        .filter((e) => g.notes.find((n) => n.id === e.from)?.kind === 'impediment')
        .map((e) => e.to),
    );
    const unexplained = g.timeline.lanes
      .filter((l) => l.segments.at(-1)?.status === 'blocked' && !explained.has(l.key))
      .map((l) => `- **${l.key}** has been blocked ${days(l.ageDays)} and nothing in the vault says why`);

    // 4. Promises still outstanding.
    const commitments = g.notes
      .filter((n) => n.kind === 'commitment' && n.status === 'open')
      .map((n) => {
        const stale = stalenessOf(n);
        const age = stale.stale ? ` _(unconfirmed ${days(stale.days)})_` : '';
        return `- [[${n.id}]] ${n.title}${age}`;
      });

    const brief = [
      `# Standup — ${new Date().toISOString().slice(0, 10)}`,
      '',
      ...section('Moved since yesterday', moved, '_Nothing moved in the last 24 hours._'),
      ...section('Needs attention', concerns),
      ...section('Blocked, unexplained', unexplained),
      ...section('Open commitments', commitments),
    ].join('\n');

    return { skill: 'standup', ranAt: new Date().toISOString(), brief, proposals: [] };
  },
};

// ---------------------------------------------------------------------------
// /tidy
// ---------------------------------------------------------------------------

/**
 * The vault-health pass. Every finding it can act on becomes a proposal rather
 * than a write — see the `Proposal` union for why an agent restructuring
 * several notes is gated where a human editing one is not.
 */
const tidy: Skill = {
  name: 'tidy',
  label: 'Tidy the vault',
  description: 'Find stale claims, finished commitments, orphans and repeats — and propose the fixes.',

  async run(ctx) {
    const g = await gather(ctx, ctx.days ?? 30);
    const proposals: Proposal[] = [];
    const staleLines: string[] = [];
    const outrunLines: string[] = [];
    const orphanLines: string[] = [];
    const repeatLines: string[] = [];

    const cite = (n: Note): Evidence[] => [
      { surface: 'vault', label: `[[${n.id}]] ${n.kind}: ${n.title}` },
      ...n.evidence,
    ];

    // 1. Dated claims nobody has confirmed. Decay already stopped the agent
    //    asserting these; this is the other half — actually going and checking.
    for (const n of g.notes.filter((x) => x.status !== 'archived')) {
      const s = stalenessOf(n);
      if (!s.stale) continue;
      staleLines.push(`- [[${n.id}]] ${n.title} — unverified ${days(s.days)}`);
      proposals.push(
        propose(
          'reverify_note',
          `"${n.title}" is a dated claim nobody has confirmed in ${days(s.days)}. Accepting says it is still true today; rejecting is your cue to resolve or rewrite it.`,
          cite(n),
          { noteId: n.id, title: `Re-verify: ${n.title}`, relatedKeys: n.relatedKeys },
          { dedupeKey: n.id },
        ),
      );
    }

    // 2. Commitments whose work has visibly moved on. The vault cannot see
    //    this by itself — it takes the timeline to know MC-105 reached review.
    const statusOf = new Map(g.items.map((i) => [i.key, i.status]));
    for (const n of g.notes.filter((x) => x.kind === 'commitment' && x.status === 'open')) {
      const landed = n.relatedKeys.filter((k) => {
        const s = statusOf.get(k);
        return s === 'in_review' || s === 'done';
      });
      if (!landed.length) continue;
      outrunLines.push(`- [[${n.id}]] ${n.title} — ${landed.join(', ')} has moved on`);
      proposals.push(
        propose(
          'resolve_note',
          `"${n.title}" is still open, but ${landed.join(' and ')} has reached ${landed
            .map((k) => statusOf.get(k))
            .join('/')}. Either the promise was kept and the note should say so, or the ticket moved without it.`,
          cite(n),
          {
            noteId: n.id,
            // `journalProposal` titles the journal entry from `payload.title`,
            // so without this a rejection files itself as "Rejected:
            // resolve_note" and tells you nothing six weeks later.
            title: n.title,
            relatedKeys: n.relatedKeys,
            outcome: `${landed.join(', ')} reached ${landed.map((k) => statusOf.get(k)).join('/')}.`,
          },
          { dedupeKey: n.id },
        ),
      );
    }

    // 3. Notes attached to nothing. Not proposable — deciding what an orphan
    //    is about is exactly the judgement a human has and we do not.
    for (const id of g.graph.orphans) {
      const n = g.notes.find((x) => x.id === id);
      if (n) orphanLines.push(`- [[${n.id}]] ${n.title} — no Jira key, no links, nothing points at it`);
    }

    // 4. Impediments of the same shape with no pattern between them. This is
    //    the vault's whole reason to exist, and until now nothing produced one.
    const loose = g.notes.filter(
      (n) => n.kind === 'impediment' && !n.links.some((id) => g.notes.find((x) => x.id === id)?.kind === 'pattern'),
    );
    const byTag = new Map<string, Note[]>();
    for (const n of loose) {
      for (const t of n.tags) byTag.set(t, [...(byTag.get(t) ?? []), n]);
    }
    for (const [tag, group] of byTag) {
      if (group.length < 2) continue;
      repeatLines.push(`- ${group.length} impediments tagged \`${tag}\` with no pattern linking them`);
      proposals.push(
        propose(
          'promote_to_pattern',
          `${group.length} impediments share the tag "${tag}" and none of them points at a pattern. If they are the same problem recurring, naming it is what lets the system say "third sprint running" instead of re-deriving each one.`,
          group.flatMap(cite),
          {
            noteIds: group.map((n) => n.id),
            title: `Recurring: ${tag.replace(/-/g, ' ')}`,
            body: `Noticed by a tidy pass — ${group.length} impediments tagged \`${tag}\`:\n\n${group
              .map((n) => `- [[${n.id}]] — ${n.title}`)
              .join('\n')}\n\nRewrite this with what actually keeps happening and what it costs.`,
          },
          { dedupeKey: tag },
        ),
      );
    }

    const total = proposals.length;
    const brief = [
      `# Vault tidy — ${new Date().toISOString().slice(0, 10)}`,
      '',
      `${g.notes.length} notes checked.`,
      '',
      ...section('Claims nobody has confirmed', staleLines),
      ...section('Commitments the work has outrun', outrunLines),
      ...section('Attached to nothing', orphanLines),
      ...section('Repeats with no pattern named', repeatLines),
      total
        ? `**${total} proposal${total === 1 ? '' : 's'} waiting below.** Rejecting one records why, which is worth as much as accepting it.`
        : 'Nothing to fix. Every dated claim is fresh, every commitment is either open for a reason or already closed, and nothing is floating loose.',
    ].join('\n');

    return { skill: 'tidy', ranAt: new Date().toISOString(), brief, proposals };
  },
};

// ---------------------------------------------------------------------------
// /plan
// ---------------------------------------------------------------------------

/**
 * Sprint planning, answered from the canvas rather than from the backlog.
 *
 * The one thing this says that a Jira board cannot: whether the plan as drawn
 * is schedulable at all. A circular dependency is invisible in a list and
 * obvious in a graph, and it makes every estimate underneath it meaningless.
 */
const plan: Skill = {
  name: 'plan',
  label: 'Plan check',
  description: 'Is this sprint schedulable as drawn — cycles, critical path, and what is unestimated.',

  async run(ctx) {
    const g = await gather(ctx, ctx.days ?? 14);
    // The *active* sprint, not "anything with a sprint set" — last sprint's
    // closed work would otherwise arrive as unestimated, unassigned and planned.
    const sprint = activeSprintOf(g.items);
    const inSprint = g.items.filter((i) => i.sprint === sprint);
    const points = inSprint.reduce((n, i) => n + (i.estimate ?? 0), 0);

    const cycles = g.graph.cycles.map(
      (c) => `- **${c.join(' → ')}** — cannot be scheduled as drawn; break one arrow`,
    );

    const path = g.graph.criticalPath;
    const critical = path?.path.length
      ? [`- **${path.path.join(' → ')}** · ${path.cost} points end to end`]
      : [];

    // Unestimated work inside a sprint is the quiet way a plan goes wrong —
    // the board looks full and the number underneath it is a fiction.
    const unestimated = inSprint
      .filter((i) => i.type !== 'epic' && !i.estimate)
      .map((i) => `- **${i.key}** ${i.title} — no estimate`);

    const unowned = inSprint
      .filter((i) => i.type !== 'epic' && !i.assignee)
      .map((i) => `- **${i.key}** ${i.title} — unassigned`);

    // Work carrying an open impediment is work you are planning to be blocked on.
    const impeded = g.notes
      .filter((n) => n.kind === 'impediment' && n.status === 'open')
      .flatMap((n) =>
        n.relatedKeys
          .filter((k) => inSprint.some((i) => i.key === k))
          .map((k) => `- **${k}** carries the open impediment [[${n.id}]] — ${n.title}`),
      );

    const brief = [
      `# Plan check — ${new Date().toISOString().slice(0, 10)}`,
      '',
      `${inSprint.length} items in a sprint, ${points} points, ${g.graph.edges.filter((e) => e.asserts === 'miro').length} arrows on the board.`,
      '',
      ...section(
        'Circular dependencies',
        cycles,
        cycles.length ? undefined : '_None. The board is schedulable as drawn._',
      ),
      ...section('Critical path', critical, g.graph.cycles.length ? '_Not computable while a cycle exists._' : undefined),
      ...section('Planned but blocked', [...new Set(impeded)]),
      ...section('Unestimated', unestimated),
      ...section('Unassigned', unowned),
    ].join('\n');

    return { skill: 'plan', ranAt: new Date().toISOString(), brief, proposals: [] };
  },
};

// ---------------------------------------------------------------------------
// /retro
// ---------------------------------------------------------------------------

/**
 * The retro document, written before the retro.
 *
 * Incident tooling has done this for years — assemble the timeline, draft the
 * postmortem, spend the meeting deciding rather than remembering. Nobody does
 * it for sprints, and we happen to hold all three inputs: what happened, what
 * we said would happen, and what has happened before.
 */
const retro: Skill = {
  name: 'retro',
  label: 'Retro pack',
  description: 'What actually happened this sprint: impediments, kept and broken promises, repeats, flow.',

  async run(ctx) {
    const windowDays = ctx.days ?? 14;
    const g = await gather(ctx, windowDays);
    const from = ctx.from ?? new Date(Date.now() - windowDays * 86_400_000).toISOString();

    const allImpediments = g.notes.filter((n) => n.kind === 'impediment');
    const opened = allImpediments.filter((n) => n.createdAt >= from);
    const cleared = opened.filter((n) => n.status === 'resolved');
    // An impediment older than the window and still open is the single most
    // retro-worthy thing there is — it survived a whole sprint. Counting only
    // what was *raised* in the window hides exactly that.
    const carried = allImpediments.filter((n) => n.createdAt < from && n.status === 'open');

    const impediments = [
      `- ${opened.length} raised this window, ${cleared.length} cleared`,
      ...opened.map((n) => `  - [[${n.id}]] ${n.title} — ${n.status}`),
      ...(carried.length
        ? [
            `- **${carried.length} carried in and still open** — these predate the window and outlived it`,
            ...carried.map(
              (n) => `  - [[${n.id}]] ${n.title} — open since ${n.createdAt.slice(0, 10)}`,
            ),
          ]
        : []),
    ];

    const commitments = g.notes.filter((n) => n.kind === 'commitment');
    const kept = commitments.filter((n) => n.status === 'resolved');
    const outstanding = commitments.filter((n) => n.status === 'open');
    const promises = [
      ...kept.map((n) => `- kept: [[${n.id}]] ${n.title}`),
      ...outstanding.map((n) => `- still open: [[${n.id}]] ${n.title}`),
    ];

    // The line no other tool can produce.
    const patterns = g.notes
      .filter((n) => n.kind === 'pattern')
      .map((n) => {
        const instances = g.notes.filter((x) => x.links.includes(n.id));
        return `- **[[${n.id}]]** ${n.title}${
          instances.length ? ` — ${instances.length} instance${instances.length === 1 ? '' : 's'} so far` : ''
        }`;
      });

    // Where the sprint's time actually went, worst first. Flow efficiency is
    // the number that reframes "we were slow" into "we spent it waiting".
    const flow = [...g.timeline.lanes]
      .filter((l) => l.flowEfficiency !== null)
      .sort((a, b) => (a.flowEfficiency ?? 1) - (b.flowEfficiency ?? 1))
      .slice(0, 5)
      .map(
        (l) =>
          `- **${l.key}** ${pct(l.flowEfficiency ?? 0)} — ${days(l.activeDays)} worked, ${days(
            l.waitingDays,
          )} waiting`,
      );

    const decisions = g.notes
      .filter((n) => n.kind === 'decision' && n.createdAt >= from)
      .map((n) => `- [[${n.id}]] ${n.title}`);

    const brief = [
      `# Retro pack — ${from.slice(0, 10)} to ${new Date().toISOString().slice(0, 10)}`,
      '',
      '_Assembled from the log, the board and the vault. Bring it to the retro so the hour goes on deciding, not remembering._',
      '',
      ...section('Impediments', impediments),
      ...section('Promises', promises),
      ...section('Patterns — things that keep happening', patterns),
      ...section('Where the time went', flow),
      ...section('Decisions recorded', decisions),
    ].join('\n');

    return { skill: 'retro', ranAt: new Date().toISOString(), brief, proposals: [] };
  },
};

// ---------------------------------------------------------------------------
// /workshop — the meeting and the board it was drawn on, reconciled
// ---------------------------------------------------------------------------

/**
 * A workshop happens in two places at once. People talk, and people write on a
 * board, and the two records overlap without agreeing: the same action is said
 * aloud in one sentence and written on a sticky in four different words, while
 * a third of what mattered exists in only one of them.
 *
 * The reconciliation below is the whole reason this skill is not just "read the
 * transcript". Union the two naively and every action that was both said and
 * written arrives twice — and a queue that shows you the same decision twice is
 * a queue people stop reading, which costs more than the feature is worth.
 *
 * The cues are the same regexes `propose_tickets_from_transcript` uses. Two
 * entry points into "what did this meeting ask for" that disagreed about the
 * answer would be worse than either.
 */
const ACTION_CUE = /\b(will|needs to|owns|can you|take|action|todo|follow up)\b/i;
const DECISION_CUE = /\b(decision|we decided|agreed|let us|let's|we'll go with)\b/i;

/**
 * Sentences shorter than this are dropped before the cues run. "Agreed." and
 * "Fine." match `DECISION_CUE` and carry nothing; "Dana owns the cache." is 20
 * characters and is the entire action item. The floor sits between them.
 */
const MIN_CLAIM_CHARS = 16;

/** A frame whose title says the team meant these stickies as work. */
const ACTION_FRAME = /\b(action|next step|todo|to.?do|follow.?up)/i;

/** Title overlap at which a keyless sticky is worth naming an artefact for. */
const ARTEFACT_MATCH = 0.5;

/** …and the words they must actually share to get there. See `likelyArtefact`. */
const MIN_SHARED_WORDS = 2;

const STOP = new Set(
  ('a an the and or but if then so as of to in on at for from with by is are was were be been ' +
    'it its this that these those we us our you your i he she they them there here do does did ' +
    'have has had can could will would should more one thing still just about out up not no yes')
    .split(' '),
);

/**
 * Bag of significant words. Trailing `s` is stripped so "owns" and "own" are
 * the same claim — the crudest possible stemming, and enough, because the texts
 * being compared are one sentence long and written minutes apart by people in
 * the same room.
 */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w)),
  );
}

/**
 * Overlap coefficient rather than Jaccard: a sticky is four words and the
 * sentence it echoes is fifteen, and Jaccard punishes that difference as though
 * it were disagreement. Dividing by the *smaller* set asks the right question —
 * is the short one contained in the long one.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/**
 * The thresholds are deliberately high, and the asymmetry is the point: a false
 * merge silently loses an action item, and a false split shows a human two
 * similar proposals they can reject in one click. Bias to splitting.
 *
 * A shared Jira key lowers the bar but never clears it alone — two actions
 * about MC-102 in the same meeting are the ordinary case, not a duplicate.
 */
function sameAction(a: ActionCandidate, b: ActionCandidate): boolean {
  const sharedKey = a.keys.some((k) => b.keys.includes(k));
  return similarity(a.tokens, b.tokens) >= (sharedKey ? 0.4 : 0.6);
}

/**
 * The artefact a keyless sticky is probably already about.
 *
 * "Attached to no ticket" is true and useless: it says the sticky carries no
 * key, not that the work has no home. Half a parking lot is routinely a
 * re-litigation of something that already has a ticket in the backlog or a page
 * in Confluence — nobody wrote `MC-104` on a sticky note in a workshop, so the
 * join key never fires and the team argues it out again from nothing.
 *
 * Matched on title overlap alone, which is exactly as weak as it sounds. That
 * is why this only ever reaches prose, hedged with "probably":
 *
 *   - it does **not** enrich `relatedKeys` on the action proposals. A guess
 *     that lands in the pack costs a glance; the same guess written onto a real
 *     Jira issue is a wrong link somebody has to find and undo.
 *   - it names one candidate, the best, never a list. Three maybes is the
 *     reader doing the matching again by hand.
 *
 * Threshold is below `sameAction`'s because the stakes are lower and the texts
 * are shorter — a sticky is four words and a ticket title is three, with no
 * shared sentence to lean on. That makes the ratio alone a bad guard, since
 * two short texts hit 0.5 on a single word in common: "Payment stuff" scores
 * exactly 0.5 against both MC-100 and a Confluence page, and picking either is
 * a coin toss. Hence the floor on *shared words* — one is a coincidence, two is
 * a topic — which also subsumes the one-word sticky that is contained in
 * everything and would otherwise match at 1.0.
 */
interface Artefact {
  label: string;
  where: string;
}

function likelyArtefact(sticky: CanvasSticky, g: Gathered): Artefact | undefined {
  const t = tokens(sticky.text);

  // Score against the title only — the key prefix is noise, and a page's body
  // would swamp a four-word sticky with vocabulary it never used.
  //
  // Tickets before pages, because `>` below keeps the first of a tie: a ticket
  // is the thing somebody can pick up, and a page about it is downstream of it.
  const candidates: (Artefact & { title: string })[] = [
    ...g.items.map((i) => ({ title: i.title, label: `${i.key} "${i.title}"`, where: i.status.replace('_', ' ') })),
    ...g.pages.map((p) => ({ title: p.title, label: `"${p.title}"`, where: 'Confluence' })),
  ];

  let best: Artefact | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    const title = tokens(c.title);
    let shared = 0;
    for (const w of t) if (title.has(w)) shared++;
    if (shared < MIN_SHARED_WORDS) continue;

    const score = similarity(t, title);
    if (score > bestScore) {
      best = { label: c.label, where: c.where };
      bestScore = score;
    }
  }
  return bestScore >= ARTEFACT_MATCH ? best : undefined;
}

interface ActionCandidate {
  text: string;
  tokens: Set<string>;
  keys: WorkItemKey[];
  evidence: Evidence[];
  /** Which records asked for this. Both is the interesting case. */
  said: boolean;
  written: boolean;
  /**
   * A model read this out of the recording; no cue matched it. Tracked
   * separately from `said` because it is weaker evidence — the sentence is
   * real, the reading of it as an action is the model's.
   */
  inferred: boolean;
  /**
   * The precision gate — `DIRECTION.md` §5 — carried through reconciliation.
   *
   * Only the model path can supply these: a cue regex matches a phrase, it does
   * not read who took the work or when they said they would do it. So a
   * cue-matched action that merges with an extracted one INHERITS them, which
   * is the case that matters — the strongest promise in the corpus is usually
   * both said aloud and caught by a cue.
   */
  owner?: string;
  dueAt?: string;
  /**
   * The model's own phrasing, kept beside the reconciled `text`.
   *
   * `text` is right for the ticket: a sticky is a human writing a title, and
   * `reconcile` prefers it. It is wrong for the commitment NOTE, whose title
   * becomes the alert's claim months later, read by somebody who was not in the
   * room. The first run wrote *"Sanjay owns it — his team said the twelfth of
   * August at the latest."* — a cue-matched fragment of speech — where the
   * model had written *"Sanjay gets the replay topic on his team's board, due
   * August 12"*, which is a promise you can act on.
   *
   * Only ever set on the path that also supplied the gate, so it is exactly the
   * reading that understood this as a trackable commitment.
   */
  promiseText?: string;
}

/**
 * A meeting ROOM is not a person, and nothing upstream can tell the difference.
 *
 * When somebody speaks from a shared room, Zoom attributes the line to the room
 * — so the summary says "MERIDIAN to post the pen testing requirements", and the
 * extractor faithfully reports an owner called MERIDIAN. Measured on this corpus:
 * of 22 commitments, four were owned by a room, one read `Riya (Meridian)` and
 * one read `MERIDIAN / Dana / Sam`.
 *
 * That matters because of what the owner is FOR. `DIRECTION.md` §5 gates the
 * flagship alert on a *named* owner precisely so it never fires on "someone
 * should look at that" — and a room is that, wearing a name. An alert saying
 * "Taken by MERIDIAN" is worse than no alert: nobody is MERIDIAN, so nobody
 * picks it up, and the reader learns the list names people who do not exist.
 *
 * So a room is stripped, never mapped to a guess:
 *
 *   `Riya (Meridian)`       → `Riya`       the room is where they sat
 *   `MERIDIAN / Dana / Sam` → `Dana / Sam` two named people, and a room
 *   `MERIDIAN`              → nothing      fails the gate, correctly
 *
 * `MC_MEETING_ROOMS` is a comma-separated list because rooms are per-office and
 * a hardcoded one is wrong everywhere else. Read at call time, not at import.
 */
function meetingRooms(): string[] {
  return (process.env.MC_MEETING_ROOMS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function namedOwner(raw: string | undefined): string | undefined {
  const rooms = meetingRooms();
  if (!raw?.trim()) return undefined;
  if (!rooms.length) return raw.trim();

  const isRoom = (s: string): boolean => rooms.includes(s.trim().toLowerCase());

  const people = raw
    .split(/\s*(?:,|\/|&|\band\b)\s*/)
    .map((part) => part.trim())
    // `Riya (Meridian)` — a trailing parenthetical naming a room is a location,
    // not a second owner. Anything else in brackets is left alone.
    .map((part) => part.replace(/\s*\(([^)]*)\)\s*$/, (m, inner: string) => (isRoom(inner) ? '' : m)).trim())
    .filter((part) => part && !isRoom(part));

  return people.length ? people.join(' / ') : undefined;
}

function candidate(
  text: string,
  evidence: Evidence[],
  from: 'zoom' | 'miro' | 'model',
  gate?: { owner?: string; dueAt?: string },
): ActionCandidate {
  return {
    text,
    tokens: tokens(text),
    keys: extractKeys(text),
    evidence,
    said: from === 'zoom',
    written: from === 'miro',
    inferred: from === 'model',
    ...(gate?.owner ? { owner: gate.owner } : {}),
    ...(gate?.dueAt ? { dueAt: gate.dueAt } : {}),
    ...(from === 'model' ? { promiseText: text } : {}),
  };
}

/**
 * How much of this the human should look at first, 0..1.
 *
 * Corroboration, not correctness — see `Proposal.confidence`. Said *and*
 * written is the strong case: two records, made minutes apart, agreed. A sticky
 * on a frame the team labelled "Actions" outranks a spoken sentence because
 * somebody chose to write it down. An inference nobody corroborated sits at the
 * bottom, which is where `/api/proposals` sorts it. Ranking only — nothing
 * gates on this.
 */
function confidenceOf(a: ActionCandidate, alreadyTracked: boolean): number {
  const base = a.said && a.written ? 0.9 : a.written ? 0.7 : a.said ? 0.5 : 0.35;
  // Already in the vault: the promise is not being lost, so this is a question
  // about whether it deserves a ticket, which is less urgent than the rest.
  return Math.round((alreadyTracked ? base - 0.1 : base) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The meeting, and the board it was drawn on
// ---------------------------------------------------------------------------

/** `/workshop zoom-001 board=uXjVKabc=` — an id, and optional `key=value`. */
function parseWorkshopArg(arg?: string): { transcriptId?: string; board?: string } {
  const out: { transcriptId?: string; board?: string } = {};
  for (const tok of (arg ?? '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^board=(.+)$/i.exec(tok);
    if (m) out.board = m[1];
    else if (!out.transcriptId) out.transcriptId = tok;
  }
  return out;
}


/**
 * A stable id for a promise, so re-running a workshop finds its own note.
 *
 * Keyed on the meeting AND the wording, because one meeting produces several
 * promises and the same promise made in two meetings is genuinely two records
 * of it. Slugged from the text rather than counted, so adding a sticky — which
 * re-runs the ceremony and can reorder the actions — does not renumber every
 * note written by the previous run and orphan all of them.
 */
function commitmentIdFor(transcriptId: string, text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return `promise-${transcriptId}-${slug}`.slice(0, 90);
}

/** The brief note a workshop run keeps, so a re-run finds its own last pass. */
function briefIdFor(transcriptId: string): string {
  return slugify(`workshop-${transcriptId}`);
}

/** How a board id is written into the brief's evidence, and read back out. */
const BOARD_EVIDENCE = /^board (\S+)$/;

/**
 * Which board this meeting was drawn on.
 *
 * There is no `Meeting` entity to hang this on, and inventing one for a single
 * field would be worse than what this does: the pairing is *recorded* the first
 * time somebody states it, as evidence on the meeting's own brief note, and
 * recovered from there afterwards. So `/workshop zoom-003 board=xyz` once is
 * enough, and every later `/workshop zoom-003` finds the same board.
 *
 * The env var stays the last resort rather than the default it used to be —
 * one process-wide board is exactly the assumption that makes every retro look
 * like it was drawn on the same canvas.
 */
function resolveBoard(ctx: SkillContext, transcriptId: string, explicit?: string): string {
  if (explicit) return explicit;
  const prior = ctx.vault.get(briefIdFor(transcriptId));
  for (const e of prior?.evidence ?? []) {
    const m = e.surface === 'miro' ? BOARD_EVIDENCE.exec(e.label) : null;
    if (m?.[1]) return m[1];
  }
  return process.env.MIRO_BOARD_ID ?? 'demo-board';
}

// ---------------------------------------------------------------------------
// Model extraction, cached so a ceremony stays reproducible
// ---------------------------------------------------------------------------

/**
 * A skill that renders differently every morning is worthless, and a model call
 * renders differently every morning. The cache is what keeps both: the model is
 * asked once per recording, and every later run of the same meeting replays the
 * same answer, so re-running `/workshop` after adding a sticky changes only the
 * thing that actually changed.
 *
 * Keyed on the transcript's *content*, not its id, so a corrected recording is
 * a different question. Written next to the event log, which is already
 * gitignored and already the home for machine-generated state.
 */
const EXTRACT_CACHE = join(VAULT_DIR, 'raw', 'extraction-cache.json');

function transcriptFingerprint(t: Transcript): string {
  const body = t.segments.map((s) => `${s.start}|${s.speaker}|${s.text}`).join('\n');
  return `${t.id}:${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
}

async function cachedActions(ctx: SkillContext, t: Transcript): Promise<ExtractedAction[]> {
  if (!ctx.extract) return [];
  const key = transcriptFingerprint(t);

  let cache: Record<string, ExtractedAction[]> = {};
  try {
    cache = JSON.parse(await readFile(EXTRACT_CACHE, 'utf8')) as Record<string, ExtractedAction[]>;
  } catch {
    // No cache yet, or an unreadable one. Either way, ask.
  }
  const hit = cache[key];
  if (hit) return hit;

  let found: ExtractedAction[] = [];
  try {
    found = await ctx.extract.actions(t);
  } catch {
    // Fails closed, like recall: the deterministic pass is the product, and a
    // model that is down or rate-limited must cost us cue-matched actions only.
    return [];
  }

  try {
    await mkdir(dirname(EXTRACT_CACHE), { recursive: true });
    await writeFile(EXTRACT_CACHE, JSON.stringify({ ...cache, [key]: found }, null, 2));
  } catch {
    // An uncacheable answer is still an answer; it just costs a call next time.
  }
  return found;
}

// ---------------------------------------------------------------------------
// Confluence, read for content rather than for keys
// ---------------------------------------------------------------------------

/**
 * How much of a decision's wording has to appear in a page before we will say
 * the page records it. High, because the alternative — claiming a decision is
 * written down when it is not — talks a team out of writing the record they
 * needed, which is the one outcome worse than saying nothing.
 */
const DECISION_IN_PAGE = 0.7;

/**
 * The page that appears to actually contain this decision, not merely to
 * mention its ticket.
 *
 * `documented` in the graph joins on the Jira key, which can only ever say
 * "a page touches MC-102". That is a different claim from "the decision just
 * made is in it", and the pack used to blur them. This checks the words.
 *
 * Still lexical, so still wrong sometimes — it cannot see a decision restated
 * in different vocabulary. That failure is one-directional and safe: it says
 * "not recorded" about something that was, and a human writes a page that
 * already existed. The reverse would be the expensive one.
 */
function pageRecording(text: string, pages: ConfluencePage[]): ConfluencePage | undefined {
  const claim = tokens(text);
  if (claim.size < 3) return undefined;
  let best: ConfluencePage | undefined;
  let bestScore = 0;
  for (const p of pages) {
    const body = tokens(`${p.title} ${stripHtml(p.html)}`);
    let shared = 0;
    for (const w of claim) if (body.has(w)) shared++;
    const score = shared / claim.size;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return bestScore >= DECISION_IN_PAGE ? best : undefined;
}

/** Split a spoken segment into sentences. One segment routinely holds two asks. */
function sentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_CLAIM_CHARS);
}

/** Fold candidates into clusters, merging any that describe the same ask. */
function reconcile(candidates: ActionCandidate[]): ActionCandidate[] {
  const clusters: ActionCandidate[] = [];
  for (const c of candidates) {
    const hit = clusters.find((x) => sameAction(x, c));
    if (!hit) {
      clusters.push({ ...c, keys: [...c.keys], evidence: [...c.evidence] });
      continue;
    }
    // A sticky is a human writing a title. A transcript sentence is a human
    // talking. Prefer the sticky's wording for the ticket, keep every citation.
    if (c.written && !hit.written) hit.text = c.text;
    hit.tokens = new Set([...hit.tokens, ...c.tokens]);
    hit.keys = [...new Set([...hit.keys, ...c.keys])];
    hit.evidence.push(...c.evidence);
    hit.said ||= c.said;
    hit.written ||= c.written;
    hit.inferred ||= c.inferred;
    /**
     * First one wins, and only the model path ever sets them.
     *
     * `??=` rather than overwrite: two clusters carrying different owners means
     * the reconciliation was wrong about them being the same action, and
     * silently taking the second is how a promise gets attributed to whoever
     * happened to be mentioned last.
     */
    hit.owner ??= c.owner;
    hit.dueAt ??= c.dueAt;
    hit.promiseText ??= c.promiseText;
  }
  return clusters;
}

const workshop: Skill = {
  name: 'workshop',
  label: 'Workshop pack',
  description:
    'Reconcile a meeting recording with the board it was drawn on — decisions, next steps, and what only one of them knows.',

  async run(ctx) {
    const { transcriptId, board: explicitBoard } = parseWorkshopArg(ctx.arg);

    // No argument means the meeting that just finished, which is when somebody
    // actually runs this.
    let transcript: Transcript | undefined;
    if (transcriptId) {
      transcript = await ctx.connectors.zoom.getTranscript(transcriptId);
      if (!transcript) {
        return {
          skill: 'workshop',
          ranAt: new Date().toISOString(),
          brief: `No transcript called \`${transcriptId}\`. Run \`/workshop\` with no argument for the most recent one.`,
          proposals: [],
        };
      }
    } else {
      const [latest] = [...(await ctx.connectors.zoom.listTranscripts())].sort((a, b) =>
        b.startedAt.localeCompare(a.startedAt),
      );
      transcript = latest ? await ctx.connectors.zoom.getTranscript(latest.id) : undefined;
    }

    // The board comes from the meeting, not from the process. Resolved before
    // anything reads stickies, because reading the wrong board is not a missing
    // join — it is a false one, and a sticky from another retro merging with a
    // sentence from this one would be stamped "said and written".
    const boardId = transcript
      ? resolveBoard(ctx, transcript.id, explicitBoard)
      : (explicitBoard ?? process.env.MIRO_BOARD_ID ?? 'demo-board');

    const [g, stickies] = await Promise.all([
      gather(ctx, ctx.days ?? 14),
      ctx.connectors.miro.listStickies(boardId),
    ]);

    if (!transcript) {
      return {
        skill: 'workshop',
        ranAt: new Date().toISOString(),
        brief: `# Workshop\n\nNo recording to read. ${stickies.length} stickies are on \`${boardId}\`, but a workshop pack is the *join* — without the transcript this is just the board, which you are already looking at.`,
        proposals: [],
        boardId,
      };
    }

    const t = transcript;
    const proposals: Proposal[] = [];

    // ---- 1. what was said ---------------------------------------------------
    const spokenActions: ActionCandidate[] = [];
    const decisions: { text: string; at: number; keys: WorkItemKey[] }[] = [];

    for (const seg of t.segments) {
      for (const line of sentences(seg.text)) {
        const cite: Evidence[] = [
          zoomEvidence(t, { speaker: seg.speaker, at: seg.start, quote: line }),
        ];
        // Action wins when both cues fire, and the sentence that forced this is
        // "Riya, can you take the decision record in Confluence?" — an action
        // item that contains the *word* decision. Classified the other way it
        // vanished from the next steps and reappeared as a decision nobody
        // made. A decision cue is often a noun inside somebody's task; an
        // action cue is a verb about who does what.
        //
        // A question is never a decision. It can still be an action.
        if (ACTION_CUE.test(line)) spokenActions.push(candidate(line, cite, 'zoom'));
        else if (DECISION_CUE.test(line) && !line.endsWith('?')) {
          decisions.push({ text: line, at: seg.start, keys: extractKeys(line) });
        }
      }
    }

    // ---- 2. what was written ------------------------------------------------
    // Only stickies the team themselves filed under actions become proposals.
    // Everything else on the board is context: a "went badly" sticky is not a
    // ticket, and guessing that it is would fill Jira with somebody's feelings.
    const actionStickies = stickies.filter((s) => ACTION_FRAME.test(s.frameTitle ?? ''));
    const writtenActions = actionStickies.map((s) =>
      candidate(s.text, [{ surface: 'miro', label: `board sticky — ${s.frameTitle ?? 'unframed'}`, quote: s.text }], 'miro'),
    );

    // ---- 2b. what a model heard that the cues did not -----------------------
    // Empty without an extractor, which is the ordinary mock case. Fed through
    // the SAME reconcile() as the other two rather than appended: a model that
    // rephrases a sentence the cues already caught must merge with it, or the
    // pack doubles every action it was supposed to improve.
    const inferredActions = (await cachedActions(ctx, t)).map((a) =>
      candidate(
        a.text,
        [
          zoomEvidence(t, {
            speaker: a.speaker,
            at: a.at,
            quote: a.text,
            suffix: ' (read by the model)',
          }),
        ],
        'model',
        // The precision gate rides along. Only this path can supply it — a cue
        // regex matches a phrase, it does not read who took the work.
        { owner: a.owner, dueAt: a.dueAt },
      ),
    );

    const actions = reconcile([...spokenActions, ...writtenActions, ...inferredActions]);

    // ---- 3. the pack --------------------------------------------------------
    const provenance = (a: ActionCandidate): string =>
      a.said && a.written
        ? 'said and written'
        : a.written
          ? 'board only'
          : a.said
            ? 'said only'
            : 'read from the recording — no cue, no sticky';

    /**
     * The action may already be in the vault as a commitment — somebody made
     * the same promise last week and it was written down. Proposing a fresh
     * ticket without saying so is how you end up with a ticket and a note that
     * do not know about each other, which is the exact failure the join key
     * exists to prevent.
     */
    const tracking = (a: ActionCandidate): Note | undefined =>
      g.notes.find((n) => n.status === 'open' && similarity(tokens(n.title), a.tokens) >= 0.5);

    const nextSteps = actions.map((a) => {
      const keys = a.keys.length ? ` · ${a.keys.join(', ')}` : '';
      const known = tracking(a);
      const already = known ? ` — the vault already tracks this as [[${known.id}]]` : '';
      return `- **${a.text.replace(/\s+/g, ' ')}** _(${provenance(a)}${keys})_${already}`;
    });

    const documented = new Map<WorkItemKey, string[]>();
    for (const e of g.graph.edges.filter((x) => x.kind === 'documents')) {
      documented.set(e.to, [...(documented.get(e.to) ?? []), e.from]);
    }
    const pageTitles = new Map(g.graph.nodes.filter((n) => n.kind === 'doc').map((n) => [n.id, n.label]));

    // Two different questions, asked in order, because they have two different
    // answers and the pack used to blur them:
    //
    //   1. does a page CONTAIN this decision (checked against the words), and
    //   2. failing that, does a page merely touch the ticket (the key join).
    //
    // (2) alone is what the pack said before, and "MC-102 already has ADR-014"
    // reads as "this is written down" when all it means is that a page mentions
    // that ticket. Claiming the stronger version is how a pack talks a team out
    // of writing the decision record it needed.
    const decisionLines = decisions.map((d) => {
      const records = pageRecording(d.text, g.pages);
      const pages = [...new Set(d.keys.flatMap((k) => documented.get(k) ?? []))]
        .map((id) => pageTitles.get(id))
        .filter(Boolean);

      const where = records
        ? ` — **already recorded** in "${records.title}"`
        : !d.keys.length
          ? ' — _names no ticket, so only the wording could be checked, and nothing matches it_'
          : pages.length
            ? ` — ${d.keys.join(', ')} has ${pages.join(', ')}, but nothing in it reads like this decision; **write it down**`
            : ` — **no Confluence page touches ${d.keys.join(', ')}**`;
      return `- "${d.text.replace(/\s+/g, ' ')}" _(${d.at}s)_${where}`;
    });

    // Stickies that are not actions, grouped the way the team grouped them.
    const byFrame = new Map<string, CanvasSticky[]>();
    for (const s of stickies.filter((x) => !ACTION_FRAME.test(x.frameTitle ?? ''))) {
      const frame = s.frameTitle ?? 'Unframed';
      byFrame.set(frame, [...(byFrame.get(frame) ?? []), s]);
    }
    const unlinked = (s: CanvasSticky): string => {
      const guess = likelyArtefact(s, g);
      return guess
        ? ` _(no key on the sticky — probably ${guess.label}, ${guess.where})_`
        : ' _(attached to no ticket)_';
    };
    const boardLines = [...byFrame.entries()].flatMap(([frame, group]) => [
      `- **${frame}**`,
      ...group.map((s) => `  - ${s.text}${s.mentions.length ? ` · ${s.mentions.join(', ')}` : unlinked(s)}`),
    ]);

    // What the vault already knows about what was discussed. This is the line
    // no other tool in the room can produce — the board and the recording both
    // start from nothing every meeting.
    const discussed = [
      ...new Set([...t.segments.flatMap((s) => s.mentions), ...stickies.flatMap((s) => s.mentions)]),
    ];
    const known = g.notes
      .filter((n) => n.status !== 'archived' && n.relatedKeys.some((k) => discussed.includes(k)))
      .map((n) => {
        const s = stalenessOf(n);
        const age = s.stale ? ` _(unconfirmed ${days(s.days)} — check before quoting it)_` : '';
        return `- [[${n.id}]] ${n.kind}: ${n.title} · ${n.relatedKeys.join(', ')}${age}`;
      });

    const cycles = g.graph.cycles.map((c) => `- **${c.join(' → ')}** — cannot be scheduled as drawn`);
    const path = g.graph.criticalPath;
    const drawn = [
      `- ${g.graph.edges.filter((e) => e.asserts === 'miro').length} arrows, ${stickies.length} stickies across ${
        new Set(stickies.map((s) => s.frameTitle ?? 'unframed')).size
      } frames`,
      ...cycles,
      ...(path?.path.length ? [`- critical path **${path.path.join(' → ')}** · ${path.cost} points`] : []),
    ];

    // ---- 4b. the promise becomes a commitment note ---------------------------
    /**
     * D1 — THE CHANGE EVERYTHING ELSE RESTS ON. `DIRECTION.md` §5:
     *
     * > Today a commitment note is only ever written *when a ticket is
     * > created* … Every commitment note in `vault/notes/` therefore has keys,
     * > and the state we need to detect is unreachable. Record the promise when
     * > it is made, whether or not anyone files anything.
     *
     * The flagship finding is a promise with **no** `relatedKeys` after its
     * container closed. Until now the only writer was `accept_proposal`, which
     * stamps the new key in as it goes — so a live system could never produce
     * one, the detector would find nothing, and the fixture hid it by
     * generating claims directly. This is the writer that makes live mode
     * behave like the fixture.
     *
     * THE GATE IS THE FEATURE. Owner **and** date, or no note. `DIRECTION.md`
     * §5: "a promise with both and no ticket is unambiguously trackable;
     * 'someone should look at that' is not. This is the rule that keeps the
     * alert believable." An ungated version nags about everything said aloud
     * and gets muted in a week.
     *
     * It writes nothing outward, needs no proposal and takes no human gate — a
     * vault note is our own memory, it is what `/tidy` already audits, and the
     * alert it eventually raises is still just a row somebody can dismiss.
     */
    const commitmentNotes: Note[] = [];
    /**
     * WHICH sprint should check this promise: the one that was running when it
     * was made, not the one running now.
     *
     * `activeSprintOf` was the first answer and it is wrong in the case that
     * matters. A promise made in Sprint 12 planning must be checked when Sprint
     * 12 closes; stamped with today's sprint it waits for a closing two months
     * late, and on a re-run of an old transcript it never fires at all.
     *
     * The id, not the label. `findMissingTickets` resolves `note.container`
     * against the graph's node ids (`sprint:PAY Sprint 12`), so a bare name
     * writes a note whose trigger silently does not exist.
     */
    const promisedAt = Date.parse(t.startedAt);
    const container = (ctx.containers ?? []).find(
      (c) =>
        c.startsAt &&
        c.endsAt &&
        Date.parse(c.startsAt) <= promisedAt &&
        promisedAt <= Date.parse(c.endsAt),
    );
    const containerId = container?.id;
    const containerLabel = container?.label ?? activeSprintOf(g.items);
    for (const a of actions) {
      /**
       * THE PRECISION GATE, with the date allowed to come from the sprint.
       *
       * `DIRECTION.md` §5 requires a named owner and a date, because a promise
       * with both is unambiguously trackable and "someone should look at that"
       * is not. The owner half is never inferred — nobody but the room can say
       * who took it.
       *
       * The date half is different, and measured: across thirty real ceremonies
       * the model found an owner on 16 of 16 extracted actions and a spoken due
       * date on **none**. Teams say "Riya will confirm with DevOps", not "by
       * the twelfth". Requiring a spoken date therefore did not make the alert
       * precise, it made it silent — which is the failure mode this whole repo
       * is written against.
       *
       * So a promise made *inside a sprint* inherits that sprint's end. That is
       * not inventing a deadline: the sprint's close is a real, checkable date
       * the team already committed to, and it is **the same moment the finding
       * fires on** — `findMissingTickets` triggers when the container closes.
       * The inherited date says "this was due by the time that sprint ended",
       * which is exactly what everybody in the room understood.
       *
       * NO CONTAINER, NO INHERITANCE. A promise outside any sprint still needs
       * a spoken date, because there is no close to hang it on — the gate holds
       * where it has nothing to stand on.
       */
      const dueAt = a.dueAt ?? container?.endsAt;
      const dueFromSprint = !a.dueAt && !!dueAt;
      // A room is not a person — see `namedOwner`. Resolved BEFORE the gate, so
      // "MERIDIAN to post the requirements" fails it exactly as "someone should
      // look at that" does.
      const owner = namedOwner(a.owner);
      if (!owner || !dueAt) continue;
      // Already tracked by a note, or already a ticket — either way the promise
      // is not floating loose and this would be a duplicate of it.
      if (tracking(a) || a.keys.length) continue;

      /**
       * Derived from the meeting and the promise, so a re-run finds its own
       * note instead of writing a second one. `/workshop` is re-run the moment
       * somebody moves a sticky, and `vault.create` refuses an id that exists —
       * which is the check, not a race to be avoided.
       */
      /**
       * The model's phrasing where there is one — see `promiseText`. This is
       * the sentence a person reads on an alert weeks later, so it has to stand
       * on its own rather than be a clause lifted out of a conversation.
       */
      const promise = (a.promiseText ?? a.text).replace(/\s+/g, ' ');
      const id = commitmentIdFor(t.id, promise);
      if (ctx.vault.get(id)) continue;

      try {
        const note = await ctx.vault.create({
          id,
          kind: 'commitment',
          title: promise.slice(0, 120),
          // A claim about a moment, so `stalenessOf` ages it — and the age is
          // exactly what makes the eventual alert worth raising.
          recency: 'dated',
          status: 'open',
          /**
           * EMPTY, and that is the entire point. `relatedKeys` is the tick on
           * the checklist; a promise nobody filed has none, and this is the
           * only writer in the system that produces that state.
           */
          relatedKeys: [],
          owner,
          dueAt,
          // Which closing should check it — `findMissingTickets` fires when the
          // container closes, and without this it has no moment to fire at.
          ...(containerId ? { container: containerId } : {}),
          // The tag is the provenance of the DATE, and the alert reads it: a
          // date nobody said must never be quoted back as one somebody did.
          tags: ['workshop', 'promised', ...(dueFromSprint ? ['due-from-sprint'] : [])],
          evidence: a.evidence,
          body:
            `${promise}\n\n` +
            `Promised in ${t.meetingTopic} on ${t.startedAt.slice(0, 10)}. ` +
            (dueFromSprint
              ? `${owner} took it. No date was given, so it is checked against ` +
                `${containerLabel ?? 'the sprint'}'s close on ${dueAt.slice(0, 10)}. `
              : `${owner} took it, due ${dueAt.slice(0, 10)}. `) +
            `Nothing in the tracker references it yet — this note is what will notice ` +
            `if that is still true when ${containerLabel ?? 'the sprint'} closes.`,
        });
        commitmentNotes.push(note);
        emitVaultEvent('note.created', note, {
          from: 'skill',
          skill: 'workshop',
          promisedIn: t.id,
        });
      } catch {
        // Same reasoning as the pack note: `assertVaultSafe` can legitimately
        // reject a body built from somebody's spoken words, and losing one
        // commitment is survivable where losing the ceremony is not.
      }
    }

    const pack = [
      `# Workshop — ${t.meetingTopic}`,
      '',
      `_${t.id} · ${t.startedAt.slice(0, 10)} · ${t.participants.join(', ')} · board \`${boardId}\`_`,
      '',
      ...section('The plan as drawn', drawn),
      ...section('Decisions', decisionLines, '_Nothing in the recording reads as a decision._'),
      ...section('Next steps', nextSteps, '_No action items in either record._'),
      ...section('Raised on the board', boardLines),
      ...section('What the vault already knows', known),
      // What this run WROTE, as against what it read. A ceremony that quietly
      // changes the vault and does not say so is one nobody trusts twice.
      ...section(
        'Promises now tracked',
        commitmentNotes.map(
          (n) => `- [[${n.id}]] **${n.title}** — ${n.owner}, due ${n.dueAt}${
            containerLabel ? `, checked when ${containerLabel} closes` : ''
          }`,
        ),
      ),
    ].join('\n');

    // ---- 4. the pack becomes a note ------------------------------------------
    // This is what turns the ratchet. Proposing the text straight from here
    // publishes exactly what the skill assembled and nothing a human thought
    // about it, and leaves the vault knowing nothing about the meeting once the
    // proposal is settled — so the next ceremony starts from the same blank
    // slate as this one.
    //
    // NEVER overwritten. A re-run re-renders the brief in the transcript (which
    // is always current), but the note is somebody's working copy and clobbering
    // an edited pack because a sticky moved is unforgivable. Delete it to get a
    // fresh one.
    const packEvidence: Evidence[] = [
      zoomEvidence(t, { suffix: ' — full recording' }),
      // Also the board pairing, which `resolveBoard` reads back on the next run.
      { surface: 'miro', label: `board ${boardId}` },
    ];
    const packId = briefIdFor(t.id);
    let packNote = ctx.vault.get(packId);
    let packNoteError: string | undefined;
    if (!packNote) {
      try {
        packNote = await ctx.vault.create({
          id: packId,
          kind: 'brief',
          title: `Workshop — ${t.meetingTopic}`,
          // A pack asserts nothing of its own; every claim in it belongs to the
          // note, ticket or recording it was assembled from.
          recency: 'pointer',
          status: 'open',
          relatedKeys: discussed,
          tags: ['workshop'],
          evidence: packEvidence,
          body: pack,
        });
        emitVaultEvent('note.created', packNote, { from: 'skill', skill: 'workshop', boardId });
      } catch (err) {
        // `assertVaultSafe` rejects a body with a line like `status: blocked` at
        // its head — which a quoted sticky can genuinely contain. Losing the
        // note is survivable; losing the ceremony is not, so fall back to the
        // old inline publish and say so rather than throwing out of the skill.
        packNoteError = err instanceof Error ? err.message : String(err);
      }
    }

    // ---- 5. proposals -------------------------------------------------------
    // One ticket per reconciled action, and one publish for the pack. Every one
    // carries a dedupeKey: a workshop gets re-run the moment somebody adds a
    // sticky, and the second run must not double the queue. They also share a
    // `batch`, so the queue folds one ceremony into one card instead of
    // dropping a dozen separate ones on somebody after every meeting.
    const batch = { id: `workshop:${t.id}`, label: `Workshop — ${t.meetingTopic}` };

    for (const a of actions) {
      const known = tracking(a);
      proposals.push(
        propose(
          'create_issue',
          `Asked for in ${t.meetingTopic} (${provenance(a)}) with no matching Jira issue.` +
            (known
              ? ` The vault already holds this as [[${known.id}]] — accepting gives the promise a ticket; rejecting says the note is enough.`
              : ''),
          known ? [...a.evidence, { surface: 'vault', label: `[[${known.id}]] ${known.kind}: ${known.title}` }] : a.evidence,
          {
            // The reconciled wording, NOT the model's — `reconcile` prefers a
            // sticky here because a sticky is a human writing a ticket title.
            // The commitment note goes the other way; see `promiseText`.
            title: a.text.replace(/\s+/g, ' ').slice(0, 120),
            type: 'task',
            labels: ['from-workshop'],
            relatedKeys: a.keys,
            // Carried so acceptance can close the loop rather than leaving the
            // note and the ticket ignorant of each other — see accept_proposal.
            noteId: known?.id,
            meeting: t.meetingTopic,
            boardId,
          },
          { dedupeKey: `${t.id}:${slugify(a.text)}`, batch, confidence: confidenceOf(a, !!known) },
        ),
      );
    }

    proposals.push(
      propose(
        'publish_doc',
        packNote
          ? `The workshop pack for ${t.meetingTopic} is in the vault as [[${packNote.id}]]. Edit it there first — publishing sends whatever it says at the moment you accept, not what the skill first wrote.`
          : `The workshop pack for ${t.meetingTopic} exists only in this transcript. Publishing puts it where somebody who missed the meeting will find it.`,
        packEvidence,
        {
          title: `Workshop — ${t.meetingTopic}`,
          relatedKeys: discussed,
          // The note is the source of truth; `html` is only the fallback for
          // the case where the vault refused the body.
          noteId: packNote?.id,
          html: packNote ? undefined : pack,
        },
        // The pack always sorts above the tickets it came with: it is one
        // decision, it is cheap, and it is the artefact somebody actually reads.
        { dedupeKey: t.id, batch, confidence: 0.95 },
      ),
    );

    const brief = [
      pack,
      packNote
        ? `_Saved to the vault as [[${packNote.id}]] — edit it there, then accept the publish below._`
        : `_Not saved to the vault: ${packNoteError ?? 'unknown error'}. Publishing will send the text above as-is._`,
      '',
      `**${proposals.length} proposal${proposals.length === 1 ? '' : 's'} waiting below** — ${
        actions.length
      } ticket${actions.length === 1 ? '' : 's'} and the pack itself. Nothing is written until you press accept.`,
    ].join('\n');

    return {
      skill: 'workshop',
      ranAt: new Date().toISOString(),
      brief,
      proposals,
      noteId: packNote?.id,
      boardId,
    };
  },
};

// ---------------------------------------------------------------------------
// /catchup
// ---------------------------------------------------------------------------

const catchup: Skill = {
  name: 'catchup',
  label: 'Catch me up',
  description: 'Everything that happened in a window.',

  async run(ctx) {
    const windowDays = ctx.days ?? 7;
    const g = await gather(ctx, windowDays);
    const to = ctx.to ?? new Date().toISOString();

    // `mc` is our own bookkeeping — skill runs, sync failures. A catch-up is
    // about what the project did, not about what this app did while you were
    // away.
    const inWindow = (m: { ts: string; source: string }): boolean => m.ts <= to && m.source !== 'mc';

    const moves = g.timeline.lanes.flatMap((l) =>
      l.segments
        .filter((s) => s.from >= g.timeline.from && s.from <= to)
        .map((s) => ({ ts: s.from, line: `- **${l.key}** → ${s.status.replace('_', ' ')}` })),
    );

    const events = g.timeline.markers
      .filter(inWindow)
      .filter((m) => m.kind !== 'message')
      .map((m) => ({ ts: m.ts, line: `- [${m.source}] ${m.label}` }));

    const chatter = g.timeline.markers
      .filter(inWindow)
      .filter((m) => m.kind === 'message')
      .map((m) => ({ ts: m.ts, line: `- ${m.label}` }));

    const ordered = (xs: { ts: string; line: string }[]): string[] =>
      xs.sort((a, b) => a.ts.localeCompare(b.ts)).map((x) => `${x.line}`);

    const brief = [
      `# Catch-up — ${g.timeline.from.slice(0, 10)} to ${to.slice(0, 10)}`,
      '',
      ...section('Work moved', ordered(moves), '_Nothing changed status in this window._'),
      ...section('Meetings, decisions and notes', ordered(events)),
      ...section('Conversation', ordered(chatter)),
    ].join('\n');

    return { skill: 'catchup', ranAt: new Date().toISOString(), brief, proposals: [] };
  },
};

// ---------------------------------------------------------------------------

export const SKILLS: Skill[] = [standup, plan, retro, workshop, catchup, tidy];

export function findSkill(name: string): Skill | undefined {
  return SKILLS.find((s) => s.name === name.replace(/^\//, ''));
}
