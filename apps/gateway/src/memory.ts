/**
 * How the vault reaches the surfaces, in both directions.
 *
 * Until now memory only moved one way and only on request: you opened a note,
 * or you asked the agent and `recall()` pushed a few notes into the prompt.
 * Both require you to already be in Mission Control, already wondering.
 * A second brain that only speaks when spoken to is a search engine.
 *
 * So:
 *
 *   OUT — `surfaceMemory` comments on a Jira ticket at the moment somebody
 *         starts work on it, if the vault knows something they should read
 *         first. The memory arrives where the decision is being made.
 *
 *   IN  — `capture` turns a Slack message into a note without anybody opening
 *         this app. Knowledge bases die of capture friction long before they
 *         die of anything else.
 *
 * WHY THE OUTBOUND HALF NEEDS NO PROPOSAL. Look at `FIELD_OWNER`: a comment is
 * not in it, because no surface owns a comment as *state*. Posting one changes
 * nothing, cannot start a sync war, and cannot make the vault a second source
 * of truth about the work. Every other outbound write in this system creates or
 * changes something and is gated by a human; this one only talks.
 */

import {
  extractKeys,
  newEvent,
  slackTsToIso,
  stalenessOf,
  type Note,
  type NoteKind,
  type WorkItemKey,
  type WorkItemStatus,
} from '@mc/domain';
import type { Connectors } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import { eventLog } from './events.js';
import { emitVaultEvent } from './vault.js';

// ---------------------------------------------------------------------------
// OUT — the vault speaks into Jira
// ---------------------------------------------------------------------------

/**
 * The two transitions where remembering something changes what a human does
 * next. Everything else is noise, and a bot that comments on every transition
 * gets muted in a week — at which point it may as well not exist.
 *
 *   in_progress — somebody is starting. This is the last moment a warning is
 *                 cheap: "the thing you are about to build is blocked behind
 *                 MC-103" costs nothing now and a day tomorrow.
 *   blocked     — somebody just hit the wall. If the vault has seen this shape
 *                 of wall before, that is the single most useful sentence
 *                 anybody can say to them.
 */
const SPEAK_ON: ReadonlySet<WorkItemStatus> = new Set<WorkItemStatus>(['in_progress', 'blocked']);

/** Notes worth interrupting a human for. A `person` note is not one. */
const WORTH_SAYING: ReadonlySet<NoteKind> = new Set<NoteKind>([
  'impediment',
  'commitment',
  'decision',
  'pattern',
]);

/**
 * Rank the candidates. An open impediment beats a resolved one; a note that
 * links to a `pattern` beats one that does not, because "this keeps happening"
 * is the claim no other surface can make.
 */
function pickNote(vault: VaultStore, key: WorkItemKey): Note | undefined {
  const candidates = vault.list({ key }).filter((n) => WORTH_SAYING.has(n.kind));
  if (!candidates.length) return undefined;

  const score = (n: Note): number => {
    let s = 0;
    if (n.status === 'open') s += 4;
    if (n.kind === 'impediment' || n.kind === 'pattern') s += 2;
    if (n.links.some((id) => vault.get(id)?.kind === 'pattern')) s += 3;
    // A claim nobody has checked in six sprints is a worse thing to interrupt
    // somebody with than one confirmed last week. It can still win; it starts
    // behind.
    s -= stalenessOf(n).decay * 2;
    return s;
  };

  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

/** The comment body. Written to be read by a person on a Jira ticket. */
function composeComment(vault: VaultStore, note: Note, status: WorkItemStatus): string {
  const decay = stalenessOf(note);
  const opening =
    status === 'blocked'
      ? 'Mission Control has seen this before.'
      : 'Before you start — Mission Control remembers something about this one.';

  const excerpt = note.body.split(/\n\s*\n/).find((p) => p.trim())?.trim().replace(/\s+/g, ' ') ?? '';

  const lines = [
    opening,
    '',
    `**[[${note.id}]]** — ${note.kind}${
      note.verifiedAt && !decay.stale ? ` (verified ${note.verifiedAt.slice(0, 10)})` : ''
    }`,
    `> ${excerpt.slice(0, 300)}`,
  ];

  // The recurrence claim, if the scrum master made it. This is a judgement
  // somebody recorded deliberately, not a count we inferred.
  for (const id of note.links) {
    const linked = vault.get(id);
    if (linked?.kind === 'pattern') {
      lines.push('', `This is an instance of **[[${linked.id}]]** — ${linked.title}.`);
    }
  }

  if (decay.stale) {
    const age = Number.isFinite(decay.days) ? `${Math.round(decay.days)} days` : 'a long time';
    lines.push('', `_Nobody has confirmed this in ${age}, so treat it as a lead rather than a fact._`);
  }

  lines.push(
    '',
    '_No field was changed — this is memory, not a status update. Resolve the note in Mission Control if it no longer applies._',
  );
  return lines.join('\n');
}

/**
 * Have we already said this note on this ticket?
 *
 * Read from the durable log rather than a process-local set, so a gateway
 * restart does not make the bot repeat itself — which is exactly the behaviour
 * that teaches people to ignore it.
 */
async function alreadySaid(vault: VaultStore, key: WorkItemKey, noteId: string): Promise<boolean> {
  const prior = await vault.readEvents({ key, limit: 500 });
  return prior.some(
    (e) => e.type === 'mc.memory_surfaced' && (e.payload as { noteId?: string }).noteId === noteId,
  );
}

/**
 * Called from the sync layer on a status change. Returns the note it surfaced,
 * or undefined when it decided to keep quiet — which is most of the time, and
 * deliberately so.
 */
export async function surfaceMemory(
  c: Connectors,
  vault: VaultStore,
  input: { key: WorkItemKey; status: WorkItemStatus; causedBy: string },
): Promise<Note | undefined> {
  if (!SPEAK_ON.has(input.status)) return undefined;

  const note = pickNote(vault, input.key);
  if (!note) return undefined;
  if (await alreadySaid(vault, input.key, note.id)) return undefined;

  // Same stamp as every other outbound write. A Jira comment webhook coming
  // back at us must not read as a fresh human event.
  eventLog.markOutbound(input.causedBy);
  await c.jira.comment(input.key, composeComment(vault, note, input.status));

  eventLog.append(
    newEvent({
      source: 'vault',
      type: 'mc.memory_surfaced',
      entityKey: input.key,
      payload: { noteId: note.id, title: note.title, into: 'jira', because: input.status },
      causedBy: input.causedBy,
    }),
  );
  return note;
}

// ---------------------------------------------------------------------------
// IN — Slack becomes a note
// ---------------------------------------------------------------------------

/**
 * Deliberately simple heuristics, in the same spirit as the transcript reader:
 * a mock path you can read and predict beats a clever one you cannot debug. The
 * kind is a starting guess, and correcting it is a `PATCH /api/vault/notes/:id`
 * — the note page edits the title, the body and when it comes back, and not the
 * kind.
 */
const DECISION = /\b(we decided|decision|agreed|we'?ll go with|going with|chose)\b/i;
const IMPEDIMENT = /\b(blocked|blocking|stuck|waiting on|can'?t|cannot|no response|chas(?:ing|ed))\b/i;
const COMMITMENT = /\b(i'?ll|i will|we'?ll|will take|takes|owns?|by (?:mon|tue|wed|thu|fri|eod|end of))\b/i;

function inferKind(text: string): NoteKind {
  if (DECISION.test(text)) return 'decision';
  if (IMPEDIMENT.test(text)) return 'impediment';
  if (COMMITMENT.test(text)) return 'commitment';
  return 'idea';
}

/** `/mc remember X`, `/mc note X`, `/mc X` → `X`. Plain text passes through. */
function stripCommand(text: string): string {
  return text.replace(/^\s*\/?mc\b\s*(remember|note|capture)?\s*/i, '').trim();
}

export interface CaptureInput {
  text: string;
  author?: string;
  channelId?: string;
  channelName?: string;
  /** Slack message timestamp, when capturing an existing message. */
  ts?: string;
}

/**
 * Turn a Slack message into a vault note.
 *
 * The note is `dated` and verified as of when the message was sent, not as of
 * now: it records what somebody said at a moment. That is what makes decay work
 * on captured material — an idea someone floated three months ago should not be
 * handed to the agent as though it were current thinking.
 */
export async function capture(vault: VaultStore, input: CaptureInput): Promise<Note> {
  const text = stripCommand(input.text);
  if (!text) throw new Error('nothing to capture');

  // Undated falls back to now here — a captured note needs a verifiedAt for
  // the decay model, and 'undefined' is not a date the vault can rank.
  const at = slackTsToIso(input.ts) ?? new Date().toISOString();
  const where = input.channelName ? `#${input.channelName}` : (input.channelId ?? 'slack');
  const who = input.author ?? 'someone';

  const note = await vault.create({
    kind: inferKind(text),
    title: text.split(/(?<=[.!?])\s|\n/)[0]?.slice(0, 80) || text.slice(0, 80),
    recency: 'dated',
    verifiedAt: at,
    relatedKeys: extractKeys(text),
    tags: ['from-slack'],
    evidence: [{ surface: 'slack', label: `${where} — ${who}`, quote: text.slice(0, 300) }],
    // Quoted, not restated. The raw message is the evidence; the body above it
    // is where the scrum master writes what it *meant*, which is the only thing
    // the vault is actually for.
    body: [
      `_Captured from ${where}. Replace this line with what it meant._`,
      '',
      `> ${text}`,
      '',
      `— ${who}, ${at.slice(0, 10)}`,
    ].join('\n'),
  });

  emitVaultEvent('note.created', note, { by: 'slack-capture', channel: input.channelId });
  return note;
}
