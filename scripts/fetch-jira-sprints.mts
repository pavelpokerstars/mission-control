/**
 * Fetch sprint state from Jira, and write the file the adapter already reads.
 *
 * WHY THIS EXISTS. `programme_graph` emits no sprint nodes — sprints live only
 * as `sprint_names[]` strings on an issue, with no state and no dates. And
 * `findMissingTickets` fires when a commitment's **container has closed**, so
 * with no closed container the flagship finding — a promise nobody ticketed —
 * cannot fire at all on real data. Nothing errors; the alert simply never
 * appears, which is the worst way to lose it.
 *
 * `scripts/import-programme-graph.mts` already takes `--sprints` and synthesises
 * the nodes from it. What was missing was the fetch, and the information was
 * never missing: Jira's agile API has all of it. So this is the last step of the
 * live path rather than a new capability.
 *
 *   npx tsx scripts/fetch-jira-sprints.mts --board 42 --out sprints.json
 *   npx tsx scripts/import-programme-graph.mts --in graph.json --out ./live-graph \
 *     --sprints sprints.json
 *
 * With no `--board`, it lists the boards it can see and stops — because the
 * board id is the one thing you cannot guess, and "which board?" is the first
 * question anybody hits.
 *
 * NOT FOLDED INTO THE ADAPTER, deliberately. The adapter is offline and
 * deterministic: files in, files out, no credentials, no network, and
 * `verify-collector` can be pointed at its result. Putting a fetch inside it
 * would trade that for one less command. The seam is the same one the whole
 * collector contract rests on — something reads a source, something else
 * reasons about it.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
const board = opt('board');
const out = opt('out') ?? 'sprints.json';

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
      '  JIRA_API_TOKEN  https://id.atlassian.com/manage-profile/security/api-tokens (--token)\n' +
      '\n' +
      'Read-only: this calls GET /rest/agile/1.0 and writes a local file.',
  );
  process.exit(2);
}

/**
 * Two deployments, two auth schemes, and each rejects the other's.
 *
 * Cloud wants an API token as BASIC (`email:token`), and bearer is the OAuth
 * path there — it 401s in a way whose message does not say so, which is the
 * hint below. Server and Data Centre want a personal access token as BEARER and
 * have no email in the pair at all. Guessing wrong costs an afternoon against
 * an API you have not used before, so the credential you set picks the scheme.
 */
const AUTH = PAT
  ? `Bearer ${PAT}`
  : `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`;

/**
 * A failed request is a message, not a stack trace.
 *
 * Applied at the two call sites rather than through `process.on`: a top-level
 * `await` that rejects in an ES module is reported as an uncaught exception
 * before any `unhandledRejection` handler runs, so the hook looks right and
 * prints nothing. Everything that throws here is a network or credential
 * problem whose message already says what to do; a twelve-line trace above it
 * only buries the sentence somebody needs.
 */
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
    /**
     * Say which call failed and what the status usually means. A bare
     * "Request failed with status code 401" against a REST API you have not
     * used before costs an afternoon.
     */
    const hint =
      res.status === 401
        ? PAT
          ? ' — check JIRA_PAT (Server/DC wants a personal access token as a bearer)'
          : ' — check JIRA_EMAIL and JIRA_API_TOKEN (Cloud uses basic auth, not bearer)'
        : res.status === 403
          ? ' — the account is authenticated but not permitted to read this board'
          : res.status === 404
            ? ' — no such board, or the board is not a scrum board (kanban boards have no sprints)'
            : '';
    throw new Error(`GET ${path} → ${res.status}${hint}\n${body}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Walk a paged agile collection.
 *
 * The agile API pages with `startAt` / `maxResults` / `isLast`, and `isLast` is
 * the only reliable terminator — `total` is absent on some endpoints and a
 * short page is not the end. A page that comes back empty also stops us, so a
 * server that never sets `isLast` cannot spin forever.
 */
async function paged(path: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let startAt = 0; ; ) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await get(`${path}${sep}startAt=${startAt}&maxResults=50`);
    const values = Array.isArray(page.values) ? (page.values as Record<string, unknown>[]) : [];
    all.push(...values);
    if (page.isLast === true || values.length === 0) return all;
    startAt += values.length;
  }
}

// ---------------------------------------------------------------------------

if (!board) {
  const boards = await paged('/rest/agile/1.0/board?type=scrum').catch(fail);
  if (!boards.length) {
    console.error('No scrum boards visible to this account. Kanban boards have no sprints.');
    process.exit(1);
  }
  console.log(`${boards.length} scrum board(s) — re-run with --board <id>:\n`);
  for (const b of boards) {
    const loc = (b.location ?? {}) as { projectKey?: string; name?: string };
    const where = loc.projectKey ? `  ${loc.projectKey}` : '';
    console.log(`  --board ${String(b.id).padEnd(6)} ${String(b.name)}${where}`);
  }
  process.exit(0);
}

const sprints = await paged(`/rest/agile/1.0/board/${encodeURIComponent(board)}/sprint`).catch(fail);

/**
 * Keyed on NAME, because that is the join.
 *
 * `sprint_names[]` on a `programme_graph` issue is a list of names, and the
 * adapter resolves `sprintMeta[name]`. Keying on the numeric sprint id would be
 * a more stable identifier and would match nothing.
 */
interface SprintMeta {
  state?: 'future' | 'active' | 'closed';
  startsAt?: string;
  endsAt?: string;
  closedAt?: string;
}

const meta: Record<string, SprintMeta> = {};
const collisions: string[] = [];

for (const s of sprints) {
  const name = typeof s.name === 'string' ? s.name : undefined;
  if (!name) continue;
  /**
   * A name can repeat across boards, and the two are different sprints. Keep the
   * first and say so rather than letting the last silently win: a closed sprint
   * overwritten by an active one of the same name turns the flagship finding
   * off, which is exactly the failure this script exists to prevent.
   */
  if (meta[name]) {
    collisions.push(name);
    continue;
  }
  const state = s.state === 'closed' || s.state === 'active' || s.state === 'future' ? s.state : undefined;
  meta[name] = {
    ...(state ? { state } : {}),
    ...(typeof s.startDate === 'string' ? { startsAt: s.startDate } : {}),
    ...(typeof s.endDate === 'string' ? { endsAt: s.endDate } : {}),
    // Jira calls it completeDate; we call it closedAt. This is the field the
    // finding's `firedAt` becomes, so it is the one that matters most.
    ...(typeof s.completeDate === 'string' ? { closedAt: s.completeDate } : {}),
  };
}

/**
 * MERGE into an existing file rather than replacing it.
 *
 * A programme spans boards — `programme_graph` covers several projects, so
 * `sprint_names[]` references sprints from more than one — and the script's own
 * board listing invites running it once per board. Writing the file outright
 * meant the second run erased the first board's sprint state, and every sprint
 * it dropped went back to `active` in the adapter's default, which turns the
 * flagship finding off for all of them. Silently: the file looks fine.
 *
 * A name already present is kept, for the same reason a duplicate within one
 * board is: overwriting a `closed` sprint with an `active` one of the same name
 * is the exact failure this is guarding against.
 */
let existing: Record<string, SprintMeta> = {};
if (existsSync(out)) {
  try {
    existing = JSON.parse(await readFile(out, 'utf8')) as Record<string, SprintMeta>;
  } catch {
    console.warn(`  ${out} exists but is not readable JSON — it will be replaced.`);
  }
}
const kept = Object.keys(existing).filter((n) => n in meta).length;
const combined = { ...meta, ...existing };
await mkdir(dirname(out), { recursive: true }).catch(() => {});
await writeFile(out, `${JSON.stringify(combined, null, 2)}\n`, 'utf8');
if (Object.keys(existing).length) {
  console.log(`  merged with ${Object.keys(existing).length} sprint(s) already in ${out}` +
    (kept ? ` (${kept} name(s) already present were kept)` : ''));
}

const closed = Object.values(combined).filter((m) => m.state === 'closed').length;
const undated = Object.entries(combined).filter(([, m]) => m.state === 'closed' && !m.closedAt);

console.log(`${Object.keys(combined).length} sprint(s) → ${out}`);
console.log(`  closed ${closed} · active ${Object.values(combined).filter((m) => m.state === 'active').length} · future ${Object.values(combined).filter((m) => m.state === 'future').length}`);

if (collisions.length) {
  // Count the DISTINCT names, because that is what is listed. It counted every
  // discarded sprint and then printed the unique names, so "3 duplicate sprint
  // name(s): PAY Sprint 12" — a number and a list that never agree past one.
  const distinct = [...new Set(collisions)];
  console.warn(
    `\n  ${distinct.length} duplicate sprint name(s), first kept: ${distinct.join(', ')}\n` +
      '  Two boards use the same sprint name. Check the kept one is the sprint your\n' +
      '  issues actually reference.',
  );
}

if (!closed) {
  /**
   * The whole reason this script exists, so it says so loudly rather than
   * writing a file that looks fine and produces no alerts.
   */
  console.warn(
    '\n  NOTHING IS CLOSED, so the flagship finding still cannot fire.\n' +
      '  `findMissingTickets` triggers when a commitment\'s container CLOSES — an\n' +
      '  epic done, a sprint ended — which is the only moment that is neither\n' +
      '  nagging nor too late. With no closed sprint there is no trigger, and the\n' +
      '  alert never appears without anything erroring.\n' +
      '  If this board genuinely has no completed sprints, point at one that does.',
  );
  process.exit(1);
}

if (undated.length) {
  console.warn(
    `\n  ${undated.length} closed sprint(s) have no completeDate: ${undated.map(([n]) => n).join(', ')}\n` +
      '  A finding stamps `firedAt` from when the container closed, so these will\n' +
      '  fall back to the sprint end date and be ranked by it.',
  );
}

console.log(`\nNext:\n  npx tsx scripts/import-programme-graph.mts --in <graph.json> --out ./live-graph --sprints ${out}`);
