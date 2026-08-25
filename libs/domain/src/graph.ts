/**
 * The connection graph — the contract between the collectors and the gateway.
 *
 * `docs/GRAPH-SCHEMA.md` is the prose version and the one a collector author
 * reads. This is the same thing where the compiler can hold it, so a shape that
 * drifts fails a typecheck rather than a demo.
 *
 * WHY IT IS ITS OWN FILE. `index.ts` is 2,600 lines and every edit to it
 * invalidates all five nx projects. This is a self-contained contract with one
 * job, and it is re-exported from `index.ts` so the package surface is
 * unchanged.
 *
 * NAMING. Everything here is `Stored*`, against the `Graph*` family in
 * `index.ts`, and the split is load-bearing rather than cosmetic. `GraphNode`
 * and `GraphEdge` are the *rendered* graph — what
 * `buildRelationGraph` assembles for a lens, four node kinds wide because a
 * storyline with people on it is a hairball. This is the *stored* graph, which
 * holds everything every source knows. Keeping them apart is what lets both
 * rules be true: the graph remembers a person, and the lens does not draw one.
 *
 * A `GraphNodeKind2` beside `GraphNodeKind` would have been the third silent
 * collision this repo has paid for. Two families, two prefixes, no overlap.
 */

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Borrowed from `graphify` by way of `programme_graph`, deliberately rather than
 * reinvented — it is the vocabulary the exported graph is already written in,
 * and `EdgeProvenance` in `index.ts` independently arrived at two thirds of it.
 *
 * The third member is the one carrying the value. `AMBIGUOUS` is a declared
 * claim nothing corroborates, which is not a defect in the data — it is the
 * finding.
 */
export const CONFIDENCE_TIERS = ['EXTRACTED', 'INFERRED', 'AMBIGUOUS'] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/**
 * Where an edge came from, which is orthogonal to how much it is trusted.
 *
 *  - `structural`    the source asserts it outright (hierarchy, ownership)
 *  - `declared`      the source *claims* it — a dependency link, tested not taken
 *  - `reconstructed` we worked it out from evidence
 */
export type EdgeOrigin = 'structural' | 'declared' | 'reconstructed';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export const STORED_NODE_KINDS = [
  'issue',
  'sprint',
  'release',
  'component',
  'person',
  'squad',
  'tribe',
  'goal',
  'message',
  'meeting',
  'page',
  'pr',
  'sticky',
  'frame',
  'board',
  'note',
] as const;
export type StoredNodeKind = (typeof STORED_NODE_KINDS)[number];

/**
 * Hierarchy is a VALUE, not a node kind.
 *
 * Every Jira issue is an `issue` node whatever level it sits at, so adding a
 * level above initiative is a new string rather than a new kind, a new set of
 * edges and a new branch everywhere that switches on kind.
 */
export type IssueLevel =
  | 'initiative'
  | 'epic'
  | 'story'
  | 'task'
  | 'bug'
  | 'spike'
  | 'incident';

/**
 * The collector's declared reading of a vendor status, from config.
 *
 * `StoredIssue.status` stays the vendor's own string — `Code Review`, `QA`,
 * `Closed` — because every Jira instance names these differently and a fixed
 * union in code is a migration every time somebody edits a workflow. This is the
 * three-way answer the product actually needs, and it is config's job to say
 * which strings map to it.
 */
export type StatusCategory = 'todo' | 'doing' | 'done';

export interface StoredNodeBase {
  id: string;
  kind: StoredNodeKind;
  label: string;
  /** Which collector wrote this. Shown on the Sources page, never inferred. */
  source: string;
  url?: string;
  updatedAt?: string;
}

export interface StoredIssue extends StoredNodeBase {
  kind: 'issue';
  key: string;
  level: IssueLevel;
  /** The vendor's own word. Not mapped — see `StatusCategory`. */
  status: string;
  statusCategory: StatusCategory;
  assignee?: string;
  points?: number;
  createdAt?: string;
  resolvedAt?: string;
}

/**
 * A container is a thing that CLOSES, and closing is what fires an alert.
 *
 * `DIRECTION.md` §4 settles the trigger question — an epic done, a sprint ended,
 * a retro held — and the tree cannot express two thirds of it: `WorkItem.sprint`
 * is a bare string with no dates and no state, so "the sprint ended" is not
 * observable at all. A sprint is a node here so that it can end.
 */
export interface StoredContainer extends StoredNodeBase {
  kind: 'sprint' | 'release';
  state: 'future' | 'active' | 'closed';
  startsAt?: string;
  endsAt?: string;
  closedAt?: string;
}

export interface StoredPerson extends StoredNodeBase {
  kind: 'person';
  /** The id, and the only identifier every source has in common. */
  email: string;
  displayName: string;
  /** Per-source handles, so a Slack author and a Jira assignee can be one person. */
  handles?: Partial<Record<string, string>>;
}

/**
 * Anything with a body somebody wrote or said.
 *
 * `recordRef` points at the `records/` file holding the full text. The graph
 * carries none of it: at programme scale that is the difference between a file
 * loaded at boot and a file nobody can load, and the interface only ever wants a
 * record's body when somebody clicks a citation.
 */
export interface StoredRecord extends StoredNodeBase {
  kind: 'message' | 'meeting' | 'page' | 'pr' | 'sticky' | 'frame' | 'board';
  at?: string;
  /** The channel, board or space it lives in — a node id where there is one. */
  container?: string;
  recordRef?: string;
}

/**
 * A vault note, carrying the three fields the gap detector needs and the tree
 * does not have.
 *
 * A `commitment` that is open, has an owner and a due date, and names no key IS
 * the missing-ticket alert — `DIRECTION.md` §5's precision gate is exactly
 * `owner` and `dueAt`. `container` is which sprint, epic or meeting made the
 * promise, and therefore which closing should check it.
 */
export interface StoredNote extends StoredNodeBase {
  kind: 'note';
  noteKind: string;
  status: string;
  recency?: string;
  verifiedAt?: string;
  owner?: string;
  dueAt?: string;
  container?: string;
}

export interface StoredOrgUnit extends StoredNodeBase {
  kind: 'squad' | 'tribe' | 'goal' | 'component';
}

export type StoredNode =
  | StoredIssue
  | StoredContainer
  | StoredPerson
  | StoredRecord
  | StoredNote
  | StoredOrgUnit;

/**
 * The node type for one kind — `StoredNodeOf<'sprint'>` is `StoredContainer`.
 *
 * WHY NOT `Extract<StoredNode, { kind: K }>`. Several interfaces cover more than
 * one kind (`StoredContainer` is sprint *and* release, `StoredRecord` is seven),
 * and `Extract` matches a union member only when its `kind` is exactly the
 * literal asked for. So `Extract<StoredNode, { kind: 'sprint' }>` is `never`, and
 * a narrowing helper built on it silently produces a `never` that only surfaces
 * as "property does not exist on type never" at the call site — a confusing
 * error a long way from its cause.
 *
 * `extends Record<StoredNodeKind, StoredNode>` is what keeps this honest: add a
 * kind to `STORED_NODE_KINDS` and forget this map, and tsc names the missing
 * key here rather than letting it drift.
 */
interface NodeByKind extends Record<StoredNodeKind, StoredNode> {
  issue: StoredIssue;
  sprint: StoredContainer;
  release: StoredContainer;
  component: StoredOrgUnit;
  person: StoredPerson;
  squad: StoredOrgUnit;
  tribe: StoredOrgUnit;
  goal: StoredOrgUnit;
  message: StoredRecord;
  meeting: StoredRecord;
  page: StoredRecord;
  pr: StoredRecord;
  sticky: StoredRecord;
  frame: StoredRecord;
  board: StoredRecord;
  note: StoredNote;
}

export type StoredNodeOf<K extends StoredNodeKind> = NodeByKind[K];

/** Narrow a node to one kind. The predicate every projection is built on. */
export function isNodeKind<K extends StoredNodeKind>(
  kind: K,
): (n: StoredNode) => n is StoredNodeOf<K> {
  return (n): n is StoredNodeOf<K> => n.kind === kind;
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/**
 * EVERY RELATION HAS EXACTLY ONE DIRECTION, and it is written down here.
 *
 * A reversed edge is the most expensive mistake available in this system,
 * because it is plausible, it renders, and it asserts the opposite of the truth.
 * `CLAUDE.md` records the last one: a prompt that stated the direction backwards
 * produced *every* inferred dependency reversed, drawn confidently.
 */
export const STORED_RELATIONS = [
  // hierarchy — child → parent
  'child_of',
  'belongs_to_epic',
  // dependency — dependent → blocker. See DEPENDS_ON_IS_REVERSED below.
  'depends_on',
  // ownership — issue → thing
  'assigned_to',
  'owned_by',
  'responsible_tribe',
  'supports_goal',
  // membership
  'member_of',
  'in_sprint',
  'targets_release',
  'has_component',
  'in_frame',
  'on_board',
  // authorship
  'authored_by',
  'attended',
  // reference — record → the thing it is about
  'mentions',
  'links_to',
  'documents',
  'annotates',
  'co_occurs',
  'similar_to',
] as const;
export type StoredRelation = (typeof STORED_RELATIONS)[number];

/**
 * `A depends_on B` means **A is waiting for B**; B is the blocker.
 *
 * That is the reverse of this codebase's own `blocks`, which runs blocker-first
 * (`MC-103 blocks MC-102` means MC-102 is waiting). So `A depends_on B` is
 * `B blocks A`, and any adapter reading this graph MUST flip.
 *
 * The graph keeps the foreign convention on purpose: `programme_graph` is the
 * largest producer and owns it, and one flip in one function with one test is
 * cheaper and far safer than asking six collectors to adopt a convention from a
 * repo they do not import. This constant exists so the flip site can name it and
 * be found by grep.
 */
export const DEPENDS_ON_IS_REVERSED = true;

/** Enough for the interface to cite an edge and deep-link to where it came from. */
export interface EdgeEvidence {
  /** The surface it was read from: `jira`, `slack`, `zoom`, … */
  source: string;
  /** Node id, or a source-native pointer when there is no node for it. */
  ref: string;
  quote?: string;
  /** Seconds into a recording. */
  at?: number;
}

export interface StoredEdge {
  source: string;
  target: string;
  relation: StoredRelation;
  tier: ConfidenceTier;
  origin: EdgeOrigin;
  /**
   * One human sentence saying why we believe this.
   *
   * REQUIRED on an `INFERRED` edge, and `isRenderableEdge` drops it otherwise.
   * An unexplained dashed line is a machine asserting a dependency nobody can
   * check, which is worse than no line at all — the reader can only trust it or
   * ignore it, and they ignore it.
   */
  why?: string;
  score?: number;
  evidence: EdgeEvidence[];
  /** Dependency edges only: has reconciliation looked at this yet? */
  reconciled?: boolean;
  /**
   * `member_of` only — the one piece of history the graph keeps.
   *
   * It exists for a sentence the product wants to say: "sanjay moved off the
   * platform team on 31 July, so the person who picks this up now is marcus."
   * Undated membership cannot answer that.
   */
  validFrom?: string;
  validTo?: string;
}

export interface StoredGraph {
  directed: true;
  multigraph: true;
  graph: {
    generatedAt: string;
    /** What wrote it — the mock generator, or the collector set. */
    generator: string;
    sources: string[];
  };
  nodes: StoredNode[];
  links: StoredEdge[];
}

// ---------------------------------------------------------------------------
// The two rules the gateway enforces on what it reads
// ---------------------------------------------------------------------------

/** An inference with nothing to show for itself is not renderable. See `why`. */
export function isRenderableEdge(e: Pick<StoredEdge, 'tier' | 'why'>): boolean {
  return e.tier !== 'INFERRED' || !!e.why?.trim();
}

/**
 * May this edge take part in cycle detection?
 *
 * `EXTRACTED` only. The cycle banner accuses a team of an unschedulable plan and
 * offers to fly you to it, so a guess must never raise one.
 *
 * Note this is a deliberate LOOSENING of the current rule, which excludes
 * everything inferred outright. A declared dependency that reconciliation has
 * corroborated against independent evidence is promoted to `EXTRACTED`, and that
 * is a stronger claim than anything `infer.ts` produces — the tier is precisely
 * the thing that says so, which is why the test is on the tier and not on where
 * the edge came from.
 */
export function isStructuralDependency(e: Pick<StoredEdge, 'relation' | 'tier'>): boolean {
  return e.relation === 'depends_on' && e.tier === 'EXTRACTED';
}

/**
 * The flip, in one place, so there is exactly one site to get wrong.
 *
 * Returns the pair in THIS codebase's `blocks` orientation — blocker first —
 * for a stored `depends_on` edge, and `undefined` for anything else.
 *
 * `A depends_on B` (A waits for B)  →  `{ from: B, to: A }` (B blocks A).
 *
 * Written as a function rather than a `[target, source]` at the call site
 * because that swap is invisible in review: it reads as correct either way
 * round, and the resulting graph renders perfectly while asserting the opposite
 * of the truth. `scripts/verify-graph.mts` checks it against a fixture whose
 * two ends are named `blocker` and `waiter`, so a reversal fails loudly.
 */
export function blocksPairOf(e: Pick<StoredEdge, 'relation' | 'source' | 'target'>):
  | { from: string; to: string }
  | undefined {
  if (e.relation !== 'depends_on') return undefined;
  return DEPENDS_ON_IS_REVERSED
    ? { from: e.target, to: e.source }
    : { from: e.source, to: e.target };
}

// ---------------------------------------------------------------------------
// The observed layer — what a re-derive leaves behind
// ---------------------------------------------------------------------------

/**
 * One run's change to the derived graph, in full.
 *
 * The derived graph is rebuilt every run and is disposable; this is the part
 * that is kept. It is what lets a finding say *when* something became true
 * rather than only that it is true now — "fired 07:41 today, when the fourth
 * arrow was drawn" is this record, not a re-reading of current state.
 *
 * `removed` is the half that a graph updated in place can never produce. Jira
 * does not reliably report link deletions, so an incremental update silently
 * keeps an edge that no longer exists — and "a declared link that has gone
 * stale" is one of the findings this system exists to raise. Rebuilding is what
 * makes absence observable.
 */
export interface GraphDelta {
  /** When the re-derive ran. */
  at: string;
  /** What produced the graph this delta describes. */
  generator: string;
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: EdgeKey[];
  removedEdges: EdgeKey[];
  /** An edge that stayed but whose confidence moved — reconciliation confirming or losing a link. */
  tierChanges: { edge: EdgeKey; from: ConfidenceTier; to: ConfidenceTier }[];
  /** A node that stayed but whose status moved. The container-closed trigger reads this. */
  statusChanges: { node: string; from: string; to: string }[];
}

/** The identity of an edge across runs: same three fields, same edge. */
export interface EdgeKey {
  source: string;
  target: string;
  relation: StoredRelation;
}

/**
 * How long we have believed an edge, and when we last saw it.
 *
 * This is the accumulating half of the graph, and the reason a rebuilt derived
 * layer does not mean an amnesiac one. An edge that disappears reads as
 * `lastConfirmed: 3 days ago` rather than silently not existing.
 *
 * IT IS NOT FULLY REGENERABLE, and it is the one durable thing that is not.
 * The rule it is meant to satisfy — nothing durable may exist that the
 * append-only log cannot regenerate — is what makes this storage model safe.
 *
 * Half of the gap is closed: `mc.graph_refreshed` carries the added and removed
 * edge IDENTITIES, not just their counts, so the change history replays and a
 * vanished edge can be named. The other half is not reachable at a price worth
 * paying. Rebuilding `firstSeen` from nothing needs the baseline to record every
 * edge it saw, in one JSONL line — measured at 36 kB for this repo's 158 edges,
 * so ~4.4 MB for a 5,000-issue programme, on a line read whole on every call.
 * A run that changed nothing also emits no event while the index still counts
 * it, so `seenCount` cannot be replayed either.
 *
 * Treat this index as STATE. A bug in it is repaired by re-observing, not by
 * replaying.
 */
export interface EdgeObservation {
  firstSeen: string;
  lastConfirmed: string;
  /** Runs in which this edge was present. Cheap staleness without a full replay. */
  seenCount: number;
}

export type ObservationIndex = Record<string, EdgeObservation>;

/**
 * The index key for an edge.
 *
 * JSON rather than a delimiter-joined string, and deliberately so: ids are
 * `kind:value` where the value is the source's own identifier, and those
 * already contain `:`, `.` and `/` (a Slack `ts`, a GitHub owner/repo/number, a
 * Miro board/item). Any separator picked by hand is a separator some source can
 * emit, and the collision is silent — two different edges quietly sharing one
 * observation. Encoding the tuple cannot collide.
 */
export function edgeObservationKey(e: EdgeKey): string {
  return JSON.stringify([e.source, e.target, e.relation]);
}
