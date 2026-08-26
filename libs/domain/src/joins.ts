/**
 * Reconstructing a join nobody typed — the deterministic half.
 *
 * WHY THIS EXISTS. `extractKeys()` is the spine of the whole system and it is a
 * literal regex: text attaches to work only when somebody typed `ORB-1641` into
 * it. Measured on the fixture written to resemble a real collector's output,
 * **zero of twenty-four meeting records name a Jira key** — and that is the
 * shape of the real thing, because nobody in a stand-up says a ticket number
 * out loud. So a promise made in a meeting reaches the vault with
 * `relatedKeys: []`, and the flagship alert reports it as *never filed* when in
 * truth it is the ticket everybody in the room was looking at.
 *
 * `apps/gateway/src/infer.ts` already asks a model for the connections a regex
 * cannot see, and that is the right instrument for *"this page is about the
 * same outage"*. It is the wrong instrument here, for the reason `skills.ts` is
 * deterministic: this feeds a DETECTOR. An alert list that changes between two
 * runs over the same data is worthless, there has to be one file to read when a
 * finding is wrong, and it has to work with nothing installed.
 *
 * WHAT IT REFUSES TO DO IS MOST OF THE DESIGN. It mints a join only when a
 * single candidate survives every filter; two survivors mint nothing at all.
 * That is not timidity — see `reconstructCommitmentJoin` for the measurement
 * that forced it, where the highest-scoring candidate was the wrong ticket.
 *
 * PLATFORM-NEUTRAL. `@mc/domain` is imported by the browser and compiled with
 * `types: []` under `typecheck:all`, so nothing here may touch a node global or
 * import `@mc/connectors`. The identity map arrives as a plain function.
 */

import type { StoredContainer } from './graph.js';

/**
 * Words that carry no topic. Copied from `skills.ts`, which is the point: the
 * same tokenisation has to be used on both sides of a comparison, and two
 * hand-maintained lists drift into a rule that matches differently depending on
 * which module asked.
 */
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
 *
 * Verbatim from `apps/gateway/src/skills.ts`. Deliberately duplicated rather
 * than imported: `skills.ts` is gateway-only and this is platform-neutral, and
 * the direction of the dependency cannot be reversed.
 */
export function tokens(text: string): Set<string> {
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
 * Hyphen compounds, split as well as kept.
 *
 * A ticket titled *"Emit a payment-settled event"* and a promise phrased *"the
 * settled event"* share the topic and share no token, because `payment-settled`
 * survives tokenisation whole. Keeping both forms costs nothing and is the
 * difference between matching and not on titles people actually write.
 */
export function expand(t: ReadonlySet<string>): Set<string> {
  const out = new Set<string>(t);
  for (const w of t) {
    if (!w.includes('-')) continue;
    for (const part of w.split('-')) if (part.length > 1 && !STOP.has(part)) out.add(part);
  }
  return out;
}

/**
 * Overlap coefficient rather than Jaccard: a promise is four words and the
 * ticket title it refers to is fifteen, and Jaccard punishes that difference as
 * though it were disagreement. Dividing by the *smaller* set asks the right
 * question — is the short one contained in the long one.
 */
export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** How many words two texts share. Reported alongside the score, not derived from it. */
export function sharedWords(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const w of a) if (b.has(w)) out.push(w);
  return out.sort();
}

/**
 * A FLOOR THAT REJECTS NONSENSE, NOT A CRITERION THAT PICKS A WINNER.
 *
 * Measured over `fixtures/` for the promise *"Dana takes the settled event end
 * to end"*, scoring every issue in the sprint:
 *
 *   PAY-9033 "Backfill settled events for July"          0.50   ← the WRONG one leads
 *   PAY-9032 "Consume settled events in the web client"  0.40
 *   PAY-9031 "Emit a payment-settled event on the topic" 0.40   ← the right one
 *
 * Two of three clear this floor and the highest score is wrong, so a
 * "best score wins" rule would have minted a false join with a confident
 * reason attached. **The owner filter is what makes the rule correct** — Dana
 * is the assignee of PAY-9031 alone — and the floor's only job is to stop a
 * one-candidate owner scope matching on nothing at all.
 */
export const JOIN_MATCH = 0.4;

/** One shared word is a coincidence; two is a topic. */
export const MIN_SHARED_WORDS = 2;

/**
 * Which container a moment falls inside.
 *
 * Extracted from `skills.ts`, which computed it inline to stamp `Note.container`
 * — the field `findMissingTickets` triggers on. One definition, or the stored
 * edge and the flagship alert's trigger become two ideas of "which sprint was
 * this meeting in".
 *
 * A moment outside every window resolves to nothing, which is a real answer:
 * plenty of meetings happen between sprints.
 */
export function containerFor(
  at: string,
  containers: readonly StoredContainer[],
): StoredContainer | undefined {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return undefined;
  return containers.find(
    (c) =>
      c.startsAt &&
      c.endsAt &&
      Date.parse(c.startsAt) <= t &&
      t <= Date.parse(c.endsAt),
  );
}

/** One issue, as much of it as the reconstruction needs. */
export interface JoinCandidate {
  key: string;
  label: string;
  assignee?: string;
}

export interface ReconstructedJoin {
  key: string;
  /** One sentence, and it is mandatory. An unexplained join is worse than none. */
  why: string;
  confidence: number;
}

/**
 * The one ticket a promise is probably about, or nothing.
 *
 * THE PIPELINE, and every gate is load-bearing:
 *
 *   scope  — issues in the promise's OWN container. Never the programme. The
 *            worked example is `PLT-4412 "Provision the payments settled topic"`,
 *            which matches the flagship promise beautifully and is in no sprint
 *            at all: widening the scope is the first tempting change and it is
 *            the one that turns the hero alert into a wrong answer.
 *   who    — the assignee resolves to the same person as the promise's owner.
 *            This is the filter doing the real work; see `JOIN_MATCH`.
 *   what   — the titles share a topic: the overlap clears `JOIN_MATCH` AND at
 *            least `MIN_SHARED_WORDS` words are common. Two floors because the
 *            coefficient alone is high for two tiny sets that happen to share
 *            one word.
 *
 * MINTS ONLY IF EXACTLY ONE CANDIDATE CLEARS BOTH FLOORS. Not "the highest
 * score, breaking ties". On `fixtures/` the leading score is the wrong ticket,
 * and on a real sprint of eighty issues one owner routinely holds five to
 * eight — so "exactly one" is the only gate that stays bounded as the programme
 * grows. Ambiguity is reported by minting nothing, and the alert stays the
 * `missing_ticket` it already was.
 *
 * IT NEVER WRITES. The vault is the asserted layer: it accumulates and is never
 * rebuilt, so a reconstruction stored into a note would outlive any threshold
 * change and could not be undone by switching this off. This runs in the pass,
 * every time, and its output lives only as long as the response.
 */
export function reconstructCommitmentJoin(args: {
  title: string;
  owner?: string;
  scope: readonly JoinCandidate[];
  /** A per-source handle to the canonical one. Falls through unchanged. */
  resolve: (handle: string) => string;
}): ReconstructedJoin | undefined {
  const { title, owner, scope, resolve } = args;
  if (!owner) return undefined;

  const want = expand(tokens(title));
  if (!want.size) return undefined;

  const mine = resolve(owner);
  const cleared: (ReconstructedJoin & { shared: string[] })[] = [];

  for (const c of scope) {
    if (!c.assignee || resolve(c.assignee) !== mine) continue;
    const have = expand(tokens(c.label));
    const score = similarity(want, have);
    const shared = sharedWords(want, have);
    if (score < JOIN_MATCH || shared.length < MIN_SHARED_WORDS) continue;
    cleared.push({
      key: c.key,
      why:
        `${owner} owns ${c.key} “${c.label}” in the same sprint, and the promise ` +
        `shares ${shared.length} word${shared.length === 1 ? '' : 's'} with it (${shared.join(', ')})`,
      confidence: Math.min(0.75, score),
      shared,
    });
  }

  // Two survivors is not a tie to break — it is the honest answer that we
  // cannot tell, and the alert is more useful saying so.
  if (cleared.length !== 1) return undefined;
  const { shared: _shared, ...join } = cleared[0]!;
  return join;
}
