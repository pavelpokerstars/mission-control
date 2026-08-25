/**
 * Does the shipped app still match the design it was rebuilt to?
 *
 * WHY THIS EXISTS. A proposal queue was built and removed. Every fact needed to
 * avoid it was already written down — `DIRECTION.md` §3 lists four pages,
 * neither it nor `DESIGN.md` contains the word "proposal", and the preview's
 * action handler resolves in place with no navigation — and it was built anyway,
 * because the shipped code was read as the specification. The code said
 * "accept it in the queue", no queue existed, and the conclusion drawn was that
 * a queue was missing rather than that the sentence was stale.
 *
 * Documents did not prevent that. They were read. So the constraint is here
 * instead, where it fails loudly, in the same idiom as `verify-graph.mts`: this
 * repo has no test framework, and the things that have actually caught defects
 * are the verifiers.
 *
 * WHAT IT IS NOT. Not a style checker and not a substitute for reading
 * `DESIGN.md`. It asserts the handful of structural facts that separate the
 * alert-first app from the architecture it replaced — the ones whose violation
 * means a destination has grown back.
 *
 * ADDING A PAGE IS SUPPOSED TO BE AWKWARD. `SANCTIONED` below is an explicit
 * table where every route names the document section that allows it. A new route
 * fails until somebody adds a row, and adding a row means answering "which
 * document sanctions this?" — which is the exact question that was skipped.
 * That friction is the feature; do not replace it with a glob.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

let failed = 0;
let group = '';

function section(name: string): void {
  group = name;
  console.log(`\n${name}`);
}

function check(what: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}   ${what}`);
  if (!ok) {
    failed++;
    if (detail) console.log(detail.split('\n').map((l) => `         ${l}`).join('\n'));
  }
}

/**
 * Comments are stripped before any vocabulary scan.
 *
 * Otherwise the paragraph in `Actions.tsx` explaining why there is no queue
 * trips the check that there is no queue, and the honest response to that is to
 * delete the explanation — which throws away the only durable record of why.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

// ---------------------------------------------------------------------------

section('the routes are the ones the direction lists');

/*
 * NOTE THE VOCABULARY, because it is easy to get backwards. `DIRECTION.md` §3
 * opens "Eight destinations become four" — eight is the count of the app that
 * was deleted (five vendor panes, two lenses, the vault). The product is FOUR
 * pages you navigate to, plus records reached only from a citation, plus
 * Sources under the bonnet. This union has eight ROUTES because a note and the
 * Ask index are pages you open from Later and from a conversation; it is not
 * eight destinations.
 */

/**
 * Every route, and the document that allows it. `DIRECTION.md` §3 is the list;
 * `DESIGN.md` §4 is the navigation model.
 */
const SANCTIONED: { route: string; why: string }[] = [
  { route: 'alerts', why: 'DIRECTION.md §3 — "Mission Control: what needs you, worst first"' },
  { route: 'alert', why: 'DIRECTION.md §3 — "The alert: one page per alert type"' },
  { route: 'ask', why: 'DIRECTION.md §3 — "The conversation"; §9 — the global Ask keeps a recent list on its own page' },
  { route: 'conversation', why: 'DIRECTION.md §3 §8 — "opening the conversation is a deliberate move… somewhere to return to"' },
  { route: 'later', why: 'DIRECTION.md §3 — "Later: what you deferred"' },
  { route: 'note', why: 'DESIGN.md §5 — a note is a thing you open · §7 "editable and nameable, on its own page"; DIRECTION.md §7' },
  { route: 'record', why: 'DIRECTION.md §3 — "Reached only from a citation". No menu entry, no browse mode' },
  { route: 'sources', why: 'DIRECTION.md §3 "Under the bonnet"; DESIGN.md §4 — reached by the connector dots' },
];

const router = read('apps/shell/src/alerts/router.ts');
const declared = [...router.matchAll(/\|\s*\{\s*name:\s*'([a-z]+)'/g)].map((m) => m[1]!);
const uniqueDeclared = [...new Set(declared)].sort();
const allowed = SANCTIONED.map((s) => s.route).sort();

const extra = uniqueDeclared.filter((r) => !allowed.includes(r));
const missing = allowed.filter((r) => !uniqueDeclared.includes(r));

check(
  `the Route union is exactly the ${allowed.length} sanctioned routes`,
  extra.length === 0 && missing.length === 0,
  [
    extra.length ? `unsanctioned route(s): ${extra.join(', ')}` : '',
    extra.length
      ? 'A new route is a new DESTINATION. DIRECTION.md §3 lists four pages plus\n' +
        'Sources and the record views, and every one of them passed the test\n' +
        '"can you name the moment somebody opens it, and what they do next?"\n' +
        'If this route genuinely belongs, add it to SANCTIONED with the document\n' +
        'section that allows it. If you cannot name that section, it does not belong.'
      : '',
    missing.length ? `sanctioned but absent: ${missing.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n'),
);

// ---------------------------------------------------------------------------

section('the toolbar is capped, and the cap is read from the design');

/**
 * Parsed from `DESIGN.md` §4 rather than restated, so the document is the thing
 * that decides. Its phrasing — "A permanent **toolbar** of exactly three:
 * `Alerts 3 · Later 2 · Ask`" — is what this reads.
 */
const design = read('docs/DESIGN.md');
const barLine = /toolbar\*?\*? of exactly (\w+):\s*`([^`]+)`/.exec(design);
check('DESIGN.md §4 still states the toolbar', !!barLine,
  'The sentence this parses has been reworded. Update the regex AND confirm the\n' +
  'cap still holds — do not delete the check because the sentence moved.');

if (barLine) {
  const spelled: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const cap = spelled[barLine[1]!.toLowerCase()] ?? Number(barLine[1]);
  const names = barLine[2]!.split('·').map((s) => s.trim().replace(/\s+\d+$/, ''));

  /**
   * Scoped to the entries that carry a `to:` — the connector dots in the same
   * file are also `label:`d, and reading both reported an eight-entry toolbar.
   * The dots are Sources' door, not a nav item (`DESIGN.md` §4).
   */
  const chrome = read('apps/shell/src/alerts/Chrome.tsx');
  const items = [...chrome.matchAll(/to:\s*\{[^}]*\},\s*label:\s*'([A-Za-z ]+)'/g)].map((m) => m[1]!);

  check(`the toolbar has exactly ${cap} entries`, items.length === cap,
    `DESIGN.md §4: "Three is the ceiling — a fourth entry and it drifts back\n` +
    `toward the launcher-for-tools look the vendor panes were deleted to escape."\n` +
    `found: ${items.join(' · ') || '(none)'}`);

  check(`they are ${names.join(' · ')}`, items.join('|') === names.join('|'),
    `design says: ${names.join(' · ')}\ncode says:   ${items.join(' · ')}`);
}

// ---------------------------------------------------------------------------

section('the replaced architecture has not grown back');

/**
 * Vocabulary that belongs to the pane app — checked where it would MEAN
 * something, which is not everywhere the word appears.
 *
 * The first version banned `proposal` outright and failed on
 * `result.proposal.evidence.length`, which is correct code: a `Proposal` is
 * `act.ts`'s mechanism for a write and its provenance, and reading a count off
 * one to say "it carries 2 citations" is not a queue. Banning the mechanism
 * because a screen misused it is how a check gets switched off.
 *
 * So two narrower rules, each aimed at the actual failure:
 *
 * - **user-visible copy** — a string literal or JSX text a reader would see.
 *   The removed page had a `Queue` heading and "drafts waiting for you".
 * - **an identifier** — a component, hook or file named for the concept. The
 *   removed page was `Queue.tsx` exporting `Queue` and `usePendingProposals`.
 *
 * A property access or a type field is neither, and is left alone.
 */
const BANNED: { word: RegExp; why: string }[] = [
  { word: /\bproposals?\b/i, why: 'DIRECTION.md and DESIGN.md never use the word. A Proposal is act.ts\'s\nmechanism for a write, not something a person is shown. The alert page is\nthe review surface — see the withdrawn A17 in ROADMAP.md.' },
  { word: /\bqueue\b/i, why: 'The proposal queue was a chat-panel concept and was deleted with the pane app.' },
  { word: /\bstoryline\b|\bfocus lens\b/i, why: 'DIRECTION.md §3 "Deleted as destinations" — demoted to evidence, not somewhere you go.' },
  { word: /\[\[[a-z0-9-]+\]\]/i, why: 'A vault wikilink. Wikilinks are internal to vault storage and appear nowhere\nin the interface; one reached the screen only via the removed queue.' },
];

const SHELL_FILES = [
  'Actions.tsx', 'AlertApp.tsx', 'AlertList.tsx', 'AlertPage.tsx', 'Answer.tsx',
  'Ask.tsx', 'AskInline.tsx', 'Chrome.tsx', 'ConversationPage.tsx', 'DatePicker.tsx',
  'Later.tsx', 'NotePage.tsx', 'RecordView.tsx', 'Sources.tsx', 'Thread.tsx',
  'api.ts', 'chat.ts', 'conversations.ts', 'router.ts',
];

/** A string literal or a run of JSX text — the things a reader actually sees. */
function visibleText(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const [i, line] of stripComments(src).split('\n').entries()) {
    for (const m of line.matchAll(/'([^']{2,})'|"([^"]{2,})"|`([^`]{2,})`/g)) {
      out.push({ line: i + 1, text: m[1] ?? m[2] ?? m[3] ?? '' });
    }
    /**
     * JSX text: what is left once tags and expressions are removed — and only
     * if what remains is prose.
     *
     * Without the last test this reported `{result.proposal && (` and
     * `proposal?: { … };` as things "shown to a reader", because a `{` opened on
     * one line and closed on another survives the expression strip. A check that
     * cries wolf on correct code is a check somebody deletes.
     */
    const jsx = line.replace(/<[^>]*>/g, ' ').replace(/\{[^}]*\}/g, ' ').trim();
    if (jsx && /[a-z]{3}/i.test(jsx) && !/[{}();=&|?:[\]]|=>/.test(jsx)) {
      out.push({ line: i + 1, text: jsx });
    }
  }
  return out;
}

/** A declared name — component, hook, const, type. */
function identifiers(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const [i, line] of stripComments(src).split('\n').entries()) {
    for (const m of line.matchAll(
      /\b(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      out.push({ line: i + 1, text: m[1]! });
    }
  }
  return out;
}

for (const { word, why } of BANNED) {
  const hits: string[] = [];
  for (const f of SHELL_FILES) {
    const src = read(`apps/shell/src/alerts/${f}`);
    for (const v of visibleText(src)) {
      if (word.test(v.text)) hits.push(`${f}:${v.line}  shown to a reader: ${v.text.slice(0, 62)}`);
    }
    for (const id of identifiers(src)) {
      if (word.test(id.text)) hits.push(`${f}:${id.line}  named for it: ${id.text}`);
    }
  }
  const label = word.source.replace(/\\b|[()?]|i$/g, '').split('|')[0]!.slice(0, 24);
  check(`nothing in the interface is called "${label}"`, hits.length === 0,
    `${why}\n${hits.join('\n')}`);
}

/**
 * And no FILE is named for one either.
 *
 * The cheapest possible check on the failure that happened: the page arrived as
 * `Queue.tsx`. A component file in this directory is a screen, and the screens
 * are listed in `DIRECTION.md` §3.
 */
const SANCTIONED_COMPONENTS = new Set([
  // Pages — DIRECTION.md §3, each one having passed "can you name the moment
  // somebody opens it, and what they do next?"
  'AlertList.tsx',  // §3 — Mission Control
  'AlertPage.tsx',  // §3 — the alert
  'Later.tsx',      // §3 — Later
  'RecordView.tsx', // §3 — reached only from a citation
  'Sources.tsx',    // §3 — under the bonnet
  // Not pages. A control or a frame is not a destination, and the rule this
  // check enforces is about destinations — but it is still a list, because an
  // unlisted file here is how the last one arrived.
  'AlertApp.tsx',   // the router host
  'Chrome.tsx',     // DESIGN.md §3 §4 — the app window, top bar, toolbar
  'Actions.tsx',    // DESIGN.md §7 — the four actions, part of the alert
  'DatePicker.tsx', // DESIGN.md §6 "The calendar is ours" · §7 "pick a date"
  'NotePage.tsx',   // DESIGN.md §5 §7 — editing happens on a page, not in a row
  'Ask.tsx',              // DIRECTION.md §3 §9 — conversations, and the composer that starts one
  'ConversationPage.tsx', // DIRECTION.md §3 §8 — the thread that outgrew its alert
  'AskInline.tsx',        // DIRECTION.md §8 — asking in place, capped tail
  'Thread.tsx',           // the turns and the composer, shared so the two views cannot disagree
  'Answer.tsx',           // DIRECTION.md §9 — "it cites like the page does"
]);
const onDisk = readdirSync(join(ROOT, 'apps/shell/src/alerts'))
  .filter((f) => f.endsWith('.tsx'));
const unexpected = onDisk.filter((f) => !SANCTIONED_COMPONENTS.has(f));
check('every component in alerts/ is one the design sanctions', unexpected.length === 0,
  `unexpected: ${unexpected.join(', ')}\n` +
  'A new component here is usually a new screen, and DIRECTION.md §3 lists the\n' +
  'screens — every one having passed "can you name the moment somebody opens it,\n' +
  'and what they do next?". Add it to SANCTIONED_COMPONENTS with the section\n' +
  'that sanctions it. If you cannot name one, do not add the file.');

// ---------------------------------------------------------------------------

section('no comment sends a reader to a screen that was deleted');

/**
 * THE INVERSE OF THE SCAN ABOVE, and it has to be.
 *
 * Everything above strips comments and then reads the shell's visible copy and
 * its identifiers, because that is where a rebuilt destination shows up: the
 * failure arrived as `Queue.tsx` exporting `Queue`. The gateway has neither —
 * no visible copy, no page components — so pointing the same mechanism at it
 * finds nothing. Its failure lives IN the comments, which is exactly what the
 * scan above throws away.
 *
 * That is not hypothetical. `act.ts` and `main.ts` said accepting a proposal was
 * "a separate act somebody performs in the queue" while no such screen existed,
 * a reader concluded the queue was missing rather than that the sentence was
 * stale, and built one. Every check above was green throughout, because the
 * sentence was a comment and it was in the gateway.
 *
 * WHY THIS IS A SHAPE AND NOT A WORD LIST. Banning the nouns outright fails on
 * eight correct lines the day it is written: `buildStoryline` is deliberately
 * kept as the specification for `DIRECTION.md` §1's evidence view, the surviving
 * `pane` references are the record of WHY a destination was deleted, and
 * "a queue that shows you the same decision twice is a queue people stop
 * reading" is the whole justification for `dedupeKey`. That is the same mistake
 * the first cut of BANNED made when it failed on `result.proposal.evidence
 * .length`, and a check that cries wolf is a check somebody switches off.
 *
 * So the rule is the grammar, not the vocabulary. A preposition and a DEFINITE
 * article presuppose the thing exists — "accept it in the queue", "the note
 * opens in the Vault pane" — and that is a pointer. An indefinite article is an
 * argument about a concept and is left alone. Measured when it was added: it
 * catches all three sentences that had actually caused defects here, and fires
 * on nothing that was correct.
 *
 * SINGULAR ONLY, for the same reason. A pointer names ONE place you go; the
 * plural is the collective, which is how the deleted architecture is referred
 * to whenever a file records why something went — `AlertApp.tsx` opens "WHAT
 * HAPPENED TO THE PANES. They are gone", and that sentence is the reason the
 * rule exists, not a breach of it.
 */
const POINTER = /\b(?:in|into|from|on|onto|via|to|through) the (?:[A-Za-z]+ )?(?:queue|pane|storyline lens|focus lens)\b/i;

/** Every comment, with its line — the half `stripComments` discards. */
function commentText(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  let inBlock = false;
  src.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const t = raw.trim();
    if (inBlock) {
      out.push({ line, text: t.replace(/^\*\s?/, '').replace(/\*\/$/, '') });
      if (t.includes('*/')) inBlock = false;
      return;
    }
    if (t.startsWith('/*')) {
      out.push({ line, text: t.replace(/^\/\*+\s?/, '') });
      inBlock = !t.includes('*/');
      return;
    }
    if (t.startsWith('//')) { out.push({ line, text: t.replace(/^\/\/\s?/, '') }); return; }
    // A trailing comment. `://` guards the one false positive worth guarding:
    // a URL in a string literal is not a comment.
    const m = /\/\/(.*)$/.exec(raw);
    if (m && !raw.includes('://')) out.push({ line, text: m[1]! });
  });
  return out;
}

/**
 * Comments are wrapped, so a pointer routinely straddles two lines — the real
 * `act.ts` defect read "…is a separate act somebody / performs in the queue".
 * Each line is therefore tested joined to the one after it, and reported
 * against the line the phrase STARTS on.
 */
function pointersIn(path: string): { line: number; text: string }[] {
  const cs = commentText(read(path));
  const hits: { line: number; text: string }[] = [];
  cs.forEach((c, i) => {
    const joined = `${c.text} ${cs[i + 1]?.line === c.line + 1 ? cs[i + 1]!.text : ''}`;
    const m = POINTER.exec(joined);
    // Only report on the line the match begins on, or a two-line phrase counts twice.
    if (m && m.index < c.text.length) hits.push({ line: c.line, text: joined.trim() });
  });
  return hits;
}

/** Everything that reasons about the product, which is everything but the tests. */
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    if (e.isDirectory()) out.push(...sourcesUnder(`${dir}/${e.name}`));
    else if (/\.(ts|tsx|mts)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(`${dir}/${e.name}`);
  }
  return out;
}

const SCANNED = [
  ...sourcesUnder('apps/gateway/src'),
  ...sourcesUnder('apps/shell/src'),
  ...sourcesUnder('libs/domain/src'),
  ...sourcesUnder('libs/vault/src'),
  ...sourcesUnder('libs/connectors/src'),
];

const pointers = SCANNED.flatMap((f) => pointersIn(f).map((h) => ({ file: f, ...h })));

check(
  `no comment points at a deleted destination (${SCANNED.length} files)`,
  pointers.length === 0,
  [
    ...pointers.map((p) => `${p.file}:${p.line}\n  ${p.text.slice(0, 96)}`),
    '',
    'A preposition plus "the" presupposes the place exists, so this reads as a',
    'pointer rather than as an argument. DIRECTION.md §3 lists four pages, and a',
    'queue and the vendor panes are not among them — see the withdrawn A17 in',
    'ROADMAP.md, which is exactly this sentence shape going unchallenged.',
    '',
    'If the reasoning is still true, say it without the definite article: "two',
    'identical decisions to make" rather than "two of every proposal in the queue".',
  ].join('\n'),
);

// ---------------------------------------------------------------------------

section('a failed refetch does not replace what is on screen');

/**
 * `DESIGN.md` §7 and the preview: acting resolves IN PLACE. The subtle way to
 * break that is not to navigate — it is to let the refetch that follows an
 * action overwrite the result with an error.
 *
 * That is what happened. Answering the flagship alert makes the finding stop
 * firing, which IS the success, so `GET /api/findings/:id` 404s on the reload
 * the action triggers. `useJson` kept old data while a refetch was PENDING —
 * there is a paragraph in it about exactly this — and dropped it when the
 * refetch FAILED, so the page swapped "created" for "That alert is not there"
 * before anybody could read it. The POST returned 200 and the screen said the
 * opposite of the truth.
 *
 * So: a page may show an error INSTEAD of content, never OVER it. In practice
 * that means every error branch is gated on the absence of data.
 */
{
  const badGate = SHELL_FILES
    .map((f) => ({ f, src: read(`apps/shell/src/alerts/${f}`) }))
    .filter(({ src }) => /\{\s*error\s*&&\s*\(/.test(src) || /if\s*\(\s*error\s*\|\|/.test(src))
    .map(({ f }) => f);

  check('every error branch yields to data the reader can already see', badGate.length === 0,
    `${badGate.join(', ')}\n` +
    'Gate it on `!data`: `{error && !data && (…)}`, or `if (!data)`. A banner\n' +
    'saying the thing is not there, rendered over the thing, is worse than\n' +
    'saying nothing — and it is what destroyed the result strip after an action.');

  const api = read('apps/shell/src/alerts/api.ts');
  check('`useJson` keeps its data when a refetch fails',
    /catch\([^)]*\)\s*=>[\s\S]{0,200}setState\(\s*\(prev\)/.test(api),
    'The catch replaces state instead of merging into it, so a failed refetch\n' +
    'clears `data` and every page above falls to its empty state.');
}

// ---------------------------------------------------------------------------

section('the page shapes and the one stylesheet');

const acts = read('apps/shell/src/alerts/Actions.tsx');
const actionButtons = (acts.match(/<button/g) ?? []).length;
check('the alert still offers four actions', /PRIMARY\[/.test(acts) && /DISMISS\[/.test(acts) && actionButtons >= 4,
  'DIRECTION.md §7 and DESIGN.md §7: four actions, and TWO of them are "no",\n' +
  'because "not needed" and "not now" are different answers. Collapsing them is\n' +
  'what leaves Later empty.');

check('the result of an action resolves in place',
  !/hrefFor\(\{\s*name:/.test(acts) && !/\bgo\(/.test(acts),
  'design-preview.html: clicking an action replaces the block with the result\n' +
  'and a `choose something else` link. There is NO navigation — the alert page\n' +
  'is where the decision is made and where it is reported.');

check('the result offers `choose something else`', /choose something else/.test(acts),
  'DESIGN.md §7 — acting stays undoable, in place, with no timer and no confirm.');

for (const f of SHELL_FILES) {
  const src = read(`apps/shell/src/alerts/${f}`);
  if (/style=\{\{/.test(stripComments(src))) {
    check(`no inline styles in ${f}`, false,
      'DESIGN.md §3: "There are none in the preview, deliberately. Inline styles\n' +
      'are where ad-hoc spacing accumulates, and every spacing bug found so far\n' +
      'started as one."');
  }
}
check('no inline styles anywhere in the alert app',
  !SHELL_FILES.some((f) => /style=\{\{/.test(stripComments(read(`apps/shell/src/alerts/${f}`)))));

/**
 * One stylesheet, one design system.
 *
 * `app.css` is the preview's, copied verbatim. It may restate a rule the preview
 * writes against a different element, and nothing more — a second component
 * library and a second set of colour tokens is what the pane retirement removed,
 * and 628 kB → 211 kB is what it was worth.
 */
const previewCss = /<style>([\s\S]*?)<\/style>/.exec(read('docs/design-preview.html'))?.[1] ?? '';
const previewLines = new Set(previewCss.split('\n').map((l) => l.trim()).filter(Boolean));
const ALLOWED_LOCAL = [
  '.app-shell',       // the mount wrapper; the preview is a standalone page
  'a.evrow',          // an anchor where the preview writes a button — CLAUDE.md
  'a.rowmain',        // the same
  '@media',
];
const newSelectors = read('apps/shell/src/app.css')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.endsWith('{') && !previewLines.has(l))
  .filter((l) => !ALLOWED_LOCAL.some((a) => l.startsWith(a)));

check('app.css introduces no selectors the preview does not have',
  newSelectors.length === 0,
  'DESIGN.md: the preview wins where the two disagree — it is the version tested\n' +
  'in a browser, so a design change belongs there FIRST and here second.\n' +
  newSelectors.join('\n'));

// ---------------------------------------------------------------------------

section('the design drawn but not built');

/**
 * The other direction, and it REPORTS rather than fails.
 *
 * The check above asks "has the app invented CSS the preview does not have",
 * which catches a second design system growing. It never asked the opposite:
 * **which preview classes does the app never use?** That set is, almost exactly,
 * the design that has not been built yet — the preview is committed, complete
 * and drawn from the decisions, so a class with no consumer is a screen or an
 * affordance nobody has got to.
 *
 * It was worth having because three items went unnoticed for exactly as long as
 * nothing asked: the Slack notification (`DIRECTION.md` §2 lists it under
 * SETTLED and the preview draws the whole window), the chat drawing a dependency
 * chain instead of describing it (§9's third rule), and the offer to park a
 * finding in Later (§9). All three pass every other check in this file.
 *
 * WHY IT MUST NOT FAIL THE BUILD. Unbuilt design is not drift. If this exited
 * non-zero the cheapest way to green would be deleting the class from the
 * preview — which destroys the only record that the thing was ever designed, and
 * turns a useful inventory into a reason to forget. A verifier that punishes an
 * honest backlog gets one commit of obedience and then gets gamed.
 */
/**
 * Every class the preview's stylesheet defines.
 *
 * Selectors are the text between one brace and the next `{`, which is the only
 * reading that survives BOTH shapes the preview uses — the multi-line
 * `.chip {\n  …` and the single-line `.chain { display:flex; … }`. A first
 * version filtered for lines *ending* in `{` and silently dropped every
 * one-liner, which is most of the small stuff and included `.chain` itself: the
 * report then omitted one of the three things it was written to find.
 *
 * At-rule preludes (`@media …`) are skipped; rules nested inside them are still
 * matched, because the scan is over braces rather than over lines.
 */
const previewClasses = new Set<string>(
  [...previewCss.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/([^{}]+)\{/g)]
    .map((m) => m[1]!.trim())
    .filter((prelude) => !prelude.startsWith('@'))
    .flatMap((prelude) => [...prelude.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]!)),
);

/**
 * Every string literal in a fragment of source, including inside a template's
 * `${…}` substitutions.
 *
 * Naive quote-pairing with a regex cannot read `` `line${isHit ? ' hit' : ''}` ``:
 * it pairs the opening backtick with the quote inside the substitution, and the
 * class ` hit` disappears into the gap. That is a false "built", which is the one
 * error this report must not make — a wrong entry is a line somebody checks, a
 * missing entry is silence.
 */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const q = src[i];
    if (q !== '"' && q !== "'" && q !== '`') continue;
    let text = '';
    let j = i + 1;
    for (; j < src.length && src[j] !== q; j++) {
      if (src[j] === '\\') { j++; continue; }
      if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
        let depth = 1;
        let k = j + 2;
        for (; k < src.length && depth > 0; k++) {
          if (src[k] === '{') depth++;
          else if (src[k] === '}') depth--;
        }
        // Recurse: a class often lives inside the substitution, not beside it.
        out.push(...stringLiterals(src.slice(j + 2, k - 1)));
        j = k - 1;
        continue;
      }
      text += src[j];
    }
    out.push(text);
    i = j;
  }
  return out;
}

/**
 * What the app actually uses, read out of `className` values and nowhere else.
 *
 * TWO WIDER READINGS, both wrong. A bare substring search over the file — the
 * one-liner in `CLAUDE.md` — counts a class as used when its name appears in a
 * comment or in prose, and every class this exists to find is an ordinary word
 * (`chain`, `attach`, `avatar`), so it hides exactly the interesting ones. Every
 * string literal in the file is wrong the other way: the token `notes` falls out
 * of `'/api/vault/notes'` and marks `.notes` as built.
 */
function classNameValues(src: string): string[] {
  const out: string[] = [];
  const at = /className\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = at.exec(src))) {
    const i = m.index + m[0].length;
    if (src[i] === '{') {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
      }
      out.push(src.slice(i + 1, j));
    } else {
      // A plain quoted value; hand it over WITH its quotes so the same scanner reads it.
      const end = src.indexOf(src[i]!, i + 1);
      if (end > i) out.push(src.slice(i, end + 1));
    }
  }
  return out;
}

const usedClasses = new Set<string>(
  SHELL_FILES.flatMap((f) => classNameValues(stripComments(read(`apps/shell/src/alerts/${f}`))))
    .flatMap((v) => stringLiterals(v))
    .flatMap((v) => v.split(/[^a-z0-9-]+/i)),
);

/**
 * Classes the app composes at RUNTIME, from data rather than from a literal.
 *
 * `` className={`chip ${f.severity}`} `` never contains the word `crit`, so no
 * amount of scanning finds it. These are the domain unions that reach the
 * stylesheet, and they are listed explicitly for the same reason `SANCTIONED`
 * is: a glob would quietly absorb a genuinely unbuilt class the day somebody
 * added one with a similar name.
 */
const DYNAMIC = new Map<string, string>([
  ['crit', 'Finding.severity → `chip ${severity}`, `row ${severity}`'],
  ['warn', 'Finding.severity'],
  ['jira', 'Evidence.surface → `dot ${dotClass(surface)}`'],
  ['slack', 'Evidence.surface'],
  ['zoom', 'Evidence.surface'],
  ['conf', 'Evidence.surface — dotClass() maps confluence → conf'],
  ['miro', 'Evidence.surface'],
  ['github', 'Evidence.surface'],
  ['vault', 'Evidence.surface'],
  ['missing', 'a chain node with no ticket → `node ${tag}` in Answer.tsx'],
  ['at-risk', 'a chain node that will slip → `node ${tag}`'],
]);

/**
 * The preview is eight `<section class="screen" id="scr-…">` blocks plus a
 * `div.proto` bar, which is what makes this report worth reading rather than a
 * word list: an unused class can be attributed to the SCREEN it belongs to, so
 * the output names the thing that is missing instead of its CSS.
 *
 * `#scr-map` is the prototype's index of screens and `div.proto` is its tab bar.
 * Both are scaffolding — the preview says so at the top of the file — so a class
 * appearing ONLY there is correctly unused, and an app consumer for one would be
 * the defect.
 */
const previewHtml = read('docs/design-preview.html');

type Region = { id: string; from: number; to: number };
const regions: Region[] = [];
for (const m of previewHtml.matchAll(
  /<div class="proto">|<section class="screen" id="(scr-[a-z]+)"|<script>/g,
)) {
  regions.push({ id: m[1] ?? (m[0] === '<script>' ? 'answers' : 'proto'), from: m.index!, to: previewHtml.length });
}
regions.forEach((r, i) => { if (regions[i + 1]) r.to = regions[i + 1]!.from; });

/**
 * `answers` is the trailing `<script>` — the preview's canned chat replies, which
 * are markup too. Without a region of its own it lands inside whichever section
 * happens to be last in the file, and the chat's dependency-chain classes were
 * duly reported against **Sources**, which is nowhere near the truth.
 */
const SCAFFOLDING = new Set([
  'proto',    // the prototype's tab bar; the file says so at the top
  'scr-map',  // its index of screens — a map of the product, not a screen of it
  /**
   * `#scr-slack` DEPICTS SLACK. It is not a screen of this app and never will
   * be: a fake Slack window — channel bar, avatar, `APP` tag, message, button —
   * drawn to show what arrives before you have opened anything.
   *
   * The test this whole report applies is "does the app render this?", and for
   * a third party's chrome the answer is structurally no however much of the
   * notification gets built. Left in, it would report eight classes for ever,
   * and a permanently noisy check is one people stop reading — which is the
   * failure this was written to avoid, arriving from the other side.
   *
   * The notification itself is real and is built: `slackBot` in `notify.ts`
   * composes exactly this message in Block Kit. What cannot be built is Slack.
   */
  'scr-slack',
]);

/**
 * The per-screen annotation the preview wraps every mock in: the frame, the
 * sentence under it and the notes panel beside it. `CLAUDE.md` already names
 * these four as "preview-only rules that match nothing", and they appear on
 * every screen, so without this the report is the same four words eight times.
 */
const PREVIEW_CHROME = new Set(['screen', 'caption', 'notes', 'switch']);

/** class name → the regions that draw it. */
const drawnIn = new Map<string, Set<string>>();
for (const m of previewHtml.matchAll(/class="([^"]+)"/g)) {
  const region = regions.find((r) => m.index! >= r.from && m.index! < r.to);
  /**
   * The preview's script builds class lists by concatenation —
   * `'<div class="turn ' + who + '">'` — and a naive read of the attribute
   * takes `who` for a class name. It is a variable, and `.who` in the
   * stylesheet is `.msg .who`, which belongs to the Slack message and not to a
   * chat turn. A real class list has no quote or `+` in it.
   */
  if (/["'`+]/.test(m[1]!)) continue;
  for (const cls of m[1]!.split(/\s+/).filter(Boolean)) {
    if (!drawnIn.has(cls)) drawnIn.set(cls, new Set());
    if (region) drawnIn.get(cls)!.add(region.id);
  }
}

const unexplained = [...previewClasses]
  .filter((c) => !usedClasses.has(c) && !DYNAMIC.has(c) && !PREVIEW_CHROME.has(c))
  .filter((c) => {
    const where = drawnIn.get(c);
    // Drawn only by the prototype's own chrome, or defined and never drawn.
    return !!where && where.size > 0 && [...where].some((r) => !SCAFFOLDING.has(r));
  })
  .sort();

const byScreen = new Map<string, string[]>();
for (const c of unexplained) {
  for (const r of drawnIn.get(c)!) {
    if (SCAFFOLDING.has(r)) continue;
    if (!byScreen.has(r)) byScreen.set(r, []);
    byScreen.get(r)!.push(c);
  }
}

if (byScreen.size === 0) {
  console.log('  ok     every class the preview draws has a consumer in the app');
} else {
  console.log(`  note   ${unexplained.length} class(es) the preview draws and the app never uses:`);
  for (const [screen, classes] of [...byScreen].sort()) {
    console.log(`           #${screen.padEnd(11)} ${classes.sort().join(', ')}`);
  }
  console.log('         Design that is drawn and not built — NOT a failure, and not');
  console.log('         drift. See ROADMAP.md "What verification found" (G1) before');
  console.log('         deleting any of it: the preview is the record that it was designed.');
}

// ---------------------------------------------------------------------------

console.log(
  failed
    ? `\n${failed} design check${failed === 1 ? '' : 's'} failed — the app has drifted from docs/DIRECTION.md and docs/DESIGN.md\n`
    : '\nthe app matches the design\n',
);
process.exit(failed ? 1 : 0);
