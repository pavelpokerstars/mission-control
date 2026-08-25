/**
 * Read `slack-cli.py` output and write our graph fragment.
 *
 * SLACK IS THE SECOND BEAT, and the measurement says why: stripping the fixture
 * back to Jira alone took seven findings to four, and the two that went were
 * `missing_ticket` and `disagreement`. A `disagreement` needs two claims about
 * the same ticket that cannot both be true, and Slack is where people make them.
 *
 *   python3 slack-cli.py channel list                 > slack/channels.json
 *   python3 slack-cli.py user list                    > slack/users.json
 *   python3 slack-cli.py message list -c C0123 --limit 200 > slack/msgs/C0123.json
 *   npx tsx scripts/import-slack-messages.mts --in slack/msgs \
 *     --channels slack/channels.json --users slack/users.json --out ./live-graph
 *
 * Offline like every emitter here — files in, files out — so the CLI does the
 * reaching and this does the reasoning.
 *
 * IT ALSO CLOSES THE SLACK HALF OF THE IDENTITY MAP (**B3**). Slack knows
 * `U024BE7LH`; everything downstream compares handles, and the graph keys people
 * on email. `--users` supplies both, so this **merges `handles.slack` into a
 * person Jira already wrote** rather than adding a second node for the same
 * human. Without it the rollups over-count — "discussed by three people" about
 * two — and attribute quotes to a raw id.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extractKeys } from '@mc/domain';

const COLLECTOR = 'import-slack-messages';

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
      '  npx tsx scripts/import-slack-messages.mts --in <dir of message JSON> --out <graph dir>\n' +
      '        [--channels channels.json] [--users users.json]\n' +
      '\n' +
      '  --in        one file per channel, each `slack-cli.py message list` output\n' +
      '  --channels  `channel list` output — turns C0123 into #eng-payments\n' +
      '  --users     `user list` output — turns U024BE7LH into a handle, and merges\n' +
      '              handles.slack into people the Jira import already wrote (B3)',
  );
  process.exit(2);
}

const asArray = (v: unknown): Record<string, unknown>[] => {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  for (const k of ['messages', 'channels', 'members', 'users', 'results']) {
    const inner = (v as Record<string, unknown>)?.[k];
    if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  }
  return [];
};

const readJson = async (p: string): Promise<unknown> => JSON.parse(await readFile(p, 'utf8'));

// ---------------------------------------------------------------------------

/** `U024BE7LH` → a handle, and the email that keys the person node. */
const handleOf = new Map<string, string>();
const emailOf = new Map<string, string>();
const nameOf = new Map<string, string>();

const usersPath = opt('users');
if (usersPath && existsSync(usersPath)) {
  for (const u of asArray(await readJson(usersPath))) {
    const id = String(u.id ?? '');
    if (!id) continue;
    const profile = (u.profile ?? {}) as Record<string, unknown>;
    const email = String(profile.email ?? u.email ?? '');
    /**
     * The handle is Slack's `name`, because that is what a transcript speaker,
     * a Jira assignee and a vault note all look like once resolved. `real_name`
     * is a display string and matches nothing.
     */
    const handle = String(u.name ?? profile.display_name ?? '').trim();
    if (handle) handleOf.set(id, handle);
    if (email) emailOf.set(id, email.toLowerCase());
    const real = String(u.real_name ?? profile.real_name ?? '').trim();
    if (real) nameOf.set(id, real);
  }
}

/** `C0123` → `eng-payments`. */
const channelName = new Map<string, string>();
const channelsPath = opt('channels');
if (channelsPath && existsSync(channelsPath)) {
  for (const c of asArray(await readJson(channelsPath))) {
    const id = String(c.id ?? '');
    const name = String(c.name ?? '');
    if (id && name) channelName.set(id, name);
  }
}

// ---------------------------------------------------------------------------

interface Msg {
  id: string;
  channel: string;
  author: string;
  at: string;
  text: string;
  url?: string;
}

const messages: Msg[] = [];
const skipped: string[] = [];

/**
 * Slack's `ts` is unix SECONDS with a microsecond fraction, not a date.
 *
 * `Date.parse('1755950400.001')` is NaN — silently — which is why
 * `slackTsToIso` exists in the domain at all. Getting this wrong here would
 * stamp every message `Invalid Date` and sort the whole channel to the bottom
 * of a newest-first trail.
 */
function tsToIso(ts: string): string | undefined {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

/** The channel id is in the permalink, which is the only self-describing source. */
function channelFromPermalink(url: string | undefined): string | undefined {
  const m = url ? /\/archives\/([A-Z0-9]+)\// .exec(url) : null;
  return m ? m[1] : undefined;
}

for (const file of (await readdir(inDir)).filter((f) => f.endsWith('.json')).sort()) {
  const payload = await readJson(join(inDir, file)).catch(() => undefined);
  if (payload === undefined) {
    skipped.push(`${file} — not JSON`);
    continue;
  }
  const raw = asArray(payload);
  if (!raw.length) {
    skipped.push(`${file} — no messages`);
    continue;
  }

  /**
   * Which channel these came from, in order of how much we trust it: the
   * permalink names it explicitly, and the filename is the convention the usage
   * above suggests. A channel we cannot name is skipped rather than guessed —
   * `container` and the citation label both read it, and "#unknown — sam" on an
   * evidence row is worse than the message not being there.
   */
  const fromLink = channelFromPermalink(String(raw[0]!.permalink ?? ''));
  const stem = basename(file, '.json');
  const chanId = fromLink ?? (/^[A-Z][A-Z0-9]{6,}$/.test(stem) ? stem : undefined);
  const chan = (chanId && channelName.get(chanId)) ?? (chanId ? undefined : stem);
  if (!chan) {
    skipped.push(`${file} — channel ${chanId ?? '?'} not in --channels, and the filename is not a name`);
    continue;
  }

  for (const m of raw) {
    const ts = String(m.ts ?? '');
    const text = String(m.text ?? '').trim();
    const user = String(m.user ?? '');
    const at = tsToIso(ts);
    // A message with no text is a join notice, a file share or a reaction-only
    // event. `listStickies` drops empty stickies for the same reason: an empty
    // record cannot be cited and cannot join.
    if (!ts || !at || !text || !user) continue;

    messages.push({
      id: `${chan}-${ts.replace('.', '-')}`,
      channel: chan,
      author: handleOf.get(user) ?? user,
      at,
      text,
      ...(m.permalink ? { url: String(m.permalink) } : {}),
    });
  }
}

if (!messages.length) {
  console.error(`No usable messages in ${inDir}.`);
  for (const s of skipped) console.error(`  skipped ${s}`);
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

await mkdir(join(outDir, 'records', 'message'), { recursive: true });
const graphPath = join(outDir, 'graph.json');
let graph: Graph = { directed: true, multigraph: false, graph: {}, nodes: [], links: [] };
let merged = false;
if (existsSync(graphPath)) {
  graph = JSON.parse(await readFile(graphPath, 'utf8')) as Graph;
  merged = true;
  const before = graph.nodes.length;
  const mine = new Set(
    graph.nodes.filter((n) => n.collector === COLLECTOR).map((n) => String(n.id)),
  );
  graph.nodes = graph.nodes.filter((n) => n.collector !== COLLECTOR);
  // Our edges go with our nodes, or a re-run leaves them pointing at ids that
  // no longer exist — which is the dangling-edge violation, self-inflicted.
  graph.links = graph.links.filter((l) => !mine.has(String(l.source ?? '')));
  if (before !== graph.nodes.length) {
    console.log(`replacing ${before - graph.nodes.length} message(s) from a previous run`);
  }
}

/**
 * B3, done against real data: give people Jira already knows their Slack handle.
 *
 * A `person` node is keyed on email, and `--users` is the only source that has
 * both the email and the Slack id. So this MERGES into an existing person
 * rather than adding one — two nodes for one human is the duplicate-id
 * violation the other emitters already learned, and `handles` is exactly the
 * field `buildIdentities` reads.
 */
let enriched = 0;
let added = 0;
for (const [id, email] of emailOf) {
  const handle = handleOf.get(id);
  if (!handle) continue;
  const nodeId = `person:${email}`;
  /**
   * Match case-insensitively, because only one side was lowercased.
   *
   * `emailOf` stores `email.toLowerCase()`, and the Jira import keys a person
   * on whatever the `--people` map said — `Dana.Ruiz@Example.com` stays as
   * written. An exact string compare then missed the person and added a second
   * node for the same human, which is the duplicate the marker exists to
   * prevent, arriving by a different door.
   */
  const existing = graph.nodes.find(
    (n) => String(n.id).toLowerCase() === nodeId.toLowerCase(),
  );
  if (existing) {
    const handles = (existing.handles ?? {}) as Record<string, string>;
    if (handles.slack === handle) continue;
    existing.handles = { ...handles, slack: handle };
    enriched++;
  } else {
    graph.nodes.push({
      id: nodeId,
      kind: 'person',
      source: 'slack',
      collector: COLLECTOR,
      label: nameOf.get(id) ?? handle,
      email,
      displayName: nameOf.get(id) ?? handle,
      handles: { slack: handle },
    });
    added++;
  }
}

const taken = new Set(graph.nodes.map((n) => String(n.id)));
const issues = new Set(
  graph.nodes
    .filter((n) => n.kind === 'issue')
    .map((n) => String(n.key ?? String(n.id).replace(/^issue:/, ''))),
);
const collided: string[] = [];
let written = 0;
let edges = 0;

for (const m of messages) {
  const nodeId = `message:slack/${m.channel}/${m.id}`;
  if (taken.has(nodeId)) {
    collided.push(m.id);
    continue;
  }
  taken.add(nodeId);

  /**
   * A message joins through an EDGE, not only through its text.
   *
   * `projectMessages` runs `extractKeys` at read time, so the trail and the
   * dossier find these anyway — but Sources counts a `message` node with no
   * outbound edge as "joins to nothing", and the relation graph never puts the
   * message in the ticket's neighbourhood. Both were wrong about every message
   * this emitter wrote.
   *
   * Filtered against the graph's real issues for the reason the Confluence and
   * GitHub emitters are: an edge to a node that does not exist is a contract
   * violation, and `SOC-2` in a sentence matches the Jira key regex.
   */
  for (const key of extractKeys(m.text).filter((k) => issues.has(k))) {
    graph.links.push({
      source: nodeId,
      target: `issue:${key}`,
      relation: 'mentions',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [{ source: 'slack', ref: nodeId, quote: m.text.slice(0, 200) }],
    });
    edges++;
  }

  graph.nodes.push({
    id: nodeId,
    kind: 'message',
    source: 'slack',
    collector: COLLECTOR,
    label: `#${m.channel} — ${m.author}`,
    at: m.at,
    container: `channel:slack/${m.channel}`,
    recordRef: `records/message/${m.id}.json`,
    ...(m.url ? { url: m.url } : {}),
  });
  await writeFile(
    join(outDir, 'records', 'message', `${m.id}.json`),
    `${JSON.stringify({ id: m.id, channel: m.channel, author: m.author, at: m.at, text: m.text }, null, 2)}\n`,
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
graph.graph = {
  // Filled only when absent, so a graph this creates alone still carries the
  // `generatedAt` / `generator` that `verify-collector.mts` requires.
  generatedAt: new Date().toISOString(),
  generator: COLLECTOR,
  ...(graph.graph ?? {}),
  sources: [...new Set([...((graph.graph?.sources as string[]) ?? []), 'slack'])],
  slackImportedAt: new Date().toISOString(),
};
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

const channels = [...new Set(messages.map((m) => m.channel))];
const unresolved = messages.filter((m) => /^U[A-Z0-9]{6,}$/.test(m.author)).length;

console.log(`${merged ? 'merged into' : 'wrote'} ${graphPath}`);
console.log(`  ${written} message(s) across ${channels.length} channel(s): ${channels.join(', ')}`);
console.log(`  ${edges} joined to a ticket`);
console.log(`  identities — ${enriched} person(s) gained handles.slack, ${added} added`);
if (unresolved) {
  console.log(
    `\n  ${unresolved} message(s) still attributed to a raw Slack id.\n` +
      `  Pass --users (\`slack-cli.py user list\`) or the trail will say "U024BE7LH said"\n` +
      `  and the rollups will count one person twice. This is B3.`,
  );
}
if (collided.length) console.log(`\n  ${collided.length} already in this graph from another collector, left alone`);
if (skipped.length) {
  console.log(`\n  ${skipped.length} file(s) skipped:`);
  for (const s of skipped) console.log(`    ${s}`);
}
console.log(`\nNext:\n  npx tsx scripts/verify-collector.mts ${outDir}`);
