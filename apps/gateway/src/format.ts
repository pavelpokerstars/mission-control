/**
 * The formatters more than one gateway module needs.
 *
 * WHY THIS FILE EXISTS. `skills.ts` and `suggest.ts` each had their own `days()`
 * and their own `pct()`. `pct()` was byte-identical in both. `days()` was NOT,
 * and deliberately so — see `DayStyle` below — but the two copies shared the
 * `Number.isFinite` guard, and that is exactly what drifted: `stalenessOf()`
 * returns `Infinity` for a dated note that has never been verified, two callers
 * carried their own inline guard, four did not, and `/standup` printed
 * "unconfirmed Infinityd" in front of a human.
 *
 * The guard was then pushed *inside* both helpers, which fixed the symptom and
 * left the cause standing: one rule written twice, in two files, free to
 * disagree again the next time either is touched. Here it is written once and
 * the only thing that varies is the suffix.
 *
 * `stripHtml` arrived the same way and had already drifted four ways.
 *
 * Gateway-local rather than in `@mc/domain` on purpose. These render server-side
 * prose for briefs and questions; `@mc/domain` is imported by the browser and
 * holds models, not the gateway's phrasing.
 */
import type { Evidence } from '@mc/domain';

/**
 * How wide the unit is allowed to be.
 *
 * Not cosmetic, and not a candidate for unification. `/standup` renders a table
 * of lanes where the age is a cell and every character competes with the ticket
 * title — "13d". The starter questions render a sentence somebody reads aloud —
 * "MC-103 has been blocked for 13 days and nothing says why". Collapsing the two
 * makes one of them wrong.
 */
export type DayStyle = 'compact' | 'prose';

/**
 * An age, in the largest unit that still says something true.
 *
 * Under a day it reports hours, floored at 1 — "0h waiting" reads as "not
 * waiting", which is the opposite of what a fresh blocker means.
 *
 * `Infinity` is reachable: `stalenessOf()` returns it for a `dated` note with no
 * `verifiedAt`, which `assertVaultSafe` rejects on the write path but a
 * hand-edited file can still produce. "ever" is the honest rendering — the claim
 * has not been confirmed in its whole life — and it lives in here so that no
 * call site has to remember it.
 */
export function days(n: number, style: DayStyle = 'compact'): string {
  if (!Number.isFinite(n)) return 'ever';
  if (n < 1) return `${Math.max(Math.round(n * 24), 1)}h`;
  const whole = Math.round(n);
  return style === 'compact' ? `${whole}d` : `${whole} days`;
}

/** A ratio as a whole-number percentage. Flow efficiency, and nothing else yet. */
export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * A Confluence body as prose.
 *
 * Four copies of this lived in `infer.ts`, `skills.ts` and `tools.ts` twice, and
 * they had already drifted: two collapsed whitespace and trimmed, one collapsed
 * without trimming, one did neither, and the tag pattern was `<[^>]*>` in one
 * place and `<[^>]+>` in the others. Every one of them answers the same
 * question, which is the argument this file was written for.
 *
 * A tag becomes a SPACE, never nothing — `fo<b>o</b>` is one word to a reader
 * and `foo` to a tokeniser, but dropping the tag silently glues `</b><b>` pairs
 * across a real boundary far more often than it saves a word.
 *
 * `records.ts` deliberately does not use this: it splits on `</p>` first,
 * because a citation's unit is the paragraph rather than the body.
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A citation into a recording — the label a person reads AND the ref that opens it.
 *
 * WHY IT IS A FUNCTION. Five call sites in `skills.ts` and `tools.ts` built this
 * object by hand, every one of them carried a `quote`, and not one of them set
 * `ref` — so the flagship alert cited a meeting, showed the sentence, and could
 * not open it. `Evidence.ref` is what makes a row a link (`quote` is not), and
 * the transcript id was in scope at all five. A missing optional field is
 * invisible: nothing fails, the row just quietly renders as prose, which is the
 * difference between citing and asserting that this product is built on.
 *
 * The label stays the caller's phrasing because the three shapes genuinely
 * differ — a speaker, a model reading, the whole recording — but the ref is
 * derived here, so adding a sixth citation cannot reintroduce the bug.
 *
 * `at` is seconds into the recording; omitted it opens at the top, which is the
 * honest answer for a citation of the recording as a whole.
 */
export function zoomEvidence(
  t: { id: string; meetingTopic?: string },
  o: { speaker?: string; at?: number; quote?: string; suffix?: string } = {},
): Evidence {
  return {
    surface: 'zoom',
    label: `${t.meetingTopic ?? 'recording'}${o.speaker ? ` — ${o.speaker}` : ''}${o.suffix ?? ''}`,
    ...(o.at === undefined ? {} : { at: o.at }),
    ...(o.quote === undefined ? {} : { quote: o.quote }),
    ref: { surface: 'zoom', id: t.id, ...(o.at === undefined ? {} : { at: o.at }) },
  };
}
