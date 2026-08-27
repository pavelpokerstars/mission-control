import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Libraries the browser must never import, whatever `tsconfig.base.json` says.
 *
 * `@mc/vault` touches `node:fs`. Leaving it unaliased is not an oversight — it
 * is the enforcement: an import from the shell fails loudly at build time
 * instead of shipping a broken bundle. The note page reaches it over HTTP, the
 * way every screen here reaches its data.
 *
 * This set is why the aliases are *derived minus a deny-list* rather than
 * derived outright. A naive `paths` → `alias` copy would helpfully add
 * `@mc/vault` back and silently undo the guarantee.
 */
const BROWSER_FORBIDDEN = new Set(['@mc/vault']);

/**
 * The aliases come from `tsconfig.base.json`, which is the one place a `@mc/*`
 * package's location is written down.
 *
 * They used to be a hand-maintained copy of it. Two lists of the same four
 * mappings drift silently: add a library, update `paths`, forget here, and tsc
 * resolves it while vite does not — an error that only appears when somebody
 * runs the dev server, and points at an import rather than at the config.
 *
 * NOTE: this parses `tsconfig.base.json` as strict JSON. Keep comments out of
 * that file (the per-project tsconfigs are free to have them). If it ever does
 * grow one, this throws at startup with the message below — loud, and far
 * easier to diagnose than the drift it replaced.
 */
function aliasesFromTsconfig(): Record<string, string> {
  const file = r('../../tsconfig.base.json');
  let paths: Record<string, string[]>;
  try {
    paths = JSON.parse(readFileSync(file, 'utf8')).compilerOptions?.paths ?? {};
  } catch (err) {
    throw new Error(
      `Could not read compilerOptions.paths out of ${file} — vite aliases are derived from it. ` +
        `If a comment was added to that file, remove it (it must stay strict JSON). Cause: ${String(err)}`,
    );
  }

  return Object.fromEntries(
    Object.entries(paths)
      .filter(([name]) => !BROWSER_FORBIDDEN.has(name))
      .map(([name, [target]]) => [name, r(`../../${String(target).replace(/^\.\//, '')}`)]),
  );
}

/**
 * Serve `index.html` for every deep link.
 *
 * The router uses real paths (`/alert/…`, `/record/jira/PAY-9031`) rather than
 * a hash, so a reload or a pasted link asks the server for a path no file sits
 * at. Vite already falls back for most of them; it declines when the last
 * segment looks like a filename, and record ids legitimately contain dots — a
 * Slack `ts` is `1755950400.001` — so `/record/slack/1755950400.001` would
 * 404 on reload while every other page worked. That is the failure worth
 * pre-empting: it appears only on the deep link somebody pasted.
 *
 * Installed in the hook body so it runs BEFORE vite's own fallback, and gated
 * on the request asking for HTML — a module request (`/src/main.tsx`,
 * `/@vite/client`) accepts `*` and must still be served as itself.
 *
 * Anything else serving `dist/` needs the same rewrite.
 */
function spaFallback(): Plugin {
  const rewrite = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use((req, _res, next) => {
      const url = req.url ?? '/';
      if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        String(req.headers.accept ?? '').includes('text/html') &&
        !url.startsWith('/@') &&
        !url.startsWith('/src/') &&
        !url.startsWith('/node_modules/')
      ) {
        req.url = '/index.html';
      }
      next();
    });
  };
  return {
    name: 'mc-spa-fallback',
    configureServer: rewrite,
    configurePreviewServer: rewrite,
  };
}

export default defineConfig({
  root: r('.'),
  plugins: [react(), spaFallback()],
  resolve: { alias: aliasesFromTsconfig() },
  server: { port: 4200 },
  // Keep outDir inside the app root so Vite does not warn about writing
  // outside of it. emptyOutDir stays false: on some sandboxed/mounted
  // filesystems rmdir is not permitted and a stale dist would fail the build.
  // The `prebuild` script clears it instead — see package.json.
  build: { outDir: 'dist', emptyOutDir: false },
});
