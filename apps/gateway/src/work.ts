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
  COLUMN_PHRASE,
  DEFAULT_AGING_DAYS,
  findContradictions,
  findCycles,
  isAlertDeferral,
  segmentTime,
  slackTsToIso,
  statusAgeOf,
  statusAgeText,
  statusEntry,
  tokens,
  WORK_SIGNAL_RANK,
  type Evidence,
  type Owner,
  type RecordRef,
  type TrailEntry,
  type CanvasConnector,
  type WorkItem,
  type AgingDays,
  type WorkItemKey,
  type WorkItemStatus,
  type WorkLane,
  type WorkRow,
  type WorkSignal,
} from '@mc/domain';
import {
  lookupStatusWord,
  projectArrows,
  projectStatusObservations,
  type Connectors,
  type GraphSource,
  type StatusObservation,
} from '@mc/connectors';
import { agingDays, personName } from './graph-source.js';
import type { VaultStore } from '@mc/vault';
import { boardArrows, TRAIL_DAYS } from './issue.js';
import { stripHtml } from './format.js';



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
/**
 * One record, reduced to what a text search needs.
 *
 * DELIBERATELY NOT A `TrailEntry`. That carries the full `quote`, and holding
 * every Slack message of a 50,000-message programme resident on every findings
 * request is a different proposition from the loops above, which hold one at a
 * time. Tokens are what the search actually reads; the label and ref are what a
 * citation needs; the body is not kept.
 */
export interface CorpusEntry {
  surface: Owner;
  ts: string;
  /** `#channel — author`, or a page title. Already phrased for a citation. */
  label: string;
  tokens: string[];
  ref?: RecordRef;
}

export interface WorkFacts {
  rows: WorkRow[];
  people: string[];
  sprint?: string;
  /** Every dependency loop, so a caller can report the loop rather than a member. */
  cycles: WorkItemKey[][];
  /** Every record read, keyed or not. Present only when `GatherOpts.corpus`. */
  corpus?: CorpusEntry[];
}

export interface GatherOpts {
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
  arrows?: CanvasConnector[];
  /**
   * `StoredIssue.updatedAt` and the carry chain, per key.
   *
   * Without it `aging` can only speak when the durable event log holds a
   * transition — which on a live graph it never does, because no collector
   * writes one. That is not a degraded signal, it is the detector being
   * structurally dead: measured on `fixtures-programme`, removing
   * `events.jsonl` took the finding count from 14 to 7 and every `aging` row
   * with it.
   */
  observations?: StatusObservation[];
  /**
   * The vendor's status word to one of ours, for the EVENT LOG.
   *
   * Absent, `buildTimeline` reads only words already in our vocabulary and
   * abandons any lane it cannot read. That is the safe default and the wrong
   * one here: a real log speaks the workflow's words.
   */
  mapStatus?: (vendor: string) => WorkItemStatus | undefined;
  /** Per-column patience. Defaults to `DEFAULT_AGING_DAYS`. */
  agingDays?: AgingDays;
  /**
   * Also return every record we read, keyed or not.
   *
   * OPT-IN, and that is the whole design of it. The gather already reads every
   * Slack message, every transcript paragraph and every Confluence page and
   * then **indexes only the keyed minority** into `said` — on the realistic
   * fixture that is 35 of 296 records read and discarded. `dropped_commitment`
   * needs the discarded majority, because a promise that has gone quiet is by
   * definition one that no keyed record mentions.
   *
   * `/api/work` calls the same gather and must not start paying to materialise
   * a corpus it never reads, which is why this is a flag rather than a field
   * that is always populated.
   */
  corpus?: boolean;
}

/**
 * The options every caller should be passing, built from one graph in one place.
 *
 * WHY THIS EXISTS AT ALL. There are exactly two callers — the lane route and
 * the findings pass — and they are required to agree: a row that says *"41 days
 * in in progress"* and an alert page that says something else about the same
 * ticket is the specific failure this codebase keeps writing shared functions
 * to prevent. Each of the four options below is a thing one caller could
 * silently omit, and every omission is invisible rather than loud — no arrows
 * means no cycle, no observations means no `aging` at all, no mapper means
 * every lane on a real workflow is abandoned, no thresholds means the defaults
 * quietly override a deployment's config.
 *
 * `lookupStatusWord` rather than `statusOf`: an event payload carries no
 * `statusCategory`, so there is nothing for the fallback to read and a word we
 * cannot map must abandon the lane rather than land in `todo`.
 */
export function workOpts(source: GraphSource): GatherOpts {
  return {
    arrows: projectArrows(source.graph),
    observations: projectStatusObservations(source.graph),
    mapStatus: lookupStatusWord,
    agingDays: agingDays(),
  };
}

export async function gatherWorkFacts(
  c: Connectors,
  vault: VaultStore,
  opts: GatherOpts = {},
): Promise<WorkFacts> {
  const {
    arrows: arrowsOverride,
    observations,
    mapStatus,
    agingDays = DEFAULT_AGING_DAYS,
    corpus: wantCorpus = false,
  } = opts;

  /**
   * Every record read, keyed or not — the half `said` throws away.
   *
   * Filled beside the existing loops rather than in a second pass over the same
   * five surfaces: the connectors are already awaited above and a second gather
   * would be a second set of network calls against a live board.
   */
  const corpus: CorpusEntry[] = [];
  const keep = (e: CorpusEntry): void => {
    if (wantCorpus) corpus.push(e);
  };
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
      if (ts) {
        keep({
          surface: 'slack',
          ts,
          // The NAME, not the login. `m.author` stays the handle everywhere it
          // is COMPARED — `classifySignalFor`, the assignee filter, the identity
          // map itself — and this is the half a reader sees. See `personName`.
          label: `#${ch.name} — ${personName(m.author)}`,
          tokens: [...tokens(m.text)],
          ref: { surface: 'slack', id: m.ts, parentId: ch.id },
        });
      }
      for (const key of m.mentions) {
        add(key, {
          surface: 'slack',
          ts,
          label: `#${ch.name} — ${personName(m.author)}`,
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
      // A paragraph whose moment cannot be computed is dropped from the
      // corpus rather than stamped with one. The corpus exists to answer "has
      // anything happened SINCE", and an entry with no `ts` cannot.
      const segAt = segmentTime(meta.startedAt, seg.start);
      if (segAt) {
        keep({
          surface: 'zoom',
          ts: segAt,
          label: `${meta.meetingTopic} — ${seg.speaker}`,
          tokens: [...tokens(seg.text)],
          ref: { surface: 'zoom', id: meta.id, at: seg.start },
        });
      }
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
    keep({
      surface: 'confluence',
      ts: p.updatedAt,
      label: p.title,
      tokens: [...tokens(`${p.title} ${stripHtml(p.html)}`)],
      ref: { surface: 'confluence', id: p.id },
    });
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
    /**
     * A note parked from an alert is not a source about the ticket — see
     * `isAlertDeferral`, and `KNOWN-GAPS.md` §1 for what it did to the front
     * door. The dossier's own trail applies the same predicate, because this
     * file's header says the two may not disagree about what disagreement is.
     */
    if (isAlertDeferral(n)) continue;
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
    buildTimeline(events, {
      items,
      notes: vault.list(),
      ...(mapStatus ? { mapStatus } : {}),
    }).lanes.map((l) => [l.key, l]),
  );

  /** The collector's own dates and carry chain, per key. Empty is a real state. */
  const observed = new Map((observations ?? []).map((o) => [o.key, o]));

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
         * The arrows themselves, one row each — and each one CITES THE TICKET
         * IT IS ABOUT, so there is something to do with it.
         *
         * These rows said `miro` and carried no `ref`, which was wrong twice.
         * Wrong about the surface: the findings pass reads its arrows from
         * `projectArrows` over the graph's `depends_on` edges — `workOpts` sets
         * `arrows` on every path that reaches a finding — so on a programme with
         * no board at all, four rows claimed Miro. And wrong about being
         * unopenable: four grey sentences restating the walk already printed in
         * the impact line, with nothing to click, which is a citation block that
         * asks the reader to take our word for it.
         *
         * The row now cites the ticket that WAITS, which is both a real record
         * and the place a person goes to break the loop — the arrow is a link on
         * that issue. Same shape as the aging signal's own row a few lines
         * above: our observation in the label, the Jira record in the ref.
         *
         * If the lane is ever fed `boardArrows` instead — a live Miro canvas —
         * the label becomes Miro's account of the arrow while the citation stays
         * the ticket. That is still true, and still the right place to act, but
         * it is the assumption to check first if these rows start looking wrong.
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
            surface: 'jira' as const,
            label: `${key} waits on ${ring[(i + 1) % ring.length]}`,
            ref: { surface: 'jira' as const, id: key },
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

    /**
     * Days in the status it is in NOW, not a lifetime — a ticket filed in March
     * and picked up yesterday is one day old here, which is the number that
     * means anything.
     *
     * `statusAgeOf` owns the precedence between the measured number and the
     * bounded one, so this reads whichever is available and never has to know
     * which. `undefined` is a supported answer: no number, no signal.
     */
    const obs = observed.get(item.key);
    const age = statusAgeOf({
      item,
      ...(lanes.get(item.key) ? { lane: lanes.get(item.key)! } : {}),
      ...(obs?.lastVendorUpdate ? { lastVendorUpdate: obs.lastVendorUpdate } : {}),
      now,
    });

    /**
     * `null` means this column never ages, and it is the precision gate.
     * `backlog` is the case it exists for.
     */
    const threshold = agingDays[item.status];
    if (age && threshold !== null && age.days >= threshold && !SETTLED.has(item.status)) {
      const carried = obs?.carriedFrom ?? [];
      signals.push({
        kind: 'aging',
        tone: 'warn',
        text: statusAgeText(item.status, age),
        /**
         * Three rows, in this order, and at least one always exists so an alert
         * page is never evidence-free.
         *
         * The first two are OUR OBSERVATION — a sprint is not a record and
         * neither is a date — but both are ABOUT a ticket, and that ticket IS a
         * record we hold. So both carry a `ref` to it.
         *
         * The rule is still that a row with somewhere to go is a link and one
         * without is a sentence, and that a dead link is worse than plain text.
         * What changed is noticing these were not dead: `/record/jira/<key>`
         * resolves today, names the ticket ("ORB-1641 — Rework the migration
         * job") and carries the sprint — which is exactly what an alert reading
         * "ORB-1641 has not moved" leaves the reader wondering. Twelve of the
         * eighteen unlinked evidence rows on this fixture were this case: our
         * observation, about something openable, offering nothing to open.
         */
        evidence: [
          ...carried.slice(-1).map(
            (c): Evidence => ({
              surface: 'jira',
              label: `${c.label} closed${
                c.closedAt ?? c.endsAt ? ` on ${(c.closedAt ?? c.endsAt)!.slice(0, 10)}` : ''
              } with ${item.key} still ${COLUMN_PHRASE[item.status]}`,
              ref: { surface: 'jira', id: item.key },
            }),
          ),
          ...(trail[0] && trail[0].surface !== 'jira'
            ? [asEvidence(trail[0])]
            : [
                {
                  surface: 'jira' as const,
                  label: `${item.key} is ${COLUMN_PHRASE[item.status]} in the tracker, and nothing outside Jira mentions it`,
                  ref: { surface: 'jira' as const, id: item.key },
                },
              ]),
        ],
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
      ...(age ? { ageDays: age.days, ageBasis: age.basis, ageSince: age.since } : {}),
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
  return {
    rows: inSprint.map(rowFor).sort(order),
    people,
    sprint,
    cycles,
    ...(wantCorpus ? { corpus } : {}),
  };
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
  opts: GatherOpts = {},
): Promise<WorkLane> {
  const { rows, people, sprint } = await gatherWorkFacts(c, vault, opts);

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
