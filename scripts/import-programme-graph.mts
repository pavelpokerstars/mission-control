/**
 * Read `programme_graph`'s output and write ours.
 *
 * WHY AN ADAPTER RATHER THAN AN EXPORTER CHANGE. B1 asked whether a real
 * `programme_graph` refresh reads as `GRAPH-SCHEMA.md` describes "with no
 * exporter change". Read against the actual tool, the answer is **no** — and the
 * right fix is here rather than there. That tool is upstream, general, and
 * serves its own MCP server and HTML view; bending its schema to one consumer
 * would make every future consumer's problem ours. This is the consumer's job.
 *
 * Most of it already lines up, because our contract was designed from it: node
 * ids are `kind:value`, the envelope is networkx `node_link_data`
 * (`directed`/`multigraph`/`graph`/`nodes`/`links`), the tiers are
 * EXTRACTED/INFERRED/AMBIGUOUS, declared links start AMBIGUOUS and get promoted
 * by reconciliation, and eight of ten relation names match exactly.
 *
 *   npx tsx scripts/import-programme-graph.mts \
 *     --in  data/programme_graph/graph.json \
 *     --out ./live-graph \
 *     [--sprints sprints.json] [--people people.json]
 *
 * Then point the gateway at `--out`:  MC_GRAPH_DIR=./live-graph npm run dev
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const inPath = opt('in') ?? 'data/programme_graph/graph.json';
const outDir = opt('out') ?? 'live-graph';
const sprintsPath = opt('sprints');
const peoplePath = opt('people');

const notes: string[] = [];
const warnings: string[] = [];

// ---------------------------------------------------------------------------
// What programme_graph writes
// ---------------------------------------------------------------------------

interface PgNode {
  id: string;
  kind: string;
  label?: string;
  key?: string;
  summary?: string;
  status?: string;
  issue_type?: string;
  url?: string;
  assignee?: string;
  squad?: string;
  tribe?: string;
  sprint_names?: string[];
  story_points?: number | null;
  updated?: string;
  stub?: boolean;
  name?: string;
  [k: string]: unknown;
}

interface PgEdge {
  source: string;
  target: string;
  relation?: string;
  /** Their name for what we call `tier`. Same three values. */
  confidence?: string;
  origin?: string;
  why?: string;
  score?: number;
  reconciled?: boolean;
  active?: boolean;
  provenance?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  [k: string]: unknown;
}

interface PgGraph {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes: PgNode[];
  links: PgEdge[];
}

// ---------------------------------------------------------------------------
// The mappings
// ---------------------------------------------------------------------------

/**
 * Jira's issue type → our `level`.
 *
 * Ours is a fixed five because hierarchy is a *value* in the graph rather than a
 * node kind. An unrecognised type becomes `task`, which is the honest default:
 * something that is work and is not above anything.
 */
const LEVELS: Record<string, string> = {
  initiative: 'initiative',
  epic: 'epic',
  story: 'story',
  task: 'task',
  'sub-task': 'task',
  subtask: 'task',
  bug: 'bug',
  incident: 'bug',
  spike: 'spike',
};

/**
 * Two relation names differ; the other eight are identical.
 *
 * `mentions_issue` is theirs for prose that names a ticket, which is our
 * `mentions`. `targets_fix_version` is a Jira fix version, which is our
 * `targets_release`.
 */
const RELATIONS: Record<string, string> = {
  mentions_issue: 'mentions',
  targets_fix_version: 'targets_release',
};

/**
 * `statusCategory` is NOT in their output, and it is our last-resort fallback
 * when a workflow word is unmapped.
 *
 * Derived here from the word itself, coarsely and on purpose — it is a fallback,
 * and the real answer is `MC_STATUS_MAP`, which reads the vendor string we pass
 * through untouched. `inspect statuses` says which words still need mapping.
 */
function categoryOf(status: string): string {
  const s = status.toLowerCase();
  if (/done|closed|resolved|complete|cancel/.test(s)) return 'done';
  if (/to ?do|backlog|open|new|selected/.test(s)) return 'todo';
  return 'doing';
}

/** `"PAY-9031 Emit a settled event"` → `"Emit a settled event"`. */
function labelOf(n: PgNode): string {
  if (n.summary) return n.summary;
  const label = n.label ?? n.id;
  return n.key && label.startsWith(n.key) ? label.slice(n.key.length).trim() : label;
}

// ---------------------------------------------------------------------------

const pg = JSON.parse(await readFile(inPath, 'utf8')) as PgGraph;
if (!Array.isArray(pg.nodes) || !Array.isArray(pg.links)) {
  throw new Error(`${inPath} is not networkx node-link JSON — no nodes/links arrays.`);
}

/**
 * The identity map, if supplied — `{ "Display Name": "someone@example.com", … }`.
 *
 * `programme_graph` builds `person:<display name>`, because `_normalize_assignee`
 * reduces Jira's user object to a display name. Our contract keys people on
 * **email**, since that is the only identifier every source shares — a Slack
 * author and a Zoom speaker can never be reconciled against a display name that
 * only Jira uses.
 */
const emailOf: Record<string, string> = peoplePath
  ? (JSON.parse(await readFile(peoplePath, 'utf8')) as Record<string, string>)
  : {};
if (!peoplePath) {
  warnings.push(
    'No --people map, so person nodes keep their Jira display name as the id.\n' +
      '  Our contract keys them on email (the only id every source shares), so\n' +
      '  `verify-collector` will flag it and cross-surface people rollups will\n' +
      '  count the same human once per surface. A file of\n' +
      '  { "Riya Sharma": "riya@example.com" } fixes it.',
  );
}

/**
 * Sprint state and dates, if supplied.
 *
 * THIS IS THE ONE THAT STOPS THE FLAGSHIP FINDING. `programme_graph` emits no
 * sprint nodes at all — sprints exist only as `sprint_names[]` strings on an
 * issue, with no state and no dates. `findMissingTickets` fires when a
 * commitment's **container has closed**, resolving `note.container` against a
 * sprint node whose `state` is `closed`. With no such node there is no trigger,
 * and the alert this product is built on cannot fire on real data — silently,
 * because nothing errors.
 *
 * Jira's own agile API has all of it (`/rest/agile/1.0/board/{id}/sprint`), so
 * this was a fetch nobody had written rather than information that did not
 * exist. `scripts/fetch-jira-sprints.mts` writes exactly this file now; a
 * hand-written one still works, and the shape is below.
 */
interface SprintMeta {
  state?: 'future' | 'active' | 'closed';
  startsAt?: string;
  endsAt?: string;
  closedAt?: string;
}
const sprintMeta: Record<string, SprintMeta> = sprintsPath
  ? (JSON.parse(await readFile(sprintsPath, 'utf8')) as Record<string, SprintMeta>)
  : {};

// ---------------------------------------------------------------------------

const nodes: Record<string, unknown>[] = [];
const links: Record<string, unknown>[] = [];
const sprintNames = new Set<string>();

/**
 * Old id → new id, for anything re-keyed.
 *
 * Re-keying a person from `person:Riya Sharma` to `person:riya@example.com`
 * without rewriting the edges that point at them leaves every `assigned_to`
 * dangling. `verify-collector` caught it — "no edge points at a node that does
 * not exist" — which is precisely the check that exists for this.
 */
const rekeyed = new Map<string, string>();

for (const n of pg.nodes) {
  if (n.kind === 'issue') {
    const status = n.status ?? '';
    for (const s of n.sprint_names ?? []) sprintNames.add(s);
    nodes.push({
      id: n.id,
      kind: 'issue',
      source: 'jira',
      label: labelOf(n),
      key: n.key ?? n.id.replace(/^issue:/, ''),
      level: LEVELS[(n.issue_type ?? '').toLowerCase()] ?? 'task',
      // The vendor's own word, untouched — MC_STATUS_MAP is what reads it.
      status,
      statusCategory: categoryOf(status),
      ...(n.assignee ? { assignee: emailOf[n.assignee] ?? n.assignee } : {}),
      ...(typeof n.story_points === 'number' ? { points: n.story_points } : {}),
      ...(n.url ? { url: n.url } : {}),
      ...(n.updated ? { updatedAt: n.updated } : {}),
    });
    continue;
  }

  if (n.kind === 'person') {
    const display = n.name ?? n.label ?? n.id.replace(/^person:/, '');
    const email = emailOf[display];
    const id = email ? `person:${email}` : n.id;
    if (id !== n.id) rekeyed.set(n.id, id);
    nodes.push({
      // Re-keyed on email when we know it, because every consumer joins on it.
      id,
      kind: 'person',
      source: 'jira',
      label: display,
      email: email ?? display,
      displayName: display,
      // Jira's display name IS its handle here, and naming it explicitly is what
      // lets `buildIdentities` resolve a Slack id to the same human later.
      handles: { jira: display },
    });
    continue;
  }

  // squad / tribe / goal / component pass through — same shape, same ids.
  nodes.push({
    id: n.id,
    kind: n.kind,
    source: 'jira',
    label: n.name ?? n.label ?? n.id,
  });
}

/**
 * Sprint nodes, synthesised — they do not exist upstream.
 *
 * `in_sprint` edges too, from `sprint_names[]`. Both are ours to invent because
 * the information is on the issue and the shape is not.
 */
let closedSprints = 0;
for (const name of [...sprintNames].sort()) {
  const meta = sprintMeta[name] ?? {};
  if (meta.state === 'closed') closedSprints++;
  nodes.push({
    id: `sprint:${name}`,
    kind: 'sprint',
    source: 'jira',
    label: name,
    // `active` is the safe default: it is the state that fires nothing, so an
    // unknown sprint cannot manufacture an alert.
    state: meta.state ?? 'active',
    ...(meta.startsAt ? { startsAt: meta.startsAt } : {}),
    ...(meta.endsAt ? { endsAt: meta.endsAt } : {}),
    ...(meta.closedAt ? { closedAt: meta.closedAt } : {}),
  });
}
for (const n of pg.nodes) {
  if (n.kind !== 'issue') continue;
  for (const s of n.sprint_names ?? []) {
    links.push({
      source: n.id,
      target: `sprint:${s}`,
      relation: 'in_sprint',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });
  }
}
if (!closedSprints) {
  warnings.push(
    `No sprint is marked closed${sprintsPath ? '' : ' (no --sprints file supplied)'}.\n` +
      '  `findMissingTickets` fires when a commitment\'s container CLOSES, so with no\n' +
      '  closed container the flagship finding — a promise nobody ticketed — cannot\n' +
      '  fire at all. Nothing will error; the alert simply never appears.\n' +
      '  programme_graph emits no sprint state. Fetch it:\n' +
      '    npx tsx scripts/fetch-jira-sprints.mts --board <id> --out sprints.json\n' +
      '  then re-run with --sprints sprints.json. Run it with no --board to list\n' +
      '  the boards the account can see.',
  );
}

// ---------------------------------------------------------------------------

let dropped = 0;
for (const e of pg.links) {
  const relation = RELATIONS[e.relation ?? ''] ?? e.relation;
  if (!relation) {
    dropped++;
    continue;
  }
  links.push({
    // Through the remap, or a re-keyed person leaves every edge to them dangling.
    source: rekeyed.get(e.source) ?? e.source,
    target: rekeyed.get(e.target) ?? e.target,
    relation,
    // Their `confidence` is our `tier`. Same three values, different name — and
    // the rename is the single most load-bearing line in this file, because
    // `isStructuralDependency` tests the tier and an absent one means no cycle
    // detection at all.
    tier: e.confidence ?? 'EXTRACTED',
    // `structural` / `declared` / `reconstructed` — identical vocabularies, so
    // this is a pass-through and not a mapping.
    ...(e.origin ? { origin: e.origin } : {}),
    ...(e.why ? { why: e.why } : {}),
    ...(typeof e.score === 'number' ? { score: e.score } : {}),
    /**
     * PASSED THROUGH, and both reconciliation findings are silent without it.
     *
     * `reconcile.py` marks every dependency edge it touches `reconciled: true`,
     * so a later reader can tell "checked and still AMBIGUOUS" — which is the
     * stale-link finding — from "never reconciled", which is not a finding at
     * all. `findReconciliation` gates `suspect_link` on exactly this, so
     * dropping it turns a real signal into silence.
     */
    ...(e.reconciled !== undefined ? { reconciled: e.reconciled } : {}),
    // Their evidence is a dict; ours is a list of {source, ref, quote?, at?}.
    evidence: normaliseEvidence(e),
  });
}

/**
 * Their `evidence` is one dict per edge; ours is a list, because an edge can
 * stand on more than one record. `provenance` carries the field or link type it
 * came from, which is exactly the "why" a reader wants on a declared link.
 */
function normaliseEvidence(e: PgEdge): Record<string, unknown>[] {
  const ev = e.evidence ?? {};
  const prov = e.provenance ?? {};
  const quote = typeof ev.text === 'string' ? ev.text : typeof ev.quote === 'string' ? ev.quote : undefined;
  const ref = typeof prov.field === 'string' ? prov.field : typeof prov.link_type === 'string' ? prov.link_type : undefined;
  if (!quote && !ref) return [];
  return [{ source: 'jira', ...(ref ? { ref } : {}), ...(quote ? { quote } : {}) }];
}

// ---------------------------------------------------------------------------

const out = {
  directed: true as const,
  multigraph: true as const,
  graph: {
    generatedAt: new Date().toISOString(),
    // Named, because `refresh.ts` re-baselines rather than diffing when this
    // changes — so a different collector cannot report a whole programme as new.
    generator: 'programme_graph (via import-programme-graph)',
    sources: ['jira'],
  },
  nodes,
  links,
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'graph.json'), `${JSON.stringify(out, null, 2)}\n`);

// ---------------------------------------------------------------------------

const counts = new Map<string, number>();
for (const n of nodes) counts.set(String(n.kind), (counts.get(String(n.kind)) ?? 0) + 1);

console.log(`\nread  ${inPath}`);
console.log(`wrote ${join(outDir, 'graph.json')}`);
console.log(`\n  ${nodes.length} nodes, ${links.length} edges`);
console.log(`  ${[...counts.entries()].map(([k, v]) => `${v} ${k}`).join(', ')}`);
if (dropped) console.log(`  ${dropped} edge(s) dropped for having no relation`);
for (const n of notes) console.log(`\n  note: ${n}`);
for (const w of warnings) console.log(`\n  WARNING: ${w}`);

console.log(`
Next:
  npx tsx scripts/verify-collector.mts ${outDir}
  MC_GRAPH_DIR=${outDir} npm run dev

There are no records/ — programme_graph reads Jira only, and bodies come from the
other collectors. Every citation will open a record with metadata and no text
until they exist, which is what the "records/ has bodies to cite" warning means.
`);
