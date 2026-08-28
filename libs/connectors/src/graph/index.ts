/**
 * Connectors over a stored graph — the reader every source eventually goes
 * through.
 *
 * WHAT THIS REPLACES. The mock used to BE the data: `mock/index.ts` held
 * `WorkItem` literals, transcripts and pages as module constants, in a shape
 * that existed nowhere else in the world. Everything downstream was tuned
 * against it, and the day a real collector arrived none of that tuning would
 * have transferred.
 *
 * Now `graph.json` is the data, and this projects it into the connector
 * interfaces. The mock and the real thing differ only in **which collector
 * wrote the file** — which is what makes going live a change of configuration
 * rather than a change of layer, and what lets a detector be developed against
 * fixtures without being developed against a lie.
 *
 * WHY IT IS A PROJECTION AND NOT A REPLACEMENT. The stored graph knows more
 * than the connectors do — people, squads, goals, claims, tiers on every join.
 * The connector interfaces are the narrow per-surface view, and widening them
 * here would push graph concepts into five readers that have no use for them.
 * The alert engine reads the graph directly; the connectors keep their narrow
 * interface. Same reason `StoredNode` and `GraphNode` are two families.
 *
 * WRITES STAY IN MEMORY. `createItem`, `comment`, `post` and `publish` mutate
 * the loaded copy and never touch the file. The fixture is an input, and a demo
 * that edits its own inputs cannot be re-run — the same rule `seed.ts` follows
 * by writing to the raw log rather than through the sync layer.
 */

import {
  annotateTranscript,
  blocksPairOf,
  extractKeys,
  isNodeKind,
  type AppCardMirror,
  type CanvasConnector,
  type CanvasSticky,
  type StoredGraph,
  type StoredNode,
  type StoredPerson,
  type Transcript,
  type WorkItem,
  type WorkItemKey,
  type WorkItemStatus,
  type WorkItemType,
} from '@mc/domain';
import type {
  Connectors,
  ConfluencePage,
  JiraComment,
  SlackMessage,
  SnapshotResult,
} from '../index.js';

/**
 * The vendor's own status words, mapped to the six this app reasons about.
 *
 * CONFIG-SHAPED, and deliberately not a union in the domain. Every Jira names
 * these differently — `Code Review` here, `In Review` next door, `Peer Review`
 * somewhere else — so a fixed union in code is a migration every time somebody
 * edits a workflow. `StoredIssue` keeps the vendor string; this is the reading.
 *
 * `statusCategory` from the graph is the fallback, so an unmapped word still
 * lands somewhere sensible rather than defaulting to `backlog` and quietly
 * removing a ticket from every sprint view.
 */
/**
 * The vendor's own status words, mapped to our five.
 *
 * CONFIG-SHAPED, AND DELIBERATELY NOT A UNION IN THE DOMAIN. Every Jira names
 * these differently — that is why `StoredIssue` keeps the vendor's string
 * untouched — and a fixed union in code is a migration every time somebody edits
 * a workflow.
 *
 * These are the defaults, not the rule. `setStatusWords` replaces them from a
 * file, because the mapping is a fact about one programme's workflow rather than
 * about this codebase: a Jira with `In Review` instead of `Code Review` falls
 * through to `statusCategory` and lands in the wrong column, quietly, and the
 * only symptom is a lane that looks slightly wrong.
 *
 * Lower-cased keys throughout — `statusOf` lower-cases before lookup, so a
 * config file may write `Code Review` the way the workflow does.
 */
const DEFAULT_STATUS_WORDS: Record<string, WorkItemStatus> = {
  'to do': 'todo',
  backlog: 'backlog',
  'in progress': 'in_progress',
  'in development': 'in_progress',
  'code review': 'in_review',
  'in review': 'in_review',
  qa: 'in_review',
  blocked: 'blocked',
  'on hold': 'blocked',
  closed: 'done',
  done: 'done',
  resolved: 'done',
};

/** Live, replaceable. Starts as the defaults so nothing has to configure it. */
let STATUS_WORDS: Record<string, WorkItemStatus> = { ...DEFAULT_STATUS_WORDS };

/**
 * The collector's declared reading of the workflow, and the last resort.
 *
 * A category is coarse by construction — Jira has three — so landing here means
 * `in_review` and `blocked` are unreachable, which is exactly the loss of
 * information a status map exists to prevent.
 */
const CATEGORY_FALLBACK: Record<string, WorkItemStatus> = {
  todo: 'todo',
  doing: 'in_progress',
  done: 'done',
};

const STATUSES: readonly WorkItemStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
];

export interface StatusMapReport {
  /** How many vendor words are mapped, defaults included. */
  words: number;
  /** Whether anything replaced the defaults. */
  configured: boolean;
  /** Entries thrown away, with why — a typo'd target is worse than a missing one. */
  rejected: string[];
}

let statusReport: StatusMapReport = { words: Object.keys(STATUS_WORDS).length, configured: false, rejected: [] };

/**
 * Replace the status map from configuration.
 *
 * MERGED OVER the defaults rather than replacing them wholesale: a real workflow
 * usually differs from these in two or three words, and a config file that has
 * to restate `done: done` to keep it working is one people get wrong.
 *
 * An unknown TARGET is rejected and reported rather than accepted. `'in-review'`
 * for `'in_review'` would otherwise sail through into a `WorkItemStatus` the
 * rest of the app has never heard of, and the first symptom is a lane with an
 * empty column — the compiler cannot help, because this arrives as JSON.
 */
export function setStatusWords(map: Record<string, string>): StatusMapReport {
  const next = { ...DEFAULT_STATUS_WORDS };
  const rejected: string[] = [];
  for (const [word, target] of Object.entries(map)) {
    if (!STATUSES.includes(target as WorkItemStatus)) {
      rejected.push(`"${word}" → "${target}" (not one of ${STATUSES.join(', ')})`);
      continue;
    }
    next[word.toLowerCase().trim()] = target as WorkItemStatus;
  }
  STATUS_WORDS = next;
  statusReport = { words: Object.keys(next).length, configured: true, rejected };
  return statusReport;
}

export function statusMapReport(): StatusMapReport {
  return statusReport;
}

/**
 * Every vendor word in a graph, and what it became.
 *
 * The point of this is to make writing a status map cheap on a machine you have
 * just pointed at a real export: it tells you which words the workflow actually
 * uses and which of them are falling through to `statusCategory`, which is the
 * only way to notice that `in_review` and `blocked` have quietly stopped
 * existing.
 */
export function auditStatusWords(
  g: StoredGraph,
): { vendor: string; category: string; mapped: WorkItemStatus; via: 'map' | 'category' | 'default'; count: number }[] {
  const seen = new Map<string, { vendor: string; category: string; count: number }>();
  for (const n of g.nodes) {
    if (n.kind !== 'issue') continue;
    const issue = n as Extract<StoredNode, { kind: 'issue' }>;
    const key = `${issue.status}\u0000${issue.statusCategory}`;
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { vendor: issue.status, category: issue.statusCategory, count: 1 });
  }
  return [...seen.values()]
    .map(({ vendor, category, count }) => {
      const mapped = STATUS_WORDS[vendor.toLowerCase()];
      return {
        vendor,
        category,
        mapped: mapped ?? CATEGORY_FALLBACK[category] ?? 'todo',
        via: mapped ? ('map' as const) : CATEGORY_FALLBACK[category] ? ('category' as const) : ('default' as const),
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * A hierarchy level to the five types `WorkItem` has.
 *
 * `initiative` collapses to `epic` because `WorkItemType` has no level above it
 * and widening the union would touch every consumer of it, the storyline's
 * colouring and `activeSprintOf`. The level survives in the graph, which is
 * where anything reasoning about hierarchy should be looking anyway.
 */
const LEVEL_TYPES: Record<string, WorkItemType> = {
  initiative: 'epic',
  epic: 'epic',
  story: 'story',
  task: 'task',
  bug: 'bug',
  incident: 'bug',
  spike: 'spike',
};

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * A loaded graph and its record bodies.
 *
 * Loading is NOT here, and that is deliberate rather than an omission: this
 * library is imported by the browser, and `apps/shell/vite.config.mts` only
 * keeps `@mc/vault` out of the bundle because it touches `node:fs`. Reading
 * files from here would quietly hand the shell the same problem, so the
 * projections below are pure over an already-loaded object and the gateway owns
 * the I/O — see `apps/gateway/src/graph-source.ts`.
 */
export interface GraphSource {
  graph: StoredGraph;
  /** `records/<kind>/<id>.json`, keyed `<kind>/<id>`. */
  records: Map<string, unknown>;
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

function statusOf(vendor: string, category: string): WorkItemStatus {
  return STATUS_WORDS[vendor.toLowerCase()] ?? CATEGORY_FALLBACK[category] ?? 'todo';
}

/**
 * The map lookup ALONE — no category fallback, no `'todo'` default.
 *
 * `statusOf` is right for a node, which carries a `statusCategory` the collector
 * declared. An EVENT PAYLOAD carries neither: `{ from: 'In Development', to:
 * 'Code review' }` is the whole of it. Handing that to `statusOf` would pass a
 * category of `undefined` and land every unmapped word in `'todo'`, which is
 * the fabrication `buildTimeline`'s lane-dropping rule exists to refuse — a
 * ticket would read as having sat in `todo` for the length of a status nobody
 * could name.
 *
 * So this returns `undefined` and lets the caller decide, which for
 * `buildTimeline` means abandoning the lane. Exported because `@mc/domain` may
 * not own the map — it is `MC_STATUS_MAP` configuration — and a second copy
 * there would drift from the one every projection reads.
 */
export function lookupStatusWord(vendor: string): WorkItemStatus | undefined {
  return STATUS_WORDS[vendor.toLowerCase()];
}

/**
 * Who a per-source identifier belongs to — the consumer half of the identity map.
 *
 * WHY THIS IS THE THING WITHOUT WHICH NOTHING JOINS. The graph keys people on
 * email, the only identifier every source has in common. Everything downstream
 * compares *handles*: `findContradictions` weighs a Slack author's claim against
 * a Jira assignee's status, the dossier rolls up who weighed in, `/api/work`
 * filters a lane by assignee. On the fixture these all happen to be `riya`,
 * `dana`, `sam` and they match by luck. On a real corpus a Jira account id, a
 * Slack `U024BE7LH` and a Zoom display name of "Riya Sharma" match nothing at
 * all, and every cross-surface join — the only thing this product does that a
 * single tool cannot — silently returns empty.
 *
 * `StoredPerson.handles` is where the collector puts the mapping. This resolves
 * through it once, at the seam, so downstream code goes on comparing plain
 * handles and none of it has to know.
 *
 * IT FALLS THROUGH RATHER THAN FAILING. An identifier nothing knows about is
 * returned as it came, which is exactly today's behaviour — so a graph with no
 * `handles` at all behaves as it always has, and one with a partial map improves
 * by however much it covers. `auditIdentities` is how you find out which.
 */
export interface Identities {
  /**
   * A per-source identifier → the canonical handle, falling through unchanged
   * when nothing knows it.
   */
  resolve: (raw: string) => string;
  /**
   * The canonical handle, or `null` when the map has never heard of this
   * identifier — which is a different question from `resolve`.
   *
   * `resolve('riya')` returning `'riya'` is a SUCCESS when `riya` is a known
   * alias, and a failure when it fell through. Comparing input to output cannot
   * tell those apart, and the first version of the audit reported every already-
   * canonical handle as unresolved: five of eleven references on the fixture,
   * which would have sent somebody writing an identity map they did not need.
   */
  canonical: (raw: string) => string | null;
  /**
   * The name a PERSON would recognise, for any alias of theirs.
   *
   * `resolve` and `canonical` both answer with a handle, which is right for
   * joining and wrong for reading: an alert that says *"#orbit-delivery —
   * jonas.jost"*, a button that says *"Ask hugo.hart"* and a drafted message
   * that opens *"jonas.jost, cleo.calder —"* are all addressing people by their
   * login. The collector already has the answer — Slack's `users.list` carries
   * `real_name`, and `import-slack-messages.mts --users` merges it into the
   * person Jira wrote as `displayName` — and nothing was reading it.
   *
   * `undefined` rather than falling through, so a caller has to decide what to
   * show when nobody is known. Every one of them shows the raw handle, which is
   * today's behaviour and the honest one: a name we do not have is not a name to
   * invent.
   */
  nameOf: (raw: string) => string | undefined;
}

export function buildIdentities(g: StoredGraph): Identities {
  /**
   * One index, every alias pointing at the same canonical handle.
   *
   * The canonical form is `handles.jira` where there is one, because that is
   * what `assignee` already resolves to and a second convention here would put
   * the lane and the trail back out of step.
   */
  const byAlias = new Map<string, string>();
  /** The same aliases, pointing at the display name rather than the handle. */
  const nameByAlias = new Map<string, string>();

  for (const n of g.nodes) {
    if (n.kind !== 'person') continue;
    const person = n as StoredPerson;
    const handles = person.handles ?? {};
    const canonical =
      handles.jira ?? handles.slack ?? person.email.split('@')[0] ?? person.email;

    const aliases = [
      person.email,
      person.displayName,
      ...Object.values(handles),
      // The email's local part, because that is what this repo used before an
      // identity map existed and a graph written to the old shape must not
      // regress.
      person.email.split('@')[0],
    ].filter((a): a is string => !!a && a.length > 0);

    /**
     * `label` is the fallback, and only where it is a NAME.
     *
     * `StoredPerson.label` is what a collector wrote for a reader and is
     * usually the same string as `displayName`; on a graph that carries only
     * one of them it is the one that is there. It is skipped when it is just
     * the canonical handle or the email again, because "Jonas Jost" and
     * "jonas.jost" are different answers and returning the second is worse than
     * returning nothing — a caller that gets `undefined` shows the handle, which
     * is exactly what it would have shown anyway.
     *
     * AGAINST THE CANONICAL HANDLE, NOT AGAINST EVERY HANDLE. The first version
     * rejected the name whenever it matched ANY entry in `handles`, and on
     * `fixtures/` that is every person: a Zoom handle is a display name, so
     * `handles.zoom` is literally "Sanjay Rao". Six of six people were indexed
     * with no name at all and the front door went on printing
     * `sanjay@example.com` — silently, because falling through to the raw
     * identifier is this function's designed behaviour when it does not know
     * somebody.
     */
    const shown = person.displayName ?? person.label;
    const isName = !!shown && shown !== person.email && shown !== canonical;

    for (const alias of aliases) {
      byAlias.set(alias.toLowerCase(), canonical);
      if (isName && shown) nameByAlias.set(alias.toLowerCase(), shown);
    }
  }

  return {
    resolve: (raw) => (raw ? byAlias.get(raw.toLowerCase()) ?? raw : raw),
    canonical: (raw) => (raw ? byAlias.get(raw.toLowerCase()) ?? null : null),
    nameOf: (raw) => (raw ? nameByAlias.get(raw.toLowerCase()) : undefined),
  };
}

/**
 * Every person reference in the graph, and whether the identity map placed it.
 *
 * The same shape as `auditStatusWords`, and for the same reason: on a machine
 * just pointed at a real export this is the only way to see that the joins have
 * stopped working. A reference the map cannot place is not an error — it falls
 * through and the app keeps running — it is a join that silently will not fire.
 */
export function auditIdentities(
  g: GraphSource,
): { raw: string; resolved: string | null; surfaces: string[]; count: number }[] {
  const ids = buildIdentities(g.graph);
  const seen = new Map<string, { raw: string; surfaces: Set<string>; count: number }>();

  const note = (raw: string | undefined, surface: string): void => {
    if (!raw) return;
    const key = raw.toLowerCase();
    const hit = seen.get(key);
    if (hit) {
      hit.count += 1;
      hit.surfaces.add(surface);
    } else {
      seen.set(key, { raw, surfaces: new Set([surface]), count: 1 });
    }
  };

  for (const n of g.graph.nodes) {
    if (n.kind === 'issue') note((n as Extract<StoredNode, { kind: 'issue' }>).assignee, 'jira');
  }
  for (const [key, rec] of g.records) {
    const [kind] = key.split('/');
    if (kind === 'message') note((rec as { author?: string })?.author, 'slack');
    if (kind === 'meeting') {
      const m = rec as { participants?: string[]; segments?: { speaker?: string }[] };
      for (const p of m.participants ?? []) note(p, 'zoom');
      for (const seg of m.segments ?? []) note(seg.speaker, 'zoom');
    }
    if (kind === 'pr') note((rec as { author?: string })?.author, 'github');
    if (kind === 'page') note((rec as { author?: string })?.author, 'confluence');
  }

  return [...seen.values()]
    .map(({ raw, surfaces, count }) => ({
      raw,
      // `canonical`, not `resolve`. An identifier that is already the canonical
      // handle resolves to itself, and calling that a failure is how an audit
      // sends somebody writing a map they do not need.
      resolved: ids.canonical(raw),
      surfaces: [...surfaces].sort(),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

function projectWorkItems(g: StoredGraph): WorkItem[] {
  const sprints = new Map(g.nodes.filter(isNodeKind('sprint')).map((n) => [n.id, n.label]));
  const identities = buildIdentities(g);

  /**
   * WHICH sprint, when an issue is in several — and it routinely is.
   *
   * `sprintNames()` on a real Jira returns a LIST, and
   * `import-jira-issues.mts` emits one `in_sprint` edge per name, so a ticket
   * carried from Orbit 30 into Orbit 31 has two. This used to be a plain
   * `sprintOf.set` in a loop over `g.links`, which kept whichever edge happened
   * to come last — quite possibly a CLOSED sprint. `gatherWorkFacts` then
   * filters on `i.sprint === activeSprintOf(items)`, so the carried tickets —
   * the ones that have been in play longest and are exactly what the lane
   * exists to surface — dropped out of the sprint entirely, silently.
   *
   * The active sprint wins; failing that, the one that ends latest; failing
   * that, whatever came first, so the answer is stable rather than dependent on
   * edge order.
   */
  const sprintNodes = new Map(g.nodes.filter(isNodeKind('sprint')).map((n) => [n.id, n]));
  const sprintsOf = new Map<string, string[]>();
  const epicOf = new Map<string, string>();
  for (const e of g.links) {
    if (e.relation === 'in_sprint') sprintsOf.set(e.source, [...(sprintsOf.get(e.source) ?? []), e.target]);
    if (e.relation === 'belongs_to_epic') epicOf.set(e.source, e.target.replace(/^issue:/, ''));
  }

  const rank = (id: string): number => {
    const n = sprintNodes.get(id);
    if (!n) return 0;
    return n.state === 'active' ? 3 : n.state === 'future' ? 2 : 1;
  };
  const ends = (id: string): number => Date.parse(sprintNodes.get(id)?.endsAt ?? '') || 0;

  const sprintOf = new Map<string, string>();
  for (const [issue, targets] of sprintsOf) {
    const best = [...targets].sort((a, b) => rank(b) - rank(a) || ends(b) - ends(a))[0]!;
    sprintOf.set(issue, sprints.get(best) ?? best);
  }

  return g.nodes.filter(isNodeKind('issue')).map((n) => ({
    key: n.key,
    type: LEVEL_TYPES[n.level] ?? 'task',
    title: n.label,
    status: statusOf(n.status, n.statusCategory),
    // The connector speaks handles, not emails — `assignee` is compared against
    // Slack authors and transcript speakers all over the app, and an email would
    // match none of them. The graph keeps the email, which is the durable id.
    // Through `buildIdentities`, not a second lookup. This used to read
    // `handles.jira` directly, which is right for Jira and left Slack authors
    // and transcript speakers resolving through nothing at all.
    ...(n.assignee ? { assignee: identities.resolve(n.assignee) } : {}),
    ...(n.points !== undefined ? { estimate: n.points } : {}),
    ...(sprintOf.has(n.id) ? { sprint: sprintOf.get(n.id) } : {}),
    ...(epicOf.has(n.id) ? { epicKey: epicOf.get(n.id) } : {}),
    labels: [],
    updatedAt: n.updatedAt ?? n.createdAt ?? new Date().toISOString(),
    links: [],
  }));
}

/**
 * Dependency edges as board arrows, blocker-first.
 *
 * `blocksPairOf` is the ONLY place the direction flips. `depends_on` runs
 * dependent → blocker and `CanvasConnector` runs blocker → dependent, and a
 * reversal here renders perfectly while asserting the opposite of the truth.
 *
 * Only `EXTRACTED` edges become arrows. A cycle banner accuses a team of an
 * unschedulable plan, so a guess must not be able to raise one — and the same
 * rule that keeps `infer.ts` out of `cycles` keeps an uncorroborated declared
 * link out too. The reconciled ones are in, which is the deliberate loosening:
 * a claim independent evidence corroborated is stronger than anything inferred.
 */
export function projectArrows(g: StoredGraph): CanvasConnector[] {
  const out: CanvasConnector[] = [];
  for (const e of g.links) {
    if (e.relation !== 'depends_on' || e.tier !== 'EXTRACTED') continue;
    const pair = blocksPairOf(e);
    if (!pair) continue;
    out.push({
      id: `arrow-${out.length + 1}`,
      fromKey: pair.from.replace(/^issue:/, ''),
      toKey: pair.to.replace(/^issue:/, ''),
      semantic: 'blocks',
    });
  }
  return out;
}

/**
 * The two facts about an issue that the connector interface has nowhere to put,
 * and that time-in-status cannot be honest without.
 *
 * WHY NOT ON `WorkItem`. `WorkItem.updatedAt` is not the collector's date: the
 * projection stamps `new Date().toISOString()` when a collector wrote none, so
 * an issue with no known date reads as touched this second. Widening `WorkItem`
 * to carry a nullable second date would leave two fields one character apart
 * where the wrong one is the plausible-looking one — the same argument that
 * keeps `StoredNode` and `GraphNode` two families. This is a separate, narrow
 * projection whose whole job is to be unable to lie.
 *
 * `carriedFrom` is the closed sprints this issue is still in. It exists because
 * a carry is the one time-in-status fact a live graph states OUTRIGHT rather
 * than by inference: a ticket in both Orbit 30 (closed 26 Jul) and Orbit 31
 * (active) demonstrably did not finish in Orbit 30, whatever any date says, and
 * an empty list is a real answer rather than a missing one.
 */
export interface StatusObservation {
  key: WorkItemKey;
  /** `StoredIssue.updatedAt`, verbatim. Absent when the collector wrote none. */
  lastVendorUpdate?: string;
  /** Closed sprints this issue is in, oldest close first. Empty is an answer. */
  carriedFrom: { id: string; label: string; endsAt?: string; closedAt?: string }[];
}

/**
 * `StoredIssue.updatedAt` and the carry chain, with NO fallback of any kind.
 *
 * The absence of a fallback is the entire point. `import-programme-graph.mts`
 * writes `updatedAt` only when the source had one and writes no `createdAt` or
 * `resolvedAt` at all, so "the collector told us nothing about when this last
 * moved" is a state that genuinely occurs on the live path — and the honest
 * rendering of it is no signal, not a zero.
 */
export function projectStatusObservations(g: StoredGraph): StatusObservation[] {
  const sprints = new Map(g.nodes.filter(isNodeKind('sprint')).map((n) => [n.id, n]));

  const inSprints = new Map<string, string[]>();
  for (const e of g.links) {
    if (e.relation !== 'in_sprint') continue;
    inSprints.set(e.source, [...(inSprints.get(e.source) ?? []), e.target]);
  }

  const when = (s: { closedAt?: string; endsAt?: string }): number =>
    Date.parse(s.closedAt ?? s.endsAt ?? '') || 0;

  return g.nodes.filter(isNodeKind('issue')).map((n) => ({
    key: n.key,
    ...(n.updatedAt ? { lastVendorUpdate: n.updatedAt } : {}),
    carriedFrom: (inSprints.get(n.id) ?? [])
      .map((id) => sprints.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s && s.state === 'closed')
      .map((s) => ({
        id: s.id,
        label: s.label,
        ...(s.endsAt ? { endsAt: s.endsAt } : {}),
        ...(s.closedAt ? { closedAt: s.closedAt } : {}),
      }))
      .sort((a, b) => when(a) - when(b)),
  }));
}

/** Board cards, laid out in a readable grid. Position is ours only in the mock. */
function projectCards(items: WorkItem[], boardId: string): AppCardMirror[] {
  const COLS = 5;
  return items.map((item, idx) => ({
    miroItemId: `miro-${item.key}`,
    boardId,
    key: item.key,
    x: (idx % COLS) * 220,
    y: Math.floor(idx / COLS) * 160,
    fields: [
      { label: 'Status', value: item.status },
      { label: 'Assignee', value: item.assignee ?? 'unassigned' },
    ],
  }));
}

export function projectStickies(g: StoredGraph, boardId: string): CanvasSticky[] {
  const frames = new Map(g.nodes.filter(isNodeKind('frame')).map((n) => [n.id, n.label]));
  const frameOf = new Map<string, string>();
  for (const e of g.links) if (e.relation === 'in_frame') frameOf.set(e.source, e.target);

  return g.nodes.filter(isNodeKind('sticky')).map((n, idx) => {
    const frameId = frameOf.get(n.id);
    return {
      id: n.id,
      boardId,
      text: n.label,
      ...(frameId ? { frameId, frameTitle: frames.get(frameId) } : {}),
      x: (idx % 4) * 180,
      y: 900 + Math.floor(idx / 4) * 140,
      mentions: extractKeys(n.label),
    };
  });
}

interface TranscriptRecord {
  id: string;
  topic: string;
  startedAt: string;
  participants: string[];
  /** A real recording. Absent when the collector could only reach prose. */
  segments?: { at: number; speaker: string; text: string }[];
  /** Prose with no timing — a Zoom Docs note. See `Transcript.body`. */
  body?: string;
}

function projectTranscripts(g: GraphSource): Transcript[] {
  const identities = buildIdentities(g.graph);
  const out: Transcript[] = [];
  for (const n of g.graph.nodes.filter(isNodeKind('meeting'))) {
    const id = n.id.replace(/^meeting:zoom\//, '');
    const rec = g.records.get(`meeting/${id}`) as TranscriptRecord | undefined;
    if (!rec) continue;
    const segments = rec.segments ?? [];
    out.push(
      annotateTranscript({
        id,
        meetingTopic: rec.topic,
        startedAt: rec.startedAt,
        // Derived rather than stored: a recording's length is the last thing
        // said plus a tail, and a second number could only ever disagree. The
        // `0` seed is what makes a body-only record safe here rather than
        // `-Infinity`.
        durationSec: Math.max(...segments.map((s) => s.at), 0) + 120,
        participants: rec.participants.map((x) => identities.resolve(x)),
        segments: segments.map((s) => ({
          start: s.at,
          end: s.at + 20,
          speaker: identities.resolve(s.speaker),
          text: s.text,
          mentions: [],
        })),
        // Carried through so `extractKeys` can join on it and a citation has
        // something to open. A record with neither segments nor a body is a
        // meeting we know happened and nothing about.
        ...(rec.body ? { body: rec.body } : {}),
      }),
    );
  }
  // Newest first: `/workshop` with no argument reads the most recent recording,
  // and the demo is built on the latest planning call.
  return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

interface MessageRecord {
  id: string;
  channel: string;
  author: string;
  at: string;
  text: string;
}

export function projectMessages(g: GraphSource): (SlackMessage & { channelName: string })[] {
  const identities = buildIdentities(g.graph);
  const out: (SlackMessage & { channelName: string })[] = [];
  for (const n of g.graph.nodes.filter(isNodeKind('message'))) {
    const id = n.id.split('/').pop()!;
    const rec = g.records.get(`message/${id}`) as MessageRecord | undefined;
    if (!rec) continue;
    out.push({
      // Slack's `ts` is unix SECONDS, not a date — `slackTsToIso` exists because
      // `Date.parse` on one silently returns NaN, which sorts every Slack line
      // to the bottom of a newest-first trail.
      ts: String(Date.parse(rec.at) / 1000),
      channelId: `slack-${rec.channel}`,
      channelName: rec.channel,
      author: identities.resolve(rec.author),
      text: rec.text,
      mentions: extractKeys(rec.text),
    });
  }
  // Sorted on the numeric `ts` directly. Round-tripping through `slackTsToIso`
  // returns `string | undefined` — it is deliberately fallible, because
  // `Date.parse` on a unix-seconds string silently yields NaN — and feeding that
  // back into `Date.parse` would reintroduce the exact NaN it exists to prevent.
  return out.sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts));
}

interface PageRecord {
  id: string;
  title: string;
  at: string;
  body: string;
  keys: string[];
}

function projectPages(g: GraphSource): ConfluencePage[] {
  const out: ConfluencePage[] = [];
  for (const n of g.graph.nodes.filter(isNodeKind('page'))) {
    const id = n.id.replace(/^page:confluence\//, '');
    const rec = g.records.get(`page/${id}`) as PageRecord | undefined;
    if (!rec) continue;
    out.push({
      id,
      title: rec.title,
      html: rec.body
        .split('\n\n')
        .map((p) => `<p>${p.replace(/\n/g, ' ')}</p>`)
        .join('\n'),
      updatedAt: rec.at,
      relatedKeys: rec.keys,
      ...(n.url ? { url: n.url } : {}),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The connectors
// ---------------------------------------------------------------------------

/**
 * The five connectors over a graph that can be REPLACED under them.
 *
 * Takes a reader rather than a value, and the object it returns keeps its
 * identity for the life of the process. That is the whole point: a dozen modules
 * capture this at boot — the agent, the tool set, the sync loop, the canvas
 * poll, the inference pass — and roughly eighty call sites dereference it. Had
 * this taken a value, a collector rewriting `graph.json` would have meant
 * threading a getter through every one of them, in files that include the one
 * holding the human gate. It takes a reader, so none of them changes at all.
 *
 * TWO HALVES, AND THE SPLIT IS THE SAME ONE THE STORAGE MODEL USES
 * (`GRAPH-SCHEMA.md` §2), one layer down:
 *
 *  - DERIVED — everything projected out of the graph. Rebuilt the moment the
 *    reader returns a different source, memoised on its identity so a swap costs
 *    one re-projection and a read costs nothing.
 *  - ASSERTED — what was written THROUGH us: a ticket created by accepting a
 *    proposal, a provenance comment, a published pack, a posted message. Never
 *    rebuilt, because nobody can re-read it out of the graph. Without this half,
 *    the twice-daily re-derive would silently undo the flagship loop — accept
 *    the alert's action at 10:00, and the ticket it created is gone at 19:00.
 *
 * THE MERGE RULE, where the two meet. The projection wins on a key collision, so
 * once a collector's export finally contains the ticket we created it appears
 * once, from the graph, rather than twice. A patch from `updateItem` is kept as
 * a PATCH rather than a materialised item and re-applied over whatever the
 * projection currently says — so a re-derive brings in every field the collector
 * moved, and only the fields somebody actually wrote stay ours. `FIELD_OWNER`
 * is the reason it is that way round and not the other: Jira owns status, and an
 * item we froze whole would mask it for ever.
 */
export function createGraphConnectors(
  read: () => GraphSource,
  boardId = 'demo-board',
): Connectors {
  interface Projection {
    items: Map<WorkItemKey, WorkItem>;
    cards: Map<WorkItemKey, AppCardMirror>;
    arrows: CanvasConnector[];
    stickies: CanvasSticky[];
    transcripts: Transcript[];
    messages: (SlackMessage & { channelName: string })[];
    pages: ConfluencePage[];
    channels: { id: string; name: string }[];
  }

  let from: GraphSource | undefined;
  let cache: Projection | undefined;

  /**
   * Memoised on the source's IDENTITY, not on a hash of it.
   *
   * A swap replaces the object, so `!==` is exact and free. Hashing a
   * multi-megabyte graph on every connector call to notice it had not changed
   * would cost more than the projection it is avoiding.
   */
  const p = (): Projection => {
    const source = read();
    if (source !== from || !cache) {
      const g = source.graph;
      const items = new Map(projectWorkItems(g).map((i) => [i.key, i]));
      const messages = projectMessages(source);
      cache = {
        items,
        cards: new Map(projectCards([...items.values()], boardId).map((c) => [c.key, c])),
        arrows: projectArrows(g),
        stickies: projectStickies(g, boardId),
        transcripts: projectTranscripts(source),
        messages,
        pages: projectPages(source),
        channels: [...new Set(messages.map((m) => m.channelName))].map((name) => ({
          id: `slack-${name}`,
          name,
        })),
      };
      from = source;
    }
    return cache;
  };

  // ---- the asserted half: written through us, never rebuilt ----------------
  const madeItems = new Map<WorkItemKey, WorkItem>();
  const patches = new Map<WorkItemKey, Partial<WorkItem>>();
  const madeCards = new Map<WorkItemKey, AppCardMirror>();
  const comments: JiraComment[] = [];
  const snapshots: (SnapshotResult & { at: string })[] = [];
  const madePages: ConfluencePage[] = [];
  const madeMessages: (SlackMessage & { channelName: string })[] = [];

  /** Projection over overlay, then patches over both. */
  const allItems = (): Map<WorkItemKey, WorkItem> => {
    const out = new Map(madeItems);
    for (const [k, v] of p().items) out.set(k, v);
    for (const [k, patch] of patches) {
      const base = out.get(k);
      if (base) out.set(k, { ...base, ...patch, key: k });
    }
    return out;
  };

  const allCards = (): Map<WorkItemKey, AppCardMirror> => {
    const out = new Map(p().cards);
    for (const [k, v] of madeCards) out.set(k, v);
    return out;
  };

  /**
   * A new key continues the largest project's numbering, so a ticket created in
   * the demo looks like the ones around it. Derived on each call rather than
   * captured once: the counter has to clear whatever the CURRENT graph holds, or
   * a swap that brings in higher-numbered issues starts handing out keys that
   * already exist.
   */
  const nextKey = (): WorkItemKey => {
    const keys = [...allItems().keys()];
    const prefix = keys[0]?.split('-')[0] ?? 'MC';
    const n = Math.max(0, ...keys.map((k) => Number(k.split('-')[1]) || 0)) + 1;
    return `${prefix}-${n}`;
  };

  const now = (): string => new Date().toISOString();

  return {
    jira: {
      async listItems(opts) {
        const all = [...allItems().values()];
        return opts?.sprint ? all.filter((i) => i.sprint === opts.sprint) : all;
      },
      async getItem(key) {
        return allItems().get(key);
      },
      async createItem(input) {
        const key = nextKey();
        const item: WorkItem = {
          key,
          type: input.type ?? 'task',
          title: input.title,
          status: input.status ?? 'backlog',
          assignee: input.assignee,
          estimate: input.estimate,
          sprint: input.sprint,
          epicKey: input.epicKey,
          labels: input.labels ?? [],
          updatedAt: now(),
          links: [],
        };
        madeItems.set(key, item);
        return item;
      },
      async updateItem(key, patch) {
        const existing = allItems().get(key);
        if (!existing) throw new Error(`no such item ${key}`);
        // Stored as a patch, not as the merged item — see the merge rule above.
        patches.set(key, { ...patches.get(key), ...patch, updatedAt: now() });
        return { ...existing, ...patches.get(key), key };
      },
      async linkItems() {
        /* Arrows come from the graph; a demo write does not edit the fixture. */
      },
      async comment(key, body) {
        const entry = { id: `cmt-${comments.length + 1}`, key, author: 'mission-control', body, createdAt: now() };
        comments.push(entry);
        return entry;
      },
      async listComments(key) {
        return comments.filter((c) => c.key === key);
      },
    },

    miro: {
      async listAppCards() {
        return [...allCards().values()];
      },
      async upsertAppCard(board, item) {
        const card: AppCardMirror = allCards().get(item.key) ?? {
          miroItemId: `miro-${item.key}`,
          boardId: board,
          key: item.key,
          x: 0,
          y: 0,
          fields: [],
        };
        card.fields = [
          { label: 'Status', value: item.status },
          { label: 'Assignee', value: item.assignee ?? 'unassigned' },
        ];
        madeCards.set(item.key, card);
        return card;
      },
      async listConnectors() {
        return p().arrows;
      },
      async listStickies() {
        return p().stickies;
      },
      async exportSnapshot(board, input) {
        const result: SnapshotResult = {
          frameId: `frame-${snapshots.length + 1}`,
          title: input.title,
          itemCount: input.nodes.length + input.edges.length,
          url: `https://miro.com/app/board/${board}/`,
        };
        snapshots.push({ ...result, at: now() });
        return result;
      },
    },

    confluence: {
      async listPages() {
        return [...p().pages, ...madePages];
      },
      async getPage(id) {
        return [...p().pages, ...madePages].find((pg) => pg.id === id);
      },
      async publish(input) {
        const page: ConfluencePage = {
          id: `page-${p().pages.length + madePages.length + 1}`,
          title: input.title,
          html: input.html,
          updatedAt: now(),
          relatedKeys: input.relatedKeys,
        };
        madePages.push(page);
        return page;
      },
    },

    zoom: {
      async listTranscripts() {
        return p().transcripts.map((t) => ({
          id: t.id,
          meetingTopic: t.meetingTopic,
          startedAt: t.startedAt,
          durationSec: t.durationSec,
        }));
      },
      async getTranscript(id) {
        return p().transcripts.find((t) => t.id === id);
      },
    },

    slack: {
      async listChannels() {
        const named = new Set(p().channels.map((c) => c.name));
        return [
          ...p().channels,
          ...madeMessages
            .filter((m) => !named.has(m.channelName))
            .map((m) => ({ id: m.channelId, name: m.channelName })),
        ];
      },
      async listMessages(channelId) {
        return [...p().messages, ...madeMessages].filter((m) => m.channelId === channelId);
      },
      async post(channelId, text) {
        const msg = {
          ts: String(Date.now() / 1000),
          channelId,
          channelName: p().channels.find((c) => c.id === channelId)?.name ?? channelId,
          author: 'mission-control',
          text,
          mentions: extractKeys(text),
        };
        madeMessages.push(msg);
        return msg;
      },
    },
  };
}
