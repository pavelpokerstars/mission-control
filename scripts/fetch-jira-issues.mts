/**
 * Fetch Jira issues, and write the file the importer reads.
 *
 * WHY THIS EXISTS. The documented Jira path runs `programme_graph refresh` and
 * adapts its output (`import-programme-graph.mts`). That tool is somebody
 * else's, it is not on every machine, and where it is absent there was no way
 * to get Jira into the graph at all. This is the same job sourced from Jira
 * itself: one REST read, one file, no interpretation.
 *
 *   npx tsx scripts/fetch-jira-sprints.mts --board 14009 --out live/sprints.json
 *   npx tsx scripts/fetch-jira-issues.mts  --sprints live/sprints.json \
 *     --last-closed 3 --out live/issues.json
 *   npx tsx scripts/import-jira-issues.mts --issues live/issues.json \
 *     --sprints live/sprints.json --out ./live-graph
 *
 * THE FETCH AND THE EMIT ARE SEPARATE, and that is the seam the whole collector
 * contract rests on: the importer is offline and deterministic — files in,
 * files out, no credentials — which is what lets `verify-collector.mts` be
 * pointed at its result. A fetch inside it would trade that for one command.
 *
 * SCOPE IS SPRINTS, NOT A DATE WINDOW. `--last-closed 3` reads the sprint file
 * and asks for the issues in the three most recently closed sprints, because
 * that is the unit the flagship finding works in: a commitment's container
 * closing is the trigger, so a scope that does not align to sprint boundaries
 * either misses the container or drags in issues no closing will ever check.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const BASE = (opt('base') ?? process.env.JIRA_BASE_URL ?? '').replace(/\/+$/, '');
const EMAIL = opt('email') ?? process.env.JIRA_EMAIL ?? '';
const TOKEN = opt('token') ?? process.env.JIRA_API_TOKEN ?? '';
const PAT = opt('pat') ?? process.env.JIRA_PAT ?? '';
const out = opt('out') ?? 'issues.json';
const sprintsFile = opt('sprints');
const lastClosed = Number(opt('last-closed') ?? '3');
const rawJql = opt('jql');
const project = opt('project') ?? process.env.JIRA_PROJECT_KEY ?? '';

/**
 * Custom field ids, because they differ per Jira and a wrong one is silent.
 *
 * `node scripts/inspect.mjs statuses` is the equivalent audit for status words;
 * for these, `GET /rest/api/2/field` lists them by name. The defaults are the
 * ones this deployment uses.
 */
const F_SPRINT = opt('sprint-field') ?? process.env.JIRA_SPRINT_FIELD ?? 'customfield_10422';
const F_EPIC = opt('epic-field') ?? process.env.JIRA_EPIC_FIELD ?? 'customfield_11096';
const F_POINTS = opt('points-field') ?? process.env.JIRA_POINTS_FIELD ?? 'customfield_10420';

if (!BASE || (!PAT && !(EMAIL && TOKEN))) {
  console.error(
    'Missing credentials. Set these in the environment or pass them as flags:\n' +
      '\n' +
      '  JIRA_BASE_URL   https://your-org.atlassian.net       (--base)\n' +
      '\n' +
      'then EITHER, for Jira Server / Data Centre:\n' +
      '  JIRA_PAT        a personal access token             (--pat)\n' +
      '\n' +
      'or, for Jira Cloud:\n' +
      '  JIRA_EMAIL      the account the token belongs to     (--email)\n' +
      '  JIRA_API_TOKEN  an API token                         (--token)\n' +
      '\n' +
      'Read-only: this calls GET /rest/api/2/search and writes a local file.',
  );
  process.exit(2);
}

const AUTH = PAT
  ? `Bearer ${PAT}`
  : `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

const fail = (err: unknown): never => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
};

/** The fields the importer dereferences. Asking for `*all` costs minutes on a big board. */
const FIELDS = [
  'summary',
  'status',
  'issuetype',
  'assignee',
  'reporter',
  'created',
  'updated',
  'resolutiondate',
  'issuelinks',
  'parent',
  'project',
  'description',
  'labels',
  F_SPRINT,
  F_EPIC,
  F_POINTS,
].join(',');

interface SprintMeta {
  state?: 'future' | 'active' | 'closed';
  closedAt?: string;
  endsAt?: string;
}

/**
 * Which sprints to ask for: the ACTIVE one, plus the last N that closed.
 *
 * Both halves are load-bearing and they serve different findings.
 *
 *  - The **active** sprint is the work lane. `disagreement`, `cycle` and
 *    `aging` are all folded over it, so a scope of closed sprints alone
 *    produces an app with nothing on the front door — measured, and it looks
 *    exactly like a broken detector rather than an empty lane.
 *  - The **closed** ones are the containers. `findMissingTickets` fires when a
 *    commitment's container closes, so with nothing closed the flagship finding
 *    cannot fire at all.
 *
 * Sorted by when they actually closed rather than by name — "WP Frontier 9"
 * sorts after "WP Frontier 14" as a string, which is the same natural-ordering
 * trap `activeSprintOf` documents, and here it would silently scope the fetch
 * to the wrong sprints.
 */
async function targetSprints(): Promise<string[]> {
  const meta = JSON.parse(await readFile(sprintsFile!, 'utf8')) as Record<string, SprintMeta>;
  const closed = Object.entries(meta)
    .filter(([, m]) => m.state === 'closed')
    .map(([name, m]) => ({ name, at: Date.parse(m.closedAt ?? m.endsAt ?? '') }))
    .filter((s) => Number.isFinite(s.at))
    .sort((a, b) => b.at - a.at);

  if (!closed.length) {
    throw new Error(
      `No closed sprint in ${sprintsFile}.\n` +
        'The flagship finding fires when a commitment\'s container CLOSES, so a scope\n' +
        'with no closed sprint produces no missing-ticket alert — silently. Re-run\n' +
        'fetch-jira-sprints.mts against a scrum board that has completed a sprint.',
    );
  }

  const active = Object.entries(meta)
    .filter(([, m]) => m.state === 'active')
    .map(([name]) => name);

  return [...active, ...closed.slice(0, lastClosed).map((s) => s.name)];
}

/** JQL quoting: a sprint name is free text and routinely contains spaces. */
const quote = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;

async function search(jql: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let startAt = 0; ; ) {
    const url =
      `${BASE}/rest/api/2/search?startAt=${startAt}&maxResults=100` +
      `&fields=${encodeURIComponent(FIELDS)}&jql=${encodeURIComponent(jql)}`;
    const res = await fetch(url, { headers: { authorization: AUTH, accept: 'application/json' } });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      const hint =
        res.status === 401
          ? PAT
            ? ' — check JIRA_PAT (Server/DC wants a bearer personal access token)'
            : ' — check JIRA_EMAIL and JIRA_API_TOKEN (Cloud uses basic auth)'
          : res.status === 400
            ? ' — the JQL was rejected; a sprint name that no longer exists will do it'
            : '';
      throw new Error(`GET /rest/api/2/search → ${res.status}${hint}\n${body}`);
    }
    const page = (await res.json()) as { issues?: Record<string, unknown>[]; total?: number };
    const issues = page.issues ?? [];
    all.push(...issues);
    process.stdout.write(`\r  fetched ${all.length}/${page.total ?? '?'} issue(s)…`);
    if (!issues.length || all.length >= (page.total ?? 0)) break;
    startAt += issues.length;
  }
  process.stdout.write('\n');
  return all;
}

// ---------------------------------------------------------------------------

let jql: string;
if (rawJql) {
  jql = rawJql;
} else if (sprintsFile) {
  const names = await targetSprints().catch(fail);
  console.log(`  scope: ${names.length} sprint(s) — the active one plus the last ${lastClosed} closed`);
  console.log(`         ${names.join(', ')}`);
  jql = `sprint in (${names.map(quote).join(', ')}) ORDER BY created ASC`;
} else if (project) {
  jql = `project = ${quote(project)} ORDER BY created ASC`;
} else {
  console.error(
    'Nothing to fetch. Give it one of:\n' +
      '  --sprints <file> [--last-closed 3]   the sprints fetch-jira-sprints.mts wrote\n' +
      '  --project WP                          a whole project\n' +
      '  --jql "..."                           anything else',
  );
  process.exit(2);
}

const issues = await search(jql).catch(fail);

if (!issues.length) {
  console.error(`\nNo issues matched:\n  ${jql}\n\nNothing was written.`);
  process.exit(1);
}

await mkdir(dirname(out), { recursive: true }).catch(() => {});
await writeFile(
  out,
  `${JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      baseUrl: BASE,
      jql,
      fields: { sprint: F_SPRINT, epic: F_EPIC, points: F_POINTS },
      issues,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const withAssignee = issues.filter((i) => (i.fields as Record<string, unknown>)?.assignee).length;
const withLinks = issues.filter(
  (i) => ((i.fields as { issuelinks?: unknown[] })?.issuelinks ?? []).length > 0,
).length;

console.log(`\n  wrote ${issues.length} issue(s) to ${out}`);
console.log(`  ${withAssignee} assigned · ${withLinks} carrying issue links`);
if (!withLinks) {
  // Not an error — plenty of teams never link issues — but it decides whether
  // the cycle and stale-link findings can fire at all, and silence here would
  // read later as "the detectors do not work".
  console.log('  note: no issue links at all, so no dependency, cycle or stale-link finding can fire.');
}
