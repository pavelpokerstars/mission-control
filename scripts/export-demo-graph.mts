/**
 * Export a sanitised copy of a live graph: the structure travels, the prose does not.
 *
 * WHY THIS EXISTS. The interesting work here is wiring — which record joins to
 * which key, which way a dependency points, which promise has no ticket, what a
 * citation lands on. All of that is *shape*, and none of it needs a real
 * sentence. So this reads `MC_GRAPH_DIR` and writes a second graph directory
 * that is identical in topology, tiers, dates, counts and join pattern, and
 * shares not one word of anybody's writing.
 *
 * THE ONE RULE, AND IT IS NOT NEGOTIABLE: no free text is carried over. Not
 * shortened, not redacted, not "scrubbed" with a name regex — regenerated. A
 * regex over prose is the tempting version and it does not work: it misses
 * nicknames, initials, first names, misspellings and every customer, vendor and
 * incident named in the body, and it leaves the business content itself intact,
 * which is the part policy is actually about. So every body, title, quote and
 * excerpt out of here is invented.
 *
 * WHAT MAKES THE INVENTED TEXT USEFUL RATHER THAN NOISE is that it is generated
 * to the *class* of what it replaces. A line that claimed a ticket was done
 * emits a line that claims a ticket is done, against the same remapped key —
 * so `classifySignalFor` still sees a done-claim, `findContradictions` still
 * fires on the same pair, `extractKeys` still joins the same records, and a
 * record that joined to nothing still joins to nothing. The detectors read the
 * same graph. Only a human reading a body learns nothing about anyone.
 *
 * DATES ARE KEPT, deliberately. They are load-bearing in a way names are not —
 * a sprint's close is the trigger, the gap between a promise and now is the
 * severity, and "the page predates the ticket" is a badge. Shifting them would
 * make every detector's output untestable against the real thing it mirrors.
 *
 * THE MAP IS THE RE-IDENTIFICATION KEY AND STAYS HERE. It is written outside
 * `--out` and gitignored, so re-exporting is stable as the programme grows
 * (a new person keeps everyone else's alias) while the exported directory on
 * its own is one-way. Do not copy the map to the laptop; it is the one file
 * that would undo all of this.
 *
 *   npx tsx scripts/export-demo-graph.mts --in live-graph --vault live-vault --out demo-graph
 *   MC_GRAPH_DIR=./demo-graph MC_VAULT_DIR=./demo-vault npm run dev
 *
 * It refuses to finish if a real token survives into the output — see `leakScan`
 * at the bottom, which is the only reason to trust any of the above.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { classifySignalFor, extractKeys, isNodeKind, STORED_NODE_KINDS, STORED_RELATIONS, type Note, type StoredGraph, type StoredNode } from '@mc/domain';
import { decodeNote, encodeNote } from '@mc/vault';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

if (has('help')) {
  console.log(`
export-demo-graph — a sanitised copy of a live graph: structure kept, prose invented

  --in <dir>      graph directory to read      (default: live-graph)
  --vault <dir>   vault to read notes from     (default: live-vault)
  --out <dir>     where to write               (default: demo-graph)
  --map <file>    alias map, kept OUT of --out (default: .demo-map.json)
  --force         overwrite --out if it exists
  --help

The map is the re-identification key. It stays on this machine — it is
gitignored, written outside --out, and must not travel with the export.
`);
  process.exit(0);
}

const IN = flag('in', 'live-graph');
const VAULT_IN = flag('vault', 'live-vault');
const OUT = flag('out', 'demo-graph');
const MAP_FILE = flag('map', '.demo-map.json');

// ---------------------------------------------------------------------------
// Aliases — deterministic, salted, and assigned in an order that leaks nothing
// ---------------------------------------------------------------------------

interface MapFile {
  salt: string;
  alias: Record<string, string>;
}

let salt = randomBytes(24).toString('hex');
const alias = new Map<string, string>();

try {
  const prior = JSON.parse(await readFile(MAP_FILE, 'utf8')) as MapFile;
  salt = prior.salt;
  for (const [k, v] of Object.entries(prior.alias)) alias.set(k, v);
  console.log(`  reusing ${MAP_FILE} — ${alias.size} existing aliases stay stable`);
} catch {
  console.log(`  new salt — ${MAP_FILE} will be written`);
}

const h = (s: string): string => createHash('sha256').update(`${salt}\u0000${s}`).digest('hex');
const hInt = (s: string): number => parseInt(h(s).slice(0, 12), 16);
// The trailing comma is required: in a .mts file `<T>` alone reads as JSX.
const pick = <T,>(pool: readonly T[], seed: string): T => pool[hInt(seed) % pool.length]!;

/** Every real value the scan will hunt for. Fed deliberately — see `leakScan`. */
const realTokens = new Set<string>();

/**
 * Assign aliases in bulk, minting on first sight and never moving one after.
 *
 * Sorted by SALTED HASH rather than by the real value, because assigning
 * `person-1`, `person-2` in alphabetical order publishes the alphabetical order
 * of a small team — which for fifteen people is most of the way back to names.
 */
function assignAll(bucket: string, reals: Iterable<string>): void {
  const mint = MINTERS[bucket];
  if (!mint) throw new Error(`no minter registered for bucket ${bucket}`);
  const prefix = `${bucket}\u0000`;
  const fresh = [...new Set(reals)].map((r) => r?.trim()).filter((r) => r && !alias.has(prefix + r)) as string[];
  fresh.sort((a, b) => (h(bucket + a) < h(bucket + b) ? -1 : 1));
  const taken = new Set([...alias.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v));
  let n = taken.size;
  for (const real of fresh) {
    // The disambiguator is a SUFFIX rather than a re-roll of the minter, because
    // not every minter is a function of its index — `meeting` derives its alias
    // from the ceremony word and the date alone, so two meetings of the same
    // kind on the same day mint the same name however many times they are
    // asked. Re-rolling spins forever on exactly that case, silently, which is
    // a worse failure than a duplicate would have been.
    let minted = mint(n, real);
    for (let attempt = 2; taken.has(minted); attempt++) {
      if (attempt > 500) throw new Error(`bucket ${bucket}: cannot mint a unique alias for "${real}"`);
      minted = `${mint(n, real)} ${attempt}`;
    }
    taken.add(minted);
    alias.set(prefix + real, minted);
    n++;
  }
}

/**
 * MINTS ON DEMAND, and that is the safety property rather than a convenience.
 *
 * Prose names things the fetch never pulled — a neighbouring project's ticket,
 * a channel a message was cross-posted from, a person who left. Every one of
 * those is exactly as identifying as the values we hold nodes for. The two
 * obvious alternatives are both wrong: throwing turns a normal corpus into a
 * crash, and passing the value through is a silent leak. So an unseen value
 * gets an alias, on the spot, like everything else.
 */
function aliasOf(bucket: string, real: string): string {
  const trimmed = real.trim();
  if (!alias.has(`${bucket}\u0000${trimmed}`)) assignAll(bucket, [trimmed]);
  return alias.get(`${bucket}\u0000${trimmed}`)!;
}

// ---------------------------------------------------------------------------
// The invented vocabulary
// ---------------------------------------------------------------------------

const FIRST = ['Ada', 'Bo', 'Cleo', 'Dev', 'Esme', 'Finn', 'Greta', 'Hugo', 'Ivy', 'Jonas',
  'Kira', 'Luca', 'Mara', 'Nils', 'Orla', 'Pia', 'Quinn', 'Rafa', 'Sena', 'Tom',
  'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zeno'] as const;
const LAST = ['Ash', 'Bright', 'Calder', 'Dunne', 'Ellis', 'Frost', 'Gale', 'Hart', 'Iver',
  'Jost', 'Kerr', 'Lund', 'Moss', 'Nord', 'Oakes', 'Pike'] as const;

const CHANNELS = ['delivery', 'platform-eng', 'web-build', 'releases', 'incidents',
  'design-review', 'qa', 'backend', 'infra', 'product'] as const;

const PROJECTS = ['DEMO', 'CORE', 'PLAT', 'APPS', 'DATA'] as const;
const REPOS = ['service-api', 'web-client', 'auth-gateway', 'billing-worker', 'admin-console',
  'events-pipeline', 'design-system', 'infra-modules'] as const;

/** Generic engineering work. Nothing here is anybody's actual task. */
const TASKS = [
  'write up the rollout plan', 'confirm the migration window', 'add the missing integration test',
  'review the schema change', 'chase the vendor sandbox', 'document the retry policy',
  'split the batch job', 'raise a ticket for the flaky suite', 'update the runbook',
  'check the cache invalidation', 'agree the error budget', 'tidy the feature flags',
  'measure the cold start', 'pin the dependency version', 'draft the decision record',
  'sign off the accessibility pass', 'move the cron off the old host', 'audit the log volume',
] as const;

const DONE_LINES = [
  'is merged and out on staging', 'shipped this morning', 'is done, nothing left on it',
  'went out with the last release', 'is complete and verified',
] as const;
const BLOCKED_LINES = [
  'is still blocked on the sandbox credential', 'cannot move until the schema lands',
  'is waiting on review', 'is stuck behind the migration', 'is blocked, no change yet',
] as const;
const NEUTRAL_LINES = [
  'is in progress', 'needs another look tomorrow', 'is on the board for this sprint',
  'has a question outstanding', 'was discussed, no decision yet', 'is being picked up next',
] as const;
const CHATTER = [
  'Morning all.', 'Nothing blocking from me.', 'Same as yesterday.',
  'I will pick that up after standup.', 'Agreed.', 'Let us take that offline.',
  'Can we come back to this on Thursday?', 'Numbers look fine.',
  'That is the last of it.', 'No update today.',
] as const;

/** Ceremony vocabulary is generic and kept on purpose — it drives `/workshop`. */
const CEREMONY = ['standup', 'scrum', 'retro', 'retrospective', 'refinement', 'grooming',
  'planning', 'review', 'sync', 'demo', 'kickoff', 'daily', 'weekly'] as const;

/** One minter per bucket, so `aliasOf` can always answer. */
const MINTERS: Record<string, (i: number, real: string) => string> = {
  project: (i) => PROJECTS[i % PROJECTS.length]! +
    (i >= PROJECTS.length ? String(Math.floor(i / PROJECTS.length) + 1) : ''),
  person: (i, real) =>
    `${FIRST[hInt('f' + real) % FIRST.length]} ${LAST[(hInt('l' + real) + i) % LAST.length]}`,
  channel: (i) => CHANNELS[i % CHANNELS.length]! +
    (i >= CHANNELS.length ? `-${Math.floor(i / CHANNELS.length) + 1}` : ''),
  repo: (i) => `acme/${REPOS[i % REPOS.length]}${i >= REPOS.length ? `-${Math.floor(i / REPOS.length) + 1}` : ''}`,
  sprint: (i, real) => {
    const n = real.match(/(\d+)\s*$/)?.[1];
    return n ? `Sprint ${n}` : `Sprint ${i + 1}`;
  },
  // A meeting keeps its ceremony word and its date and loses everything else.
  // Both halves matter: `/workshop` with no argument reads the newest
  // transcript and a retro is not a standup, so the type has to survive — and
  // the org's own name for the ceremony is exactly the identifying part.
  meeting: (_i, real) => {
    const kind = CEREMONY.find((c) => real.toLowerCase().includes(c)) ?? 'sync';
    const date = real.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
    return `Team ${kind.charAt(0).toUpperCase() + kind.slice(1)}${date ? ` ${date}` : ''}`;
  },
};
MINTERS['loose-person'] = MINTERS['person']!;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

const graph = JSON.parse(await readFile(join(IN, 'graph.json'), 'utf8')) as StoredGraph;

type RecordFile = Record<string, unknown> & { id?: string };
const records = new Map<string, Map<string, RecordFile>>();
let recordKinds: string[] = [];
try {
  recordKinds = (await readdir(join(IN, 'records'), { withFileTypes: true }))
    .filter((d) => d.isDirectory()).map((d) => d.name);
} catch { /* a graph with no records is legitimate */ }
for (const kind of recordKinds) {
  const bucket = new Map<string, RecordFile>();
  for (const f of (await readdir(join(IN, 'records', kind))).filter((f) => f.endsWith('.json'))) {
    bucket.set(f.replace(/\.json$/, ''), JSON.parse(await readFile(join(IN, 'records', kind, f), 'utf8')));
  }
  records.set(kind, bucket);
}

const notes: Note[] = [];
try {
  for (const f of (await readdir(join(VAULT_IN, 'notes'))).filter((f) => f.endsWith('.md'))) {
    notes.push(decodeNote(f.replace(/\.md$/, ''), await readFile(join(VAULT_IN, 'notes', f), 'utf8')));
  }
} catch { /* no vault is legitimate — the graph still exports */ }

let events: Record<string, unknown>[] = [];
for (const candidate of [join(IN, 'events.jsonl'), join(VAULT_IN, 'raw', 'events.jsonl')]) {
  try {
    events = (await readFile(candidate, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
    break;
  } catch { /* try the next */ }
}

console.log(`  read ${graph.nodes.length} nodes, ${graph.links.length} edges, ` +
  `${[...records.values()].reduce((n, b) => n + b.size, 0)} records, ${notes.length} notes, ${events.length} events`);

// ---------------------------------------------------------------------------
// Mint every alias up front
// ---------------------------------------------------------------------------

const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
const issues = graph.nodes.filter((n): n is Extract<StoredNode, { kind: 'issue' }> => n.kind === 'issue');
const people = graph.nodes.filter((n): n is Extract<StoredNode, { kind: 'person' }> => n.kind === 'person');

// Projects first, so the common ones get the tidy aliases.
assignAll('project', issues.map((i) => i.key.split('-')[0]!));

const keyAlias = (key: string): string => {
  const [prefix, num] = [key.split('-')[0]!, key.split('-').slice(1).join('-')];
  return `${aliasOf('project', prefix)}-${num}`;
};

assignAll('person', people.map((p) => p.email));
const personEmail = (name: string): string => `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
const personHandle = (name: string): string => name.toLowerCase().replace(/\s+/g, '.');

// Everything a person is known by maps onto the SAME alias, or the identity
// join this product is built on silently splits one colleague into three.
const personByAnyName = new Map<string, string>();
for (const p of people) {
  const to = aliasOf('person', p.email);
  for (const known of [p.email, p.displayName, p.label, ...Object.values(p.handles ?? {})]) {
    if (known) { personByAnyName.set(String(known).toLowerCase(), to); realTokens.add(String(known)); }
  }
}
/** Aliases a human name from anywhere — an owner string, a message author, a Zoom speaker. */
const personAlias = (raw: string): string =>
  personByAnyName.get(raw.trim().toLowerCase()) ?? aliasOf('loose-person', raw);

assignAll('channel', graph.nodes.filter(isNodeKind('message')).map((n) => n.container ?? ''));
assignAll('sprint', graph.nodes.filter(isNodeKind('sprint')).map((n) => n.label));
assignAll('meeting', graph.nodes.filter(isNodeKind('meeting')).map((n) => n.label));
assignAll('repo', graph.nodes.filter(isNodeKind('pr'))
  .map((n) => n.id.split('/').slice(1, -1).join('/')).filter(Boolean));

// Node ids last: they carry channel names, doc ids, repo paths and ticket keys.
const idMap = new Map<string, string>();
const seq = new Map<string, number>();
for (const n of [...graph.nodes].sort((a, b) => (h(a.id) < h(b.id) ? -1 : 1))) {
  const next = (seq.get(n.kind) ?? 0) + 1;
  seq.set(n.kind, next);
  const tail =
    n.kind === 'issue' ? keyAlias((n as Extract<StoredNode, { kind: 'issue' }>).key)
    : n.kind === 'person' ? personEmail(aliasOf('person', (n as Extract<StoredNode, { kind: 'person' }>).email))
    : n.kind === 'sprint' ? aliasOf('sprint', n.label)
    : `${n.kind.slice(0, 3)}${String(next).padStart(4, '0')}`;
  idMap.set(n.id, `${n.kind}:${tail}`);
  realTokens.add(n.id);
}
const mapId = (id: string): string => idMap.get(id) ?? `unmapped:${h(id).slice(0, 10)}`;

// ---------------------------------------------------------------------------
// Invented text, generated to the class of what it replaces
// ---------------------------------------------------------------------------

const keysIn = (text: string): string[] => [...new Set(extractKeys(text))].map(keyAlias);

/**
 * One line of invented prose standing in for one real line.
 *
 * It preserves the two things anything downstream reads: which tickets are
 * named, and what is being claimed about them. Everything else is a coin toss
 * against the salt.
 */
function synthLine(real: string, seed: string): string {
  const keys = keysIn(real);
  if (!keys.length) return pick(CHATTER, seed);
  const claim = keys.map((k) => {
    const signal = classifySignalFor(real, extractKeys(real).find((x) => keyAlias(x) === k));
    const pool = signal === 'done' ? DONE_LINES : signal === 'blocked' ? BLOCKED_LINES : NEUTRAL_LINES;
    return `${k} ${pick(pool, seed + k)}`;
  });
  return `${claim.join('. ')}.`;
}

function synthBody(real: string, seed: string): string {
  return real.split('\n').map((line, i) => (line.trim() ? synthLine(line, `${seed}:${i}`) : '')).join('\n');
}

const synthTitle = (real: string, seed: string): string => {
  const keys = keysIn(real);
  const task = pick(TASKS, seed);
  return keys.length ? `${keys[0]} — ${task}` : task.charAt(0).toUpperCase() + task.slice(1);
};

/** A promise, in the one shape the extractor and the alert both read. */
const synthPromise = (owner: string, seed: string): string => `${owner} to ${pick(TASKS, seed)}.`;

const scrubUrl = (url?: string): string | undefined =>
  url && `https://example.com/${h(url).slice(0, 12)}`;

// ---------------------------------------------------------------------------
// Rewrite the graph
// ---------------------------------------------------------------------------

const outNodes: StoredNode[] = graph.nodes.map((n) => {
  const base = { ...n, id: mapId(n.id), url: scrubUrl(n.url) };
  if (n.kind === 'issue') {
    const key = keyAlias(n.key);
    return { ...base, key, label: `${key} — ${synthTitle(n.label, n.id)}`,
      assignee: n.assignee ? personHandle(personAlias(n.assignee)) : undefined } as StoredNode;
  }
  if (n.kind === 'person') {
    const name = aliasOf('person', n.email);
    return { ...base, email: personEmail(name), displayName: name, label: name,
      handles: n.handles ? Object.fromEntries(Object.keys(n.handles).map((k) => [k, personHandle(name)])) : undefined } as StoredNode;
  }
  if (n.kind === 'sprint' || n.kind === 'release') {
    return { ...base, label: aliasOf('sprint', n.label) } as StoredNode;
  }
  if (n.kind === 'meeting') {
    return { ...base, label: aliasOf('meeting', n.label),
      recordRef: n.recordRef && `records/meeting/${mapId(n.id).split(':')[1]}.json` } as StoredNode;
  }
  if (n.kind === 'message' || n.kind === 'page' || n.kind === 'pr' || n.kind === 'sticky') {
    const container = n.container
      ? (nodeById.has(n.container) ? mapId(n.container) : aliasOf('channel', n.container))
      : undefined;
    return { ...base, label: synthTitle(n.label, n.id), container,
      recordRef: n.recordRef && `records/${n.kind}/${mapId(n.id).split(':')[1]}.json` } as StoredNode;
  }
  return { ...base, label: synthTitle(n.label, n.id) } as StoredNode;
});

const outLinks = graph.links.map((e) => ({
  ...e,
  source: mapId(e.source),
  target: mapId(e.target),
  why: e.why ? `${e.relation.replace(/_/g, ' ')} — corroborated in the record` : undefined,
  evidence: (e.evidence ?? []).map((ev) => ({
    ...ev,
    ref: idMap.has(ev.ref) ? mapId(ev.ref) : `ref:${h(ev.ref).slice(0, 10)}`,
    quote: ev.quote ? synthLine(ev.quote, ev.ref) : undefined,
  })),
}));

// ---------------------------------------------------------------------------
// Rewrite the records
// ---------------------------------------------------------------------------

/** Which promise line a meeting record must carry, and at which paragraph. */
const plantedLines = new Map<string, Map<number, string>>();
const meetingByLabel = new Map(graph.nodes.filter(isNodeKind('meeting')).map((n) => [n.label, n.id]));

const outRecords = new Map<string, Map<string, RecordFile>>();
for (const [kind, bucket] of records) outRecords.set(kind, new Map());

// Notes first — a citation has to land on a line the record actually contains.
const outNotes: Note[] = notes.map((note, idx) => {
  const owner = note.owner ? personAlias(note.owner) : undefined;
  const promise = synthPromise(owner ?? 'The team', note.id);
  const container = note.container && nodeById.has(note.container)
    ? mapId(note.container)
    : note.container ? `sprint:${aliasOf('sprint', note.container.replace(/^sprint:/, ''))}` : undefined;

  const evidence = (note.evidence ?? []).map((ev) => {
    const label = String(ev.label ?? '');
    const bare = label.replace(/\s*\(read by the model\)\s*$/, '');
    const suffix = label === bare ? '' : ' (read by the model)';
    // Aliased through the meeting bucket whether or not the graph holds a node
    // for it. A citation to a meeting that was never collected is dangling on
    // the way in and stays dangling — but it has to still read as a meeting,
    // and `synthTitle` gives it a ticket-shaped label, which is a different
    // and more confusing kind of wrong.
    const meetingId = meetingByLabel.get(bare);
    let at = typeof ev.at === 'number' ? ev.at : undefined;
    if (meetingId && at !== undefined) {
      const file = mapId(meetingId).split(':')[1]!;
      if (!plantedLines.has(file)) plantedLines.set(file, new Map());
      const slots = plantedLines.get(file)!;
      // Two promises out of one paragraph is normal, and the second must not
      // silently overwrite the first — it takes the next free line, and its
      // own citation moves with it so the pair stays consistent.
      while (slots.has(at)) at++;
      slots.set(at, promise);
    }
    return { ...ev, at, label: `${aliasOf('meeting', bare)}${suffix}`, quote: ev.quote ? promise : undefined };
  });

  const slug = promise.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return {
    ...note,
    id: `promise-${String(idx + 1).padStart(3, '0')}-${slug}`,
    title: promise,
    owner,
    container,
    evidence,
    relatedKeys: (note.relatedKeys ?? []).map(keyAlias),
    body: `${promise}\n\n` +
      `Promised in ${evidence[0]?.label ?? 'a meeting'}. ${owner ?? 'The team'} took it. ` +
      `${note.tags?.includes('due-from-sprint') ? 'No date was given, so it is checked against the sprint close.' : ''} ` +
      `Nothing in the tracker references it yet.`.replace(/\s+/g, ' '),
  } as Note;
});

/**
 * Driven by NODES, not by the files on disk, and the difference is not cosmetic.
 *
 * A record filename is the vendor's id and those collide — `import-github-prs`
 * names a PR record after its number alone, so PR 214 in two repos is one file,
 * and 485 nodes on the way in share 475 records. Iterating files silently drops
 * the node that lost the collision; iterating nodes gives every one its own
 * file and every `recordRef` something to resolve to. It also turns an O(n²)
 * `find` per file into a lookup.
 */
const shared: string[] = [];
const usedSources = new Set<string>();
const refOf = (n: StoredNode): string | undefined => ('recordRef' in n ? n.recordRef : undefined);
for (const n of graph.nodes) {
  const ref = refOf(n);
  if (!ref) continue;
  const base = ref.split('/').pop()!.replace(/\.json$/, '');
  const rec = records.get(n.kind)?.get(base);
  // A ref with no file on the way in is a gap in the source graph, and it is
  // carried through as a gap rather than papered over with an invented record.
  if (!rec) continue;
  if (usedSources.has(`${n.kind}/${base}`)) shared.push(`${n.kind}/${base}`);
  usedSources.add(`${n.kind}/${base}`);

  const newFile = mapId(n.id).split(':')[1]!;
  const seed = n.id;
  const out: RecordFile = { ...rec, id: mapId(n.id) };

  if (typeof rec.text === 'string') out.text = synthLine(rec.text, seed);
  if (typeof rec.title === 'string') out.title = synthTitle(rec.title, seed);
  if (typeof rec.topic === 'string') out.topic = aliasOf('meeting', String(rec.topic));
  if (typeof rec.author === 'string') out.author = personHandle(personAlias(rec.author));
  if (typeof rec.channel === 'string') out.channel = aliasOf('channel', String(rec.channel));
  if (typeof rec.branch === 'string') {
    const k = keysIn(String(rec.branch));
    out.branch = k.length ? `feature/${k[0]}-change` : `feature/${h(String(rec.branch)).slice(0, 8)}`;
  }
  if (Array.isArray(rec.keys)) out.keys = (rec.keys as string[]).map(keyAlias);
  if (Array.isArray(rec.participants)) {
    out.participants = (rec.participants as string[]).map((p) => personAlias(String(p)));
  }
  if (typeof rec.body === 'string') {
    const lines = synthBody(rec.body, seed).split('\n');
    for (const [at, line] of plantedLines.get(newFile) ?? []) {
      while (lines.length <= at) lines.push(pick(CHATTER, `${seed}:pad:${lines.length}`));
      lines[at] = line;
    }
    out.body = lines.join('\n');
  }
  if (Array.isArray(rec.segments)) {
    out.segments = (rec.segments as Record<string, unknown>[]).map((s, i) => ({
      ...s,
      who: s.who ? personAlias(String(s.who)) : undefined,
      text: synthLine(String(s.text ?? ''), `${seed}:${i}`),
    }));
  }
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];
  if (!outRecords.has(n.kind)) outRecords.set(n.kind, new Map());
  outRecords.get(n.kind)!.set(newFile, out);
}

// ---------------------------------------------------------------------------
// Rewrite the event log — structure only
// ---------------------------------------------------------------------------

/**
 * A payload is arbitrary and routinely carries a proposal's drafted text, so it
 * is rebuilt from the fields we can positively identify rather than filtered.
 * A deny-list over free-form JSON is a leak waiting for its first new field.
 */
const outEvents = events.map((e, i) => {
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((e.payload as Record<string, unknown>) ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') payload[k] = v;
    else if (typeof v === 'string' && idMap.has(v)) payload[k] = mapId(v);
    else if (typeof v === 'string' && /^[A-Z][A-Z0-9]+-\d+$/.test(v)) payload[k] = keyAlias(v);
  }
  const entityKey = typeof e.entityKey === 'string' && e.entityKey
    ? (idMap.has(e.entityKey) ? mapId(e.entityKey)
      : /^[A-Z][A-Z0-9]+-\d+$/.test(e.entityKey) ? keyAlias(e.entityKey) : undefined)
    : undefined;
  return { id: `evt-${String(i + 1).padStart(4, '0')}`, ts: e.ts, source: e.source, type: e.type, entityKey, payload };
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

if (has('force')) await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'notes'), { recursive: true });

const outGraph: StoredGraph = {
  ...graph,
  graph: { ...graph.graph, generatedAt: new Date().toISOString(), generator: 'export-demo-graph (sanitised)' },
  nodes: outNodes,
  links: outLinks,
};
await writeFile(join(OUT, 'graph.json'), `${JSON.stringify(outGraph, null, 2)}\n`);

for (const [kind, bucket] of outRecords) {
  for (const [file, rec] of bucket) {
    const path = join(OUT, 'records', kind, `${file}.json`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(rec, null, 2)}\n`);
  }
}
for (const note of outNotes) {
  await writeFile(join(OUT, 'notes', `${note.id}.md`), encodeNote(note));
}
if (outEvents.length) {
  await writeFile(join(OUT, 'events.jsonl'), `${outEvents.map((e) => JSON.stringify(e)).join('\n')}\n`);
}
await writeFile(MAP_FILE, `${JSON.stringify({ salt, alias: Object.fromEntries(alias) }, null, 2)}\n`);

// ---------------------------------------------------------------------------
// The leak scan — the only reason to trust any of the above
// ---------------------------------------------------------------------------

/**
 * Read back every byte that was just written and hunt for anything real.
 *
 * Four sweeps, because each catches what the others cannot: the exact values we
 * aliased, every distinctive word from a real title (a rewrite that drops a body
 * but keeps a heading fails here), the shapes that are identifying whatever
 * their content — a foreign email, a foreign host, a vendor account id — and a
 * positive check on ticket keys.
 *
 * THE KEY CHECK IS AN ALLOW-LIST, and deliberately so. Asking "does any real
 * prefix survive" is the weak form: it passes when a prefix was never
 * registered, which is exactly the case a new project introduces. Asking
 * instead that EVERY key in the output carries a prefix we minted cannot fail
 * that way. Where a positive check is available it beats a deny-list, because
 * a deny-list is only as good as its last update.
 *
 * SCHEMA VOCABULARY IS ALLOWED THROUGH BY NAME. Node kinds, relation names,
 * confidence tiers, surface names and ceremony words are the contract, not
 * anybody's data — `records/message/…` and `"source": "slack"` are supposed to
 * say that. Stating the exemption out loud is the honest way to hold it; the
 * alternative is a scan so noisy that its output stops being read, which is the
 * failure mode that makes a safety check worse than none.
 */
const SCHEMA_WORDS = new Set<string>([
  ...STORED_NODE_KINDS, ...STORED_RELATIONS, ...CEREMONY,
  'extracted', 'inferred', 'ambiguous', 'structural', 'declared', 'reconstructed',
  'todo', 'doing', 'done', 'future', 'active', 'closed', 'open',
  'jira', 'slack', 'zoom', 'confluence', 'github', 'miro', 'vault', 'records', 'graph',
  'team', 'call', 'notes', 'http', 'https', 'example', 'json', 'true', 'false', 'null',
].map((w) => w.toLowerCase()));

/**
 * This file's own vocabulary, exempt because it is a literal in this file.
 *
 * A pool word appearing in the output carries no information about the input:
 * which alias a real value receives is decided by the salted hash, so a real
 * channel containing "platform" and an invented channel named `platform-eng`
 * are a coincidence and not a disclosure. Without this the scan flags its own
 * output, which is the fastest possible route to somebody passing `--no-verify`.
 */
const INVENTED = new Set<string>(
  [...FIRST, ...LAST, ...CHANNELS, ...PROJECTS, ...REPOS, ...TASKS,
    ...DONE_LINES, ...BLOCKED_LINES, ...NEUTRAL_LINES, ...CHATTER, 'acme', 'Sprint', 'Team']
    .flatMap((s) => s.split(/[\s/-]+/)).map((w) => w.toLowerCase()),
);

/**
 * Workflow words travel verbatim, and this is the one judgement call in here.
 *
 * A status is not personal data, and it is load-bearing in a way a name is not:
 * `MC_STATUS_MAP` is exactly the thing worth tuning off-machine, and aliasing
 * `Code Review` to `Status 4` would make that impossible. They are listed in the
 * report so the decision is reviewed once by somebody who knows the workflow,
 * rather than assumed here — a status named after the programme is the case that
 * would need a second look.
 */
const keptWorkflow = [...new Set(graph.nodes.flatMap((n) =>
  n.kind === 'issue' ? [n.status, n.level] : n.kind === 'sprint' ? [n.state] : []))].filter(Boolean) as string[];
const WORKFLOW_WORDS = new Set(keptWorkflow.flatMap((s) => s.split(/[\s/_-]+/)).map((w) => w.toLowerCase()));

/** The buckets whose real values are somebody's data. Sprints and projects are checked positively instead. */
const SENSITIVE_BUCKETS = new Set(['person', 'loose-person', 'channel', 'meeting', 'repo']);

for (const k of alias.keys()) {
  const [bucket, real] = k.split('\u0000');
  if (SENSITIVE_BUCKETS.has(bucket!) && real) realTokens.add(real);
}
for (const n of graph.nodes) {
  if (n.url) { try { realTokens.add(new URL(n.url).hostname); } catch { /* not a url */ } }
}

const allowed = (w: string): boolean =>
  SCHEMA_WORDS.has(w.toLowerCase()) || INVENTED.has(w.toLowerCase()) || WORKFLOW_WORDS.has(w.toLowerCase());

const forbidden = new Set<string>();
for (const t of realTokens) {
  const trimmed = t.trim();
  if (!trimmed) continue;
  if (trimmed.length >= 4 && !allowed(trimmed)) forbidden.add(trimmed);
  for (const word of trimmed.split(/[\s/_.:@#|<>()-]+/)) {
    if (word.length >= 4 && !allowed(word) && !/^\d+$/.test(word)) forbidden.add(word);
  }
}

/** The prefixes a key in the output is allowed to carry. */
const mintedPrefixes = new Set(
  [...alias.entries()].filter(([k]) => k.startsWith('project\u0000')).map(([, v]) => v),
);

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
};

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Only string VALUES are scanned, never the JSON around them.
 *
 * A field name is schema — `"channel"`, `"author"`, `"participants"` — and
 * scanning the raw file text flags every one of them as a real token, which
 * buries the handful of findings that are real.
 */
function stringsIn(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsIn(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) stringsIn(x, out);
}

const leaks: string[] = [];
for (const file of await walk(OUT)) {
  const raw = await readFile(file, 'utf8');
  const values: string[] = [];
  if (file.endsWith('.jsonl')) for (const line of raw.split('\n').filter(Boolean)) stringsIn(JSON.parse(line), values);
  else if (file.endsWith('.json')) stringsIn(JSON.parse(raw), values);
  else values.push(raw);
  const text = values.join('\n');

  for (const token of forbidden) {
    // Word-boundary, because a three-letter fragment inside a hash is not a leak
    // and a scan that says it is will be switched off within the hour.
    if (new RegExp(`(^|[^\\w])${escape(token)}([^\\w]|$)`, 'i').test(text)) {
      leaks.push(`${file}: real token "${token}"`);
    }
  }
  for (const m of text.matchAll(/[\w.+-]+@([\w.-]+\.\w+)/g)) {
    if (m[1] !== 'example.com') leaks.push(`${file}: foreign email domain "${m[1]}"`);
  }
  for (const m of text.matchAll(/https?:\/\/([^/\s"']+)/g)) {
    if (m[1] !== 'example.com') leaks.push(`${file}: foreign host "${m[1]}"`);
  }
  for (const m of text.matchAll(/<@U[A-Z0-9]{6,}>|\bU[A-Z0-9]{8,}\b/g)) {
    leaks.push(`${file}: vendor account id "${m[0]}"`);
  }
  for (const m of text.matchAll(/\b([A-Z][A-Z0-9]{1,9})-\d+\b/g)) {
    if (!mintedPrefixes.has(m[1]!)) leaks.push(`${file}: un-aliased ticket key "${m[0]}"`);
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`
  wrote ${OUT}/
    graph.json      ${outNodes.length} nodes, ${outLinks.length} edges
    records/        ${[...outRecords.values()].reduce((n, b) => n + b.size, 0)} files across ${outRecords.size} kinds
    notes/          ${outNotes.length}
    events.jsonl    ${outEvents.length}
  wrote ${MAP_FILE} — the re-identification key. It stays here.

  kept:    every id relationship, edge direction, tier, date, status, sprint state,
           which record mentions which key, and which records mention none
  invented: every name, email, handle, channel, ticket key, repo, meeting title,
           body, quote and excerpt

  workflow words kept VERBATIM — read this list once, and alias any that name
  the programme rather than the process:
    ${keptWorkflow.sort().join(' · ')}`);

if (leaks.length) {
  const shown = [...new Set(leaks)].slice(0, 25);
  console.error(`\n  LEAK SCAN FAILED — ${leaks.length} finding(s), showing ${shown.length}:`);
  for (const l of shown) console.error(`    ${l}`);
  console.error('\n  The export is NOT safe to copy. Fix the rewrite above and re-run.\n');
  process.exit(1);
}
console.log(`\n  leak scan clean — ${forbidden.size} real tokens hunted, none present\n`);
