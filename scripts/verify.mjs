#!/usr/bin/env node
/**
 * The acceptance command. One thing to run, one thing to read.
 *
 * "If it needs a token, it isn't the demo." Nothing here reads a credential,
 * opens a socket or starts a server — a judge on a fresh clone runs this and
 * either sees `all checks passed` or a line naming exactly what is wrong. It is
 * the closest this repo has to a test suite, and it exists because there is no
 * test framework: the interesting bugs here are wiring bugs, and every check
 * below corresponds to one that has actually shipped.
 *
 * The determinism check is the one worth explaining. `fixtures/` is committed
 * AND generated, which is only safe if regenerating is a no-op — otherwise the
 * demo rearranges itself between rehearsal and stage. It was not a no-op:
 * `newEvent` stamped `Date.now()` into every event id, so a regenerate rewrote
 * all 46 of them while claiming in a comment to be deterministic. Nobody
 * noticed because nobody diffs a fixture they just rebuilt.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const t0 = Date.now();
let failed = 0;

/** Every file under a directory, hashed together, sorted so order cannot vary. */
function digest(dir) {
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (statSync(p).isFile()) files.push(p);
    }
  })(dir);
  const h = createHash('sha256');
  for (const f of files) h.update(f.slice(dir.length)).update(readFileSync(f));
  return h.digest('hex');
}

function step(name, run) {
  process.stdout.write(`  ${name}… `);
  try {
    /**
     * A step may return a string, which is printed under its `ok`.
     *
     * Everything here either passes or fails, which is right for a gate — but
     * `verify-design.mts` also REPORTS: the classes the preview draws and the
     * app has never used, which is the design that has not been built. That is
     * not a failure and must not become one, and discarding stdout on success
     * left it visible only to somebody running the verifier directly. An
     * inventory nobody sees is not an inventory.
     */
    const note = run();
    console.log('ok');
    if (typeof note === 'string' && note.trim()) {
      console.log(note.trimEnd().split('\n').map((l) => `      ${l}`).join('\n'));
    }
  } catch (err) {
    failed++;
    console.log('FAILED');
    const detail = (err.stdout?.toString() || '') + (err.stderr?.toString() || '') || err.message;
    console.log(
      detail
        .trim()
        .split('\n')
        .slice(-12)
        .map((l) => `      ${l}`)
        .join('\n'),
    );
  }
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'pipe' });

console.log('\nmission-control — acceptance\n');

step('the workspace typechecks', () => run('npx', ['tsc', '-b']));

/**
 * A file-sync conflict copy in the tree is not cosmetic — it CORRUPTS a run.
 *
 * `loadGraphSource` reads every `*.json` under `records/`, and `seedNotes`
 * derives a note's id from its filename, so `promise-001 2.md` loads as a
 * second commitment and the flagship alert appears twice. Both fixtures are
 * also checked byte-for-byte below, and that digest walks the directory — so a
 * stray file makes the determinism check fail for a reason that has nothing to
 * do with the generator, which is exactly the kind of false alarm that teaches
 * somebody to ignore a verifier.
 *
 * Measured on a checkout under `~/Documents`: one `npm run fixture` rewrites
 * ~300 records at once and iCloud minted 501 conflict copies.
 *
 * First, so the failure names the real cause before anything downstream trips
 * over it.
 */
step('no file-sync conflict copies in the tree', () => {
  const strays = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/ \d+\.\w+$/.test(e.name)) strays.push(relative(root, full));
    }
  };
  /**
   * The directories where a stray actually corrupts a run, and not the caches.
   *
   * A conflict copy under `records/` loads as a phantom record and one under
   * `notes/` loads as a duplicate commitment — that is the failure this check
   * exists for. A copy of `vault/raw/provider-probe.json` is a cache that
   * regenerates, and failing the acceptance command over one is how a verifier
   * teaches people to ignore it.
   */
  for (const d of [
    'fixtures',
    'fixtures-programme',
    join('vault', 'notes'),
    join('vault-programme', 'notes'),
  ]) {
    try {
      walk(join(root, d));
    } catch {
      // The directory need not exist — a vault is created on first boot.
    }
  }
  if (strays.length) {
    throw new Error(
      `${strays.length} file-sync conflict cop${strays.length === 1 ? 'y' : 'ies'}, e.g.\n` +
        strays.slice(0, 5).map((s) => `  ${s}`).join('\n') +
        `\nThese load as phantom records and duplicate notes. Delete them, and\n` +
        `exclude this checkout from iCloud/Dropbox sync — a fixture regenerate\n` +
        `rewrites hundreds of files at once and reliably provokes them.`,
    );
  }
});

step('the fixture regenerates deterministically', () => {
  const before = digest(join(root, 'fixtures'));
  run('npx', ['tsx', 'scripts/generate-fixture.mts']);
  const after = digest(join(root, 'fixtures'));
  if (before !== after) {
    throw new Error(
      'regenerating fixtures/ changed it.\n' +
        'The committed fixture and a fresh generate must be byte-identical, or the\n' +
        'demo can rearrange itself between rehearsal and stage. Run `git diff fixtures/`.',
    );
  }
});

/**
 * The same rule for the programme-scale fixture, which is committed for the same
 * reason and drifts the same way. It is a second directory rather than a bigger
 * `fixtures/` because the two answer different questions: `fixtures/` is the
 * demo narrative, this is what the five collectors actually emit — sparse, seven
 * node kinds, five relations, and most records naming no ticket at all.
 */
step('the programme fixture regenerates deterministically', () => {
  const before = digest(join(root, 'fixtures-programme'));
  run('npx', ['tsx', 'scripts/generate-programme-fixture.mts']);
  const after = digest(join(root, 'fixtures-programme'));
  if (before !== after) {
    throw new Error(
      'regenerating fixtures-programme/ changed it.\n' +
        'Run `git diff fixtures-programme/`.',
    );
  }
});

step('the graph contract holds, and the detectors find what was planted', () =>
  run('npx', ['tsx', 'scripts/verify-graph.mts']),
);

step('the refresh baselines, diffs and re-baselines', () =>
  run('npx', ['tsx', 'scripts/verify-refresh.mts']),
);

/**
 * The app still matches the design it was rebuilt to.
 *
 * Here rather than in a review checklist because a review checklist did not
 * work: a proposal queue was built and removed, and every fact needed to avoid
 * it was already written in `DIRECTION.md` and `DESIGN.md` and had been read.
 */
step('the app matches DIRECTION.md and DESIGN.md', () => {
  const out = run('npx', ['tsx', 'scripts/verify-design.mts']).toString().split('\n');
  // The report block: from the `note` line to the blank line that ends it.
  const from = out.findIndex((l) => /^\s+note\s/.test(l));
  if (from < 0) return '';
  const rest = out.slice(from);
  const to = rest.findIndex((l, i) => i > 0 && !l.trim());
  return (to < 0 ? rest : rest.slice(0, to)).join('\n');
});

/**
 * The fixture against the collector contract.
 *
 * Included because the fixture IS a collector's output — generated into the same
 * shape a real one produces — so the check that will be run against real input
 * should be passing against this input first. If it cannot validate the graph we
 * wrote ourselves, it is not going to be trusted against somebody else's.
 */
step('the fixture reads as a collector\'s output should', () =>
  run('npx', ['tsx', 'scripts/verify-collector.mts']),
);

step('the programme fixture does too', () =>
  run('npx', ['tsx', 'scripts/verify-collector.mts', 'fixtures-programme']),
);

step('the shell builds', () => run('npx', ['vite', 'build', '--config', 'apps/shell/vite.config.mts']));

const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (failed) {
  console.log(`\n${failed} check${failed === 1 ? '' : 's'} failed in ${secs}s\n`);
  process.exit(1);
}
console.log(`\nall checks passed in ${secs}s — no credentials, no network, no server\n`);
