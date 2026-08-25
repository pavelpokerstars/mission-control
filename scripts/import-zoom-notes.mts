/**
 * Read `zoom-local-sync`'s browser captures and write our graph fragment.
 *
 * WHAT THIS IS THE OTHER HALF OF. `zoom-local-sync` (the graph author's tool) captures
 * Zoom **Docs notes** through a logged-in browser profile, because the
 * organisation blocks the recording API. Each capture is a folder holding
 * `page.txt` — the note's visible text — and `capture.json`, its metadata. That
 * is a pile of prose on a disk; this turns it into `meeting` nodes and
 * `records/meeting/*.json` that `MC_GRAPH_DIR` can read.
 *
 *   npx tsx scripts/import-zoom-notes.mts \
 *     --in  ~/Library/Application\ Support/zoom-local-sync/data/browser-captures \
 *     --out ./live-graph            # merges into a graph that is already there
 *
 * NOT A SCRAPER, DELIBERATELY. `GRAPH-SCHEMA.md` puts the seam between "reads a
 * source" and "reasons about one", and everything on this side of it is
 * offline: files in, files out, no browser, no credentials, no network. That is
 * what lets `verify-collector.mts` be pointed at the result. The same split
 * `import-programme-graph.mts` keeps.
 *
 * WHAT A NOTE IS NOT. It is not a transcript. There are no speakers and no time
 * offsets on this path — `browser.py` never touches a recording — so the record
 * carries `body` rather than `segments`, `annotateTranscript` derives paragraph
 * segments from it, and a citation opens the note at a LINE rather than at a
 * moment. `GRAPH-SCHEMA.md` §10 says why that is the honest shape and not a
 * shortcut: an offset we do not have cannot be invented, and a room on one
 * microphone has no speaker to attribute anyway.
 *
 * MERGES RATHER THAN OVERWRITES. Jira comes from `programme_graph` and Zoom
 * comes from here, so the second to run must not delete the first. It reads an
 * existing `graph.json`, removes only the nodes carrying its own `collector`
 * marker, and adds its own — idempotent, and it never doubles a meeting.
 *
 * The marker is not decoration. Matching on the `meeting:zoom/` id prefix
 * instead deleted three real recordings written by another collector and left
 * two notes in their place: 70 nodes → 69, a still-valid graph, and nothing
 * failed. A merge that cannot identify its own output is an overwrite with
 * extra steps.
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

/** Stamped on every node this writes, so a re-run replaces its own and nothing else. */
const COLLECTOR = 'import-zoom-notes';

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
      '  npx tsx scripts/import-zoom-notes.mts --in <browser-captures dir> --out <graph dir>\n' +
      '\n' +
      '  --in    where zoom-local-sync wrote its captures. Each child folder holds\n' +
      '          page.txt and capture.json.\n' +
      '  --out   a graph directory. An existing graph.json is merged into, not\n' +
      '          replaced, so this can run after import-programme-graph.mts.',
  );
  process.exit(2);
}

interface CaptureManifest {
  captured_at?: string;
  requested_url?: string;
  final_url?: string;
  title?: string;
  /**
   * The STABLE Zoom document id, and the reason this interface grew.
   *
   * `capture-zoom-notes.mts` has always written it; this file did not declare
   * it and therefore never read it, so the meeting id was built from the
   * folder name — which carries the note's *current, editable* title. Renaming
   * a note in Zoom then produced a second meeting for one document.
   */
  document_id?: string;
  /** The note's own last-changed time, from Hub's recent-files list. */
  updated_at?: string;
}

/**
 * A date that does not exist is worse than no date.
 *
 * `feb-31-2026` matches the shape and produces `2026-02-31T00:00:00.000Z`, which
 * is an **unparseable** timestamp — `Date.parse` returns NaN, silently, and
 * everything downstream that sorts the trail or ages a finding reads it. So the
 * parts are round-tripped through `Date` and rejected if they do not survive,
 * which also catches month 13 and day 0.
 */
function isoIfReal(y: string, m: string, d: string): string | undefined {
  const stamp = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00.000Z`;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Date rolls 2026-02-31 forward to 2026-03-03 rather than failing, so compare
  // the components back rather than trusting that it parsed.
  return parsed.toISOString().slice(0, 10) === stamp.slice(0, 10) ? stamp : undefined;
}

/**
 * A Zoom note's title carries its date more often than its metadata does.
 *
 * `capture.json` records `captured_at` — when the *scrape* ran, which is today
 * for every note in the folder and says nothing about when the meeting was. A
 * finding stamped with the scrape time would claim every meeting happened this
 * morning, and `firedAt`, the trail's ordering and "before the ticket existed"
 * all read that date. Zoom titles its notes like "Sprint planning - 2026-08-12"
 * or "Standup — Aug 12, 2026", so the title is tried first and the capture time
 * is the last resort.
 */
function meetingDate(title: string, capturedAt: string | undefined): string {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(title);
  const isoReal = iso && isoIfReal(iso[1]!, iso[2]!, iso[3]!);
  if (isoReal) return isoReal;

  /**
   * The named-month branch reads a FOLDER as readily as a title, and used not
   * to.
   *
   * It required `[A-Z][a-z]{2,8}` followed by whitespace — which a title
   * satisfies and a folder never can, because a folder slug is lowercased and
   * separated by `-`. So the one input this whole fallback exists for, a
   * capture with no `capture.json`, could not match it: measured,
   * `standup-aug-12-2026_def456` fell through to `new Date()` and stamped a
   * meeting from the twelfth with the day the scraper ran. `startedAt` orders
   * the trail, decides which of two claims is newer and drives the "before the
   * ticket existed" badge, so that is a false claim rather than a blank.
   *
   * Every match is tried rather than only the first, because the first
   * word-then-number pair in a name is routinely not a date — `sprint-14-2026`
   * matches the shape and is not a month, and stopping there would throw away
   * the real date later in the same string.
   */
  const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  for (const named of title.matchAll(
    // `(?!\d)` and not `\b` after the year: a folder is `…-2026_def456`, and `_`
    // is a word character, so `\b` never holds there — which meant this branch
    // could not match the one input the whole fallback exists for.
    /\b([A-Za-z]{3,9})[\s-]+(\d{1,2})(?:st|nd|rd|th)?[,\s-]+(\d{4})(?!\d)/g,
  )) {
    const m = MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase());
    if (m < 0) continue;
    const real = isoIfReal(named[3]!, String(m + 1), named[2]!);
    if (real) return real;
  }
  return capturedAt ?? new Date().toISOString();
}

/** `Zoom Doc - Sprint planning` → `sprint-planning`, stable across re-runs. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'note'
  );
}

/**
 * The node id for one document — and `slug(docId)` alone was not safe as one.
 *
 * `slug` lowercases, collapses punctuation and truncates, so it is LOSSY for
 * any id that is not already short and lowercase-alphanumeric. Measured: the
 * document ids `aB7xQ` and `Ab7Xq` — two different meetings, different titles,
 * different bodies — both produced `meeting:zoom/ab7xq`, and the second meeting
 * was absent from `graph.json` and from `records/` with nothing failing. A
 * silently lost meeting is the worst shape this can take.
 *
 * Preserving the vendor's case in the id would not fix it either: the record is
 * written to `records/meeting/<id>.json`, and macOS is case-insensitive by
 * default, so the two files would still be one. So the id stays case-folded and
 * gains six characters of the raw id's digest **only when the fold lost
 * something** — an id that is already safe is its own id, which is the shape
 * `GRAPH-SCHEMA.md` §3 documents, and a lossy one is disambiguated
 * deterministically rather than merged.
 */
function noteId(docId: string): string {
  const base = slug(docId).slice(0, 40);
  if (base === docId) return base;
  return `${base}-${createHash('sha1').update(docId).digest('hex').slice(0, 6)}`;
}

/**
 * Zoom Docs pages carry chrome around the note — the sidebar, the toolbar, the
 * comment rail — and `page.txt` is the whole `body.innerText`, so it arrives
 * with all of it. Left in, every note joins on whatever ticket key happens to
 * sit in a navigation item, and the body a person reads is mostly furniture.
 *
 * This is deliberately a floor rather than a parser: drop the runs of very
 * short lines that navigation produces, keep everything else. A real note's
 * prose survives; some chrome will too. Over-trimming would lose the sentence
 * the whole capture exists for, so it errs the other way.
 */
function stripChrome(text: string, title?: string): string {
  let lines = text.split('\n').map((l) => l.trimEnd());

  /**
   * Everything above the title is navigation.
   *
   * The one general rule available, and it uses real metadata rather than a
   * guess: `capture.json` records the page title, Zoom renders it as a heading,
   * and a sidebar sits above it. Anchoring there drops "Home / Docs / Search"
   * without a list of chrome strings that would be wrong the day Zoom renames a
   * menu — and if the title is not found, nothing is dropped.
   */
  if (title) {
    const at = lines.findIndex((l) => l.trim() === title.trim());
    if (at > 0) lines = lines.slice(at);
  }

  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    // A line with no sentence in it, repeated, is a menu.
    if (t.length < 3) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------

const folders = (await readdir(inDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

interface Note {
  id: string;
  topic: string;
  startedAt: string;
  body: string;
  url?: string;
}

const notes: Note[] = [];
const skipped: string[] = [];

for (const folder of folders) {
  const dir = join(inDir, folder);
  const textPath = join(dir, 'page.txt');
  if (!existsSync(textPath)) {
    skipped.push(`${folder} — no page.txt`);
    continue;
  }

  let manifest: CaptureManifest = {};
  try {
    manifest = JSON.parse(await readFile(join(dir, 'capture.json'), 'utf8')) as CaptureManifest;
  } catch {
    /* metadata is a bonus; the text is the point */
  }

  const body = stripChrome(await readFile(textPath, 'utf8'), manifest.title);
  if (body.length < 40) {
    // A capture that produced nothing readable is usually a session that had
    // logged out — the page renders a sign-in screen and captures cleanly.
    skipped.push(`${folder} — ${body.length} chars, probably a login page`);
    continue;
  }

  /**
   * The document id, and NOTHING derived from the title.
   *
   * The comment here used to claim the id was "the stable half" while the id
   * built below was `slug(title)-slug(docId)` — so renaming a note in Zoom
   * produced a *second* meeting for one document, both carrying its body, and
   * every stored citation to the old id dangled. `GRAPH-SCHEMA.md` §3's
   * determinism rule is the whole point: an id that moves makes every refresh
   * report everything as new.
   *
   * `capture.json` carries `document_id`; the folder suffix is the fallback for
   * a capture written by `zoom-local-sync`, whose folders are the same shape.
   */
  const docId =
    manifest.document_id?.trim() ||
    (folder.includes('_') ? folder.slice(folder.lastIndexOf('_') + 1) : folder);
  const title = manifest.title?.trim() || folder.replace(/_[^_]*$/, '').replace(/-/g, ' ');

  notes.push({
    id: noteId(docId),
    topic: title,
    /**
     * The date is looked for in the RAW folder name as well as the title.
     *
     * The title fallback replaces `-` with a space, which destroys the exact
     * separator `meetingDate`'s ISO regex needs — so a capture missing its
     * `capture.json` (page.txt is written first, so an interrupted run leaves
     * exactly that) fell through to `new Date()` and stamped the meeting today.
     * `startedAt` orders the trail and drives the "before the ticket existed"
     * badge, so today's date on a July meeting is a false claim, not a blank.
     *
     * `updated_at` is the note's own timestamp and is a better last resort than
     * when the scraper happened to run.
     */
    startedAt: meetingDate(`${title} ${folder}`, manifest.updated_at ?? manifest.captured_at),
    body,
    ...(manifest.final_url ?? manifest.requested_url
      ? { url: (manifest.final_url ?? manifest.requested_url)! }
      : {}),
  });
}

if (!notes.length) {
  console.error(`No usable captures in ${inDir}.`);
  for (const s of skipped) console.error(`  skipped ${s}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

await mkdir(join(outDir, 'records', 'meeting'), { recursive: true });

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
  /**
   * Ours, and only ours — matched on a MARKER, not on the id prefix.
   *
   * The first version dropped every `meeting:zoom/*` node on the grounds that
   * Zoom meetings are this script's business. They are not: a different Zoom
   * collector writes the same prefix, and pointed at a graph that already had
   * three real recordings it **deleted them** and left two notes in their
   * place. Nodes went 70 → 69 and nothing failed — the graph was still valid,
   * just missing three meetings.
   *
   * So every node this writes carries `collector`, and only nodes carrying
   * exactly ours are removed. A merge that cannot identify its own output is
   * not a merge, it is an overwrite with extra steps.
   */
  const before = graph.nodes.length;
  graph.nodes = graph.nodes.filter((n) => n.collector !== COLLECTOR);
  const ours = new Set(
    graph.nodes.filter((n) => n.collector === COLLECTOR).map((n) => String(n.id)),
  );
  graph.links = graph.links.filter(
    (l) => !ours.has(String(l.source ?? '')) && !ours.has(String(l.target ?? '')),
  );
  if (before !== graph.nodes.length) {
    console.log(`replacing ${before - graph.nodes.length} note(s) from a previous run`);
  }
}

const taken = new Set(graph.nodes.map((n) => String(n.id)));
/**
 * What the graph held BEFORE this run's loop, which is the only way to tell the
 * two collisions apart.
 *
 * `taken` grows as we go, so once the loop has run a member of it may be either
 * somebody else's node or one we just wrote — and the report used to call both
 * "already in this graph from another collector". Measured against an EMPTY
 * output directory, where no other collector can possibly have written
 * anything: two folders capturing one document printed that sentence about a
 * graph nothing else had ever touched. Two different problems with two
 * different fixes — one is a collector boundary, the other is a duplicate
 * capture on this disk — and a reader told the wrong one looks in the wrong
 * place.
 */
const foreign = new Set(taken);
const skippedForeign: string[] = [];
const skippedDuplicate: string[] = [];
/** Only what this run actually added, so the closing list cannot name a note it did not write. */
const written: typeof notes = [];

for (const n of notes) {
  /**
   * Another collector already wrote this meeting. Skip rather than duplicate.
   *
   * The merge removes nodes carrying OUR marker, which makes a re-run
   * idempotent and says nothing about somebody else's node. Adding ours beside
   * it is a duplicate id, which `verify-collector` rejects outright — and
   * overwriting would be the opposite failure, discarding a collector's output
   * because ours ran second. Caught in the Confluence emitter first, where the
   * ids collide far more readily.
   */
  if (taken.has(`meeting:zoom/${n.id}`)) {
    (foreign.has(`meeting:zoom/${n.id}`) ? skippedForeign : skippedDuplicate).push(
      `${n.id} — ${n.topic}`,
    );
    continue;
  }
  /**
   * Grow as we go, and note that this only started mattering once the id
   * became stable.
   *
   * Before, the id carried the title, so two folders for one renamed document
   * produced two *different* ids — the bug. Keying on `document_id` fixed that
   * and turned the same input into a genuine collision, which this set has to
   * see. Capturing one document twice is now one meeting, which is the point.
   */
  taken.add(`meeting:zoom/${n.id}`);
  written.push(n);

  graph.nodes.push({
    id: `meeting:zoom/${n.id}`,
    kind: 'meeting',
    source: 'zoom',
    collector: COLLECTOR,
    label: n.topic,
    recordRef: `records/meeting/${n.id}.json`,
    ...(n.url ? { url: n.url } : {}),
  });

  await writeFile(
    join(outDir, 'records', 'meeting', `${n.id}.json`),
    `${JSON.stringify(
      {
        id: n.id,
        topic: n.topic,
        startedAt: n.startedAt,
        /**
         * Empty, and not guessed. Zoom Docs name people in the prose — "Riya to
         * draft the ADR" — but a name in a sentence is not a participant list,
         * and `buildIdentities` would resolve invented handles into the trail.
         */
        participants: [],
        body: n.body,
      },
      null,
      2,
    )}\n`,
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
  sources: [...new Set([...((graph.graph?.sources as string[]) ?? []), 'zoom'])],
  zoomNotesImportedAt: new Date().toISOString(),
};
await writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');

if (skippedForeign.length) {
  console.log(
    `\n  ${skippedForeign.length} meeting(s) already in this graph from another collector, left alone:`,
  );
  for (const c of skippedForeign) console.log(`    ${c}`);
}

if (skippedDuplicate.length) {
  console.log(
    `\n  ${skippedDuplicate.length} capture(s) of a document this run already imported, skipped:`,
  );
  for (const c of skippedDuplicate) console.log(`    ${c}`);
  console.log('    (two folders for one Zoom document — a rename, or a second sync tool)');
}

console.log(`${merged ? 'merged into' : 'wrote'} ${graphPath}`);
console.log(`  ${written.length} note(s) written, ${graph.nodes.length} node(s) total`);
for (const n of written) console.log(`    ${n.startedAt.slice(0, 10)}  ${n.topic}`);
if (skipped.length) {
  console.log(`\n  ${skipped.length} skipped:`);
  for (const s of skipped) console.log(`    ${s}`);
}

console.log(
  `\nNext:\n  npx tsx scripts/verify-collector.mts ${outDir}\n` +
    `  MC_GRAPH_DIR=${outDir} npm run dev\n` +
    `\nThese notes have no speakers and no offsets — see GRAPH-SCHEMA.md §10.\n` +
    `A citation opens one at a line, not at a moment.`,
);
