# The development path

What is built, what is next, and why in that order.

This is where the work stands and what remains.

**Nothing here carries a date.** The order is a dependency order, not a
schedule — each phase ends in something demonstrable, and a phase you can skip
is marked as such.

---

## Status at a glance

`✔` done and verified · `◐` partly · `·` not started

| | | |
|---|---|---|
| **A1** | Re-home `disagreement` + `cycle` as findings | ✔ |
| **A2** | `aging` as a finding | ✔ |
| **A3** | Consume `dedupeKey` | ✔ |
| **A4** | Wire the four actions | ✔ |
| **A5** | Later, and deferring | ✔ list, deferral, composer and the note page |
| **A6** | Persist dismiss and defer | ✔ |
| **A7** | Citations open records | ✔ |
| **A8** | Sources | ✔ |
| **A10** | Container close as an event | ✔ |
| **A11** | The diff → event adapter | ✔ |
| **A12** | A refresh slot in the scheduler | ✔ |
| **A13** | The notification | ✔ review inbox; a relay or a bot is a second transport behind the same interface |
| **A14** | Empty and error states | ✔ every page; `explain()` turns the exception into something a reader can act on |
| **A15** | Loading | ✔ landed with A16, which is the only slow thing on screen |
| **A16** | Ask | ✔ inline on the alert, the conversation page, the list |
| **A19** | Later: composer, delete + undo, the note page, the calendar | ✔ |
| **D1** | Write the commitment when the promise is made | ✔ — the live switch rested on it |
| **A17** | ~~A proposal queue~~ | **withdrawn — not in the design.** See "A wrong turn" below |
| **A18** | `verify-design.mts` — the design, made checkable | ✔ one direction only — see "What verification found" |
| **A20** | The primary action creates rather than drafts | ✔ `f52cfaa` — verified end to end |
| **B1** | Does a real `programme_graph` refresh conform | ✔ answered by reading the tool; the adapter is written |
| **B2** | ~~`CHANGES.json` appends~~ | **withdrawn — never a dependency** |
| **B3** | The identity map | ✔ **Slack's half is built** — `import-slack-messages.mts --users` merges `handles.slack` into the person Jira already wrote |
| **B4** | Collectors for Slack, Zoom, Confluence, GitHub | ✔ **all five are built** — Jira, Zoom, Confluence, Slack, GitHub. Each merges into one graph and passes `verify-collector` |
| **B7** | Sprint state, without which the flagship cannot fire on real data | ✔ `scripts/fetch-jira-sprints.mts` — the chain is proven end to end |
| **B5** | Verify `askCopilotStructured` against a real credential | ✔ **answered, and then fixed.** A PAT in `GITHUB_TOKEN` was being refused by the endpoint while every auth check passed; the ladder then preferred a logged-out Claude CLI. Both fixed — `probe-mcp` reports `copilot OK` on a nested schema |
| **B6** | Is the repo public, and what is it called | ✔ **private, `Mission Control`** — pushed as one squashed orphan commit, never this history. `KNOWN-GAPS.md` §3 |
| **D1–D3, D6** | commitment on promise, `MC_GRAPH_DIR`, status map, scale | ✔ |
| **D4** | Decide hosting | ✔ **single-tenant, loopback by default**; `MC_BIND` is the deliberate opt-out, and it warns at boot |
| **D5** | Retire vendor MCP | ✔ **the four endpoints and `MC_VENDOR_MCP` are deleted** — the collectors replaced them |

Found by verifying the above rather than by reading it — see **"What
verification found"**:

| | | |
|---|---|---|
| **G1** | `verify-design.mts` never asks which preview classes are unused | ✔ reports, grouped by screen, printed by `npm run verify` |
| **G2** | The Slack bot — **settled** in `DIRECTION.md` §2, drawn in the preview | ✔ `slackBot`, an incoming webhook; does not wait on D4 |
| **G3** | 12 model turns at boot, for a page nothing opens | ✔ the warm-up is gone; `issue.ts` kept — `trace_entity` uses it |
| **G4** | Chat rules 3 and 4 — draw the shape, end in an action | ✔ plus the citation chip and Later's pointer; G1 reports the `#answers` group closed |
| **G5** | Global Ask has no tool that reads findings | ✔ the list rides the envelope; `list_findings` reaches the tail |
| **G6** | Sources' top bar is missing its `Mission Control · Sources` title | ✔ found by G1, fixed, and G1 now reports it closed |

Also done, and not on the original list because they were found by running it:

| | |
|---|---|
| the graph contract, the fixture generator, graph-backed connectors | ✔ |
| dependency truth reads the graph, not a live board | ✔ |
| `WorkSignal.evidence`, so a finding can cite | ✔ |
| the alert list and one alert page, matching the preview | ✔ |
| the structured-output seam, MCP-free | ✔ |
| the acceptance command (`npm run verify`) | ✔ |
| the fixture generating **byte-identically**, which it did not | ✔ |
| the demo's own state — parked notes in both fixtures so `Later` opens on something, and conversations seeded into the browser so `Ask` does. `KNOWN-GAPS.md` §6 records what each deliberately does not do | ✔ |

---

## The shape, and where it comes from

**`docs/design-preview.html` is the specification, and it is committed.** Not
this file, not `DESIGN.md` prose, not the shipped code — the preview is the
version that was tested in a browser, and `DESIGN.md` says so in its own
preamble: where the two disagree, the preview wins. Open it off disk; it is standalone and clickable, and its own
`every page` screen is the map:

| | |
|---|---|
| **It arrives** | the notification — *not a page* |
| **Four pages, and that is all** | Mission Control · the alert · the conversation · Later |
| **Reached only from a citation** | the records. No menu entry, no browse, no search |
| **Under the bonnet** | Sources |
| **Deleted as destinations** | five vendor panes, two lenses |

**"Eight destinations become four"** is `DIRECTION.md` §3's opening line, and the
eight counts what the direction cut. The router carries eight *routes*, because a
note page and the Ask index hang off Later and the conversation. Different
number, different noun, and one must never be quoted as the other.

Divergences from the preview are recorded in `DESIGN.md` §9 and must be argued
rather than allowed to drift. There are three, plus one piece of it unbuilt.

---

## What is NOT built

Every row above is `✔` or withdrawn, which makes this document's own subtitle —
*"what is built, what is next"* — promise a *next* it stops delivering. So,
plainly:

| | |
|---|---|
| **The evidence view** | `DIRECTION.md` §1's one unkept promise: *"the graph, the timeline and the focus lens do not disappear — they are demoted from front door to evidence, reached by clicking why? on an alert."* Nothing in `apps/shell/src` imports `buildStoryline`, `buildTimeline` or `buildRelationGraph`. This is the only outstanding item that changes what the product **does**, and its specification is already written: those three models, plus the layout rules `CLAUDE.md` records, each of which was bought with a bug |
| **A real Zoom capture** | the collector is written and checkable without an account (`verify-zoom-capture.mts`), but nobody has signed in and run it against Zoom's own DOM. Not code — a login |
| **Authentication, CORS, webhook signatures** | `KNOWN-GAPS.md` §3, unstarted. D4's loopback bind makes them survivable rather than solved, and all three are live again the moment `MC_BIND` points off loopback |

**`PATCH /api/vault/log/:id` is gone**, and it used to be the fifth row here — a
callerless write that mutated an append-only log, contrary to the model
everything durable rests on. The route, `Vault.updateEvent` and the `editedAt`
field only that method ever wrote all went with it. Dropping an entry
(`DELETE /api/vault/log/:id`, `POST /api/vault/log/delete`) survives, because
removing evidence is a different act from falsifying it.

---

## Where it stands

Working, verified end to end against `fixtures/`:

| | |
|---|---|
| the graph contract | `docs/GRAPH-SCHEMA.md`, `libs/domain/src/graph.ts`, `scripts/verify-graph.mts` |
| the fixture generator | `npm run fixture` — graph, records, events, claims, deterministic |
| graph-backed connectors | `createGraphConnectors`; `MC_GRAPH_DIR` is the live switch |
| the findings pass | `GET /api/findings` — the four alert kinds; the two `COVERAGE_KINDS` are detected and shown on Sources |
| the four pages, the records and Sources | `apps/shell/src/alerts/` — eight routes |
| structured output, MCP-free | `MC_STRUCTURED` with four backends |

Load-bearing underneath, all of it: the dossier, the contradiction
detector, the summariser and its citations, the vault, the durable event log,
proposals with a human gate, echo suppression, the skills and the scheduler.

---

## The ordering principle

Two tracks run at once and they are not the same kind of work.

**A — the build path.** Sequenced, and the sequence is the point. Each phase
makes the *previous* one honest rather than adding a feature beside it.

**B — what only other people can unblock.** Start these now; they have lead
times and none of them is code you can write.

Live (track D) comes last, because the demo runs on fixtures by design and
nothing in D changes what it shows.

---

## Track A — the build path

### ~~Phase 1 · The front door tells the whole truth~~ — done

All six kinds fire, verified against the fixture and in the browser. The lane's
signals are wrapped rather than re-detected, a cycle is one finding rather than
four, and every finding cites at least one record (asserted in
`verify-graph.mts`).

Three things it turned up that were not on the list:

- **Dependency truth was coming from a live Miro board, not the graph.** With
  `MIRO_ACCESS_TOKEN` set, `listConnectors` returned the canvas — an
  unreconciled and, on an older board, entirely different account of what
  depends on what. The four-ticket cycle silently stopped existing, in the lane
  and in the findings pass at once. Both callers now pass `projectArrows(graph)`.
- **Findings could not cite.** `WorkSignal` had no evidence, so a disagreement
  alert would have shown neither record. `WorkSignal.evidence` is optional —
  a row does not need it, an alert does.
- **Regenerating the fixture does not reseed a live vault**, so a case you just
  added stays invisible with nothing failing. `npm run fixture` says so now.

**Why it was first.** Two of the three alert types the demo is built on do not reach
the front door. `disagreement` and `cycle` exist as `WorkSignal`s in `work.ts`,
are already shared between the lane and the dossier so a row and its banner
cannot disagree, and were simply never re-homed behind `Finding`. This is the
largest visible gain available for the least new code, and everything after it
is more convincing with three alert types on screen than with one.

1. ✔ **Re-home `disagreement` and `cycle` as findings.** Wrap the existing
   detectors; do not reimplement them. `findContradictions` and `findCycles`
   stay the single definition.
2. ✔ **`aging` as a finding**, over the same `buildTimeline` the lane uses. A
   ticket with no transitions in the window gets no age and claims no signal —
   "we do not know" beats a fabricated zero.
3. ✔ **Consume `dedupeKey`.** Collapsing within a pass is done — it is what
   turns a four-ticket loop into one row. The other half landed with **Phase 4**,
   which is what this was waiting for: `notifiedIds` in `notify.ts` reads
   `mc.memory_surfaced` off the **durable** log, unwindowed, and `scheduler.ts`
   filters the run against it — so a restart cannot re-announce what somebody was
   already told. *(This bullet read ◐ long after that shipped, while the status
   table above already read ✔.)*

**Done when** the list shows a missing ticket, a disagreement and a cycle, and
running the pass twice produces one of each. ✔

### ~~Phase 2 · An alert can be acted on~~ — done

The loop closes: an alert drafts a ticket, a human accepts it in the queue, the
ticket is created carrying a provenance comment with both citations and their
timestamps, the commitment gains the key, and **the alert stops firing**.
Deferring and dismissing are durable on the event log and suppress the finding.
The toolbar and Later exist.

> **The "in the queue" half of that sentence was not true when it was written.**
> Every part of the loop worked and it was verified by curl, which is the one
> path that cannot notice that the queue had no UI. See **A17**.

What it turned up:

- **`reload()` cleared `data`**, so the page fell to its loading branch and
  unmounted the "here is what just happened" strip the instant it appeared. The
  POST returned 200, the outcome was real, and the screen showed nothing. Old
  data is kept while refetching now — which is also the better behaviour, since
  an alert page must not flicker under somebody reading it.
- **Anchors underline.** `a.rowmain` needed the same two declarations `a.row`
  already had.

Still open inside it: a Later note is not editable on its own page, and neither
dismiss nor delete offers the undo strip `DESIGN.md` §7 specifies.

**Why it was here.** Right now the page is a report. `DIRECTION.md` §8's claim is that
every answer ends in an action, and until the buttons work the product is a
better-argued dashboard.

**A4** ✔ **Wire the four actions.** Each becomes a proposal; `accept_proposal`
   already has the branches for `create_issue`, `update_issue`, `link_issues`
   and `post_message`. The model never holds the button — `HUMAN_ONLY` is a
   fact about the tool set, not a sentence in a prompt.
**A5** ✔ **Later, and deferring.** "Not now" asks for a note and when it should come
   back. **Build this with #4, not after it**: deferring is the only route to a
   note tied to an issue, so splitting them means building Later twice.
**A6** ✔ **Persist dismiss and defer.** A dismissal is a decision and has to survive a
   restart, or a decision somebody made does not survive the night.

**Done when** accepting on the missing-ticket alert creates a ticket, appends
the key to the commitment, and the alert stops firing on the next pass. ✔

### ~~Phase 3 · The evidence is reachable~~ — done

Citations open their record on the exact line, and Sources counts coverage and
what failed to join.

**Why after actions.** A citation that opens nothing is a gap people forgive;
an action that does nothing is one they do not. But this is what makes the
trust claim real — every claim clickable, back to the record it came from.

**A7** ✔ **Citations open records.** `at` and `parentId` ride in the route rather
   than beside it, the record scrolls its cited line to centre, and the alert
   page's evidence rows are already the button the stylesheet expects.
**A8** ✔ **Sources.** Coverage, never content, plus the "what we could not read"
   block. Nearly free: the connectors already drop unresolvable arrows, keyless
   cards and empty stickies — counting them instead of discarding them is the
   whole change. It is also where the tier counts belong, which is the most
   honest number in the product.

**Done when** clicking a quote lands on that line in its own record, and a
record is reachable no other way. ✔

### ~~Phase 4 · It arrives without being asked~~ — done

A re-derive diffs against the last run, appends what changed, and notifies once
per finding. Verified end to end: first run baselines and announces nothing, six
of seven findings are worth sending, the second pass sends none, and a sprint
closing produces `mc.container_closed`.

`scripts/verify-refresh.mts` covers the cases that only exist because the
previous run is kept — a removed edge, a container closing, a foreign generator,
a stale signature.

**It still cannot carry real data**, and that is `B2`: `programme_graph` writes
its deltas to a `CHANGES.json` the next refresh replaces, so on real input the
change history is one run deep. Nothing here has to move when that lands.

**Why it was last of the four.** Everything above works when somebody opens the app.
This is the half that makes it an alerting system, and it depends on all of it.

**A10** ✔ **Container close as an event.** `McEventType` has no `sprint.closed`; the
    detector currently reads state off the sprint node.
**A11** ✔ **The diff → event adapter** (`GRAPH-SCHEMA.md` §2). Without it the system
    can only say what is wrong now, never that it went wrong at 07:41.
**A12** ✔ **A refresh slot in `scheduler.ts`**, beside `standup` and `tidy`, with the
    baseline rule: the first pass is never news, persisted to disk, re-baselining
    rather than reporting when stale. `canvas-poll.ts` already learned this.
**A13** ✔ **The notification.** Review inbox is the default that always works and the
    alert list already is one. A notification carries a **pointer, not a
    quote** — evidence must not leave the machine holding it, which is also what
    rules out a hosted chat transport carrying a real citation.

**Done when** a finding appears without anybody having opened the app, once. ✔

### A wrong turn, recorded so it is not taken again

**A proposal queue was built and removed.** The reasoning that produced it was:
`act.ts` and `Actions.tsx` both said accepting a proposal is "a separate act
somebody performs in the queue" while no such screen exists, so the strip on an
alert named a place that did not exist. That much is true, and it is still true.

The conclusion was wrong. **The queue is not missing; it was deleted on purpose.**

- `DIRECTION.md` §3 lists **four pages** — Mission Control, the alert, the
  conversation, Later — plus Sources and the record views. A queue is not one of
  them, and **neither `DIRECTION.md` nor `DESIGN.md` uses the word "proposal"
  once.**
- `docs/design-preview.html` settles what an action does. Its handler replaces
  the action block with the result and a `choose something else` link, in place,
  with **no navigation**. The primary action's result reads *"MC-112 created …
  The commitment in the vault now points at it, so this alert will not fire
  again."* The ticket is **created**. Only the message action drafts — *"Nothing
  has been sent. Read it before it goes."*
- The alert page **is** the review surface. The reader has the claim, the
  checklist and every citation in front of them; a second screen re-asks the
  question they just answered.

The general lesson: **the shipped code was treated as the specification.** The
sentence was stale, and what it needed was re-pointing, not a new page.
`CLAUDE.md`'s own rule says it —
*for what exists, this file wins; for what to build, those do* — and the queue
was built from what exists.

**A18 · The design is now checkable.** `scripts/verify-design.mts`, in
`npm run verify`. Documents did not prevent this — they were read — so the
constraint lives where it fails loudly instead:

| it asserts | because |
|---|---|
| the `Route` union is exactly the eight sanctioned routes, each naming the section that allows it | a new route is a new destination; `DIRECTION.md` §3 |
| the toolbar is three, and which three — **parsed from `DESIGN.md` §4** so the document decides | `DESIGN.md` §4, "three is the ceiling" |
| nothing in the interface is *named* for `proposal`, `queue`, or a retired lens, or renders a wikilink | absent from both documents, therefore not part of the interface |
| every `.tsx` in `alerts/` is a page the direction lists | the failure arrived as `Queue.tsx` |
| an action resolves in place, offers four choices and `choose something else` | the preview's own handler |
| the stylesheets add no selector the preview lacks, each is imported by its component, and no two claim a scoping class | one design system, and a cascade that does not depend on an import sorter |

Checked against the real thing: reintroducing the queue trips three of them
independently, each printing the rule and its document section. The narrow
version of the vocabulary rule matters — a first cut banned `proposal` outright
and failed on `result.proposal.evidence.length`, which is correct code, and a
check that cries wolf is a check somebody switches off.

`CLAUDE.md` carries the other half, at the top: the pre-flight the verifier
cannot run for you. Its first line is the one that would have prevented this —
**when code refers to something that does not exist, assume the code is stale,
not that the thing needs building.**

One thing it dragged onto the screen worth noting: proposal evidence labels are
written by `skills.ts` and `sync.ts` as `[[note-id]] kind: title`, so the queue
rendered raw vault wikilinks in the interface. Findings evidence does not, and
the alert app has no wikilink handling at all. The leak existed only because the
page did.

**What survived it**, because both are in the preview and in `DESIGN.md`:

- **`choose something else`** on the result strip — §7's "acting stays undoable"
  applied to an action rather than a delete. It re-renders the four buttons; it
  does not reverse the effect, and is not worded as though it does.
- **The counts re-read on navigation.** `useJson` refetches on its path and these
  paths never change, so acting left the badge beside it stating the old number —
  §8's rule arrived at backwards.

**It was out of step with the preview and no longer is.** The primary action
drafted where the preview creates, which is what left the demo's headline loop
uncompletable on screen. `f52cfaa` settled it — see **A20** below.

### ~~Phase 5b · The states nobody designs until they bite~~ — done

All three landed, and the section that used to sit here described them as
outstanding long after they were not. **A14** is `explain()` — an unreachable
gateway reads as *"The gateway is not answering on :8787. Start it with
`npm run dev`."* rather than `TypeError: Failed to fetch`. **A15** landed with
**A16**, which is still the only slow thing on screen. **A16** shipped inline on
the alert, on its own page and on the list.

**A16's unwritten blocker was resolved the way this file recommended.**
`ContextEnvelope.activeSurface` is optional now and the alert app sends
`{ finding }` instead — `POST /api/chat` with `context: {}` answers rather than
throwing. Verified: an empty envelope streams a complete, cited answer.

Two things the section got wrong while it stood, both worth keeping because they
are the same mistake:

- It recorded A14 as "the list and the alert page have them; nothing else does".
  `Later`, `Sources` and `RecordView` all had them.
- It justified A15 with "a summary is 20–60 seconds on the CLI provider", but
  `AlertPage` never renders a summary — `/api/issue/:key/summary` is unreachable
  from this app. That observation was right and its consequence was missed at
  the time; **G3** below is where the boot cost it implied was found and removed.

---

## Track B — start now, finish elsewhere

Written as six things other people had to unblock. Working through them found
that **one was never a dependency at all**, and that the half of another that
lives here can be built ahead of time — which is what the audits below are.

| | who | |
|---|---|---|
| **B1** Confirm a real `programme_graph` refresh reads as `GRAPH-SCHEMA.md` describes — tiers, origins, `depends_on` direction | the graph author | **answered by reading the tool: it does not, and the adapter is written.** `GRAPH-SCHEMA.md` §11 |
| **B2** ~~`CHANGES.json` appends instead of overwriting~~ | — | **not a dependency.** See below |
| **B3** The identity map. Email → per-source handle | both | ✔ **done** — `import-slack-messages.mts --users` merges `handles.slack` into the person Jira wrote. Proven across collectors in the integration run below |
| **B4** Collectors for Slack, Zoom, Confluence and GitHub emitting into the same file | both | ✔ **all five emit into one file**, verified together — see "The five collectors, run together" |
| **B5** Verify `askCopilotStructured` against a real credential | you | ✔ **answered: it is broken.** Auth works, the wrapper returns `{}`. `KNOWN-GAPS.md` §4. Blocks nothing |
| **B6** Is the repo public, and what is it called | whoever owns it | ✔ **private, `Mission Control`** — and pushed |

### B2 was never a dependency

**Nothing in this repo reads `CHANGES.json`.** `refresh.ts` (**A11**/**A12**)
keeps its own `graph-signature.json` and `graph-observations.json` in the vault
and computes the diff itself, by comparing successive reads of `graph.json`. So
`programme_graph` overwriting its deltas costs the gateway nothing, and "every
transition-shaped alert rests on it" is no longer true — it rested on it when the
design assumed the collector's change history was the source, and `refresh.ts`
replaced that assumption.

One fewer thing to chase. It stays worth having on his side for his own reasons;
it is not blocking here.

### B3 — the consumer half, and what it is actually worth

The graph keys people on **email**, the only identifier every source shares.
Everything downstream compares **handles**. On the fixture those happen to be
`riya`, `dana`, `sam` and match by luck; on a real corpus a Jira account id, a
Slack `U024BE7LH` and a Zoom "Riya Sharma" match nothing.

`buildIdentities` now resolves every person reference through
`StoredPerson.handles` **once, at the projection seam** — Jira assignees, Slack
authors, Zoom speakers and participants — so downstream code goes on comparing
plain handles and none of it has to know. It **falls through** rather than
failing, so a graph with no `handles` behaves exactly as it did before.

**And the roadmap overstated what it buys.** "Without this nothing joins" is not
what happens. Tested against a graph rewritten to real-world identifiers with the
handles stripped: **all seven findings still fire, identically.** The detectors
key on the ticket, not on the person — `findContradictions` compares two claims
about `PAY-9031` whoever made them.

What actually breaks is quieter, and worth knowing precisely. On one ticket:

| | who weighed in |
|---|---|
| with the map | `sam` (slack + zoom, 2 records), `dana` (slack, 1) — **two humans** |
| without | `U0G9QF9C6` (1), `U03BEP9SD` (1), `sam` (1) — **three**, one of them twice |

So the rollups **over-count people** and label them with raw ids. "Discussed by
three people" about two, and a trail attributing quotes to `U03BEP9SD`. Bad, and
not the same claim as the alerts failing.

`node scripts/inspect.mjs identities` lists every person reference in the loaded
graph, which surfaces it came from, whether the map placed it, and — for the ones
it could not — prints the `person` node shape the collector should emit. That
turns B3 from a conversation into a list.

### B1 — answered: it does not conform, and the adapter is written

`GRAPH-SCHEMA.md` §11 has the full mapping. Read against the real tool rather
than asked about:

**Most of it already lines up**, because this contract was designed from it —
`kind:value` ids, networkx `node_link_data` (which is why we say `links` and not
`edges`), the same three tiers, the same three origins, eight of ten relation
names identical, declared dependencies starting `AMBIGUOUS` and promoted by
reconciliation.

**Three differences matter**, and each was found by reading the code:

- **`confidence` is their name for `tier`.** Same values. `isStructuralDependency`
  tests the tier, so an absent one means no cycle detection at all.
- **`reconciled` must be passed through.** `reconcile.py` marks every dependency
  edge it touched, and `findReconciliation` gates on it — without it, *both*
  reconciliation findings are silent. Verified: passing it took the import from
  zero findings to two.
- **There are no sprint nodes** — sprints are `sprint_names[]` strings with no
  state and no dates, and `findMissingTickets` fires when a container *closes*,
  so **the flagship finding could not fire on real Jira data**, silently. This
  was the last hard blocker on the live test and it is **closed** — see B7
  below. The adapter always synthesised the nodes; what was missing was the
  state, and Jira's agile API has had it all along.

Plus one that is only a convention: `person:` is keyed on Jira's **display
name**, where we key on email. A `--people` map re-keys them — and rewrites every
edge that points at them, which `verify-collector` caught when the first version
did not ("no edge points at a node that does not exist").

**`scripts/import-programme-graph.mts` is the adapter, not an exporter change.**
That tool is upstream, general, and serves its own MCP server and HTML view;
bending its schema to one consumer makes every future consumer's problem ours.

Verified end to end against a synthetic input shaped exactly as it writes one:
adapter → contract holds → gateway runs → `undetected_dependency` and
`suspect_link` both fire, quoting the tool's own evidence.

### And the rest of the sources, surveyed

Only `programme_graph` produces a graph. The others are read/write CLIs, so
§10's shapes are what somebody emits *into* rather than what exists:

- **Confluence** — ✔ **the emitter is written.**
  `scripts/import-confluence-pages.mts`. Read against the real script rather
  than assumed, and §11's account was right: `read` returns `{id, title, url,
  space, version, breadcrumb, body}` and the two gaps are exactly `at` and
  `keys`.

  **The timestamp is fetched and thrown away.** `confluence-cli.py` expands
  `body.storage,version,space,ancestors`, so the API returns `version.when` —
  and the CLI prints only `version.number`, one line before it would have been
  kept. One line fixes it upstream:

  ```python
  'at': data.get('version', {}).get('when', ''),
  ```

  The emitter uses it when present and **refuses the page when it is not**,
  saying so with that patch in the message. `at` orders the trail, decides which
  of two claims is newer in a `disagreement`, and drives the "before the ticket
  existed" badge — a page stamped with today makes that badge lie, and a missing
  page is a gap somebody can see.

  **`keys` come from the body, and are then filtered against the graph.** This
  is where testing earned its place twice over:

  | | |
  |---|---|
  | `ADR-014` was extracted as a ticket | `extractKeys` is `[A-Z][A-Z0-9]+-\d+`, which a decision record matches perfectly — as would RFC-002 or a part number. The page would have claimed a relationship to a ticket that does not exist. A key is now kept only when the graph has issues with that prefix: self-configuring from the Jira import, and it fails safe on an empty graph |
  | a **duplicate id** — a contract violation | the merge removed nodes carrying *our* marker and said nothing about another collector's. `verify-collector` rejected the graph outright. Both emitters now skip a colliding id and say so, rather than duplicating it or discarding somebody else's work |
- **Slack** — ✔ **the emitter is written.** `scripts/import-slack-messages.mts`.
  `slack-cli.py` already prints JSON globally rather than behind a flag, and
  `message list` gives `{ts, user, text, thread_ts, permalink, …}` — nearly the
  record we want.

  **It closes B3's Slack half at the same time.** Slack knows `U024BE7LH`,
  everything downstream compares handles, and the graph keys people on email.
  `--users` has both, so this **merges `handles.slack` into the person the Jira
  import already wrote** rather than adding a second node for the same human —
  which would be the duplicate-id violation the other two emitters already
  learned. Verified by stripping `handles.slack` from a person in the fixture
  and watching it come back with the other three intact.

  Three details that were bugs waiting to happen:

  | | |
  |---|---|
  | Slack's `ts` is unix **seconds** | `Date.parse('1755950400.001')` is NaN, silently — the reason `slackTsToIso` exists in the domain. Stamping a message `Invalid Date` sorts the whole channel to the bottom of a newest-first trail |
  | the channel is read from the **permalink** | `/archives/C0123/` names it explicitly; the filename is the fallback. A channel that cannot be named is skipped rather than guessed — `#unknown — sam` on an evidence row is worse than the message being absent |
  | empty messages are dropped | a join notice or a reaction-only event has no text, cannot be cited and cannot join. Same rule as `listStickies` dropping empty stickies |
- **Zoom** — ◐ **everything but one sign-in.** `scripts/import-zoom-notes.mts`
  reads `zoom-local-sync`'s browser captures and writes conforming `meeting`
  nodes + records, and `scripts/capture-zoom-notes.mts` is checkable end to end
  with no Zoom account at all —
  `npx tsx scripts/verify-zoom-capture.mts` drives the real script against a
  fake Hub, 23 checks.

  **This used to read "the capture needs this Mac set up", and that half was
  measurably false**: playwright 1.62.1 is installed, Chrome 151 is at exactly
  the path `channel: 'chrome'` resolves to, and the launch path was smoke-tested.
  As written it sent the next reader to install something already present and
  hid the one thing that genuinely blocks. What blocks is a **Zoom sign-in**
  (`--login`), which is the owner's to perform and which no assistant may do,
  plus one real run against Zoom's own DOM. It stays ◐ until that run happens.
  See "Zoom, and what the scraper can actually reach" below.
- **GitHub** — ✔ **the emitter is written**, and it reads `gh`, not
  `github-cli.py`. That script is a **write** tool: `pr update-body`,
  `pr comments`, `pr reply`, `pr resolve`, `ci status`. It acts on a pull
  request you already know about and has no `pr list`, so it cannot say which
  PRs exist. `gh pr list --json` can, in the shape the record wants.

  **A PR is worth less here than the other four, and it is worth knowing why.**
  There is no `projectPrs` and no GitHub connector: a `pr` node counts on
  Sources, contributes its author to the identity map, and carries a `mentions`
  edge to each ticket it names — which is the part that matters, because that is
  what puts a pull request into a ticket's neighbourhood.

  **The join is the branch name.** `feature/PAY-9012-dedupe-cache` is how a PR
  attaches to the spine, which is why `headRefName` is not optional in the
  capture. The title is read too, because a branch is sometimes just
  `fix/login` — and such a PR is reported as joining nothing rather than quietly
  contributing a row to Sources and nothing else.

  Two filters, both of which would otherwise be visible defects:

  | | |
  |---|---|
  | **bots are dropped** | Dependabot opens a PR per dependency per week. Left in they are the majority of every `pr` count, they drown the real ones in a ticket's neighbourhood, and `authored_by` would put a bot in the identity map beside four humans |
  | **keys are filtered against the graph's issues** | `release/ABC-123-hotfix` matches the Jira key regex. An edge to an issue that does not exist is a contract violation `verify-collector` rejects — here it would be one per stray branch. Same rule the Confluence emitter learned |
- **Miro** — already live via `MIRO_ACCESS_TOKEN`. This one is done.

### ~~B1 — answerable by running something~~

```bash
npx tsx scripts/verify-collector.mts /path/to/collector/output
```

Offline, no gateway, no credentials, and its output fits in a message. That is
the whole of B1: "does a real `programme_graph` refresh read as
`GRAPH-SCHEMA.md` describes?" stops being a conversation with a lead time.

It is separate from `verify-graph.mts` on purpose. That one asserts the
**planted demo cases** — the unjoined commitment, the four-ticket cycle, the
uncorroborated link — and a real graph has no reason to contain any of them, so
pointing it at one reports failures that are not failures.

**The severity split is the part that makes it usable.** A contract violation is
a bug in the collector and exits non-zero. An unmapped status word or an
unresolved person is a configuration gap — the app runs, something joins less
well than it could — and only warns. Conflating them would make it cry wolf on
the first real export, which is how a check gets ignored.

It also prints the `depends_on` edges as English sentences, because **the
direction cannot be checked structurally** — both readings are well-formed
graphs — and `blocksPairOf` is the single place it flips. Four sentences on
screen settle in ten seconds what a schema paragraph does not.

Two bugs of its own, both found by running it, both worth recording because a
checker that is confidently wrong is worse than none:

- `recordRef` is a path relative to the graph directory
  (`records/meeting/x.json`), and the first version compared it against
  `kind/id` — so all thirty valid refs reported as missing, which would have
  sent somebody fixing a collector that was right.
- The list of valid node kinds was hand-written and wrong about `page` and
  `frame`. It reads `STORED_NODE_KINDS` from the domain now. A second copy of a
  list is a second copy that drifts.

`npm run verify` runs it against the fixture, because the fixture *is* a
collector's output — generated into the same shape — so a check destined for real
input should pass against ours first.

### ~~B7 — sprint state, the last hard blocker~~ — done

`scripts/fetch-jira-sprints.mts` reads `/rest/agile/1.0/board/{id}/sprint` and
writes the file `--sprints` already took. Going live on Jira is three commands
now:

```bash
npx tsx scripts/fetch-jira-sprints.mts --board 42 --out sprints.json
npx tsx scripts/import-programme-graph.mts --in graph.json --out ./live-graph --sprints sprints.json
MC_GRAPH_DIR=./live-graph npm run dev
```

**Not folded into the adapter, deliberately.** The adapter is offline and
deterministic — files in, files out, no credentials, no network — which is what
lets `verify-collector` be pointed at its result. A fetch inside it would trade
that for one less command.

Four things it does that a `curl` would not:

- **Lists the boards with no `--board`.** The board id is the one thing you
  cannot guess, and "which board?" is the first question anybody hits.
- **Exits non-zero when nothing is closed**, saying why at length. A
  `sprints.json` that looks fine and produces no alerts is exactly the failure
  this exists to prevent.
- **Keeps the first of a duplicated sprint name and says so.** Names repeat
  across boards; a closed sprint silently overwritten by an active one of the
  same name turns the flagship finding off.
- **Names the failure.** 401 says an API token uses basic auth and not bearer;
  404 says the board may be kanban, which has no sprints. A bare status code
  against an API you have not used costs an afternoon.

**Proven end to end, not asserted.** Against a mock speaking the agile API's
real shape — basic auth, `startAt`/`isLast` paging at page size 2, a duplicated
name, a closed sprint with no `completeDate` — then a `programme_graph`-shaped
`graph.json` through the adapter, then the gateway:

```
[crit] missing_ticket — Platform to provide the settled topic was never filed
  Agreed by sanjay@example.com, due 2026-08-12 · 11 days past due ·
  PAY Sprint 12 has closed and no issue references it
  fired 2026-07-31T09:12:00.000Z          ← the sprint's completeDate
```

`firedAt` is the sprint's own `completeDate`, which is the rule
`findMissingTickets` states: when the container closed, not when the pass ran.

**And it turned up a second silent failure on the way.** `Note.container` is the
node id, `sprint:PAY Sprint 12`. Every generated note carries one — but writing
a commitment by hand is a step of this very path, and the natural thing to type
is the sprint's name. Keyed on the id alone that resolved to nothing and the
finding never fired, with nothing erroring: the same way of losing the flagship
alert, one layer up. A bare label resolves now **when exactly one container
carries it**; two resolve to neither, because sprint names repeat across boards
and picking one would be a guess about which sprint closed. Verified both ways.

### The five collectors, run together

Each emitter had only ever been tested alone against the fixture. **Integration
is a different question**, and this is the run that asks it: a synthetic
five-source corpus through all five, in the documented order, into one graph.

```
1 Jira        6 nodes  (2 issue, 2 person, 2 sprint)
2 Zoom       +1 meeting
3 Confluence +1 page      · ADR-003 dropped, ACME-101 joined
4 Slack      +2 messages  · 2 people gained handles.slack
5 GitHub     +1 pr        · joined on the branch name
             ────────────
             11 nodes, contract holds
```

Then the gateway, with **one hand-written commitment note** — which is step 4 of
the live path:

```
[crit] missing_ticket — Platform to provide the settled topic was never filed
[crit] disagreement   — ACME-102 is called done and not done
```

**That is the pair the measurement said dies without Zoom and Slack**, produced
from five collectors that have never met before. The order matters and is now
documented: **Jira first**, because it supplies the project prefixes Confluence
and GitHub filter against, and the people Slack enriches.

**The identity map worked across collectors**, which is the thing B3 was really
asking. Jira wrote `person:dana@example.com` from a display name; Slack found the
same human by email and added `handles.slack`. One node, four handles, no
duplicate.

**One real bug, found only by running all five.** `/api/health` reported
`sources: ["jira"]` on a graph carrying meetings, messages, pages and pull
requests, because only the Jira adapter declared into `graph.graph.sources`.
That is the same silent wrongness as `jira: "mock"` on a live graph — the bug D2
fixed once already, in the same object. Every emitter declares its surface now,
and health reports `["jira","zoom","confluence","slack","github"]`.

**Two things the run flagged that were the test data, not the code**, and both
are worth knowing before a real capture:

- **A trail is windowed.** Slack `ts` values copied from an example were a year
  stale, so the messages projected correctly, joined correctly, and never
  appeared in a dossier. Nothing errors; the evidence is simply not there.
- **The lane is the ACTIVE sprint.** A disagreement on a ticket in a *closed*
  sprint produces no finding, because the lane it is folded over does not contain
  it. Correct, and surprising the first time.

### What an adversarial review of the five found

Twenty-seven agents: one reviewer per emitter, then independent refuters per
claim, each told to default to *refuted* when uncertain. **Eleven survived**,
and every one was real. Worth recording because several contradicted comments
in the very files they were in — a comment is not a test.

| | |
|---|---|
| **high** · `import-zoom-notes` | the meeting id embedded the note's **title**, three lines under a comment claiming the document id was "the stable half". Renaming a note in Zoom imported it twice, and every stored citation to the old id dangled. `capture.json` had carried `document_id` all along and the manifest interface did not declare it |
| **high** · `import-confluence-pages` | `taken` was built once and never grown, so two input files for one page id — trivially reachable, since "nested directories are walked" — emitted a duplicate node id |
| **high** · `import-github-prs` | the node filter was repo-blind while the link filter was repo-scoped, so importing a **second repository** deleted the first's PR nodes and left their edges dangling |
| medium · `import-slack-messages` | **no `mentions` edges at all**, so every message counted as "joins to nothing" on Sources and never entered a ticket's neighbourhood |
| medium · `import-slack-messages` | the email was lowercased on one side of the person lookup and not the other, so a mixed-case address produced a second person for one human |
| medium · `import-zoom-notes` | with `capture.json` missing, the title fallback replaced `-` with spaces — destroying the exact separator the date regex needs — and stamped the meeting **today** |
| medium · `capture-zoom-notes` | a rename left the old capture folder on disk, so one document arrived as two |
| medium · `fetch-jira-sprints` | running it for a second board **replaced** the file, so the first board's sprints reverted to `active` and the flagship finding went quiet for all of them |
| low · `capture-zoom-notes` | `--log-api` skipped every note on a warm index, so the log could not contain the call the flag exists to find |
| low · `import-github-prs` | a graph created from scratch had no `generatedAt`/`generator` and failed the verifier the script itself recommends |
| low · `fetch-jira-sprints` | the duplicate warning counted discarded sprints and listed distinct names, so the number and the list disagreed past one collision |

**One fix exposed another, which is the argument for re-running the whole
pipeline rather than the changed part.** Making the Zoom id stable turned two
folders for one document from two different ids into a genuine collision — and
`taken` was not being grown there either. A verifier had called that same bug
*unreachable* for Zoom, and it was, until the first fix made it reachable.

All eleven fixed, and the pipeline re-run end to end: 11 nodes, contract holds,
`sources: ["jira","zoom","confluence","slack","github"]`, and both findings
still fire.

### B4 — the collectors are elsewhere; the spec is not

`GRAPH-SCHEMA.md` **§10, "What each collector emits"** — the node, edge and
record shape per surface, written from what the projections actually
dereference rather than from intent. §9 was the rules; an author still had to
reverse-engineer a message node from a table row.

Every block was checked against the fixture's own nodes and records rather than
written from memory, which caught **three mistakes in the first draft** — the
worst being a sticky's frame, documented as a field where `projectStickies`
reads an `in_frame` edge to a `frame` node. A spec that is confidently wrong
sends somebody building the wrong thing, which is worse than no spec.

`verify-collector.mts` also reports **what each surface contributed**, because a
graph that validates perfectly and contains no `message` nodes is one where
Slack contributes nothing and nothing fails — there is just less to say.

**How much each surface is worth, measured** rather than asserted. Stripping the
fixture back to Jira alone: **seven findings became four.** What went was
`missing_ticket` (the flagship — a promise has to have been *made* somewhere, and
a conversation is where) and `disagreement` (a "done" claim needs something that
contradicts it). What survived was the structural three — `cycle`,
`suspect_link`, `undetected_dependency`.

So the two that go first are exactly the two **no single tool can produce**.
That is the order to build the collectors in: Jira gives you an app, Zoom gives
you the product's argument, Slack gives you the second beat.

### Zoom, and what the scraper can actually reach

**Read against the graph author's `zoom-local-sync` rather than assumed.** The tool has two
paths and the organisation blocks one of them, which decides everything else.

| | |
|---|---|
| the REST path | user recordings, recording detail, **transcript VTT**, summaries, chat. Needs a Zoom app. **Blocked.** |
| the browser path | a persistent Chromium profile holding the normal web login; reads Hub's `/api/file/recent`, filters to `docs.zoom.us/doc/…`, captures each note as `page.txt` + `capture.json` |

**`browser.py` contains zero references to transcripts or VTT.** So the
reachable artifact is the **Zoom Docs note** — the AI summary and its next steps
— and not a transcript. `GRAPH-SCHEMA.md` §10's Zoom shape assumed segments with
offsets; it now documents both.

**What that costs, precisely.** No speakers, no time offsets. A citation opens a
note at a line rather than a moment, and `speaker` is `UNKNOWN_SPEAKER` rather
than a name. Neither is a workaround to be improved later: a room on one
microphone gives Zoom a single track, so for a large share of these meetings
there is no attribution to recover, and inventing one on a page whose argument
is that its citations are checkable is the one thing this must not do.

**What is built here, and verified:** `scripts/import-zoom-notes.mts`. Captures
in, graph fragment out — offline, no browser, no credentials, so
`verify-collector.mts` can be pointed at the result, exactly like
`import-programme-graph.mts`. It **merges** rather than replaces, so it can run
after the Jira import. Verified against captures shaped as `browser.py` writes
them: two notes imported, a logged-out capture skipped, dates read from the
title in both Zoom formats, `PAY-9012` and `PAY-9031` extracted from the body so
the join works, and the record view emitting no `at` and no `who`.

**One bug worth keeping.** The merge first matched its own output by the
`meeting:zoom/` id prefix. Pointed at a graph that already held three real
recordings it **deleted them** — 70 nodes → 69, a still-valid graph, nothing
failed. Nodes carry a `collector` marker now. *A merge that cannot identify its
own output is an overwrite with extra steps.*

**The capture is TypeScript now, and needs no Python at all.**
`scripts/capture-zoom-notes.mts`. The question was whether Python was required
or incidental, and it is incidental: Playwright's Node API is the same API, so
`launchPersistentContext`, `context.on('response')`, `page.evaluate` and
`innerText` map one to one. Python would have meant a virtualenv, a second
dependency manager, and an interpreter upgrade on this Mac — it ships 3.9 and
the tool needs 3.11 — for a script that fits the `scripts/*.mts` idiom already
here.

The mechanism is the graph author's, reimplemented rather than invented: sniff
`/api/file/my_space` for the cluster prefix and the docs headers, take
`/api/file/recent` from the network or re-fetch it inside the page, filter to
Zoom Docs links, capture each as `page.txt` + `capture.json`. **It writes the
same layout `zoom-local-sync` writes**, so the two are interchangeable and
`import-zoom-notes.mts` reads either.

Three decisions worth keeping:

- **`channel: 'chrome'`, not bundled Chromium.** Nothing downloads a browser —
  which matters because npm's `allowScripts` blocks Playwright's postinstall
  anyway. The original used `msedge`; Edge is not on a Mac by default. The npm
  package is 5 MB and `npm run verify` never touches it, so the clean clone is
  unaffected.
- **`--login` opens a real window and waits.** Zoom sign-in is SSO with a second
  factor in most organisations — nothing a script should drive. The persistent
  profile is the credential; no token is stored and no password is ever handled.
- **`--doc-prefix` is overridable**, defaulting to `https://docs.zoom.us/doc/`.
  Zoom serves docs from regional hosts for some accounts, and a hardcoded
  production URL cannot be exercised without a real session.

**Verified against a fake Hub, and now by a command anyone can run:**

```bash
npx tsx scripts/verify-zoom-capture.mts
```

`scripts/verify-zoom-capture.mts` starts a local server speaking `recent` and
the note pages, then drives the **real** capture script through real Chrome —
the same trick `verify-providers.mts` uses on the model, only the far end is
fake. Twenty-three checks: the whiteboard and an off-prefix doc are filtered, the
folder is `<title-slug>_<doc id>`, `capture.json` carries the *document id*
rather than the title, a re-run opens **no** note at all, a rename **moves** the
folder rather than doubling it, and the captures then import into a graph whose
meeting ids carry no title word and which satisfies `verify-collector.mts`.

**This was written because the claim above used to rest on a throwaway.** The
harness existed once, was never committed, and `git log --all --diff-filter=D`
finds no trace of it — so the strongest verification claim in this section was
prose nobody could re-run. That is the thing this repo says it does not do.

It is **not** in `npm run verify`, deliberately: that command promises "no
credentials, no network, no server" and this starts both a server and a browser.
It is a named command, like `verify-providers.mts`.

**What it cannot tell you is Zoom.** The payload field names — `file.fileLink`,
`file.fileType`, `file.updatedInfo.time` — come from the graph author's `browser.py`
reading the real thing, not from us. If Zoom moves them, this passes and the real
run does not; `--log-api` on the first real run keeps the actual payload to diff
against the fixture.

**What is left is the login**, which is the owner's to perform, and then one real
run. Everything up to the point where Zoom's own DOM is involved is now
exercised by a command.

**And speaker separation, if it is wanted, needs a real page first.** Zoom's
recording view shows speaker-labelled lines with timestamps, so a browser path
to a *transcript* may exist. Writing that against a page nobody has captured
would be guessing at a DOM; it should be written against a real capture.

### B5 — two of four proven, and the probe now answers

`npx tsx scripts/probe-mcp.mts` ends in a verdict rather than four rows:

```
2 of 4 backend(s) work here: sdk-mcp, prompt-json
`auto` walks the ladder in order, so this machine gets sdk-mcp.

unavailable (no credential on this machine): messages-api, copilot
  messages-api  needs ANTHROPIC_API_KEY
  copilot       needs GITHUB_TOKEN, or a gh/OAuth login
```

An absent credential is **not** a failure and does not set the exit code; a
backend that has one and answers wrongly is, because an auth gate passing and
the turn failing is the one failure you cannot debug from outside. So on the work
machine this is a single command with an unambiguous result: if `copilot` reports
`OK`, B5 is closed.

---

## Track D — live

Ordered, and the first one is not what it looks like.

**D1 · Write the commitment when the promise is made. ✔** Done and verified —
see "The live switch, and what it rested on" above. It was called "the single
change everything else rests on" when the work was first framed, and it was.

**D2 · Point `MC_GRAPH_DIR` at a collector's output. ✔ mechanically** — the
switch itself works, tested against a graph outside the repo: four surfaces read
it, seven findings fire, nothing else changes. What remains is B1–B4, which is
somebody else's collector rather than code here.

Three things about it were fixed by *trying* it rather than reading it:

- **`/api/health` said `jira: "mock"`** on a machine serving a collector's
  graph. Hardcoded, written before graph-backed connectors existed — the exact
  failure the comment beside it warns about for Miro ("mode: mock alone would
  hide a live board behind a word that says fixtures"), in the same object, for
  the other four surfaces. It now reports the directory, the node and edge
  counts, and which collector wrote it, because "am I reading real data, and how
  much of it?" is the question somebody actually curls it to answer.
- **A wrong `MC_GRAPH_DIR` killed the gateway with a bare ENOENT**, and a
  truncated `graph.json` with a bare `SyntaxError`. Both now name the path, what
  was expected there, and how to fall back to the fixture. It still refuses to
  start, deliberately: a gateway that boots on nothing serves "Nothing needs
  you", which is the most reassuring screen in the product and would be a lie.
  A *validly* empty graph does start, and health reports `nodes: 0`.
- **The shell hardcoded `localhost:8787` in two files.** `VITE_MC_GATEWAY` now,
  in one.

**D3 · Status mapping into config. ✔** `MC_STATUS_MAP` points at a flat JSON
object of the workflow's own status names to our five. Unset keeps the built-in
defaults, which are now defaults rather than the rule.

The reason it mattered is the shape of the failure, not the mapping.
`statusCategory` has three values, so any word that falls through to it makes
`in_review` and `blocked` **unreachable** — a "Peer Review" ticket lands in
`in_progress`, the lane looks slightly wrong, and nothing fails. Tested against a
graph renamed to a foreign workflow: four words fell through and two of them were
silently wrong.

So the useful half is the audit, not the config:

```bash
node scripts/inspect.mjs statuses
```

It lists every status word the loaded graph actually uses, what it became, and
whether it got there `via` the map or by falling back — then prints a starting
JSON for the unmapped ones to correct and save. **That is the first thing to run
against a real export**, because the loss it reports is invisible from the app.

Three rules it holds:

- **Merged over the defaults, not replacing them.** A real workflow differs in
  two or three words, and a config file that must restate `done: done` to keep
  working is one people get wrong.
- **An unknown target is rejected, not ignored.** `"in-review"` for `"in_review"`
  would otherwise become a `WorkItemStatus` the rest of the app has never heard
  of; this arrives as JSON, so the compiler cannot help.
- **A configured-but-unreadable map refuses to boot.** Falling back to the
  defaults silently restores the exact bug somebody wrote the file to fix.
- **Not stored in `MC_GRAPH_DIR`.** That is the derived layer, rebuilt in full
  every run (`GRAPH-SCHEMA.md` §2) — a mapping kept there is one the next
  refresh deletes. Configuration is an input, so it gets its own path.

`/api/health` reports how many words are mapped, where from, and **how many
distinct vendor words are still falling back** — which is the number to watch.

**D4 · Decide hosting. ✔ Single-tenant, self-hosted, loopback on one machine
inside the evidence boundary.** The gateway binds `127.0.0.1` by default;
`MC_BIND` is the deliberate opt-out.

**It was never really open.** Four things settled elsewhere had already decided
it, and nobody had written it down:

| | |
|---|---|
| a person's login, not a service account | Copilot runs on `useLoggedInUser`, the Claude CLI spawns *your* CLI login, and the Zoom capture's persistent profile **is** the credential. None of the three is a thing you provision for a service |
| the vault has one writer | `libs/vault/src/store.ts` has no locking and no merge — `KNOWN-GAPS.md` §6 |
| the evidence boundary is already implemented | `notify.ts`: "a notification carries a POINTER, never a quote", *because* the transcripts and the claims read out of them do not leave the machine holding them |
| the one outward transport is outbound-only | the Slack bot is an incoming webhook whose button is a link, built that way so it would not wait on this decision (**G2**) |

**And the privacy property is the point, not the consolation.** "Who else can
see this?" has a structural answer rather than a policy one: the evidence is on
one machine, and the only thing that leaves it is a pointer. That is a stronger
claim than any hosted deployment could make. It is not an answer to either of
`DIRECTION.md` §11's two judge questions — those are about gaming and about
making things up — but it is the answer to the third question every reviewer in
this organisation asks, which is where the evidence goes.

**The gap between the decision and the code was one line, and it mattered.**
`app.listen(PORT)` binds every interface, so the vault write routes and
`POST /api/tools/:name` were reachable from the LAN — while the shell beside it
already bound loopback via vite's default. The gateway was the asymmetric one,
and "inside the evidence boundary" was false on any shared network.

**What it costs, stated rather than discovered later:**

- **Containers, devcontainers and WSL need `MC_BIND=0.0.0.0`**, because a
  loopback bind is unreachable from the host even with `-p 8787:8787`. Documented
  in `.env.example`, and the opt-out was exercised rather than assumed.
- **Inbound vendor webhooks cannot reach it.** They already could not — there is
  no public endpoint — so nothing that worked stopped working. The 07:00/19:00
  re-derive and `canvas-poll.ts` are the covering cadence, and **binding
  `0.0.0.0` to make a webhook fire is the specific wrong fix**: it trades an
  unauthenticated gateway for a fast path that is already covered.
- **`MC_APP_URL` staying `http://localhost:4200`** in a Slack message is
  *correct* under this decision and must not be "fixed" to a public host.

**What it does NOT do, and this is the line that stops the scope creeping.** It
does not make the gateway safe to expose; it makes exposing it a deliberate act.
There is still no authentication, `cors()` still allows every origin, and webhook
signatures are still unverified. Those three stay `KNOWN-GAPS.md` §3's, and D4 is
not licence to start them. A non-loopback `MC_BIND` prints a warning at boot
naming the absence of authentication, because an opt-out nobody is warned about
is how the property rots.

`/api/health` reports `host` — the bind, whether it is loopback, the app URL a
notification will carry, and whether the webhook secret is set. It reports the
bind and never a verdict: there is no `secure` boolean, because there is no
authentication and nothing here may claim otherwise. `node scripts/inspect.mjs health`
prints it, since that command shows a hand-picked subset and a field it omits is
a field nobody sees.

**Two defects an adversarial review found in this change**, both on the escape
hatch rather than the default — which is the half nobody exercises:

- **A bad `MC_BIND` printed a success banner and then served nothing, forever.**
  Express registers the `listen` callback with `server.once('error')` as well as
  with `listening`, so it hands a bind failure to the callback rather than
  throwing — and the callback ignored its argument. `MC_BIND=10.99.99.99`,
  `[::1]` copied out of a URL, or a typo'd hostname each logged a reachable URL
  and the whole exposure warning for a socket that was never opened. It exits 1
  with `cannot bind MC_BIND=… — listen EADDRNOTAVAIL` now. This is exactly the
  container path the hatch exists for.
- **`MC_BIND=` with nothing after it bound every interface** — the opposite of
  the documented default, from the line somebody writes while *thinking* about
  the bind. `??` does not catch an empty string and Node reads a falsy host as
  "all interfaces". Blank is treated as unset.

**Verified by hand, because `npm run verify` cannot see this** — its own banner
is "no credentials, no network, no server". Both halves were exercised:
`health.host` reads `{bind: "127.0.0.1", loopback: true}`; `curl localhost:8787`,
`curl -4 127.0.0.1:8787` both answer and `http://[::1]:8787` is refused (curl
falls back from `::1`, which is why the bind is `127.0.0.1` and not `::1`);
`curl http://10.0.0.196:8787` from the LAN address is **refused**; and with
`MC_BIND=0.0.0.0` the same LAN curl answers, the listener is `*:8787`, and the
boot warning names the missing authentication. The two memory paths
(`/api/slack/capture`, `/api/webhooks/jira`) still work from localhost.

**D5 · Retire vendor MCP. ✔** The four endpoints are **deleted** —
`mcp.atlassian.com`, `mcp.slack.com`, `mcp.miro.com`, `mcp.zoom.us` — along with
`MC_VENDOR_MCP`, the `mcpServers` wiring in `copilot.ts`, the `MCP_SERVERS`
export and the `/api/health` field that reported them.

The precondition was "once the collectors replace them", and B4 met it: five
emitters now read Jira, Zoom, Confluence, Slack and GitHub into one graph. That
is the argument. What the endpoints bought was the agent reading a vendor *live,
mid-turn*; the collector pipeline does that job **ahead of** the turn, and the
gateway already serves the result. What they cost was a turn that could not
happen at all, because the organisation this runs in forbids external MCP
servers — so with them wired in the live provider does not start there.

**It cost nothing at the tool layer**, which is the part worth remembering:
`defineTool` and the Messages API both take JSON Schema natively, so our twenty
tools have never involved MCP. Every cross-surface join, the vault, the trail
and the timeline are untouched.

Three things it turned up:

- **The in-process MCP is a different thing and had to survive.**
  `structured.ts` and `claude-cli.ts` use `createSdkMcpServer` as a transport for
  *our own functions* — no separate process, no network, no endpoint — and
  `MC_STRUCTURED=sdk-mcp` names it. It shares only the substring. Verified after
  the deletion: `sdk-mcp` is still one of four backends and still the default
  rung.
- **`verify-providers.mts` had a guard that outlived its bug.** It asserted the
  runtime rejects bare-URL `mcpServers` — the shape the code used to send. With
  no producer left, it was testing a config nothing makes, at the cost of a real
  session round trip. Deleted; the lesson is in `copilot.ts`'s header, where
  somebody wiring vendor MCP back in would read it. Its sibling check *"the
  runtime accepts our exact session config"* now tests the config we actually
  send, which it did not while `mcpServers` was still in it.
- **Three code comments were the load-bearing part of the sweep**, not the
  endpoints: `agent.ts` advertised "the four vendor MCP servers it speaks
  natively", `claude.ts` drew a distinction ("it gets no MCP servers") that had
  stopped existing, and `tools.ts` opened on "the vendor MCP servers". Those are
  what the next reader reasons from.

**Verified:** `npm run typecheck:all` (all five projects), `npm run verify`
green, and `verify-providers.mts` still failing **exactly one** check — the auth
boundary it failed before, which is the baseline. A stale import would have
thrown a `SyntaxError` before any check printed.

**D6 · Scale — measured, not guessed.** Two of the three concerns here turned
out to be answered already, and the third has a threshold:

| | |
|---|---|
| `graph.json` loaded per request | **already once at boot** (`main.ts` line 93), which is what this asked for |
| `readEvents` on the front door | `findings.ts` reads the log **unwindowed** — deliberately, since a `since` would silently expire dismissals. Measured: **70k events / 14 MB → 150ms**, **500k / 102 MB → 1.1s**, roughly linear at ~2µs an event. Comfortable for a year of a busy programme; noticeable past a few hundred thousand |
| summary warm-up | **gone** — see G3. Nothing is written until somebody asks |

So nothing here blocks the switch. The number worth remembering is that the
front door stays under ~200ms up to about 100k events, which is where an
append-only log gets to after a year at 200 events a day.

---

## Keeping this honest

Move an item when it is **verified**, not when it is written — this repo has no
test framework, and `npm run typecheck:all` passing is not evidence that any of
it works. The interesting bugs here are wiring bugs, and every one found so far
was found by running the thing:

- a fixture round-trip that passed while silently dropping four fields, because
  it compared two `undefined`s
- a probe that reported four backends and had run one
- a front door with no hero alert, because eighteen committed vault notes
  described a programme that no longer existed

**Two checks are worth repeating after every batch of work**, because neither is
something a typecheck can reach.

- **A clean clone.** `git clone` into an empty directory, then
  `npm install && npm run verify && npm run dev` with **no `.env`, no vault and
  no configuration of any kind**. It is the only check that finds a file nobody
  committed, and it costs a minute.
- **`.env.example` against what the code actually reads.** A credential the code
  never reads is worse than a missing one — you fill it in, nothing changes, and
  you have no idea why:

  ```bash
  grep -rhoE "process\.env\.[A-Z_0-9]+|import\.meta\.env\.[A-Z_0-9]+" apps libs scripts \
    --include="*.ts" --include="*.tsx" --include="*.mts" --include="*.mjs" \
    | sed 's/.*env\.//' | sort -u > /tmp/read.txt
  grep -oE "^#? ?[A-Z][A-Z_0-9]+=" .env.example | tr -d '#= ' | sort -u \
    | while read v; do grep -qx "$v" /tmp/read.txt || echo "documented, never read: $v"; done
  ```

---

## The live switch, and what it rested on

**D1 is done, and it was the one thing that would have broken quietly.**
`DIRECTION.md` §5 called it "the whole unlock": a `commitment` note was only ever
written inside the `create_issue` accept branch, which stamps the new key
straight into `relatedKeys` — so **every commitment in a live system would have
had keys, and the flagship detector would have found nothing.** The fixture hid
it by generating claims directly, so the demo worked and live mode would not
have, with nothing failing anywhere.

`/workshop` now writes the promise when it is made. Three parts:

| | |
|---|---|
| `extract.ts` | the schema gained **optional** `owner` and `dueAt`, and the prompt gained the meeting's date to resolve "the twelfth" against. Optional is load-bearing: a required field is one a model fills in rather than leaves out, which turns the precision gate into a rubber stamp |
| `skills.ts` | `ActionCandidate` carries them through `reconcile`, and a reconciled action with **both** and no tracking note becomes a `commitment` with `relatedKeys: []` — the state nothing else in the system could produce |
| `SkillContext.containers` | the real container list, from the same `StoredGraph` the detector resolves against |

Verified end to end on `sprint-12-planning`: the model read *"his team said the
twelfth of August at the latest"* → `owner: sanjay, dueAt: 2026-08-12` → a note
with no keys → **a `crit` missing-ticket alert**, from a transcript, with no
hand-written claim anywhere in the chain.

Three defects the first run exposed, each of which would have been silent:

- **The container was today's sprint**, not the one the promise was made in. A
  promise from Sprint 12 planning would have waited for Sprint 14 to close.
- **The container was a bare name**, where `findMissingTickets` resolves
  `note.container` against graph **node ids** (`sprint:PAY Sprint 12`). The note
  would have been written and the alert would simply never have fired.
- **The title was the cue's wording**, not the model's — *"Sanjay owns it — his
  team said the twelfth of August at the latest."* against *"Sanjay's team
  delivers the Kafka topic to Platform."* That title becomes the alert's claim,
  read months later by somebody who was not in the room. `promiseText` keeps the
  model's phrasing for the note while the ticket keeps the sticky's, which is
  the rule `reconcile` already had for a reason.

**The precision gate visibly works**, which is the part that makes the alert
believable: of four actions read out of that meeting, one had an owner and a
date and became a note; one had an owner and no date; one had neither. Only the
first is trackable, and only the first was written.

## ~~Phase 5c · Ask~~ — done

**All four pages `DIRECTION.md` §3 lists now exist.** Asking happens in place on
the alert, opening the conversation is a move, and the list is the way back into
one you started somewhere else.

| | |
|---|---|
| `AskInline.tsx` | the composer at the foot of the alert, **below the actions** — §8's order, so the checklist and the citations stay on screen with your question |
| the cap | last two exchanges, header reading **"showing the last 2 of 5 · open full conversation →"** — §7's exact phrasing |
| `ConversationPage.tsx` | the full thread, `← all conversations` back, and `Open the alert` **across** on the context bar |
| `Ask.tsx` | `Ask anything…`, and rows **titled by what they are about** with your question as the subtitle — §5 |
| `conversations.ts` | coalesced writes, streaming addressed by conversation id, and `alertId` — §9's "kept on the thing the conversation was about" |
| `Answer.tsx` | no component library. A ticket key links to its record, because §9's second rule is that the chat cites like the page does |

**One thread, not two.** The inline tail and the full page render the same
conversation from the same store. That took a fix: the tail was held in component
state, so a reload emptied it and the header fell back to *"1 earlier
conversation"* — a conversation you had just had was indistinguishable from one
from last month. §8 settles it in one clause: *"what you ask there is the tail
when you go back."*

**A15 landed with it.** A CLI turn is 20–60 seconds and the empty bubble read as
a failure, so it says *"Reading across every connected source… this takes a
moment."* — the only place in the app where anything is genuinely slow.

**The whole of Ask costs 23 kB** — JS 211 → 234 kB.

Two things building it turned up:

- **`renderContext` could not take a partial envelope.** `POST /api/chat` with
  `context: {}` threw. Every field is optional now, and
  `ContextEnvelope.finding` is how an alert's subject travels — a finding is not
  a `WorkItemKey`, and the flagship one is about the absence of one.
- **The starter questions were reading the live Miro board**, not the graph. They
  went on offering *"The board draws MC-103 → MC-102 → MC-101 → MC-105"* — four
  keys that no longer exist — beside three suggestions computed correctly. Same
  bug `work.ts`, `findings.ts` and `records.ts` were each fixed for; `suggest.ts`
  was missed. It takes `projectArrows(source.graph)` now.

---

## Conformance — specified, and not built

A full sweep of the shipped app against `DIRECTION.md` and `DESIGN.md`. None of
these is drift; every one is a thing the design asks for that nobody has built
yet. Listed so that the next person does not rediscover them one at a time, and
does not mistake one for a defect.

**The stylesheet is the inventory, and `npm run verify` now prints it.** The
preview carries the classes for every screen the design describes, so a preview
class the app never uses is, almost exactly, a piece of the design that has not
been built. `verify-design.mts` reports them grouped by the screen that draws
them — see **G1**. It does not fail on them, and must not.

The shell one-liner this section used to carry is superseded and was wrong in a
way worth knowing: a bare `grep` counts a class as used when its name turns up in
a comment or in prose, and every class worth finding here is an ordinary English
word (`chain`, `attach`, `avatar`).

| | asked for by | state |
|---|---|---|
| **A note editable on its own page** | `DIRECTION.md` §7 · `DESIGN.md` §5 §7 | ✔ `NotePage.tsx`. Untied notes get the editable name field, tied ones get `Open the alert` — an *across* link, not a back. The picker opens on `Leave it — <current date>`, so reading a note never reschedules it |
| **Delete, acting in place and undoable** | `DESIGN.md` §5 §7 | ✔ No confirm. The row goes and the undo strip takes **the slot it occupied**; undo restores it at its index. No timer — the offer lives until you leave the page |
| **Later's composer** | `DESIGN.md` §6 | ✔ `Park a note for later…`. Later is no longer only reachable through an alert |
| **The calendar, and `pick a date`** | `DESIGN.md` §6 §7 | ✔ `DatePicker.tsx` — Monday first, today outlined, past disabled, and it **flips upward** inside `.appwin`. All five dated options exist now; **Monday** is computed, never written down |
| **Empty and error states that are designed** | `DESIGN.md` §9 | ✔ `explain()` — "The gateway is not answering on :8787. Start it with `npm run dev`." rather than `TypeError: Failed to fetch` |
| **Ask, and the conversation page** | `DIRECTION.md` §3 §8 §9 · `DESIGN.md` §7 | ✔ see above |

Two bugs worth keeping, both found by using the thing rather than reading it:

- **`.calpop.up` already existed in the stylesheet** and the first version
  invented a `data-up` attribute instead. The measurement was right, the flip
  decision was right, and the panel rendered downward and got clipped anyway,
  because nothing was listening. *The stylesheet is the design — look in it
  before adding a hook to it.*
- **`DELETE` answers 204 with no body**, and the client parsed it unconditionally.
  A delete that had worked reported "that did not work", with the row still on
  screen and the note already gone: wrong in both directions at once.

---

## What verification found — five gaps, not on any list above

Found by running the shipped app against a running gateway rather than by
reading this file: `npm run verify`, the seven findings, the hero loop closed end
to end against a throwaway vault, and every page opened in a browser.

**None of these is drift from the design.** Four are things the design asks for
that nobody built, and one is work the gateway did at boot for a page nothing
opens.
They are numbered so they can be referred to.

### ~~G1 · `verify-design.mts` only checks one direction~~ — done

It asserted that the stylesheet introduces **no selectors the preview does not have**,
which catches a second design system growing, and never asked the opposite
question: **which preview classes does the app never use?** That set is, almost
exactly, the design that has not been built — and it is why G2 and G4 passed
every check in `npm run verify`.

It reports now, grouped by the screen that draws each class, and **`npm run
verify` prints the report under the step's `ok`.** `step()` used to discard
stdout on success, so the inventory would have been visible only to somebody
running the verifier directly — and an inventory nobody sees is not one.

**It reports and never fails, deliberately.** Unbuilt design is not drift. If
this exited non-zero, the cheapest way to green would be deleting the class from
the preview — destroying the only record that the thing was ever designed, and
turning a useful backlog into a reason to forget it. A verifier that punishes an
honest backlog gets one commit of obedience and is then gamed.

What it said when it first ran honestly, and what each group turned out to be:

```
note   20 class(es) the preview draws and the app never uses:
         #answers     arrow, at-risk, cap, chain, cited, followups, inline-graph, missing, node, sec, who
         #scr-list    laterlink
         #scr-slack   app-tag, attach, avatar, bar, msg, slackbtn, slackwin, who
         #scr-sources muted
```

`#answers` was **G4** — the chat drawing a dependency chain, citing inside an
answer, ending in follow-up actions. `#scr-list` was the *"parked for later →"*
pointer. `#scr-sources` was **G6**, one class nobody had noticed: the preview's
top bar reads *Mission Control · Sources* with the second word in `--ink-3`, and
the app rendered only the brand. Found by asking rather than by looking, which
is the whole argument for the check.

`#scr-slack` was **G2**, and turned out to be the interesting one: it *depicts
Slack*, so it is a fifth kind of thing — not unbuilt design, and not the
prototype's own scaffolding, but another product's chrome. Excluded now, and the
notification it depicts is built.

**It reports clean today, and that is the state to keep it in.** A class
appearing here means somebody drew a screen and nobody built it; the report is
only worth reading while that stays true.

Four things it took to be trustworthy, each of which produced a wrong answer
first:

- **Single-line CSS rules were skipped.** Filtering for lines *ending* in `{`
  drops `.chain { display:flex; … }` — so the first run omitted `chain`, one of
  the three things the check was written to find. Selectors are read between
  braces now, not between newlines.
- **A bare substring search counts prose as usage.** Every class worth finding
  is an ordinary word. Scoped to `className` values only.
- **Naive quote-pairing cannot read a nested template.** In
  `` `line${isHit ? ' hit' : ''}` `` the opening backtick pairs with the quote
  *inside* the substitution and the class ` hit` vanishes — a false "built",
  which is the one error this must not make. `stringLiterals` recurses into
  `${…}`.
- **Classes composed from data are invisible to any scan.**
  `` `chip ${f.severity}` `` never contains `crit`. `DYNAMIC` lists the domain
  unions that reach the stylesheet — severities and surfaces — explicitly, in the
  same idiom as `SANCTIONED`.

And two kinds of scaffolding are excluded rather than reported: `div.proto` and
`#scr-map` (the prototype's tab bar and its index of screens, which the preview
itself calls scaffolding), and the per-screen annotation `screen` / `caption` /
`notes` / `switch`, which appears on all eight screens and would otherwise be the
same four words eight times.

One thing to know if you touch it: the trailing `<script>` holding the preview's
canned chat replies is markup too, and is given a region of its own (`#answers`).
Without that it falls inside whichever `<section>` is last in the file, and the
chat's chain classes were duly reported against **Sources**.

### ~~G6 · Sources' top bar never said where you were~~ — done

Found by G1 on its first honest run, and it is the whole argument for that
check: one class, `.brand.muted`, sitting in the stylesheet with nothing using
it.

`#scr-sources` is the only screen in the preview whose bar reads
`Mission Control · Sources`, the second word in `--ink-3` — **and it carries no
connector strip.** The app rendered the strip on every page including that one,
which offers a door into the room you are already standing in, and left Sources
as the only page whose bar never named it.

`TopBar` swaps the two on `route.name === 'sources'`. Verified against the
rendered preview rather than the markup — `applyNav` injects the toolbar after
`.brand` at runtime, so reading the source alone tells you the wrong order — and
then against the app's own DOM: `brand · appnav · brand muted`, no `.sources`,
`rgb(122,131,143)` against the brand's `rgb(233,236,241)`.

The check that found it now reports 19 instead of 20, with the `#scr-sources`
group gone. That loop closing is the point of G1.

### ~~G2 · The Slack bot — a *settled* decision, not built~~ — done

`DIRECTION.md` §2 listed it under **Settled** — *"notifications via a Slack bot
on our own server; the company Slack cannot be posted to"* — and `notify.ts` had
exactly one transport. **A13 was marked ✔ on the review inbox alone**, with the
note that "a relay or a bot is a second transport behind the same interface",
which is true and reads as an option rather than as the decision it was.

**An incoming webhook, not a bot token — and that is why it does not wait on
D4.** The button the preview draws says *Open Mission Control*, so it is a Block
Kit `url` button and Slack never posts anything back. An interactive app would
need a public HTTPS request URL, which needs somewhere to host it, which is the
hosting decision nobody has made. This needs one env var, one outbound POST and
no inbound anything. `MC_SLACK_WEBHOOK_URL` turns it on; absent, the inbox runs
alone — additive, never a broken box.

The hard part was already done: **a notification carries a pointer, never a
quote.** The message carries the count, the claim and the finding's `impact` —
the detector's own sentence about why this matters — and never `evidence`, which
is what somebody said in a meeting. That constraint is what makes a hosted chat
tolerable at all.

**`sendDigest` is optional on `Transport`, and the reason is the room.** The
preview's message is not a per-finding ping and its own notes say why:
*"one line, one claim, one button — everything that would make this a digest was
left out on purpose."* Three pings at 07:00 is how a channel gets muted, which
costs every future `crit`. The inbox is a list and has no such pressure, so it
keeps `send`.

**The count is everything that needs a person, not just what is new.** Saying
"3 things need you" beside a list headed "6 things need you" is the same defect
as an agent naming a different worst than the screen — the lesson G5 just paid
for. The *lead* is the worst of the fresh ones, and a run with nothing fresh
sends nothing at all, so this never re-interrupts about old news.

**`deliver()` moved out of the scheduler into `notify.ts`**, so that "how a run
is delivered" sits beside the things that deliver it — and so it can be
exercised without waiting for 07:00. The scheduler decides when and what; this
decides how.

**Verified against a real HTTP receiver**, not asserted. Standing a webhook sink
on a local port and running the real pass over the real corpus produced exactly
the preview's message:

```
Good morning. *6 things need you* — one of them since 31 July.
*Platform to provide the payments settled topic was never filed*
Agreed by sanjay@example.com, due 2026-08-12 · 11 days past due · …
[Open Mission Control] → http://localhost:4200/alert/missing_ticket%3A…
```

All three delivery paths, through the real `deliver()`:

| | |
|---|---|
| dead webhook | `{failed:['slack'], inboxRecorded:true}` — the interruption is lost, the record is not, and it will not be announced twice when the webhook returns |
| live webhook | `{failed:[], inboxRecorded:true}` |
| unconfigured | `{failed:[], inboxRecorded:true}` — one transport, no failure |

`/api/health` reports `notify` now, because "will I actually be told?" is a
question somebody curls it to answer.

**One correction to G1, and it matters.** `#scr-slack` **depicts Slack** — a
fake channel bar, avatar, `APP` tag and message, drawn to show what arrives
before you have opened anything. It is not a screen of this app and never will
be, so its eight classes can never have a consumer however much of the
notification gets built. Left in the report they would sit there for ever, and a
permanently noisy check is one people stop reading — the exact failure G1 exists
to avoid, arriving from the other side. It joins `proto` and `scr-map` as a
depiction rather than a screen.

**G1 now reports clean:** *"every class the preview draws has a consumer in the
app."*

### ~~G3 · Twelve model turns at boot, for a page nothing opens~~ — done

**The boot warm-up is gone, and it was the part that cost something.**
`startSummaries` walked the active sprint at boot — twelve tickets, one model
turn each, sequential — so that a click on a row landed on a card already
written. Nothing in the shell reads a summary: `/api/issue/:key/summary` is
reachable from `inspect.mjs summary` and from curl and from nowhere else. So
every boot spent minutes of CLI child processes writing cards nobody can open,
**silently**, because the walk is unawaited and logs only on success.

Measured: before, `vault/raw/summary-cache.json` appeared within a minute of a
cold boot on a fresh vault. After, it is still absent at 45 seconds and the only
summary line in the log is the provider banner.

**The compiler found the rest of it.** With the walk removed, `noUnusedLocals`
named `Connectors`, `dossierFor`, `activeSprintOf` and `stopped` — and `stopped`
was the only reader of `stop()`, which therefore existed solely to halt a walk
that no longer happens. A `stop()` that stops nothing is a lie about lifecycle,
so `startSummaries(c, s, dossierFor)` is `createSummaries(s)` and the interface
lost a method. That is the argument for those two flags in one change: there is
no test framework here, and the compiler is the only thing that will ever tell
you a helper stopped being called.

**Two callerless routes went with it** — `GET /api/storyline` and
`POST /api/miro/snapshot`. The second could not have worked had anything called
it: its own comment said the coordinates arrive from the browser, and nothing in
the browser computes any. A route whose contract names a caller that does not
exist is not dormant capability.

**What was deliberately kept, and why:**

| | |
|---|---|
| `issue.ts` and `buildDossier` | `trace_entity` calls it, and so does `/api/issue/:key`. Load-bearing |
| `summary.ts` and its route | `get` is untouched — ask and one is written, cached on the brief's fingerprint. Only the guessing-ahead went |
| `MiroConnector.exportSnapshot` | the only sanctioned write to a board, and `scripts/seed-miro.mjs` is written against its three rules |
| `buildStoryline`, `buildTimeline`, `buildRelationGraph` | models in `@mc/domain`, not routes. `DIRECTION.md` §1's evidence view is written against them and `aging` measures with `buildTimeline`; they share a file, so a sweep that deletes by proximity takes a live detector out with it |

Verified by running it: the gateway boots, 7 findings, the summary route still
answers `pending` on demand, the front door renders unchanged, and
`npm run verify` is green with both typechecks.

**If a screen ever reads a summary again, warm what *that* screen opens on** —
not the sprint, and not at boot.

### ~~G4 · Two of the chat's four rules are unbuilt~~ — done

`DIRECTION.md` §9 sets four rules. Rules 1 and 2 held; the other two did not,
and the whole `#answers` group in G1's report was them.

**Rule 3 — "when the answer is a shape, it draws the shape."** A fenced
` ```chain ` block, parsed by `Answer.tsx` into the preview's `.inline-graph`:
an optional caption, nodes joined by `->`, and `[missing]` / `[at-risk]` tags
that become `.node.missing` and `.node.at-risk`.

**A fence and not structured output, because the turn streams.** Asking
`structured.ts` for typed JSON would mean waiting for the whole answer before
showing any of it, and the SSE loop is the reason an answer appears to be typed.
The model decides *when* the answer is a shape; the renderer decides how it
looks. An unclosed fence renders what has arrived — every intermediate frame of
a streaming answer has one, and holding the block back until the closing fence
would make the chain appear only at the very end.

**Rule 4 — "every answer can end in an action."** `.followups` under the last
finished agent turn on the conversation page: *Show me where this was said* →
the record behind the alert's first citation, on the line it quotes; and
*Back to the alert to act* as the `.sec`.

**Navigations, not a second way to act.** Every follow-up in the preview is a
`data-go`, and that is the right reading: `/api/findings/:id/act` has one caller
and one result strip, and a second path to the same write is how the two start
to disagree about what happened. The second repeats the context bar's link
deliberately — `.ctxbar` is not sticky, so after a few exchanges it is far above
the fold, and the call to action belongs where you finished reading. A general
conversation gets none: there is nothing to act on, and that is honest rather
than missing.

Rendered inside the last turn's body and only when it is finished — mid-stream
it would appear, move as the text grows, and offer an action about a sentence
that is not there yet.

**Two more that came with them.** `.cited` — a Slack channel in an answer
becomes the preview's citation pill, dot and all, because §9's second rule is
that the chat "cites like the page does" and a channel named in flat prose makes
an evidence row's claim while looking like an opinion. Deliberately not a link:
a channel name is not a record reference, and there is no line to land on.
And `.laterlink` — *"1 parked for later →"* on the alert list, hidden at zero,
because a deferral reachable only from the toolbar is one nobody looks at.

**A real bug fell out of building the pointer.** `AlertApp` counted
`later` as `!!n.about`, while `Later` itself counts
`!!n.about || tags.includes('parked')`. A note written in Later's own composer
carries the tag and no `about` — so the page listed it and the badge beside the
page did not. Two definitions of "parked", which is `DESIGN.md` §8's rule broken
from the inside; `isParked` was already exported and is now the only test.

**Verified in the browser, not by reading.** A seeded answer renders caption,
three nodes with the right variants, two arrows, the `#eng-platform` pill with
its slack dot, and both follow-ups; clicking the first lands on
`/record/zoom/sprint-12-planning?at=852&…` with the quoted line marked. Asked
for real, the agent emitted a well-formed fence on the first attempt.

**G1's report went 19 → 8**, with `#scr-list` and `#answers` gone entirely and
only `#scr-slack` — which is G2 — left.

Two fixes to G1 itself, both found by it reaching a clean state:

- `missing` and `at-risk` are composed at runtime from the parsed tag, so they
  joined `DYNAMIC` beside the severities and surfaces.
- `who` was a **false positive in the extractor**. The preview's script builds
  class lists by concatenation — `'<div class="turn ' + who + '">'` — and the
  attribute scan took `who` for a class name. It is a variable, and `.who` is
  `.msg .who`, which belongs to the Slack message. A class list containing a
  quote or a `+` is now skipped.

### ~~G5 · Global Ask cannot see the front door~~ — done

All nineteen agent tools predated the rebuild and none read findings, so a
conversation started from the Ask page carried `{}` and answered from vault
recall alone. Asked *"what is the single most urgent thing right now"*, it named
a ticket from an impediment note while the toolbar above the composer said
`Alerts 6` and the list's top row was the missing ticket. Both answers were
defensible, which is the problem.

**Two halves, and only one of them is the guarantee.**

`ContextEnvelope.findings` carries the top of the list into every global turn,
**filled server-side in `/api/chat`, and only when `finding` is absent.** Context
rather than a tool for the reason `skills.ts` is deterministic: the agreement
must not depend on the model remembering to look. Server-side because the
gateway owns `/api/findings` and is therefore the authority on what the front
door says — a client-supplied copy could be stale, and this is the one thing the
answer has to agree with. Only when the conversation is not already about one
alert, because `DIRECTION.md` §8 is explicit that the alert-scoped conversation
inherits its subject and the other rows are noise beside it.

It fails silently. A chat that will not answer because the findings pass threw is
worse than one that answers without the list — which is what it did before this
existed.

`list_findings` is the other half: the questions context cannot answer because
the list was cut at eight. On a real programme the tail is most of the list.
Read-only, no proposal, no vendor, so no `HUMAN_ONLY` entry — and suppression is
applied inside `runFindings`, so a dismissed alert does not return through this
door. `GraphSource` is threaded through `createAgent` as well as the route's tool
build, because two call sites with different tool sets is exactly the drift this
repo keeps paying for.

**Verified by asking, not by reading.** The same question that failed now opens
*"The most urgent item is the top of the list, unchanged by anything in the
vault"* and goes on to say *"Don't let the note substitute for the list's own
ordering"* — it names the vault's competing claim and declines to promote it.
`CHAT_FINDINGS` is 8: enough that "what needs me" is answerable in order, few
enough that eleven hundred findings do not eat the prompt.

Three paths checked:

| | |
|---|---|
| global, in the browser | the answer opens *"Per the list in front of you, worst first"* and enumerates the three `crit`s in the list's order |
| a filtered question | *"how many stale links"* → the tool, two `suspect_link`s, and it correctly refuses to count `undetected_dependency` as one — *"that's the opposite shape"* |
| alert-scoped | unchanged: answers about its own alert, no list injected |

---

## Technical debt — swept, and what the sweep found

Run against the checks `KNOWN-GAPS.md` already documents, plus one it did not.

**Clean:** no dependency nothing imports, no nx project nothing imports, no
unused local, parameter or import (`tsc --noUnusedLocals --noUnusedParameters`),
and — resolving specifiers properly rather than by grep — **no module nothing
imports** except `vite.config.mts`, which is vite's own entrypoint.

**The check that was missing** is the last one, and the shell one-liner in
`KNOWN-GAPS.md` cannot do it: imports read `from './findings.js'` and resolve to
`findings.ts`, so a naive match reports every file in the tree. Resolving `.js`
→ `.ts`, bare → `/index`, and `@mc/*` → the library entrypoint is what makes it
answer.

### What it found: a superseded module kept alive by one fallback

`createMockConnectors` had been superseded by `createGraphConnectors` and had no
caller. `libs/connectors/src/mock/` was 1,170 lines, and exactly **one** symbol
in it was still imported anywhere: `HISTORY`, by a fallback in `seed.ts` for a
graph that ships no history.

**That fallback was reachable only on the live path.** Its guard was whether the
graph shipped `events.jsonl` — true for our generated fixture, and false for
every real collector, because `import-programme-graph.mts` writes `graph.json`
and nothing else. Measured by pointing the gateway at a graph directory with the
events file removed: **431 MC-\* events written into a vault whose graph held
only PAY-\* keys**, into the append-only log, which is never rebuilt.

The comment above it had described the hazard correctly — *"writes transitions
for keys that do not exist… silently, because nothing joins a stray event to
anything"* — and then guarded against the wrong condition.

**The lesson, and it is why this is recorded rather than just fixed: a
superseded thing kept alive by a single fallback is more dangerous than dead
code, because the fallback runs somewhere.** Dead code is inert. This was
load-bearing on exactly the path nobody had exercised.

Both went. `seed.ts` is 415 → 126 lines and now copies the graph's own
`events.jsonl` and does nothing else; `libs/connectors/src/mock/` is deleted.

Verified both ways: the fixture still seeds its 46 events and produces 4
findings, and a collector graph with no history seeds **0** and produces 3 — one
fewer because `aging` needs observed transitions and there are none yet, which is
the same "we do not know beats a fabricated zero" rule the lane already follows.

### Left alone deliberately

- **Eleven gateway routes have no caller**, and they are three different cases.
  A route is an interface and this gateway is documented as something you curl,
  so "uncalled" is not by itself a reason to delete — but it is a reason to say
  which kind each one is, because the previous count here said *four* and named
  three.

  | | |
  |---|---|
  | **the vendor read-throughs** — `GET /api/confluence/pages`, `/api/zoom/transcripts`, `/api/zoom/transcripts/:id`, `/api/slack/channels`, `/api/slack/channels/:id/messages`, `/api/jira/items/:key`, its `/comments` | kept as curl targets — "what does it actually see on Zoom?" is worth being able to ask. `main.ts` says so where they are defined |
  | **the human gate's own door** — `GET /api/proposals`, `POST /api/tools/:name` | **kept deliberately, and do not delete these.** `accept_proposal` is how a person creates a ticket from an alert, and `HUMAN_ONLY` is what keeps it away from every provider. They have no shell caller because there is no queue screen and must not be one — the design working, not residue |
  | **the log-mutation pair** — `PATCH /api/vault/log/:id`, `DELETE /api/vault/log/:id` | the odd ones out. `DELETE` is documented for cleaning up after a probe; `PATCH` mutates an **append-only** log, which is contrary to the model everything durable rests on. Worth removing |

  `GET /api/skills` is a twelfth — a ceremony launcher `DIRECTION.md` §3
  sanctions no page for. `POST /api/skills/:name` is live and stays.
- **Over-exported symbols.** The sweep lists 83, and nearly all are types that
  are genuinely part of a module's surface — `Transport` and `Digest` in
  `notify.ts` are the contract even though only that file names them. Not worth
  a pass.
- **`pct()` and `days()`** duplicated across `skills.ts` and `suggest.ts`. Three
  lines each, and `days()` is *deliberately* different — one renders `13d` for a
  table, the other `13 days` because it writes sentences.

---

## Settled — the front door floods, and the fix

**Decided: the two reconciliation findings move to Sources.** Recorded here
because it was open for a while and the reasoning is the sort that gets
relitigated.

**What was wrong.** Six kinds of finding reached the alert list. Four are
naturally bounded — one row per unticketed promise, per done-claim, per loop,
per stalled ticket — and stay small however large the programme is.
`undetected_dependency` and `suspect_link` fall straight out of the graph's
tiers, **one per edge**, so they grow with the number of dependency links and
with how badly they are maintained. On the fixture that is two rows; on a
synthetic 5,000-issue import it is **1,108 findings — 840 and 268 of those two
kinds**, on a list whose whole promise is that the top row is the one to open.

Performance was never the issue: that import answered in 30ms, because the
graph loads once at boot.

**Not a defect in the detectors.** A declared link nothing corroborates
genuinely is a finding. What was wrong was the destination — they are facts
about how settled the data is, which is the question `DIRECTION.md` §6 gives
Sources, and Sources already counted the `AMBIGUOUS` edges they derive from.

**`COVERAGE_KINDS` in `@mc/domain` is the whole switch**, and everything that
had an opinion about "what needs a person" reads it: `/api/findings` returns the
alert kinds only, so the list, the headline and the toolbar badge follow with no
further change; `worthSending` excludes them, so a morning does not open with two
hundred pings and the notification's count stays the same sentence as the front
door's; and `list_findings` still returns them, carrying `shownOn` so the agent
does not describe one as something that needs you today.

They are still detected, still deduplicated, still suppressed by a dismissal,
and still on screen — as counts, on the page that exists to report exactly this.

**A second bug fell out of it.** `findJoinFailures` counted `AMBIGUOUS
depends_on` edges straight off the graph, while the detector deduplicates and
honours a dismissal. The two agreed by luck on the fixture; dismissing one
would have left Sources stating the old number for ever with nothing failing.
Sources takes the coverage findings from the pass now — the detector is the
definition.

Verified: the front door went from 6 rows to 4, the badge and the stat strip
followed, and Sources gained `2 declared links nothing corroborates` and
`1 dependency the tracker never recorded`.

**Still worth looking at against a real export**, but for the opposite reason
now — not to decide, but to see whether the counts on Sources are useful at the
scale they will actually arrive at.

*(The row phrasing gained a singular form while this was being built. Every row
is `{count} {what}` and small corpora make that "1 pages name no ticket", on the
page whose whole job is to make somebody trust the numbers.)*
