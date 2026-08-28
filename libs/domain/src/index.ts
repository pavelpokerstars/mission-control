/**
 * @mc/domain — the shared vocabulary of Mission Control.
 *
 * Two ideas carry the whole system:
 *
 *  1. THE JOIN KEY. Every planning artefact in every tool points back to a Jira
 *     issue key (e.g. "MC-123"). We do not invent a second ID space. Jira is the
 *     database; the key is the primary key; everything else carries it as a
 *     foreign key.
 *
 *  2. THE EVENT LOG. Nothing calls anything else directly. Every change from
 *     every tool becomes an McEvent on one append-only log, and the sync layer
 *     reacts to that log. `causedBy` is what stops the loops.
 */

/**
 * The stored connection graph — the contract with the collectors.
 *
 * Re-exported so `@mc/domain` keeps one entry point, and kept in its own file
 * because `index.ts` is 2,600 lines and every edit here invalidates all six
 * projects. See `docs/GRAPH-SCHEMA.md` for the prose version.
 */
export * from './graph.js';
/**
 * Reconstructing a join nobody typed. Its own file for the same reason
 * `graph.ts` is: a self-contained rule with one job, re-exported here so the
 * package surface is unchanged.
 */
export * from './joins.js';
// Imported as well as re-exported: `Note.joins` below is typed with it, and a
// bare `export *` does not bring a name into this module's own scope.
import type { ConfidenceTier } from './graph.js';

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export const SURFACES = ['jira', 'confluence', 'miro', 'zoom', 'slack'] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * The vault is deliberately NOT in SURFACES. Surfaces are external systems we
 * mirror and sync with; the vault is local storage that Mission Control itself
 * owns. Keeping it out of the union means every `for (const s of SURFACES)`
 * loop — connectors, sync, evidence gathering — keeps meaning "the five tools".
 */
export const VAULT = 'vault' as const;
export type Vault = typeof VAULT;

/**
 * Anything that can own a field or be cited as a source: the five, plus us.
 *
 * A LENS IS NOT AN OWNER, and `Lens`/`PaneId` are gone rather than widened.
 * The rule outlives the types: a view that re-draws what the surfaces already
 * own has nothing of its own to be right about, so it cannot own a field and
 * cannot be cited as evidence — every claim it makes belongs to whoever it read
 * it from. Keeping such a thing out of `Owner` is what stops `FIELD_OWNER` and
 * `Evidence` from ever naming one, and it is the same argument that keeps
 * `provenance` from becoming a sixth `Owner` (see `mergeInferred`).
 *
 * `DIRECTION.md` §1 says the lenses come back **as evidence**, reached by
 * clicking "why?" on an alert — a panel on a page, not a destination and not
 * something a switcher names. When that is built it needs no `PaneId`; if it
 * needs a discriminator it will be a local union of evidence shapes. CLAUDE.md's
 * "The models the evidence view will draw" is what to read first.
 */
export type Owner = Surface | Vault;

/** 'mc' = Mission Control itself (a human acting inside our UI, or our agent). */
export type EventSource = Surface | Vault | 'mc';


// ---------------------------------------------------------------------------
// The join key
// ---------------------------------------------------------------------------

/** A Jira issue key, e.g. "MC-123". The canonical ID for a unit of work. */
export type WorkItemKey = string;

const KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/**
 * Pull Jira keys out of arbitrary prose — a Slack message, a Zoom transcript
 * line, a Confluence paragraph, a Miro sticky. This one function is how loose
 * human text gets attached to the spine.
 */
export function extractKeys(text: string): WorkItemKey[] {
  const found = text.match(KEY_RE) ?? [];
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------
// Work items
// ---------------------------------------------------------------------------

export type WorkItemStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'blocked'
  | 'in_review'
  | 'done';

export type WorkItemType = 'epic' | 'story' | 'task' | 'bug' | 'spike';

export interface WorkItem {
  key: WorkItemKey;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  assignee?: string;
  estimate?: number;
  sprint?: string;
  epicKey?: WorkItemKey;
  labels: string[];
  updatedAt: string;
  /** Where this item is mirrored outside Jira. Maintained by the sync layer. */
  links: EntityLink[];
}

/**
 * The sprint the team is actually in.
 *
 * Last by name, NATURALLY sorted — "Sprint 9" comes before "Sprint 14", which a
 * plain string sort gets backwards and which is not hypothetical: the fixtures
 * run to fourteen sprints, so a lexicographic sort makes Sprint 9 the active
 * one and quietly changes what the board, `/plan` and every skill mean by "this
 * sprint". The alternative is a sprint object with dates and a state field that
 * only Jira owns — which we would then have to keep in sync, for a question
 * that has this one-line answer.
 *
 * Lives here, next to `byConcern`, for the same reason: a screen and the agent
 * must agree on what "this sprint" means. `/plan` telling you the sprint holds
 * twelve items while the board in front of you shows six is worse than either
 * number on its own — and "has a sprint" quietly meant "is in this sprint"
 * right up until the fixtures gained a second one.
 */
export function activeSprintOf(items: WorkItem[]): string | undefined {
  return items
    .map((i) => i.sprint)
    .filter((s): s is string => Boolean(s))
    .sort(compareSprints)
    .at(-1);
}

/**
 * Order two sprint names the way a human reads them: by the trailing number
 * when both have one, alphabetically otherwise. Exported because the storyline
 * bands order sprints too, and two orderings of the same list is exactly the
 * kind of disagreement this file exists to prevent.
 */
function compareSprints(a: string, b: string): number {
  const na = Number(/(\d+)\s*$/.exec(a)?.[1]);
  const nb = Number(/(\d+)\s*$/.exec(b)?.[1]);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/**
 * A pointer from the canonical work item to its representation in another tool.
 * The sync layer keeps exactly one of these per (surface, externalId) pair.
 */
export interface EntityLink {
  surface: Surface;
  /** Miro item id, Confluence page id, Slack "channel:ts", Zoom recording id. */
  externalId: string;
  /** Deep link a human can click. */
  url?: string;
  /** Free-form, surface-specific. e.g. { boardId } for Miro. */
  meta?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Field ownership — the rule that prevents sync wars
// ---------------------------------------------------------------------------

/**
 * Exactly one surface may write each field. Anything else that changes it is
 * treated as a *proposal* that must round-trip through the owner.
 *
 * Read this table out loud before adding any new write path.
 */
export const FIELD_OWNER = {
  // Jira owns the truth about the work itself.
  status: 'jira',
  assignee: 'jira',
  estimate: 'jira',
  sprint: 'jira',
  title: 'jira',
  type: 'jira',
  epicKey: 'jira',

  // Miro owns the truth about how work is arranged and how it connects.
  position: 'miro',
  connectors: 'miro',
  frame: 'miro',

  // Confluence owns durable narrative.
  spec: 'confluence',
  decisionRecord: 'confluence',

  // Zoom owns the spoken record. Immutable by definition.
  transcript: 'zoom',

  // Slack owns the conversation. Also immutable — we never edit history.
  discussion: 'slack',

  // The vault owns interpretation, and nothing else. Note the shape of this
  // list: not one entry is a fact about the work. `status` is Jira's forever.
  // The moment the vault starts storing a field above this line it has become
  // a sixth source of truth, and the whole ownership model is dead.
  synthesis: 'vault',
  impediment: 'vault',
  commitment: 'vault',
  pattern: 'vault',
} as const satisfies Record<string, Owner>;

export type OwnedField = keyof typeof FIELD_OWNER;

function ownerOf(field: OwnedField): Owner {
  return FIELD_OWNER[field];
}

export function mayWrite(owner: Owner, field: OwnedField): boolean {
  return FIELD_OWNER[field] === owner;
}

/** Fields the vault must never copy — the guard `assertVaultSafe` enforces. */
const FOREIGN_FIELDS = Object.keys(FIELD_OWNER).filter(
  (f) => FIELD_OWNER[f as OwnedField] !== VAULT,
) as OwnedField[];

// ---------------------------------------------------------------------------
// The event log
// ---------------------------------------------------------------------------

export type McEventType =
  // work item lifecycle
  | 'workitem.created'
  | 'workitem.updated'
  | 'workitem.status_changed'
  | 'workitem.linked'
  // canvas
  | 'canvas.card_created'
  | 'canvas.card_moved'
  | 'canvas.connector_created'
  // knowledge
  | 'doc.published'
  | 'doc.updated'
  // meetings
  | 'meeting.transcript_ready'
  | 'meeting.decision_extracted'
  | 'meeting.action_item_proposed'
  // conversation
  | 'chat.message_posted'
  | 'chat.command_received'
  // the vault
  | 'note.created'
  | 'note.updated'
  | 'note.resolved'
  | 'note.promoted'
  | 'pattern.detected'
  // our own
  /**
   * Proposals live on the log, not only in memory. The queue is a promise to a
   * human that their decision is still there tomorrow, and a process restart
   * must not quietly empty it — least of all now that a scheduler fills it at
   * 22:00 when nobody is watching.
   */
  | 'mc.proposal_created'
  | 'mc.proposal_accepted'
  | 'mc.proposal_rejected'
  /** The vault spoke into another surface — see `surfaceMemory` in the gateway. */
  | 'mc.memory_surfaced'
  /** A skill ran on a timer rather than because somebody asked. */
  | 'mc.skill_ran'
  /**
   * A human answered an alert, and the two answers are different.
   *
   * "Not needed" is a decision — it will not come back, and there is a record of
   * who decided it was fine. "Not now" is a deferral — it comes back, and the
   * note somebody left is the reason it will make sense to them when it does.
   * Collapsing them into one verb is what makes Later empty: everything either
   * nags forever or disappears.
   *
   * On the durable log rather than in memory, for the reason proposals are: an
   * alert list is a promise that a decision you already made is still made
   * tomorrow, and a process restart must not quietly re-raise it.
   */
  | 'mc.finding_deferred'
  | 'mc.finding_dismissed'
  /**
   * A container closed, which is the only moment an alert is allowed to fire.
   *
   * `DIRECTION.md` §4 settles the trigger question — "is it when you close the
   * epic, or is it continuously alerting you as you're creating the stories,
   * which would be annoying" — and this is the answer as an event rather than a
   * state anybody has to poll for. A sprint ending, an epic done, a retro held.
   *
   * It exists separately from `workitem.status_changed` because a sprint is not
   * a work item: it has no key, nothing is assigned to it, and folding it into
   * the work-item stream would put a thing with no assignee and no status into
   * every timeline that reads one.
   */
  | 'mc.container_closed'
  /**
   * A scheduled re-derive finished, and this is its diff.
   *
   * The whole transition story rests on these being APPENDED rather than
   * overwritten: `programme_graph` computes the right deltas today and writes
   * them to a `CHANGES.json` the next refresh replaces, so the change history is
   * one run deep. Here it is the log, so it is as deep as the log.
   */
  | 'mc.graph_refreshed'
  /** A snapshot was drawn onto a board. One-shot and never re-synced. */
  | 'mc.snapshot_exported'
  | 'mc.sync_failed';

export interface McEvent<P = unknown> {
  id: string;
  ts: string;
  source: EventSource;
  type: McEventType;
  /** The work item this event is about, when we can determine one. */
  entityKey?: WorkItemKey;
  actor?: string;
  payload: P;
  /**
   * ECHO SUPPRESSION. When our sync layer writes to a tool, that tool fires a
   * webhook back at us. We stamp the id of the event that caused the write, and
   * drop any inbound event whose `causedBy` we already have in the log.
   *
   * Skipping this is the single most common way these systems die.
   */
  causedBy?: string;

  /**
   * A hand-written replacement for how this entry reads in the log. The
   * `payload` underneath is never overwritten, so evidence citing this event
   * still resolves to what the source system actually sent.
   */
  summary?: string;
}

/**
 * One line of prose for a log entry — the activity feed, the timeline and the
 * context envelope all read the same way because they all call this.
 *
 * A hand-written `summary` wins over anything derived. The user corrected that
 * entry precisely because the derived text was wrong.
 */
export function describeEvent(e: McEvent): string {
  if (e.summary) return e.summary;
  const key = e.entityKey ? `${e.entityKey} ` : '';
  switch (e.type) {
    case 'workitem.status_changed': {
      const p = e.payload as { from?: string; to?: string };
      return `${key}moved ${p.from ?? '?'} → ${p.to ?? '?'}`;
    }
    case 'workitem.created':
      return `${key}created`;
    case 'canvas.card_moved':
      return `${key}card repositioned on canvas`;
    case 'canvas.connector_created': {
      const p = e.payload as { fromKey?: string; toKey?: string };
      return `dependency drawn ${p.fromKey} → ${p.toKey}`;
    }
    case 'meeting.transcript_ready': {
      const p = e.payload as { meetingTopic?: string };
      return `transcript ready: ${p.meetingTopic ?? 'meeting'}`;
    }
    case 'chat.message_posted': {
      const p = e.payload as { text?: string };
      return `slack: ${(p.text ?? '').slice(0, 80)}`;
    }
    case 'doc.published':
    case 'doc.updated': {
      const p = e.payload as { title?: string };
      return `${e.type === 'doc.updated' ? 'updated' : 'published'}: ${p.title ?? 'page'}`;
    }
    case 'note.created':
    case 'note.updated':
    case 'note.resolved':
    case 'note.promoted': {
      const p = e.payload as { title?: string; kind?: string };
      const verb = e.type.slice(5);
      return `note ${verb}: ${p.kind ? `${p.kind} — ` : ''}${p.title ?? 'untitled'}`;
    }
    case 'pattern.detected': {
      const p = e.payload as { title?: string };
      return `pattern: ${p.title ?? 'recurrence noticed'}`;
    }
    case 'mc.memory_surfaced': {
      const p = e.payload as { noteId?: string; into?: string };
      return `${key}reminded ${p.into ?? 'the team'} of [[${p.noteId ?? 'a note'}]]`;
    }
    case 'mc.proposal_created':
    case 'mc.proposal_accepted':
    case 'mc.proposal_rejected': {
      const p = e.payload as { kind?: string; title?: string; reason?: string };
      const verb = e.type.slice(12);
      const why = p.reason ? ` — ${p.reason}` : '';
      return `proposal ${verb}: ${p.kind ?? 'change'}${p.title ? ` "${p.title}"` : ''}${why}`;
    }
    case 'mc.skill_ran': {
      const p = e.payload as { skill?: string; proposals?: number };
      const made = p.proposals ? ` — ${p.proposals} proposal${p.proposals === 1 ? '' : 's'}` : '';
      return `scheduled /${p.skill ?? 'skill'} ran${made}`;
    }
    case 'mc.snapshot_exported': {
      const p = e.payload as { items?: number; frameId?: string };
      return `exported ${p.items ?? 0} items to the board as a snapshot`;
    }
    default:
      return `${key}${e.type}`;
  }
}

let seq = 0;
export function newEvent<P>(
  init: Omit<McEvent<P>, 'id' | 'ts'> & { ts?: string },
): McEvent<P> {
  return {
    id: `evt_${Date.now().toString(36)}_${(seq++).toString(36)}`,
    ts: init.ts ?? new Date().toISOString(),
    ...init,
  };
}

// ---------------------------------------------------------------------------
// Proposals — agent output that a human must approve
// ---------------------------------------------------------------------------

/**
 * The agent never writes to Jira directly. It emits Proposals, a human accepts
 * or rejects them in the UI, and only acceptance triggers a write. This is both
 * the safe design and — usefully — the most demo-able one, because the judges
 * get to watch a human press the button.
 */
export interface Proposal<T = unknown> {
  id: string;
  kind:
    // Writes to somebody else's system. Gated because they create real work.
    | 'create_issue'
    | 'update_issue'
    | 'link_issues'
    | 'publish_doc'
    | 'post_message'
    /**
     * Writes to our own vault. Gated for a different reason: not conflict —
     * there is no second writer — but authorship. A human editing one note on
     * its own page writes directly and always will. An *agent* restructuring
     * several notes at once is a different act, and the risk is that it is
     * simply wrong about what belongs together.
     *
     * The reject path is why this is worth the ceremony: "no, these two
     * impediments are not the same thing, because…" is knowledge that exists
     * nowhere else, and `journalProposal` writes it down.
     */
    | 'resolve_note'
    | 'promote_to_pattern'
    | 'reverify_note'
    /**
     * Attach a reconstructed ticket to the promise it belongs to.
     *
     * In the vault half because that is where the durable effect lands: the
     * key is appended to `Note.relatedKeys` with an `EXTRACTED` join, so the
     * alert stops firing and `/tidy` can retire the note once the work moves.
     * A Jira comment rides along for provenance — a comment is not a field, so
     * `FIELD_OWNER` is untouched, exactly as `create_issue`'s provenance
     * comment already works.
     *
     * A human presses this in front of the claim, the reason and the citation.
     * That is the whole reason the reconstruction is allowed to be a guess.
     */
    | 'link_commitment';
  /** Why the agent thinks this. Always show it. */
  rationale: string;
  /** Where the evidence came from, so the human can verify before accepting. */
  evidence: Evidence[];
  payload: T;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;

  /**
   * The run that produced this, when a skill produced several at once.
   *
   * A ceremony emits a proposal per action item, and a queue that drops twelve
   * separate cards after every meeting is a queue people stop opening — the
   * same failure `dedupeKey` prevents across runs, arriving instead from a
   * single run. The UI folds a batch into one card.
   */
  batch?: { id: string; label: string };

  /**
   * How much this deserves the human's attention, 0..1. Ranking only — it never
   * gates anything, and a low-confidence proposal is still a proposal.
   *
   * Deliberately not a probability of being *correct*: nothing here can measure
   * that. It is a corroboration score, and the honest reading is "how many
   * independent records asked for this".
   */
  confidence?: number;
}

export interface Evidence {
  /** `vault` here means "because I remembered something", and it must cite. */
  surface: Owner;
  label: string;
  url?: string;
  /** For transcripts: seconds into the recording. */
  at?: number;
  quote?: string;
  /**
   * Enough to open the record this was read from.
   *
   * WHY `label` IS NOT ENOUGH. It is written for a person — "#eng-payments —
   * dana", "Sprint 12 planning" — and recovering an id from it means parsing
   * prose, which breaks the first time a channel name contains a dash. The same
   * reason `TrailEntry` carries both.
   *
   * Absent when there is nothing to open, and that is a real state rather than
   * missing data: "no issue references this" is our own observation and has no
   * record behind it. An evidence row with a ref becomes a link; one without
   * stays a sentence, which is the difference between citing and asserting.
   *
   * A CYCLE'S ARROWS USED TO BE THE OTHER EXAMPLE HERE, on the grounds that a
   * loop is a shape rather than a document. It reads better than it worked:
   * four unopenable sentences restating the walk already in the impact line,
   * over a Miro dot on a programme with no board. They cite the ticket that
   * WAITS now — a real record, and the place somebody goes to remove the link.
   * The shape stays the shape; what was missing was somewhere to act.
   */
  ref?: RecordRef;
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
  /** Jira keys mentioned in this segment, filled in by extractKeys(). */
  mentions: WorkItemKey[];
}

/**
 * Nobody knows who said this, and that is a fact rather than a gap.
 *
 * A room on one microphone is a real meeting: Zoom emits a single track and no
 * separation is possible after the fact. Attributing those words to whoever
 * booked the call would be an invented citation on a page whose whole argument
 * is that its citations are real, so the speaker is this instead — visible,
 * and never a name.
 */
export const UNKNOWN_SPEAKER = 'unattributed';

export interface Transcript {
  id: string;
  meetingTopic: string;
  startedAt: string;
  durationSec: number;
  participants: string[];
  segments: TranscriptSegment[];
  /**
   * The meeting's prose, when there are no segments to carry it.
   *
   * A Zoom **Docs note** — the AI summary and its next steps — has a body and no
   * timing at all, and it is the only Zoom artifact reachable when an
   * organisation blocks the recording API. It is still a meeting artifact, so it
   * is still a `meeting`; what it is not is a transcript.
   *
   * `segments` stays the primary shape and a real recording still fills it.
   * When this is set and `segments` is empty, a citation opens the record at a
   * LINE INDEX rather than a time offset — see `GRAPH-SCHEMA.md` §10. That is a
   * genuine loss and the honest one: an offset we do not have cannot be made up.
   */
  body?: string;
  /**
   * Are `segments[].start` real seconds, or paragraph positions?
   *
   * `true`, and absent, mean a real recording. `false` means the segments were
   * DERIVED from `body` by `annotateTranscript`, and their `start` is an index —
   * so ten consumers that read `segments` keep working unchanged, and exactly
   * one place has to care.
   *
   * **That place is the presentation.** `records.ts` emits no `at` on a line
   * when this is false, so a citation into a Zoom note is a line reference and
   * never claims a timestamp it does not have. Deriving the segments is a
   * convenience; showing a fabricated offset to a person is not, and the split
   * is what keeps the first from becoming the second.
   */
  timed?: boolean;
}

export function annotateTranscript(t: Transcript): Transcript {
  /**
   * A body with no segments becomes segments, once, here.
   *
   * The alternative was teaching every consumer of `segments` about `body` —
   * the trail, the inference pass, `/workshop`'s extraction, the suggestions,
   * `trace_entity` — which is ten places to keep in step and one of them to
   * forget. **The join key is the whole mechanism**: a note nobody extracts
   * keys from is a note the graph cannot see, so getting this wrong loses the
   * meeting entirely rather than degrading it.
   *
   * `start` is the paragraph index and `timed` says so. Nothing downstream has
   * to know; the one place that must is the record view, which omits `at`.
   */
  const derived =
    !t.segments.length && t.body
      ? t.body
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((text, i) => ({
            start: i,
            end: i,
            speaker: UNKNOWN_SPEAKER,
            text,
            mentions: [] as WorkItemKey[],
          }))
      : t.segments;

  return {
    ...t,
    ...(derived !== t.segments ? { timed: false } : {}),
    segments: derived.map((s) => ({ ...s, mentions: extractKeys(s.text) })),
  };
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/**
 * A Miro App Card mirroring a Jira issue. Miro's App Card type exists precisely
 * for this: it renders third-party state on the canvas and round-trips edits
 * back out. We use it rather than sticky notes so the mapping is first-class.
 */
export interface AppCardMirror {
  miroItemId: string;
  boardId: string;
  key: WorkItemKey;
  x: number;
  y: number;
  frameId?: string;
  /** Miro shows these as rows on the card face. */
  fields: { label: string; value: string; tooltip?: string }[];
}

export interface CanvasConnector {
  id: string;
  fromKey: WorkItemKey;
  toKey: WorkItemKey;
  /** How we interpret a drawn arrow. Defaults to 'blocks'. */
  semantic: 'blocks' | 'relates' | 'parent' | 'sequence';
}

/**
 * A sticky note on the board — the half of Miro that is not a mirror of Jira.
 *
 * `AppCardMirror` only ever describes work that is *already* a ticket, which is
 * exactly the wrong half for a retro or a planning workshop. Those boards fill
 * up with things nobody has written down anywhere else yet, and until this type
 * existed the system was blind to all of them: it could read a board's arrows
 * and its mirrored cards, and not one word a human actually wrote on it.
 *
 * Read-only, and it stays that way. Miro owns `position` and `frame`; a sticky
 * is somebody's thinking in progress and we do not move, edit or create one.
 *
 * `frameTitle` carries most of the meaning. "Went well" / "Didn't go well" /
 * "Actions" is a schema the team wrote by hand, and it is the only thing that
 * says what a bare sentence on a yellow square is *for*.
 */
export interface CanvasSticky {
  id: string;
  boardId: string;
  text: string;
  /** The frame it sits in, when it sits in one. */
  frameId?: string;
  frameTitle?: string;
  x: number;
  y: number;
  /** Jira keys mentioned in `text`, filled in by `extractKeys`. */
  mentions: WorkItemKey[];
}

/**
 * Read a hand-drawn canvas as a dependency graph, and find the cycles.
 * "Your board has a circular dependency" is a genuinely useful thing to be able
 * to say, and it is only knowable because the canvas is machine-readable.
 */
export function findCycles(connectors: CanvasConnector[]): WorkItemKey[][] {
  const graph = new Map<WorkItemKey, WorkItemKey[]>();
  for (const c of connectors) {
    if (c.semantic !== 'blocks' && c.semantic !== 'sequence') continue;
    const list = graph.get(c.fromKey) ?? [];
    list.push(c.toKey);
    graph.set(c.fromKey, list);
  }

  const cycles: WorkItemKey[][] = [];
  const state = new Map<WorkItemKey, 'visiting' | 'done'>();
  const stack: WorkItemKey[] = [];

  const walk = (node: WorkItemKey): void => {
    const s = state.get(node);
    if (s === 'done') return;
    if (s === 'visiting') {
      const at = stack.indexOf(node);
      if (at !== -1) cycles.push(stack.slice(at).concat(node));
      return;
    }
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) walk(next);
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of graph.keys()) walk(node);
  return cycles;
}

/** Longest blocking chain — the thing that actually sets your sprint length. */
export function criticalPath(
  connectors: CanvasConnector[],
  items: Map<WorkItemKey, WorkItem>,
): { path: WorkItemKey[]; cost: number } {
  const graph = new Map<WorkItemKey, WorkItemKey[]>();
  for (const c of connectors) {
    if (c.semantic !== 'blocks' && c.semantic !== 'sequence') continue;
    graph.set(c.fromKey, (graph.get(c.fromKey) ?? []).concat(c.toKey));
  }
  const memo = new Map<WorkItemKey, { path: WorkItemKey[]; cost: number }>();

  const best = (node: WorkItemKey): { path: WorkItemKey[]; cost: number } => {
    const hit = memo.get(node);
    if (hit) return hit;
    // Guard against cycles: seed before recursing.
    memo.set(node, { path: [node], cost: items.get(node)?.estimate ?? 1 });
    let winner = { path: [node], cost: items.get(node)?.estimate ?? 1 };
    for (const next of graph.get(node) ?? []) {
      const sub = best(next);
      const cost = (items.get(node)?.estimate ?? 1) + sub.cost;
      if (cost > winner.cost) winner = { path: [node, ...sub.path], cost };
    }
    memo.set(node, winner);
    return winner;
  };

  let overall = { path: [] as WorkItemKey[], cost: 0 };
  for (const node of graph.keys()) {
    const r = best(node);
    if (r.cost > overall.cost) overall = r;
  }
  return overall;
}

// ---------------------------------------------------------------------------
// The vault — the scrum master's memory
// ---------------------------------------------------------------------------

/**
 * Every other surface answers "what is true right now". None of them can answer
 * "this is the third sprint we have hit this", because nothing accumulates. The
 * vault is where interpretation accrues across sprints.
 *
 * Two rules keep it from rotting into a stale mirror of Jira:
 *
 *  1. NOTES HANG OFF THE SPINE. `relatedKeys` is the same join key everything
 *     else uses. The vault does not invent a second ID space for work — only
 *     for things that are *not* work (a person, a recurring pattern, an idea
 *     that has not earned a ticket yet).
 *
 *  2. TIMELESS, DATED, OR POINTER. Every note declares which kind of truth it
 *     holds. A `dated` note without a `verifiedAt` is a bug, and a note that
 *     copies a field another surface owns is rejected outright. Knowledge bases
 *     die by silently filling up with facts that used to be true.
 */
export type NoteKind =
  /** A formal scrum impediment: what it was, who owns clearing it, what was tried. */
  | 'impediment'
  /** A promise made aloud that is not a ticket yet, and may never be one. */
  | 'commitment'
  /** Why we chose this — including why a proposal was rejected. */
  | 'decision'
  /** A teammate: what they own, what they flagged, what they were right about. */
  | 'person'
  /** A recurring theme across sprints. Written by consolidation, mostly. */
  | 'pattern'
  /** Zero-friction capture. The inbox. Everything starts here. */
  | 'idea'
  /**
   * An assembled ceremony document — the editable draft between a skill run and
   * a Confluence page.
   *
   * It earns its own kind by being the one thing in the vault that must NOT be
   * recalled. A brief is a few thousand characters of material derived from
   * notes and surfaces that recall already holds separately, and `RECALL_BUDGET`
   * is ~900. Left as an ordinary note it would either be dropped for length or
   * crowd out every note that actually holds a claim. `isRecallable` is where
   * that exclusion lives; everything else about a brief is a normal note —
   * visible on its note page, editable by hand, publishable, citable as
   * evidence.
   */
  | 'brief';

export const NOTE_KINDS: NoteKind[] = [
  'idea',
  'impediment',
  'commitment',
  'decision',
  'person',
  'pattern',
  'brief',
];

/**
 * Whether a note may be volunteered into an agent turn.
 *
 * Lives here rather than in `recall()` so the note page and the gateway agree
 * about what "the vault will bring this up" means without importing the vault.
 * Kept as a predicate rather than a hardcoded `kind !== 'brief'` so the next
 * derived kind has an obvious home.
 */
export function isRecallable(note: Pick<Note, 'kind'>): boolean {
  return note.kind !== 'brief';
}

/**
 * Whether this note is somebody's handling of an ALERT rather than anything
 * said about the work.
 *
 * `about` is set by exactly one thing — `act.ts`'s `defer` — and that same
 * write puts the alert's subject in `relatedKeys`, so the note joins to the
 * ticket like any Slack message or Confluence page. Every reader of a ticket's
 * trail treats an entry as *what a source said about the work*, and a deferral
 * note is not that: it is a record of a decision about an alert, whose text is
 * about the alert. Read as a source it makes the alert evidence for itself —
 * `KNOWN-GAPS.md` §1 has the measured case, where a parked note was quoted back
 * on the front door as one of the two voices in the disagreement it was parked
 * from.
 *
 * A predicate here, rather than `!!n.about` at each site, because the two
 * places that build a trail are the lane and the dossier and `work.ts` opens by
 * saying they must not diverge: "a row that says 2 sources disagree and the
 * banner you get when you click it cannot come from two different definitions
 * of disagreement". This was fixed in one of them first, which is exactly how
 * that divergence starts.
 */
export function isAlertDeferral(note: Pick<Note, 'about'>): boolean {
  return !!note.about;
}

/**
 * OKM — how this note's claims survive contact with time.
 *  - `timeless`: still true in a year (a preference, a constraint, a person's role)
 *  - `dated`: true as of `verifiedAt` and rots without it
 *  - `pointer`: holds no claim, just cites where the truth lives
 */
export type Recency = 'timeless' | 'dated' | 'pointer';

export type NoteStatus = 'open' | 'resolved' | 'archived';

/**
 * How we came to believe a note is about a particular work item.
 *
 * WHY THIS EXISTS. `relatedKeys` is a flat list, which quietly asserts that
 * every join is equally certain. It is not, and on real data it is mostly not
 * certain at all: measured over a real meeting corpus, **none** of the extracted
 * actions named a ticket key. So the join is usually reconstructed — from who
 * was speaking, which sprint the meeting was about, what was being discussed at
 * the time — and the confidence in a claim like "this commitment is about
 * PAY-9031" belongs on the join, not on the note.
 *
 * `why` is required below `EXTRACTED` for the same reason `GraphEdge.basis` is:
 * an unexplained association is a machine asserting a link nobody can check.
 */
export interface KeyJoin {
  tier: ConfidenceTier;
  /** One sentence: how we got from the text to this key. */
  why?: string;
  /** 0..1. Corroboration, not correctness. Nothing gates on it; it sorts. */
  confidence?: number;
}

export interface Note {
  /** Slug. Stable, human-typeable, and what `[[wikilinks]]` resolve against. */
  id: string;
  kind: NoteKind;
  title: string;
  /** The join key. This is how a note reaches the rest of the system. */
  relatedKeys: WorkItemKey[];
  /**
   * Per-key provenance for `relatedKeys`. A key absent from here is
   * `EXTRACTED` — the text named it — so the common case costs nothing and
   * every existing note stays correct without being rewritten.
   */
  joins?: Partial<Record<WorkItemKey, KeyJoin>>;
  /**
   * Who owns this, as a person id or email.
   *
   * Half of the precision gate that keeps the missing-ticket alert believable:
   * a promise with a named owner and a date is unambiguously trackable, and
   * "someone should look at that" is not. Without the gate the detector nags
   * about everything said aloud and gets muted in a week.
   */
  owner?: string;
  /** The other half of the gate. When the promise was due. */
  dueAt?: string;
  /**
   * The sprint, epic or meeting that produced this — a node id.
   *
   * It is what makes the trigger possible at all: an alert fires when a
   * container CLOSES, and without this a note does not know which closing
   * should check it.
   */
  container?: string;
  /** Ids of other notes, parsed out of `[[wikilinks]]` in the body. */
  links: string[];
  /**
   * The finding this note was parked from, when it was.
   *
   * `relatedKeys` cannot carry it: a finding is not a Jira key, and the flagship
   * one is *about the absence* of a Jira key. Deferring is the only route to a
   * note tied to an alert, so this is the only field that records the tie — and
   * it is what lets Later say what a note is about rather than just showing the
   * sentence somebody typed at 5pm three weeks ago.
   */
  about?: string;
  tags: string[];
  recency: Recency;
  /** Required when `recency` is 'dated'. When the claim was last confirmed. */
  verifiedAt?: string;
  status: NoteStatus;
  /** Where this came from. A note with no evidence is a hunch, and says so. */
  evidence: Evidence[];
  /** Set once the note has been published to the team-visible surface. */
  promotedTo?: { surface: 'confluence'; id: string; url?: string; at: string };
  createdAt: string;
  updatedAt: string;
  /** Markdown. Wikilinks live in here. */
  body: string;
}

export type NoteDraft = Partial<Note> & Pick<Note, 'title' | 'kind'>;

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;

/** Pull `[[note-id]]` out of a body. The vault's answer to `extractKeys`. */
export function extractLinks(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(WIKILINK_RE)) {
    const id = m[1]?.trim();
    if (id) out.push(slugify(id));
  }
  return [...new Set(out)];
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);
}

/**
 * The guard that keeps the vault honest. Rejects a note that has copied a field
 * some other surface owns, and a dated claim with no date.
 *
 * Enforced in the store's write path rather than documented in a style guide,
 * because a style guide has never once stopped anybody.
 */
export function assertVaultSafe(note: Pick<Note, 'recency' | 'verifiedAt' | 'body'>): void {
  if (note.recency === 'dated' && !note.verifiedAt) {
    throw new Error('a dated note must carry verifiedAt — otherwise it rots silently');
  }
  // Frontmatter-style `status: in_progress` at the head of a line is the tell:
  // someone is caching Jira in here. Prose that merely mentions a word is fine.
  //
  // Case-SENSITIVE on purpose. A cached field is written the way the API writes
  // it — lowercase — while prose capitalises: "Sprint 14: we pulled MC-104" is
  // a sentence, `sprint: 14` is a copy. Matching case-insensitively rejected
  // the sentence, and a guard that fires on normal writing gets worked around
  // rather than obeyed. A bullet (`- status: x`) is prose too, hence [^\S\n]*.
  for (const field of FOREIGN_FIELDS) {
    const re = new RegExp(`^[^\\S\\n]*${field}[^\\S\\n]*:[^\\S\\n]*\\S`, 'm');
    if (re.test(note.body)) {
      throw new Error(
        `note stores "${field}", which ${ownerOf(field)} owns. ` +
          'Link to the source instead of copying it.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Decay — how far a claim has rotted
// ---------------------------------------------------------------------------

/**
 * `recency` declares whether a note *can* rot. This says how far it has.
 *
 * Without this the recency field is decoration: `verifiedAt` was written on
 * every dated note, shown in the UI, re-stampable by hand — and never once read
 * to make a decision. A claim verified two months ago was quoted into the
 * agent's prompt with exactly the confidence of one verified this morning,
 * which is the precise failure the OKM rule exists to prevent.
 *
 * Two sprints fresh, six sprints gone. A scrum master's world turns over about
 * that fast: a blocker that was true three sprints ago is usually a different
 * blocker now, and a preference from last year is usually still a preference.
 */
export const CLAIM_FRESH_DAYS = 14;
const CLAIM_STALE_DAYS = 42;

export interface Staleness {
  /** Days since the claim was last confirmed. `Infinity` if it never was. */
  days: number;
  /** 0 = fresh, or a note that cannot rot at all. 1 = fully stale. */
  decay: number;
  /** Past the horizon. Still recallable — but never asserted unqualified. */
  stale: boolean;
}

/**
 * Decay never deletes and never hides. It changes what the system volunteers,
 * not what it holds: a stale note still turns up in an explicit lookup, still
 * sits on its page, still counts as evidence. It just stops being handed to the
 * agent as though someone had checked it this morning.
 */
export function stalenessOf(
  note: Pick<Note, 'recency' | 'verifiedAt'>,
  now: number = Date.now(),
): Staleness {
  // A timeless claim is still true in a year; a pointer holds no claim at all.
  // Neither has anything to re-verify.
  if (note.recency !== 'dated') return { days: 0, decay: 0, stale: false };

  const parsed = note.verifiedAt ? Date.parse(note.verifiedAt) : Number.NaN;
  // `assertVaultSafe` rejects this and the store back-fills it, so getting here
  // means a hand-edited file. An unverifiable dated claim is the worst kind.
  if (Number.isNaN(parsed)) return { days: Number.POSITIVE_INFINITY, decay: 1, stale: true };

  const days = Math.max((now - parsed) / 86_400_000, 0);
  const decay = Math.min(
    Math.max((days - CLAIM_FRESH_DAYS) / (CLAIM_STALE_DAYS - CLAIM_FRESH_DAYS), 0),
    1,
  );
  return { days, decay, stale: days >= CLAIM_STALE_DAYS };
}

// ---------------------------------------------------------------------------
// The relation graph — the lens that joins the spine to the memory
// ---------------------------------------------------------------------------

/**
 * Every edge below already exists somewhere in the system. None of the five
 * surfaces holds more than two of them:
 *
 *   Miro       knows arrows between tickets, and nothing about notes.
 *   Jira       knows the epic hierarchy, and nothing about arrows.
 *   The vault  knows which notes explain which tickets, and which notes explain
 *              each other, and nothing about either of the above.
 *   Confluence knows which pages document which tickets.
 *
 * Union them on the join key and you get the picture no vendor can draw. This
 * is `explain_blocked`'s argument in graph form.
 */
/**
 * `meeting` is here because the planning call asked for it in as many words —
 * "you get these little Zoom meeting bubbles, and you can click in it and it
 * has the transcript". A recording is a first-class thing that happened, not a
 * property of the tickets it mentions.
 */
export type GraphNodeKind = 'workitem' | 'note' | 'doc' | 'meeting';

export interface GraphNode {
  /** `MC-102`, a note id, or `doc:<pageId>`. Unique across kinds. */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** The Jira key this node is, or hangs off. Absent for a note about nothing. */
  key?: WorkItemKey;
  status?: WorkItemStatus;
  noteKind?: NoteKind;
  noteStatus?: NoteStatus;
  /** Edges touching this node in either direction. Zero here is the orphan signal. */
  degree: number;
}

export type GraphEdgeKind =
  // ticket → ticket, drawn by a human on the canvas
  | 'blocks'
  | 'sequence'
  | 'relates'
  | 'parent'
  /** ticket → ticket, from `epicKey`. Jira's own hierarchy. */
  | 'epic'
  /** note → ticket, from `relatedKeys`. The vault reaching the spine. */
  | 'annotates'
  /** note → note, from `[[wikilinks]]`. */
  | 'links'
  /** page → ticket, from a Confluence page's `relatedKeys`. */
  | 'documents'
  /** meeting → ticket, from a Jira key spoken aloud in the transcript. */
  | 'mentions';

/**
 * Where an edge came from: a reference somebody actually wrote, or a link we
 * worked out.
 *
 * WHY THIS IS NOT A NEW `Owner`. The obvious implementation is to add
 * `'inference'` to `Owner` and set `asserts: 'inference'`. It is wrong for the
 * same reason a lens is not a `Surface`: `Owner` feeds `FIELD_OWNER`,
 * `Evidence.surface`, every `for (const s of SURFACES)` loop and every
 * per-surface colour map. Widening it to hold something that is not a system of
 * record lets an inference into field ownership, which is the one place it must
 * never reach. So `asserts` keeps meaning "which surface's data produced this"
 * and provenance rides beside it.
 *
 * Absent means `'extracted'`. Every edge `buildRelationGraph` draws is a
 * reference somebody wrote down, so the common case stays unannotated.
 */
export type EdgeProvenance =
  /** Read directly out of a record: a Jira key in the text, an arrow on the board. */
  | 'extracted'
  /** Worked out from language, timing or overlap. A claim, not a citation. */
  | 'inferred';

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** Who asserts this edge, so the UI can show whose claim it is. */
  asserts: Owner;
  /** This edge takes part in a dependency cycle. */
  inCycle?: boolean;
  /** This edge lies on the critical path. */
  onCriticalPath?: boolean;
  /** Absent means `extracted` — see `EdgeProvenance`. */
  provenance?: EdgeProvenance;
  /**
   * 0..1, on inferred edges only. Corroboration, not correctness — the same
   * thing `Proposal.confidence` means. Nothing gates on it; it sorts, and it
   * decides how faint the line is drawn.
   */
  confidence?: number;
  /**
   * WHY we think this, in one human sentence: "the runbook and MC-103 both call
   * it the provider signing secret; the page was written the day MC-103 was
   * filed".
   *
   * Required on an inferred edge and the whole reason one is tolerable. An
   * unexplained dashed line between two tickets is a machine asserting a
   * dependency nobody can check, which is worse than not drawing it — the
   * reader has no way to tell a real find from a hallucination. With the basis
   * shown, a wrong inference costs a glance and is dismissed.
   */
  basis?: string;
}

export interface RelationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycles: WorkItemKey[][];
  /** Null whenever there is a cycle — an unschedulable plan has no critical path. */
  criticalPath: { path: WorkItemKey[]; cost: number } | null;
  /** Ids of nodes with no edges at all: unlinked notes, undocumented tickets. */
  orphans: string[];
}

export interface GraphInput {
  items: WorkItem[];
  notes: Note[];
  connectors: CanvasConnector[];
  pages?: { id: string; title: string; relatedKeys: WorkItemKey[] }[];
  /**
   * Recordings, with the keys each one actually names. Only the metadata is
   * needed — pulling every transcript body to draw a node would cost one fetch
   * per meeting for a label and a date.
   */
  meetings?: { id: string; topic: string; startedAt: string; keys: WorkItemKey[] }[];
}

/** Confluence page ids and Jira keys share no namespace, but might one day. */
export function docNodeId(pageId: string): string {
  return `doc:${pageId}`;
}

/** Same reasoning as `docNodeId` — a recording id is not a Jira key. */
export function meetingNodeId(transcriptId: string): string {
  return `meeting:${transcriptId}`;
}

/**
 * The inverse: a graph node id back to the record it stands for.
 *
 * Kept beside the two functions that mint those ids, because a prefix parsed
 * apart somewhere else is a prefix that drifts from the one that made it.
 * Returns undefined for a work item, which is not a record on a surface — it is
 * the thing the records are about.
 */
export function recordOfNode(id: string, kind: GraphNodeKind): RecordRef | undefined {
  if (kind === 'doc' && id.startsWith('doc:')) return { surface: 'confluence', id: id.slice(4) };
  if (kind === 'meeting' && id.startsWith('meeting:')) return { surface: 'zoom', id: id.slice(8) };
  if (kind === 'note') return { surface: VAULT, id };
  return undefined;
}

export function buildRelationGraph(input: GraphInput): RelationGraph {
  const nodes = new Map<string, GraphNode>();
  const put = (n: Omit<GraphNode, 'degree'>): void => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 });
  };

  for (const i of input.items) {
    put({ id: i.key, kind: 'workitem', label: i.title, key: i.key, status: i.status });
  }
  for (const n of input.notes) {
    put({
      id: n.id,
      kind: 'note',
      label: n.title,
      key: n.relatedKeys[0],
      noteKind: n.kind,
      noteStatus: n.status,
    });
  }
  for (const p of input.pages ?? []) {
    put({ id: docNodeId(p.id), kind: 'doc', label: p.title });
  }
  for (const m of input.meetings ?? []) {
    put({ id: meetingNodeId(m.id), kind: 'meeting', label: m.topic });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const edge = (from: string, to: string, kind: GraphEdgeKind, asserts: Owner): void => {
    // Drop dangling edges rather than inventing a node for them: a note citing
    // a key that is not in this Jira project is a typo, not a work item.
    if (from === to || !nodes.has(from) || !nodes.has(to)) return;
    const id = `${from}|${to}|${kind}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ from, to, kind, asserts });
  };

  for (const c of input.connectors) edge(c.fromKey, c.toKey, c.semantic, 'miro');
  for (const i of input.items) if (i.epicKey) edge(i.epicKey, i.key, 'epic', 'jira');
  for (const n of input.notes) {
    for (const k of n.relatedKeys) edge(n.id, k, 'annotates', 'vault');
    for (const l of n.links) edge(n.id, l, 'links', 'vault');
  }
  for (const p of input.pages ?? []) {
    for (const k of p.relatedKeys) edge(docNodeId(p.id), k, 'documents', 'confluence');
  }
  for (const m of input.meetings ?? []) {
    for (const k of m.keys) edge(meetingNodeId(m.id), k, 'mentions', 'zoom');
  }

  // Cycles and the critical path are properties of the dependency arrows only —
  // a note pointing at two tickets is not a route between them.
  const cycles = findCycles(input.connectors);
  const items = new Map(input.items.map((i) => [i.key, i]));
  const path = cycles.length === 0 ? criticalPath(input.connectors, items) : null;

  const mark = (chain: string[], field: 'inCycle' | 'onCriticalPath'): void => {
    for (let i = 0; i < chain.length - 1; i++) {
      for (const e of edges) {
        if (e.from === chain[i] && e.to === chain[i + 1] && e.asserts === 'miro') e[field] = true;
      }
    }
  };
  for (const c of cycles) mark(c, 'inCycle');
  if (path) mark(path.path, 'onCriticalPath');

  for (const e of edges) {
    const from = nodes.get(e.from);
    const to = nodes.get(e.to);
    if (from) from.degree++;
    if (to) to.degree++;
  }

  const all = [...nodes.values()];
  return {
    nodes: all,
    edges,
    cycles,
    criticalPath: path,
    orphans: all.filter((n) => n.degree === 0).map((n) => n.id),
  };
}

/**
 * A relation nobody wrote down, worked out from the content.
 *
 * The gateway's `infer.ts` produces these by reading the records a model can
 * see and the join key cannot: a Confluence page that never types a ticket key,
 * a transcript sentence that says "the dedupe cache" instead of MC-105, a
 * sticky that names a person rather than an issue. Roughly 40% of the text in
 * the fixtures alone carries no key at all, and the fixtures were written to
 * make the join work — a real Confluence space is far worse.
 */
export interface InferredEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  /** Which surface's records the inference was drawn from. Never a sixth owner. */
  asserts: Owner;
  confidence: number;
  basis: string;
}

/**
 * Fold inferred relations into a graph the surfaces asserted.
 *
 * Deliberately a separate pass rather than a branch inside `buildRelationGraph`,
 * so that function keeps its whole meaning: everything it returns is a reference
 * a human wrote. Inference is decoration applied afterwards, and a caller that
 * does not want it simply does not call this.
 *
 * FOUR THINGS IT REFUSES TO TOUCH, each of which would be a bug:
 *
 *  - `cycles` and `criticalPath`. These are properties of the dependency arrows
 *    only — the existing rule, and it matters much more here. The cycle banner
 *    claims the team has drawn an unschedulable plan and offers to take you to
 *    it; letting a guess close the loop invents that accusation. An inferred
 *    dependency is a question, and a cycle warning is not a question.
 *
 *  - `degree`, and therefore node radius in the lens. Degree is "how connected
 *    is this really", and inflating it with guesses makes a hub out of whatever
 *    the model was most talkative about.
 *
 *  - `orphans`. "Nothing links this" stays true when the only thing linking it
 *    is our own inference — that is precisely the note nobody has filed
 *    properly, which is what `/tidy` acts on. Silencing the warning because we
 *    guessed a link would hide the work the warning exists to prompt.
 *
 *  - Any pair the graph already has. An extracted edge is a citation and an
 *    inferred one is a claim; where both exist the citation wins outright and
 *    the inference is dropped rather than drawn beside it as a second
 *    relationship.
 */
export function mergeInferred(graph: RelationGraph, inferred: InferredEdge[]): RelationGraph {
  const known = new Set(graph.nodes.map((n) => n.id));
  // Keyed without `kind`: two nodes already related are related. Drawing an
  // inferred `relates` beside an extracted `blocks` reads as two dependencies.
  const linked = new Set(graph.edges.flatMap((e) => [`${e.from}|${e.to}`, `${e.to}|${e.from}`]));

  const extra: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of inferred) {
    // Same rule `buildRelationGraph.edge()` applies: an endpoint we do not hold
    // is a hallucinated node, not a work item. Dropping beats inventing.
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue;
    if (linked.has(`${e.from}|${e.to}`)) continue;
    const id = `${e.from}|${e.to}|${e.kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    // An unexplained inference is not renderable — see `GraphEdge.basis`.
    if (!e.basis.trim()) continue;
    extra.push({
      from: e.from,
      to: e.to,
      kind: e.kind,
      asserts: e.asserts,
      provenance: 'inferred',
      confidence: Math.min(1, Math.max(0, e.confidence)),
      basis: e.basis.trim(),
    });
  }

  return { ...graph, edges: [...graph.edges, ...extra] };
}

// ---------------------------------------------------------------------------
// The timeline — the lens that makes time-in-state visible
// ---------------------------------------------------------------------------

/**
 * A status a ticket sat in, and for how long. Segments rather than points is
 * the entire idea: "blocked" as a six-day-wide bar is a thing you notice
 * without asking, and "blocked" as a dot on a chart is not.
 */
export interface TimelineSegment {
  status: WorkItemStatus;
  from: string;
  to: string;
  days: number;
  /** Still running at the end of the window. */
  current: boolean;
}

/**
 * Which statuses count as the work being *done* versus the work *waiting*.
 *
 * `in_review` is waiting, and that classification is the whole point. Teams
 * reliably believe review is quick; flow efficiency is the number that shows
 * them a ticket spent four days in review and six hours being written. Waiting
 * on a reviewer is not progress, however comfortable it feels.
 *
 * `backlog` is excluded rather than counted as waiting — nothing has been
 * committed to yet, so counting it would drown every other signal. `done` is
 * terminal and has no duration worth measuring.
 */
export const STATUS_FLOW: Record<WorkItemStatus, 'active' | 'waiting' | 'excluded'> = {
  in_progress: 'active',
  todo: 'waiting',
  blocked: 'waiting',
  in_review: 'waiting',
  backlog: 'excluded',
  done: 'excluded',
};

export interface TimelineLane {
  key: WorkItemKey;
  title?: string;
  segments: TimelineSegment[];
  /** Days in the status it is in now. The aging number. */
  ageDays: number;
  /** Days actually being worked. */
  activeDays: number;
  /** Days sitting in someone else's queue. */
  waitingDays: number;
  /**
   * `activeDays / (activeDays + waitingDays)`, or null when there is nothing
   * to divide yet.
   *
   * The most useful flow metric and the one almost nobody computes, because
   * almost nobody keeps the transitions. We do — that is the entire reason the
   * event log is mirrored to disk. A ticket at 16% is not a slow ticket; it is
   * a ticket that spent five of its six days waiting on somebody, and the
   * relations lens can say who.
   */
  flowEfficiency: number | null;
}

export interface TimelineMarker {
  id: string;
  ts: string;
  source: EventSource;
  label: string;
  key?: WorkItemKey;
  kind: 'meeting' | 'doc' | 'note' | 'proposal' | 'message' | 'other';
}

export interface Timeline {
  from: string;
  to: string;
  lanes: TimelineLane[];
  markers: TimelineMarker[];
}

/**
 * How much a day spent in this status should worry a scrum master.
 *
 * Ranking lanes by raw duration is the obvious thing and it is wrong: an epic
 * in progress for twelve days is a healthy epic, and it outranks the story
 * that has been blocked for six. `blocked` and `in_review` are waiting on
 * somebody else; `todo` is untouched work inside a sprint; `in_progress` means
 * it is being worked, which is the system functioning; `backlog` is parked on
 * purpose and `done` is finished.
 *
 * Lives here rather than at a caller because the agent's `what_happened` and
 * the timeline must agree. An agent that names a different "worst" ticket
 * than the one at the top of the user's screen is worse than either being
 * wrong on its own.
 */
const STATUS_CONCERN: Record<WorkItemStatus, number> = {
  blocked: 5,
  in_review: 4,
  todo: 3,
  in_progress: 2,
  backlog: 1,
  done: 0,
};

/** Comparator for `Timeline.lanes`: what needs attention first. */
export function byConcern(a: TimelineLane, b: TimelineLane): number {
  const weight = (l: TimelineLane): number => STATUS_CONCERN[l.segments.at(-1)?.status ?? 'backlog'];
  return weight(b) - weight(a) || b.ageDays - a.ageDays;
}

function markerKind(type: McEventType): TimelineMarker['kind'] {
  if (type.startsWith('meeting.')) return 'meeting';
  if (type.startsWith('doc.')) return 'doc';
  if (type.startsWith('note.') || type === 'pattern.detected') return 'note';
  if (type.startsWith('mc.proposal')) return 'proposal';
  if (type.startsWith('chat.')) return 'message';
  return 'other';
}

const DAY_MS = 86_400_000;

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? Math.max(ms, 0) / DAY_MS : 0;
}

/**
 * Fold the event log into lanes and markers.
 *
 * Tolerates a log in either order — `readEvents` hands back newest-first and
 * the on-disk file is oldest-first, and a lens should not care which caller it
 * got.
 */
export function buildTimeline(
  events: McEvent[],
  opts: {
    items?: WorkItem[];
    notes?: Note[];
    now?: string;
    defaultDays?: number;
    /**
     * The vendor's own status word to one of ours, or `undefined` when nothing
     * maps it.
     *
     * WHY THIS EXISTS. An event payload carries the workflow's word — `In
     * Development`, `Code review`, `Closed` — and this function used to cast it
     * straight to `WorkItemStatus`. On a log written in domain words (the demo
     * fixture) that is invisibly fine; on one written in vendor words (every
     * real Jira, and `fixtures-programme`) it produces a lane whose `status` is
     * a string no consumer can match, and the failure is silent in the worst
     * way: `aging` still reports a duration, labelled with a status the ticket
     * is not in.
     *
     * Measured on `fixtures-programme`: five of twenty-seven lanes disagreed
     * with the graph after mapping, and two shipped as findings — `HLX-1704`
     * read *"16 days in backlog"* while the ticket's last recorded transition
     * was into `In Development`, and `HLX-1746` the same for `Code review`.
     *
     * A function rather than a table because the map is CONFIGURATION — see
     * `MC_STATUS_MAP`. `@mc/domain` may not own it, and must not grow a second
     * copy of it that drifts from the one the connectors read.
     */
    mapStatus?: (vendor: string) => WorkItemStatus | undefined;
  } = {},
): Timeline {
  const now = opts.now ?? new Date().toISOString();
  const ordered = [...events].sort((a, b) => a.ts.localeCompare(b.ts));

  const earliest = ordered[0]?.ts;
  const fallback = new Date(Date.parse(now) - (opts.defaultDays ?? 14) * DAY_MS).toISOString();
  const from = earliest && earliest < fallback ? earliest : fallback;

  const titles = new Map((opts.items ?? []).map((i) => [i.key, i.title]));
  const open = new Map<WorkItemKey, { status: WorkItemStatus; since: string }>();
  const lanes = new Map<WorkItemKey, TimelineSegment[]>();

  const laneFor = (key: WorkItemKey): TimelineSegment[] => {
    const existing = lanes.get(key);
    if (existing) return existing;
    const created: TimelineSegment[] = [];
    lanes.set(key, created);
    return created;
  };

  /**
   * The word reader, and it defaults to STRICT rather than to a cast.
   *
   * `w in STATUS_FLOW` is the membership test because that record is exhaustive
   * over `WorkItemStatus` by its own type — a seventh status cannot be added
   * without the compiler naming this check's table, which a hand-written array
   * of the six would not give.
   *
   * The default accepts a log already written in our words, which is what the
   * demo fixture ships and what the webhook path writes. Anything else is
   * `undefined`, and `undefined` drops the lane rather than guessing.
   */
  const readStatus =
    opts.mapStatus ?? ((w: string): WorkItemStatus | undefined =>
      w in STATUS_FLOW ? (w as WorkItemStatus) : undefined);

  /**
   * Keys whose lane was abandoned because a status word did not map.
   *
   * THE WHOLE LANE GOES, NOT THE ONE EVENT. Skipping the unreadable event and
   * carrying on looks tidier and is much worse: the segment either side of it
   * silently merges into one, so a ticket that went `In Development → Code
   * review → In Development` reads as a single unbroken stretch and `ageDays`
   * overstates by however long the middle status lasted. A lane we cannot read
   * in full is a lane we do not have, which is the same "we do not know beats a
   * fabricated number" rule the rest of this measurement follows.
   */
  const dropped = new Set<WorkItemKey>();
  const abandon = (key: WorkItemKey): void => {
    dropped.add(key);
    lanes.delete(key);
    open.delete(key);
  };

  for (const e of ordered) {
    if (e.type !== 'workitem.status_changed' || !e.entityKey) continue;
    if (dropped.has(e.entityKey)) continue;
    const p = e.payload as { from?: string; to?: string };
    if (!p.to) continue;
    const to = readStatus(p.to);
    if (!to) {
      abandon(e.entityKey);
      continue;
    }

    const running = open.get(e.entityKey);
    if (running) {
      laneFor(e.entityKey).push({
        status: running.status,
        from: running.since,
        to: e.ts,
        days: daysBetween(running.since, e.ts),
        current: false,
      });
    } else if (p.from) {
      // First we hear of this ticket is a change *out of* something. It was in
      // that state for at least the whole window before it, so draw it.
      const was = readStatus(p.from);
      if (!was) {
        abandon(e.entityKey);
        continue;
      }
      laneFor(e.entityKey).push({
        status: was,
        from,
        to: e.ts,
        days: daysBetween(from, e.ts),
        current: false,
      });
    }
    open.set(e.entityKey, { status: to, since: e.ts });
  }

  // Whatever is still open runs to the right-hand edge. That trailing segment
  // is the one worth looking at — it is the only one still getting wider.
  for (const [key, running] of open) {
    laneFor(key).push({
      status: running.status,
      from: running.since,
      to: now,
      days: daysBetween(running.since, now),
      current: true,
    });
  }

  const markers: TimelineMarker[] = ordered
    .filter((e) => e.type !== 'workitem.status_changed')
    .map((e) => ({
      id: e.id,
      ts: e.ts,
      source: e.source,
      label: describeEvent(e),
      key: e.entityKey,
      kind: markerKind(e.type),
    }));

  // Notes carry their own creation date, and usually predate the log — the
  // seeded fixtures certainly do. Read them from the notes rather than hoping
  // a matching `note.created` event survived.
  const logged = new Set(markers.map((m) => m.label));
  for (const n of opts.notes ?? []) {
    const label = `note ${n.kind}: ${n.title}`;
    if (logged.has(label) || n.createdAt < from) continue;
    markers.push({
      id: `note:${n.id}`,
      ts: n.createdAt,
      source: 'vault',
      label,
      key: n.relatedKeys[0],
      kind: 'note',
    });
  }
  markers.sort((a, b) => a.ts.localeCompare(b.ts));

  /**
   * Whether this log records waiting AT ALL.
   *
   * `flowEfficiency` divides active by active-plus-waiting, so a log whose
   * vocabulary contains no waiting status yields 1.0 — *"100% of its measured
   * life was active work"* — about a programme whose workflow simply never
   * writes a review or a blocked transition. That is a fabricated number, and
   * it is the shape this repo keeps paying for: confident, plausible, and
   * derived entirely from an absence.
   *
   * `fixtures-programme`'s log moves between `Backlog`, `In Development` and
   * `Closed` only — one active bucket and two excluded — so every one of its
   * twenty-seven lanes would otherwise claim perfect flow.
   *
   * Asked once over the whole timeline rather than per lane, because it is a
   * property of the LOG'S VOCABULARY and not of any one ticket: a ticket that
   * genuinely never waited should still report a real efficiency, but only when
   * the log is capable of recording waiting in the first place.
   */
  const recordsWaiting = [...lanes.values()].some((segs) =>
    segs.some((seg) => STATUS_FLOW[seg.status] === 'waiting'),
  );

  return {
    from,
    to: now,
    lanes: [...lanes.entries()]
      .map(([key, segments]) => {
        let activeDays = 0;
        let waitingDays = 0;
        for (const s of segments) {
          const bucket = STATUS_FLOW[s.status];
          if (bucket === 'active') activeDays += s.days;
          else if (bucket === 'waiting') waitingDays += s.days;
        }
        const measured = activeDays + waitingDays;
        return {
          key,
          title: titles.get(key),
          segments,
          ageDays: segments.at(-1)?.current ? (segments.at(-1)?.days ?? 0) : 0,
          activeDays,
          waitingDays,
          // `null` is a supported answer at every call site, and it is the
          // honest one when the log cannot express waiting.
          flowEfficiency: recordsWaiting && measured > 0 ? activeDays / measured : null,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
    markers,
  };
}

// ---------------------------------------------------------------------------
// The storyline — the relation graph, laid out along time
// ---------------------------------------------------------------------------

/**
 * One lens instead of two.
 *
 * The graph lens knew what connects to what and had no idea when anything
 * happened; the timeline lens knew exactly when and could not draw a single
 * dependency. Each was half of the picture people actually described wanting:
 * an Obsidian-style graph whose x-axis is the sprint.
 *
 * So: x is time and nothing else. A work item is a *bar* spanning its life,
 * coloured by the statuses it passed through; a note, a page and a meeting are
 * points at the moment they happened. Every edge the relation graph knows about
 * is drawn between them. Reading right to left from a blocked ticket lands you
 * on the conversation that blocked it, which is the whole reason to merge them.
 */
/**
 * One record that mentions a work item, drawn as a mark on it.
 *
 * Carries its own `ref` so the mark stays reachable: the whole trade is that a
 * document loses its position on the axis, and it would be a bad one if it also
 * lost its way back to the record that holds it.
 */
export interface StorylineEvidence {
  id: string;
  kind: 'note' | 'doc' | 'meeting';
  label: string;
  source: EventSource;
  /** When it was written or recorded, for ordering and for the tooltip. */
  at: string;
  ref?: RecordRef;
}

export interface StorylineNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  key?: WorkItemKey;
  status?: WorkItemStatus;
  noteKind?: NoteKind;
  noteStatus?: NoteStatus;
  /** Who is responsible for this node existing — drives its colour. */
  source: EventSource;
  degree: number;

  /** Start of its extent on the axis. For a point node, equal to `to`. */
  from: string;
  to: string;
  /** True when this happened at a moment rather than over a span. */
  point: boolean;
  /** Status history, for work items only. Absent when the log has no transitions. */
  segments?: TimelineSegment[];
  /**
   * Still running past its extent — the ticket has not reached a terminal state.
   * A renderer draws an open terminator rather than extending the tail, so
   * "still going" costs three pixels instead of the width of the sprint.
   */
  open: boolean;

  /** Assigned lane. Pixels are the renderer's business; the packing is not. */
  row: number;

  /**
   * Which band this belongs in.
   *
   * `backlog` is deliberately off the time axis. A backlog ticket has a
   * creation date and nothing else true about it in time — it is not being
   * worked, it is not waiting on anybody, and drawing it as a bar across the
   * sprint says something about it that is simply not the case. It gets a
   * gutter of its own, still wired to everything it connects to.
   */
  lane: 'timeline' | 'backlog';
  /** The sprint it belongs to, for the bands. Epics and loose work have none. */
  sprint?: string;
  /**
   * The records that reference this work item, riding it instead of being drawn.
   *
   * Nine connections in ten on this lens were a page, a recording or a note
   * saying "I mention MC-103" — 269 of 307 over the fixtures — and drawing each
   * as an edge from its own row was a category error twice over. It is not a
   * relationship between two things in time; it is an annotation. And the ref
   * was placed by the row packer wherever it fitted, so the line then travelled
   * a median of seven rows to reach the ticket it was about, which is the
   * measured cause of the hairball.
   *
   * So the reference is folded onto its subject and the node disappears. Only
   * structure — dependencies, sequence, the epic hierarchy — is still a line.
   */
  evidence?: StorylineEvidence[];
}

/** A sprint as a stretch of the axis, so the bands can be drawn behind everything. */
export interface StorylineSprint {
  name: string;
  from: string;
  to: string;
}

export interface StorylineEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  asserts: Owner;
  inCycle?: boolean;
  onCriticalPath?: boolean;
  /** Absent means `extracted`. An inferred edge is drawn dashed and faint. */
  provenance?: EdgeProvenance;
  confidence?: number;
  /** Shown on hover. An inferred line with no reason is not worth drawing. */
  basis?: string;
}

export interface Storyline {
  /** The extent actually drawn, after the window was applied. */
  from: string;
  to: string;
  nodes: StorylineNode[];
  edges: StorylineEdge[];
  cycles: WorkItemKey[][];
  /** Highest row in use, so a renderer sizes the canvas without a second pass. */
  rows: number;
  /** Rows in the backlog gutter. Counted separately — it is its own column. */
  backlogRows: number;
  /** Consecutive, non-overlapping, oldest first. Empty when nothing is in a sprint. */
  sprints: StorylineSprint[];
  /** References folded onto their subject rather than drawn — see `evidence`. */
  references: number;
}

/** Which surface a node belongs to, for colour. Notes are ours; the rest are theirs. */
function sourceOfNode(kind: GraphNodeKind): EventSource {
  if (kind === 'note') return 'vault';
  if (kind === 'doc') return 'confluence';
  if (kind === 'meeting') return 'zoom';
  return 'jira';
}

/**
 * How wide the storyline's world is, in world pixels.
 *
 * A renderer draws the whole fetched range into this many pixels once and then
 * looks at it through a transform, so this is the one number that turns "how
 * much room does a chip need" into a fraction of the span. It lives here rather
 * than beside the drawing because the ROW PACKER needs it and the renderer needs
 * it, and the two disagreeing is not a visible error — it is a canvas that
 * quietly uses three times as many rows as it needs.
 *
 * That is not hypothetical. These widths were fractions calibrated against a
 * ~600px plot, back when the canvas was the width of a narrow column; the world
 * became a fixed 1600px with the map transform and nobody re-derived them, so the
 * packer went on reserving 12% of the span for a chip that occupies 3.9% of it.
 * The result was a canvas of 27 mostly-empty rows in a descending staircase.
 */
export const STORYLINE_WORLD_W = 1600;

/** A chip is 62px plus a gap; a point is a dot plus room to not merge. */
const CHIP_PX = 70;
const POINT_PX = 26;

/**
 * A point node needs elbow room or three notes from the same afternoon stack
 * into one dot. Expressed as a fraction of the drawn span rather than in pixels,
 * because the layout has to stay pure — it is an approximation of "about a
 * label's width", and the renderer's own font size is what it approximates.
 *
 * Exported because the row packing *guarantees* two nodes in one row are at
 * least this far apart, and the Miro export needs that guarantee to pick a
 * scale at which its fixed-size cards cannot overlap. A second copy of the
 * number would silently stop being the same number.
 */
export const STORYLINE_POINT_WIDTH = POINT_PX / STORYLINE_WORLD_W;

/**
 * The room a work-item chip claims, same units.
 *
 * Much wider than a dot, because a chip carries a key. Set to the point width
 * instead and two tickets filed a day apart overlap — MC-107 and MC-108 did
 * exactly that, drawing "MC-" under "MC-108".
 */
const STORYLINE_CHIP_WIDTH = CHIP_PX / STORYLINE_WORLD_W;

/**
 * Lay the relation graph out along time.
 *
 * Rows are assigned greedily in time order, each node preferring the average
 * row of the neighbours already placed — a cheap barycentre pass. It is not
 * optimal and does not try to be: it is *deterministic*, which matters more
 * here for the same reason `skills.ts` is. A lens that rearranges itself every
 * time you open it cannot be pointed at in a meeting.
 */
export function buildStoryline(
  graph: RelationGraph,
  timeline: Timeline,
  opts: {
    notes?: Note[];
    /** Needed for sprint membership and for the item's *real* status. */
    items?: WorkItem[];
    pages?: { id: string; updatedAt: string }[];
    meetings?: { id: string; startedAt: string }[];
    /**
     * When each ticket was filed, from `workitem.created` on the log.
     *
     * Needed because `buildTimeline` back-fills a lane to the left edge of its
     * window — correct for a lane chart, where the row is a row whatever else
     * is true, and wrong here, where the left end of a bar is a claim about
     * when the work started. Without this every ticket begins at the same x and
     * the axis carries no information at all.
     */
    created?: Map<WorkItemKey, string>;
    window?: { from: string; to: string };
  } = {},
): Storyline {
  const laneOf = new Map(timeline.lanes.map((l) => [l.key, l]));
  const itemOf = new Map((opts.items ?? []).map((i) => [i.key, i]));
  const noteAt = new Map((opts.notes ?? []).map((n) => [n.id, n.verifiedAt ?? n.updatedAt]));
  const pageAt = new Map((opts.pages ?? []).map((p) => [docNodeId(p.id), p.updatedAt]));
  const meetAt = new Map((opts.meetings ?? []).map((m) => [meetingNodeId(m.id), m.startedAt]));

  const winFrom = Date.parse(opts.window?.from ?? timeline.from);
  const winTo = Date.parse(opts.window?.to ?? timeline.to);

  /** A node with no date cannot be placed on a time axis, so it is not drawn. */
  const dated: StorylineNode[] = [];
  for (const n of graph.nodes) {
    let from: string | undefined;
    let to: string | undefined;
    let segments: TimelineSegment[] | undefined;
    let stillOpen = false;

    if (n.kind === 'workitem') {
      const lane = laneOf.get(n.id);
      // No transitions in the window means the ticket did not exist as far as
      // this view is concerned. Drawing it at the left edge would be a lie.
      if (!lane?.segments.length) continue;

      const born = opts.created?.get(n.id);
      const head = lane.segments[0];
      // Start at the filing, not at the window edge — but never move a bar
      // *right* past evidence: if the log shows it already moving before the
      // recorded creation, the transition is the better fact.
      const start = born && head && born > head.from ? born : head?.from;

      /**
       * A node's extent is *when things happened to it*, not how long it has
       * existed.
       *
       * `buildTimeline` runs the last segment to `now`, because time-in-state
       * cares how long a ticket has been sitting. Drawing that stretches every
       * open ticket to today's right-hand edge, which is the wall of parallel
       * bars this lens exists to not be — and it says nothing, because *every*
       * open ticket reaches the edge, so the length encodes only "still open".
       *
       * So the extent ends at the last transition. How long it has been there
       * is the gap between that end and today, which is legible precisely
       * because most tickets no longer reach the edge. `open` carries the rest.
       */
      const tail = lane.segments.at(-1);
      const stop = tail?.current ? tail.from : tail?.to;

      // The trailing open-ended segment is not drawn — its right end is `now`
      // by construction and would put the tail back on the edge.
      segments = lane.segments
        .filter((sg) => !(tail?.current && sg === tail))
        .map((sg) => (sg === head && start ? { ...sg, from: start } : sg));
      // A ticket filed and closed inside one transition leaves nothing to draw.
      if (!segments.length && head) segments = [head];
      from = start;
      to = stop;
      stillOpen = tail?.current === true && tail.status !== 'done';
    } else {
      const at = noteAt.get(n.id) ?? pageAt.get(n.id) ?? meetAt.get(n.id);
      if (!at) continue;
      from = at;
      to = at;
    }
    if (!from || !to) continue;

    // Clip to the window; drop anything that misses it entirely.
    const a = Math.max(Date.parse(from), winFrom);
    const b = Math.min(Date.parse(to), winTo);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < winFrom || a > winTo) continue;

    /**
     * The item's own status, not the last segment's.
     *
     * They disagree by construction: a finished ticket has its trailing `done`
     * segment trimmed above, so `segments.at(-1)` is whatever it was doing
     * *before* it finished. Colouring a chip from that paints every closed
     * ticket as still in review.
     */
    const item = itemOf.get(n.id);
    const status = item?.status ?? n.status;

    dated.push({
      id: n.id,
      kind: n.kind,
      label: n.label,
      key: n.key,
      status,
      noteKind: n.noteKind,
      noteStatus: n.noteStatus,
      source: sourceOfNode(n.kind),
      degree: n.degree,
      from: new Date(a).toISOString(),
      to: new Date(b).toISOString(),
      point: n.kind !== 'workitem',
      segments,
      open: stillOpen,
      row: 0,
      lane: status === 'backlog' ? 'backlog' : 'timeline',
      sprint: item?.sprint,
    });
  }

  /**
   * Fold every reference onto the work item it references.
   *
   * `annotates`, `documents` and `mentions` all run ref → work item, and all
   * three mean the same thing: somebody wrote this down about that ticket. They
   * become marks on the ticket and their node disappears, which removes both
   * the line and the row it was placed on — and the row is the expensive half,
   * because packing a note wherever it fitted is what made the line travel a
   * median of seven rows in the first place.
   *
   * A reference with nothing visible to ride on is NOT folded. It keeps its own
   * dot, which is exactly right: "nothing links this" has to stay visible, and
   * it is the note `/tidy` should still be nagging about.
   */
  const byNodeId = new Map(dated.map((n) => [n.id, n]));
  const carried = new Map<string, StorylineEvidence[]>();
  const folded = new Set<string>();

  for (const e of graph.edges) {
    if (e.kind !== 'annotates' && e.kind !== 'documents' && e.kind !== 'mentions') continue;
    const ref = byNodeId.get(e.from);
    const subject = byNodeId.get(e.to);
    if (!ref || !subject) continue;
    if (ref.kind === 'workitem' || subject.kind !== 'workitem') continue;
    folded.add(ref.id);
    carried.set(subject.id, [
      ...(carried.get(subject.id) ?? []),
      {
        id: ref.id,
        kind: ref.kind as StorylineEvidence['kind'],
        label: ref.label,
        source: ref.source,
        at: ref.from,
        ref: recordOfNode(ref.id, ref.kind),
      },
    ]);
  }

  const kept = dated.filter((n) => !folded.has(n.id));
  for (const n of kept) {
    const mine = carried.get(n.id);
    // Newest first: the most recent thing said about a ticket is the one worth
    // seeing when the row only has space for three marks.
    if (mine?.length) n.evidence = [...mine].sort((a, b) => b.at.localeCompare(a.at));
  }

  const present = new Set(kept.map((n) => n.id));
  const edges: StorylineEdge[] = graph.edges
    .filter((e) => present.has(e.from) && present.has(e.to))
    .map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      asserts: e.asserts,
      inCycle: e.inCycle,
      onCriticalPath: e.onCriticalPath,
      provenance: e.provenance,
      confidence: e.confidence,
      basis: e.basis,
    }));

  // ---- row assignment -----------------------------------------------------
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    neighbours.set(e.from, [...(neighbours.get(e.from) ?? []), e.to]);
    neighbours.set(e.to, [...(neighbours.get(e.to) ?? []), e.from]);
  }

  const span = Math.max(winTo - winFrom, 1);
  const slot = (n: StorylineNode): [number, number] => {
    const a = (Date.parse(n.from) - winFrom) / span;
    const b = (Date.parse(n.to) - winFrom) / span;
    // Point nodes claim a nominal width so their labels do not collide.
    // A work item is drawn as a chip at its start with a thin tail, so what has
    // to stay clear is the chip — not the tail. Claiming at least a label's
    // width means two chips can never sit on top of each other, however short
    // the ticket's life was.
    return n.point
      ? [a - STORYLINE_POINT_WIDTH / 2, a + STORYLINE_POINT_WIDTH / 2]
      : [a, Math.max(b, a + STORYLINE_CHIP_WIDTH)];
  };

  /**
   * Work items first, then everything else, each group in time order. Putting
   * the bars down first gives the point nodes something to gravitate toward —
   * reversed, notes land in arbitrary rows and drag the tickets around them.
   */
  const order = [...kept].sort((x, y) => {
    if (x.point !== y.point) return x.point ? 1 : -1;
    const d = Date.parse(x.from) - Date.parse(y.from);
    return d !== 0 ? d : x.id.localeCompare(y.id);
  });

  const rowOf = new Map<string, number>();

  /**
   * Pack one band. Called once per lane, because the two bands are separate
   * vertical spaces — a backlog item must not be allotted a row on the strength
   * of a timeline item that happens to sit at another x.
   */
  const pack = (group: StorylineNode[]): void => {
    const placedRows = new Map<number, [number, number][]>();
    const free = (row: number, [a, b]: [number, number]): boolean =>
      !(placedRows.get(row) ?? []).some(([c, d]) => a < d && c < b);
    const inBand = new Set(group.map((n) => n.id));

    for (const n of group) {
      const s = slot(n);
      // Only neighbours in the SAME band count toward the barycentre. Row
      // numbers are per-band, so borrowing one across bands is arithmetic on
      // two different coordinate spaces: a single backlog item whose neighbour
      // sat on timeline row 6 was pushed to backlog row 6, leaving five empty
      // rows above it and a band seven deep to hold one chip.
      const known = (neighbours.get(n.id) ?? [])
        .filter((id) => inBand.has(id))
        .map((id) => rowOf.get(id))
        .filter((r): r is number => r !== undefined);
      const preferred = known.length
        ? Math.round(known.reduce((t, r) => t + r, 0) / known.length)
        : 0;

      /**
       * Search DOWNWARD from the preferred row, and never above row zero.
       *
       * Searching outward in both directions spends a row every time a
       * preferred slot is taken, and the cost lands where the work is densest:
       * fourteen recent nodes that all overlap in August each claimed a fresh
       * row, and those rows then ran empty across the five months to their
       * left. Filling downward keeps the band as shallow as the overlaps
       * genuinely require, and the barycentre still does the clustering.
       */
      let row = Math.max(preferred, 0);
      for (let d = 0; d < 600; d++) {
        if (free(row + d, s)) {
          row += d;
          break;
        }
      }
      rowOf.set(n.id, row);
      placedRows.set(row, [...(placedRows.get(row) ?? []), s]);
      n.row = row;
    }
  };

  pack(order.filter((n) => n.lane === 'timeline'));
  pack(order.filter((n) => n.lane === 'backlog'));

  /**
   * Squeeze out rows nobody landed in.
   *
   * The barycentre search walks outward from a preferred row, so a densely
   * connected graph leaves holes — rows claimed by nothing, between rows that
   * are full. Normalising by the minimum closes the gap at the top and leaves
   * every hole in the middle, which reads as a third of the lens being broken.
   * Renumbering to the rows actually used costs one pass and takes the fixture
   * from 35 rows to what it genuinely needs.
   */
  const compact = (group: StorylineNode[]): void => {
    const used = [...new Set(group.map((n) => n.row))].sort((a, b) => a - b);
    const rank = new Map(used.map((r, i) => [r, i]));
    for (const n of group) n.row = rank.get(n.row) ?? 0;
  };

  const onAxis = kept.filter((n) => n.lane === 'timeline');
  compact(onAxis);

  /**
   * The backlog is a band, not a bin.
   *
   * It sits below the sprints so it never reads as work in flight — but it is
   * still laid out ON the axis, at the date each item was filed. Parked in a
   * gutter at the left edge it lost the one fact it has: *when somebody decided
   * this could wait*. That is the interesting thing about a backlog item, and
   * the answer to "when did we first know about this" is a position, not a list.
   */
  const parked = kept.filter((n) => n.lane === 'backlog');
  compact(parked);

  /**
   * Sprint bands, derived rather than configured.
   *
   * A sprint starts when its first ticket appears and runs until the next one
   * starts — not until its own last ticket closes, because sprints carry work
   * over and overlapping bands would be unreadable exactly where the carry-over
   * happened. Jira owns the real dates; we do not mirror them, and a band that
   * is a day out is still the right answer to "which fortnight is this".
   */
  const bySprint = new Map<string, number[]>();
  for (const n of onAxis) {
    if (!n.sprint) continue;
    bySprint.set(n.sprint, [...(bySprint.get(n.sprint) ?? []), Date.parse(n.from)]);
  }
  /**
   * The MEDIAN start, not the earliest.
   *
   * A sprint is planned in one sitting, so most of its tickets share a start —
   * but carried-over work keeps the creation date it had in the sprint before.
   * Taking the minimum let one carry-over (MC-94 in the fixtures) drag Sprint
   * 14's boundary back onto Sprint 13's, which produced a zero-width band and
   * put the two sprints in the wrong order. The median ignores the outlier and
   * lands on the planning day.
   */
  const ordered = [...bySprint.entries()]
    .map(([name, ts]) => {
      const sorted = [...ts].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
      return [name, median] as [string, number];
    })
    .sort((a, b) => a[1] - b[1]);
  const sprints: StorylineSprint[] = ordered.map(([name, at], i) => ({
    name,
    from: new Date(Math.max(at, winFrom)).toISOString(),
    to: new Date(i + 1 < ordered.length ? ordered[i + 1]![1] : winTo).toISOString(),
  }));

  return {
    from: new Date(winFrom).toISOString(),
    to: new Date(winTo).toISOString(),
    nodes: kept,
    edges,
    // Only the cycles still fully on screen — half a loop is not a loop.
    cycles: graph.cycles.filter((c) => c.every((k) => present.has(k))),
    rows: onAxis.length ? Math.max(...onAxis.map((n) => n.row)) + 1 : 0,
    backlogRows: parked.length ? Math.max(...parked.map((n) => n.row)) + 1 : 0,
    sprints,
    references: [...carried.values()].reduce((n, list) => n + list.length, 0),
  };
}

// ---------------------------------------------------------------------------
// The dossier — one work item, every surface, in time order
// ---------------------------------------------------------------------------

/**
 * One thing somebody said or wrote about a work item, wherever they said it.
 *
 * Deliberately *not* `Evidence`. Evidence is what a proposal cites and it has
 * no clock — `at` on it is seconds into a recording, not a wall time. A trail
 * is ordered by definition, so `ts` is the point of the type: "Slack said
 * shipped on Monday, the stand-up said blocked on Tuesday" is only an answer
 * because of the two dates.
 */
export interface TrailEntry {
  surface: Owner;
  /** When it was said. Absent only for sources that genuinely have no clock. */
  ts?: string;
  label: string;
  quote?: string;
  url?: string;
  /** For transcripts: seconds into the recording, for a deep link. */
  at?: number;
  /** What this entry claims about the item's state, if anything. */
  signal?: Signal;
  /**
   * Enough to open this record where it lives. Absent when there is nothing to
   * open — a Jira transition is an event, not a document.
   */
  ref?: RecordRef;
  /**
   * Who said it. Absent for records nobody authored — a Confluence page has a
   * title, not a speaker, and a vault note belongs to the team.
   *
   * Carried on the entry rather than parsed back out of `label`. The label is a
   * string built for a human (`#eng-platform — sam`), and recovering fields
   * from it breaks the first time a channel name contains a dash.
   */
  who?: string;
  /** The channel or meeting it was said in, where there is one. */
  container?: { id: string; name: string };
}

/**
 * A pointer to one record inside the surface that owns it.
 *
 * This is what turns a quotation back into a place. Without it the trail is a
 * list of things people said with no way to go and read the rest of the
 * conversation, which is the complaint that started this: five panes that hold
 * the answer between them and no route from one to the next. `id` is the record
 * within the surface (a page, a transcript, a note) and `parentId` is its
 * container where one exists (a Slack channel), because a message id alone does
 * not say which channel to open.
 *
 * Deliberately narrow. It addresses a record, never a scroll position or a
 * selection — a link that tries to restore a viewport is a link that breaks the
 * first time the record's layout changes.
 */
export interface RecordRef {
  surface: Owner;
  id: string;
  /** The container: a Slack channel for a message, nothing for a page. */
  parentId?: string;
  /** Seconds into a recording, for a transcript segment. */
  at?: number;
}

/**
 * What a sentence asserts about whether the work is finished.
 *
 * Only two values, and no `progress`/`unknown` member, because the only thing
 * worth detecting here is disagreement. A sentence that says neither is not a
 * weaker signal, it is silence, and silence is `undefined`.
 */
export type Signal = 'done' | 'blocked';

/**
 * Negations are checked first and win, because "not done" contains "done" and
 * the cheap ordering gets it backwards. Everything here is deliberately narrow:
 * a missed claim costs a contradiction nobody sees, while a false one puts a
 * disagreement on screen that does not exist — and this feature's whole value
 * is that the banner is trustworthy.
 */
const NOT_DONE =
  /\b(?:not|isn'?t|aren'?t|ain'?t|did ?n'?t|never)\s+(?:yet\s+)?(?:quite\s+)?(?:done|shipped|finished|merged|deployed|land(?:ed)?|complete[d]?|out|live)\b|\bnot yet\b|\bstill (?:to|needs? to) (?:be )?(?:do|ship|land|merge)/i;

const BLOCKED =
  /\bblocked\b|\bblocker\b|\bwaiting on\b|\bstill waiting\b|\bstuck\b|\bcannot\b|\bcan'?t\b|\bchas(?:ed|ing)\b|\bheld up\b|\bon hold\b|\bhas ?n'?t (?:landed|shipped|arrived)\b|\bstill (?:blocked|open|outstanding)\b/i;

const DONE =
  /\bshipped\b|\bis done\b|\bare done\b|\ball done\b|\bdone\b|\bclos(?:ed|ing) (?:it )?out\b|\blanded\b|\bmerged\b|\bdeployed\b|\bfinished\b|\bcomplete[d]?\b|\bwrapped up\b|\bgone out\b|\bin production\b/i;

/**
 * What, if anything, a line of prose claims about the state of the work.
 *
 * A word list, with the same honest ceiling as `ACTION_CUE` in the extractor:
 * it will miss things. That is the right trade here — this drives a banner
 * asserting that two people disagree, and the failure mode of a loose matcher
 * is manufacturing an argument out of two people who agree.
 */
function classifySignal(text: string): Signal | undefined {
  if (NOT_DONE.test(text)) return 'blocked';
  if (BLOCKED.test(text)) return 'blocked';
  if (DONE.test(text)) return 'done';
  return undefined;
}

/**
 * Sentence ends, dashes, semicolons, and a comma before a coordinating
 * conjunction. Enough to separate "MC-91 and MC-93 are done" from "MC-94 is
 * still open" without pretending to parse English.
 */
const CLAUSE_SPLIT = /(?<=[.!?])\s+|\s*[—–;]\s*|,\s+(?=and\b|but\b|though\b|however\b)/;

/**
 * What a message claims *about one particular ticket*.
 *
 * The distinction is not academic, and getting it wrong is the failure that
 * makes this whole feature untrustworthy. A single Slack line routinely covers
 * several tickets and says opposite things about them:
 *
 *   "MC-91, MC-93 and MC-96 are done. Sprint 13 closes with MC-94 still open."
 *
 * Classifying that as one claim marks MC-91 as disputed — an argument nobody
 * had, shown on a banner whose only value is that it is believable. So the
 * message is split into clauses and only the ones naming this key are read.
 *
 * When the message mentions one key or none, there is nothing to disambiguate
 * and the whole text is used: a follow-up sentence with no key in it ("the
 * secret still has not arrived") is elaborating on the one that does.
 */
export function classifySignalFor(text: string, key?: WorkItemKey): Signal | undefined {
  if (!key) return classifySignal(text);
  if (extractKeys(text).length <= 1) return classifySignal(text);

  const mine = text.split(CLAUSE_SPLIT).filter((clause) => clause.includes(key));
  // It mentions other tickets and never this one in a clause of its own —
  // there is no honest way to attribute a claim, so make none.
  if (!mine.length) return undefined;
  return classifySignal(mine.join(' '));
}

/** Whether a Jira status is itself a claim of doneness. */
function statusSignal(status: WorkItemStatus): Signal | undefined {
  if (status === 'done') return 'done';
  if (status === 'blocked') return 'blocked';
  return undefined;
}

/**
 * Two records that cannot both be current.
 *
 * It never says which one is right — it cannot know, and guessing would make
 * the feature worse than useless. It puts both in front of the person who can
 * tell, with the dates, which is the entire ask from the planning call: "he
 * said it was done here, but there was still some sort of dependency".
 */
export interface Contradiction {
  claimsDone: TrailEntry;
  claimsBlocked: TrailEntry;
  /** Days between the two records, for "and the older one is a week stale". */
  apartDays: number | null;
  /** Which of the two is the more recent record. */
  latest: 'done' | 'blocked';
}

/**
 * Find every pair of records about one item that disagree about whether it is
 * finished.
 *
 * The Jira status is folded in as a trail entry by the caller rather than
 * special-cased here, so "Slack disagrees with the board" and "Slack disagrees
 * with the stand-up" come out of the same rule. Pairs are ranked by recency of
 * the newer half: a disagreement from this morning matters more than one from
 * three weeks ago, and a long tail of stale pairs is how a banner gets ignored.
 */
export function findContradictions(trail: TrailEntry[], limit = 3): Contradiction[] {
  const done = trail.filter((e) => e.signal === 'done');
  const blocked = trail.filter((e) => e.signal === 'blocked');
  const time = (e?: TrailEntry): number => {
    const t = e?.ts ? Date.parse(e.ts) : NaN;
    return Number.isFinite(t) ? t : 0;
  };

  const pairs: Contradiction[] = [];
  for (const d of done) {
    /**
     * One row per done-claim, against the NEWEST thing that disagrees with it.
     *
     * The cross-product is the obvious implementation and the wrong one: one
     * "it shipped" against three separate "still blocked" records renders as
     * three arguments when there is one, and the reader has to work out that
     * the left-hand side is the same sentence every time. The newest
     * counter-claim is also the only one that settles anything — it is what
     * decides whether the done-claim still stands.
     */
    let counter: TrailEntry | undefined;
    for (const b of blocked) {
      // A single sentence can trip both lists ("blocked, but the retry work is
      // done"); pairing it with itself is not a disagreement.
      if (d === b) continue;
      // Two records from one source at one instant are one record.
      if (d.surface === b.surface && d.ts && d.ts === b.ts) continue;
      if (!counter || time(b) > time(counter)) counter = b;
    }
    if (!counter) continue;

    const dt = time(d);
    const bt = time(counter);
    const both = dt > 0 && bt > 0;
    pairs.push({
      claimsDone: d,
      claimsBlocked: counter,
      apartDays: both ? Math.abs(dt - bt) / DAY_MS : null,
      latest: both ? (dt >= bt ? 'done' : 'blocked') : 'blocked',
    });
  }

  return pairs
    .sort((a, b) => Math.max(time(b.claimsDone), time(b.claimsBlocked)) - Math.max(time(a.claimsDone), time(a.claimsBlocked)))
    .slice(0, limit);
}

/**
 * The whole answer to "what's the latest on X" — every surface, one shape.
 *
 * Assembled server-side (`apps/gateway/src/issue.ts`) because it needs all five
 * connectors, the vault and the event log, none of which the browser has.
 * `/api/issue/:key` and the agent's `trace_entity` read the same object for the
 * reason the models live here: a screen and an answer that disagree are worse
 * than either alone.
 */
export interface IssueDossier {
  key: WorkItemKey;
  item?: WorkItem;
  /** Newest first — the question is always "what's the *latest*". */
  trail: TrailEntry[];
  contradictions: Contradiction[];
  /**
   * Direct neighbours in the relation graph, already labelled.
   *
   * `provenance` is absent on a link somebody wrote and `'inferred'` on one we
   * worked out, in which case `basis` says why. Whatever renders this must show
   * that difference: "MC-105 blocks this" and "we think MC-105 blocks this, because
   * the retro called it the dedupe cache" are not the same claim, and a reader
   * who cannot tell them apart will either trust both or neither.
   */
  related: RelatedRef[];
  /** Present only when the event log has transitions for this key. */
  lane?: TimelineLane;
  inCycle: WorkItemKey[][];
  /** How many records each surface contributed, for the "we read" strip. */
  counts: Partial<Record<Owner, number>>;
  /** Where the work came from, when anything says. See `DossierOrigin`. */
  origin?: DossierOrigin;
  /**
   * Who has said anything about this, and where they said it.
   *
   * Not a graph edge and deliberately not one — a person is not a node in
   * `buildRelationGraph`, and making them one would put every speaker on the
   * storyline. But "who has been in this conversation" is the relationship a
   * developer picking up a ticket asks about first after "what blocks it", and
   * it is free: the trail already carries the author of every record.
   */
  people: DossierPerson[];
  /** Slack channels this has been discussed in, newest first. */
  channels: DossierChannel[];
}

/** One person who appears in a work item's trail. */
export interface DossierPerson {
  name: string;
  /** Where they appeared, so a renderer can colour them by surface. */
  surfaces: Owner[];
  records: number;
  /** The last time they said anything about it. */
  lastAt?: string;
}

/** One Slack channel a work item has been discussed in. */
export interface DossierChannel {
  id: string;
  name: string;
  records: number;
  lastAt?: string;
}

/** One direct neighbour of a work item in the relation graph. */
export interface RelatedRef {
  id: string;
  kind: GraphNodeKind;
  label: string;
  via: GraphEdgeKind;
  asserts: Owner;
  provenance?: EdgeProvenance;
  confidence?: number;
  basis?: string;
  /** Status of the neighbour, when it is a work item. Absent for notes and pages. */
  status?: WorkItemStatus;
  /**
   * Which way the edge runs, from this item's point of view.
   *
   * `out` means this item is the `from` end. It is the difference between "this
   * blocks MC-102" and "MC-102 blocks this", which are opposite facts about
   * whose week is ruined — and the flat badge row that came before this drew
   * them identically. `blocks` runs blocker-first (see `GraphEdge`), so an
   * inbound `blocks` edge is the thing holding this item up.
   */
  direction: 'out' | 'in';
  /** Present only when the neighbour is a document with somewhere to open. */
  ref?: RecordRef;
}

/**
 * Where a piece of work came from.
 *
 * The question a developer picking up a ticket actually asks first, and the one
 * no single tool answers: a Jira ticket knows when it was filed and nothing
 * about why. The answer is usually a sentence in a planning call or a line in a
 * channel that predates the ticket by a day — which is exactly the kind of
 * record this system already holds and nothing else joins.
 *
 * `first` is the earliest thing anyone said about the key, in any of the five
 * surfaces or the vault — never the ticket's own creation event, which is our
 * bookkeeping rather than anybody's reason.
 *
 * `predatesTicket` is the sharp version of the same fact and is kept separate on
 * purpose. "First mentioned in Sprint 14 planning" is useful on any ticket;
 * "somebody was talking about this before there was a ticket to talk about" is
 * a much stronger claim, it is the one that makes the demo, and asserting it
 * when the conversation happened an hour AFTER the filing would be a lie told
 * by a rounding error. So the caller gets both and decides what to say.
 */
export interface DossierOrigin {
  /** When the ticket was filed, from the event log. */
  createdAt?: string;
  /** The oldest record that mentions this key, from any surface but Jira's own log. */
  first?: TrailEntry;
  /** True when `first` happened strictly before the ticket was filed. */
  predatesTicket?: boolean;
  /**
   * True when `first` is plausibly *why the ticket exists* rather than merely
   * the oldest record that survives about it.
   *
   * `predatesTicket` alone is too strict to answer that, and the fixtures prove
   * it: MC-103's planning call is stamped thirty-two seconds AFTER its creation
   * event, and it is unmistakably where the work came from. It is also too
   * generous in the other direction — every ticket has an oldest record, and on
   * a ticket closed six months ago it is routinely a retro note written days
   * afterwards. Calling that "where it came from" is the system inventing
   * provenance out of the last thing anybody said.
   *
   * So: at or around the filing (see `ORIGIN_GRACE_DAYS`) it is an origin; long
   * after it, it is just the earliest record, and the heading says so.
   */
  firstIsOrigin?: boolean;
  /** The epic this hangs off, already labelled. */
  epic?: { key: WorkItemKey; title: string };
  /** A spike this work was filed out of — a `sequence` edge pointing at it. */
  spike?: { key: WorkItemKey; title: string };
}

// ---------------------------------------------------------------------------
// One developer's lane — the front door before a ticket is picked
// ---------------------------------------------------------------------------

/**
 * Why a row is worth your attention, in one clause.
 *
 * A sprint board tells you a ticket is in progress. It cannot tell you that two
 * people disagree about whether it is finished, that it has not moved in a
 * fortnight, or that the thing it waits on is itself blocked. Those are joins
 * across surfaces, which is the only reason this app exists — so the lane leads
 * with them rather than with the status everybody already has.
 *
 * `tone` is severity and nothing else. It is deliberately not a colour name:
 * the stylesheet owns the palette, and a domain type that hard-codes "red" is a
 * domain type that has opinions about a stylesheet.
 */
export type WorkSignalKind =
  /** Two sources cannot both be right about whether this is done. */
  | 'disagreement'
  /** This item sits in a dependency cycle — nothing in the loop can start. */
  | 'cycle'
  /** Something this waits on is not finished. */
  | 'blocked_by'
  /** It has sat in the same status long enough to be worth saying out loud. */
  | 'aging'
  /** Nothing outside Jira has ever mentioned it. */
  | 'unwritten'
  /** People have been talking about it recently. */
  | 'activity';

export interface WorkSignal {
  kind: WorkSignalKind;
  /** The whole claim, already phrased: "3 days in review, 2 sources disagree". */
  text: string;
  tone: 'alarm' | 'warn' | 'info';
  /**
   * The records this signal was read from.
   *
   * Optional because a lane ROW does not need them — it has one line of space
   * and the claim is already phrased. An ALERT does: a page that says two
   * sources disagree and shows neither record is exactly the uncited assertion
   * this product exists not to be, and the detector is the only thing that knows
   * WHICH two records it meant.
   *
   * So the signal carries them and the row ignores them. Recomputing the pair
   * from the claim text at the alert layer is the alternative, and it is how a
   * row and the page it opens end up citing different records.
   */
  evidence?: Evidence[];
}

/** Severity order, so a lane can be ranked without a caller inventing one. */
export const WORK_SIGNAL_RANK: Record<WorkSignalKind, number> = {
  disagreement: 5,
  cycle: 4,
  blocked_by: 3,
  aging: 2,
  unwritten: 1,
  activity: 0,
};

/**
 * What the front door is a list of.
 *
 * WHY IT IS NOT A `WorkSignal`. `WorkRow` hangs signals off a `WorkItem`, and
 * the flagship finding — a commitment nobody ticketed — HAS no work item. That
 * is the entire point of it: the absence is the finding, and a type that can
 * only describe a ticket cannot describe the ticket that does not exist.
 *
 * So the subject is a union, and the detectors that already work keep working:
 * a `disagreement` or a `cycle` is a finding about a `workitem`, and the gap is
 * a finding about a `commitment`.
 */
export type FindingSubject =
  | { kind: 'workitem'; key: WorkItemKey }
  /** The ticket that does not exist. `noteId` is the promise it was made in. */
  | { kind: 'commitment'; noteId: string }
  | { kind: 'initiative'; id: string };

export type FindingKind =
  /** A promise with an owner and a date that never became a ticket. */
  | 'missing_ticket'
  /** Two sources cannot both be right about whether this is done. */
  | 'disagreement'
  /** Nothing in this loop can start. */
  | 'cycle'
  /** Declared in the tracker, corroborated by nothing, and the ends contradict. */
  | 'suspect_link'
  /** Reconstructed from evidence, and the tracker never recorded it. */
  | 'undetected_dependency'
  /** It has sat in one status long enough to say out loud. */
  | 'aging'
  /**
   * A promise whose ticket we can name, and nothing on any surface says so.
   *
   * The other half of `missing_ticket`, and it is a DIFFERENT claim rather than
   * a softer one. "Nobody filed this" and "this is almost certainly ORB-1438
   * and no record connects them" want different sentences, different evidence
   * and different buttons — one creates a ticket, the other links to one.
   * Collapsing them was the state before this existed, and it made the flagship
   * alert wrong about every promise discussed in a stand-up under a ticket
   * nobody said out loud.
   */
  | 'unlinked_commitment'
  /**
   * Promised out loud, its sprint still running, and nothing has named it
   * since — through however many meetings have happened in between.
   *
   * `missing_ticket` fires when a container CLOSES: the tracker never got it.
   * This fires while the container is still open: the CONVERSATION dropped it.
   * The two are mutually exclusive by construction on `container.state`, which
   * is why neither needs to know about the other.
   */
  | 'dropped_commitment';

/**
 * The two kinds that are COVERAGE, not interruptions — they belong on Sources.
 *
 * Four of the six are naturally bounded: one row per unticketed promise, per
 * done-claim, per loop, per stalled ticket. They stay small however large the
 * programme is. These two are different in kind — they fall straight out of the
 * graph's tiers, **one per edge**, so they scale with the number of dependency
 * links and with how well they are maintained. Measured on a synthetic
 * 5,000-issue import: 840 `undetected_dependency` and 268 `suspect_link`, on a
 * list whose whole promise is that the top row is the one to open.
 *
 * NOT A DEFECT IN THE DETECTORS. A declared link nothing corroborates genuinely
 * is a finding; there are simply hundreds of them, and the count depends on
 * exactly the link hygiene this product exists to expose. What is wrong is the
 * destination: they are facts about how settled the data is, which is the
 * question `DIRECTION.md` §6 gives Sources — and Sources already counts the
 * `AMBIGUOUS` edges they are derived from.
 *
 * They are still detected, still deduplicated, still suppressed by a dismissal,
 * and still reachable through `list_findings`. What changes is that they no
 * longer interrupt anybody.
 */
export const COVERAGE_KINDS: ReadonlySet<FindingKind> = new Set([
  'suspect_link',
  'undetected_dependency',
]);

/** Does this belong on the front door, or on Sources? */
export function isAlertKind(kind: FindingKind): boolean {
  return !COVERAGE_KINDS.has(kind);
}


/**
 * Severity, in the interface's own vocabulary rather than a second one.
 *
 * `DESIGN.md` §1 has exactly two colour languages and this is one of them, so a
 * finding carries `crit`/`warn`/`ok` and not `alarm`/`warn`/`info`. Translating
 * between two severity scales at each caller is how a row and the page it opens
 * end up disagreeing about how bad something is.
 */
export type FindingSeverity = 'crit' | 'warn' | 'ok';

export const FINDING_RANK: Record<FindingSeverity, number> = { crit: 2, warn: 1, ok: 0 };

export interface Finding {
  /** Stable across passes, so a finding can be deferred, dismissed and matched again. */
  id: string;
  kind: FindingKind;
  subject: FindingSubject;
  severity: FindingSeverity;
  /** One sentence, already phrased. The headline on the alert page. */
  claim: string;
  /** Why it matters, in a sentence or two. */
  impact: string;
  /** When the detector first saw it, not when the pass ran. */
  firedAt: string;
  /** What put it there. Indices are not enough — an alert is read cold. */
  evidence: Evidence[];
  /**
   * Deduplication across passes.
   *
   * Everything a scheduled pass emits needs one or two runs before lunch leave
   * two identical decisions, which is how a queue gets ignored — the same rule
   * `propose()` already enforces on proposals.
   */
  dedupeKey: string;
}

/**
 * Who an alert's message is addressed to, and where it would go.
 *
 * THE COMPLAINT THIS ANSWERS, verbatim: *"'Ask someone' — who am I sending a
 * message to, what message am I sending?"* The button named nobody, the
 * `post_message` payload had no recipient field at all, and the result strip
 * said "addressed to the people in the records above" over a payload that
 * carried a channel and a body and nothing else. The preview always names
 * them — *"Drafted to sam and dana in #eng-platform"*, *"addressed to Sanjay"*,
 * *"Drafted to dana"* — so this is the missing half of a design that was
 * already written down.
 *
 * ONE DEFINITION, HERE, because there were already two and the second one said
 * so out loud: `askChannel` in `Actions.tsx` re-derived the channel from the
 * same label `act.ts` parsed, under a comment reading *"deriving it twice is
 * how the button and the message it produces come to name different channels,
 * so if this ever needs more than the label, both should move to one place."*
 * It now needs more than the label.
 *
 * NOTHING IS INVENTED. Every name comes from a record: a Slack label is
 * `#channel — author`, a promise carries its `owner`, a ticket carries its
 * `assignee`. When no record names anybody, `to` is empty and the interface
 * says so rather than addressing a guess — the same rule that already stops
 * the channel being guessed.
 */
export interface AskAudience {
  /** The channel's NAME, for a reader: `orbit-delivery`. */
  channel?: string;
  /**
   * The channel's ID, for the write: `slack-orbit-delivery`.
   *
   * Both, because they are different strings and the app needs each. The name
   * is what a person recognises; `SlackConnector.post` takes the id and looks
   * the name up from it. Carrying only the name is how the page came to promise
   * #orbit-delivery over a write that went to `SLACK_DEFAULT_CHANNEL`.
   */
  channelId?: string;
  /**
   * The people, as a reader knows them, in the order the records mention them.
   *
   * NAMES, because that is what the labels now carry — `personName` resolves a
   * Slack author through the identity map before it reaches a label, so
   * "#orbit-delivery — Jonas Jost" is what this parses. Empty is a real answer.
   *
   * WORTH KNOWING BEFORE A REAL SLACK CONNECTOR SENDS ONE OF THESE: a name in
   * the body reads correctly and does not NOTIFY anybody. A live sender wants
   * `<@U…>`, and the way back is `Identities.canonical` — the same map that
   * produced the name knows the handle it came from.
   */
  to: string[];
}

/** `#orbit-delivery — jonas.jost` — the shape every Slack evidence label has. */
const SLACK_EVIDENCE_LABEL = /^#([^\s—]+)\s*—\s*(.+)$/;

export function askAudience(
  finding: Pick<Finding, 'evidence'>,
  from: { owner?: string; assignee?: string } = {},
): AskAudience {
  const slack = finding.evidence.filter((e) => e.surface === 'slack');

  const channel = slack.map((e) => /^#([^\s—]+)/.exec(e.label)?.[1]).find((c): c is string => !!c);
  const channelId = slack.find((e) => e.ref?.parentId)?.ref?.parentId;

  /**
   * The people who SAID the things this alert is built on, first.
   *
   * A disagreement is two colleagues who have not seen each other, so both are
   * named and in the order the evidence is ranked — newest first, which is the
   * order the alert already prints them in.
   */
  const authors = [
    ...new Set(
      slack.map((e) => SLACK_EVIDENCE_LABEL.exec(e.label)?.[2]?.trim()).filter((a): a is string => !!a),
    ),
  ];
  if (authors.length) return { ...(channel ? { channel } : {}), ...(channelId ? { channelId } : {}), to: authors };

  /**
   * Otherwise whoever the structured layer says owns it. A promise names the
   * person who took it; a ticket names its assignee. Neither is on a Slack
   * label, which is why the first branch cannot find them: a commitment alert
   * cites Zoom, and an aging one cites our own reading of Jira.
   */
  const owner = from.owner ?? from.assignee;
  return {
    ...(channel ? { channel } : {}),
    ...(channelId ? { channelId } : {}),
    to: owner ? [owner] : [],
  };
}

/** `a`, `a and b`, `a, b and c` — for a label and for a sentence. */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * How a time-in-status number was arrived at. There is no third option, and
 * there must not be a fourth state where a number exists without one of these.
 *
 *  - `measured`  the durable event log holds the transition into this status,
 *                so the number is exact.
 *  - `bounded`   no transition was ever observed, and the number is a LOWER
 *                BOUND read off the collector's `updatedAt`.
 *
 * The distinction has to survive all the way to the sentence a person reads —
 * *"41 days in in progress"* and *"at least 30 days in in progress"* are
 * different claims, and quietly rendering the second as the first is the kind
 * of confident overstatement that costs a detector its credibility.
 */
export type AgeBasis = 'measured' | 'bounded';

export interface WorkRow {
  item: WorkItem;
  /** Most severe first. Empty is a legitimate answer: nothing is wrong here. */
  signals: WorkSignal[];
  /** Records per surface, so the row can show what it is joined to. */
  counts: Partial<Record<Owner, number>>;
  /** The newest thing anyone said about it, anywhere. */
  lastActivity?: string;
  /** Days in the status it is in now. Absent means we do not know. */
  ageDays?: number;
  /** How `ageDays` was arrived at. Present exactly when `ageDays` is. */
  ageBasis?: AgeBasis;
  /** The dated fact `ageDays` counts from. Present exactly when `ageDays` is. */
  ageSince?: string;
}

/**
 * How long in each column before the lane says so out loud, and `null` for the
 * columns where the question is meaningless.
 *
 * THIS IS `aging`'s PRECISION GATE, and it is the same idea as `owner && dueAt`
 * on `missing_ticket`: the thing that stops a detector nagging about the normal
 * operation of a team. A single `AGING_DAYS = 7` across every column could not
 * express the one distinction that matters — `backlog` is the column whose
 * entire purpose is to hold work that is not moving, so *"16 days in backlog"*
 * is not a finding, it is a description of a backlog. It shipped as a live
 * alert on `fixtures-programme` and it was noise.
 *
 * The numbers are ordered by how much a person is already implicated. Review is
 * shortest because somebody has been asked and has not answered; blocked is a
 * working week, which is when an impediment stops being news and starts being
 * an escalation; `in_progress` is a fortnight, which is the user's own case —
 * *"if the ticket spends too long in the development … columns"*; `todo` is
 * longest because a ticket committed to a sprint and never started is a
 * planning fact rather than an execution one.
 *
 * Defaults, not the rule — `MC_AGING_DAYS` replaces them, for the same reason
 * `MC_STATUS_MAP` exists: how long is too long is a fact about one team's
 * cadence, not about this codebase.
 */
export type AgingDays = Record<WorkItemStatus, number | null>;

export const DEFAULT_AGING_DAYS: AgingDays = {
  in_review: 3,
  blocked: 5,
  in_progress: 10,
  todo: 14,
  /** Never. A backlog item ageing is what a backlog IS. */
  backlog: null,
  /** Never. Finished work has no duration worth interrupting somebody about. */
  done: null,
};

/**
 * How long this item has been where it is, and how sure we are of the number.
 *
 * ONE FUNCTION, SO A ROW AND ITS ALERT PAGE CANNOT DISAGREE. The lane builds a
 * `WorkSignal` and the findings pass copies `signal.text` into `Finding.impact`
 * verbatim, so both already read from one construction site; this sits above it
 * and makes the precedence a fact about the code rather than a convention two
 * callers happen to share.
 *
 * THE PRECEDENCE, and every rung is load-bearing:
 *
 *  1. A lane whose current status MATCHES the item's — `measured`. The log is
 *     the finer instrument and wins outright.
 *  2. A lane that DISAGREES with the item's status is discarded, and we fall
 *     through to the bound. The graph is the newer observation: the collector
 *     re-read the ticket this morning and the log stopped at whatever webhook
 *     last arrived. Measured on `fixtures-programme`, five of twenty-seven
 *     lanes disagreed and two of them shipped as findings that named a status
 *     the ticket was not in.
 *  3. `lastVendorUpdate` — `bounded`. See below for why this is honest.
 *  4. Neither — `undefined`. No number is claimed and no signal is raised.
 *
 * WHY `updatedAt` IS AN HONEST LOWER BOUND, having been correctly rejected as
 * an estimate. `work.ts` rejected it for reading time-in-status *as if* it were
 * time-since-transition, and that rejection stands. But every event that moves
 * `updatedAt` — a comment, a label, a rank, a worklog — moves it FORWARD, which
 * makes `now - updatedAt` SMALLER. A status change necessarily touches the
 * issue, so nothing can have left its status since `updatedAt`. The error is
 * one-directional: this can understate the wait and cannot overstate it. That
 * is precisely the property that makes "at least N days" sayable, and it is why
 * the wording is not optional.
 */
export function statusAgeOf(args: {
  item: WorkItem;
  lane?: Pick<TimelineLane, 'segments' | 'ageDays'>;
  /**
   * `StoredIssue.updatedAt` — the COLLECTOR'S, never `WorkItem.updatedAt`.
   *
   * The projection stamps `new Date().toISOString()` on an item whose collector
   * wrote no date, so reading it here would turn "we have no idea" into "zero
   * days", which is the fabrication this whole function is arranged to avoid.
   */
  lastVendorUpdate?: string;
  now: number;
}): { days: number; basis: AgeBasis; since: string } | undefined {
  const { item, lane, lastVendorUpdate, now } = args;

  const current = lane?.segments.at(-1);
  if (current?.current && current.status === item.status) {
    return { days: current.days, basis: 'measured', since: current.from };
  }

  if (lastVendorUpdate) {
    const since = Date.parse(lastVendorUpdate);
    if (Number.isFinite(since)) {
      return { days: (now - since) / DAY_MS, basis: 'bounded', since: lastVendorUpdate };
    }
  }

  return undefined;
}

/**
 * How a column is named in a sentence.
 *
 * `status.replace('_', ' ')` is what this used to be, and it produced *"16 days
 * in in progress"* and *"16 days in in review"* — which shipped. These are
 * phrases rather than labels precisely so the preposition can vary: `blocked`
 * does not take one and `backlog` takes an article.
 *
 * `in_progress` reads as "in development" because that is the word the workflow
 * uses and the word a person says out loud about it.
 */
export const COLUMN_PHRASE: Record<WorkItemStatus, string> = {
  in_progress: 'in development',
  in_review: 'in review',
  blocked: 'blocked',
  todo: 'in to-do',
  backlog: 'in the backlog',
  done: 'done',
};

/**
 * The sentence a row and an alert both use, so neither can word it differently.
 *
 * The "at least" is not decoration. A bounded number is a LOWER bound read off
 * `updatedAt`, and rendering it as a flat duration would claim we watched the
 * ticket sit there. Whatever else changes here, that qualifier and the date it
 * is bounded by must survive to the reader.
 */
export function statusAgeText(
  status: WorkItemStatus,
  age: { days: number; basis: AgeBasis; since: string },
): string {
  const n = Math.round(age.days);
  const where = COLUMN_PHRASE[status];
  return age.basis === 'measured'
    ? `${n} days ${where}`
    : `at least ${n} days ${where} — last touched ${age.since.slice(0, 10)}`;
}

/**
 * One person's work, ranked by what needs them rather than by status column.
 *
 * `people` rides along so a caller can offer the switch without a second
 * request — the set of assignees is a fact about the same list of items the
 * lane was built from, and fetching it separately is how the two drift.
 */
export interface WorkLane {
  assignee: string;
  people: string[];
  sprint?: string;
  rows: WorkRow[];
  /** Items in the sprint with nobody on them. Everyone's problem, so everyone sees it. */
  unassigned: WorkRow[];
}

/**
 * The agent's read on where a work item actually stands.
 *
 * WHY IT IS A SEPARATE OBJECT AND A SEPARATE ROUTE. Everything else in the
 * dossier is a record somebody wrote, assembled by rules you can read. This is
 * a model's opinion about those records, and mixing the two would make the
 * whole page as trustworthy as its least trustworthy part. It arrives after the
 * dossier, renders in its own card, and is labelled with the provider that
 * wrote it — the reader must always be able to tell "eleven records say this"
 * from "a model read eleven records and thinks this".
 *
 * It is also strictly optional. With no provider there is no summary and every
 * other section renders exactly as it did before — the same floor `extract.ts`
 * and `infer.ts` keep.
 *
 * `citations` are the join back to the evidence: indices into the dossier's own
 * `trail`, so a renderer can mark the exact rows the summary stands on. A
 * sentence about a ticket with nothing to point at is the failure mode of every
 * AI summary ever shipped, and it is the reason this one names its sources.
 *
 * Indices rather than labels, because labels repeat: two Slack lines from the
 * same person in the same channel are `#standup — sam` twice, and only the
 * position tells them apart. They are stable for as long as the summary is —
 * the cache key is the rendered brief, so a trail that changes invalidates the
 * summary that cited it.
 */
export interface IssueSummary {
  key: WorkItemKey;
  /** One sentence: what is true right now. */
  state: string;
  /** Why it is in that state, in two or three sentences. */
  why: string;
  /** What would actually move it, when the records support saying. */
  next?: string;
  /** What is uncertain, disputed, or worth not trusting. Often the best part. */
  watch?: string;
  /** Indices into `IssueDossier.trail` — the records this was drawn from. */
  citations: number[];
  /** Which provider wrote it, for the badge. Never presented as fact. */
  provider: string;
  generatedAt: string;
}

/**
 * Slack's `ts` is `<unix seconds>.<counter>`, not a date.
 *
 * `Date.parse` on one returns NaN, silently — which sorts every Slack line to
 * the bottom of a trail that is supposed to be newest-first, and drops the
 * timestamp that makes "he said it was done on Monday" an answer at all.
 * Returns undefined rather than falling back to now: an entry with no clock
 * must not be able to claim it is the most recent thing anyone said.
 */
export function slackTsToIso(ts?: string): string | undefined {
  const seconds = ts ? Number.parseFloat(ts) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1_000).toISOString();
}

/** Turn a transcript offset into a wall clock, so a segment can sort with Slack. */
export function segmentTime(startedAt: string, offsetSec: number): string | undefined {
  const base = Date.parse(startedAt);
  if (!Number.isFinite(base)) return undefined;
  return new Date(base + offsetSec * 1_000).toISOString();
}

/** Newest first, entries with no clock last — they cannot claim to be latest. */
export function byRecency(a: TrailEntry, b: TrailEntry): number {
  const at = a.ts ? Date.parse(a.ts) : NaN;
  const bt = b.ts ? Date.parse(b.ts) : NaN;
  if (!Number.isFinite(at) && !Number.isFinite(bt)) return 0;
  if (!Number.isFinite(at)) return 1;
  if (!Number.isFinite(bt)) return -1;
  return bt - at;
}

/** The Jira status as a trail entry, so it contradicts by the same rule as prose. */
export function statusEntry(item: WorkItem): TrailEntry {
  return {
    surface: 'jira',
    ts: item.updatedAt,
    label: `${item.key} — ${item.status.replace('_', ' ')}`,
    signal: statusSignal(item.status),
  };
}

// ---------------------------------------------------------------------------
// Chat transcript — what the user and the agent have already said
// ---------------------------------------------------------------------------

/**
 * One line of a Copilot conversation. Shared because the browser owns the
 * transcript (it is the thing being scrolled) but the agent needs it to answer
 * a follow-up, so it travels over the wire on every turn of a resumed chat.
 */
export interface ChatTurn {
  role: 'user' | 'agent';
  text: string;
}

/**
 * A conversation the agent is being asked to continue. `id` exists so a live
 * Copilot session can be kept per conversation rather than per process.
 */
export interface ChatThread {
  id: string;
  /** Prior turns, oldest first, already trimmed by the caller. */
  history: ChatTurn[];
}

/**
 * The transcript as the agent sees it. Deliberately shaped like `renderContext`
 * output — one block, no JSON — because it lands in the same prompt.
 */
export function renderHistory(history: ChatTurn[]): string {
  return history
    .filter((t) => t.text.trim())
    .map((t) => `${t.role === 'user' ? 'user' : 'you'}: ${t.text}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Context envelope — what the agent is told the reader is looking at
// ---------------------------------------------------------------------------

/**
 * Serialised into the agent's prompt on every turn. Keep it small: this is
 * spent tokens on every single message.
 */
export interface ContextEnvelope {
  /**
   * EVERY FIELD HERE IS OPTIONAL AND EVERY READ IN `renderContext` GUARDS.
   *
   * That was learned: the envelope once required `activeSurface` and
   * dereferenced `selection` and `recentEvents` unguarded, so `POST /api/chat`
   * with a partial envelope threw `Cannot read properties of undefined`. The
   * fix callers reached for was to fake a surface — `inspect.mjs` hardcoded
   * `activeSurface: 'jira'` and thereby told the agent, on every real turn, that
   * the user was looking at a Jira pane. Those four pane-era fields are gone
   * (`activeSurface`, `selection`, `timeRange`, `recentEvents`); what a caller
   * genuinely knows is below.
   */
  /**
   * The alert this conversation is about, when there is one.
   *
   * `DIRECTION.md` §8: "the alert-scoped conversation inherits its subject; the
   * global one starts cold", and §9's first rule for the chat is that it
   * already knows what you are looking at and you never restate it. That is
   * this field. A finding is not a `WorkItemKey` — the flagship one is about
   * the *absence* of one — so it cannot ride in `focusedKey`.
   */
  /**
   * `impact` rides along because for some kinds it IS the answer's shape.
   *
   * A `cycle` finding's impact is the ordered walk —
   * `in a dependency cycle — A → B → C → D → A` (`work.ts`, copied verbatim by
   * `findings.ts`) — and without it the agent is told "4 tickets are waiting on
   * each other" and not *which four* or *in what order*. It could go and find
   * out with a tool call, and against a prompt that says "be concise, lead with
   * the answer" it mostly does not. So the one rule the chat has about shapes —
   * draw it, do not describe it — was asking the model to draw something it had
   * never been shown.
   *
   * The browser fills it, not the gateway. `AskInline` was handed this exact
   * `Finding` by `GET /api/findings/:id`, so there is no second source for it to
   * disagree with — unlike `findings` below, where the gateway is the authority
   * because the list is the gateway's. Filling it server-side would mean a
   * findings pass on every alert-scoped turn, which the `if (!env.finding)`
   * guard there exists to skip.
   */
  finding?: { id: string; kind: string; claim: string; impact?: string };
  /**
   * The front door, when the conversation is NOT about one alert.
   *
   * §8's other half: "the global one starts cold". Cold turned out to mean
   * blind — asked what was most urgent, the agent answered from vault recall
   * and named a ticket that was not the list's top row, while the toolbar above
   * the composer said `Alerts 6`. Both answers were defensible, which is the
   * problem: `CLAUDE.md`'s standing rule is that an agent naming a different
   * "worst" than the screen is worse than either alone.
   *
   * It is context rather than a tool for the reason `skills.ts` is
   * deterministic — the agreement must not depend on the model remembering to
   * look. `list_findings` exists as well, for the questions this cannot answer.
   *
   * FILLED SERVER-SIDE, and only when `finding` is absent. On an alert the
   * other rows are noise, and the browser is not the authority on what the
   * front door says — the gateway computes it.
   */
  findings?: { id: string; kind: string; claim: string; severity: string }[];
  focusedKey?: WorkItemKey;
  /**
   * Notes pulled by `recall()` on the server for this turn. The browser never
   * fills this in — it does not have the vault, and it should not.
   */
  recalled?: RecalledNote[];
}

/** A note trimmed to what is worth spending prompt tokens on. */
export interface RecalledNote {
  id: string;
  kind: NoteKind;
  title: string;
  /** Already truncated by the recaller to fit the budget. */
  excerpt: string;
  relatedKeys: WorkItemKey[];
  /** So the agent can say "as of 3 sprints ago" instead of asserting it. */
  verifiedAt?: string;
  /**
   * Days since the claim was confirmed, set only once that is worth spending
   * tokens to say. Its presence is what turns the line's date into a warning.
   */
  staleDays?: number;
}

/**
 * One recalled note as it appears in the prompt.
 *
 * Exported because `recall()` measures its budget with this exact function.
 * The budget used to re-derive the markup length by hand and drifted ~19% under
 * the real cost; two call sites of one renderer cannot disagree.
 */
export function renderRecalledNote(n: RecalledNote): string {
  const keys = n.relatedKeys.length ? ` → ${n.relatedKeys.join(', ')}` : '';

  let age = '';
  if (n.staleDays !== undefined) {
    const when = n.verifiedAt ? n.verifiedAt.slice(0, 10) : 'never';
    const ago = Number.isFinite(n.staleDays) ? `, ${n.staleDays}d ago` : '';
    age = ` (verified ${when}${ago} — may be stale)`;
  } else if (n.verifiedAt) {
    age = ` (verified ${n.verifiedAt.slice(0, 10)})`;
  }

  return `  - [[${n.id}]] ${n.kind}: ${n.title}${keys}${age}\n      ${n.excerpt}`;
}

/**
 * Every field is optional and every read here guards.
 *
 * A caller that knows only what it is looking at should not have to invent a
 * surface, a selection and an event list to ask a question — and the version
 * that required them did not degrade when they were missing, it threw. Those
 * four fields are gone with the panes; every field below is optional and every
 * read guards, which is the property to preserve.
 */
export function renderContext(env: ContextEnvelope): string {
  const lines: string[] = [];
  if (env.finding) {
    lines.push(
      `the alert being discussed: ${env.finding.claim} (${env.finding.kind})`,
      // The detector's own sentence about why this matters — and for a cycle it
      // carries the ordered walk, which is the shape the answer is supposed to
      // draw. Printed under the claim rather than beside it because it
      // elaborates on the claim; a reader of this prompt should meet them in
      // that order.
      ...(env.finding.impact ? [`why it matters: ${env.finding.impact}`] : []),
      'The question is about that alert unless it plainly is not. Do not ask which one.',
    );
  }
  if (env.findings?.length) {
    lines.push(
      `the alert list in front of them right now, worst first (${env.findings.length} shown):`,
    );
    for (const f of env.findings) lines.push(`  - [${f.severity}] ${f.claim} (${f.kind})`);
    lines.push(
      'Asked what is most urgent or what needs them, answer from THIS list and in ' +
        'this order. It is what they are looking at. Say so if something in your ' +
        'vault suggests a different priority — do not silently substitute it.',
    );
  }
  if (env.focusedKey) lines.push(`focused: ${env.focusedKey}`);
  if (env.recalled?.length) {
    lines.push('from your vault (cite these as [[id]] — they are memory, not fact):');
    for (const n of env.recalled) lines.push(renderRecalledNote(n));
  }
  return lines.join('\n');
}
