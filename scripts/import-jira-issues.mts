/**
 * Jira issues → the connection graph.
 *
 * The offline half of the pair. `fetch-jira-issues.mts` does the reading;
 * this interprets, and it is deterministic — files in, files out, no
 * credentials and no network — so `verify-collector.mts` can be pointed at the
 * result before the gateway ever sees it.
 *
 *   npx tsx scripts/import-jira-issues.mts --issues live-raw/issues.json \
 *     --sprints live-raw/sprints.json --out ./live-graph
 *   npx tsx scripts/verify-collector.mts ./live-graph
 *
 * THIS IS THE SPINE, so it runs first. Every other emitter filters its
 * extracted keys against the projects this writes, and Slack enriches the
 * people this writes with `handles.slack`. Running it second would leave the
 * others with nothing to filter against — which fails open, not closed: a
 * decision record numbered `ADR-014` matches the Jira key regex exactly.
 *
 * WHAT IT DELIBERATELY DOES NOT EMIT:
 *
 *  - **Issue records.** `GRAPH-SCHEMA.md` is explicit that Jira needs none —
 *    everything the projection reads is on the node — and `StoredIssue` has no
 *    `recordRef` field to carry one. A record here would be a file nothing
 *    opens.
 *  - **Non-blocking issue links.** "Relates to" is not a dependency and there
 *    is no relation in the vocabulary that means it without overstating it. A
 *    wrong edge is worse than a missing one: `depends_on` feeds cycle
 *    detection, which accuses a team of an unschedulable plan.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const issuesFile = opt('issues');
const sprintsFile = opt('sprints');
const outDir = opt('out') ?? './live-graph';

if (!issuesFile) {
  console.error(
    'usage: import-jira-issues.mts --issues <issues.json> [--sprints <sprints.json>] --out <dir>\n' +
      '\n' +
      '  --issues   what fetch-jira-issues.mts wrote\n' +
      '  --sprints  what fetch-jira-sprints.mts wrote. Without it every sprint is\n' +
      '             assumed ACTIVE, and the missing-ticket finding fires on a\n' +
      '             container CLOSING — so it would never fire, silently.',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// The contract, restated locally so this script has no build dependency.
// `libs/domain/src/graph.ts` is the authority; `docs/GRAPH-SCHEMA.md` the prose.
// ---------------------------------------------------------------------------

interface StoredNode extends Record<string, unknown> {
  id: string;
  kind: string;
  label: string;
  source: string;
}
interface StoredEdge {
  source: string;
  target: string;
  relation: string;
  tier: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  origin: 'structural' | 'declared' | 'reconstructed';
  why?: string;
  evidence: { source: string; ref: string; quote?: string }[];
}

interface JiraUser {
  name?: string;
  key?: string;
  emailAddress?: string;
  displayName?: string;
}
interface JiraIssue {
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    description?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string; subtask?: boolean };
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    created?: string;
    updated?: string;
    resolutiondate?: string | null;
    parent?: { key?: string };
    project?: { key?: string };
    issuelinks?: {
      type?: { name?: string; inward?: string; outward?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    }[];
  };
}

const capture = JSON.parse(await readFile(issuesFile, 'utf8')) as {
  baseUrl?: string;
  fields?: { sprint?: string; epic?: string; points?: string };
  issues: JiraIssue[];
};

const BASE = (capture.baseUrl ?? '').replace(/\/+$/, '');
const F_SPRINT = capture.fields?.sprint ?? 'customfield_10422';
const F_EPIC = capture.fields?.epic ?? 'customfield_11096';
const F_POINTS = capture.fields?.points ?? 'customfield_10420';

interface SprintMeta {
  state?: 'future' | 'active' | 'closed';
  startsAt?: string;
  endsAt?: string;
  closedAt?: string;
}
const sprintMeta: Record<string, SprintMeta> = sprintsFile
  ? (JSON.parse(await readFile(sprintsFile, 'utf8')) as Record<string, SprintMeta>)
  : {};

// ---------------------------------------------------------------------------
// Field readers, each of which has a way of being silently wrong
// ---------------------------------------------------------------------------

/**
 * Jira's issue type is free text per project; ours is a closed union.
 *
 * Anything unrecognised becomes `task` rather than being dropped: the level
 * decides how a row reads, never whether it exists, so guessing wrong costs a
 * label and guessing "skip" would cost the issue.
 */
function levelOf(type: string, subtask: boolean): string {
  const t = type.toLowerCase();
  if (subtask) return 'task';
  if (t.includes('initiative')) return 'initiative';
  if (t.includes('epic')) return 'epic';
  if (t.includes('bug') || t.includes('defect')) return 'bug';
  if (t.includes('spike') || t.includes('research')) return 'spike';
  if (t.includes('incident') || t.includes('outage')) return 'incident';
  if (t.includes('story')) return 'story';
  return 'task';
}

/** Jira's own three-way category, which is more reliable than reading the word. */
function categoryOf(key: string | undefined, word: string): 'todo' | 'doing' | 'done' {
  if (key === 'done') return 'done';
  if (key === 'new') return 'todo';
  if (key === 'indeterminate') return 'doing';
  const s = word.toLowerCase();
  if (/done|closed|resolved|complete|cancel/.test(s)) return 'done';
  if (/to ?do|backlog|open|new|selected/.test(s)) return 'todo';
  return 'doing';
}

/**
 * The sprint field is a SERIALISED JAVA TOSTRING on Server and Data Centre.
 *
 * `com.atlassian.greenhopper.service.sprint.Sprint@5a6ba73b[…,name=WP Frontier
 * 33,…]` — so the name has to be pulled out of it with a regex. Newer Jira and
 * Cloud return objects instead, and both shapes turn up on the same instance
 * depending on the endpoint, so both are read. Getting this wrong yields no
 * sprint membership at all, which turns off the one finding that needs a
 * container to close.
 */
function sprintNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && typeof (entry as { name?: string }).name === 'string') {
      out.push((entry as { name: string }).name);
    } else if (typeof entry === 'string') {
      const m = entry.match(/,name=([^,]+)/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

/** The join key, and the same pattern `extractKeys` uses in the domain. */
const KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const nodes = new Map<string, StoredNode>();
const links: StoredEdge[] = [];
const people = new Map<string, StoredNode>();
const projects = new Set<string>();
const sprintsSeen = new Set<string>();
const issueKeys = new Set<string>();
/** Link phrases this did not read as a dependency, counted so a miss is visible. */
const unlinked = new Map<string, number>();

/** Email is the id, because it is the only identifier every source shares. */
function person(u: JiraUser | null | undefined): string | undefined {
  if (!u) return undefined;
  const email = (u.emailAddress ?? '').trim().toLowerCase();
  // No email is not a person we can join on — a Jira username matches nothing in
  // Slack or Zoom, and inventing `person:<username>` would put a second node in
  // the graph for a human another collector already wrote.
  if (!email) return undefined;
  const id = `person:${email}`;
  if (!people.has(id)) {
    people.set(id, {
      id,
      kind: 'person',
      label: u.displayName ?? email,
      source: 'jira',
      email,
      displayName: u.displayName ?? email,
      ...(u.name ? { handles: { jira: u.name } } : {}),
    });
  }
  return id;
}

for (const issue of capture.issues) {
  const f = issue.fields ?? {};
  issueKeys.add(issue.key);
  if (f.project?.key) projects.add(f.project.key);

  const status = f.status?.name ?? 'Unknown';
  const points = f[F_POINTS];

  nodes.set(`issue:${issue.key}`, {
    id: `issue:${issue.key}`,
    kind: 'issue',
    label: f.summary ?? issue.key,
    source: 'jira',
    key: issue.key,
    level: levelOf(f.issuetype?.name ?? '', !!f.issuetype?.subtask),
    // The VENDOR word, kept as-is. `MC_STATUS_MAP` maps it at the projection
    // seam, and `inspect.mjs statuses` audits what fell through.
    status,
    statusCategory: categoryOf(f.status?.statusCategory?.key, status),
    ...(typeof points === 'number' ? { points } : {}),
    ...(BASE ? { url: `${BASE}/browse/${issue.key}` } : {}),
    ...(f.created ? { createdAt: f.created } : {}),
    ...(f.updated ? { updatedAt: f.updated } : {}),
    ...(f.resolutiondate ? { resolvedAt: f.resolutiondate } : {}),
  });
}

// A second pass, because an edge may not point at a node that does not exist
// and the first pass is what decides which issues exist.
for (const issue of capture.issues) {
  const f = issue.fields ?? {};
  const from = `issue:${issue.key}`;
  const ref = { source: 'jira', ref: from };

  const assignee = person(f.assignee);
  if (assignee) {
    (nodes.get(from) as Record<string, unknown>).assignee = (
      people.get(assignee) as { email: string }
    ).email;
    links.push({
      source: from,
      target: assignee,
      relation: 'assigned_to',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });
  }

  for (const name of sprintNames(f[F_SPRINT])) {
    sprintsSeen.add(name);
    links.push({
      source: from,
      target: `sprint:${name}`,
      relation: 'in_sprint',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });
  }

  const epic = f[F_EPIC];
  if (typeof epic === 'string' && nodes.has(`issue:${epic}`)) {
    links.push({
      source: from,
      target: `issue:${epic}`,
      relation: 'belongs_to_epic',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });
  }

  if (f.parent?.key && nodes.has(`issue:${f.parent.key}`)) {
    links.push({
      source: from,
      target: `issue:${f.parent.key}`,
      relation: 'child_of',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });
  }

  /**
   * `depends_on` runs DEPENDENT → BLOCKER, the reverse of `blocks`.
   *
   * Read the PHRASE, not the link type's name. Jira lets every instance name
   * its own link types and this deployment uses none of the defaults: the
   * dependency pair here is `depends on` / `blocks` (type "Dependency") and
   * `has to be done before` / `has to be done after` (type "Gantt End to
   * Start"). Matching on `Blocks` found neither, and the first version of this
   * silently produced zero dependency edges against a board with 24 of them —
   * which reads downstream as "this team has no dependencies" rather than as a
   * parsing failure.
   *
   * Both ends state the same fact, and both read as "THIS ISSUE <phrase> OTHER"
   * whether Jira hands the other back as `inwardIssue` or `outwardIssue`. So
   * the phrase alone decides which way the edge runs, and an unrecognised one
   * is skipped rather than guessed: `is related to`, `clones` and `released in`
   * are not dependencies, and `depends_on` feeds cycle detection.
   */
  for (const l of f.issuelinks ?? []) {
    const other = l.inwardIssue?.key ?? l.outwardIssue?.key;
    const phrase = (l.inwardIssue ? l.type?.inward : l.type?.outward) ?? '';
    if (!other) continue;

    const p = phrase.toLowerCase().trim();
    const iWait = /^(depends on|is blocked by|has to be done after|is caused by)$/.test(p);
    const theyWait = /^(blocks|has to be done before|causes)$/.test(p);
    if (!iWait && !theyWait) {
      unlinked.set(p, (unlinked.get(p) ?? 0) + 1);
      continue;
    }

    const [waiter, blocker] = iWait ? [from, `issue:${other}`] : [`issue:${other}`, from];
    if (!nodes.has(waiter) || !nodes.has(blocker)) continue;
    links.push({
      source: waiter,
      target: blocker,
      relation: 'depends_on',
      tier: 'EXTRACTED',
      origin: 'declared',
      why: `Jira link on ${issue.key}: "${phrase} ${other}"`,
      evidence: [ref],
    });
  }

  // A description naming another ticket is a real join, and the only one Jira
  // does not model as a link.
  const described = String(f.description ?? '');
  for (const key of new Set(described.match(KEY_RE) ?? [])) {
    if (key === issue.key || !nodes.has(`issue:${key}`)) continue;
    links.push({
      source: from,
      target: `issue:${key}`,
      relation: 'mentions',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [{ source: 'jira', ref: from, quote: `${issue.key} names ${key} in its description` }],
    });
  }
}

for (const [id, p] of people) nodes.set(id, p);

/**
 * Sprint nodes, synthesised from the names the issues reference.
 *
 * `state` defaults to `active` when the sprint file does not know the name,
 * because "we have not observed it closing" is the honest reading — and it is
 * the safe one: a sprint wrongly marked closed fires the flagship finding for
 * every unticketed promise in it.
 */
for (const name of [...sprintsSeen].sort()) {
  const meta = sprintMeta[name] ?? {};
  nodes.set(`sprint:${name}`, {
    id: `sprint:${name}`,
    kind: 'sprint',
    source: 'jira',
    label: name,
    state: meta.state ?? 'active',
    ...(meta.startsAt ? { startsAt: meta.startsAt } : {}),
    ...(meta.endsAt ? { endsAt: meta.endsAt } : {}),
    ...(meta.closedAt ? { closedAt: meta.closedAt } : {}),
  });
}

// Nothing may point at a node that does not exist — a contract violation the
// verifier rejects outright. Sprints are added above, so this catches the rest.
const before = links.length;
const kept = links.filter((l) => nodes.has(l.source) && nodes.has(l.target));
const dropped = before - kept.length;

const graph = {
  directed: true,
  multigraph: true,
  graph: {
    generatedAt: new Date().toISOString(),
    generator: 'mission-control import-jira-issues',
    sources: ['jira'],
  },
  nodes: [...nodes.values()],
  links: kept,
};

await mkdir(outDir, { recursive: true }).catch(() => {});
await mkdir(dirname(`${outDir}/records/.keep`), { recursive: true }).catch(() => {});
await writeFile(`${outDir}/graph.json`, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

// ---------------------------------------------------------------------------

const byKind = [...nodes.values()].reduce<Record<string, number>>((a, n) => {
  a[n.kind] = (a[n.kind] ?? 0) + 1;
  return a;
}, {});
const byRelation = kept.reduce<Record<string, number>>((a, l) => {
  a[l.relation] = (a[l.relation] ?? 0) + 1;
  return a;
}, {});
const closedSprints = [...nodes.values()].filter(
  (n) => n.kind === 'sprint' && n.state === 'closed',
).length;

console.log(`\n  ${nodes.size} node(s) → ${outDir}/graph.json`);
console.log(`  ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
console.log(`  ${kept.length} edge(s): ${Object.entries(byRelation).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
if (dropped) console.log(`  ${dropped} edge(s) dropped — they pointed outside the fetched scope`);
console.log(`  projects: ${[...projects].join(', ')}`);

/**
 * Every link phrase that did NOT become a dependency, with its count.
 *
 * The one output worth reading twice. A dependency vocabulary this does not
 * know produces a graph that looks healthy and asserts that nothing waits on
 * anything — so the phrases are printed rather than dropped quietly, and a
 * scheduling phrase sitting in this list is the signal to add it above.
 */
if (unlinked.size) {
  console.log('\n  link phrases NOT read as dependencies (check none of these is one):');
  for (const [p, n] of [...unlinked].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(3)}x  ${p}`);
  }
}

if (!closedSprints) {
  console.log(
    '\n  NO CLOSED SPRINT. The missing-ticket finding fires when a commitment\'s\n' +
      '  container closes, so it cannot fire on this graph. Pass --sprints.',
  );
}
const noEmail = capture.issues.filter((i) => i.fields?.assignee && !i.fields.assignee.emailAddress).length;
if (noEmail) {
  console.log(
    `\n  ${noEmail} issue(s) have an assignee Jira gave no email for, so no person\n` +
      '  node was written for them. They will show as unassigned.',
  );
}

console.log(`\nNext:\n  npx tsx scripts/verify-collector.mts ${outDir}`);
