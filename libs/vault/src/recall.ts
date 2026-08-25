/**
 * Recall — choosing the few notes worth spending prompt tokens on.
 *
 * This runs on every single agent turn, which sets the whole design:
 *
 *  - THERE IS A HARD CHARACTER BUDGET, not a note limit. `ContextEnvelope` is
 *    serialised into the prompt each turn, and its own doc comment says to keep
 *    it small. A budget in notes lets one rambling note blow that; a budget in
 *    characters cannot.
 *
 *  - IT FAILS CLOSED. A recall that throws must degrade to "no memory this
 *    turn", never to a broken turn. Nothing in here throws.
 *
 *  - THE JOIN KEY DOMINATES. A note tagged MC-102 while you are looking at
 *    MC-102 beats any amount of fuzzy text overlap. That is the whole reason
 *    notes carry `relatedKeys` instead of living in their own ID space.
 *
 *  - CLAIMS DECAY, PREFERENCES DO NOT. A `dated` note is ranked down as it ages
 *    past its last verification; a `timeless` one is not, because it does not
 *    rot. This is where `recency` earns its keep in RANKING. It changes two
 *    other outcomes elsewhere: the write path refuses a `dated` note carrying no
 *    `verifiedAt` (`assertVaultSafe`), and only a `dated` note carries a
 *    `signal` into a trail — so a `person` or `pattern` note can never raise a
 *    `disagreement` alert.
 */

import {
  CLAIM_FRESH_DAYS,
  isRecallable,
  renderRecalledNote,
  stalenessOf,
  type Note,
  type RecalledNote,
  type WorkItemKey,
} from '@mc/domain';

/** ~900 chars. Roughly 250 tokens per turn — affordable, and enough for 3-4 notes. */
export const RECALL_BUDGET = 900;

/**
 * What a fully-rotted claim gives up.
 *
 * Tuned against the spine bonus of 20: a stale note about the exact ticket you
 * are looking at still scores 12 and still surfaces — flagged, because you
 * probably do want the only thing anyone ever wrote about MC-102, told that it
 * is old. A stale note that merely shares a word with your question scores
 * below zero and drops out, which is the case this is really for.
 */
const DECAY_PENALTY = 8;

const MAX_NOTES = 5;
const EXCERPT_MIN = 80;

/**
 * The `\n` `renderContext` puts between recalled notes.
 *
 * Each note is one line in the block and `renderContext` joins the block with
 * `lines.join('\n')`, so every note costs one character the renderer itself
 * never returns. Counting it here keeps the same property `renderRecalledNote`
 * exists for: what the budget measures is what actually lands in the prompt.
 */
const SEPARATOR = 1;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'it', 'its',
  'this', 'that', 'these', 'those', 'we', 'i', 'you', 'they', 'what', 'why',
  'how', 'when', 'who', 'which', 'do', 'does', 'did', 'can', 'will', 'would',
  'about', 'into', 'our', 'us', 'me', 'my',
]);

export interface RecallQuery {
  /** The user's message this turn, if there is one. */
  text?: string;
  focusedKey?: WorkItemKey;
  budget?: number;
  limit?: number;
}

function terms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  ];
}

/** Days since `iso`, or a large number if it is unparseable. */
function ageDays(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 999 : (Date.now() - t) / 86_400_000;
}

function score(note: Note, q: RecallQuery, queryTerms: string[]): number {
  let s = 0;

  // 1. The spine. An explicit key match is worth more than everything else
  //    combined, which is what keeps recall from drifting into free association.
  const keys = new Set(q.focusedKey ? [q.focusedKey] : []);
  for (const k of note.relatedKeys) if (keys.has(k)) s += 20;

  // 2. Text overlap. Title carries more signal than body per word.
  if (queryTerms.length) {
    const title = note.title.toLowerCase();
    const body = note.body.toLowerCase();
    let titleHits = 0;
    let bodyHits = 0;
    for (const t of queryTerms) {
      if (title.includes(t)) titleHits++;
      else if (body.includes(t)) bodyHits++;
    }
    s += titleHits * 4 + Math.min(bodyHits, 6) * 1.5;
    // A key mentioned in the question itself counts as a spine hit.
    for (const k of note.relatedKeys) {
      if (queryTerms.includes(k.toLowerCase())) s += 12;
    }
  }

  // 3. Live concerns. An open impediment is the scrum master's actual job; a
  //    resolved one is history and should not crowd it out.
  if (note.status === 'open' && (note.kind === 'impediment' || note.kind === 'commitment')) s += 3;
  if (note.kind === 'pattern') s += 2;

  // 4. Decay, and only for claims that can rot.
  //
  //    A `timeless` note gets the old gentle drift on `updatedAt` — deliberately
  //    gentle, because a pattern note from three sprints ago is often the single
  //    most useful thing in the vault. A `dated` note is judged on `verifiedAt`
  //    instead and far more harshly, since the thing that makes it useful is
  //    exactly the thing that expires. Applying both would punish dated notes
  //    twice for the same age.
  if (note.recency === 'dated') s -= stalenessOf(note).decay * DECAY_PENALTY;
  else s -= Math.min(ageDays(note.updatedAt) / 30, 3);

  return s;
}

/** First paragraph, trimmed to `max` at a word boundary. */
function excerpt(body: string, max: number): string {
  const first = body.split(/\n\s*\n/).find((p) => p.trim())?.trim().replace(/\s+/g, ' ') ?? '';
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : cut.length).trimEnd()}…`;
}

/**
 * Pick the notes to inject. Never throws — on any internal failure it returns
 * an empty array, and the turn proceeds without memory.
 */
export function recall(notes: Note[], q: RecallQuery = {}): RecalledNote[] {
  try {
    const budget = q.budget ?? RECALL_BUDGET;
    const limit = q.limit ?? MAX_NOTES;
    const queryTerms = q.text ? terms(q.text) : [];

    const ranked = notes
      .filter((n) => n.status !== 'archived')
      // Derived documents are never volunteered. A brief is assembled *from*
      // the notes below it, so injecting one spends the whole budget saying
      // again what the individual notes say better — and crowds out the notes
      // that actually hold the claims. It stays fully visible everywhere else:
      // its own note page, an explicit lookup, evidence on a proposal.
      .filter(isRecallable)
      .map((n) => ({ note: n, s: score(n, q, queryTerms) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit);

    const out: RecalledNote[] = [];
    let spent = 0;

    for (const { note } of ranked) {
      const { days } = stalenessOf(note);
      const recalled: RecalledNote = {
        id: note.id,
        kind: note.kind,
        title: note.title,
        excerpt: '',
        relatedKeys: note.relatedKeys,
        verifiedAt: note.verifiedAt,
        // Only say it once it is worth the tokens. Every dated note is some
        // number of days old; only some of them are old enough to matter.
        staleDays: days > CLAIM_FRESH_DAYS ? Math.round(days) : undefined,
      };

      // Measure with the renderer rather than re-deriving the markup, so the
      // budget cannot drift from what actually lands in the prompt — and so the
      // longer staleness marker is paid for rather than silently overrunning.
      const overhead = renderRecalledNote(recalled).length + SEPARATOR;
      const room = budget - spent - overhead;
      if (room < EXCERPT_MIN) break;

      recalled.excerpt = excerpt(note.body, Math.min(room, 220));
      out.push(recalled);
      spent += overhead + recalled.excerpt.length;
    }

    return out;
  } catch {
    return [];
  }
}
