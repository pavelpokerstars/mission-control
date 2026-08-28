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
 * There is exactly one palette, in `docs/doc.css`, and it is the documents' own
 * rather than the app's. `apps/shell/src/app.css` names its tokens `--ground`,
 * `--ink` and `--s-jira` for a screen that has to hold an alert list; a page of
 * prose wants a different scale, and it has one. What matters is that there is
 * only ever one of them, inlined into every page so each renders standing alone
 * — no server, no stylesheet to resolve — and a colour changes in one file
 * rather than in every page that shows it.
 *
 * Regenerating is safe and repeatable — `docs/html/` is disposable output.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
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
 * two top-level files — and the five skills under `.claude/` — come along
 * without living in `docs/`.
 *
 * THE ORDER IS THE PRODUCT'S OWN, and it is the thing here easiest to get wrong
 * with nothing failing anywhere. `README.md` and `CLAUDE.md` both say to start
 * at `DIRECTION.md`, but this array is what actually decides, because it sets
 * the reading order of `everything.html` — the one page a reader is handed. It
 * used to open on `CEREMONY-FLOW.md` and put `DIRECTION.md` sixth, so the first
 * document anybody met was one that flags itself as pre-dating the direction it
 * is meant to serve. So, in this order: what the product is, then what the
 * screen does, then the mechanisms underneath it — the contract with the
 * collectors, the layer below that, and the ceremony that exercises both — then
 * the ledgers of what is built and what is missing, and only after all of it
 * the working notes for changing any of it.
 */
const PAGES = [
  { from: 'README.md', out: 'readme.html', nav: 'Readme', title: 'Mission Control' },
  { from: 'docs/DIRECTION.md', out: 'direction.html', nav: 'Direction', title: 'Direction' },
  { from: 'docs/DESIGN.md', out: 'design.html', nav: 'Interface', title: 'The Interface' },
  { from: 'docs/GRAPH-SCHEMA.md', out: 'graph-schema.html', nav: 'Graph schema', title: 'The Connection Graph' },
  { from: 'docs/ARCHITECTURE.md', out: 'architecture.html', nav: 'Architecture', title: 'Architecture' },
  { from: 'docs/CEREMONY-FLOW.md', out: 'ceremony-flow.html', nav: 'Ceremony flow', title: 'Ceremony Flow' },
  { from: 'docs/ROADMAP.md', out: 'roadmap.html', nav: 'Roadmap', title: 'The Development Path' },
  { from: 'docs/BUILD-PLAN.md', out: 'build-plan.html', nav: 'Build plan', title: 'Build Plan' },
  { from: 'docs/KNOWN-GAPS.md', out: 'known-gaps.html', nav: 'Known gaps', title: 'Known Gaps' },
  /**
   * `AGENTS.md` is a pointer rather than a document — it exists so that an agent
   * arriving by that filename is sent to `CLAUDE.md` instead of being handed a
   * second copy of the rules to drift from. It is here anyway, and directly in
   * front of the file it points at, for one small reason: `README.md` links to
   * it, and a target outside this list is left as a raw `.md` href, which in the
   * rendered set is a link to nothing.
   */
  { from: 'AGENTS.md', out: 'agents.html', nav: 'Agent notes', title: 'Agent Instructions' },
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
 *
 * All four spellings, because a document inside `docs/` writes a sibling as
 * `./KNOWN-GAPS.md` while `README.md` at the root writes the same file as
 * `docs/KNOWN-GAPS.md`. Matching only the root-relative pair left two working
 * cross-references pointing at markdown that is not beside the output.
 *
 * A bare basename is used ONLY where it identifies one page. The five skills are
 * all called `SKILL.md`, so a `SKILL.md` href would silently resolve to
 * whichever of them this loop reached last — an ambiguous name is better left
 * alone than resolved to the wrong document.
 */
const UNIQUE_BASENAMES = new Set(
  Object.entries(
    PAGES.reduce((n, p) => ({ ...n, [basename(p.from)]: (n[basename(p.from)] ?? 0) + 1 }), {}),
  )
    .filter(([, count]) => count === 1)
    .map(([name]) => name),
);

function rewriteLinks(html) {
  for (const p of PAGES) {
    const base = basename(p.from);
    const targets = [p.from, `./${p.from}`];
    if (UNIQUE_BASENAMES.has(base)) targets.push(base, `./${base}`);
    for (const t of targets) {
      html = html.replaceAll(`href="${t}"`, `href="${p.out}"`);
    }
  }
  // The preview is the one link that is not a page in this set and must still
  // land: it is hand-written HTML, it is not generated from markdown, and it is
  // what every document defers to on behaviour. It stays in `docs/`, one level
  // above the output, so the path the markdown carries has to be lifted.
  for (const t of ['docs/design-preview.html', './docs/design-preview.html']) {
    html = html.replaceAll(`href="${t}"`, 'href="../design-preview.html"');
  }
  return html;
}

/**
 * Take the front off a document: the skill frontmatter, then the leading `# `.
 *
 * A `SKILL.md` opens with YAML — a `name` and the long `description` the agent
 * matches a task against. `marked` reads `---\nname: …\n---` as a *setext*
 * heading, so that entire routing sentence rendered as an `<h2>`: five walls of
 * "Use when touching apps/gateway/src/agent.ts…" at the top of five pages, and
 * five paragraph-long entries in `everything.html`'s contents list. It is
 * metadata about when to load the file, not part of the document, so it comes
 * off first.
 *
 * Only then can the document's own `# Title` be stripped — the masthead prints
 * one already, and rendering both puts the same words on screen twice. That
 * strip is anchored at the start of the string, so behind three dashes it never
 * fired, which is why every skill page carried its title twice. Only the
 * *first* heading and only if it is an h1: `## 1. Correctness` and every later
 * section must survive untouched.
 */
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const LEADING_H1 = /^\s*#\s+.+?\n/;
const stripFront = (md) => md.replace(FRONTMATTER, '').replace(LEADING_H1, '');

/**
 * Put the diagrams in the page rather than beside it.
 *
 * `CEREMONY-FLOW.md` draws two SVGs with `![…](./ceremony-flow.svg)`, which is
 * correct for the markdown read in place and broken the moment it is rendered:
 * the output lives one directory down in `docs/html/`, so the relative `src`
 * pointed at a file that was never there and both diagrams arrived as the
 * browser's broken-image glyph. Copying the SVGs next to the output would mend
 * the `src` and break the promise at the top of this file — a page that still
 * renders when it is mailed to somebody. So the SVG goes in whole, the same
 * argument that inlines the stylesheet.
 *
 * Nothing is lost by dropping the `alt`: both files carry `role="img"` with a
 * `<title>` and `<desc>` wired up through `aria-labelledby`, which is the richer
 * description of the two. `src` is resolved against the markdown file's own
 * directory, because that is what the link in the markdown means.
 */
function inlineDiagrams(html, srcDir) {
  return html.replace(/<img src="([^"]+\.svg)" alt="[^"]*"\s*\/?>/g, (tag, src) => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(src)) return tag; // an external diagram is not ours to inline
    const file = join(srcDir, src);
    if (!existsSync(file)) {
      console.warn(`[docs] diagram left as a link: ${src} — not found under ${srcDir}`);
      return tag;
    }
    return readFileSync(file, 'utf8').trim();
  });
}

/**
 * The shared chrome: a nav across the doc set, so no page is a dead end.
 *
 * TWO ENTRIES ARE NOT IN `PAGES` AND BOTH HAVE TO BE HERE. `everything.html` is
 * assembled from the list rather than being a member of it, and it is the page
 * `README.md` sends people to — left out, the one-page bundle was reachable
 * from nothing but a path typed by hand. `index.html` is what a browser asks
 * for when somebody opens the directory, which is the likeliest way in and used
 * to answer with a file listing or nothing at all.
 *
 * `group-start` marks where the documents stop and the working notes begin. The
 * nav wraps (see `doc.css`), so the reader needs a division that survives a
 * line break rather than one implied by position in a row.
 */
function navFor(current) {
  const WORKING_NOTES_START = 'agents.html';
  const items = PAGES.map((p) => ({ out: p.out, nav: p.nav, group: p.out === WORKING_NOTES_START }));
  items.push({ out: 'everything.html', nav: 'Everything', group: true });

  const links = items
    .map(({ out, nav, group }) => {
      // index.html is readme.html under the name a directory request resolves to.
      const here = out === current || (out === 'readme.html' && current === 'index.html');
      return `<li${group ? ' class="group-start"' : ''}><a href="${out}"${
        here ? ' aria-current="page" class="here"' : ''
      }>${nav}</a></li>`;
    })
    .join('\n      ');
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
  /* height:auto is load-bearing for an inlined diagram: the SVG carries its own
     width and height attributes, and capping only the width squashes it. */
  img,svg { max-width: 100%; height: auto; }
</style>
<style>
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/**
 * Every document gets the same shell: the narrow measure, the sticky nav, and
 * one palette on tables and code blocks. `marked` handles the markdown itself;
 * everything visual comes from `doc.css`, and the diagrams are spliced in after
 * it, because a relative `src` does not survive the move into `docs/html/`.
 */
function renderMarkdown(md, title, srcDir) {
  const html = marked.parse(stripFront(md), { gfm: true, breaks: false });
  return `<div class="wrap">
  <header class="masthead">
    <p class="wordmark">Mission Control</p>
    <h1>${title}</h1>
  </header>
  __NAV__
  <div class="doc prose-wide">
${inlineDiagrams(rewriteLinks(html), srcDir)}
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

function combined(docs) {
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

  /* THE SAME NAV AS EVERY OTHER PAGE. Without it this one was a dead end: its
     own lede said the per-document pages "are in the same folder" and then
     linked to none of them, so arriving here meant using the back button or
     typing a filename. */
  return `<div class="wrap">
  ${navFor('everything.html')}
  <header class="masthead">
    <p class="wordmark">Mission Control</p>
    <h1>Everything, on one page</h1>
    <p class="lede">Every document in the repository, in reading order. Any of
      them can be read on its own from the row above, and
      <a href="../design-preview.html">the interface preview</a> is the
      clickable reference for the screens.</p>
  </header>
  <nav class="alltoc" aria-label="Contents">
    ${toc}
  </nav>
  ${body}
</div>`;
}

/** Derived, not typed in: a skill path is longer than any doc's, and a hard-coded
 *  column width went ragged the day the skills joined the list. */
const FROM_WIDTH = Math.max(...PAGES.map((p) => p.from.length));

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

    const body = renderMarkdown(raw, p.title, dirname(src));

    const withNav = body.includes('__NAV__')
      ? body.replaceAll('__NAV__', navFor(p.out))
      : body;

    await writeFile(
      join(OUT, p.out),
      page({ title: p.title, css, nav: '', body: withNav, generated: p.from }),
      'utf8',
    );
    built++;
    console.log(`[docs] ${p.from.padEnd(FROM_WIDTH)} → docs/html/${p.out}`);

    /**
     * `index.html` is the README again, under the name a directory request
     * resolves to. Without it, opening `docs/html/` — which is how most people
     * arrive, and what `README.md` describes — gets a bare file listing from a
     * static server, or nothing at all from `file://`. It is written from the
     * same render rather than copied afterwards so the two cannot drift, and the
     * nav is rebuilt for `index.html` so the Readme tab still marks itself
     * current.
     */
    if (p.out === 'readme.html') {
      const asIndex = body.includes('__NAV__')
        ? body.replaceAll('__NAV__', navFor('index.html'))
        : body;
      await writeFile(
        join(OUT, 'index.html'),
        page({ title: p.title, css, nav: '', body: asIndex, generated: p.from }),
        'utf8',
      );
      console.log(`[docs] ${''.padEnd(FROM_WIDTH)} → docs/html/index.html (the same page, for a directory request)`);
    }
  }

  // and the read-through: every markdown document on one page
  const docs = [];
  for (const p of PAGES) {
    const src = join(ROOT, p.from);
    if (!existsSync(src)) continue;
    const md = stripFront(await readFile(src, 'utf8'));
    const id = p.out.replace(/\.html$/, '');
    const headings = [];
    const html = inlineDiagrams(
      rewriteLinks(marked.parse(md, { gfm: true, breaks: false })),
      dirname(src),
    ).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, lvl, text) => {
      const hid = `${id}--${slug(text)}`;
      if (lvl === '2') headings.push({ lvl, text: text.replace(/<[^>]*>/g, ''), id: hid });
      return `<h${lvl} id="${hid}">${text}</h${lvl}>`;
    });
    docs.push({ id, from: p.from, title: p.title, html, headings });
  }
  await writeFile(
    join(OUT, 'everything.html'),
    page({ title: 'Mission Control — everything', css: css + COMBINED_CSS, nav: '',
           body: combined(docs), generated: 'every markdown document' }),
    'utf8',
  );
  console.log(
    `[docs] ${`${docs.length} document(s)`.padEnd(FROM_WIDTH)} → docs/html/everything.html`,
  );

  const files = await readdir(OUT);
  console.log(`\n[docs] ${built} page(s) built — ${files.length} file(s) in docs/html/`);
  console.log('[docs] open docs/html/everything.html');
}

await main();
