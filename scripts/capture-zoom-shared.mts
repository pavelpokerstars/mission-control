/**
 * Capture Zoom meeting notes through the logged-in browser profile.
 *
 * WHY A SECOND CAPTURE SCRIPT. `capture-zoom-notes.mts` reads Zoom **Hub**
 * (`app.zoom.us/wc/home` → `/api/file/recent`). A tenant using **My Notes**
 * (`mynotes.zoom.us`) serves a different app on a regional docs cluster, and
 * its `recent` list is empty even when the account has hundreds of meetings —
 * so that script correctly reported "could not read the recent-files payload"
 * and stopped. Measured on this account: `recent` → 0, `shared` → the whole
 * history.
 *
 *   npx tsx scripts/capture-zoom-notes.mts --login --hub https://mynotes.zoom.us/home
 *   npx tsx scripts/capture-zoom-shared.mts --limit 50
 *   npx tsx scripts/import-zoom-notes.mts --in ~/.mission-control/zoom-captures --out ./live-graph
 *
 * IT WRITES THE LAYOUT `import-zoom-notes.mts` ALREADY READS — a directory per
 * note holding `page.txt` and `capture.json` — so the importer, its id rules and
 * its incremental behaviour are all reused rather than rewritten.
 *
 * THE SESSION IS THE PROFILE. No token, no cookie, nothing to store or leak:
 * `--login` on the other script opens a real window once, and the profile
 * directory keeps it. Never pass a cookie to anyone, including this.
 *
 * IT REPLAYS THE APP'S OWN REQUEST rather than composing one. An in-page
 * `fetch(..., {credentials:'include'})` to the same URL returns an empty list:
 * the docs cluster wants headers the app sets and a bare cookie is not enough.
 * So the tab is opened, its own call is intercepted, and its headers are reused
 * for the pages after the first. Guessing at the header set is how this breaks
 * silently the next time Zoom changes it.
 */

import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const HOME = opt('hub') ?? 'https://mynotes.zoom.us/home';
const PROFILE = opt('profile') ?? join(homedir(), '.mission-control', 'zoom-profile');
const OUT = opt('out') ?? join(homedir(), '.mission-control', 'zoom-captures');
const LIMIT = Math.max(1, Number(opt('limit') ?? 50));
const WAIT_MS = Number(opt('wait') ?? 3_000);
const TIMEOUT_MS = Number(opt('timeout') ?? 60_000);
/** `shared` is the tab meeting notes arrive in when somebody else ran the call. */
const TABS = (opt('tabs') ?? 'shared,my_notes,recent').split(',').map((s) => s.trim());

if (has('help')) {
  console.log(
    'Capture Zoom My Notes meeting notes through a logged-in browser profile.\n\n' +
      '  npx tsx scripts/capture-zoom-notes.mts --login --hub https://mynotes.zoom.us/home\n' +
      '  npx tsx scripts/capture-zoom-shared.mts --limit 50\n\n' +
      'The profile IS the credential — no token is stored and none is needed.\n' +
      'CLOSE THE --login WINDOW FIRST: Chrome refuses to open one profile twice.\n\n' +
      '  --limit <n>      how many notes to capture              (default 50)\n' +
      `  --tabs <list>    which lists to read       (default ${TABS.join(',')})\n` +
      '  --hub <url>      the My Notes home page\n' +
      '  --profile <dir>  the browser profile holding the session\n' +
      '  --out <dir>      where captures are written\n' +
      '  --headed         show the window, for debugging\n' +
      '  --wait <ms>      settle time after a note loads         (default 3000)\n',
  );
  process.exit(0);
}

const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

/** A folder name that is stable across a rename — `<title-slug>_<document id>`. */
const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'note';

interface NoteRef {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  author?: string;
}

// ---------------------------------------------------------------------------

await mkdir(OUT, { recursive: true });

let ctx: BrowserContext;
try {
  ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: !has('headed'),
    viewport: { width: 1440, height: 900 },
  });
} catch (e) {
  const msg = String(e);
  // The single most likely failure, and Playwright buries it in 30 lines of log.
  if (msg.includes('SingletonLock') || msg.includes('ProcessSingleton')) {
    fail(
      'That profile is already open in another Chrome.\n' +
        'The --login window is still running: close it, then run this again.\n' +
        'Chrome refuses to open one profile twice, to avoid corrupting it.',
    );
  }
  fail(`Could not start Chrome: ${msg.slice(0, 300)}`);
  throw e;
}

const page: Page = ctx.pages()[0] ?? (await ctx.newPage());

/** The app's own call, captured so its headers and cluster host can be reused. */
let seen: { url: string; headers: Record<string, string> } | undefined;
const collected = new Map<string, NoteRef>();

function absorb(body: unknown): void {
  const list = (body as { notesList?: Record<string, unknown>[] })?.notesList ?? [];
  for (const n of list) {
    const f = (n.file ?? n) as Record<string, unknown>;
    const id = String(f.id ?? '');
    if (!id || f.isDeleted === true) continue;
    const created = f.createdInfo as { user?: { displayName?: string }; time?: string } | undefined;
    const updated = f.updatedInfo as { time?: string } | undefined;
    collected.set(id, {
      id,
      title: String(f.title ?? id),
      createdAt: created?.time,
      updatedAt: updated?.time ?? created?.time,
      author: created?.user?.displayName,
    });
  }
}

page.on('response', async (res) => {
  const url = res.url();
  if (!/\/api\/file\/meeting_notes\//.test(url)) return;
  if (!seen) seen = { url, headers: res.request().headers() };
  try {
    absorb(await res.json());
  } catch {
    /* a non-JSON body on this route is not something to crash over */
  }
});

console.log(`  opening ${HOME}`);
await page.goto(HOME, { waitUntil: 'networkidle', timeout: TIMEOUT_MS }).catch(() => {});
await page.waitForTimeout(WAIT_MS);

if (/signin|login/i.test(page.url())) {
  await ctx.close();
  fail(
    `Not signed in — landed on ${page.url()}\n` +
      'Run: npx tsx scripts/capture-zoom-notes.mts --login --hub ' + HOME,
  );
}

// Clicking the tab is what makes the app issue the call we want to replay.
for (const label of ['Shared with me', 'Owned by me']) {
  try {
    const tab = page.getByText(new RegExp(label, 'i')).first();
    if (await tab.isVisible({ timeout: 3000 })) {
      await tab.click();
      await page.waitForTimeout(WAIT_MS);
    }
  } catch {
    /* the tab may not exist on this tenant; the direct reads below still run */
  }
}

/**
 * Now page through each list with the app's own headers.
 *
 * `limit` and `asc`, observed — NOT `pageSize`, which this endpoint accepts and
 * silently answers with an empty list. That is what makes a guessed parameter
 * dangerous here: it looks like an account with no meetings.
 */
if (seen) {
  const host = new URL(seen.url).origin;
  for (const tab of TABS) {
    let token = '';
    for (let pageNo = 0; pageNo < 20 && collected.size < LIMIT; pageNo++) {
      const url =
        `${host}/api/file/meeting_notes/${tab}?limit=50&asc=false` +
        (token ? `&pagingToken=${encodeURIComponent(token)}` : '');
      const res = await page.request.get(url, { headers: seen.headers }).catch(() => undefined);
      if (!res || !res.ok()) break;
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const before = collected.size;
      absorb(body);
      token = String(body.nextPagingToken ?? body.nextPageToken ?? '');
      if (!token || collected.size === before) break;
    }
  }
}

const notes = [...collected.values()]
  .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
  .slice(0, LIMIT);

if (!notes.length) {
  await ctx.close();
  fail(
    'No meeting notes found.\n' +
      'The session may have expired — re-run the --login step. Or try --headed to\n' +
      'watch the page, and --tabs to name a different list.',
  );
}
console.log(`  ${collected.size} note(s) listed, capturing ${notes.length}`);

/** The incremental index: a note whose `updatedAt` has not moved is not reopened. */
const indexPath = join(OUT, 'capture-index.json');
let index: Record<string, { updatedAt?: string; dir?: string }> = {};
try {
  index = JSON.parse(await readFile(indexPath, 'utf8')) as typeof index;
} catch {
  /* first run */
}

let captured = 0;
let skipped = 0;
for (const n of notes) {
  const dir = `${slug(n.title)}_${n.id}`;
  const prior = index[n.id];
  if (prior?.updatedAt && prior.updatedAt === n.updatedAt && prior.dir) {
    skipped++;
    continue;
  }
  // A retitled note MOVES rather than being captured twice under a new name.
  if (prior?.dir && prior.dir !== dir) {
    await rename(join(OUT, prior.dir), join(OUT, dir)).catch(() => {});
  }

  await page.goto(`https://docs.zoom.us/doc/${n.id}`, { waitUntil: 'networkidle', timeout: TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(WAIT_MS);
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  if (!text.trim()) {
    console.log(`    ${n.title.slice(0, 50)} — empty, skipped`);
    continue;
  }

  const target = join(OUT, dir);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'page.txt'), text, 'utf8');
  await writeFile(
    join(target, 'capture.json'),
    `${JSON.stringify(
      {
        document_id: n.id,
        title: n.title,
        url: `https://docs.zoom.us/doc/${n.id}`,
        created_at: n.createdAt,
        updated_at: n.updatedAt,
        author: n.author,
        captured_at: new Date().toISOString(),
        source: 'mynotes.zoom.us',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  index[n.id] = { updatedAt: n.updatedAt, dir };
  captured++;
  const hasTranscript = /transcript/i.test(text);
  console.log(
    `    ${String(n.createdAt ?? '').slice(0, 10)}  ${n.title.slice(0, 52).padEnd(52)}` +
      ` ${String(text.length).padStart(6)} chars${hasTranscript ? '  +transcript' : ''}`,
  );
}

await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
await ctx.close();

const dirs = (await readdir(OUT, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_')).length;
console.log(`\n  ${captured} captured, ${skipped} unchanged · ${dirs} note(s) in ${OUT}`);
console.log(`\nNext:\n  npx tsx scripts/import-zoom-notes.mts --in ${OUT} --out ./live-graph`);
