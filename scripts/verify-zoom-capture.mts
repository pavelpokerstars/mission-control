/**
 * Drive the REAL Zoom capture against a fake Hub, with no credential.
 *
 *   npx tsx scripts/verify-zoom-capture.mts
 *
 * WHY THIS EXISTS. `capture-zoom-notes.mts` is the one collector whose input is
 * a logged-in browser, so everything about it was unverifiable-by-anyone except
 * the person holding the session — and `ROADMAP.md` claimed it was "verified
 * against a fake Hub" on the strength of a harness that was never committed. A
 * claim nobody can re-run is prose. This is the same trick `verify-providers.mts`
 * plays on the model: **only the far end is fake.** The script under test is the
 * shipped one, launched as a child process, driving real Chrome through real
 * Playwright against a real HTTP server. What is invented is Zoom.
 *
 * WHAT IT CANNOT TELL YOU. Zoom's own DOM and its real payload shape. The field
 * names below — `file.fileLink`, `file.fileType`, `file.updatedInfo.time`, with
 * `item.fileLink` / `item.lastOperatedTime` as fallbacks — came from the graph author's
 * `browser.py` reading the real thing, not from us; if Zoom moves them this
 * passes and the real run does not. `--log-api` on the first real run is what
 * settles that, by keeping the actual payload to diff against this fixture.
 *
 * NOT IN `npm run verify`, deliberately. That command promises "no credentials,
 * no network, no server" and this starts a server and a browser. It is a named
 * command, like `verify-providers.mts`.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = join(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = join(HERE, '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
}

/**
 * The most informative lines of a child's output, not the last three.
 *
 * A crashing Node child ends with `}`, a blank line and `Node.js v26.7.0`, so
 * `slice(-3)` reported exactly the three lines carrying no information — the
 * failure detail read `} /  / Node.js v26.7.0`. Reproduced by pointing the
 * capture at a Chrome channel that is not installed, which is precisely the
 * machine this harness would be run on to diagnose something.
 */
function why(out: string): string {
  const lines = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^Node\.js v/.test(l) && !/^[}\])]+$/.test(l) && !/^\s*at /.test(l));
  const loud = lines.filter((l) => /error|failed|cannot|could not|refus|ENOENT|not found|✗/i.test(l));
  return (loud.length ? loud : lines).slice(-3).join(' / ') || '(no output)';
}

/** `readdir` on a directory the capture never created throws ENOENT and kills the run. */
async function captured(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((d) => !d.startsWith('_') && !d.startsWith('.'));
}

// ---------------------------------------------------------------------------
// The fake Hub.
//
// Two notes and one whiteboard. The whiteboard is not decoration: `recentFrom`
// filters on `fileType === 'doc'`, and a whiteboard captured as text is a page
// of nothing — so "it was filtered" is a real assertion rather than a count.

interface FakeNote {
  id: string;
  title: string;
  updatedAt: string;
  body: string;
}

const NOTES: FakeNote[] = [
  {
    id: 'aB7xQdoc1',
    title: 'Sprint planning - 2026-08-12',
    updatedAt: '2026-08-12T11:04:00.000Z',
    body:
      'Quick recap\n\nThe team walked the sprint. PAY-9031 is still waiting on the ' +
      'provider sandbox and nobody has written down why.\n\nNext steps\n\nPlatform to ' +
      'provide the Kafka topic. Sanjay owns it — his team said the twelfth at the latest.',
  },
  {
    id: 'zz9docTWO',
    title: 'Retro — Aug 14, 2026',
    updatedAt: '2026-08-14T16:20:00.000Z',
    body:
      'What went well\n\nThe dedupe cache landed. PAY-9012 closed on Thursday.\n\n' +
      'What did not\n\nWe agreed in June to write the cache decision down as a pattern ' +
      'and it is still only in this document.',
  },
];

/** Serving the note under a title that is not its `page.txt` heading is the point of `stripChrome`. */
function notePage(n: FakeNote): string {
  return (
    `<!doctype html><html><head><title>${n.title}</title></head><body>` +
    `<nav>Zoom&nbsp;Docs</nav><aside>Comments</aside>` +
    `<main><h1>${n.title}</h1><pre>${n.body}</pre></main>` +
    `</body></html>`
  );
}

function recentPayload(origin: string, notes: FakeNote[]): unknown {
  return {
    recentFiles: [
      ...notes.map((n) => ({
        file: {
          id: n.id,
          title: n.title,
          fileLink: `${origin}/doc/${n.id}`,
          fileType: 'doc',
          updatedInfo: { time: n.updatedAt },
        },
      })),
      {
        // Must be dropped: `fileType` is not `doc`.
        file: {
          id: 'wb-001',
          title: 'Architecture whiteboard',
          fileLink: `${origin}/doc/wb-001`,
          fileType: 'whiteboard',
          updatedInfo: { time: '2026-08-15T09:00:00.000Z' },
        },
      },
      {
        // Must be dropped: a real `doc`, but outside --doc-prefix. This is the
        // filter that stops a stray link in the recent list being fetched.
        file: {
          id: 'elsewhere-1',
          title: 'A doc on another host',
          fileLink: 'https://example.invalid/doc/elsewhere-1',
          fileType: 'doc',
          updatedInfo: { time: '2026-08-15T09:00:00.000Z' },
        },
      },
    ],
  };
}

/** Titles are edited in Zoom; `state` is how the rename case is driven mid-run. */
const state: { notes: FakeNote[] } = { notes: NOTES.map((n) => ({ ...n })) };

async function startHub(): Promise<{ origin: string; stop: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    if (url.pathname === '/api/file/recent') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(recentPayload(origin, state.notes)));
      return;
    }
    if (url.pathname.startsWith('/doc/')) {
      const id = url.pathname.slice('/doc/'.length);
      const note = state.notes.find((n) => n.id === id);
      res.writeHead(note ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(note ? notePage(note) : '<!doctype html><html><body>not found</body></html>');
      return;
    }
    if (url.pathname === '/wc/home') {
      // Hub asks for the recent list on load, which is the path the capture's
      // `ctx.on('response')` listener watches. Doing it from the page rather
      // than inlining the JSON is what makes this exercise that listener.
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><head><title>Hub</title></head><body><div id=r>loading</div>` +
          `<script>fetch('/api/file/recent').then(r=>r.json())` +
          `.then(j=>{document.getElementById('r').textContent=j.recentFiles.length+' files'})</script>` +
          `</body></html>`,
      );
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ---------------------------------------------------------------------------

interface Run {
  code: number | null;
  out: string;
}

function run(script: string, args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', join(ROOT, 'scripts', script), ...args], {
      cwd: ROOT,
      env: process.env,
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// ---------------------------------------------------------------------------

const scratch = await mkdtemp(join(tmpdir(), 'mc-zoom-'));
const PROFILE = join(scratch, 'profile');
const OUT = join(scratch, 'captures');
const GRAPH = join(scratch, 'graph');

// The capture refuses to run without a session, and a profile directory IS the
// session as far as that guard is concerned. Chrome fills the rest in.
await mkdir(join(PROFILE, 'Default'), { recursive: true });

const hub = await startHub();
const captureArgs = [
  '--hub',
  `${hub.origin}/wc/home`,
  '--doc-prefix',
  `${hub.origin}/doc/`,
  '--profile',
  PROFILE,
  '--out',
  OUT,
  '--wait',
  '250',
  '--timeout',
  '20000',
];

console.log('\nzoom capture — the real script, a fake Hub\n');

try {
  // -- the flag surface, which must not need a browser --------------------
  //
  // "Opens no browser" is asserted rather than assumed: Chrome writes into the
  // profile the moment it launches (`Local State`, `SingletonLock`, and more
  // under `Default/`), so an unchanged profile listing is direct evidence. Exit
  // 0 alone would pass even if --help launched Chrome and then exited cleanly,
  // which is the mutation this check exists to catch.
  const profileBefore = JSON.stringify(await readdir(PROFILE));
  const help = await run('capture-zoom-notes.mts', ['--help', '--profile', PROFILE]);
  const profileAfter = JSON.stringify(await readdir(PROFILE));
  check('--help prints usage and exits 0', help.code === 0 && /--doc-prefix/.test(help.out), `exit=${help.code} ${why(help.out)}`);
  check('--help opens no browser (the profile is untouched)', profileBefore === profileAfter, `${profileBefore} -> ${profileAfter}`);
  check('--help lists every flag the script parses', ['--login', '--headed', '--log-api', '--limit', '--hub', '--doc-prefix', '--profile', '--out', '--wait', '--timeout'].every((f) => help.out.includes(f)), 'a flag is parsed but undocumented');

  // -- first run ----------------------------------------------------------
  const first = await run('capture-zoom-notes.mts', captureArgs);
  check('the capture completes against a fake Hub', first.code === 0, why(first.out));

  const dirs = await captured(OUT);
  check('both notes captured, the whiteboard and the off-prefix doc dropped', dirs.length === 2, `got ${dirs.length}: ${dirs.join(', ')}`);
  check(
    'the folder is <title-slug>_<document id>',
    dirs.includes('sprint-planning-2026-08-12_aB7xQdoc1'),
    dirs.join(', '),
  );

  const capPath = join(OUT, 'sprint-planning-2026-08-12_aB7xQdoc1', 'capture.json');
  const cap = existsSync(capPath)
    ? (JSON.parse(await readFile(capPath, 'utf8')) as Record<string, string>)
    : {};
  check('capture.json carries the document id, not the title', cap.document_id === 'aB7xQdoc1', String(cap.document_id));
  check("capture.json carries the note's own updated_at", cap.updated_at === '2026-08-12T11:04:00.000Z', String(cap.updated_at));
  const text = existsSync(join(OUT, 'sprint-planning-2026-08-12_aB7xQdoc1', 'page.txt'))
    ? await readFile(join(OUT, 'sprint-planning-2026-08-12_aB7xQdoc1', 'page.txt'), 'utf8')
    : '';
  check('page.txt holds the note body', /Kafka topic/.test(text), `${text.length} chars`);

  // -- the incremental index ----------------------------------------------
  //
  // The whole cost argument rests on this: a note whose updatedAt has not moved
  // is not opened at all, so a steady-state run is one Hub load and zero note
  // loads. If this regresses, every run pays for every note and nothing fails.
  const second = await run('capture-zoom-notes.mts', captureArgs);
  check('a re-run opens no note at all', /0 captured, 2 unchanged/.test(second.out), second.out.match(/\d+ captured, \d+ unchanged/)?.[0] ?? 'no summary line');

  // -- a rename moves the folder rather than doubling it -------------------
  //
  // The folder carries the title and the title is editable, so a rename in Zoom
  // captures into a NEW folder while the old one stays on disk with a valid
  // page.txt — and the importer walks every folder, so one document arrives as
  // two meetings.
  state.notes[0]!.title = 'Sprint planning renamed - 2026-08-12';
  state.notes[0]!.updatedAt = '2026-08-16T09:00:00.000Z';
  const third = await run('capture-zoom-notes.mts', captureArgs);
  const afterRename = await captured(OUT);
  check('a renamed note moves its folder rather than doubling it', afterRename.length === 2, `${afterRename.length}: ${afterRename.join(', ')}`);
  check('the old folder is gone', !afterRename.includes('sprint-planning-2026-08-12_aB7xQdoc1'), afterRename.join(', '));
  check('the move is reported', /moved /.test(third.out), why(third.out));

  // -- and the other half: the captures import and conform -----------------
  const imported = await run('import-zoom-notes.mts', ['--in', OUT, '--out', GRAPH]);
  check('the captures import into a graph', imported.code === 0, why(imported.out));

  const graph = existsSync(join(GRAPH, 'graph.json'))
    ? (JSON.parse(await readFile(join(GRAPH, 'graph.json'), 'utf8')) as {
        nodes: { id: string; label?: string }[];
      })
    : { nodes: [] };
  const meetings = graph.nodes.filter((n) => String(n.id).startsWith('meeting:zoom/'));
  check('two meetings, one per document', meetings.length === 2, meetings.map((m) => m.id).join(', '));
  // Derived from the document id, never asserted as a literal: the id function
  // disambiguates a lossy case-fold with a digest, and pinning the digest here
  // would make this test a copy of the implementation rather than a claim about
  // it. What matters is that a title cannot reach the id — a title is editable,
  // and an id that moves makes every refresh report everything as new.
  check(
    'the meeting id is derived from the document id',
    meetings.every((m) => /^meeting:zoom\/(zz9doctwo|ab7xqdoc1)(-[0-9a-f]{6})?$/.test(m.id)),
    meetings.map((m) => m.id).join(', '),
  );
  check(
    'no meeting id carries a word from a title',
    !meetings.some((m) => /sprint|planning|retro|renamed/i.test(m.id)),
    meetings.map((m) => m.id).join(', '),
  );
  check(
    'a renamed note is still ONE meeting, under its new label',
    meetings.some((m) => /renamed/i.test(m.label ?? '')),
    meetings.map((m) => m.label).join(' | '),
  );

  // -- the DATE, which is the whole point of the meetingDate fallback -------
  //
  // Nothing here asserted a date until this was added, so the one defect that
  // silently stamps every meeting with the day the scraper ran — the failure
  // `meetingDate` exists to prevent — was entirely uncovered. The title carries
  // `2026-08-12`; if a record says today, the fallback has regressed.
  const recDir = join(GRAPH, 'records', 'meeting');
  const recs = existsSync(recDir) ? await readdir(recDir) : [];
  const dates: string[] = [];
  for (const r of recs) {
    const rec = JSON.parse(await readFile(join(recDir, r), 'utf8')) as { startedAt?: string };
    if (rec.startedAt) dates.push(rec.startedAt.slice(0, 10));
  }
  check(
    'the meeting date is read from the note, not the day the capture ran',
    dates.includes('2026-08-12') && dates.includes('2026-08-14'),
    dates.join(', ') || 'no startedAt on any record',
  );
  check(
    'no record is stamped with today',
    !dates.includes(new Date().toISOString().slice(0, 10)),
    dates.join(', '),
  );

  // -- the collision report, which the happy path never reaches -------------
  //
  // Two folders for ONE document is the realistic input (zoom-local-sync has no
  // equivalent of the index-driven folder move), and the importer must call that
  // a duplicate capture rather than blaming "another collector" — a reader told
  // the wrong one looks in the wrong place. Neither branch of that split was
  // exercised until this ran.
  const dupIn = join(scratch, 'dup');
  const src = (await captured(OUT))[0]!;
  await mkdir(join(dupIn, 'a-copy_zz9docTWO'), { recursive: true });
  await mkdir(join(dupIn, 'b-copy_zz9docTWO'), { recursive: true });
  for (const d of ['a-copy_zz9docTWO', 'b-copy_zz9docTWO']) {
    await writeFile(join(dupIn, d, 'page.txt'), await readFile(join(OUT, src, 'page.txt'), 'utf8'), 'utf8');
    await writeFile(
      join(dupIn, d, 'capture.json'),
      JSON.stringify({ title: `Copy ${d}`, document_id: 'zz9docTWO', updated_at: '2026-08-14T16:20:00.000Z' }),
      'utf8',
    );
  }
  const dup = await run('import-zoom-notes.mts', ['--in', dupIn, '--out', join(scratch, 'dupgraph')]);
  check(
    'two folders for one document are reported as a duplicate capture',
    /already imported/.test(dup.out) && !/another collector/.test(dup.out),
    why(dup.out),
  );
  check('and only the note it actually wrote is listed', /1 note\(s\) written/.test(dup.out), why(dup.out));

  const verified = await run('verify-collector.mts', [GRAPH]);
  check('the result satisfies GRAPH-SCHEMA.md', verified.code === 0, why(verified.out));
} finally {
  await hub.stop();
  await rm(scratch, { recursive: true, force: true });
}

console.log(
  failures
    ? `\n${failures} check(s) FAILED\n`
    : '\nall checks passed — the capture works against everything except Zoom itself.\n' +
        'What stays unverified is Zoom\'s own DOM and payload shape; --log-api on the\n' +
        'first real run is what settles that.\n',
);
process.exit(failures ? 1 : 0);
