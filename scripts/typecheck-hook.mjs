#!/usr/bin/env node
// PostToolUse hook: typecheck the projects affected by an edit.
//
// This runs `nx affected -t typecheck`, NOT the root `tsc -b`, and the
// difference matters. Root tsconfig.json applies types:["node","vite/client"]
// to every file, so a `process.env` reference inside @mc/domain — shared
// browser+server code that must not touch node globals — passes at the root
// and fails per-project. Running the root check here would let the hook wave
// through code that `npm run typecheck:all` and CI reject.
//
// Scoping by --files means a shell edit typechecks 1 project, a vault edit 2,
// and a domain edit all 6 (cached where unchanged).
//
// Exit 0 = silent pass. Exit 2 = feed stderr back to Claude as a blocking error.

import { execFileSync } from 'node:child_process';
import { relative, isAbsolute } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

const stdin = await new Promise((resolve) => {
  let d = '';
  process.stdin.on('data', (c) => (d += c));
  process.stdin.on('end', () => resolve(d));
});

let file = '';
try {
  file = JSON.parse(stdin)?.tool_input?.file_path ?? '';
} catch {
  process.exit(0); // Malformed payload is not the user's problem — stay quiet.
}
if (!file) process.exit(0);

// nx wants workspace-relative paths.
const rel = isAbsolute(file) ? relative(root, file) : file;

// Only workspace TypeScript. Skip dist, node_modules, and everything else.
const relevant = /^(apps|libs)\/.*\.(ts|tsx)$/.test(rel) && !rel.includes('/dist/');
if (!relevant) process.exit(0);

try {
  execFileSync(
    'npx',
    ['nx', 'affected', '-t', 'typecheck', `--files=${rel}`, '--output-style=static'],
    {
      cwd: root,
      stdio: 'pipe',
      encoding: 'utf8',
      // nx colorizes even when piped, which splits "error TS1234" with escape
      // codes and defeats the filter below.
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    },
  );
} catch (err) {
  const raw = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
  // Belt and braces: strip any escapes that survive NO_COLOR.
  const out = raw.replace(/\[[0-9;]*m/g, '');
  if (!out) process.exit(0);
  const errors = out.split('\n').filter((l) => /error TS\d+/.test(l));
  console.error(
    `Typecheck failed for the projects affected by ${rel}:\n\n` +
      (errors.length ? errors.slice(0, 20).join('\n') : out.slice(0, 2000)) +
      `\n\nFix these before continuing.`,
  );
  process.exit(2);
}

process.exit(0);
