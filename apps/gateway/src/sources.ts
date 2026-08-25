/**
 * Coverage — what this knows, and what it could not read.
 *
 * THE RULE THAT KEEPS THE VENDOR PANES FROM RETURNING THROUGH THE BACK DOOR:
 * Sources answers "what does it know?", never "what did they say?"
 * (`DIRECTION.md` §6). Rows show *scope* — which project, which channels, which
 * board — and counts. There is no route from here into a record, because the
 * moment a row expands into a message list the Slack pane is back with an extra
 * click in front of it.
 *
 * ONE EXCEPTION, AND IT IS REPAIR RATHER THAN BROWSING: the things that did not
 * join. You only ever see the records that failed, never the 98% that did.
 *
 * That block is also nearly free, which is the good part. The collectors already
 * drop exactly these — an arrow whose ends do not both resolve to a key, a page
 * naming no ticket, a sticky that is empty after stripping — and they drop them
 * *silently*. Counting them instead of discarding them is the whole change, and
 * it is the most honest thing in the product: three arrows pointing at something
 * unresolvable is a dependency somebody believes they expressed and this system
 * will never see. A cross-origin iframe can never tell you that.
 */

import {
  CONFIDENCE_TIERS,
  isNodeKind,
  type ConfidenceTier,
  type Owner,
  type StoredGraph,
  type Finding,
} from '@mc/domain';
import type { GraphSource } from '@mc/connectors';

export interface SourceRow {
  surface: Owner | 'github';
  label: string;
  /** What is in scope: which project, which channels, which board. */
  scope: string;
  count: string;
  state: 'connected' | 'planned';
}

export interface JoinFailure {
  surface: Owner | 'github';
  what: string;
  /**
   * The same phrase for a count of one.
   *
   * Every row here is `{count} {what}`, and on a small corpus the counts are
   * routinely 1 — "1 pages name no ticket", "1 dependencies the tracker never
   * recorded". Bad grammar on the page whose job is to make somebody trust the
   * numbers is a poor trade for five strings.
   */
  one: string;
  why: string;
  count: number;
}

export interface SourcesReport {
  /** The headline numbers, every one read from the graph. */
  stats: { records: number; things: number; connections: number };
  /** How much of what we hold is a fact, a reconstruction, or an open question. */
  tiers: Record<ConfidenceTier, number>;
  rows: SourceRow[];
  failures: JoinFailure[];
  generatedAt: string;
  generator: string;
}

/** Node kinds that are a *record* somebody produced, against the things they are about. */
const RECORD_KINDS = new Set(['message', 'meeting', 'page', 'pr', 'sticky']);

export function buildSources(source: GraphSource, coverage: Finding[] = []): SourcesReport {
  const g = source.graph;
  const nodes = g.nodes;

  const count = (kind: string): number => nodes.filter((n) => n.kind === kind).length;

  const tiers = Object.fromEntries(CONFIDENCE_TIERS.map((t) => [t, 0])) as Record<
    ConfidenceTier,
    number
  >;
  for (const e of g.links) tiers[e.tier] = (tiers[e.tier] ?? 0) + 1;

  const channels = [
    ...new Set(
      nodes
        .filter(isNodeKind('message'))
        .map((n) => n.container?.replace(/^channel:slack\//, ''))
        .filter((c): c is string => !!c),
    ),
  ].sort();

  const board = nodes.find(isNodeKind('board'));
  const frames = count('frame');
  const sprints = nodes.filter(isNodeKind('sprint'));
  const projects = [
    ...new Set(nodes.filter(isNodeKind('issue')).map((n) => n.key.split('-')[0]!)),
  ].sort();

  const rows: SourceRow[] = [
    {
      surface: 'jira',
      label: 'Jira',
      scope: `project${projects.length === 1 ? '' : 's'} ${projects.join(', ')} · ${sprints.length} sprints`,
      count: `${count('issue')} issues`,
      state: 'connected',
    },
    {
      surface: 'slack',
      label: 'Slack',
      scope: channels.map((c) => `#${c}`).join(' · ') || 'no channels in scope',
      count: `${count('message')} messages`,
      state: 'connected',
    },
    {
      surface: 'zoom',
      label: 'Zoom',
      scope: 'planning, retro and refinement recordings',
      count: `${count('meeting')} transcripts`,
      state: 'connected',
    },
    {
      surface: 'confluence',
      label: 'Confluence',
      scope: 'decision records and runbooks',
      count: `${count('page')} pages`,
      state: 'connected',
    },
    {
      surface: 'miro',
      label: 'Miro',
      scope: board ? `board ${board.label} · ${frames} frames` : 'no board in scope',
      count: `${count('sticky')} stickies`,
      state: 'connected',
    },
    {
      surface: 'github',
      label: 'GitHub',
      scope: 'pull request state against each ticket, joined on the branch name',
      count: `${count('pr')} pull requests`,
      state: 'connected',
    },
  ];

  return {
    stats: {
      records: nodes.filter((n) => RECORD_KINDS.has(n.kind)).length,
      things: count('issue') + count('note'),
      connections: g.links.length,
    },
    tiers,
    rows,
    failures: findJoinFailures(g, coverage),
    generatedAt: g.graph.generatedAt,
    generator: g.graph.generator,
  };
}

/**
 * What did not join, and what each one costs.
 *
 * Every row here is a thing to repair rather than a thing to read. The wording
 * matters: "4 pages name no ticket" is a statement about *our* reach, not about
 * somebody's writing, and phrasing it as a failure of the page would be blaming
 * the source for a limit of the join.
 */
export function findJoinFailures(g: StoredGraph, coverage: Finding[] = []): JoinFailure[] {
  const joined = new Set(
    g.links
      .filter((e) => ['mentions', 'documents', 'annotates', 'links_to'].includes(e.relation))
      .map((e) => e.source),
  );

  const orphansOf = (kind: string): number =>
    g.nodes.filter((n) => n.kind === kind && !joined.has(n.id)).length;

  const out: JoinFailure[] = [
    {
      surface: 'confluence',
      what: 'pages name no ticket',
      one: 'page names no ticket',
      why: 'they may be about work we are tracking, and nothing in them says which',
      count: orphansOf('page'),
    },
    {
      surface: 'miro',
      what: 'stickies carry no key',
      one: 'sticky carries no key',
      why: 'somebody wrote it in the room and no board arrow or ticket picks it up',
      count: orphansOf('sticky'),
    },
    {
      surface: 'slack',
      what: 'messages join to nothing',
      one: 'message joins to nothing',
      why: 'no ticket key, no link, and nothing else places them',
      count: orphansOf('message'),
    },
    /**
     * The two that are not about a missing key, and the only rows here counted
     * from the DETECTORS rather than from the graph.
     *
     * They are the findings that used to be on the front door, and they are here
     * because Sources is where you look to know how settled what it holds
     * actually is (`DIRECTION.md` §6) — one per edge, so on a real programme
     * they arrive by the hundred and an alert list is the wrong home. See
     * `COVERAGE_KINDS`.
     *
     * Counted from the pass rather than re-queried off `g.links`, because the
     * detector deduplicates and honours a dismissal and a raw edge count does
     * neither: dismissing one used to leave this page stating the old number for
     * ever, with nothing failing.
     */
    {
      surface: 'jira',
      what: 'declared links nothing corroborates',
      one: 'declared link nothing corroborates',
      why: 'the tracker asserts a dependency and no independent evidence supports it',
      count: coverage.filter((f) => f.kind === 'suspect_link').length,
    },
    {
      surface: 'jira',
      what: 'dependencies the tracker never recorded',
      one: 'dependency the tracker never recorded',
      why: 'the evidence describes one and no link in Jira says so, so no board can show it',
      count: coverage.filter((f) => f.kind === 'undetected_dependency').length,
    },
  ];

  return out.filter((f) => f.count > 0);
}
