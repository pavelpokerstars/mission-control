/**
 * Does a collector's output read the way `GRAPH-SCHEMA.md` says it should?
 *
 * THIS IS B1, TURNED INTO SOMETHING YOU RUN. The question — "does a real
 * `programme_graph` refresh conform, with no exporter change?" — was a
 * conversation with a lead time. It is now a command somebody points at their
 * own output directory, offline, with no gateway and no credentials, whose
 * output can be pasted into a message.
 *
 *   npx tsx scripts/verify-collector.mts /path/to/collector/output
 *
 * WHY NOT `verify-graph.mts`. That one asserts the *planted demo cases* — the
 * unjoined commitment with an owner and a date, the four-ticket cycle, the
 * declared link nothing corroborates. A real graph has no reason to contain any
 * of them, so pointing it at one reports failures that are not failures. This
 * checks only what must be true of ANY graph.
 *
 * TWO SEVERITIES, AND THE SPLIT MATTERS. A contract violation is a bug in the
 * collector and exits non-zero. An unmapped status word or an unresolved person
 * is a **configuration gap** — the app runs, and something joins less well than
 * it could — so those are reported and do not fail the run. Conflating them
 * would make this cry wolf on the first real export, which is how a check gets
 * ignored.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DEPENDS_ON_IS_REVERSED,
  blocksPairOf,
  isRenderableEdge,
  isStructuralDependency,
  type StoredEdge,
  type StoredGraph,
  STORED_NODE_KINDS,
  type StoredNode,
} from '../libs/domain/src/index.js';
import { auditIdentities, auditStatusWords } from '../libs/connectors/src/graph/index.js';

const dir = process.argv[2] ?? process.env.MC_GRAPH_DIR ?? join(process.cwd(), 'fixtures');

let failed = 0;
let warned = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${name}`);
  if (!ok) {
    failed++;
    if (detail) console.log(detail.split('\n').map((l) => `           ${l}`).join('\n'));
  }
}

function warn(name: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'ok  ' : 'warn'}   ${name}`);
  if (!ok) {
    warned++;
    if (detail) console.log(detail.split('\n').map((l) => `           ${l}`).join('\n'));
  }
}

/**
 * From the domain, not restated here. The first version was a hand-written list
 * and it was wrong about `page` and `frame`, which reported two perfectly valid
 * kinds as unknown — a checker that is wrong about the contract is worse than no
 * checker, because it sends somebody fixing their collector.
 */
const KINDS = new Set<string>(STORED_NODE_KINDS);
const TIERS = new Set(['EXTRACTED', 'INFERRED', 'AMBIGUOUS']);

console.log(`\nchecking ${dir}\n`);

// ---------------------------------------------------------------------------

let graph: StoredGraph;
try {
  graph = JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8')) as StoredGraph;
} catch (err) {
  console.log(`  FAIL   ${dir}/graph.json could not be read`);
  console.log(`           ${err instanceof Error ? err.message : String(err)}`);
  console.log('\n1 check failed — nothing else could be checked.\n');
  process.exit(1);
}

console.log('the envelope');
check('nodes is an array', Array.isArray(graph.nodes));
check('links is an array', Array.isArray(graph.links));
check('graph.generatedAt is a date', !!graph.graph?.generatedAt && Number.isFinite(Date.parse(graph.graph.generatedAt)));
check(
  'graph.generator names what wrote it',
  !!graph.graph?.generator,
  'refresh.ts re-baselines rather than diffing when this changes, so that a\n' +
    'different collector cannot report a whole programme as new. Without it,\n' +
    'every refresh looks like a first run.',
);
warn('graph.sources lists the surfaces walked', Array.isArray(graph.graph?.sources) && graph.graph.sources.length > 0);

if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
  console.log('\nnot a graph — stopping.\n');
  process.exit(1);
}

// ---------------------------------------------------------------------------

console.log('\nnodes');
const ids = new Map<string, StoredNode>(graph.nodes.map((n) => [n.id, n]));
check(
  'every id is kind:value',
  graph.nodes.every((n) => /^[a-z_]+:/.test(n.id)),
  sample(graph.nodes.filter((n) => !/^[a-z_]+:/.test(n.id)).map((n) => n.id)),
);
check('no duplicate ids', ids.size === graph.nodes.length, `${graph.nodes.length - ids.size} duplicate(s)`);
warn(
  'every kind is one this app knows',
  graph.nodes.every((n) => KINDS.has(n.kind)),
  `unknown: ${[...new Set(graph.nodes.filter((n) => !KINDS.has(n.kind)).map((n) => n.kind))].join(', ')}\n` +
    'Unknown kinds are ignored rather than fatal — the projections filter on kind.',
);

const people = graph.nodes.filter((n) => n.kind === 'person');
check(
  'every person is keyed on an email',
  people.every((n) => n.id.startsWith('person:') && n.id.includes('@')),
  'person: is keyed on email because it is the only identifier every source\n' +
    'shares. Anything else and the same human arrives as several people.\n' +
    sample(people.filter((n) => !n.id.includes('@')).map((n) => n.id)),
);
warn(
  'people carry per-source handles',
  people.length === 0 || people.some((n) => Object.keys((n as { handles?: object }).handles ?? {}).length > 0),
  'Without handles, a Jira account id, a Slack user id and a Zoom display name\n' +
    'are three different people. The alerts still fire — they key on the ticket —\n' +
    'but every "who weighed in" rollup over-counts. See `inspect identities`.',
);

const issues = graph.nodes.filter((n) => n.kind === 'issue');
warn(
  'every issue keeps the vendor status word',
  issues.every((n) => !!(n as { status?: string }).status),
  '`StoredIssue.status` is the workflow\'s own string, and MC_STATUS_MAP reads it.\n' +
    'Without it everything falls back to statusCategory, which has three values,\n' +
    'so in_review and blocked become unreachable.',
);

// ---------------------------------------------------------------------------

console.log('\nedges');
const dangling = graph.links.filter((l) => !ids.has(l.source) || !ids.has(l.target));
check('no edge points at a node that does not exist', dangling.length === 0,
  `${dangling.length} dangling\n` + sample(dangling.map((l) => `${l.source} -${l.relation}-> ${l.target}`)));
check(
  'every tier is EXTRACTED, INFERRED or AMBIGUOUS',
  graph.links.every((l) => !l.tier || TIERS.has(l.tier)),
  `unknown: ${[...new Set(graph.links.filter((l) => l.tier && !TIERS.has(l.tier)).map((l) => l.tier))].join(', ')}`,
);
check(
  'no INFERRED edge is missing its why',
  graph.links.every(isRenderableEdge),
  'An unexplained inferred edge is a machine asserting a dependency nobody can\n' +
    'check, and the reader can only trust it or ignore it. Those are dropped.',
);

const deps = graph.links.filter((l) => l.relation === 'depends_on');
warn('some dependencies are declared', deps.length > 0,
  'No depends_on edges at all means no cycle detection and no blocked-by chain.');
const structural = deps.filter(isStructuralDependency);
warn(
  'some dependencies are EXTRACTED, so cycles can be raised',
  deps.length === 0 || structural.length > 0,
  `${deps.length} dependencies, none EXTRACTED. Only EXTRACTED feeds cycle detection —\n` +
    'a guess must not be able to accuse a team of an unschedulable plan.',
);

/**
 * THE DIRECTION, which is what B1 actually asks about.
 *
 * `depends_on` runs dependent → blocker, the REVERSE of `blocks`. It cannot be
 * checked structurally — both directions are well-formed graphs — so this prints
 * a sample in both readings and asks a human to say which is true. That is the
 * whole of the question, and it takes ten seconds to answer once it is on screen.
 */
if (structural.length) {
  console.log('\nthe depends_on direction — read this and say whether it is right');
  console.log(`  DEPENDS_ON_IS_REVERSED = ${DEPENDS_ON_IS_REVERSED}, so we read each edge as:\n`);
  for (const e of structural.slice(0, 4)) {
    // `blocks` runs from → to, blocker first — so `from` is the thing in the
    // way and `to` is the thing waiting.
    const pair = blocksPairOf(e);
    if (!pair) continue;
    console.log(`    ${e.source} -depends_on-> ${e.target}`);
    console.log(`      → "${pair.to} is waiting on ${pair.from}"`);
  }
  console.log('\n  If that sentence is backwards, `blocksPairOf` is the single place it flips.');
}

// ---------------------------------------------------------------------------

console.log('\nrecords');
let recordFiles = 0;
const kindsOnDisk: string[] = [];
const present = new Set<string>();
try {
  for (const kind of await readdir(join(dir, 'records'))) {
    kindsOnDisk.push(kind);
    recordFiles += (await readdir(join(dir, 'records', kind))).length;
  }
} catch {
  /* a graph with no bodies still answers every structural question */
}
warn(
  'records/ has bodies to cite',
  recordFiles > 0,
  'Legitimate — a graph with no bodies answers every structural question — but\n' +
    'every citation then opens a record with metadata and no text, and the alert\n' +
    'pages are built on quoting what somebody actually said.',
);
if (recordFiles) console.log(`           ${recordFiles} record(s) across ${kindsOnDisk.join(', ')}`);

const refs = graph.nodes
  .map((n) => (n as { recordRef?: string }).recordRef)
  .filter((r): r is string => !!r);
/**
 * `recordRef` is a path relative to the graph directory —
 * `records/meeting/sprint-12-planning.json`. The first version compared it
 * against `kind/id`, so all thirty resolved refs reported as missing: a checker
 * confidently wrong about the contract, which is worse than none because it
 * sends somebody fixing a collector that was right.
 */
const bodies = new Map<string, unknown>();
for (const kind of kindsOnDisk) {
  for (const f of await readdir(join(dir, 'records', kind))) {
    if (!f.endsWith('.json')) continue;
    const rel = `records/${kind}/${f}`;
    try {
      bodies.set(`${kind}/${f.replace(/\.json$/, '')}`, JSON.parse(await readFile(join(dir, rel), 'utf8')));
      present.add(rel);
    } catch (err) {
      check(`${rel} is valid JSON`, false, err instanceof Error ? err.message : String(err));
    }
  }
}
if (refs.length && recordFiles) {
  const missing = refs.filter((r) => !present.has(r));
  check('every recordRef points at a file that exists', missing.length === 0,
    `${missing.length} missing\n` + sample(missing));
}

// ---------------------------------------------------------------------------
// The two configuration audits, inline — no server needed.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * WHAT EACH SURFACE CONTRIBUTED, which is the question a collector author has
 * when their part is the part that just ran.
 *
 * The contract checks above are about the whole file. This says whether *your*
 * collector landed: a graph that validates perfectly and contains no `message`
 * nodes is a graph where Slack contributes nothing, and every alert that needed
 * a Slack line to corroborate a claim will simply not fire. Nothing fails —
 * there is just less to say — which is the failure mode this whole document
 * exists to make visible.
 */
console.log('\nwhat each surface contributed');
const SURFACE_NODES: { surface: string; kinds: string[]; without: string }[] = [
  { surface: 'jira', kinds: ['issue', 'sprint', 'release'], without: 'no work items — nothing to alert about at all' },
  { surface: 'slack', kinds: ['message'], without: 'no disagreements can be found; a "done" claim has nothing to contradict it' },
  { surface: 'zoom', kinds: ['meeting'], without: 'no promises can be read out of a conversation — the flagship finding needs one' },
  { surface: 'confluence', kinds: ['page'], without: 'a decision can never be shown as already written down' },
  { surface: 'miro', kinds: ['sticky', 'frame', 'board'], without: 'no board half — an action written but not said is invisible' },
  { surface: 'github', kinds: ['pr'], without: 'no code-side corroboration' },
  { surface: 'people', kinds: ['person'], without: 'every rollup counts the same human more than once' },
];
const counts = new Map<string, number>();
for (const n of graph.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
for (const { surface, kinds, without } of SURFACE_NODES) {
  const total = kinds.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
  const detail = kinds.map((k) => `${counts.get(k) ?? 0} ${k}`).join(', ');
  if (total > 0) {
    console.log(`  ok     ${surface.padEnd(11)} ${detail}`);
  } else {
    warned++;
    console.log(`  warn   ${surface.padEnd(11)} nothing — ${without}`);
  }
}

console.log('\nthe workflow\'s status words');
const statuses = auditStatusWords(graph);
for (const r of statuses) {
  const flag = r.via === 'map' ? '' : '   ← falls through to statusCategory';
  console.log(`    ${r.vendor.padEnd(22)} → ${r.mapped.padEnd(12)} ${String(r.count).padStart(4)}${flag}`);
}
const unmapped = statuses.filter((r) => r.via !== 'map');
warn(
  'every status word is mapped',
  unmapped.length === 0,
  `${unmapped.length} unmapped. statusCategory has three values, so in_review and\n` +
    'blocked are unreachable for those. Write a map and set MC_STATUS_MAP:\n' +
    JSON.stringify(Object.fromEntries(unmapped.map((r) => [r.vendor, r.mapped])), null, 2),
);

console.log('\nthe people');
// With the bodies, so Slack authors and Zoom speakers are audited too. Passing
// an empty map only ever audits Jira assignees, which are the one set that was
// never the problem.
const identities = auditIdentities({ graph, records: bodies });
const unresolved = identities.filter((r) => !r.resolved);
console.log(`    ${identities.length} reference(s) in the graph, ${unresolved.length} unresolved`);
warn(
  'every person reference resolves',
  unresolved.length === 0,
  sample(unresolved.map((r) => `${r.raw} (${r.surfaces.join(',')}, ${r.count} refs)`)) +
    '\nThe alerts still fire — they key on the ticket — but every "who weighed in"\n' +
    'rollup counts the same human more than once. See `inspect identities`.',
);

// ---------------------------------------------------------------------------

function sample(xs: string[], n = 5): string {
  if (!xs.length) return '';
  return xs.slice(0, n).map((x) => `  ${x}`).join('\n') + (xs.length > n ? `\n  … and ${xs.length - n} more` : '');
}

console.log('');
if (failed) {
  console.log(`${failed} contract violation${failed === 1 ? '' : 's'}${warned ? `, ${warned} warning${warned === 1 ? '' : 's'}` : ''} — this graph does not read as docs/GRAPH-SCHEMA.md describes.\n`);
  process.exit(1);
}
console.log(
  warned
    ? `the contract holds, with ${warned} warning${warned === 1 ? '' : 's'} — the app will run, and the warnings above say what joins less well than it could.\n`
    : 'the contract holds, and nothing is falling back.\n',
);
