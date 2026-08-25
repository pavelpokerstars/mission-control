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
  type StoredNode,
  FINDING_RANK,
  type Evidence,
  type Finding,
  type Note,
  type StoredGraph,
  type WorkItem,
  type WorkItemKey,
  type WorkRow,
  type WorkSignal,
} from '@mc/domain';
import { projectArrows, type Connectors, type GraphSource } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import { gatherWorkFacts } from './work.js';
import { answeredFindingIds } from './act.js';

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

  const out: Finding[] = [];
  for (const n of notes) {
    if (n.kind !== 'commitment' || n.status !== 'open') continue;
    if (n.relatedKeys.length > 0) continue;
    if (!n.owner || !n.dueAt) continue;

    const container = n.container
      ? (containers.get(n.container) ?? byLabel.get(n.container) ?? undefined)
      : undefined;
    if (!container || container.state !== 'closed') continue;

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
      id: `missing_ticket:${n.id}`,
      kind: 'missing_ticket',
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
      severity: !dueFromSprint && overdueDays >= OVERDUE_CRIT_DAYS ? 'crit' : 'warn',
      claim: `${n.title} was never filed`,
      impact: [
        dueFromSprint
          ? `Taken by ${n.owner}, with no date given`
          : `Agreed by ${n.owner}, due ${n.dueAt.slice(0, 10)}`,
        dueFromSprint
          ? `checked against ${container.label}'s close`
          : overdueDays > 0
            ? `${overdueDays} day${overdueDays === 1 ? '' : 's'} past due`
            : 'not yet due',
        `${container.label} has closed and no issue references it`,
      ].join(' · '),
      // When the container closed, not when this pass ran. A finding that
      // restamps itself every pass cannot be aged, ranked or deduplicated, and
      // "fired 08:02 today" would be a lie about a promise made in July.
      firedAt: container.closedAt ?? container.endsAt ?? n.dueAt,
      evidence: n.evidence,
      dedupeKey: `missing_ticket:${n.id}`,
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
        impact: `${d.why ?? 'Reconstructed from evidence'} — “${title(d.target)}” is not linked as a blocker, so no board shows it.`,
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
function findFromWorkRows(rows: WorkRow[], cycles: WorkItemKey[][]): Finding[] {
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
        // The newest record that made this true, not the moment the pass ran.
        firedAt: row.lastActivity ?? new Date().toISOString(),
        evidence: signal.evidence ?? [],
        dedupeKey: loop ? `cycle:${members.join('>')}` : `${kind}:${row.item.key}`,
      });
    }
  }
  return out;
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
    ? await gatherWorkFacts(connectors, vault, projectArrows(source.graph))
    : undefined;

  const findings = dedupe([
    ...findMissingTickets(notes, source.graph),
    ...(lane ? findFromWorkRows(lane.rows, lane.cycles) : []),
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
  return rankFindings(findings.filter((f) => !answered.has(f.id)));
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
  checklist?: { title: string; tracked: boolean; ref: string }[];
}

export async function findingDetail(
  id: string,
  input: FindingsInput,
): Promise<FindingDetail | undefined> {
  const { source, vault, items } = input;
  const findings = await runFindings(input);
  const finding = findings.find((f) => f.id === id);
  if (!finding) return undefined;

  const detail: FindingDetail = { finding };

  if (finding.subject.kind === 'workitem') {
    detail.item = items.find((i) => i.key === (finding.subject as { key: string }).key);
  }

  if (finding.subject.kind === 'commitment') {
    const note = vault.get(finding.subject.noteId);
    if (!note) return detail;
    detail.note = note;

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
        .map((n) => ({
          title: n.title,
          tracked: n.relatedKeys.length > 0,
          ref: n.relatedKeys.length
            ? n.relatedKeys
                .map((k) => `${k}${byKey.get(k) ? ` · ${byKey.get(k)!.status.replace('_', ' ')}` : ''}`)
                .join(', ')
            : 'no ticket',
        }))
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
