/**
 * Load `.env` before anything else in the process reads `process.env`.
 *
 * THIS MODULE MUST BE IMPORTED FIRST, AND THE IMPORT MUST STAY AT THE TOP OF
 * `main.ts`. An import sorter that moves it below the others silently breaks
 * every setting below, with no error and no wrong-looking output — just
 * defaults where your `.env` said something else.
 *
 * The bug it fixes: `main.ts` used to call `loadEnvFile` in its own body, and
 * in ESM a module's body runs *after* every module it imports. So
 * `claude.ts`'s `const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? …`
 * evaluated before `.env` was ever read, and the same went for
 * `ANTHROPIC_EFFORT`, `ANTHROPIC_MAX_TOKENS`, `COPILOT_MODEL`, the MCP server
 * URLs, `ANTHROPIC_EXTRACT_MODEL` and — worst of the set — `MC_VAULT_DIR`,
 * which is how a real user points the vault away from the repo. Every one of
 * them looked configurable and quietly was not, unless you exported it into the
 * shell yourself.
 *
 * `PORT` and `MC_MODE` were the exceptions and the reason it went unnoticed:
 * they are read in `main.ts` itself, below the old `loadEnvFile` call, so they
 * always worked.
 *
 * Guarded on existence: `loadEnvFile` throws on a missing file, and a checkout
 * with no `.env` at all has to keep booting — mock mode is the default
 * precisely so it needs no config. Real environment variables always win;
 * `loadEnvFile` does not overwrite what is already set.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
