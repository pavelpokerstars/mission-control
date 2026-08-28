# Mission Control — working notes for Claude

## What this is

**Mission Control is an alerting system that can prove itself.** A deterministic
pass runs over one merged connection graph — five collectors write it from Jira,
Zoom, Confluence, Slack and GitHub — plus a vault of claims somebody authored,
and raises the things no single vendor tool can see: **a commitment nobody
ticketed**, two sources disagreeing about whether something shipped, a
dependency loop, work that has stopped moving.

The front door is that list, worst first. An alert states its claim, shows the
checklist and every citation behind it, and offers four answers in place. A
citation opens the record **at the cited line**. Nothing is self-reported and
nothing is asserted without a source — which is the whole product argument.

It runs on committed fixtures with **no credentials at all**: `npm run dev`.

**The shape of it, and this is the preview's own map** (`docs/design-preview.html`,
the `Six page types` screen — open it, it is standalone and clickable):

| | |
|---|---|
| **It arrives** | the notification. *Not a page* — one claim, one button, sent when something fires |
| **Four pages, and that is all** | **Mission Control** (what needs you, worst first) · **the alert** (one page per type) · **the conversation** · **Later** |
| **Reached only from a citation** | the records — a Zoom segment at its line, a Slack message in its thread, a Jira issue, a Confluence page, a Miro frame. No menu entry, no browse, no search |
| **Under the bonnet** | **Sources** — what is connected and what failed to join. Coverage, never content. Reached from the connector dots, deliberately not the toolbar |
| **Deleted as destinations** | the five vendor panes and the two lenses |

`DIRECTION.md` §3 opens **"Eight destinations become four"** — eight is the count
of the app that was *deleted*. The router carries eight *routes* because a note
and the Ask index are pages you open from Later and from a conversation; that is
not the same number and must not be quoted as one.

**The preview decides.** Where this file, `DESIGN.md` or any prose disagrees with
`docs/design-preview.html`, the preview wins — it is the version that was tested
in a browser. Open it off disk before building a screen.

> **Read in this order before writing code:**
>
> | | |
> |---|---|
> | **`docs/DIRECTION.md`** | **start here** — what the product is and why. The one document that states the direction |
> | `docs/DESIGN.md` | what the screen does — the interface spec |
> | `docs/design-preview.html` | the clickable target. Open it off disk; **it wins over prose, including this file** |
> | `docs/ROADMAP.md` | the ledger — what is built and what is left |
> | `docs/BUILD-PLAN.md` | how the alert-first work was sequenced — the reasoning behind what `ROADMAP.md` now tracks |
> | `docs/GRAPH-SCHEMA.md` | the contract between the collectors and the gateway |
> | `docs/KNOWN-GAPS.md` | what is broken, approximate, or deliberately unfinished |
> | `docs/ARCHITECTURE.md` | the layer underneath — field ownership, the event log, echo suppression |
> | `docs/CEREMONY-FLOW.md` | how a meeting becomes the commitment note the flagship alert fires on |
> | `docs/HACKATHON.md` | who decided the direction and what they weighed — **local only, gitignored** |
>
> Or read the lot on one page: `docs/html/everything.html` — run `npm run docs`
> first, that directory is generated and gitignored.
>
> Rule of thumb: **for what exists, this file wins. For what to build,
> `DIRECTION.md`, `DESIGN.md` and the preview do.**
>
> **The one thing in the direction that is not built** is `DIRECTION.md` §1's
> evidence view: the graph, the timeline and the focus lens come back as
> *evidence on an alert*, reached by clicking "why?", rather than as
> destinations. `buildStoryline`, `buildTimeline` and `buildRelationGraph` are
> its specification and are deliberately kept.


### Where things live

Everything above is loaded every session. The **area depth is not** — it is five
skills under `.claude/skills/`, which load when their description matches what
you are doing. Nothing was deleted; it moved, and this table is where it moved
to. If you are working in an area and its skill has not loaded, read the file.

| working on | skill | the docs that outrank it |
|---|---|---|
| the five collectors, the graph contract, fixtures, going live, Miro, the re-derive | `mc-collectors` | `docs/GRAPH-SCHEMA.md` |
| the screens, stylesheets, routing, fonts, notifications, Sources | `mc-interface` | `docs/design-preview.html`, `docs/DESIGN.md` |
| findings, alert kinds, the work lane, the dossier, aging, cycles | `mc-detectors` | `docs/DIRECTION.md` §1 |
| providers, structured output, the envelope, summaries, inference | `mc-agent` | — |
| the verifiers, `inspect.mjs`, the vault memory paths, `npm run docs` | `mc-ops` | — |

**A skill that did not fire is the one failure nothing here can observe**, so the
rule for what stayed in this file is deliberately conservative: every invariant,
every import-order contract, and every one-line reason a constant points the way
it does — `DF_MAX_SHARE` raised and never lowered, `activeSprintOf` sorting
naturally, `joins.ts` minting only on exactly one survivor. Getting one of those
backwards compiles clean and passes `npm run verify`.

---

## Before you build a screen — read this, it has already been got wrong

**A proposal queue was built and removed.** Every fact needed to avoid it was in
`DIRECTION.md` and `DESIGN.md`, and both had been read. Reading was not the
problem, so re-reading is not the fix. This is:

**1 · The shipped code is not the specification.** This is the whole of the
mistake. `act.ts` and `Actions.tsx` said "accept it in the queue", no queue
existed, and the conclusion drawn was *a queue is missing* rather than *that
sentence is stale*. It was. **When code refers to something that does not exist,
the default assumption is that the code is out of date — not that the thing needs
building.**

**2 · A new destination needs a document section, named out loud.**
`DIRECTION.md` §3 lists four pages plus Sources and the record views, and every
one passed one test: *can you name the moment somebody opens it, and what they do
next?* Before adding a route, a nav entry or a page component, say which section
sanctions it. If you cannot point at one, it does not belong — and `DESIGN.md` §4
caps the toolbar at three, deliberately.

**3 · `docs/design-preview.html` decides behaviour, not the code and not prose.**
It is committed, standalone and clickable — open it. It settles what a click
does. On an action it replaces the block with the result and a
`choose something else` link, **in place, with no navigation**, because the alert
page is the review surface: the reader has the claim, the checklist and every
citation in front of them, and a second screen re-asks what they just answered.

**4 · If a word is absent from `DIRECTION.md` and `DESIGN.md`, it is not part of
the interface.** Neither contains "proposal" or "queue" — not once. A `Proposal`
is real and correct in `act.ts` as the mechanism of a write and its provenance;
it is not something a person is shown. Same for wikilinks: internal to vault
storage, absent from every screen. The one that reached the interface got there
only via the removed queue.

**5 · Then run it.** `npm run verify` includes `scripts/verify-design.mts`, which
enforces the checkable part of the above — the route set, the toolbar cap, the
retired vocabulary, the component list, the stylesheets and how they layer. It
is not a substitute
for 1–4; it is what catches you when 1–4 did not.

**Demo mode is the one thing outside all of this, and it is outside on purpose.**
`MC_DEMO=on` wraps the app in a welcome card, a one-page pitch, a simulated
hand-off and a sticky guide strip — `apps/shell/src/demo/`, off unless the
variable explicitly says otherwise. It passes rules 2 and 4 by *not being in the
interface*: no route, no nav entry, no toolbar slot, `AlertApp` untouched and
taking no props, and its stylesheet deliberately not one of the seventeen. Read
it as the precedent for "this is not the product" rather than as permission to
add a screen — a fifth destination still needs a document section, and
`verify-design.mts` now also asserts that nothing under `alerts/` imports from
`demo/`, that every class in `demo.css` is `mcdemo-` prefixed, and that the flag
defaults off.

And curling the gateway is not using the app. The dead "accept it in the queue"
reference survived repeated end-to-end curl verification, because curl cannot see
a link that goes nowhere. **Open the browser.**

`README.md` explains *what* this is and the product reasoning. This file covers
what you need to change it safely. Read the README's "five ideas" section before
touching the gateway — the invariants below are enforcements of it.

## Commands

**Node `>=22.12.0`** — `engines` in `package.json` plus a `.nvmrc`. The floor is
the intersection of what the dependencies actually need — vite
`^20.19 || >=22.12`, concurrently `>=22`, and `process.loadEnvFile` — not a
guess, so lowering it breaks `env.ts` before anything else.

```bash
npm run verify              # THE acceptance command — typecheck, a byte-identical
                            # fixture regenerate, the four verifiers, the shell
                            # build. ~2s, no credentials, no network, no server
npm run dev                 # shell :4200 + gateway :8787 (concurrently)
npm run typecheck           # tsc -b over the whole workspace
npm run typecheck:affected  # only projects touched vs. main (nx)
npm run typecheck:all       # all 5 projects, cached (nx)
npm run build               # tsc -b && vite build
npm run graph               # open the nx project graph
npm run docs                # re-render docs/ as styled HTML (docs/html/)
npm run fixture             # regenerate fixtures/ from scripts/fixture/
                            # (then `rm -rf vault` — an existing vault is not reseeded)
```

There is **no test framework**. Verification is `npm run verify`, plus curling
the gateway (see the README's "Try it"). Don't claim a change works because it
typechecks — the interesting bugs here are wiring bugs.

**And do not claim it works because you curled it either.** The alert loop was
verified end to end by curl more than once while the strip on the alert page
pointed at a screen that did not exist — curl is precisely the path that cannot
notice a dead reference in an interface. If a change is meant to be usable, open
the browser and use it.

**Then check what you built against `DIRECTION.md` §3 and the preview before
believing it belongs.** The failure that followed was the opposite one: the dead
reference was real, and the fix — a proposal queue — was a page the design had
deliberately deleted. Reading the shipped code as the specification is how a
destination the direction cut grows back.

A `PostToolUse` hook (`.claude/settings.json` → `scripts/typecheck-hook.mjs`)
runs `nx affected -t typecheck` after any edit under `apps/` or `libs/` and
blocks on type errors. It deliberately does **not** run the root `tsc -b` — see
"Two typechecks" below.

Default mode is `MC_MODE=mock`: fixtures, no network, no credentials. Keep it
working. Every change must still run with an empty `.env`.

**Connectors are chosen per surface, not by `MC_MODE`.** One switch for all five
makes "real" all-or-nothing — five vendor credentials before anything is real,
so in practice nothing ever is. Each surface goes live the moment its own
credential is present:

| surface | goes live on | file |
|---|---|---|
| Miro | `MIRO_ACCESS_TOKEN` | `libs/connectors/src/real/miro.ts` |
| the rest | *(no live client — they come from `MC_GRAPH_DIR`)* | `libs/connectors/src/graph/` |

Miro matters most because it is the one surface that is *not* read from
`MC_GRAPH_DIR`: with a token set, `listConnectors` returns whatever is drawn on
the live canvas, which is a different and unreconciled account of what depends on
what from the one the graph carries. That is not hypothetical — see "Dependency
truth comes from the GRAPH" in the `mc-detectors` skill. `/api/health` reports `connectors` per
surface, because `mode: mock` alone would hide a live board behind a word that
says fixtures.

The real connector has no `createSticky` either, for the reasons in the
`mc-collectors` skill, and its
only write is `exportSnapshot` (laid out to the right of everything already on
the board, so it can never draw over somebody's work). It encodes the same two
API lessons `scripts/seed-miro.mjs` paid for: transient `500`s on `POST /frames`
and `429`s under a burst both retry, and a frame's child is positioned by its
centre relative to the frame's top-left with `relativeTo` left unsent.

`listConnectors` costs one extra GET per distinct endpoint id, memoised per
call — Miro returns item ids on a connector, never the Jira key. ~4s for 12
arrows on the demo board; it is the first thing that will hurt on a big one.

**`.env` is loaded by `apps/gateway/src/env.ts`, and that import must stay first
in `main.ts`.** In ESM every imported module's body runs before the importer's,
so `loadEnvFile` called from `main.ts`'s body was too late for every
module-level `process.env` read in the gateway — `ANTHROPIC_MODEL`,
`COPILOT_MODEL`, the MCP URLs and `MC_VAULT_DIR` all silently fell back to
defaults. An import sorter that moves that line down restores the bug with no
error and no obviously wrong output. `tsx watch` does not reload `.env`, so
restart the gateway after editing it.

## The dependency graph

Five nx projects. Everything points at `@mc/domain`:

```
@mc/domain        ← connectors, vault, gateway, shell   (hub)
@mc/connectors    ← gateway            (gateway-only)
@mc/vault         ← gateway            (gateway-only — see below)
```

There is no shared client store: an alert's subject travels to the gateway as
`ContextEnvelope.finding`, which is the honest shape, since the flagship finding
is about the absence of a work item rather than about a screen.

**`.gitignore` patterns must be anchored, and this one cost a typecheck.**
`vault/` — the runtime notes directory — matched `libs/vault` too, because a
pattern with no leading slash matches a directory of that name at any depth. Git
was unaffected, since ignore rules do not apply to tracked files, so nothing
looked wrong. **nx resolves it against the filesystem**, so `@mc/vault` was
absent from the project graph and `typecheck:all` ran five projects while
claiming six — never checking the one library that must not reach for node
globals in a browser. `/vault/` now. See `KNOWN-GAPS.md` §1.

Practical consequence: a change to `libs/domain/src/index.ts` invalidates all
five projects, so `typecheck:affected` saves nothing there. It does help for
`libs/vault` (2 projects) and app-level changes (1). Check with:

```bash
npx nx show projects --affected --files=<path>
```

## Two typechecks, and they disagree

`npm run typecheck` (root `tsc -b`) compiles the whole workspace as **one**
program with `types: ["node", "vite/client"]` applied to every file. The
per-project configs used by `typecheck:all` set `types: []` on the platform-
neutral libs.

So the root check is **weaker**. `process.env` inside `libs/domain` passes
`npm run typecheck` and fails `npm run typecheck:all`:

```
libs/domain/src/index.ts: error TS2591: Cannot find name 'process'.
```

The per-project result is the correct one — `@mc/domain` is imported by the
browser and must not reach for node globals. **`typecheck:all` is
authoritative**; the root script is IDE parity and fast whole-workspace sanity.
`npm run build` still uses the root `tsc -b`, so a build passing is not proof
the strict check passes.

**Neither typecheck sees a file nothing imports.** `noUnusedLocals` works inside
a file; an unreferenced *module* is invisible to both — as are an npm dependency
nothing imports and an nx library nothing depends on. Thousands of lines can sit
in the tree passing every check. The two things that do find them are in
`KNOWN-GAPS.md`'s dead-code section.

**`noUnusedLocals` and `noUnusedParameters` are on** (`tsconfig.base.json`), so
both checks now fail on a dead local or an unused argument. They were added
against a tree that already passed clean, which is the only cheap moment to add
them — the cost of turning them on later grows with every unread binding nobody
noticed. There is no test framework here, so the compiler is the only thing
that will ever tell you a helper stopped being called.

An unused *parameter* you must keep (a callback signature, an interface you are
implementing) is prefixed with `_`, which both flags ignore. Reach for that
rather than switching the flag off.

## Invariants — breaking these breaks the product, not just the build

**`@mc/vault` is gateway-only.** It touches `node:fs`. It is deliberately
*absent* from the vite aliases in `apps/shell/vite.config.mts` so a browser
import fails loudly. The note page reaches it over HTTP, the way every screen
here reaches its data. Don't "fix" that missing alias.

**Field ownership.** Exactly one surface may write each field — `FIELD_OWNER` in
`libs/domain/src/index.ts`. Jira owns status; Miro owns position and arrows.
Everything else is a *proposal*, never a direct write.

**The model does not hold the button.** `HUMAN_ONLY` in `agent.ts` withholds
`accept_proposal` and `reject_proposal` from *both* providers — the filter is on
the shared seam, so a provider cannot opt back in. A person reaches those
handlers over `POST /api/tools/:name`, which the model cannot call. Everything the agent
reads — Slack, transcripts, ticket bodies — is untrusted text arriving through
tool results, so "a human accepts it" has to be a fact about the tool set, not a
sentence in the system prompt. Adding either tool back re-opens the gate.

**A comment is not a field.** `surfaceMemory` in `apps/gateway/src/memory.ts` is
the one outbound write with no human gate, and `FIELD_OWNER` is why: nobody owns
a Jira comment as *state*, so posting one changes nothing, cannot start a sync
war, and cannot make the vault a second source of truth. It still carries an
echo token. If you ever make it write a field, it needs a proposal like
everything else.

Accepting a `create_issue` uses the same escape hatch for **provenance**: the
new ticket gets a comment naming the meeting, the rationale and every citation
with its timestamp. `WorkItem` has no description field, and this is the reason
that is survivable. It is a *second* vendor write, so it takes its own echo
token — stamping it with the proposal's would leave the comment webhook
unsuppressed.

**Accepting `create_issue` also closes the vault loop, and that is the ratchet.**
If the proposal carries a `noteId` (the promise was already in the vault), the
new key is appended to that note's `relatedKeys`, so `/tidy` can retire it once
the work moves on. If nothing held it, a `dated` `commitment` note is created
carrying the proposal's evidence. Without this the vault learns nothing from a
ceremony and next sprint assembles its brief from the same blank slate — which
is the whole difference between this and a meeting-notes tool.

**`update_issue`, `link_issues` and `post_message` now write.** They sat in the
`Proposal` union from the beginning with no branch in `accept_proposal`, so
accepting one settled it and wrote nothing — the worst failure available, since
accepting reported success. `update_issue` runs its patch through
`mayWrite('jira', field)`, so `FIELD_OWNER` is a runtime guard and not just a
doc comment. **Nothing produces these three yet** — the branches are correct and
unexercised; a producer needs extraction good enough to name a specific field
change ("pull MC-104 from the sprint"), which is what `extract.ts` is for.

It stays quiet on purpose — two transitions only (`in_progress`, `blocked`),
four note kinds, and never the same note twice on the same ticket (checked
against the durable log, so a restart does not make it repeat itself). A bot
that comments on every transition gets muted in a week, at which point it may
as well not exist. Loosen those gates and you lose the feature, not just the
signal-to-noise.

**Echo suppression.** Every outbound write is stamped and matching inbound
webhooks are dropped (`EventLog.markOutbound` / `isEcho`). Without it, one card
drag loops forever between Miro and Jira. Any new write path needs it.

The token goes on the **vendor** write, never on our own record of it.
`causedBy` is the id of the *triggering event*; put the outbound token there
instead and `append` suppresses your event as an echo of itself, silently. That
is what swallowed `workitem.linked` the first time it was written.

**Proposals are durable.** `propose()` writes `mc.proposal_created` to the log
and `settle()` writes the verdict; `rehydrateProposals()` replays both at boot.
A pending proposal is a promise that a decision is still there tomorrow — and
the scheduler makes them at 22:00 when nobody is watching, so an in-memory Map
would lose exactly the ones nobody saw being made.

**Miro webhooks do not cover connectors.** They fire on item create/update/
delete only, so the arrows — the whole of demo flow #2 — are invisible to them.
`canvas-poll.ts` diffs `listConnectors` instead. Its first pass is a baseline,
never news, or a board with forty arrows writes forty Jira links on boot; and it
reports additions only, because a deleted line is not a deleted dependency.

**That baseline lives on disk** (`vault/raw/canvas-baseline.json`), and it has to.
Held in memory, "the first pass is a baseline" meant every restart re-baselined,
so an arrow drawn while the gateway was down was absorbed and never produced a
link — silently, which is the worst way to lose one. It carries its `boardId`
(another board must not inherit it) and a timestamp: older than 24h it
re-baselines rather than reporting a quarter's worth of arrows as new.

**Recall budget.** `recall()` in `libs/vault/src/recall.ts` injects notes into
every agent turn under a hard ~900-character budget and **fails closed** — on
error it injects nothing rather than a broken block. Preserve both properties.
The budget is measured with `renderRecalledNote()`, the same function
`renderContext` prints with; don't re-derive the markup length by hand, which is
how it drifted ~19% under the real cost before.

**Decay.** `stalenessOf()` is the only place `recency` changes an outcome. A
`dated` claim is ranked down as it ages past `verifiedAt` (fresh for 14 days,
fully rotted at 42); `timeless` and `pointer` notes do not rot and keep the old
gentle `updatedAt` drift. Applying both to a dated note double-counts its age.

Decay **never deletes and never hides** — it changes what the system volunteers,
not what it holds. A stale note still appears in an explicit lookup, still sits
on its note page, still counts as evidence, and still wins on a join-key match
(the penalty is 8 against a spine bonus of 20). It just arrives carrying "may be
stale" so the agent hedges instead of asserting. Silently dropping it would make
the vault lie by omission, which is worse than the staleness.

**The scheduler only runs skills, and only reading ones.** `scheduler.ts` fires
`/standup` at 08:00 and `/tidy` at 22:00. It posts nothing, writes no field and
changes no note — `tidy` produces proposals and a human still presses the
button. "Have we already run today" is answered from the durable log, not from
memory, so a restart at 22:05 does not re-run the 22:00 pass. `MC_SCHEDULER=off`
disables it. Adding a slot that writes outward breaks the one property that
makes a background job tolerable.

**A slot stays open two hours** (`CATCH_UP_HOURS`), so a gateway that was down at
08:00 still runs the standup when it comes back at 09:30 — the hour a gateway is
most likely to be restarting is the hour people start work. This is *only* safe
because of the durable-log check above: the window says a run is eligible, the
log says whether it is outstanding, and widening one without the other re-fires
the ceremony every minute. `slotIsOpen(now, run)` is exported and pure so the
rule can be tested against a table of clock times instead of at 08:00.

**Skills are deterministic.** `apps/gateway/src/skills.ts` gathers and renders a
ceremony brief without calling the model at all — the agent is not asked to
remember to call six tools in the right order. Three reasons and all three are
load-bearing: it works with no LLM (mock mode has to stay a complete product),
there is one file to read when the brief is wrong, and a ceremony that renders
differently every morning is worthless. The brief lands in the transcript, so
the *next* question is asked against it; that is where the agent comes in.

The one model-backed part is **additive and stays behind that floor**.
`extract.ts` reads action items the cue regexes miss — traced against the
fixtures, `ACTION_CUE` drops "the provider **owes** us a sandbox" (`\bowns\b`
does not match "owes") and "we **should** write it down as a pattern", the
second of which is the vault's flagship feature being asked for aloud. Recall,
not precision, is what limits the pack, and a word list cannot fix it. So:

- `SkillContext.extract` is `undefined` when nothing on the machine can answer,
  and every skill still runs. The regexes are the floor, never the fallback.
  (It used to be gated on `ANTHROPIC_API_KEY` alone — the one model-backed
  module written against the Messages API only — so the actions the cues drop
  were invisible to exactly the fresh checkout the floor exists to protect. It
  goes through `structured.ts` now and reaches the CLI login like the rest.)
- Its candidates go through the **same `reconcile()`** as speech and stickies,
  so a rephrasing of something the cues already caught merges instead of being
  proposed twice. Inference-only actions are marked and score 0.35.
- The answer is cached in `vault/raw/extraction-cache.json`, keyed on a hash of
  the transcript's *content*. That is what keeps "same input, same brief" true
  across re-runs; delete the file to re-ask.

This is also what the scheduler will stand on when it exists — nightly
consolidation is `tidy` on a timer, not new machinery.

**The board is two halves and only one of them is Jira.** `listAppCards` returns
work that is already a ticket; `listStickies` returns what people actually wrote
in the room. Both are read-only from our side — there is no `createSticky` and
there should not be, because `position` and `frame` are Miro's and a workshop
board is somebody's thinking in progress. Anything we put back goes through
`exportSnapshot`, into our own frame, timestamped.

`/workshop` is the one skill that reads both halves plus the transcript, and its
job is the *reconciliation*: the same action is routinely said aloud and written
on a sticky in different words, and a naive union proposes it twice. The
thresholds in `sameAction` are tuned to split rather than merge — a false split
is a second proposal to reject, a false merge silently drops an action item.
Only stickies in a frame the team labelled "Actions" become proposals; a "went
badly" sticky is not a ticket.

**A workshop is about one meeting AND one board.** `/workshop zoom-003
board=uXjVK…` states the pairing; it is then recorded as `miro` evidence on that
meeting's brief note (the literal label `board <id>`, which `BOARD_EVIDENCE`
parses back), so every later `/workshop zoom-003` finds the same board without
the argument. `MIRO_BOARD_ID` is the last resort, not the default it used to be:
one process-wide board makes every retro look like it was drawn on the same
canvas, and a sticky from another meeting merging with a sentence from this one
is stamped "said and written" — a *false* corroboration, which is worse than a
missing one. The skill returns `boardId` so a caller knows which board the run
was about; no caller reads it today.

**The pack is a note before it is a page.** `/workshop` writes its brief to a
stable `brief` note (`workshop-<transcriptId>`) and the `publish_doc` proposal
carries a `noteId` rather than the text. `accept_proposal` then publishes the
note's *current* body. That is the difference between a tool that drafts and a
tool that publishes what a human decided: a proposal payload is frozen when it
is made, so publishing from it would discard every edit made to the note since.

The note is **never overwritten** — a re-run re-renders the brief in the
transcript (always current) but leaves the note alone, because clobbering an
edited pack because somebody moved a sticky is unforgivable. Delete it for a
fresh one. If `assertVaultSafe` rejects the body (a quoted sticky reading
`status: blocked` at line head will do it), the skill says so and falls back to
the inline text rather than throwing out of the ceremony.

**Repeatable proposals need a `dedupeKey`.** `propose()` in `tools.ts` takes an
optional fifth argument, a `ProposeOpts` object (`{ dedupeKey, batch,
confidence }`). Anything a skill can emit must pass a `dedupeKey`, or running
`/tidy` twice before lunch leaves two identical decisions to make, which is how
a list of them stops being read. Only *pending* proposals dedupe — a note you
re-verified in March is allowed to go stale again.

`batch` and `confidence` are the other half of the same problem, arriving from
*one* run rather than across runs: a ceremony emits a proposal per action item,
and twelve separate decisions after every meeting is a list people stop opening.
Proposals sharing a `batch` are one decision, and `/api/proposals` sorts by
`confidence` descending. `confidence` is corroboration, not correctness — said
*and* written outranks a sticky, which outranks a spoken sentence, which
outranks something only the model read. Nothing gates on it.

**THERE IS NO QUEUE SCREEN, and there must not be one.** `batch`, `confidence`
and `dedupeKey` are live in `tools.ts` and shape what `/api/proposals` returns,
and nothing renders them as a list to work through; a queue was built from a
stale sentence like this one and removed — see "A wrong turn" in ROADMAP.md and
the section at the top of this file. The alert page is the review surface;
accepting is a human act over `/api/tools/accept_proposal`.

Wherever a batch is next put in front of somebody, one rule holds:
**offer reject-the-rest and never accept-the-rest.** A bulk reject costs a
proposal that comes back next run; a bulk accept would create a dozen real
tickets from one click, which hollows out the same gate `HUMAN_ONLY` protects.

**The join key.** Every artefact carries a Jira issue key; there is no second ID
space. `extractKeys()` is how unstructured text attaches to the structured spine.

**And it is a regex, which is why `infer.ts` exists.** The join fires only when
somebody typed a key, and **a large share of text-bearing records carry none** —
in fixtures that were *written* to make the join work. (There used to be a
precise percentage here and in two other files. Re-measured three times it came
back three different numbers, because it moves with what you count as a record
and how you split a body; the argument never needed it, and a figure nobody can
reproduce weakens the claim it was meant to support.) A
real Confluence space, Miro board and Zoom archive are worse, because nobody
writing a runbook or a sticky thinks in ticket numbers. Two lines from the
Sprint 14 planning call, the meeting the demo is built on, are invisible to
`buildRelationGraph`: *"Someone needs to own the dedupe cache"* and *"Riya, can
you take the decision record in Confluence?"*

So a model reads the corpus and proposes the rest. Six rules hold it:

- **It is additive and provenance-tagged, never a replacement.** `GraphEdge`
  gained `provenance` / `confidence` / `basis`; absent means `extracted`.
  `mergeInferred` in `@mc/domain` folds candidates onto a graph
  `buildRelationGraph` already built, and **drops any pair that is already
  linked** — a citation beats a claim outright.
- **`provenance` is not a sixth `Owner`.** Setting `asserts: 'inference'` is the
  obvious implementation and it breaks `FIELD_OWNER`, `Evidence.surface`, every
  `for (const s of SURFACES)` loop and every per-surface colour map. Same rule
  that keeps anything owning no field out of `Surface`. `asserts` still names the
  surface the *evidence* came from.
- **It never touches `cycles`, `criticalPath`, `degree` or `orphans`.** The cycle
  banner accuses the team of an unschedulable plan and offers to fly you to it;
  a guess must not be able to raise one. Degree is "how connected is this
  really". And "nothing links this" stays true when only our own inference does
  — that is exactly the note `/tidy` should still nag about.
- **Every edge carries a `basis`, or it is dropped.** An unexplained dashed line
  is a machine asserting a dependency nobody can check, which is worse than no
  line: the reader can only trust it or ignore it, and they ignore it. Whatever
  renders an inferred edge has to show its basis — the dossier badge carries it
  in a tooltip, and the evidence view will need the same.
- **`blocks` runs `from` → `to`, blocker first.** The board's own convention
  (`MC-103 → MC-102`, because "I cannot finish MC-102 until MC-103 lands"). The
  first prompt said "from is blocked by to" and *every* inferred dependency came
  back reversed, drawn confidently the wrong way round. The prompt now spells it
  out in both orders.
- **It is a background job, never a step in a request.** `startInference` warms
  at boot and re-asks at most every 10 minutes; routes read a synchronous memo,
  and a cold memo means the graph is exactly what it was before this existed.
  `gatherCorpus` reads all five surfaces before a model is even asked — inline,
  that is a multi-second stall on the front door.

It walks the same provider ladder as the agent, so **it costs nothing in a fresh
checkout**: the Claude CLI first, `ANTHROPIC_API_KEY` second, `null` third — and
`null` is a supported state, not a degraded one. Answers are cached on a hash of
the corpus *content* (`vault/raw/inference-cache.json`) for the reason
`extract.ts` is: an answer that changed per load would move the graph under
somebody reading it mid-sentence. Delete the file to re-ask.

Read them off a ticket:

```bash
curl -s localhost:8787/api/issue/PAY-9041 \
  | jq -r '.related[] | select(.provenance=="inferred") | "\(.confidence) --\(.via)--> \(.id)\n     \(.basis)"'
```

If the cycle finding covers more than the one deliberate loop after an inference
run, `mergeInferred` has been changed to feed the dependency arrows. It must
not.

## Vault notes

Markdown with YAML-ish frontmatter in `vault/notes/`, parsed by
`libs/vault/src/frontmatter.ts` (hand-rolled, not a YAML library — `evidence`
entries are JSON objects one per line). Seed notes are committed as demo
fixtures; `vault/raw/` (the event log) is gitignored. Real users point
`MC_VAULT_DIR` elsewhere.

Note `kind` and `status` drive recall ranking — check `libs/domain/src/index.ts`
for the unions before inventing new values.

**`links` is derived, and deliberately not stored.** `decodeNote` computes it
from the body with `extractLinks` and ignores frontmatter, so a `links:` line
was write-only — never read back, overwritten on the next save, and free to
drift in between, which three of the six seed notes had done. `encodeNote` no
longer writes it. Don't add it back to "make the file self-describing": the body
is where the `[[wikilinks]]` are, and a second copy can only ever disagree.

`brief` is the one kind that is **never recalled**. `isRecallable()` in
`@mc/domain` excludes it and `recall()` filters on that. A brief is a ceremony
pack — a few thousand characters assembled *from* the notes underneath it —
against a `RECALL_BUDGET` of ~900, so injecting one would either be dropped for
length or crowd out every note that actually holds a claim. It stays a normal
note everywhere else: visible on its note page, editable by hand, publishable,
citable as evidence. If you add another derived kind, add it to `isRecallable`.

`vault.create()` **refuses an explicit `id` that already exists** — the write
path does not merge, so creating over a note replaced it wholesale, and a `POST
/api/vault/notes` carrying only `{id, body}` left a note with no kind and no
title that crashed anything tokenising a title. Generated ids cannot collide;
explicit ones became routine when skills started keeping stable per-meeting
notes. `PATCH /api/vault/notes/:id` is the update path — what `NotePage.tsx`
uses. `POST` means create.

## Adding a new `@mc/*` library

Four places, and missing any one fails differently:

1. `tsconfig.base.json` → `paths` (or tsc can't resolve it)
2. `libs/<name>/package.json` → name, `exports`, `dependencies`, `nx.targets`
3. `libs/<name>/tsconfig.json` → extends base; add `"types": ["node"]` only if
   it's server-side
4. the **consuming** project's `package.json` → `dependencies` (this is what
   nx builds graph edges from; nx core does not infer them from imports)

Plus `apps/shell/vite.config.mts` aliases **only if** it is browser-safe.

## Gotchas

`docs/KNOWN-GAPS.md` is the full inventory — what is broken, what is only
approximate, what will not survive live mode, and (section 6) which apparent
gaps are deliberate and should not be "fixed". Read it before concluding
something here is a bug. The entries below are the ones you trip over daily.

**NOTHING PUBLISHED CARRIES A REAL NAME, A LIVE BOARD ID OR A REAL DOMAIN.**
People are roles in every committed document — *the product lead*, *the graph
author*, *the delivery lead* — board ids are gone, and a real company domain in
`GRAPH-SCHEMA.md`'s examples is `example.com`. This is easy to breach by
accident, because the source material is right there and full of names: read
`HACKATHON.md`, write roles.

`docs/HACKATHON.md` is **gitignored and local only** — four named colleagues,
verbatim quotes and live board ids, useful to the team and to nobody outside it.
It is the record of the two August planning sessions that set the direction — the decisions, who made them, the regrouped sticky board, the
five-minute video storyboard, the cut list and what is still open.

`docs/DIRECTION.md` is the other half of that: what the product is — alert-first,
with the five vendor panes and the two lenses deleted as destinations. **It is
built.** Where the two disagree, the header's rule of thumb applies: for what
exists this file wins, for what to build that one does. The one part still
outstanding is §1's promise that the graph, the timeline and the focus lens come
back **as evidence**, reached by clicking "why?" on an alert — which is a panel
on the alert page, not a page of its own and not a route.

`docs/DESIGN.md` specifies the interface that direction produces — the token
system, the two page shapes, the navigation model, and a section of rules that
were each bought with a bug (counts must be derived, dates must come from one
constant, `color-scheme` must be declared, icons are masks not glyphs). It is
written from `docs/design-preview.html` — a committed, standalone, clickable
preview of every screen, which is the visual reference. It is hand-written and
NOT generated: `npm run docs` does not touch it. Open it off disk, and build a
screen from it plus `DESIGN.md` rather than from a screenshot.

- The vite aliases are **derived** from `tsconfig.base.json`, not a second copy
  of it — add a `@mc/*` library there and the shell resolves it with no second
  edit. Two consequences. `tsconfig.base.json` must stay strict JSON (no
  comments; the per-project ones may have them), and anything the browser must
  not import goes in `BROWSER_FORBIDDEN` in `vite.config.mts` — which is how
  `@mc/vault` stays unaliased. Deriving without that deny-list would quietly
  hand the browser a library that touches `node:fs`.
- `apps/shell/vite.config.mts` is typechecked by **nothing**. The shell project
  sets `types: ["vite/client"]` so a node global in browser code fails loudly,
  and the config imports `node:url` and `node:fs` — so including it would undo
  the guarantee it is there to enforce. Vite transpiles it without checking it.
  An error in that file surfaces when the dev server starts, not at
  `typecheck` — which now matters more than it did, since the aliases are
  computed there. `npm run build` is the cheapest way to exercise it.
- nx's postinstall is blocked by npm's `allowScripts` policy. Harmless: the
  native binary arrives via the `@nx/nx-darwin-arm64` optional dependency.
