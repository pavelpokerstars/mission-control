/**
 * Capture Zoom Docs notes through a logged-in browser, on this machine.
 *
 * WHY THIS EXISTS IN TYPESCRIPT. The mechanism is the graph author's — `zoom-local-sync`,
 * whose `browser.py` worked out every awkward part of it against the real Zoom
 * Hub, and the flow below is his, reimplemented rather than invented. What is
 * not his is the language, and that was the only reason this needed porting:
 * Playwright's Node API is the same API, so `chromium.launchPersistentContext`,
 * `context.on('response')`, `page.evaluate` and `innerText` all map one to one.
 *
 * Python would have meant a second toolchain, a virtualenv, and an interpreter
 * upgrade on this Mac (it ships 3.9; the tool needs 3.11) — for a script that
 * fits the `scripts/*.mts` idiom this repo already has. One language, one
 * install, `npx tsx`.
 *
 *   npx tsx scripts/capture-zoom-notes.mts --login      # once, sign in by hand
 *   npx tsx scripts/capture-zoom-notes.mts --limit 20   # then, any time
 *   npx tsx scripts/import-zoom-notes.mts --in <captures> --out ./live-graph
 *
 * IT DRIVES THE INSTALLED CHROME. `channel: 'chrome'` rather than Playwright's
 * bundled Chromium, so nothing downloads a browser — which matters because
 * npm's `allowScripts` policy blocks Playwright's postinstall anyway. The
 * original used `channel: 'msedge'`; Edge is not on a Mac by default and Chrome
 * is.
 *
 * WHY A PERSISTENT PROFILE. Zoom's web session is the credential, and there is
 * no token to store: `--login` opens a real window, you sign in once the way you
 * always do, and the profile directory keeps the session. Nothing here ever
 * sees or handles a password.
 *
 * WHAT IT WRITES is exactly what `zoom-local-sync` writes — one folder per note
 * holding `page.txt` and `capture.json` — so the two are interchangeable and
 * `import-zoom-notes.mts` reads either.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

const args = process.argv.slice(2);
const has = (name: string): boolean => args.includes(`--${name}`);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const HUB = opt('hub') ?? 'https://app.zoom.us/wc/home';
const PROFILE = opt('profile') ?? join(homedir(), '.mission-control', 'zoom-profile');
const OUT = opt('out') ?? join(homedir(), '.mission-control', 'zoom-captures');
const LIMIT = Math.max(1, Number(opt('limit') ?? 20));
const WAIT_MS = Number(opt('wait') ?? 2_500);
const TIMEOUT_MS = Number(opt('timeout') ?? 60_000);
const INDEX_FILE = '.capture-index.json';
/**
 * What counts as a note link.
 *
 * Overridable because Zoom serves docs from regional hosts for some accounts,
 * and because a hardcoded production URL makes the filter impossible to
 * exercise without a real session. The default is the one Zoom uses; anything
 * not matching it is not captured, which is what stops a stray link in the
 * recent list from being fetched.
 */
const DOC_PREFIX = opt('doc-prefix') ?? 'https://docs.zoom.us/doc/';

/**
 * `--log-api` — write every Zoom JSON response to `_api-log/`, and capture
 * nothing else.
 *
 * WHAT IT IS FOR. Rendering a note costs a page load because Zoom Docs is a
 * client-side app, and that is the only expensive part of this: the recent-files
 * list is already a plain `fetch` from inside the page. If Zoom also serves a
 * doc's CONTENT as JSON, every note becomes a fetch, the per-note page load
 * disappears, and the browser drops to being nothing but a session-holder.
 *
 * That endpoint is not documented and guessing at it would be inventing an API.
 * One real run with this flag lists every JSON call Hub makes while a note
 * opens, which answers it with evidence — and costs nothing to leave here.
 */
const LOG_API = has('log-api');

/** The headers Zoom's docs API needs, and nothing else that was on the request. */
const DOCS_HEADERS = new Set([
  'accept',
  'authorization',
  'x-requested-with',
  'x-zm-cluster-id',
  'x-zm-device-tracking-id',
  'x-zm-docs-container',
  'x-zm-docs-loading',
]);

async function open(headless: boolean): Promise<BrowserContext> {
  await mkdir(PROFILE, { recursive: true });
  return chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    acceptDownloads: true,
  });
}

const firstPage = async (ctx: BrowserContext): Promise<Page> =>
  ctx.pages()[0] ?? (await ctx.newPage());

const slug = (v: string): string =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'note';

// ---------------------------------------------------------------------------

/**
 * `--help`, and it has to sit ABOVE the profile guard rather than below it.
 *
 * This was the one script here you could not ask what its flags were. With no
 * profile it printed the no-session error; with a profile — the machine this
 * script is FOR — `--help` launched Chrome and attempted a capture. Ten flags
 * are parsed and four are documented; the other six existed only in the source.
 * Every importer beside it prints a usage block, and only gets one because it
 * has a required argument to be missing. This one has no required argument, so
 * it had no usage path at all.
 */
if (has('help') || args.includes('-h')) {
  console.log(
    `Capture Zoom Docs notes through a logged-in browser profile.\n` +
      `\n` +
      `  npx tsx scripts/capture-zoom-notes.mts --login      # once, by hand\n` +
      `  npx tsx scripts/capture-zoom-notes.mts --limit 20   # then, any time\n` +
      `\n` +
      `It drives the INSTALLED Chrome (channel: 'chrome'), so nothing downloads a\n` +
      `browser, and the persistent profile IS the credential — no token is stored.\n` +
      `Every run after --login is headless.\n` +
      `\n` +
      `  --login          open a real window and sign in. The only path that shows one.\n` +
      `  --headed         run this capture with a visible window, for debugging.\n` +
      `  --log-api        record every JSON call Hub makes while a note opens, to\n` +
      `                   _api-log/calls.json. Forces a reload of each note, so a\n` +
      `                   warm index does not skip the very calls being looked for.\n` +
      `  --limit <n>      how many recent notes to consider        (default 20)\n` +
      `  --hub <url>      the Hub page to read the recent-files list from\n` +
      `                   (default https://app.zoom.us/wc/home)\n` +
      `  --doc-prefix <url>\n` +
      `                   only capture notes under this prefix. A regional tenant\n` +
      `                   serves docs elsewhere and captures nothing until this is set\n` +
      `                   (default https://docs.zoom.us/doc/)\n` +
      `  --profile <dir>  the browser profile holding the session\n` +
      `                   (default ~/.mission-control/zoom-profile)\n` +
      `  --out <dir>      where captures are written\n` +
      `                   (default ~/.mission-control/zoom-captures)\n` +
      `  --wait <ms>      settle time after a note's page loads      (default 2500)\n` +
      `  --timeout <ms>   per-navigation timeout                    (default 60000)\n` +
      `\n` +
      `A run is cheap in steady state: a note whose updatedAt has not moved is\n` +
      `skipped, so a normal run is one Hub page load and zero note loads.\n` +
      `\n` +
      `Then turn the captures into a graph:\n` +
      `  npx tsx scripts/import-zoom-notes.mts --in <out dir> --out ./live-graph`,
  );
  process.exit(0);
}

if (has('login')) {
  /**
   * A real window, and it stays open until you close it.
   *
   * Zoom's sign-in is SSO in most organisations, which means a redirect chain
   * and possibly a second factor — nothing a script should be driving. You do
   * it; the profile keeps the result.
   */
  console.log(`Opening Zoom. Sign in as you normally would, then close the window.`);
  console.log(`  profile: ${PROFILE}\n`);
  const ctx = await open(false);
  const page = await firstPage(ctx);
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS }).catch(() => undefined);
  await ctx.waitForEvent('close', { timeout: 0 }).catch(() => undefined);
  console.log('Session saved. Now run without --login to capture.');
  process.exit(0);
}

if (!existsSync(join(PROFILE, 'Default'))) {
  console.error(
    `No Zoom session in ${PROFILE}.\n` +
      `Run this once first, and sign in when the window opens:\n` +
      `  npx tsx scripts/capture-zoom-notes.mts --login`,
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------

interface RecentFile {
  id: string;
  title: string;
  url: string;
  updatedAt: string;
}

/**
 * Zoom's recent-files payload, from whichever route offers it first.
 *
 * Hub asks for it on load, so watching the network usually suffices. When it
 * does not — a cached render, a different landing tab — the fallback is to ask
 * for it from *inside the page*, reusing the session cookies and the headers
 * Hub itself sent. That is why the request handler exists at all: the docs API
 * is on a per-account cluster host and wants a bearer the page already has.
 */
function recentFrom(payload: unknown, limit: number): RecentFile[] {
  const files = (payload as { recentFiles?: unknown[] })?.recentFiles ?? [];
  const out: RecentFile[] = [];
  const seen = new Set<string>();
  for (const raw of files) {
    const item = raw as { file?: Record<string, unknown>; fileLink?: string; lastOperatedTime?: string };
    const file = item.file ?? {};
    const id = typeof file.id === 'string' ? file.id : '';
    const url = (typeof file.fileLink === 'string' ? file.fileLink : undefined) ?? item.fileLink;
    const title = typeof file.title === 'string' ? file.title : '';
    const updatedAt =
      ((file.updatedInfo as { time?: string } | undefined)?.time ?? item.lastOperatedTime) || '';
    // Notes only. Hub's recent list also carries whiteboards and spreadsheets,
    // and a whiteboard captured as text is a page of nothing.
    if (!id || !url || file.fileType !== 'doc') continue;
    if (!url.startsWith(DOC_PREFIX) || seen.has(url)) continue;
    seen.add(url);
    out.push({ id, title, url, updatedAt });
    if (out.length >= limit) break;
  }
  return out;
}

const ctx = await open(!has('headed'));
let recent: unknown;
let mySpace: unknown;
let docsHeaders: Record<string, string> | undefined;

const apiLog: { url: string; bytes: number; sample: string }[] = [];

ctx.on('response', (res) => {
  void (async () => {
    try {
      if (!mySpace && res.url().includes('/api/file/my_space')) mySpace = await res.json();
      else if (!recent && res.url().includes('/api/file/recent')) recent = await res.json();
      if (LOG_API && /zoom\.us/.test(res.url()) && /json/.test(res.headers()['content-type'] ?? '')) {
        const body = await res.text();
        apiLog.push({ url: res.url(), bytes: body.length, sample: body.slice(0, 400) });
      }
    } catch {
      /* not JSON, or already consumed */
    }
  })();
});
ctx.on('request', (req) => {
  if (docsHeaders || !req.url().includes('/api/file/my_space')) return;
  void (async () => {
    try {
      const all = await req.allHeaders();
      const picked: Record<string, string> = {};
      for (const [k, v] of Object.entries(all)) if (DOCS_HEADERS.has(k.toLowerCase()) && v) picked[k] = v;
      picked.accept ??= 'application/json, text/plain, */*';
      picked['x-requested-with'] ??= 'XMLHttpRequest';
      docsHeaders = picked;
    } catch {
      /* headers unavailable on this request */
    }
  })();
});

const page = await firstPage(ctx);
await page.goto(HUB, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
await page.waitForTimeout(WAIT_MS);

if (!recent && mySpace) {
  const prefix = (mySpace as { mySpace?: { fileClusterApiPrefix?: string } }).mySpace
    ?.fileClusterApiPrefix;
  if (prefix) {
    recent = await page
      .evaluate(
        async ({ prefix, headers }) => {
          const url = new URL('api/file/recent?limit=50', prefix).toString();
          const res = await fetch(url, { credentials: 'include', headers });
          if (!res.ok) throw new Error(`recent-files request failed with ${res.status}`);
          return res.json();
        },
        { prefix, headers: docsHeaders ?? {} },
      )
      .catch((err: unknown) => {
        console.error(`  could not fetch recent files: ${String(err)}`);
        return undefined;
      });
  }
}

if (!recent) {
  await ctx.close();
  console.error(
    'Could not read the recent-files payload from Hub.\n' +
      'The session has probably expired — re-run with --login and sign in again.\n' +
      'Or run with --headed to watch what the page does.',
  );
  process.exit(1);
}

const files = recentFrom(recent, LIMIT);
if (!files.length) {
  await ctx.close();
  console.error('The recent-files payload held no Zoom Docs notes.');
  process.exit(1);
}

// ---------------------------------------------------------------------------

await mkdir(OUT, { recursive: true });
const indexPath = join(OUT, INDEX_FILE);
let index: Record<string, { updatedAt: string; dir: string }> = {};
if (existsSync(indexPath)) {
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8')) as typeof index;
  } catch {
    /* a corrupt index costs a re-capture, not the run */
  }
}

let captured = 0;
let skipped = 0;
for (const f of files) {
  const dir = join(OUT, `${slug(f.title)}_${f.id}`);
  const prev = index[f.id];

  /**
   * A renamed note moves its folder, so remove the one it moved from.
   *
   * The folder is `<title-slug>_<doc id>` and the title is editable, so a
   * rename in Zoom captures into a NEW folder while the old one stays on disk
   * with a valid `page.txt`. The importer walks every folder, so one document
   * arrived as two meetings. The index knows the previous path; nothing was
   * using it.
   */
  if (prev?.dir && prev.dir !== dir && existsSync(prev.dir)) {
    await rm(prev.dir, { recursive: true, force: true }).catch(() => undefined);
    console.log(`  moved     ${prev.dir} → ${dir}`);
  }

  /**
   * Unchanged AND still on disk — unless we are here to watch the network.
   *
   * `--log-api` exists to list the JSON calls Hub makes *while a note opens*,
   * and on a warm index no note opens at all, so the log came back without the
   * one call it was run to find. The flag now forces the fetch it is observing.
   */
  if (!LOG_API && prev && prev.updatedAt === f.updatedAt && existsSync(join(dir, 'page.txt'))) {
    skipped++;
    continue;
  }

  await mkdir(dir, { recursive: true });
  const notePage = await ctx.newPage();
  try {
    await notePage.goto(f.url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    await notePage.waitForTimeout(WAIT_MS);
    const text = await notePage.locator('body').innerText();
    const title = (await notePage.title()) || f.title;

    await writeFile(join(dir, 'page.txt'), text, 'utf8');
    await writeFile(
      join(dir, 'capture.json'),
      `${JSON.stringify(
        {
          captured_at: new Date().toISOString(),
          requested_url: f.url,
          final_url: notePage.url(),
          title,
          document_id: f.id,
          updated_at: f.updatedAt,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    index[f.id] = { updatedAt: f.updatedAt, dir };
    captured++;
    console.log(`  captured  ${title}`);
  } catch (err) {
    console.error(`  FAILED    ${f.title} — ${String(err)}`);
  } finally {
    await notePage.close();
  }
}

await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');

if (LOG_API) {
  const logDir = join(OUT, '_api-log');
  await mkdir(logDir, { recursive: true });
  await writeFile(join(logDir, 'calls.json'), `${JSON.stringify(apiLog, null, 2)}\n`, 'utf8');
  console.log(`\n${apiLog.length} Zoom JSON call(s) → ${join(logDir, 'calls.json')}`);
  console.log('  Look for one returning a note\'s CONTENT. If it exists, the per-note');
  console.log('  page load can become a fetch and the browser becomes a session-holder.');
  for (const c of apiLog) console.log(`    ${String(c.bytes).padStart(7)}  ${c.url.slice(0, 110)}`);
}

await ctx.close();

console.log(`\n${captured} captured, ${skipped} unchanged → ${OUT}`);
console.log(`\nNext:\n  npx tsx scripts/import-zoom-notes.mts --in ${OUT} --out ./live-graph`);
