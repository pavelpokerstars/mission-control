/**
 * Fetch Confluence pages, and write the files `import-confluence-pages.mts` reads.
 *
 * WHY THIS IS HERE RATHER THAN A CLI CALL. The emitter was written against
 * `confluence-cli.py read <id> --format json`, which lives in another repo —
 * and that script expands `version` and then prints only `version.number`,
 * throwing the timestamp away one line before it would have been kept. The
 * emitter **refuses an undated page**, because `at` orders the trail, decides
 * which of two claims is newer in a `disagreement`, and drives the "before the
 * ticket existed" badge. Reading the API directly means `version.when` simply
 * arrives, and nothing needs patching anywhere.
 *
 *   npx tsx scripts/fetch-confluence.mts --keys ./live-graph/graph.json --out live-raw/pages
 *   npx tsx scripts/import-confluence-pages.mts --in live-raw/pages --out ./live-graph
 *
 * SEARCH-DRIVEN, like the Slack fetcher and for the same reason: a space can
 * hold thousands of pages and the ones worth having are the ones that name a
 * ticket. `--space` reads a whole space instead, when that is what you want.
 *
 * Confluence Cloud, so BASIC auth with an API token — the opposite of the Jira
 * Server instance next to it, which wants a bearer PAT. Two Atlassian products,
 * two schemes; each rejects the other's.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE = (opt('base') ?? process.env.CONFLUENCE_BASE_URL ?? 'https://flutteruki.atlassian.net/wiki').replace(/\/+$/, '');
const EMAIL = opt('email') ?? process.env.CONFLUENCE_EMAIL ?? '';
const TOKEN = opt('token') ?? process.env.CONFLUENCE_API_TOKEN ?? '';
const outDir = opt('out') ?? 'live-raw/pages';
const keysFrom = opt('keys');
const space = opt('space');
const since = opt('since');
const perKey = Number(opt('per-key') ?? '5');
const cap = Number(opt('limit') ?? '400');

if (!EMAIL || !TOKEN) {
  console.error(
    'Missing credentials:\n' +
      '  CONFLUENCE_EMAIL      the Atlassian account            (--email)\n' +
      '  CONFLUENCE_API_TOKEN  https://id.atlassian.com/manage-profile/security/api-tokens (--token)\n' +
      '  CONFLUENCE_BASE_URL   optional; defaults to the wiki above (--base)\n' +
      '\n' +
      'Read-only: this calls GET /rest/api/search and /rest/api/content.',
  );
  process.exit(2);
}

const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;
const fail = (err: unknown): never => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
};

async function get(path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: AUTH, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const hint =
      res.status === 401
        ? ' — Confluence Cloud wants BASIC auth (email:api-token), not a bearer PAT'
        : res.status === 403
          ? ' — authenticated, but not permitted to read this'
          : '';
    throw new Error(`GET ${path.split('?')[0]} → ${res.status}${hint}\n${body}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * CQL, as an EXACT PHRASE.
 *
 * `text ~ "WP-12245"` tokenises the key and matches pages containing the pieces
 * — measured, it returned decade-old capacity notes that mention neither. Every
 * one of them then arrived at the emitter, which correctly reported "joins
 * nothing" and added ten unrelated pages to the graph. The nested quotes are
 * what make it a phrase.
 */
const phrase = (s: string): string => `text ~ "\\"${s.replace(/"/g, '')}\\"" and type = page`;

// ---------------------------------------------------------------------------

if (!keysFrom && !space) {
  console.error(
    'Nothing to fetch. Give it one of, or both:\n' +
      '  --space WP [--since 2026-07-09]  a space, optionally only what changed since\n' +
      '  --keys ./live-graph/graph.json    pages naming a ticket, in ANY space\n' +
      '\n' +
      'PREFER --space. A key search finds only pages that cite a ticket number, and\n' +
      'most documentation does not: measured on this wiki, the WP space holds 1,044\n' +
      'pages and a search for the 72 tickets in scope matched none of them. Sources\n' +
      'then reports "0 pages", which reads as a broken connector rather than as a\n' +
      'team that writes prose instead of ticket numbers.',
  );
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

/** Page ids to fetch, deduplicated — one page routinely names several tickets. */
const ids = new Set<string>();

if (keysFrom) {
  const graph = JSON.parse(await readFile(keysFrom, 'utf8')) as {
    nodes?: { kind?: string; key?: string }[];
  };
  const keys = [
    ...new Set((graph.nodes ?? []).filter((n) => n.kind === 'issue').map((n) => n.key).filter((k): k is string => !!k)),
  ];
  if (!keys.length) fail(new Error(`No issue keys in ${keysFrom}. Run the Jira import first.`));

  console.log(`  searching ${keys.length} key(s)…`);
  for (const [i, key] of keys.entries()) {
    const body = await get(
      `/rest/api/search?cql=${encodeURIComponent(phrase(key))}&limit=${perKey}`,
    ).catch((e) => {
      console.log(`\n  ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    });
    for (const r of ((body?.results as { content?: { id?: string } }[]) ?? [])) {
      if (r.content?.id) ids.add(r.content.id);
    }
    process.stdout.write(`\r  ${i + 1}/${keys.length} searched · ${ids.size} page(s)…`);
  }
  process.stdout.write('\n');
}

/**
 * A whole space, optionally windowed by when a page last changed.
 *
 * CQL rather than `/content?spaceKey=`, because that endpoint cannot express
 * "and only what has moved recently" — and a space of a thousand pages is
 * mostly history somebody wrote once. `lastmodified` is the honest window: a
 * page nobody has touched since the programme started is not evidence about it.
 *
 * PAGED BY CURSOR, and `start` is a trap: this endpoint accepts `start`,
 * ignores it, and returns the same first page every time — so a `start += 100`
 * loop terminates at exactly `limit` results and looks like a small space
 * rather than a broken pager. The cursor is on `_links.next`.
 */
if (space) {
  const clause = [`space = ${space}`, 'type = page', ...(since ? [`lastmodified >= "${since}"`] : [])].join(' and ');
  let path: string | undefined = `/rest/api/search?cql=${encodeURIComponent(clause)}&limit=100`;
  while (path && ids.size < cap) {
    const body: Record<string, unknown> = await get(path).catch(fail);
    for (const r of ((body.results as { content?: { id?: string } }[]) ?? [])) {
      if (r.content?.id) ids.add(r.content.id);
    }
    const next = (body._links as { next?: string } | undefined)?.next;
    path = next ? (next.startsWith('/wiki') ? next.slice('/wiki'.length) : next) : undefined;
  }
  console.log(`  space ${space}${since ? ` since ${since}` : ''}: ${ids.size} page(s)`);
}

if (!ids.size) {
  console.error('\nNo pages matched. Nothing was written.');
  process.exit(1);
}

let written = 0;
for (const id of ids) {
  const page = await get(`/rest/api/content/${id}?expand=body.storage,version,space,ancestors`).catch((e) => {
    console.log(`  ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });
  if (!page) continue;

  const version = page.version as { number?: number; when?: string } | undefined;
  const record = {
    id: String(page.id),
    title: String(page.title ?? ''),
    url: `${BASE}${String((page._links as { webui?: string })?.webui ?? `/pages/${String(page.id)}`)}`,
    space: String((page.space as { key?: string })?.key ?? ''),
    // The object form, NOT just the number — the emitter reads `version.when`
    // and refuses the page without it, which is the whole reason this exists.
    version: { number: version?.number ?? 0, when: version?.when ?? '' },
    breadcrumb: ((page.ancestors as { title?: string }[]) ?? []).map((a) => String(a.title ?? '')),
    body: String(((page.body as { storage?: { value?: string } })?.storage?.value ?? '')),
  };
  await writeFile(`${outDir}/${record.id}.json`, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  written++;
  process.stdout.write(`\r  fetched ${written}/${ids.size} page(s)…`);
}
process.stdout.write('\n');

console.log(`\n  ${written} page(s) → ${outDir}/`);
console.log(`\nNext:\n  npx tsx scripts/import-confluence-pages.mts --in ${outDir} --out ./live-graph`);
