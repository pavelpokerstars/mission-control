/**
 * The findings pass — what the front door is a list of.
 *
 * WHAT IS NEW HERE AND WHAT IS NOT. Five detectors already exist as
 * `WorkSignal`s on the lane (`work.ts`), and this does not reimplement them: it
 * re-homes them behind one type so an alert list can hold both "MC-9031 is
 * disputed" and "a promise nobody ticketed", which no `WorkRow` can express.
 *
 * The one genuinely new detector is `missing_ticket`, and it is the flagship
 * because it is the finding no single tool can produce. Jira only knows what
 * exists; the absence of a ticket is invisible to it by construction. Miro
 * cannot see it, Slack cannot see it, Confluence cannot see it. It takes a
 * promise recorded from a conversation and the tracker's silence about it, and
 * those two facts never sit in the same system.
 *
 * DETECTION IS DETERMINISTIC. No model runs here. A model may propose the claim
 * upstream — `extract.ts` reads action items a regex misses — but the rule that
 * fires is code, for the three reasons `skills.ts` is deterministic: it works
 * with nothing installed, there is one file to read when a finding is wrong, and
 * an alert list that changes between two runs over the same data is worthless.
 */

import {
  type AgingDays,
  type StoredNode,
  isNodeKind,
  reconstructCommitmentJoin,
  tokens,
  type JoinCandidate,
  FINDING_RANK,
  askAudience,
  type AskAudience,
  isAlertKind,
  type Evidence,
  type Finding,
  type Note,
  type StoredGraph,
  type WorkItem,
  type WorkItemKey,
  type WorkRow,
  type WorkSignal,
} from '@mc/domain';
import { buildIdentities, type Connectors, type GraphSource } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import { gatherWorkFacts, workOpts, type CorpusEntry } from './work.js';
import { safeMode } from './safe-mode.js';
import { agingDays, personName } from './graph-source.js';
import { answerFor, answeredFindingIds, type StandingAnswer } from './act.js';

/**
 * How long past its due date before a missing ticket is `crit` rather than
 * `warn`.
 *
 * A promise one day overdue is a nudge; one three weeks overdue with a closed
 * container behind it is the thing the product exists to catch.
 */
const OVERDUE_CRIT_DAYS = 7;

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// The gap
// ---------------------------------------------------------------------------

/**
 * A promise that never became a ticket.
 *
 * Four conditions, and every one of them is doing work:
 *
 *   OPEN COMMITMENT      — a resolved one was kept, and a decision or an
 *                          impediment is not a promise to build something.
 *   NO KEY               — the state the whole finding is about. Note this is
 *                          `relatedKeys.length === 0` and not "no ticket in a
 *                          done status": a promise that got a ticket is tracked,
 *                          whatever happened to it afterwards, and `/tidy`
 *                          already handles the inverse case.
 *   OWNER AND DUE DATE   — `DIRECTION.md` §5's precision gate. A promise with
 *                          both is unambiguously trackable; "someone should look
 *                          at that" is not. Without this the detector nags about
 *                          everything anybody said aloud and gets muted inside a
 *                          week, which is the failure `surfaceMemory` stays
 *                          deliberately quiet to avoid.
 *   THE CONTAINER CLOSED — the trigger. The graph author's question on 21 Aug — "is it
 *                          when you close the epic, or is it continuously
 *                          alerting you as you're creating the stories, which
 *                          would be annoying" — and the answer he gave himself
 *                          eight minutes later. An epic done, a sprint ended, a
 *                          retro held: the only moment that is neither nagging
 *                          nor too late.
 */
/**
 * The issues in one container, with just enough of each to match a promise
 * against. Built once per pass rather than per note.
 */
function scopeByContainer(graph: StoredGraph): Map<string, JoinCandidate[]> {
  const issues = new Map(
    graph.nodes.filter(isNodeKind('issue')).map((n) => [n.id, n]),
  );
  const out = new Map<string, JoinCandidate[]>();
  for (const e of graph.links) {
    if (e.relation !== 'in_sprint') continue;
    const issue = issues.get(e.source);
    if (!issue) continue;
    out.set(e.target, [
      ...(out.get(e.target) ?? []),
      { key: issue.key, label: issue.label, ...(issue.assignee ? { assignee: issue.assignee } : {}) },
    ]);
  }
  return out;
}

export function findMissingTickets(notes: Note[], graph: StoredGraph, now = Date.now()): Finding[] {
  type Container = Extract<StoredNode, { kind: 'sprint' | 'release' }>;
  const containers = new Map<string, Container>(
    graph.nodes
      .filter((n) => n.kind === 'sprint' || n.kind === 'release')
      .map((n) => [n.id, n as Container]),
  );

  /**
   * A container may also be named by its LABEL, when that is unambiguous.
   *
   * `Note.container` is the node id — `sprint:PAY Sprint 12` — and every
   * generated note carries one. A note written **by hand** is the case this is
   * for, and it is not a hypothetical: writing one commitment from a meeting you
   * remember is a step of the live path, and the natural thing to type is the
   * sprint's name. Keyed on the id alone that silently resolves to nothing, the
   * finding never fires, and nothing anywhere errors — which is the same way of
   * losing the flagship alert that the missing sprint state was.
   *
   * ONLY WHEN EXACTLY ONE CONTAINER HAS THAT LABEL. Sprint names repeat across
   * boards — `fetch-jira-sprints.mts` keeps the first and says so for the same
   * reason — and picking one of two would be a guess about which sprint closed.
   * The id always wins, so an exact reference is never overridden.
   */
  const byLabel = new Map<string, Container | null>();
  for (const c of containers.values()) {
    byLabel.set(c.label, byLabel.has(c.label) ? null : c);
  }

  /**
   * The identity map and the per-container scope, built once.
   *
   * `resolve` matters more than it looks: the graph keys people on email, a
   * note's `owner` is whatever the meeting called them, and an issue's
   * `assignee` is a handle. Comparing any two of those raw matches nothing on
   * real data — which would make the owner filter, the gate the whole
   * reconstruction rests on, silently reject every candidate.
   */
  const identities = buildIdentities(graph);
  const scopes = scopeByContainer(graph);

  const out: Finding[] = [];
  for (const n of notes) {
    if (n.kind !== 'commitment' || n.status !== 'open') continue;
    /**
     * A key SOMEBODY TYPED is a ticket. A key we reconstructed is a claim about
     * a ticket, and only the first may silence this alert.
     *
     * `Note.joins` has always been the field that knows the difference — it is
     * persisted, round-tripped through the frontmatter and asserted by
     * `verify-graph.mts` — and until now nothing read its tier to decide
     * anything. This gate was `relatedKeys.length > 0`, so the moment anything
     * starts reconstructing joins, the flagship alert goes quiet on promises
     * that genuinely were never filed, silently and with nothing failing.
     *
     * Absent from `joins` means `EXTRACTED`, so every note written before this
     * stays correct without being rewritten.
     */
    if (filedKeys(n).length > 0) continue;
    if (!n.owner || !n.dueAt) continue;

    const container = n.container
      ? (containers.get(n.container) ?? byLabel.get(n.container) ?? undefined)
      : undefined;
    if (!container || container.state !== 'closed') continue;

    /**
     * Is there a ticket this promise is probably about?
     *
     * Two answers, two claims. "Nobody filed this" and "this is almost
     * certainly ORB-1438 and nothing records the connection" want different
     * sentences, different evidence and different buttons — the first creates a
     * ticket, the second links to one. Before this, every promise discussed in
     * a stand-up under a ticket nobody named out loud got the first, which is
     * the wrong answer stated confidently.
     *
     * A key already on the note but NOT `EXTRACTED` counts as a reconstruction
     * too: something upstream worked it out and `filedKeys` correctly refused
     * to treat it as filed, so the alert should say what it knows rather than
     * throw it away.
     */
    const guessedAlready = n.relatedKeys.find((k) => n.joins?.[k] && n.joins[k]!.tier !== 'EXTRACTED');
    const reconstructed = guessedAlready
      ? { key: guessedAlready, why: n.joins![guessedAlready]!.why ?? 'reconstructed upstream', confidence: n.joins![guessedAlready]!.confidence ?? 0.5 }
      : reconstructCommitmentJoin({
          title: n.title,
          ...(n.owner ? { owner: n.owner } : {}),
          scope: scopes.get(container.id) ?? [],
          resolve: identities.resolve,
        });

    const overdueDays = Math.floor((now - Date.parse(n.dueAt)) / DAY_MS);
    /**
     * Whether anybody actually said that date.
     *
     * `/workshop` lets a promise made inside a sprint inherit the sprint's
     * close, because teams name owners and almost never name dates — but an
     * inherited date must not be read back as an agreed one. "Agreed by Jerry,
     * due 20 August" is a quotation; if nobody said 20 August it is a
     * fabricated one, on the page whose whole argument is that it never
     * asserts anything a record does not support.
     */
    const dueFromSprint = n.tags?.includes('due-from-sprint') === true;
    out.push({
      /**
       * THE ID STAYS ON THE `missing_ticket:` NAMESPACE FOR BOTH KINDS, and it
       * is not cosmetic.
       *
       * Three separate things key on `Finding.id` and none of them would
       * survive a rename: `suppressedIds` and `answeredFindingIds` in `act.ts`
       * — so every deferral and dismissal somebody has already made would come
       * straight back — and `notifiedIds` in `notify.ts`, which reads
       * `mc.memory_surfaced` off the durable log. That last one is the
       * expensive one: the first pass after a rename re-announces every alert
       * the user was already told about, at `warn`, which `worthSending` lets
       * through.
       *
       * A note produces exactly one of the two kinds, so uniqueness holds.
       */
      id: `missing_ticket:${n.id}`,
      kind: reconstructed ? 'unlinked_commitment' : 'missing_ticket',
      subject: { kind: 'commitment', noteId: n.id },
      /**
       * An inherited date never reaches `crit`, and this was got wrong once in
       * the obvious way.
       *
       * The reasoning was: the date IS the container's close and the finding
       * fires at that close, so `overdueDays` starts at zero and grows only if
       * nobody acts. True in steady state, and false the first time it runs —
       * a backfill over six closed sprints made **22 of 22** findings `crit`,
       * because Frontier 31 closed a month before anybody looked. An alert list
       * where everything is critical is a dashboard, which is the one thing the
       * front door may not become.
       *
       * So the cap is explicit rather than arithmetic. It is also the honest
       * ranking: "Jerry said the twelfth and it is three weeks past" is a
       * stronger claim than "nobody gave a date and the sprint has closed", and
       * the first should outrank the second. `warn` still counts on the front
       * door — only `ok` does not — so nothing is hidden by this.
       */
      /**
       * A reconstruction NEVER reaches `crit`.
       *
       * `crit` outranks everything on the front door and `worthSending` turns
       * it into a morning interruption. "Nobody filed this" is a fact; "this is
       * probably ORB-1438" is our reading of two titles and one assignee, and a
       * reading must not be able to shout.
       */
      severity:
        !reconstructed && !dueFromSprint && overdueDays >= OVERDUE_CRIT_DAYS ? 'crit' : 'warn',
      claim: reconstructed
        ? `${asClause(n.title)} is probably ${reconstructed.key}, and nothing says so`
        : `${asClause(n.title)} was never filed`,
      /**
       * TWO CLAUSES, AND THE CONTAINER NAMED ONCE.
       *
       * It was three, and the middle one repeated the last: *"Taken by Esme
       * Ellis, with no date given · checked against Orbit 29's close · Orbit 29
       * has closed and no issue references it"* — the sprint twice, its closing
       * twice, wrapping to two lines under every one of six near-identical rows
       * on the front door. A line that reads as boilerplate is a line nobody
       * reads, which costs the alert the one sentence that explains it.
       *
       * The inherited-date distinction survives the cut, and it has to: an
       * inherited date never reaches `crit` (above), because "Sanjay said the
       * twelfth and it is three weeks past" is a stronger claim than "nobody
       * gave a date and the sprint has closed". `no date given` beside the
       * container's close says exactly that, without spelling out the
       * arithmetic.
       *
       * The owner by NAME, through the map already built above — a note's
       * `owner` is whatever the meeting called them, which on a real graph is
       * an email.
       */
      impact: [
        dueFromSprint
          ? `Taken by ${identities.nameOf(n.owner) ?? n.owner}, no date given`
          : overdueDays > 0
            ? `Agreed by ${identities.nameOf(n.owner) ?? n.owner}, due ${shortDate(n.dueAt)} and ` +
              `${overdueDays} day${overdueDays === 1 ? '' : 's'} past`
            : `Agreed by ${identities.nameOf(n.owner) ?? n.owner}, due ${shortDate(n.dueAt)}`,
        reconstructed
          ? `${container.label} closed and no record connects the two`
          : `${container.label} closed with no issue referencing it`,
      ].join(' · '),
      // When the container closed, not when this pass ran. A finding that
      // restamps itself every pass cannot be aged, ranked or deduplicated, and
      // "fired 08:02 today" would be a lie about a promise made in July.
      firedAt: container.closedAt ?? container.endsAt ?? n.dueAt,
      /**
       * The reconstruction's reason rides along as an evidence row with NO
       * `ref`, because it is our own observation rather than a document.
       * `AlertPage` renders a ref-less row as a plain sentence and does not
       * offer to open it — which is the difference between citing and
       * asserting, and the reason a reader can weigh the guess at all.
       */
      evidence: reconstructed
        ? [...n.evidence, { surface: 'jira' as const, label: reconstructed.why }]
        : n.evidence,
      dedupeKey: `missing_ticket:${n.id}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The promise nobody has mentioned since
// ---------------------------------------------------------------------------

/**
 * How large a share of the corpus a word may appear in and still count as
 * distinctive.
 *
 * A promise has gone quiet if nothing since has NAMED it, and the whole
 * difficulty is deciding what naming it means when the promise contains no
 * ticket key. The answer is corpus-relative document frequency: a word carried
 * by one record in twenty is about something; a word in a third of them is
 * furniture.
 *
 * TUNED UPWARDS WHEN IN DOUBT, NEVER DOWN, AND THE ASYMMETRY IS THE WHOLE
 * ARGUMENT. A missed follow-up fires an alert at somebody who has been chasing
 * the thing daily, which is the fastest way to teach them the list is not
 * listening. A spurious follow-up only keeps us quiet about one promise. So the
 * failure this is tuned to prefer is silence.
 *
 * AND IT DOES NOT DISCRIMINATE AS WELL AS IT LOOKS. Measured on
 * `fixtures-programme`: at 0.05, promise-001 ("chase the vendor sandbox") reads
 * as FOLLOWED UP because eight different records say *"ORB-XXXX is still
 * blocked on the vendor sandbox"* about eight unrelated tickets. That is
 * recurring stand-up boilerplate, not a follow-up. The rule failed SAFE, which
 * is the design, but it must not be quoted as evidence the rule is precise. At
 * 0.01 the whole thing collapses to single-occurrence words and everything
 * reads as dropped.
 */
const DF_MAX_SHARE = 0.05;

/** Below four characters a word is almost never the subject of a promise. */
const MIN_TERM_LENGTH = 4;

/**
 * How many surfaces must have said ANYTHING recently before silence means
 * anything.
 *
 * Without this the detector fires hardest on a programme whose collectors have
 * not run — nothing has been said since, because nothing has been read since.
 * "We do not know" and "nobody mentioned it" are different answers and only the
 * second is worth interrupting somebody about.
 */
const MIN_LIVE_SURFACES = 2;

const dfIndexCache = new Map<string, { at: string; df: Map<string, number>; size: number }>();

/**
 * Document frequency over the corpus, memoised on the graph's `generatedAt`.
 *
 * ON `generatedAt` ALONE, and deliberately not on the event log. The corpus is
 * the DERIVED tier — only a collector run changes it — and `generatedAt` is
 * exactly its subject. Keying it on the vault's event count instead would tear
 * the index down every thirty seconds under the canvas poll, which is the
 * documented anti-pattern that once left a screen on "Loading…" for ever while
 * the network tab showed only 200s. A new vault note changes the QUERY, not the
 * index.
 */
function documentFrequency(
  corpus: CorpusEntry[],
  generatedAt: string,
): { df: Map<string, number>; size: number } {
  const hit = dfIndexCache.get(generatedAt);
  if (hit && hit.at === generatedAt) return { df: hit.df, size: hit.size };

  const df = new Map<string, number>();
  for (const r of corpus) {
    for (const t of new Set(r.tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  dfIndexCache.clear();
  dfIndexCache.set(generatedAt, { at: generatedAt, df, size: corpus.length });
  return { df, size: corpus.length };
}

/**
 * A promise made out loud, its sprint still running, and nothing since has
 * named it.
 *
 * WHY IT IS NOT `missing_ticket` WITH A DIFFERENT TRIGGER. That one fires when
 * a container CLOSES and says the tracker never got this. This fires while the
 * container is still OPEN and says the conversation dropped it — a different
 * claim, a different moment, and a different thing to do about it. They are
 * mutually exclusive by construction on `container.state`, one line each, so
 * neither has to know the other exists.
 *
 * WHY `lastHeardOf` AND NOT "was it ever acknowledged". The obvious test is
 * whether anything after the promise mentions it, and it is a one-shot test: a
 * promise acknowledged once the following morning and then dropped for two
 * months passes it for ever. That is precisely the failure this exists to
 * catch. So the question is asked from the LAST time anybody mentioned it, not
 * from when it was made.
 */
export function findDroppedCommitments(args: {
  notes: Note[];
  graph: StoredGraph;
  corpus: CorpusEntry[];
  now?: number;
}): Finding[] {
  const { notes, graph, corpus, now = Date.now() } = args;
  if (!corpus.length) return [];

  /** So the owner is named the way every other surface names them. */
  const names = buildIdentities(graph);

  const containers = new Map(
    graph.nodes
      .filter((n) => n.kind === 'sprint' || n.kind === 'release')
      .map((n) => [n.id, n as Extract<StoredNode, { kind: 'sprint' | 'release' }>]),
  );
  const byLabel = new Map<string, Extract<StoredNode, { kind: 'sprint' | 'release' }> | null>();
  for (const c of containers.values()) {
    byLabel.set(c.label, byLabel.has(c.label) ? null : c);
  }

  const meetings = graph.nodes
    .filter((n) => n.kind === 'meeting')
    .map((n) => ({ id: n.id, label: n.label, at: 'at' in n && n.at ? Date.parse(n.at) : NaN }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at);

  const { df, size } = documentFrequency(corpus, graph.graph.generatedAt);
  const cap = Math.max(1, Math.floor(size * DF_MAX_SHARE));

  /**
   * How recently each surface said anything at all — the "we do not know"
   * guard. Computed once over the whole corpus rather than per note.
   */
  const freshestBySurface = new Map<string, number>();
  for (const r of corpus) {
    const t = Date.parse(r.ts);
    if (!Number.isFinite(t)) continue;
    freshestBySurface.set(r.surface, Math.max(freshestBySurface.get(r.surface) ?? 0, t));
  }

  const out: Finding[] = [];
  for (const n of notes) {
    if (n.kind !== 'commitment' || n.status !== 'open') continue;
    if (filedKeys(n).length > 0) continue;
    // Half the precision gate. `dueAt` is NOT required here, unlike
    // `missing_ticket`: a promise inside a running sprint has not missed
    // anything yet, so a date would be a gate on the wrong thing. What replaces
    // it is `G4` below — the promise must be openable.
    if (!n.owner) continue;
    /**
     * It has to be CITABLE. A promise with no ref is one we cannot show
     * somebody, and an alert that says "you said this" and cannot open the
     * moment is the uncited assertion this product exists not to be.
     */
    if (!n.evidence.some((e) => e.ref)) continue;

    const container = n.container
      ? (containers.get(n.container) ?? byLabel.get(n.container) ?? undefined)
      : undefined;
    /**
     * `active`, not `!== 'closed'`. `future` admits a sprint that has not
     * started, and nagging about a promise for next sprint is the one thing the
     * trigger question was settled to avoid.
     */
    if (!container || container.state !== 'active') continue;

    const terms = [...tokens(n.title)].filter(
      (t) => t.length >= MIN_TERM_LENGTH && !tokens(n.owner!).has(t),
    );
    const distinctive = terms.filter((t) => (df.get(t) ?? 0) <= cap);
    // No distinctive term means no test, and no test means no claim. Not a
    // weaker finding — an absent one.
    if (!distinctive.length) continue;

    const madeAt = Date.parse(n.createdAt);
    if (!Number.isFinite(madeAt)) continue;

    /**
     * The meeting the promise was made in does not count as having heard of it
     * again.
     *
     * Zoom notes become one corpus entry per PARAGRAPH, so the same meeting
     * contributes several — and the paragraphs after the promise are all
     * stamped later than it. Without this, a promise stated at the top of a
     * stand-up and glanced off two lines down reads as followed up, which
     * silently suppresses the finding; and when it does not suppress it, the
     * alert cites the same record twice under two different headings, which
     * reads as a bug and costs the page its credibility.
     */
    const promisedIn = new Set(
      n.evidence.map((e) => e.ref?.id).filter((id): id is string => !!id),
    );

    let lastHeardOf = madeAt;
    let lastRecord: CorpusEntry | undefined;
    for (const r of corpus) {
      const t = Date.parse(r.ts);
      if (!Number.isFinite(t) || t <= madeAt || t <= lastHeardOf) continue;
      if (r.ref && promisedIn.has(r.ref.id)) continue;
      if (!distinctive.some((d) => r.tokens.includes(d))) continue;
      lastHeardOf = t;
      lastRecord = r;
    }

    /**
     * THE TRIGGER: a meeting has run since we last heard of it.
     *
     * The stand-up is where this should have come up, so the honest moment to
     * say "it did not" is after one has happened. A day count would fire on a
     * quiet week; a meeting having run and passed it over is the actual event.
     */
    const since = meetings.filter((m) => m.at > lastHeardOf);
    if (!since.length) continue;

    /**
     * And somebody has to have been TALKING, or silence means nothing.
     *
     * On a programme whose collectors stopped running, every promise looks
     * dropped. Requiring two surfaces to carry something newer than the last
     * mention is what separates "nobody said anything about it" from "nothing
     * was read".
     */
    const live = [...freshestBySurface.values()].filter((t) => t > lastHeardOf).length;
    if (live < MIN_LIVE_SURFACES) continue;

    const first = since[0]!;
    const quietDays = Math.floor((now - lastHeardOf) / DAY_MS);

    out.push({
      id: `dropped_commitment:${n.id}`,
      kind: 'dropped_commitment',
      subject: { kind: 'commitment', noteId: n.id },
      // Always `warn`. `crit` outranks the flagship on the front door and turns
      // into a morning ping; "nobody has mentioned this" does not earn that.
      severity: 'warn',
      claim: `${asClause(n.title)} has gone quiet`,
      /**
       * The surfaces it searched used to be spelled out here — "with nothing on
       * Slack, Confluence or a later meeting naming it" — on every one of these,
       * in the same words. The row already carries a dot per surface the finding
       * was read from, so the sentence was saying in twelve words what the page
       * says in six pixels.
       */
      impact: [
        `Taken by ${names.nameOf(n.owner) ?? n.owner}`,
        `${since.length} meeting${since.length === 1 ? '' : 's'} since`,
        `${quietDays} day${quietDays === 1 ? '' : 's'} with nothing naming it`,
      ].join(' · '),
      /**
       * The moment the first meeting ran without it — a dated fact off a graph
       * node, never `Date.now()`. It moves only when a real new record arrives,
       * at which point the finding legitimately re-dates.
       */
      firedAt: new Date(first.at).toISOString(),
      evidence: [
        // The promise itself, verbatim — it already came from `zoomEvidence`
        // and already carries the ref that opens it at its line.
        ...n.evidence,
        // The last thing anybody said, when there was one after the promise.
        ...(lastRecord
          ? [
              {
                surface: lastRecord.surface,
                label: `last heard of in ${lastRecord.label}`,
                ...(lastRecord.ref ? { ref: lastRecord.ref } : {}),
              } as Evidence,
            ]
          : []),
        // Our own observation. No `ref` — there is no document called "silence",
        // and a dead link here would be worse than a plain sentence.
        {
          surface: 'zoom',
          label: `${first.label} ran on ${new Date(first.at).toISOString().slice(0, 10)} and did not come back to it`,
        },
      ],
      dedupeKey: `dropped_commitment:${n.id}`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The reconciliation findings, which the graph already carries
// ---------------------------------------------------------------------------

/**
 * A dependency the tracker never recorded, and a declared link nothing supports.
 *
 * Both fall straight out of the tier. Reconciliation has already done the work —
 * `INFERRED` with no declared counterpart is a dependency somebody has but never
 * wrote down; `AMBIGUOUS` is a claim that survived a check with nothing behind
 * it. No detection happens here at all, which is the point: the graph's tiers
 * are not decoration, they are findings in storage.
 */
export function findLinkProblems(graph: StoredGraph, items: Map<string, WorkItem>): Finding[] {
  const key = (id: string): string => id.replace(/^issue:/, '');
  const title = (id: string): string => items.get(key(id))?.title ?? key(id);

  const deps = graph.links.filter((e) => e.relation === 'depends_on');
  const declared = new Set(
    deps.filter((d) => d.origin === 'declared').map((d) => `${d.source}->${d.target}`),
  );

  const out: Finding[] = [];

  for (const d of deps) {
    const evidence: Evidence[] = d.evidence.map((e) => ({
      surface: 'jira',
      label: e.ref,
      ...(e.quote ? { quote: e.quote } : {}),
    }));

    if (d.origin === 'reconstructed' && !declared.has(`${d.source}->${d.target}`)) {
      out.push({
        id: `undetected_dependency:${d.source}:${d.target}`,
        kind: 'undetected_dependency',
        subject: { kind: 'workitem', key: key(d.source) },
        severity: 'warn',
        claim: `${key(d.source)} waits on ${key(d.target)}, and nothing records it`,
        impact: `${asClause(d.why ?? 'Reconstructed from evidence')} — “${title(d.target)}” is not linked as a blocker, so no board shows it.`,
        firedAt: graph.graph.generatedAt,
        evidence,
        dedupeKey: `undetected_dependency:${d.source}:${d.target}`,
      });
    }

    if (d.origin === 'declared' && d.tier === 'AMBIGUOUS' && d.reconciled) {
      const blocker = items.get(key(d.target));
      out.push({
        id: `suspect_link:${d.source}:${d.target}`,
        kind: 'suspect_link',
        subject: { kind: 'workitem', key: key(d.source) },
        // A stale link on a finished blocker is the confident case; an
        // uncorroborated one on live work may simply be a link nobody explained.
        severity: blocker?.status === 'done' ? 'warn' : 'ok',
        claim: `${key(d.source)} is marked as waiting on ${key(d.target)}, and nothing supports it`,
        impact: d.why ?? 'Declared in the tracker with no corroborating evidence.',
        firedAt: graph.graph.generatedAt,
        evidence,
        dedupeKey: `suspect_link:${d.source}:${d.target}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The lane's signals, as findings
// ---------------------------------------------------------------------------

/**
 * Severity, translated once.
 *
 * `WorkSignal.tone` is `alarm`/`warn`/`info` and the interface speaks
 * `crit`/`warn`/`ok` — `DESIGN.md` §1 has exactly two colour vocabularies and
 * this is one of them. One mapping, here, because two severity scales converted
 * ad hoc at each caller is how a row and the page it opens end up disagreeing
 * about how bad something is.
 */
const TONE: Record<WorkSignal['tone'], Finding['severity']> = {
  alarm: 'crit',
  warn: 'warn',
  info: 'ok',
};

/**
 * Which signals are findings, and which are context.
 *
 * `blocked_by`, `unwritten` and `activity` are deliberately absent. They are
 * true, useful on a row you are already reading, and not things that should
 * interrupt somebody: "this waits on something unfinished" describes most work
 * most of the time, and a front door that says so about every ticket is a front
 * door people stop opening. A cycle is the case where waiting has actually gone
 * wrong, and it is in.
 */
const SIGNAL_FINDINGS: Partial<Record<WorkSignal['kind'], Finding['kind']>> = {
  disagreement: 'disagreement',
  cycle: 'cycle',
  aging: 'aging',
};

/**
 * Fold the lane's rows into findings.
 *
 * Wrapping rather than re-detecting is the whole point: `findContradictions`,
 * `findCycles` and `buildTimeline` stay the single definition, so a row that
 * says "two sources disagree" and an alert that says the same cannot come from
 * two different ideas of disagreement.
 */
function findFromWorkRows(
  rows: WorkRow[],
  cycles: WorkItemKey[][],
  agingDays: AgingDays,
): Finding[] {
  const out: Finding[] = [];

  for (const row of rows) {
    for (const signal of row.signals) {
      const kind = SIGNAL_FINDINGS[signal.kind];
      if (!kind) continue;

      /**
       * A cycle is ONE finding about a loop, not one per member.
       *
       * Every ticket in a four-ticket loop carries the same cycle signal, so a
       * naive fold puts four near-identical rows on the front door for a single
       * problem — which is exactly how a queue teaches people to ignore it. The
       * dedupe key is the loop's own members, sorted, so all four collapse; the
       * subject is the member that sorts first, so the collapse is stable rather
       * than dependent on which row happened to be walked first.
       */
      const loop = kind === 'cycle' ? cycles.find((c) => c.includes(row.item.key)) : undefined;
      const members = loop ? [...new Set(loop)].sort() : [];
      const subjectKey = members[0] ?? row.item.key;

      out.push({
        id: `${kind}:${subjectKey}`,
        kind,
        subject: { kind: 'workitem', key: subjectKey },
        severity: TONE[signal.tone],
        claim: claimFor(kind, row, signal, members),
        impact: signal.text,
        /**
         * When this became true, not when the pass ran.
         *
         * `aging` gets its own answer because the generic one is wrong for it in
         * a way that quietly disables ranking. `row.lastActivity` is the newest
         * thing anybody SAID about the ticket — and a ticket nobody has
         * mentioned is precisely the aging case, so it was `undefined` for all
         * seven findings on `fixtures-programme` and every one of them fell
         * through to `Date.now()`. `rankFindings` sorts oldest-first inside a
         * severity, so all seven carried the same instant and a 41-day ticket
         * could not outrank a 16-day one.
         *
         * The moment an aging finding became true is the moment it crossed its
         * column's threshold: `ageSince` plus that many days. That is a stable,
         * dated fact, so the finding can be aged, ranked and deduplicated the
         * way every other kind can.
         */
        firedAt: agingFiredAt(kind, row, agingDays) ?? row.lastActivity ?? new Date().toISOString(),
        evidence: signal.evidence ?? [],
        dedupeKey: loop ? `cycle:${members.join('>')}` : `${kind}:${row.item.key}`,
      });
    }
  }
  return out;
}

/**
 * The moment an aging row crossed its column's threshold, or `undefined` for
 * every other kind.
 *
 * Returns `undefined` rather than guessing whenever the row carries no
 * `ageSince` — which is the same "no number is claimed" state `statusAgeOf`
 * returns, arriving here.
 */
function agingFiredAt(
  kind: Finding['kind'],
  row: WorkRow,
  agingDays: AgingDays,
): string | undefined {
  if (kind !== 'aging' || !row.ageSince) return undefined;
  const threshold = agingDays[row.item.status];
  if (threshold === null || threshold === undefined) return undefined;
  const crossed = Date.parse(row.ageSince) + threshold * DAY_MS;
  return Number.isFinite(crossed) ? new Date(crossed).toISOString() : undefined;
}

/**
 * A title, made fit to sit inside a sentence.
 *
 * Every claim built here is `<title> + a clause`, and a commitment's title is a
 * sentence somebody said: all eight in `fixtures-programme/notes/` end in a full
 * stop, and an extracted action item will too. Interpolated raw that produced
 * **"Esme Ellis to chase the vendor sandbox. was never filed"** — a full stop
 * mid-claim, on the flagship alert, in the `h1`.
 *
 * Only sentence-ending punctuation goes. A title ending in `?` is a question
 * somebody asked and a trailing `:` introduces something; both read as errors
 * once a clause follows, so they go the same way. A closing bracket or quote
 * stays — it is part of the title rather than the end of it.
 */
/**
 * A date as this app writes them elsewhere: `12 Aug`, not `2026-08-12`.
 *
 * The impact line was the only place in the interface still printing an ISO
 * stamp at a reader. `describeWhen` in `act.ts` is the other server-side date
 * and uses the long month; this one is short because it sits inside a clause
 * that is already carrying a name and a count.
 */
function shortDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t)
    ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : iso.slice(0, 10);
}

function asClause(title: string): string {
  return title.trim().replace(/[.!?:;,]+$/, '');
}

/** The headline. `signal.text` is already phrased, and becomes the impact line. */
function claimFor(
  kind: Finding['kind'],
  row: WorkRow,
  signal: WorkSignal,
  members: WorkItemKey[],
): string {
  switch (kind) {
    case 'cycle':
      return `${members.length || 'Several'} tickets are waiting on each other`;
    case 'disagreement':
      return `${row.item.key} is called done and not done`;
    case 'aging':
      /**
       * The headline stays the same for both bases and the qualifier lives in
       * the impact line, beside the number it qualifies.
       *
       * Stating the basis here as well read *"ORB-1669 has not moved in at
       * least 31 days — at least 31 days in development"*: the claim and the
       * impact are shown one above the other, so saying it twice is not
       * emphasis, it is a row that looks like a bug.
       */
      return `${row.item.key} has not moved`;
    default:
      return signal.text;
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/**
 * Worst first, and older first inside a severity.
 *
 * The top row has to be the row to open — that is the whole promise of the front
 * door, and a list that buries a three-week-overdue promise under a fresh
 * `ok` teaches people to stop reading it.
 */
export function rankFindings(f: Finding[]): Finding[] {
  return [...f].sort(
    (a, b) =>
      FINDING_RANK[b.severity] - FINDING_RANK[a.severity] ||
      Date.parse(a.firedAt) - Date.parse(b.firedAt),
  );
}

export interface FindingsInput {
  source: GraphSource;
  vault: VaultStore;
  items: WorkItem[];
  /** For the lane-derived findings. Omitted, they are simply not produced. */
  connectors?: Connectors;
  /**
   * Keep what a human has already answered. **A LIST FILTERS; AN ADDRESS DOES
   * NOT**, and conflating the two cost the app its one link back from a note.
   *
   * The front door drops deferrals and dismissals, which is the whole promise
   * of an alert list. `findingDetail` used to read through the same call, so a
   * finding you had parked could not be opened AT ALL until the reminder
   * lapsed — and the note that parking created carries `Open the alert`, the
   * only ACROSS link in `DESIGN.md` §4, which therefore landed on "That alert
   * is not there" for exactly the notes it exists for.
   *
   * Same distinction the vault's decay model already draws: a stale note still
   * answers an explicit lookup and only stops being volunteered. Deliberately
   * opt-IN, so a new route that forgets it gets the safe behaviour.
   */
  includeAnswered?: boolean;
}

/**
 * One finding per `dedupeKey`, keeping the first — which after the ordering
 * above is the most severe.
 *
 * Within a single pass this is what collapses a four-ticket loop into one row.
 * Across passes it is what a scheduled run will check the durable log against,
 * so that a finding announced yesterday is not announced again today; that half
 * waits until there is something doing the announcing.
 */
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) if (!seen.has(f.dedupeKey)) seen.set(f.dedupeKey, f);
  return [...seen.values()];
}

export async function runFindings({
  source,
  vault,
  items,
  connectors,
  includeAnswered = false,
}: FindingsInput): Promise<Finding[]> {
  const byKey = new Map(items.map((i) => [i.key, i]));

  // Claims come from the VAULT, not the graph. They are the asserted layer —
  // nobody can re-read a promise out of Jira — so the durable copy is the one a
  // human edits, and reading the graph's mirror of them would miss every claim
  // written since the last collector run.
  const notes = vault.list().filter((n) => n.status !== 'archived');

  // The graph's reconciled dependencies, never a live board read — see
  // `gatherWorkFacts`. Only EXTRACTED edges survive `projectArrows`, so a
  // declared link nothing corroborates cannot raise a cycle banner.
  const lane = connectors
    ? // `corpus: true` here and NOT in `/api/work`: the lane route never reads
      // it, and materialising every record on a request that does not want them
      // is the same bargain `suggest.ts` already refused to make.
      await gatherWorkFacts(connectors, vault, { ...workOpts(source), corpus: true })
    : undefined;

  const findings = dedupe([
    ...findMissingTickets(notes, source.graph),
    ...(lane?.corpus
      ? findDroppedCommitments({ notes, graph: source.graph, corpus: lane.corpus })
      : []),
    ...(lane ? findFromWorkRows(lane.rows, lane.cycles, agingDays()) : []),
    ...findLinkProblems(source.graph, byKey),
  ]);

  /**
   * Drop what a human has already answered.
   *
   * Read from the DURABLE log, not from memory: an alert list is a promise that
   * a decision you made yesterday is still made today, and a gateway restart
   * must not quietly re-raise everything somebody dismissed. Same reason
   * `rehydrateProposals` exists and the scheduler asks the log rather than a
   * flag whether it has already run.
   *
   * Unwindowed on purpose — a dismissal from three months ago is still a
   * dismissal, and a `since` here would silently expire decisions. Indexed
   * rather than re-parsed per request; see `answeredFindingIds`.
   */
  const answered = await answeredFindingIds(vault);

  /**
   * STALENESS DOES NOT RANK A MISSING TICKET DOWN, and this was written the
   * other way round first.
   *
   * `stalenessOf` is right about recall: a claim nobody has re-confirmed in two
   * months is a weak basis for the agent to assert something. Applied here it is
   * exactly backwards — the finding IS that time passed and nothing happened, so
   * the age of the promise is the reason to interrupt somebody rather than a
   * reason not to. Written as a decay it downgraded the hero case from `crit` to
   * `warn` precisely because it had been ignored for seven weeks.
   *
   * Left as a comment rather than deleted silently: "apply the vault's decay
   * model here" is an obvious-sounding idea and somebody will have it again.
   */
  return rankFindings(findings.filter((f) => includeAnswered || !answered.has(f.id)));
}

/**
 * The front door, split into what needs you and what you have already answered.
 *
 * `findings` MEANS "THE LIST" AND MUST GO ON MEANING EXACTLY THAT. A dismissal
 * is a promise that the thing stays gone, so the obvious widening — suppressed
 * findings arriving inline, everybody filtering downstream — moves that promise
 * from one place to every consumer, and the first one to forget puts a
 * dismissed alert back on the front door. `parked` therefore sits BESIDE it:
 * nothing that reads `findings` changes behaviour, and the safe default holds.
 *
 * The second half exists for anything that must NAME an alert it is not
 * listing. `Later`'s rows carry the chip of the alert a note was parked from
 * (`DIRECTION.md` §7) — and a note is parked precisely when its alert has left
 * the list, so the filtered array is the one array that can never resolve one.
 * It costs no second pass: `runFindings` has already produced both sets and
 * `answeredFindingIds` already says which is which.
 *
 * Coverage kinds are excluded from both halves. They are one per edge, they
 * arrive by the hundred on a real programme, and they live on Sources — see
 * `COVERAGE_KINDS`.
 */
export async function runAlertFindings(
  input: FindingsInput,
): Promise<{ findings: Finding[]; parked: Finding[] }> {
  const alerts = (await runFindings({ ...input, includeAnswered: true })).filter((f) =>
    isAlertKind(f.kind),
  );
  const answered = await answeredFindingIds(input.vault);
  return {
    findings: alerts.filter((f) => !answered.has(f.id)),
    parked: alerts.filter((f) => answered.has(f.id)),
  };
}

// ---------------------------------------------------------------------------
// One finding, with what the page needs to render it
// ---------------------------------------------------------------------------

/**
 * Everything an alert page shows, in one response.
 *
 * Assembled here rather than left to the caller to stitch from three requests,
 * for the reason the dossier is: a page built from parallel fetches renders in
 * pieces and can show a claim beside evidence that has already moved on. And a
 * notification links straight into this — the reader arrives cold, with no list
 * behind them — so the page has to be complete on first paint.
 */
export interface FindingDetail {
  finding: Finding;
  /** The promise, when the subject is one. Carries the body and the evidence. */
  note?: Note;
  /** The work item, when the subject is one. */
  item?: WorkItem;
  /** The container whose closing fired it, so the page can say which. */
  container?: { id: string; label: string; closedAt?: string };
  /**
   * The checklist: everything promised in the same container, ticked by whether
   * it got a ticket.
   *
   * This is the picture the whole alert rests on — a list of ticks and one red
   * cross reads instantly, where a paragraph about a missing commitment does
   * not. It is also free: the tick IS `relatedKeys.length > 0`, so nothing is
   * computed that the gap detector did not already need.
   */
  checklist?: {
    title: string;
    tracked: boolean;
    ref: string;
    /**
     * The one row this alert is actually about.
     *
     * The list is every promise made in the container, so several of them can be
     * untracked at once — and the primary action files a ticket for THIS
     * finding's note whatever row you pressed. Without this flag an inline
     * "file it" on the third row would create the first row's ticket, silently
     * and with a success message. Read off the note id rather than the title,
     * because two promises in one sprint can be worded the same.
     */
    subject?: boolean;
  }[];
  /**
   * The decision a human already made about this, while it still stands.
   *
   * Present exactly when the finding is missing from `/api/findings` for that
   * reason — which is the only way this page can be honest about a parked
   * alert. Absent is the ordinary case, including a deferral whose reminder has
   * lapsed: the alert is back on the list, so the page has nothing to add.
   */
  answered?: StandingAnswer;
  /**
   * Who a message about this would be addressed to, and where it would go.
   *
   * Computed HERE so the page and the draft cannot name different people: the
   * buttons read this before the click and `actOnFinding` is handed the same
   * object after it. Refined as the subject resolves — the evidence alone
   * names the Slack authors, and only the note or the work item can name an
   * owner.
   */
  audience: AskAudience;
  /**
   * Whether this instance may write to a vendor at all.
   *
   * The alert page's primary button says "Create the ticket", and on a
   * safe-mode instance — which is the DEFAULT, `safe-mode.ts` — that write is
   * refused. The failure path is honest about it after the fact; the button was
   * not honest about it before. A label that promises a Jira write on an
   * instance that cannot make one is the same defect as an "Ask someone" button
   * that does not say it posts to Slack, and it is the one the reader hits
   * first.
   *
   * It rides on the detail rather than being fetched separately so the page and
   * the button cannot disagree about it — the same argument that puts the
   * toolbar counts in one fetch.
   */
  safeMode: boolean;
}

/**
 * The keys on a note that somebody actually typed, as opposed to the ones we
 * worked out.
 *
 * One definition, because the gate and the checklist have to tell the same
 * story: a guessed key rendered in the checklist's `ref` column beside an
 * unticked box reads as a filed ticket with a broken tick.
 */
export function filedKeys(n: Note): WorkItemKey[] {
  return n.relatedKeys.filter((k) => (n.joins?.[k]?.tier ?? 'EXTRACTED') === 'EXTRACTED');
}

export async function findingDetail(
  id: string,
  input: FindingsInput,
): Promise<FindingDetail | undefined> {
  const { source, vault, items } = input;
  // An address, not a list — see `FindingsInput.includeAnswered`.
  const findings = await runFindings({ ...input, includeAnswered: true });
  const finding = findings.find((f) => f.id === id);
  if (!finding) return undefined;

  const detail: FindingDetail = { finding, safeMode: safeMode(), audience: askAudience(finding) };
  const answered = await answerFor(vault, id);
  if (answered) detail.answered = answered;

  if (finding.subject.kind === 'workitem') {
    detail.item = items.find((i) => i.key === (finding.subject as { key: string }).key);
    // An aging or cycle alert cites our own reading of Jira, so no Slack label
    // names anybody — the assignee is the only person any record puts on it.
    detail.audience = askAudience(finding, {
      // `personName`, so the button reads "Ask Hugo Hart" rather than the login
      // it joins on.
      assignee: personName(detail.item?.assignee),
    });
  }

  if (finding.subject.kind === 'commitment') {
    const note = vault.get(finding.subject.noteId);
    if (!note) return detail;
    detail.note = note;
    // A commitment alert cites Zoom. The person who TOOK the promise is on the
    // note, and is exactly who the preview addresses its draft to.
    detail.audience = askAudience(finding, { owner: note.owner });

    if (note.container) {
      const c = source.graph.nodes.find((n) => n.id === note.container);
      if (c) {
        detail.container = {
          id: c.id,
          label: c.label,
          ...('closedAt' in c && c.closedAt ? { closedAt: c.closedAt } : {}),
        };
      }

      const byKey = new Map(items.map((i) => [i.key, i]));
      detail.checklist = vault
        .list()
        .filter((n) => n.container === note.container && n.kind === 'commitment')
        .map((n) => {
          const filed = filedKeys(n);
          return {
            title: n.title,
            tracked: filed.length > 0,
            ...(n.id === note.id ? { subject: true as const } : {}),
            ref: filed.length
              ? filed
                  .map((k) => `${k}${byKey.get(k) ? ` · ${byKey.get(k)!.status.replace('_', ' ')}` : ''}`)
                  .join(', ')
              : n.relatedKeys.length
                ? // Reconstructed, and said so. The checklist is the alert's
                  // argument, so a guess must read as a guess.
                  `probably ${n.relatedKeys.join(', ')} — nothing says so`
                : 'no ticket',
          };
        })
        /**
         * Ticks first, then the crosses, and THIS alert's own promise last.
         *
         * The list is an argument and it should end on its subject. Sorting on
         * `tracked` alone gets the ticks right and leaves the crosses in vault
         * order, so a container with two untracked promises ends on whichever
         * one happens to sort first — which on this fixture is not the one the
         * page is about. Reading order is the only emphasis a checklist has.
         */
        .sort(
          (a, b) =>
            Number(b.tracked) - Number(a.tracked) ||
            Number(a.title === note.title) - Number(b.title === note.title),
        );
    }
  }

  return detail;
}
