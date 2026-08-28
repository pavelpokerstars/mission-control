---
name: mc-interface
description: The shipped screens of Mission Control and the rules that keep them matching the design: apps/shell/src/alerts/, the four pages, the record views, the seventeen-file stylesheet split and its load order, routing on the path, the self-hosted typefaces, the connector dots, the notification, answering an alert, and Sources. Also the browser and layout rules the evidence view will need. Use when touching anything under apps/shell/, docs/design-preview.html, docs/DESIGN.md or scripts/verify-design.mts — or when building, restyling, routing, or checking any screen, component, stylesheet or citation.
---

# The interface

Area depth for Mission Control. Read `CLAUDE.md`'s "Before you build a screen" first — it is
in the core because it is the section this project has already paid for twice, and nothing
here replaces it. `docs/design-preview.html` still wins over every word below.

## The notification

**A notification carries a POINTER, never a quote** (`apps/gateway/src/notify.ts`).
That is a constraint rather than a style choice: transcripts and the claims read
out of them do not leave the machine holding them, so a notification containing
the evidence has moved the evidence. It carries what fired, how bad, and a deep
link; the quote lives on the alert page, behind the boundary.

It also makes every transport safe. A hosted chat carrying a real citation is
ruled out; one carrying "PAY-9031: two sources disagree → open it" is not.

**The Slack bot is the second transport, and it needs no hosting decision.**
`MC_SLACK_WEBHOOK_URL` turns it on; absent, the review inbox runs alone.
`DIRECTION.md` §2 settled it — *"notifications via a Slack bot on our own
server; the company Slack cannot be posted to"* — and the message is the one
`design-preview.html` draws at `#scr-slack`: a greeting with the count, ONE
claim, and a button.

**An incoming webhook, not a bot token**, and that is what keeps it independent
of **D4**. The button is a Block Kit `url` button, so Slack never posts anything
back; an interactive app would need a public HTTPS request URL and therefore
somewhere to host it. One env var, one outbound POST, no inbound anything.

`Transport.sendDigest` is optional and exists because a chat channel is a shared
room: three pings at 07:00 is how a channel gets muted, which costs every future
`crit`. The count is **everything that needs a person**, not just what is new,
so the message and the front door's headline state the same number; the *lead*
is the worst of the fresh ones, and a run with nothing fresh sends nothing.

**`deliver()` in `notify.ts`, not in the scheduler.** The inbox is first and it
is the one that writes `mc.memory_surfaced`, so a webhook that is down costs the
interruption and nothing else — the finding is still on the front door and will
not be announced twice when the webhook returns. Nothing throws; the failed
transports are returned. Verified against a local receiver: dead webhook →
`{failed:['slack'], inboxRecorded:true}`.

`/api/health` reports `notify` — which transports will carry the next run, and
`host` — which interface this instance actually bound.

**The boundary is a machine, and the gateway binds `127.0.0.1` to say so.**
`ROADMAP.md` D4: single-tenant, self-hosted, on one machine inside the evidence
boundary — forced by a person's login rather than a service account (Copilot,
the Claude CLI, and the Zoom profile that *is* the credential), by a vault with
one writer, and by the pointer-never-a-quote rule three paragraphs above. That
rule and this bind are the same argument: the first says the evidence does not
leave the machine, the second says which machine. It used to be
`app.listen(PORT)`, binding every interface, while the shell beside it already
bound loopback.

`MC_BIND` is the opt-out — containers and devcontainers cannot use a loopback
bind — and it logs a warning at boot naming the absence of authentication,
because an opt-out nobody is warned about is how the property rots.

**Do not "fix" a vendor webhook by binding `0.0.0.0`.** That is the specific
wrong move this pre-empts: it exposes an unauthenticated gateway — every route,
the vault writes and `POST /api/tools/:name` included — to buy a fast path the
07:00/19:00 re-derive and `canvas-poll.ts` already cover as the other cadence.
The bind does not make the gateway safe to expose; it makes exposing it
deliberate. `KNOWN-GAPS.md` §3 still owns authentication, CORS and webhook
signatures, and D4 does not licence starting any of them.

**The review inbox is the default and always works, because the alert list
already is one.** It writes to the durable log, so "notified" is a fact with a
timestamp rather than a hope about a third party — and `notifiedIds` asks that
same log, so a restart cannot re-announce what somebody was already told. This is
the consumer `dedupeKey` was waiting for.

**`ok` never notifies.** It is a note in the margin, and an interruption about one
teaches people to mute the channel, which costs every future `crit`. The front
door still shows them.

**A baseline run notifies nobody, whatever it found** — the first pass sees every
finding as new, and on a real programme that is a morning of alerts about a
quarter of history.

## Answering an alert

**`POST /api/findings/:id/act` takes one of four**, and `apps/gateway/src/act.ts`
is the whole of it. Note what the route CANNOT do: it produces proposals, notes
and log entries, never a vendor write. Accepting a proposal is a separate act
over `/api/tools/accept_proposal` performed by a person, so the worst a mis-click
achieves is a pending proposal — `HUMAN_ONLY` keeps both accept and reject away
from every provider, which is why that separation is a fact about the tool set
rather than a sentence in a prompt.

**Two of the four are "no", and they are different answers.** "Not needed" is a
decision and does not come back; "Not now" asks for a note and when it should
return. Collapsing them is what leaves Later empty — everything either nags
forever or vanishes. The note is the point, not the date: a snooze that records
only a date returns the same unexplained alert to somebody who has forgotten why
they pushed it away.

**Both land on the durable log** (`mc.finding_deferred`, `mc.finding_dismissed`)
and `suppressedIds` reads it **unwindowed**. An alert list is a promise that a
decision you made yesterday is still made today; a `since` here would silently
expire dismissals. A deferral with no parseable date is an event-based reminder
("when the sprint ends") and is held until something evaluates the watch —
re-raising what somebody explicitly parked is the fastest way to teach them the
list is not listening.

**`Note.about` ties a parked note to its finding.** `relatedKeys` cannot: a
finding is not a Jira key, and the flagship one is about the *absence* of one.

**The full loop, verified:** alert → `Create the ticket` drafts a `create_issue`
proposal carrying `noteId` → a human accepts → the ticket exists with a
provenance comment naming the meeting, the rationale and both citations with
their timestamps → the commitment gains the key → the alert stops firing.

## Sources — coverage, never content

**`GET /api/sources` counts the loaded graph and touches nothing.**
`apps/gateway/src/sources.ts`. Rows show what is *in scope* — which projects,
which channels, which board — and there is no route from a row into a record: the
moment one expands into a message list, the Slack pane is back with an extra
click in front of it (`DIRECTION.md` §6).

**The failures are the one exception, and they were nearly free.** The collectors
already drop an arrow whose ends do not both resolve to a key, a page naming no
ticket, a sticky empty after stripping — *silently*. Counting them instead of
discarding them is the whole change, and it is the most honest thing here: three
arrows pointing at something unresolvable is a dependency somebody believes they
expressed and this will never see.

**The tier counts are the credential.** EXTRACTED / INFERRED / AMBIGUOUS with a
sentence each, because the vocabulary means nothing to a reader who has not read
the schema — and the third is the interesting one, since an unsupported claim is
a finding rather than a defect.

**Its nesting is deliberate and the single-gutter check does not apply flat.**
`.stat`, `.conn-row` and `.block` each own `var(--gutter)`, so a container sits at
the app-window edge and its text at the gutter; a `.failbox` inside a block is
inset again. Measuring boxes and text together here reports three different x
values and nothing is wrong. Compare *comparable* elements.

## The interface — alert-first

**`apps/shell/src/alerts/` is the application.** `ls apps/shell/src/` returns
`alerts/`, `app.css`, `fonts.css`, `main.tsx`, `vite-env.d.ts` and nothing else.
Inside `alerts/`, **a component is a folder**: `AlertList/AlertList.tsx` beside
`AlertList/AlertList.css`, fifteen of them. `AlertApp` routes on the path, the
alert list is the front door, and an alert page is what a row opens.

**The name is repeated rather than an `index.tsx`, deliberately.** `index.tsx`
would keep the import specifiers shorter (`./AlertList` rather than
`./AlertList/AlertList`) and it costs fifteen editor tabs all called `index` and
a stack trace that names none of them. It also costs the verifier: every check
here is name-based — the sanctioned-component list, "is this stylesheet imported
by its component", "does any folder hold a `.tsx` not named after it" — and each
would have to reconstruct the identity from the parent directory.

**Only a PAIR gets a folder.** `api.ts`, `chat.ts`, `conversations.ts` and
`router.ts` draw nothing, have no stylesheet to pair with, and stay flat beside
the folders; so does `shared.css`, which is a layer rather than anybody's.
`main.tsx` mounts `AlertApp`, and Ask is built from `conversations.ts` and the
SSE loop in `chat.ts`.

**A folder holds exactly its pair, and `verify-design.mts` asserts it** — one
`.tsx` and one `.css`, both named for the folder. A third file there is
invisible: the sanctioned-component list reads folder NAMES now and
`SHELL_FILES` is written by hand, so a `.tsx` dropped inside an existing folder
escapes that list, the retired-vocabulary scan and the inline-style check all at
once. Measured before the check existed: `AlertPage/Queue.tsx`, exporting
`Queue`, heading "Proposals", inline style, the literal sentence "accept them in
the queue" — the whole verifier green. A second `.css` is the same hole and
tidier-looking: `STYLESHEETS` globs every one, so its rules count as present
while nothing imports the file and the screen renders without them.

**There is no proposal queue, and one was built and removed.** `act.ts` and
`Actions.tsx` both said accepting was "a separate act somebody performs in the
queue" while no such screen existed, so one was added — and it is not in the
design. `DIRECTION.md` §3 lists four pages and a queue is not among them;
**neither `DIRECTION.md` nor `DESIGN.md` contains the word "proposal" at all**;
and `design-preview.html`'s action handler replaces the block with the result in
place, with no navigation, reporting *"MC-112 created"*. The alert page is the
review surface. A `Proposal` remains the internal mechanism for the write and its
provenance — that is a fact about `act.ts`, not a screen.

It also dragged vault vocabulary onto the interface: proposal evidence labels are
written as `[[note-id]] kind: title` by `skills.ts` and `sync.ts`, so the page
rendered raw wikilinks. Findings evidence carries none and the alert app has no
wikilink handling — the leak existed only because that page did.

**The result strip carries `choose something else`**, which is in the preview and
is `DESIGN.md` §7's "acting stays undoable" applied to an action. It re-renders
the four buttons; it does **not** reverse the effect, and must not be worded as
though it does.

**Every count in the toolbar and on the list re-reads on navigation.** `useJson`
refetches on its path and these paths never change, so the counts were whatever
they were at boot: accepting a proposal or parking an alert left the badge beside
it stating the old number. That is `DESIGN.md` §8 arrived at backwards — the
count was read from the collection, and then the collection was never read
again. The effect is keyed on the route, and `reload` is held in a ref because
it is a fresh closure every render and naming it in the deps re-runs forever.

**The preview does two things to a screen and only one of them is the
product's — and the `.app-shell` block is where that is settled.**

It draws each screen as a **floating window**: a border, a radius and a shadow on
`.appwin`, inset in a `--ground` margin. That framing is the DOCUMENT's, because
it is how you show a picture of an app on a page about the app, and shipped as
drawn the real thing reads as itself running inside a picture of itself. It is
gone.

It also **caps the measure** — `main { max-width:1000px; margin:0 auto }` — and
that half IS the product's. Removing the frame took the measure with it, and a
paragraph is only readable for so many characters however wide the monitor: on a
1440 display the row headings ran 1307px and the evidence quotes 1324px against
the preview's ~900. So the container is back without the frame, and 1000px is
the preview's own number rather than a new one — an earlier version invented
`860px`, which looked fine and was 140px narrower than the design at every width
above 1000, and nothing about that is visible without measuring two pages side
by side.

**ONE SURFACE, NOT TWO.** `.app-shell` carries `--app` rather than `--ground`,
so the page is a single colour edge to edge and the centred column has no visible
boundary: what centres is the content and the hairlines between bands, the way a
modern page centres an article. Left on `--ground`, a flat panel would read as
the window again minus its frame, which is the worst of both.

Every band still pads with `var(--gutter)`, so §8's single-x check holds
unchanged — measured at 1440, every band edge resolves to x=220. The container
moves where that x falls and must not split it into several.
`verify-design.mts` allows these because they are scoped under `.app-shell`,
which exists nowhere but the app.

**The stylesheet is `docs/design-preview.html`'s, copied verbatim** — and it is
now seventeen files rather than one. `DESIGN.md` says the preview wins where the
two disagree, it being the version tested in a browser, so a design change
belongs in the preview first and here second. Which FILE a rule lives in changed;
no rule did. Its preview-only rules (`.screen`, `.caption`, `.notes`, `.switch`)
are still there and match nothing: stripping them looked worth doing and is
exactly the trap `DESIGN.md` §8 records, where a regex removes a selector, leaves
its block, keeps the brace count even and silently swallows the next rule. Dead
CSS is harmless; a stylesheet that lost a rule is invisible until one screen
renders with browser defaults.

**The connector strip carries SIX dots, and GitHub was missing from more than the
strip.** There was no `--s-github` token and no `.github` rule anywhere, so
`dotClass('github')` produced a class matching nothing and every GitHub dot
rendered transparent — on Sources, which lists it as a connected source with its
pull-request count, and on any evidence row citing a PR. The token is GitHub's
own merged-PR purple (`#6E40C9` / `#A371F7`), which is the one hue the five
existing surfaces leave open: jira blue, slack magenta, zoom cyan, confluence
green, miro amber.

**Six dots is not the same number as five collectors.** The collectors are Jira,
Zoom, Confluence, Slack and GitHub; Miro is the sixth *surface* and the one read
live rather than out of `MC_GRAPH_DIR`. Do not quote one count as the other.

**The two typefaces are self-hosted, and the app used to render in neither.**
`app.css`'s `--sans` and `--mono` name Instrument Sans and IBM Plex Mono;
`docs/design-preview.html` loads both from Google Fonts in its `<head>` and
`apps/shell/index.html` loaded nothing, so the browser fell silently through to
`ui-sans-serif` and `ui-monospace`. Every size, weight, line-height and
letter-spacing already matched the preview — measured side by side, the only
things that differed were the glyphs. That is the failure a font stack is
designed to hide: nothing errors, nothing logs, the page renders, and it is the
wrong typeface.

`apps/shell/src/fonts.css` declares the faces the preview asks for — Instrument
Sans 400/500/600/700 plus italic 400, IBM Plex Mono 400/500/600 — from
`@fontsource`, and `main.tsx` imports it **first**, before `app.css`. Two
choices in it are worth not undoing:

- **Self-hosted, not the preview's `<link>`.** The preview is a document you open
  once; the app is the product, and its standing promise is that it runs on
  committed fixtures with no credentials, no network and no server. Behind a
  proxy a CDN link renders the fallback again, which is the bug this closes.
- **The static package, not `@fontsource-variable`.** The variable one is one
  file instead of five and declares its family as `Instrument Sans Variable` —
  a name that would have to be added to `--sans`, which lives in the file that
  is the preview's copied verbatim. The static package declares
  `Instrument Sans`, so nothing in `app.css` moved.

**Check it with widths, never with `document.fonts.check()`** — that returns
true for a family with no `@font-face` at all. Measure a string in
`"Instrument Sans", monospace` against `monospace`; equal means the webfont is
absent.

**One design system, one file per component.**

| | |
|---|---|
| `apps/shell/src/app.css` | the tokens, the reset, the breakpoint, and the preview's own document chrome the app never renders |
| `alerts/shared.css` | what more than one screen draws — the chip, the greeting, the block, the composer, the thread, the select — plus the atoms whose class is interpolated (`dot ${surface}`) and so appears as a literal nowhere |
| `alerts/<Name>/<Name>.css` | what only that component draws, imported by the `.tsx` beside it |

Still no component library, no second reset and no second set of colour tokens:
~238 kB of JS and ~38 kB of CSS, the CSS grown by the vendored `@font-face`
blocks rather than by rules.

**THE ORDER IS A CONTRACT AND `main.tsx` STATES IT**: `fonts.css`, `app.css`,
`alerts/shared.css`, then each component's own file as the module graph reaches
it. Everything in the first two is a token, a reset or an element selector, so
they must come first; every component file loads after `shared.css` and can
therefore override it at equal specificity.

**`.claude/launch.json` has a third entry, `mission-control-built`, and it is
there for exactly this.** `npx vite preview` on port 4300 serves `dist/`, which
is the only way to look at the real bundle in a browser — the split's cascade,
the emitted `@font-face` blocks and the SPA fallback all behave slightly
differently there than under the dev server's module graph. Checked when the
split landed: identical computed styles on every screen, dev against built.

**Those three lines must sit ABOVE `import AlertApp`, and this is the same hazard
`env.ts` has in the gateway.** CSS is emitted in module-*evaluation* order, which
is depth-first: with the component import first, every component stylesheet in
its subtree arrives before the three, `shared.css` lands last, and it beats the
files it is supposed to lose to. Measured on the first build after the split —
`.appwin` at byte 0 of the stylesheet and the tokens at 26056. **The dev server
does the same**, Vite evaluating the ESM graph depth-first too, so it is visible
in a browser either way. `verify-design.mts` asserts the four lines rather than
trusting them: deleting the `shared.css` import outright — the chip, the
greeting, the block, the composer, the thread and the select — was green
before it did.

**Between component files, order must not matter — and that is a rule, not a
hope.** Nothing pins the module graph's order, so a class rendered by two
components goes in `shared.css`. `verify-design.mts` asserts it
(*no scoping class is claimed by two component stylesheets*), and asserts the
other thing neither typecheck can see: **every component stylesheet is imported
by its own component.** A `.css` file is invisible to `tsc` — orphan one and its
rules simply stop arriving, on one screen, with nothing failing anywhere.

**The phone breakpoint is split on purpose.** `:root { --gutter:18px }` is a
token and stays in `app.css`; `.row`'s single-column override went to
`AlertList.css`, beside the `.row` it overrides. Left in `app.css` it would load
*before* that file and lose to it — the mobile layout silently reverting to the
desktop grid, with every check still green.

**How the split was done, because doing it by hand is how a rule disappears.**
A brace-walking parser read the file into rules, each was assigned to a file by
its scoping class, and the result was asserted to be a **permutation**: 313 rules
in, 313 rules out, none lost, none gained, compared as normalised
selector-plus-declarations rather than as text. Then every screen was measured in
the browser — 757 elements across nine routes, thirty-six computed properties and
the box each — against a capture taken before the split. Zero differences. Do it
that way again if it is ever redone; a `diff` cannot check a reordering and a
brace count cannot check a rule.

**Routing is one file, not a library.** Eight *routes* — four pages, a note, the
Ask index, a record and Sources — no nesting. `popstate` is already a browser
event and `location.pathname` is already the state. A finding id carries `:`, so
the route encodes and decodes it.

**It routes on the PATH, and the hash is gone.** The address is part of the
product — an alert is something you paste to a colleague — and `#/alert/…` reads
as an artefact of a demo rather than as a place. It costs exactly one thing and
it is worth naming: **every deep link now needs the server to answer with
`index.html`**. `spaFallback` in `apps/shell/vite.config.mts` is that, for the
dev server and for `vite preview`; anything else serving `dist/` needs the same
rewrite. It is deliberately wider than vite's own fallback, which declines when
the last segment looks like a filename — a Slack `ts` is `1755950400.001`, so
`/record/slack/1755950400.001` would have 404'd on reload while every other page
worked.

**Two things follow from that and both were live defects the moment the hash
went.** `notify.ts` built its link as `${APP_URL}/#/alert/<id>`, which now
resolves to the front door — every notification would open the list instead of
the one alert it was sent about. And a row is an `<a>` on purpose, so with a
path every click would fetch the whole application again: `useRoute` installs one
document-level listener that turns a plain left-click on an internal link into a
`pushState`. Modified clicks, a `target`, another origin and anything already
`defaultPrevented` are left to the browser, which is what keeps middle-click and
copy-link — the reason rows are anchors at all — working.

**The list counts what needs a person, not what was found.** An `ok` finding is a
note in the margin, and counting it as a thing that "needs you" is how a list
stops being believed. Every count reads from the collection — `DESIGN.md` §8.

**Keep the old data while refetching.** `useJson` cleared `data` on reload, so a
page fell back to its loading branch and unmounted everything below it — which
destroyed the "here is what just happened" strip on an alert the instant it
appeared. The POST returned 200, the outcome was real, and the screen showed
nothing. It is also the better behaviour: an alert page must not flicker under
somebody reading it.

**The toolbar is three entries and its counts are read from the collections.**
`DESIGN.md` §4 — an alert, a conversation and a record are always *about*
something and are never nav items; Sources is not there because the connector
dots already are its door. The counts are fetched once in `AlertApp` rather than
inside `TopBar`, so a badge and the list it counts cannot disagree.

**A row is an `<a>`, not a `<button>`.** The whole row navigates, and an anchor
gets middle-click, copy-link and the browser's own affordances for free. The
preview's `.row` rules are written against a button, so `alerts/shared.css`
restates the two declarations that differ rather than editing the copied block.

**The checklist is the alert's argument, and it needs its ticks.** Three ✓ and a
✕ reads in a second; one ✕ alone is a sentence with extra steps. It sorts ticks
first, then crosses, and **this alert's own promise last** — reading order is the
only emphasis a checklist has, and sorting on `tracked` alone leaves the crosses
in vault order so a container with two untracked promises ends on the wrong one.

**Every section says what it IS, and several did not.** The checklist read
*"What Orbit 29 said would happen"*, which a reader takes as the sprint's plan
ticked for what shipped — and it is neither: no row is ever a ticket, and ✓
means somebody FILED one. It now names what it is and carries a one-line legend,
and its tense follows the container, because `dropped_commitment` fires while the
sprint is still open and that is the whole difference between it and
`missing_ticket`. The note block said *"The note it was recorded in"* while
"note" everywhere else in this interface means one YOU left — Later, the note
page, the composer — so the word was already taken.

**`asClause` exists because a title is a sentence and a claim appends to it.**
All eight commitments in `fixtures-programme/notes/` end in a full stop, and an
extracted action item will too, so the flagship alert's `h1` read *"Esme Ellis to
chase the vendor sandbox. was never filed"*. Only sentence-ending punctuation
goes; a closing bracket or quote is part of the title rather than the end of it.

**The alert head shows the ticket's title, and `FindingDetail.item` had carried
it all along with nothing reading it.** *"ORB-1641 has not moved"* names a key
and the reader's first question is which piece of work that is. Same omission on
`cycle` and `disagreement`, whose headlines are also bare keys.

**The actions say where they go BEFORE the click, and safe mode is the first
thing they say.** A `.blocklead` under *What now* names the destination, whether
the primary writes or only drafts, and the Slack channel — read off the evidence
the way `askProposal` reads it. `act.ts` was already honest AFTER the click
(*"That did not go through… Nothing was written"*); a button promising a Jira
write on an instance that cannot make one is the same defect one step earlier,
and **safe mode is the DEFAULT**, so that instance is the normal one.
`FindingDetail.safeMode` carries it, so the page and the button cannot disagree.
`WRITES` mirrors `act.ts`'s `APPLIES` — keep them in step, or the lead says
"drafts" over a button that files a ticket.

**A citation opens its record, on the exact line.** `Evidence.ref` carries a
`RecordRef` and `GET /api/records/:surface/:id` returns the whole record with the
cited line marked — `RecordView` scrolls it to centre so the context either side
is visible, which is the only reason to open a record rather than read the quote.
`DIRECTION.md` §3: a citation that drops you at the top of a ninety-minute
transcript has not been followed.

**Zoom's time code is real or it is absent — there is no third option.** A
timed transcript renders `2:00` per line and always has; run
`annotateTranscript` over `fixtures/` and the first three lines come back
`2:00 · 10:10 · 14:12`. A **Zoom Docs note** has no timing at all: the capture
records paragraphs, `annotateTranscript` derives segments from the body, `start`
is a paragraph INDEX and `timed:false` says so. Rendering that as a clock would
put "0:03" beside a sentence nobody timed, on the page whose whole argument is
that its citations are checkable — so the lines stay unstamped and the head
carries the meeting's own start time instead, which is the granularity the
source actually has. `fixtures-programme` is all Docs notes, so that is the
fixture where Zoom shows no per-line code; `fixtures/` is where it does.

**The stamp is baseline-aligned with the line it stamps, and never a nudge.**
`.line time` is 11px mono against a 16px sans body, so top-aligning them leaves
the two texts at different heights however the padding is tweaked — and the
tweak has to be re-found whenever either size moves. `align-items:baseline` on
`.line` is the property that means what is wanted. Two things had to go with it:
the `padding-top:3px` it replaces (kept, it shifts the stamp's baseline back
down by exactly itself), and the UA's `margin:1em 0` on `.said`, which is a `<p>`
nothing had reset — that alone put the words ~16px below the stamp beside them,
in the preview as well as the app.

**The day is a `.daymark` row, not part of the stamp.** A Slack record is a whole
channel, so the day has to appear or messages weeks apart read as one
conversation. Carried inside `<time>` it made that stamp two lines, and baseline
alignment then put the DAY on the message's line with the clock hanging below —
so the one thing the column exists to say was the one thing not aligned with what
it stamps. A Zoom transcript draws no daymark: its lines carry offsets, not a
wall clock.

**The head takes the hour only when no line carries one.** On Slack the lines
have their own clock, so repeating it above would be noise; on an untimed note
it is the only moment there is.

**The record page says WHEN, and for Slack it had been saying nothing.** A
transcript line has `at` — seconds into the recording — and the view rendered
`offset(l.at)` alone, so every Slack line drew an EMPTY `<time>`: a column of
nothing on the one screen whose job is what was said and when. The preview draws
a time on every line, so this was building what was already designed.
`slackTsToIso` turns the `ts` into an instant, the head carries the day and the
lines carry the hour, and a transcript still shows its offset because that is the
clock its citation quoted.

**And it says WHY it is open.** The caption named the alert's KIND — *"cited by
the disagreement alert"* — which is a category, not a reason. `KIND_WORDS` turns
each kind into what the alert is actually about, so the bar reads *"opened on the
line the disagreement is about · August 17, 2026"*.

**The source link is the ONE affordance that leaves the app**, and it is the last
thing on the record rather than the first thing on the row that reaches it: you
cannot get to Slack without having read our rendering of the thread first, which
is what keeps it an escape hatch rather than the vendor pane returning.
`DIRECTION.md`'s argument is that a citation whose only terminus is our own
re-rendering is checkable only against us. It reads *"the original in Slack ↗"* —
`the original` says why you would click, `in Slack` says where, and `↗` is the
only mark in the app that means *this leaves Mission Control*; `←` means back and
`→` means another of our pages.

**It promises the DOCUMENT, not the line.** Only a Slack permalink lands on the
thing cited — a Zoom Docs note carries no timing at all and a Confluence url has
no paragraph anchor — so a word like "open" would claim a landing three of five
surfaces cannot make. `.why` beside it is where the line is promised, and that
promise is ours to keep because we render the record ourselves.

**`vendorUrl` resolves it in ONE place and never constructs one.** `url` is on
`StoredNodeBase`, so every collector already writes it — 376 of 398 nodes in
`fixtures-programme` carry one — and it was reaching the app for exactly one
surface, because `pageRecord` happened to copy it. A url a collector did not
write is a guess about somebody else's URL scheme, and absent is a real answer
the view renders nothing for. Slack is the one whose citation id is NOT its node
id — a `RecordRef` carries the `ts` while the node is
`message:slack/<channel>/<id>` — so it joins on the node's `at`, compared as
numbers and **not rounded**: the sub-second suffix is the only thing separating
two messages posted in the same second.

**A jira observation row is a citation now, and twelve of them were not.**
Rows like *"ORB-1641 is in development in the tracker, and nothing outside Jira
mentions it"* are our own observation — but they are ABOUT a ticket, and
`/record/jira/<key>` resolves, names it and carries the sprint. The rule that a
dead link is worse than a sentence is intact; what changed is noticing these were
not dead.

**`at` and `parentId` are part of the ROUTE, not a query smuggled beside it.**
The first version parsed the path and dropped the query, so every record opened
at the top with nothing marked — a working-looking page that had lost the one
thing the feature is for.

**The test for "is this a link" is `ref`, not `quote`.** "No issue references
this" is our own observation and the arrows in a cycle are a shape rather than a
document; a dead link on either promises evidence and delivers a 404.

**The marked line's caption comes from the element, not the stylesheet.** The
preview hard-codes `content: "cited by the Kafka alert"`, which is right for a
mockup with one example and wrong for an app — every record opened from any alert
claimed to be cited by that one. It reads `attr(data-cited-by)` now.

**Miro records read the graph, not the live board**, for the same reason
dependency truth does: a citation points at the sticky we reasoned over, and with
a real token `listStickies` returns whatever is on the canvas today.

**The test for "is this a link" is `ref`, not `quote`.** "No issue references
this" is our own observation and the arrows in a cycle are a shape rather than a
document; a dead link on either promises evidence and delivers a 404. But an
observation ABOUT something openable is not the same as one with nothing behind
it — *"ORB-1641 is in development in the tracker"* carries no quote and
`/record/jira/ORB-1641` resolves, names the ticket and carries the sprint. The
rule is intact; what changed is noticing that twelve rows were not dead.

Verify it the way `DESIGN.md` §8 says — **read the DOM, not the screenshot**; the
preview pane serves stale frames often enough to mislead. The check that matters
is that every content edge on every screen resolves to a *single* x:

```js
[...new Set([...document.querySelectorAll('.greet, .rows .row, .quiet')]
  .map(e => Math.round(e.getBoundingClientRect().left)))]   // must be one number
```

## The models the evidence view will draw

`buildStoryline`, `buildTimeline` and `buildRelationGraph` in `@mc/domain` are
models, not screens. **`buildTimeline` is what the `aging` finding measures
with** — deleting it silently empties a detector. `buildStoryline` has no
runtime caller and is kept deliberately: `DIRECTION.md` §1 says the graph, the
timeline and the focus lens come back **as evidence**, reached by clicking
"why?" on an alert, and this is the specification for that.

`recordOfNode` is the trap in that file — exported, looks like general graph
plumbing, and its only consumer is `buildStoryline`'s own body. Do not delete it
as unused on its own.

### Three browser rules, and each one fails silently

Whatever draws the evidence view will meet all three. None of them throws; each
just makes a gesture feel broken.

- **React's `onWheel` is PASSIVE.** `preventDefault()` inside it does nothing, so
  a trackpad pinch zooms the whole page instead of the element. There is no way
  to own a wheel gesture through React's synthetic handler — attach it by hand
  with `{ passive: false }`.
- **`setPointerCapture` steals the click.** Capturing on `pointerdown` looks like
  the right way to make a drag survive leaving the element, and it silently
  breaks clicking: the capture element becomes the target of the following
  `click`. Listeners on `window` give the same robustness without moving where
  the click lands.
- **`ResizeObserver`'s first callback is not prompt.** An effect with `[]` deps
  runs once against a null ref and never again, and the element keeps a
  placeholder size forever. Put the element in *state* so effects re-run when it
  appears, and read the size synchronously on attach plus once more on the next
  frame.

### Four layout rules, each bought with a bug

- **Decide on the CONTAINER's width, never the viewport.** A media query is the
  wrong instrument the moment two panels can collapse independently.
- **A sticky element taller than its scrollport does not stick at all.** Browsers
  only pin one that fits, so it silently behaves like a static column and scrolls
  away exactly when it is wanted. Cap it and let it scroll internally, and use
  `alignItems: 'start'` — a stretched grid item is already as tall as its row.
- **`minmax(0, 1fr)`, never `1fr`.** A grid item's default `min-width: auto`
  floor is its content, so a wide child pushes its siblings off screen instead of
  scrolling inside itself. Same reason a flex/grid child needs `minWidth: 0`.
- **Build a shared half once and place it twice.** Two copies of the same JSX
  behind a `wide` branch is how one layout quietly stops matching the other.

And one about reading rather than mechanics: **an unused margin has to look
deliberate.** A single column jammed against the left edge with a third of the
screen empty beside it reads as a layout that broke; centred at a capped measure,
it reads as room to breathe. The `ch` measures in `app.css` and its component
files keep one reading width across every screen for that reason.

---

