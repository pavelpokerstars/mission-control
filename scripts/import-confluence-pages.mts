/**
 * Read `confluence-cli.py read --format json` output and write our graph fragment.
 *
 * WHAT THIS IS THE OTHER HALF OF. `confluence-cli.py` already returns almost
 * exactly the record we want — `{id, title, url, space, version, breadcrumb,
 * body}` — which is why Confluence was the cheapest of the four collectors to
 * finish. This turns a directory of those JSON files into `page` nodes and
 * `records/page/*.json` that `MC_GRAPH_DIR` can read.
 *
 *   for id in 48210331 48210442; do
 *     python3 confluence-cli.py read "$id" --format json > pages/$id.json
 *   done
 *   npx tsx scripts/import-confluence-pages.mts --in pages --out ./live-graph
 *
 * OFFLINE, like every emitter here: files in, files out, no credentials and no
 * network, so `verify-collector.mts` can be pointed at the result. The CLI does
 * the reaching; this does the reasoning. Same seam as
 * `import-programme-graph.mts` and `import-zoom-notes.mts`.
 *
 * MERGES, and identifies its own output by a `collector` marker rather than by
 * id prefix — see `import-zoom-notes.mts`, where matching on the prefix deleted
 * three real meetings written by another collector and nothing failed.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { extractKeys } from '@mc/domain';

/** Stamped on every node this writes, so a re-run replaces its own and nothing else. */
const COLLECTOR = 'import-confluence-pages';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const inDir = opt('in');
const outDir = opt('out');

if (!inDir || !outDir) {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/import-confluence-pages.mts --in <dir of page JSON> --out <graph dir>\n' +
      '\n' +
      '  --in    a directory of `confluence-cli.py read <id> --format json` output,\n' +
      '          one file per page. Nested directories are walked.\n' +
      '  --out   a graph directory. An existing graph.json is merged into.',
  );
  process.exit(2);
}

/** What `confluence-cli.py read --format json` prints. */
interface PageJson {
  id?: string;
  title?: string;
  url?: string;
  space?: string;
  version?: number | { number?: number; when?: string };
  breadcrumb?: string | string[] | null;
  body?: string;
  /** Not emitted by the CLI today — see the warning below. */
  at?: string;
  when?: string;
}

/**
 * When the page was last changed, and why this is so often missing.
 *
 * `confluence-cli.py`'s read expands `body.storage,version,space,ancestors`, so
 * the API **does** return `version.when` — and the CLI keeps only
 * `version.number`. The timestamp is fetched and thrown away one line before it
 * would have been printed.
 *
 * That matters more here than it looks. `PageRecord.at` becomes
 * `ConfluencePage.updatedAt`, which orders the trail, decides what "the newest
 * thing that disagrees" means in a `disagreement` finding, and drives
 * `predatesTicket` — the badge that claims a document existed *before* the
 * ticket did. A page with a made-up date would make that badge lie.
 *
 * So: use it when it is there, and when it is not, say so and leave the page
 * out rather than stamping it with today. A missing page is a gap somebody can
 * see; a page dated wrong is a false claim in a citation.
 */
function pageDate(p: PageJson): string | undefined {
  if (typeof p.at === 'string' && p.at) return p.at;
  if (typeof p.when === 'string' && p.when) return p.when;
  if (p.version && typeof p.version === 'object' && typeof p.version.when === 'string') {
    return p.version.when;
  }
  return undefined;
}

/** Confluence storage format is XHTML; the record wants readable text. */
function plainText(body: string): string {
  return body
    .replace(/<ac:[^>]*>|<\/ac:[^>]*>|<ri:[^>]*\/?>/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li|tr|div)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.json')) yield p;
  }
}

// ---------------------------------------------------------------------------

interface Page {
  id: string;
  title: string;
  at: string;
  body: string;
  keys: string[];
  url?: string;
}

const pages: Page[] = [];
const undated: string[] = [];
const skipped: string[] = [];

for await (const file of walk(inDir)) {
  let raw: PageJson;
  try {
    raw = JSON.parse(await readFile(file, 'utf8')) as PageJson;
  } catch {
    skipped.push(`${file} — not JSON`);
    continue;
  }
  // `search` output is `{results, total}`; only `read` output is a page.
  if (!raw.id || !raw.title || typeof raw.body !== 'string') {
    skipped.push(`${file} — not a page (is it \`search\` output rather than \`read\`?)`);
    continue;
  }

  const at = pageDate(raw);
  if (!at) {
    undated.push(`${raw.id} — ${raw.title}`);
    continue;
  }

  const body = plainText(raw.body);
  pages.push({
    id: String(raw.id),
    title: raw.title,
    at,
    body,
    // `keys` is the join, and the CLI does not emit them, so they come out of
    // the body with `extractKeys` — the same regex the rest of the app joins on.
    // Filtered afterwards; see `knownPrefixes`.
    keys: extractKeys(`${raw.title}\n${body}`),
    ...(raw.url ? { url: raw.url } : {}),
  });
}

if (undated.length) {
  console.error(
    `\n  ${undated.length} page(s) have no timestamp and were NOT imported:\n` +
      undated.map((u) => `    ${u}`).join('\n') +
      `\n\n  \`confluence-cli.py\` expands \`version\` on read but prints only\n` +
      `  \`version.number\`. The date is in the API response and dropped one line\n` +
      `  before it is printed. One line fixes it:\n\n` +
      `      'at': data.get('version', {}).get('when', ''),\n\n` +
      `  It matters because \`at\` orders the trail, decides which of two claims is\n` +
      `  newer in a disagreement, and drives the "before the ticket existed" badge.\n` +
      `  A page stamped with today would make that badge lie, so these are left out\n` +
      `  rather than guessed at.`,
  );
}

if (!pages.length) {
  console.error(`\nNo importable pages in ${inDir}.`);
  for (const s of skipped) console.error(`  skipped ${s}`);
  process.exit(1);
}

/**
 * A key that matches the regex is not necessarily a ticket.
 *
 * `extractKeys` is `[A-Z][A-Z0-9]+-\d+`, and a decision record titled
 * *ADR-014* matches it perfectly — as would RFC-002, SOC-2 or a part number.
 * Left alone, this page would claim a relationship to a ticket that does not
 * exist, on the one surface whose value is that its links are real.
 *
 * So a key is kept only when the graph being merged into actually has issues
 * with that prefix. That is self-configuring — the projects come from the Jira
 * import that already ran — and it fails the safe way: merging into an empty
 * graph keeps nothing rather than keeping everything.
 */
function knownPrefixes(g: Graph): Set<string> {
  const out = new Set<string>();
  for (const n of g.nodes) {
    const key = typeof n.key === 'string' ? n.key : String(n.id ?? '').replace(/^issue:/, '');
    const m = /^([A-Z][A-Z0-9]+)-\d+$/.exec(key);
    if (m && n.kind === 'issue') out.add(m[1]!);
  }
  return out;
}

// ---------------------------------------------------------------------------

await mkdir(join(outDir, 'records', 'page'), { recursive: true });

interface Graph {
  directed?: boolean;
  multigraph?: boolean;
  graph?: Record<string, unknown>;
  nodes: Record<string, unknown>[];
  links: Record<string, unknown>[];
}

const graphPath = join(outDir, 'graph.json');
let graph: Graph = { directed: true, multigraph: false, graph: {}, nodes: [], links: [] };
let merged = false;
if (existsSync(graphPath)) {
  graph = JSON.parse(await readFile(graphPath, 'utf8')) as Graph;
  merged = true;
  const before = graph.nodes.length;
  graph.nodes = graph.nodes.filter((n) => n.collector !== COLLECTOR);
  if (before !== graph.nodes.length) {
    console.log(`replacing ${before - graph.nodes.length} page(s) from a previous run`);
  }
}

const prefixes = knownPrefixes(graph);
const taken = new Set(graph.nodes.map((n) => String(n.id)));
const dropped: string[] = [];
const collided: string[] = [];

for (const p of pages) {
  const before = p.keys;
  p.keys = p.keys.filter((k) => prefixes.has(k.split('-')[0]!));
  for (const k of before) if (!p.keys.includes(k)) dropped.push(`${k} (on ${p.id})`);

  /**
   * Another collector already wrote this page. Skip rather than duplicate.
   *
   * The merge removes nodes carrying OUR marker, which is what makes a re-run
   * idempotent — but says nothing about a node somebody else wrote. Adding ours
   * beside it produced a duplicate id, which `verify-collector` rejects as a
   * contract violation. Overwriting would be the other failure: silently
   * discarding a collector's output because ours ran second.
   */
  if (taken.has(`page:confluence/${p.id}`)) {
    collided.push(`${p.id} — ${p.title}`);
    continue;
  }
  // Grow as we go. Built once and never updated, two input files for the same
  // page — `pages/48210331.json` and `pages/archive/48210331.json`, which the
  // documented "nested directories are walked" makes easy — both passed this
  // check and emitted the same node id, which `verify-collector` rejects.
  taken.add(`page:confluence/${p.id}`);

  graph.nodes.push({
    id: `page:confluence/${p.id}`,
    kind: 'page',
    source: 'confluence',
    collector: COLLECTOR,
    label: p.title,
    recordRef: `records/page/${p.id}.json`,
    ...(p.url ? { url: p.url } : {}),
  });

  await writeFile(
    join(outDir, 'records', 'page', `${p.id}.json`),
    `${JSON.stringify({ id: p.id, title: p.title, at: p.at, body: p.body, keys: p.keys }, null, 2)}\n`,
    'utf8',
  );
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
graph.graph = {
  // Filled only when absent, so a graph this creates alone still carries the
  // `generatedAt` / `generator` that `verify-collector.mts` requires.
  generatedAt: new Date().toISOString(),
  generator: COLLECTOR,
  ...(graph.graph ?? {}),
  sources: [...new Set([...((graph.graph?.sources as string[]) ?? []), 'confluence'])],
  confluenceImportedAt: new Date().toISOString(),
};
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

if (dropped.length) {
  console.log(`\n  ${dropped.length} key-shaped reference(s) dropped — no such project in this graph:`);
  console.log(`    ${dropped.join(', ')}`);
  console.log(`    (ADR-014 and friends match the Jira key regex and are not tickets.)`);
}
if (collided.length) {
  console.log(`\n  ${collided.length} page(s) already in this graph from another collector, left alone:`);
  for (const c of collided) console.log(`    ${c}`);
}

const written = pages.filter((p) => !collided.some((c) => c.startsWith(`${p.id} `)));
const joined = written.filter((p) => p.keys.length).length;
console.log(`${merged ? 'merged into' : 'wrote'} ${graphPath}`);
console.log(`  ${written.length} page(s), ${joined} joined to a ticket, ${graph.nodes.length} node(s) total`);
for (const p of written) {
  console.log(`    ${p.at.slice(0, 10)}  ${p.title}${p.keys.length ? `  → ${p.keys.join(', ')}` : '  (joins nothing)'}`);
}
if (skipped.length) {
  console.log(`\n  ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`    ${s}`);
}
console.log(`\nNext:\n  npx tsx scripts/verify-collector.mts ${outDir}`);
