/**
 * One developer's lane — the screen before a ticket is picked.
 *
 * A sprint board answers "what is assigned to me". Everybody already has one,
 * and it is not the question a developer opens the morning with: that question
 * is "which of these needs me today, and why". The difference between the two
 * is entirely joins across surfaces — two people disagreeing in Slack, a
 * dependency that is itself stuck, a ticket nobody has said a word about in
 * three weeks — and joining those is the only thing this app does that a Jira
 * tab does not.
 *
 * So the lane leads with the signal and puts the status column second.
 *
 * WHY IT IS NOT `buildDossier` IN A LOOP. The dossier gathers all five
 * surfaces per key; eight keys would gather them eight times, and against a
 * live board that is eight `listConnectors` before the front door renders. This
 * gathers once and folds the result over every item, which is the same shape
 * `suggest.ts` settled on for the same reason.
 *
 * It deliberately shares the *rules* rather than the gathering:
 * `classifySignalFor` and `findContradictions` are the same functions the
 * dossier uses, so a row that says "2 sources disagree" and the banner you get
 * when you click it cannot come from two different definitions of disagreement.
 */

import {
  activeSprintOf,
  buildTimeline,
  byRecency,
  classifySignalFor,
  findContradictions,
  findCycles,
  segmentTime,
  slackTsToIso,
  statusEntry,
  WORK_SIGNAL_RANK,
  type Evidence,
  type Owner,
  type TrailEntry,
  type CanvasConnector,
  type WorkItem,
  type WorkItemKey,
  type WorkLane,
  type WorkRow,
  type WorkSignal,
} from '@mc/domain';
import type { Connectors } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import { boardArrows, TRAIL_DAYS } from './issue.js';

/** How long in one status before the lane says so out loud. */
const AGING_DAYS = 7;

/** How recent a record has to be to count as "people are talking about this". */
const ACTIVE_DAYS = 3;

const DAY_MS = 86_400_000;

/**
 * A trail entry as a citation.
 *
 * `TrailEntry` and `Evidence` are nearly the same object read from two
 * directions — one is "what was said about this ticket", the other is "what this
 * claim stands on" — and this is the one place the conversion happens.
 */
function asEvidence(e: TrailEntry): Evidence {
  return {
    surface: e.surface,
    label: e.label,
    ...(e.quote ? { quote: e.quote } : {}),
    ...(e.at !== undefined ? { at: e.at } : {}),
    ...(e.ref ? { ref: e.ref } : {}),
  };
}

/**
 * Statuses that mean the work is finished and nobody is waiting on it.
 *
 * `done` only. `in_review` is not finished — it is the status work goes to die
 * in, and a lane that hides review items is a lane that cannot show the most
 * common way a sprint fails.
 */
const SETTLED = new Set(['done']);

/**
 * Every row in the sprint, plus the structural facts the rows were built from.
 *
 * WHY IT IS SEPARATE FROM `buildWorkLane`. The lane shows one person's rows and
 * always computed everybody's on the way — it needs them to decide whose lane to
 * open on. The findings pass needs the same rows for a different reason: a
 * finding is not scoped to a person, and "MC-9031 is disputed" has to reach the
 * front door whether or not the disputed ticket happens to be in the lane you
 * are looking at.
 *
 * So the gather is shared and the *shaping* is not. Two callers over one set of
 * facts, rather than a second five-surface gather with a second definition of
 * disagreement — which is the failure `classifySignalFor` being shared already
 * prevents one level down.
 */
export interface WorkFacts {
  rows: WorkRow[];
  people: string[];
  sprint?: string;
  /** Every dependency loop, so a caller can report the loop rather than a member. */
  cycles: WorkItemKey[][];
}

export async function gatherWorkFacts(
  c: Connectors,
  vault: VaultStore,
  /**
   * The dependency arrows to reason over.
   *
   * PASS THE GRAPH'S, NOT THE BOARD'S. It defaults to reading the board because
   * that is where this started, and the default is now the wrong one whenever a
   * real `MIRO_ACCESS_TOKEN` is set: `listConnectors` then returns whatever is
   * drawn on the live canvas, which is a different — and unreconciled — account
   * of what depends on what than the graph holds.
   *
   * That is not hypothetical. With a live token pointed at a board carrying an
   * older fixture, the cycle among the graph's four reconciled dependencies
   * simply stopped existing: the lane and the storyline both went quiet about a
   * loop that was plainly in `graph.json`, with nothing failing anywhere.
   *
   * The board is EVIDENCE — an arrow somebody drew, one input among several.
   * The graph is the reconciled result, and it is the only account that carries
   * tiers, which is what `isStructuralDependency` tests to decide whether a
   * cycle may be raised at all.
   */
  arrowsOverride?: CanvasConnector[],
): Promise<WorkFacts> {
  const boardId = process.env.MIRO_BOARD_ID ?? 'demo-board';
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY ?? 'MC';

  const since = new Date(Date.now() - TRAIL_DAYS * 86_400_000).toISOString();

  const [items, channels, transcripts, pages, arrows, events] = await Promise.all([
    c.jira.listItems(),
    c.slack.listChannels(),
    c.zoom.listTranscripts(),
    c.confluence.listPages(spaceKey),
    arrowsOverride ? Promise.resolve(arrowsOverride) : boardArrows(c, boardId),
    /**
     * The durable log, so "how long has this sat" is measured rather than
     * guessed. `seed.ts` writes its backdated transitions straight to the JSONL,
     * so the in-memory log has never heard of them.
     *
     * No `limit`: `readEvents` slices AFTER reversing, so a cap here would drop
     * the OLDEST events in the window — which are exactly the ones the timeline
     * needs to know when a status began. The `since` already bounds it.
     */
    vault.readEvents({ since }),
  ]);

  const sprint = activeSprintOf(items);
  const inSprint = items.filter((i) => i.sprint === sprint && i.type !== 'epic');

  // Everyone with work in the sprint, so a caller can offer the switch without
  // a second request that could disagree with this one about who exists.
  const people = [...new Set(inSprint.map((i) => i.assignee).filter((a): a is string => !!a))].sort();

  // ---- Gather the prose once, indexed by key ------------------------------
  const said = new Map<WorkItemKey, TrailEntry[]>();
  const add = (key: WorkItemKey, e: TrailEntry): void => {
    said.set(key, [...(said.get(key) ?? []), e]);
  };

  for (const ch of channels) {
    for (const m of await c.slack.listMessages(ch.id)) {
      const ts = slackTsToIso(m.ts);
      for (const key of m.mentions) {
        add(key, {
          surface: 'slack',
          ts,
          label: `#${ch.name} — ${m.author}`,
          quote: m.text,
          signal: classifySignalFor(m.text, key),
          // The channel rides along as `parentId`: a Slack message is
          // meaningless outside its thread, and a citation that opens the
          // message alone has not really been followed.
          ref: { surface: 'slack', id: m.ts, parentId: ch.id },
        });
      }
    }
  }

  for (const meta of transcripts) {
    const t = await c.zoom.getTranscript(meta.id);
    for (const seg of t?.segments ?? []) {
      for (const key of seg.mentions) {
        add(key, {
          surface: 'zoom',
          ts: segmentTime(meta.startedAt, seg.start),
          label: `${meta.meetingTopic} — ${seg.speaker}`,
          quote: seg.text,
          signal: classifySignalFor(seg.text, key),
          at: seg.start,
          // The offset is the whole point. A citation that drops you at the top
          // of a ninety-minute recording has not been followed.
          ref: { surface: 'zoom', id: meta.id, at: seg.start },
        });
      }
    }
  }

  for (const p of pages) {
    for (const key of p.relatedKeys) {
      add(key, {
        surface: 'confluence',
        ts: p.updatedAt,
        label: p.title,
        ref: { surface: 'confluence', id: p.id },
      });
    }
  }

  for (const n of vault.list()) {
    for (const key of n.relatedKeys ?? []) {
      add(key, {
        surface: 'vault',
        ts: n.updatedAt,
        label: `${n.kind} — ${n.title}`,
        quote: n.body.slice(0, 240),
        // Same rule as the dossier: only a `dated` note is a claim about a
        // moment. A standing description of a person or a pattern cannot agree
        // or disagree about whether today's work is finished.
        signal: n.recency === 'dated' ? classifySignalFor(n.body, key) : undefined,
        ref: { surface: 'vault', id: n.id },
      });
    }
  }

  /**
   * Time in state, from the same function the ticket page uses.
   *
   * WHY THIS IS NOT `item.updatedAt`. That was the first implementation and it
   * was wrong on every row, in both directions: `updatedAt` is "last touched
   * anything" — a comment, a field edit, and in mock mode a value stamped at
   * boot — not "entered this status". Measured against the fixtures the lane
   * claimed MC-103 had been in todo for 0 days while its own ticket page said
   * 13, so the aging signal never fired on the ticket the whole lane exists to
   * surface; and it claimed 24 days for MC-94 where the truth was 18.
   *
   * One `buildTimeline` over the whole window rather than one per row, indexed
   * by key — the same bargain as the gather above. A ticket with no transitions
   * in the window has no lane and no `ageDays`, which is the honest answer: we
   * do not know, so no aging signal is claimed.
   */
  const lanes = new Map(
    buildTimeline(events, { items, notes: vault.list() }).lanes.map((l) => [l.key, l]),
  );

  // ---- The two structural facts -------------------------------------------
  const cycles = findCycles(arrows);
  const inCycle = new Set(cycles.flat());
  const byKey = new Map(items.map((i) => [i.key, i]));

  /**
   * What this item is waiting on: an inbound `blocks` arrow that is not done.
   *
   * `blocks` runs blocker-first, so the arrows pointing AT this item are the
   * ones holding it up. Getting that backwards names the tickets this item is
   * inconveniencing, which reads plausible and is the opposite fact.
   */
  const blockers = (key: WorkItemKey): WorkItem[] =>
    arrows
      .filter((a) => a.semantic === 'blocks' && a.toKey === key)
      .map((a) => byKey.get(a.fromKey))
      .filter((i): i is WorkItem => !!i && !SETTLED.has(i.status));

  const now = Date.now();

  const rowFor = (item: WorkItem): WorkRow => {
    const trail = [statusEntry(item), ...(said.get(item.key) ?? [])].sort(byRecency);
    const signals: WorkSignal[] = [];

    const disagreements = findContradictions(trail);
    if (disagreements.length) {
      const d = disagreements[0]!;
      // Name the records, not the surfaces. Two Slack lines disagreeing render
      // as "slack says done, slack says not", which reads like a bug in us
      // rather than an argument between two people — and it is the labels that
      // tell you which two.
      signals.push({
        kind: 'disagreement',
        tone: 'alarm',
        text: `“${d.claimsDone.label}” says done, “${d.claimsBlocked.label}” says not${
          d.apartDays === null
            ? ''
            : ` — ${Math.round(d.apartDays)} day${Math.round(d.apartDays) === 1 ? '' : 's'} apart`
        }`,
        // Both records, newest first, so the alert can put them in front of the
        // person who can tell. It never says which is right — it cannot know,
        // and a guess would make the feature worse than absent.
        evidence: [d.claimsDone, d.claimsBlocked]
          .sort(byRecency)
          .map(asEvidence),
      });
    }

    if (inCycle.has(item.key)) {
      const loop = cycles.find((cy) => cy.includes(item.key));
      signals.push({
        kind: 'cycle',
        tone: 'alarm',
        text: `in a dependency cycle — ${loop?.join(' → ') ?? 'nothing in the loop can start'}`,
        /**
         * The arrows themselves, one row each. The loop IS the evidence: there
         * is no quote to show, and naming each link is what lets somebody decide
         * which one is wrong.
         *
         * Deduplicated first, because `findCycles` returns a closed walk with
         * the start key repeated at the end — `[A,B,C,D,A]`. Mapping that
         * directly produced a fifth citation reading "A waits on A", which is
         * not a link that exists and is the kind of detail that makes a reader
         * stop trusting the other four.
         */
        evidence: (() => {
          const ring = [...new Set(loop ?? [])];
          return ring.map((key, i) => ({
            surface: 'miro' as const,
            label: `${key} waits on ${ring[(i + 1) % ring.length]}`,
          }));
        })(),
      });
    }

    const waiting = blockers(item.key);
    if (waiting.length && !SETTLED.has(item.status)) {
      signals.push({
        kind: 'blocked_by',
        tone: 'warn',
        text: `waiting on ${waiting.map((b) => `${b.key} (${b.status.replace('_', ' ')})`).join(', ')}`,
      });
    }

    // Days in the status it is in NOW, not a lifetime: a ticket filed in March
    // and picked up yesterday is one day old here, which is the number that
    // means anything.
    const ageDays = lanes.get(item.key)?.ageDays;
    if (ageDays !== undefined && ageDays >= AGING_DAYS && !SETTLED.has(item.status)) {
      signals.push({
        kind: 'aging',
        tone: 'warn',
        // [judge-local patch] status words like `in_review` already begin with
        // "in"; dropping the literal stops the lane rendering "7 days in in review".
        text: `${Math.round(ageDays)} days in ${item.status.replace('_', ' ').replace(/^in\s+/i, '')}`,
        // The newest thing anybody said about it, or the status itself when
        // nobody has. Silence IS the finding here, so an empty citation list
        // would be the honest answer and a confusing one.
        evidence: [trail[0] ?? statusEntry(item)].map(asEvidence),
      });
    }

    const outside = trail.filter((e) => e.surface !== 'jira');
    if (!outside.length) {
      signals.push({
        kind: 'unwritten',
        tone: 'info',
        text: 'nothing outside Jira mentions this',
      });
    } else {
      const newest = outside
        .map((e) => (e.ts ? Date.parse(e.ts) : NaN))
        .filter((t) => Number.isFinite(t));
      const last = newest.length ? Math.max(...newest) : undefined;
      if (last !== undefined && now - last <= ACTIVE_DAYS * DAY_MS) {
        signals.push({
          kind: 'activity',
          tone: 'info',
          text: (() => {
            const surfaces = new Set(outside.map((e) => e.surface)).size;
            const days = Math.round((now - last) / DAY_MS);
            return `${outside.length} record${outside.length === 1 ? '' : 's'} across ${surfaces} surface${
              surfaces === 1 ? '' : 's'
            }, latest ${days === 0 ? 'today' : `${days}d ago`}`;
          })(),
        });
      }
    }

    const counts: Partial<Record<Owner, number>> = {};
    for (const e of outside) counts[e.surface] = (counts[e.surface] ?? 0) + 1;

    const stamps = outside
      .map((e) => (e.ts ? Date.parse(e.ts) : NaN))
      .filter((t) => Number.isFinite(t));

    return {
      item,
      signals: signals.sort((a, b) => WORK_SIGNAL_RANK[b.kind] - WORK_SIGNAL_RANK[a.kind]),
      counts,
      lastActivity: stamps.length ? new Date(Math.max(...stamps)).toISOString() : undefined,
      ageDays,
    };
  };

  /**
   * Worst first, and a settled ticket last regardless of what it is carrying.
   *
   * The whole point of the lane is that the first row is the one to open. A
   * closed ticket with a stale disagreement on it would otherwise outrank live
   * work, which is exactly the kind of ranking that teaches people to ignore
   * the list.
   */
  const rank = (r: WorkRow): number => {
    if (SETTLED.has(r.item.status)) return -1;
    return r.signals.length ? WORK_SIGNAL_RANK[r.signals[0]!.kind] + 1 : 0;
  };
  const order = (a: WorkRow, b: WorkRow): number =>
    rank(b) - rank(a) || (b.ageDays ?? 0) - (a.ageDays ?? 0);

  /**
   * Who the lane opens on when nobody asked for anyone: whoever has the most to
   * decide.
   *
   * Alphabetical is the obvious default and it is the wrong one — it opens the
   * front door on whoever happens to sort first, which on a good day is
   * somebody with three quiet tickets and nothing to look at. The first screen
   * of this app should be the screen that shows what it is for. Deterministic,
   * and it breaks ties alphabetically so the same fixtures always open the same
   * way.
   */
  return { rows: inSprint.map(rowFor).sort(order), people, sprint, cycles };
}

/**
 * One person's lane, out of the facts above.
 *
 * `order` is applied again rather than assumed: `gatherWorkFacts` sorts the
 * whole sprint, and a filtered slice of a sorted list is still sorted — but
 * `unassigned` is a second slice of the same list and the two must not be
 * ordered by different rules.
 */
export async function buildWorkLane(
  assignee: string | undefined,
  c: Connectors,
  vault: VaultStore,
  arrows?: CanvasConnector[],
): Promise<WorkLane> {
  const { rows, people, sprint } = await gatherWorkFacts(c, vault, arrows);

  /**
   * Who the lane opens on when nobody asked for anyone: whoever has the most to
   * decide.
   *
   * Alphabetical is the obvious default and it is the wrong one — it opens the
   * front door on whoever happens to sort first, which on a good day is
   * somebody with three quiet tickets and nothing to look at. The first screen
   * of this app should be the screen that shows what it is for. Deterministic,
   * and it breaks ties alphabetically so the same fixtures always open the same
   * way.
   */
  const weight = (of: string): number =>
    rows.reduce((n, r) => {
      if (r.item.assignee !== of || SETTLED.has(r.item.status)) return n;
      const worst = r.signals[0];
      return n + (worst ? WORK_SIGNAL_RANK[worst.kind] : 0);
    }, 0);
  const busiest = [...people].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b))[0];
  const who = assignee && people.includes(assignee) ? assignee : (busiest ?? '');

  return {
    assignee: who,
    people,
    sprint,
    rows: rows.filter((r) => r.item.assignee === who),
    // Unassigned sprint work is nobody's row and therefore everybody's problem.
    // It is the one thing a personal lane must not hide, because the reason it
    // is unassigned is that no personal lane has ever shown it.
    unassigned: rows.filter((r) => !r.item.assignee),
  };
}
