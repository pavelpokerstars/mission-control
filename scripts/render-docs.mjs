#!/usr/bin/env node
/**
 * Render the docs as styled, standalone HTML pages.
 *
 *   npm run docs
 *
 * WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
 *
 * The markdown files stay the source of truth. They are what you grep, what
 * shows a clean diff in review, and what you read in a terminal without a
 * browser — none of which survives hand-writing HTML. So nothing here edits a
 * `.md`; this reads them and writes a parallel set of pages under `docs/html/`.
 *
 * Every output is self-contained: the stylesheet is inlined rather than linked,
 * so a page still renders when it is copied somewhere else, mailed to somebody,
 * or opened straight off disk with no server. That costs a few KB per file and
 * removes an entire class of "why is it unstyled" question.
 *
 * There is exactly one palette, in `docs/doc.css`, and it is the app's own — the
 * tokens at the top of `apps/shell/src/app.css` — inlined into every page so
 * each one renders standing alone: no server, no stylesheet to resolve.
 *
 * Regenerating is safe and repeatable — `docs/html/` is disposable output.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOCS = join(ROOT, 'docs');
const OUT = join(DOCS, 'html');

/**
 * What gets rendered, and what each page is called in the nav.
 *
 * An explicit list rather than a glob over `docs/*.md`: the order below is the
 * order somebody should read them in, and a glob would sort alphabetically and
 * put the deepest reference first. `from` is relative to the repo root, so the
 * two top-level files come along without living in `docs/`.
 */
const PAGES = [
  { from: 'README.md', out: 'readme.html', nav: 'Readme', title: 'Mission Control' },
  { from: 'docs/CEREMONY-FLOW.md', out: 'ceremony-flow.html', nav: 'Ceremony flow', title: 'Ceremony Flow' },
  { from: 'docs/ARCHITECTURE.md', out: 'architecture.html', nav: 'Architecture', title: 'Architecture' },
  { from: 'docs/ROADMAP.md', out: 'roadmap.html', nav: 'Roadmap', title: 'The Development Path' },
  { from: 'docs/BUILD-PLAN.md', out: 'build-plan.html', nav: 'Build plan', title: 'Build Plan' },
  { from: 'docs/DIRECTION.md', out: 'direction.html', nav: 'Direction', title: 'Direction' },
  { from: 'docs/DESIGN.md', out: 'design.html', nav: 'Interface', title: 'The Interface' },
  { from: 'docs/GRAPH-SCHEMA.md', out: 'graph-schema.html', nav: 'Graph schema', title: 'The Connection Graph' },
  { from: 'docs/KNOWN-GAPS.md', out: 'known-gaps.html', nav: 'Known gaps', title: 'Known Gaps' },
  { from: 'CLAUDE.md', out: 'claude.html', nav: 'Working notes', title: 'Working Notes' },
  /**
   * The five skills, which are the other four fifths of the working notes.
   *
   * `CLAUDE.md` was split so that only the rules that must be known before the
   * first edit are auto-loaded, and the area depth arrives when its description
   * matches. That is a loading decision and not a publishing one: a reader of
   * `docs/html/everything.html` wants all of it, and leaving them out here drops
   * 130 KB from the one page that claims to be the lot. This list is a
   * hand-written literal — nothing globs it — so a skill added later is missing
   * from the rendered set with nothing failing anywhere.
   */
  { from: '.claude/skills/mc-collectors/SKILL.md', out: 'skill-collectors.html', nav: 'Collectors', title: 'Collectors, the Graph and the Fixtures' },
  { from: '.claude/skills/mc-interface/SKILL.md', out: 'skill-interface.html', nav: 'Interface notes', title: 'The Interface' },
  { from: '.claude/skills/mc-detectors/SKILL.md', out: 'skill-detectors.html', nav: 'Detectors', title: 'The Findings Pass, the Lane and the Dossier' },
  { from: '.claude/skills/mc-agent/SKILL.md', out: 'skill-agent.html', nav: 'Agent', title: 'The Agent and Structured Output' },
  { from: '.claude/skills/mc-ops/SKILL.md', out: 'skill-ops.html', nav: 'Verifying', title: 'Verifying and Inspecting' },
];

/**
 * Rewrite the links between documents so they still work once rendered.
 *
 * A markdown file links to `docs/KNOWN-GAPS.md`. In the HTML set that has to
 * become `known-gaps.html`, or every cross-reference dumps the reader back into
 * raw markdown. Anything not in `PAGES` — a source file, an SVG, an external
 * URL — is left exactly as it was.
 */
function rewriteLinks(html) {
  for (const p of PAGES) {
    const targets = [p.from, `./${p.from}`, basename(p.from)];
    for (const t of targets) {
      html = html.replaceAll(`href="${t}"`, `href="${p.out}"`);
    }
  }
  return html;
}

/** The shared chrome: a nav across the doc set, so no page is a dead end. */
function navFor(current) {
  const links = PAGES.map((p) => {
    const here = p.out === current;
    return `<li><a href="${p.out}"${here ? ' aria-current="page" class="here"' : ''}>${p.nav}</a></li>`;
  }).join('\n      ');
  return `<nav class="docnav" aria-label="Documents">\n    <ul>\n      ${links}\n    </ul>\n  </nav>`;
}

function page({ title, css, nav, body, generated }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!--
  GENERATED FILE — do not edit.

  Source: ${generated}
  Rebuild: npm run docs

  Edit the markdown and re-run. The palette
  lives once, in docs/doc.css, and is inlined here so this page renders standing
  on its own with no server and no stylesheet to resolve.
-->
<style>
  *,*::before,*::after { box-sizing: border-box; }
  body { margin: 0; }
  img,svg { max-width: 100%; }
</style>
<style>
${css}
</style>
${body}
</body>
</html>
`;
}

/**
 * Every document gets the same shell: the narrow measure, the sticky nav, and
 * the app's own palette on tables and code blocks. `marked` handles the
 * markdown itself; everything visual comes from `doc.css`.
 */
function renderMarkdown(md, title) {
  // Drop the document's own leading `# Title` — the masthead below already
  // prints one, and rendering both puts the same words on screen twice.
  // Only the *first* heading, and only if it is an h1: `## 1. Correctness` and
  // every later section must survive untouched.
  const body = md.replace(/^\s*#\s+.+?\n/, '');

  const html = marked.parse(body, { gfm: true, breaks: false });
  return `<div class="wrap">
  <header class="masthead">
    <p class="wordmark">Mission Control</p>
    <h1>${title}</h1>
  </header>
  __NAV__
  <div class="doc prose-wide">
${rewriteLinks(html)}
  </div>
</div>`;
}

/**
 * One page with every document on it.
 *
 * The per-document pages are the reference; this is the read-through — and the
 * single file you can send somebody. Headings are given ids prefixed by their
 * document so two files can both have a "## 3." without colliding, and the
 * contents list is built from the same pass that assigns them.
 */
const slug = (t) =>
  t.replace(/<[^>]*>/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const COMBINED_CSS = `
  .alltoc {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 26px 30px; margin: 0 0 12px; padding: 0 0 34px;
    border-bottom: 1px solid var(--line);
  }
  .alltoc-doc h3 {
    margin: 0 0 10px; font-family: var(--mono); font-size: .72rem; font-weight: 600;
    letter-spacing: .12em; text-transform: uppercase;
  }
  .alltoc-doc h3 a { color: var(--muted); text-decoration: none; }
  .alltoc-doc h3 a:hover { color: var(--text); }
  .alltoc-doc ul { list-style: none; margin: 0; padding: 0; }
  .alltoc-doc li { margin: 0 0 5px; line-height: 1.35; }
  .alltoc-doc li a {
    font-size: .84rem; color: var(--text); text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .alltoc-doc li a:hover { border-bottom-color: var(--accent); color: var(--accent); }
  .docbreak { border: 0; border-top: 1px solid var(--line); margin: 64px 0 0; }
  article.doc > .wordmark { margin-bottom: 6px; }
  article.doc > h1 { margin-top: 0; }
`;

function combined(docs, css) {
  const toc = docs
    .map(
      (d) => `<section class="alltoc-doc">
      <h3><a href="#${d.id}">${d.title}</a></h3>
      <ul>${d.headings.map((h) => `<li class="lvl${h.lvl}"><a href="#${h.id}">${h.text}</a></li>`).join('')}</ul>
    </section>`,
    )
    .join('\n    ');

  const body = docs
    .map(
      (d) => `<article class="doc prose-wide" id="${d.id}">
    <p class="wordmark">${d.from}</p>
    <h1>${d.title}</h1>
${d.html}
  </article>`,
    )
    .join('\n  <hr class="docbreak">\n  ');

  return `<div class="wrap">
  <header class="masthead">
    <p class="wordmark">Mission Control</p>
    <h1>Everything, on one page</h1>
    <p class="lede">Every document in the repository, in reading order. The
      per-document pages are in the same folder if you would rather have them
      separately, and <a href="../design-preview.html">the interface preview</a>
      is the clickable reference for the screens.</p>
  </header>
  <nav class="alltoc" aria-label="Contents">
    ${toc}
  </nav>
  ${body}
</div>`;
}

async function main() {
  const css = await readFile(join(DOCS, 'doc.css'), 'utf8');
  await mkdir(OUT, { recursive: true });

  let built = 0;
  for (const p of PAGES) {
    const src = join(ROOT, p.from);
    if (!existsSync(src)) {
      console.warn(`[docs] skipped ${p.from} — not found`);
      continue;
    }
    const raw = await readFile(src, 'utf8');

    const body = renderMarkdown(raw, p.title);

    const withNav = body.includes('__NAV__')
      ? body.replaceAll('__NAV__', navFor(p.out))
      : body;

    await writeFile(
      join(OUT, p.out),
      page({ title: p.title, css, nav: '', body: withNav, generated: p.from }),
      'utf8',
    );
    built++;
    console.log(`[docs] ${p.from.padEnd(28)} → docs/html/${p.out}`);
  }

  // and the read-through: every markdown document on one page
  const docs = [];
  for (const p of PAGES) {
    const src = join(ROOT, p.from);
    if (!existsSync(src)) continue;
    const md = (await readFile(src, 'utf8')).replace(/^\s*#\s+.+?\n/, '');
    const id = p.out.replace(/\.html$/, '');
    const headings = [];
    const html = rewriteLinks(marked.parse(md, { gfm: true, breaks: false })).replace(
      /<h([23])>([\s\S]*?)<\/h\1>/g,
      (_m, lvl, text) => {
        const hid = `${id}--${slug(text)}`;
        if (lvl === '2') headings.push({ lvl, text: text.replace(/<[^>]*>/g, ''), id: hid });
        return `<h${lvl} id="${hid}">${text}</h${lvl}>`;
      },
    );
    docs.push({ id, from: p.from, title: p.title, html, headings });
  }
  await writeFile(
    join(OUT, 'everything.html'),
    page({ title: 'Mission Control — everything', css: css + COMBINED_CSS, nav: '',
           body: combined(docs, css), generated: 'every markdown document' }),
    'utf8',
  );
  console.log(`[docs] ${String(docs.length).padStart(2)} document(s)          → docs/html/everything.html`);

  const files = await readdir(OUT);
  console.log(`\n[docs] ${built} page(s) built — ${files.length} file(s) in docs/html/`);
  console.log('[docs] open docs/html/everything.html');
}

await main();
