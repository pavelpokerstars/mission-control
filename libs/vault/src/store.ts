/**
 * The vault store — markdown files on disk, cached in memory.
 *
 * Layout, which is the `raw/` → `wiki/` split applied to what we already have:
 *
 *   vault/
 *     notes/<id>.md     the refined half — curated, editable, wikilinked
 *     raw/events.jsonl  the immutable half — the McEvent stream, append-only
 *
 * The event log in `events.ts` is capped at 5,000 entries and dies with the
 * process, which is fine for echo suppression and useless as history. Mirroring
 * it to JSONL is what lets a trail reach past the current session, and what
 * gives consolidation something to read.
 *
 * SINGLE WRITER. This app has exactly one user, so there is no locking, no
 * merge, no conflict resolution — the entire class of problems that makes
 * shared knowledge bases hard is simply absent. Notes are cached in memory and
 * written through on every mutation. If that assumption ever changes, this file
 * is where it breaks first.
 */

import { mkdir, readFile, readdir, writeFile, unlink, appendFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  assertVaultSafe,
  CONFIDENCE_TIERS,
  extractLinks,
  slugify,
  type ConfidenceTier,
  type Evidence,
  type KeyJoin,
  type McEvent,
  type Note,
  type NoteDraft,
  type NoteKind,
  type NoteStatus,
  type Recency,
  type WorkItemKey,
} from '@mc/domain';
import { parse, stringify, type Frontmatter } from './frontmatter.js';

const NOTES_DIR = 'notes';
const RAW_DIR = 'raw';
const EVENTS_FILE = 'events.jsonl';

// ---------------------------------------------------------------------------
// Note <-> file
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return typeof v === 'string' && v ? [v] : [];
}

function asEvidence(v: unknown): Evidence[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw) => {
    if (typeof raw !== 'object' || raw === null) return [];
    const e = raw as Record<string, unknown>;
    if (typeof e.surface !== 'string' || typeof e.label !== 'string') return [];
    return [e as unknown as Evidence];
  });
}

/**
 * `joins` back into a keyed record.
 *
 * Stored as a LIST of `{key, tier, why}` rather than a mapping, because the
 * frontmatter parser deliberately has no nested-mapping support — the same
 * reason `evidence` is a list of flow mappings. A row without a `key` or a
 * recognised `tier` is dropped rather than taking the note down: losing one
 * join's provenance degrades it to "extracted", which is the safe direction,
 * and losing the note is not.
 */
function asJoins(v: unknown): Note['joins'] {
  if (!Array.isArray(v)) return undefined;
  const out: Record<string, KeyJoin> = {};
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key : undefined;
    const tier = typeof r.tier === 'string' ? r.tier : undefined;
    if (!key || !tier || !CONFIDENCE_TIERS.includes(tier as ConfidenceTier)) continue;
    out[key] = {
      tier: tier as ConfidenceTier,
      ...(typeof r.why === 'string' && r.why ? { why: r.why } : {}),
      ...(typeof r.confidence === 'number' ? { confidence: r.confidence } : {}),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export function decodeNote(id: string, source: string): Note {
  const { data, body } = parse(source);
  const now = new Date().toISOString();
  return {
    id: asString(data.id, id),
    kind: asString(data.kind, 'idea') as NoteKind,
    title: asString(data.title, id),
    relatedKeys: asStringArray(data.relatedKeys),
    // Per-key join provenance. A flow mapping, the same trick `evidence` uses:
    // valid YAML that JSON.parse reads, so the parser needs no nested-mapping
    // support. Absent for every note whose keys were read straight out of the
    // text, which is the common case and the cheap one.
    joins: asJoins(data.joins),
    about: asString(data.about) || undefined,
    owner: asString(data.owner) || undefined,
    dueAt: asString(data.dueAt) || undefined,
    container: asString(data.container) || undefined,
    // Links are derived from the body, never trusted from frontmatter — that
    // way an edit in Obsidian cannot desync them.
    links: extractLinks(body),
    tags: asStringArray(data.tags),
    recency: asString(data.recency, 'dated') as Recency,
    verifiedAt: asString(data.verifiedAt) || undefined,
    status: asString(data.status, 'open') as NoteStatus,
    evidence: asEvidence(data.evidence),
    promotedTo: (() => {
      const raw = data.promotedTo;
      if (!Array.isArray(raw) || raw.length === 0) return undefined;
      return raw[0] as Note['promotedTo'];
    })(),
    createdAt: asString(data.createdAt, now),
    updatedAt: asString(data.updatedAt, now),
    body,
  };
}

/**
 * `links` is deliberately NOT written.
 *
 * `decodeNote` derives it from the body with `extractLinks` and ignores
 * whatever frontmatter says, so a stored copy is write-only: read back never,
 * overwritten on the next save, and free to disagree with the body in between.
 * Three of the six seed notes had drifted exactly that way — the frontmatter
 * naming one note while the body linked another — which is misleading to read
 * and impossible to trust.
 *
 * Storing a derived field is what made that possible, so the fix is to stop
 * storing it rather than to correct the three copies. Nothing is lost: Obsidian
 * and every other reader parse `[[wikilinks]]` out of the body, which is where
 * the truth already was.
 */
export function encodeNote(note: Note): string {
  const data: Frontmatter = {
    id: note.id,
    kind: note.kind,
    title: note.title,
    status: note.status,
    recency: note.recency,
    relatedKeys: note.relatedKeys,
    tags: note.tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  if (note.verifiedAt) data.verifiedAt = note.verifiedAt;
  if (note.about) data.about = note.about;
  if (note.owner) data.owner = note.owner;
  if (note.dueAt) data.dueAt = note.dueAt;
  if (note.container) data.container = note.container;
  // Written as one flow mapping per key so the file stays hand-editable and the
  // parser stays flat. Omitted entirely when every join was extracted, which
  // keeps the frontmatter of an ordinary note exactly as it was.
  if (note.joins && Object.keys(note.joins).length) {
    data.joins = Object.entries(note.joins).map(([key, j]) => ({ key, ...j })) as unknown as Record<
      string,
      unknown
    >[];
  }
  if (note.evidence.length) data.evidence = note.evidence as unknown as Record<string, unknown>[];
  if (note.promotedTo) data.promotedTo = [note.promotedTo as unknown as Record<string, unknown>];
  return stringify(data, note.body);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface NoteFilter {
  kind?: NoteKind;
  status?: NoteStatus;
  key?: WorkItemKey;
  tag?: string;
  /** Substring match over title and body. */
  q?: string;
}

export interface EventFilter {
  source?: string;
  key?: WorkItemKey;
  /** ISO timestamp — events at or after this. */
  since?: string;
  limit?: number;
}

export class VaultStore {
  private notes = new Map<string, Note>();

  /**
   * Serialises every write to events.jsonl. Appends are fire-and-forget and a
   * rewrite (edit, delete, clear) reads the whole file first — without a queue,
   * an append landing mid-rewrite is silently dropped when the rewrite lands.
   * Rare, but the log is the evidence base and losing entries invisibly is the
   * exact failure it must not have.
   */
  private logQueue: Promise<void> = Promise.resolve();

  constructor(readonly root: string) {}

  private path(id: string): string {
    return join(this.root, NOTES_DIR, `${id}.md`);
  }

  private get eventsPath(): string {
    return join(this.root, RAW_DIR, EVENTS_FILE);
  }

  private enqueueLog(job: () => Promise<void>): Promise<void> {
    this.logQueue = this.logQueue.then(job, job);
    return this.logQueue;
  }

  async init(): Promise<this> {
    await mkdir(join(this.root, NOTES_DIR), { recursive: true });
    await mkdir(join(this.root, RAW_DIR), { recursive: true });

    const files = await readdir(join(this.root, NOTES_DIR)).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const id = file.slice(0, -3);
      try {
        this.notes.set(id, decodeNote(id, await readFile(this.path(id), 'utf8')));
      } catch (err) {
        // One unparseable file must not take the vault down. Skip it loudly.
        console.warn(`[vault] skipping ${file}: ${String(err)}`);
      }
    }
    return this;
  }

  list(filter: NoteFilter = {}): Note[] {
    const q = filter.q?.toLowerCase();
    return [...this.notes.values()]
      .filter((n) => {
        if (filter.kind && n.kind !== filter.kind) return false;
        if (filter.status && n.status !== filter.status) return false;
        if (filter.key && !n.relatedKeys.includes(filter.key)) return false;
        if (filter.tag && !n.tags.includes(filter.tag)) return false;
        if (q && !(`${n.title}\n${n.body}`.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  /** Notes that link to `id`. How patterns surface, and what `/tidy` reads. */
  backlinks(id: string): Note[] {
    return [...this.notes.values()].filter((n) => n.links.includes(id));
  }

  private uniqueId(title: string): string {
    const base = slugify(title) || 'note';
    if (!this.notes.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base}-${i}`;
      if (!this.notes.has(candidate)) return candidate;
    }
  }

  async create(draft: NoteDraft): Promise<Note> {
    const now = new Date().toISOString();
    const body = draft.body ?? '';

    // An explicit id that already exists is a mistake, and it used to be a
    // silent, destructive one: the write path does not merge, so creating over
    // an existing note replaced it wholesale — a `POST` carrying only `{id,
    // body}` left a note with no kind and no title, which then crashed anything
    // that tokenised a title.
    //
    // Generated ids cannot collide (`uniqueId` suffixes until free). Explicit
    // ones became routine when skills started keeping stable per-meeting notes
    // like `workshop-zoom-001`, so this stopped being theoretical. Update takes
    // a patch; create means create.
    if (draft.id) {
      const id = slugify(draft.id);
      if (this.notes.has(id)) {
        throw new Error(`note ${id} already exists — use update() to change it`);
      }
    }

    const note: Note = {
      id: draft.id ? slugify(draft.id) : this.uniqueId(draft.title),
      kind: draft.kind,
      title: draft.title,
      relatedKeys: draft.relatedKeys ?? [],
      links: extractLinks(body),
      tags: draft.tags ?? [],
      recency: draft.recency ?? 'dated',
      // A dated note needs a date, and "now" is the honest one at creation.
      verifiedAt: draft.verifiedAt ?? ((draft.recency ?? 'dated') === 'dated' ? now : undefined),
      status: draft.status ?? 'open',
      evidence: draft.evidence ?? [],
      promotedTo: draft.promotedTo,
      // Spread rather than listed: this object is built field by field so that a
      // partial draft cannot leave a note half-formed, and the cost of that is
      // that a field added to `Note` and not added here is silently dropped on
      // every create. These four are optional, so the drop is invisible — the
      // note saves, reads back, and is simply missing the thing the detector
      // needed. `update` takes a patch and never had the problem.
      ...(draft.about ? { about: draft.about } : {}),
      ...(draft.owner ? { owner: draft.owner } : {}),
      ...(draft.dueAt ? { dueAt: draft.dueAt } : {}),
      ...(draft.container ? { container: draft.container } : {}),
      ...(draft.joins ? { joins: draft.joins } : {}),
      createdAt: now,
      updatedAt: now,
      body,
    };

    assertVaultSafe(note);
    await this.write(note);
    return note;
  }

  async update(id: string, patch: Partial<Note>): Promise<Note> {
    const existing = this.notes.get(id);
    if (!existing) throw new Error(`no such note: ${id}`);

    const body = patch.body ?? existing.body;
    const next: Note = {
      ...existing,
      ...patch,
      // Identity and creation time are not patchable.
      id: existing.id,
      createdAt: existing.createdAt,
      body,
      links: extractLinks(body),
      updatedAt: new Date().toISOString(),
    };

    assertVaultSafe(next);
    await this.write(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    this.notes.delete(id);
    await unlink(this.path(id)).catch(() => undefined);
  }

  private async write(note: Note): Promise<void> {
    this.notes.set(note.id, note);
    await writeFile(this.path(note.id), encodeNote(note), 'utf8');
  }

  // -- the raw half ---------------------------------------------------------

  /**
   * Mirror an event to durable storage. Deliberately fire-and-forget from the
   * caller's perspective: losing a log line is survivable, blocking the event
   * bus on a disk write is not.
   */
  async appendEvent(event: McEvent): Promise<void> {
    await this.enqueueLog(() =>
      appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8').catch((err: unknown) =>
        console.warn(`[vault] event not persisted: ${String(err)}`),
      ),
    );
  }

  /** Every persisted event, oldest first — the on-disk order. */
  private async allEvents(): Promise<McEvent[]> {
    const raw = await readFile(this.eventsPath, 'utf8').catch(() => '');
    if (!raw) return [];
    const out: McEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as McEvent);
      } catch {
        /* a torn final line from a crashed append — skip it */
      }
    }
    return out;
  }

  /**
   * Rewrite the log atomically: write a sibling temp file, then rename over the
   * original. A crash mid-write leaves the old log intact rather than a
   * half-truncated one.
   */
  private async rewriteEvents(events: McEvent[]): Promise<void> {
    const tmp = `${this.eventsPath}.tmp`;
    const body = events.map((e) => JSON.stringify(e)).join('\n');
    await writeFile(tmp, body ? `${body}\n` : '', 'utf8');
    await rename(tmp, this.eventsPath);
  }

  /** Drop entries by id. Returns how many actually went. */
  async deleteEvents(ids: string[]): Promise<number> {
    const doomed = new Set(ids);
    let removed = 0;
    await this.enqueueLog(async () => {
      const events = await this.allEvents();
      const kept = events.filter((e) => !doomed.has(e.id));
      removed = events.length - kept.length;
      if (removed > 0) await this.rewriteEvents(kept);
    });
    return removed;
  }

  /** Empty the persisted log. The in-memory EventLog is untouched. */
  async clearEvents(): Promise<number> {
    let removed = 0;
    await this.enqueueLog(async () => {
      removed = (await this.allEvents()).length;
      await this.rewriteEvents([]);
    });
    return removed;
  }

  /**
   * Read persisted events, newest first.
   *
   * Reads and parses the whole file. That is fine at one user's scale and would
   * not be at a team's — the fix when it hurts is a date-partitioned file per
   * day, not an index.
   */
  async readEvents(filter: EventFilter = {}): Promise<McEvent[]> {
    const out = (await this.allEvents()).filter((e) => {
      if (filter.source && e.source !== filter.source) return false;
      if (filter.key && e.entityKey !== filter.key) return false;
      if (filter.since && e.ts < filter.since) return false;
      return true;
    });
    out.reverse();
    return filter.limit ? out.slice(0, filter.limit) : out;
  }
}

export async function openVault(root: string): Promise<VaultStore> {
  return new VaultStore(root).init();
}
