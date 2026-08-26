/**
 * Read `gh pr list --json` output and write our graph fragment.
 *
 * WHY `gh` AND NOT `github-cli.py`. That script is a **write** tool — its
 * commands are `pr update-body`, `pr comments`, `pr reply`, `pr resolve` and
 * `ci status`. It acts on a pull request you already know about and has no
 * `pr list`, so it cannot tell you which PRs exist. `gh` can, in exactly the
 * shape this wants.
 *
 *   gh pr list --repo <owner/name> --state all --limit 200 \
 *     --json number,title,headRefName,author,createdAt,mergedAt,state,url > prs.json
 *   npx tsx scripts/import-github-prs.mts --in prs.json --repo <owner/name> --out ./live-graph
 *
 * Offline, like every emitter here — the capture is a separate command, so this
 * needs no credential and touches no repository.
 *
 * WHAT A PR IS WORTH HERE, and it is narrower than the other four. There is no
 * `projectPrs` and no GitHub connector: a `pr` node counts on **Sources**,
 * contributes its author to the identity map, and — the part that matters —
 * carries a `mentions` edge to every ticket it names, which is what puts a pull
 * request into a ticket's neighbourhood in the relation graph.
 *
 * THE JOIN IS THE BRANCH NAME. `feature/PAY-9012-dedupe-cache` is how a PR
 * attaches to the spine, which is why `headRefName` is not optional in the
 * capture above. The title is read too, because a branch is sometimes just
 * `fix/login`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractKeys } from '@mc/domain';

const COLLECTOR = 'import-github-prs';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const inFile = opt('in');
const outDir = opt('out');
const repo = opt('repo');

if (!inFile || !outDir || !repo) {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/import-github-prs.mts --in prs.json --repo <owner/name> --out <graph dir>\n' +
      '\n' +
      'Capture first (this script never talks to GitHub):\n' +
      '  gh pr list --repo <owner/name> --state all --limit 200 \\\n' +
      '    --json number,title,headRefName,author,createdAt,mergedAt,state,url > prs.json\n' +
      '\n' +
      '  --repo  needed because `gh pr list` does not repeat it per row, and the\n' +
      '          node id carries it — two repos can both have a PR #4198.',
  );
  process.exit(2);
}

interface PrJson {
  number?: number;
  title?: string;
  headRefName?: string;
  author?: { login?: string; is_bot?: boolean };
  createdAt?: string;
  mergedAt?: string | null;
  state?: string;
  url?: string;
}

interface Pr {
  number: number;
  title: string;
  branch: string;
  author: string;
  at: string;
  merged: boolean;
  keys: string[];
  url?: string;
}

const raw = JSON.parse(await readFile(inFile, 'utf8')) as unknown;
const rows = (Array.isArray(raw) ? raw : ((raw as { pullRequests?: unknown[] })?.pullRequests ?? [])) as PrJson[];
if (!rows.length) {
  console.error(`No pull requests in ${inFile}. Did the capture include --json?`);
  process.exit(1);
}

const prs: Pr[] = [];
const bots: string[] = [];
const unjoined: string[] = [];

for (const r of rows) {
  if (typeof r.number !== 'number' || !r.createdAt) continue;

  /**
   * Bots are dropped, and this is not tidiness.
   *
   * Dependabot opens a pull request per dependency per week. Left in they are
   * the majority of every `pr` count on Sources, they drown the real ones in a
   * ticket's neighbourhood, and `authored_by` would put a bot in the identity
   * map beside four humans. None of them is ever the answer to "who changed
   * this and why".
   */
  if (r.author?.is_bot || /\[bot\]$|^app\//.test(r.author?.login ?? '')) {
    bots.push(`#${r.number} ${r.title ?? ''}`.slice(0, 60));
    continue;
  }

  const branch = r.headRefName ?? '';
  const title = r.title ?? `PR #${r.number}`;
  // The branch first, because that is the convention the join rests on; the
  // title as well, because a branch is sometimes just `fix/login`.
  const keys = extractKeys(`${branch.replace(/[/_]/g, ' ')} ${title}`);
  if (!keys.length) unjoined.push(`#${r.number} ${branch || title}`.slice(0, 60));

  prs.push({
    number: r.number,
    title,
    branch,
    author: r.author?.login ?? 'unknown',
    at: r.createdAt,
    merged: Boolean(r.mergedAt),
    keys,
    ...(r.url ? { url: r.url } : {}),
  });
}

if (!prs.length) {
  console.error(`Nothing importable in ${inFile} — ${bots.length} bot PR(s) were dropped.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

interface Graph {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes: Record<string, unknown>[];
  links: Record<string, unknown>[];
}

await mkdir(join(outDir, 'records', 'pr'), { recursive: true });
const graphPath = join(outDir, 'graph.json');
let graph: Graph = { directed: true, multigraph: false, graph: {}, nodes: [], links: [] };
let merged = false;
if (existsSync(graphPath)) {
  graph = JSON.parse(await readFile(graphPath, 'utf8')) as Graph;
  merged = true;
  /**
   * Ours AND this repo's — the node filter used to be repo-blind.
   *
   * It removed every node carrying this collector's marker while the link
   * filter was scoped to `pr:github/<repo>/`, so importing a second repository
   * into the same graph directory deleted the first repository's PR nodes and
   * left their `mentions` edges pointing at ids that no longer existed. That is
   * the dangling-edge contract violation, and two repos in one programme is the
   * normal case rather than an exotic one.
   */
  const before = graph.nodes.length;
  const mine = new Set(
    graph.nodes
      .filter((n) => n.collector === COLLECTOR && String(n.id).startsWith(`pr:github/${repo}/`))
      .map((n) => String(n.id)),
  );
  graph.nodes = graph.nodes.filter((n) => !mine.has(String(n.id)));
  graph.links = graph.links.filter((l) => !mine.has(String(l.source ?? '')));
  if (before !== graph.nodes.length) {
    console.log(`replacing ${before - graph.nodes.length} PR(s) from a previous run`);
  }
}

/**
 * Only join to issues the graph actually has.
 *
 * Same rule the Confluence emitter learned: a branch called
 * `release/ABC-123-hotfix` matches the Jira key regex whether or not ABC is a
 * project. An edge to a node that does not exist is a contract violation
 * `verify-collector` rejects outright — here it would be one per stray branch.
 */
const issues = new Set(
  graph.nodes.filter((n) => n.kind === 'issue').map((n) => String(n.key ?? String(n.id).replace(/^issue:/, ''))),
);
const taken = new Set(graph.nodes.map((n) => String(n.id)));

/**
 * The record filename, which must carry the REPO and not only the number.
 *
 * The node id already does (`pr:github/<owner>/<name>/<number>`), so ids never
 * collide and the duplicate-id guard below never fires — but the record was
 * written to `records/pr/<number>.json`, and PR 214 exists in every repo a
 * programme owns. Two repos meant one file, second write wins, and the count
 * was the only visible trace: 485 nodes sharing 475 records. Nothing failed,
 * because nothing projects a PR record yet; the day one is cited it would have
 * shown another repo's pull request under this one's number.
 */
const recordName = (number: number): string => `${repo.replace(/[^\w.-]+/g, '-')}-${number}`;

let written = 0;
let edges = 0;
const dropped: string[] = [];
const collided: string[] = [];

for (const p of prs) {
  const id = `pr:github/${repo}/${p.number}`;
  if (taken.has(id)) {
    collided.push(`#${p.number}`);
    continue;
  }
  taken.add(id);

  const real = p.keys.filter((k) => issues.has(k));
  for (const k of p.keys) if (!real.includes(k)) dropped.push(`${k} (on #${p.number})`);

  graph.nodes.push({
    id,
    kind: 'pr',
    source: 'github',
    collector: COLLECTOR,
    label: p.title,
    at: p.at,
    ...(p.url ? { url: p.url } : {}),
    recordRef: `records/pr/${recordName(p.number)}.json`,
  });

  for (const key of real) {
    graph.links.push({
      source: id,
      target: `issue:${key}`,
      relation: 'mentions',
      tier: 'EXTRACTED',
      origin: 'structural',
      // The branch IS the evidence — it is where the key was found, and a
      // reader following this edge should see why it exists.
      evidence: [{ source: 'github', ref: id, quote: p.branch || p.title }],
    });
    edges++;
  }

  await writeFile(
    join(outDir, 'records', 'pr', `${recordName(p.number)}.json`),
    `${JSON.stringify(
      { number: p.number, title: p.title, branch: p.branch, author: p.author, at: p.at, merged: p.merged },
      null,
      2,
    )}\n`,
    'utf8',
  );
  written++;
}

/**
 * Declare the surface, so `/api/health` can say what is actually in here.
 *
 * `graph.graph.sources` is what health reports, and it answers the question
 * somebody curls it for: *am I reading real data, and how much of it?* Only the
 * Jira adapter set it, so a graph carrying meetings, messages, pages and pull
 * requests still reported `sources: ["jira"]` — which is the same class of
 * silent wrongness as `jira: "mock"` on a live graph, the bug D2 already fixed
 * once in the same object.
 */
/**
 * Stamp the envelope, so a graph this emitter creates ALONE still conforms.
 *
 * `generatedAt` and `generator` are required by `verify-collector.mts` — the
 * command this script prints as the next step. When Jira has already run it
 * sets them, but pointed at an empty directory this produced a graph that
 * failed the very check it recommends. Only filled when absent, so a real
 * collector's stamp is never overwritten.
 */
graph.graph = {
  generatedAt: new Date().toISOString(),
  generator: COLLECTOR,
  ...(graph.graph ?? {}),
  sources: [...new Set([...((graph.graph?.sources as string[]) ?? []), 'github'])],
  githubImportedAt: new Date().toISOString(),
};
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

console.log(`${merged ? 'merged into' : 'wrote'} ${graphPath}`);
console.log(`  ${written} pull request(s), ${edges} joined to a ticket, ${graph.nodes.length} node(s) total`);
if (bots.length) console.log(`  ${bots.length} bot PR(s) dropped`);
if (unjoined.length) {
  console.log(`\n  ${unjoined.length} PR(s) name no ticket — they will appear on Sources and join nothing:`);
  for (const u of unjoined.slice(0, 8)) console.log(`    ${u}`);
  console.log(`    The join is the branch name; \`feature/PAY-9012-…\` is what makes one attach.`);
}
if (dropped.length) {
  console.log(`\n  ${dropped.length} key-shaped reference(s) dropped — no such issue in this graph:`);
  console.log(`    ${dropped.slice(0, 8).join(', ')}`);
}
if (collided.length) console.log(`\n  ${collided.length} already in this graph from another collector, left alone`);
console.log(`\nNext:\n  npx tsx scripts/verify-collector.mts ${outDir}`);
