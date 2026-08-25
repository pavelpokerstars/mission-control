/**
 * Fetch Slack, and write the three files `import-slack-messages.mts` reads.
 *
 * TWO MODES, because one of them is unavailable on a locked-down workspace.
 *
 *   --keys <graph.json>    SEARCH for every Jira key in the graph
 *   --channels C123,C456   read whole channels (conversations.history)
 *
 * **Search is the mode that works on Enterprise Grid.** `conversations.list`
 * and `users.conversations` both answer `enterprise_is_restricted` there, so
 * there is no way to enumerate channels at all — but `search.messages` is
 * allowed, and a search result carries the channel, the author, the text and a
 * permalink, which is everything the emitter needs.
 *
 * It is also the better scoping, which is the part worth keeping even where
 * listing works. Reading whole channels pulls a year of standup chatter to find
 * the six lines that mention a ticket; searching the keys pulls exactly the
 * messages that join to the spine. The join is the point — an unjoined message
 * contributes a row to Sources and nothing else.
 *
 *   npx tsx scripts/fetch-slack.mts --keys ./live-graph/graph.json --out live-raw/slack
 *   npx tsx scripts/import-slack-messages.mts --in live-raw/slack/msgs \
 *     --channels live-raw/slack/channels.json --users live-raw/slack/users.json \
 *     --out ./live-graph
 *
 * `--users` IS THE ONE NOT TO SKIP: Slack knows an opaque account id, the graph
 * keys people on email, and everything downstream compares handles. Without it
 * the trail attributes quotes to `00u3b8…` and the rollups count one human
 * twice.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const TOKEN = opt('token') ?? process.env.SLACK_TOKEN ?? '';
const RAW_COOKIE = opt('cookie') ?? process.env.SLACK_COOKIE_D ?? '';
const outDir = opt('out') ?? 'live-raw/slack';
const channelArg = (opt('channels') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const keysFrom = opt('keys');

if (!TOKEN) {
  console.error(
    'Missing SLACK_TOKEN (--token).\n' +
      '\n' +
      '  xoxb-… / xoxp-…  a bot or user token, used on its own\n' +
      '  xoxc-…           a browser token, which ALSO needs SLACK_COOKIE_D (--cookie)\n' +
      '\n' +
      'Read-only: search.messages, users.list, conversations.history.',
  );
  process.exit(2);
}

/**
 * The `d` cookie has to arrive percent-encoded, and sometimes already is.
 *
 * Encoding an encoded value breaks it as surely as not encoding a raw one, and
 * the failure is identical either way — `invalid_auth`, which reads as a bad
 * token and sends you to reissue the wrong thing.
 */
const cookie = /%[0-9A-Fa-f]{2}/.test(RAW_COOKIE) ? RAW_COOKIE : encodeURIComponent(RAW_COOKIE);
const headers: Record<string, string> = {
  authorization: `Bearer ${TOKEN}`,
  ...(RAW_COOKIE ? { cookie: `d=${cookie}` } : {}),
};

const fail = (err: unknown): never => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Search is a tier-2 method — roughly 20 a minute — and it answers 429 rather than queueing. */
async function api(
  method: string,
  params: Record<string, string> = {},
  attempt = 0,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after') ?? 2 ** attempt) * 1000;
    if (attempt > 5) throw new Error(`${method} → rate limited, gave up after 6 attempts`);
    await sleep(wait);
    return api(method, params, attempt + 1);
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (body.ok !== true) {
    const err = String(body.error ?? `http ${res.status}`);
    const hint =
      err === 'invalid_auth'
        ? ' — an xoxc- token needs SLACK_COOKIE_D too, and browser tokens expire'
        : err === 'enterprise_is_restricted'
          ? ' — this workspace forbids the method; use --keys to search instead of listing'
          : err === 'missing_scope'
            ? ` — the token lacks a scope (${String(body.needed ?? '?')})`
            : '';
    throw new Error(`${method} → ${err}${hint}`);
  }
  return body;
}

async function paged(
  method: string,
  key: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let cursor = ''; ; ) {
    const body = await api(method, { ...params, limit: '200', ...(cursor ? { cursor } : {}) });
    all.push(...((body[key] as Record<string, unknown>[]) ?? []));
    const next = ((body.response_metadata as { next_cursor?: string })?.next_cursor ?? '').trim();
    if (!next) return all;
    cursor = next;
  }
}

// ---------------------------------------------------------------------------

const who = await api('auth.test').catch(fail);
console.log(`  ${String(who.team)} — authenticated`);

if (!keysFrom && !channelArg.length) {
  console.error(
    '\nNothing to fetch. Give it one of:\n' +
      '  --keys ./live-graph/graph.json   search for every Jira key in the graph\n' +
      '  --channels C123,C456             read whole channels, if your workspace allows it\n',
  );
  process.exit(2);
}

await mkdir(`${outDir}/msgs`, { recursive: true });

interface Raw {
  ts: string;
  user?: string;
  username?: string;
  text?: string;
  permalink?: string;
}
/** Keyed by channel id, which is what the emitter names its files by. */
const byChannel = new Map<string, { name: string; msgs: Map<string, Raw> }>();
const skippedPrivate = new Set<string>();

/**
 * DIRECT MESSAGES ARE NOT PROGRAMME EVIDENCE, and search returns them.
 *
 * A `D…` id is a one-to-one DM and an `mpdm-…` name is a group one. Both are
 * private conversations between individuals, and an alert page is a shared
 * surface — quoting one there would put a private exchange in front of whoever
 * opens the finding. They are also useless as citations even where that is not
 * a problem: a DM's "channel name" comes back as the other person's account id,
 * so the evidence row would read `#U017AG0LPU4`.
 *
 * This is the same judgement `notify.ts` makes about a notification carrying a
 * pointer and never a quote — the evidence boundary is a decision about what
 * leaves the room it was said in.
 */
function isPrivateConversation(id: string, name: string): boolean {
  return id.startsWith('D') || name.startsWith('mpdm-') || /^U[A-Z0-9]{6,}$/.test(name);
}

function collect(channelId: string, channelName: string, m: Raw): void {
  if (!m.ts || !String(m.text ?? '').trim()) return;
  if (isPrivateConversation(channelId, channelName)) {
    skippedPrivate.add(channelId);
    return;
  }
  const bucket = byChannel.get(channelId) ?? { name: channelName, msgs: new Map<string, Raw>() };
  // Keyed on `ts` — one message routinely matches several key searches, and it
  // would otherwise be written into the graph more than once.
  bucket.msgs.set(m.ts, m);
  byChannel.set(channelId, bucket);
}


// ---- search mode ----------------------------------------------------------

if (keysFrom) {
  const graph = JSON.parse(await readFile(keysFrom, 'utf8')) as {
    nodes?: { kind?: string; key?: string }[];
    issues?: { key?: string }[];
  };
  const keys = [
    ...new Set(
      (graph.nodes ?? [])
        .filter((n) => n.kind === 'issue')
        .map((n) => n.key)
        .concat((graph.issues ?? []).map((i) => i.key))
        .filter((k): k is string => !!k),
    ),
  ];
  if (!keys.length) fail(new Error(`No issue keys found in ${keysFrom}. Run the Jira import first.`));

  console.log(`  searching ${keys.length} key(s) — tier-2 rate limits make this the slow part`);
  let found = 0;
  for (const [i, key] of keys.entries()) {
    const body = await api('search.messages', { query: key, count: '20' }).catch((e) => {
      console.log(`\n  ${key}: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    });
    const matches = (body?.messages as { matches?: Record<string, unknown>[] })?.matches ?? [];
    for (const m of matches) {
      const ch = m.channel as { id?: string; name?: string } | undefined;
      // A message whose channel cannot be named is skipped rather than guessed:
      // "#unknown — sam" on an evidence row is worse than it not being there.
      if (!ch?.id || !ch.name) continue;
      collect(ch.id, ch.name, m as unknown as Raw);
      found++;
    }
    process.stdout.write(`\r  ${i + 1}/${keys.length} searched · ${found} match(es)…`);
  }
  process.stdout.write('\n');
}

// ---- channel mode ---------------------------------------------------------

for (const c of channelArg) {
  const info = await api('conversations.info', { channel: c }).catch((e) => {
    console.log(`  ${c}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  });
  if (!info) continue;
  const ch = info.channel as { id?: string; name?: string };
  const msgs = await paged('conversations.history', 'messages', { channel: c }).catch(() => []);
  const workspace = String(who.url ?? '').replace(/\/+$/, '');
  for (const m of msgs) {
    if (m.subtype !== undefined) continue;
    collect(String(ch.id), String(ch.name ?? c), {
      ...(m as unknown as Raw),
      // Synthesised rather than fetched: `chat.getPermalink` is one call per
      // message to recover a channel id we already have.
      permalink: `${workspace}/archives/${String(ch.id)}/p${String(m.ts ?? '').replace('.', '')}`,
    });
  }
}

// ---------------------------------------------------------------------------

if (!byChannel.size) {
  console.error('\nNo messages matched. Nothing was written.');
  process.exit(1);
}

const channels = [...byChannel].map(([id, b]) => ({ id, name: b.name }));
await writeFile(`${outDir}/channels.json`, `${JSON.stringify(channels, null, 2)}\n`, 'utf8');

let total = 0;
for (const [id, b] of byChannel) {
  const msgs = [...b.msgs.values()].sort((a, b2) => Number(a.ts) - Number(b2.ts));
  await writeFile(`${outDir}/msgs/${id}.json`, `${JSON.stringify(msgs, null, 2)}\n`, 'utf8');
  total += msgs.length;
  console.log(`  #${b.name.padEnd(40)} ${String(msgs.length).padStart(4)} message(s)`);
}

/**
 * Only the people who actually wrote something, looked up one at a time.
 *
 * `users.list` is the obvious call and it is the wrong one here: on an
 * enterprise workspace it pages through tens of thousands of accounts, rate
 * limits repeatedly, and yields a directory to find fifteen authors in. The
 * messages already name their authors, so this asks about exactly those.
 */
const authorIds = new Set<string>();
for (const b of byChannel.values()) for (const m of b.msgs.values()) if (m.user) authorIds.add(m.user);

const users: { id: string; name: string; real_name: string; email: string }[] = [];
for (const id of authorIds) {
  const body = await api('users.info', { user: id }).catch(() => undefined);
  const u = body?.user as
    | { id?: string; name?: string; real_name?: string; profile?: { real_name?: string; email?: string } }
    | undefined;
  if (!u?.id) continue;
  users.push({
    id: u.id,
    name: u.name ?? '',
    real_name: u.profile?.real_name ?? u.real_name ?? '',
    email: u.profile?.email ?? '',
  });
  await sleep(120);
}
await writeFile(`${outDir}/users.json`, `${JSON.stringify(users, null, 2)}\n`, 'utf8');

console.log(`\n  ${total} message(s) in ${byChannel.size} channel(s) → ${outDir}/msgs/`);
console.log(`  ${users.length} user(s), ${users.filter((u) => u.email).length} with an email`);
if (skippedPrivate.size) {
  console.log(`  ${skippedPrivate.size} direct/group DM(s) skipped — private conversations are not programme evidence`);
}
console.log(
  `\nNext:\n  npx tsx scripts/import-slack-messages.mts --in ${outDir}/msgs \\\n` +
    `    --channels ${outDir}/channels.json --users ${outDir}/users.json --out ./live-graph`,
);
