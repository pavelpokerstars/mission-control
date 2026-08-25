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
retired vocabulary, the component list, one stylesheet. It is not a substitute
for 1–4; it is what catches you when 1–4 did not.

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

**The docs are generated, and the markdown is the source.** `npm run docs`
(`scripts/render-docs.mjs`) renders every reference into `docs/html/` with the
app's own palette. Edit the `.md`; never edit the HTML, which carries a
"GENERATED FILE" banner and is overwritten. `docs/html/` is gitignored.

The palette lives once, in `docs/doc.css`, and is inlined into every page so
each one renders standing alone with no server and no stylesheet to resolve. A
page that kept its own copy of the CSS would drift from the rest, which is the
failure this repo keeps paying for elsewhere.

With a gateway running, `scripts/inspect.mjs` is the fast way to look at it:

```bash
node scripts/inspect.mjs up               # are :8787 and :4200 answering
node scripts/inspect.mjs health           # mode, graph dir + counts, status map, tools
node scripts/inspect.mjs statuses         # every vendor status word, and what it became
node scripts/inspect.mjs identities       # who the graph knows, and by which handles
node scripts/inspect.mjs work sam         # one lane, with its signals
curl -s localhost:8787/api/findings       # the alert list, worst first
node scripts/inspect.mjs issue PAY-9031  # one work item's whole context
node scripts/inspect.mjs summary PAY-9031 # the agent's read on where it stands
node scripts/inspect.mjs notes            # note ids + status
node scripts/inspect.mjs log 20           # persisted events
node scripts/inspect.mjs stickies         # the non-Jira half of the board
node scripts/inspect.mjs suggest PAY-9031 # Ask's starter questions from there
curl -s localhost:8787/api/skills | jq -r '.skills[]|"\(.name) — \(.description)"'
node scripts/inspect.mjs skill workshop   # run a ceremony, see its proposals
node scripts/inspect.mjs recall "why is PAY-9031 stuck?"
```

Going live on Jira is three commands, and the first one is the piece that was
missing longest:

```bash
npx tsx scripts/fetch-jira-sprints.mts --board 42 --out sprints.json
npx tsx scripts/import-programme-graph.mts --in graph.json --out ./live-graph \
  --sprints sprints.json --people people.json
MC_GRAPH_DIR=./live-graph npm run dev
```

**`programme_graph` emits no sprint nodes** — sprints exist only as
`sprint_names[]` strings on an issue, with no state and no dates — and
`findMissingTickets` fires when a commitment's **container has closed**. So on
real data the flagship finding could not fire at all, *silently*. The adapter
always synthesised the nodes; what was missing was the state, and Jira's agile
API has had it all along. Run the fetcher with no `--board` to list the boards
the account can see. It exits non-zero when nothing is closed, because a
`sprints.json` that looks fine and produces no alerts is the failure it exists
to prevent.

**`Note.container` is the node id (`sprint:PAY Sprint 12`), and a bare label
also resolves** when exactly one container carries it. Every generated note has
the id; a note written *by hand* is the case the fallback is for, and writing one
commitment from a meeting you remember is a step of the live path. Two
containers sharing a label resolve to neither — sprint names repeat across
boards, and picking one would be a guess about which sprint closed.

**Zoom is two commands, and neither needs Python.** `zoom-local-sync` is the
graph author's Windows tool and its mechanism is the right one; the port is
`scripts/capture-zoom-notes.mts`, in TypeScript because Playwright's Node API is
the same API and a second toolchain buys nothing:

```bash
npx tsx scripts/capture-zoom-notes.mts --login     # once — sign in by hand
npx tsx scripts/capture-zoom-notes.mts --limit 20  # then, any time
npx tsx scripts/import-zoom-notes.mts --in ~/.mission-control/zoom-captures --out ./live-graph
```

It drives the **installed Chrome** (`channel: 'chrome'`), so nothing downloads a
browser. The persistent profile IS the credential — no token is stored.
`--help` lists all ten flags; six of them used to exist only in the source, and
on a machine that *was* set up `--help` performed a capture instead of printing
anything.

**You can check the whole thing without a Zoom account** —
`npx tsx scripts/verify-zoom-capture.mts` drives this script against a fake Hub.
See the verifiers below.

**It is headless.** `--login` is the only path that shows a window, once, because
Zoom SSO with a second factor is not something a script should drive. Every
capture run after that is silent.

**And it is cheap in steady state**, because the capture index skips a note whose
`updatedAt` has not moved: a normal run is one Hub page load and *zero* note
loads. The per-note load only happens on the first run or when a note changes.

**Whether it could be cheaper is an open question with a command attached.** The
recent-files list is already a plain `fetch` from inside the page; if Zoom serves
a doc's *content* as JSON too, the per-note page load becomes a fetch and the
browser drops to a session-holder. That endpoint is undocumented and guessing at
it would be inventing an API, so `--log-api` lists every JSON call Hub makes
while a note opens and answers it with evidence.

**What it reaches is Zoom Docs NOTES, not transcripts.** The recording API is
blocked, so there are no speakers and no offsets; the record carries `body`
instead of `segments`, `annotateTranscript` derives one paragraph per segment so
the join still works, and `records.ts` emits no `at` and no `who` rather than
inventing either. `GRAPH-SCHEMA.md` §10 has the shape and the reasoning.

**Confluence is one command per page plus the emitter.** `confluence-cli.py`
already returns nearly the right record:

```bash
python3 confluence-cli.py read <id> --format json > pages/<id>.json
npx tsx scripts/import-confluence-pages.mts --in pages --out ./live-graph
```

Two things it does that are not obvious. It **refuses an undated page** — the
CLI fetches `version.when` and prints only `version.number`, and `at` orders the
trail and drives the "before the ticket existed" badge, so a guessed date is a
false claim. And it **filters extracted keys against the graph's own projects**,
because `ADR-014` matches the Jira-key regex exactly and is not a ticket.

**Both emitters skip a node id another collector already wrote**, rather than
duplicating it (a contract violation `verify-collector` rejects) or overwriting
it (silently discarding somebody else's output).

**Slack is three commands, and it also closes the identity map.**

```bash
python3 slack-cli.py channel list > slack/channels.json
python3 slack-cli.py user list    > slack/users.json
python3 slack-cli.py message list -c C0123 --limit 200 > slack/msgs/C0123.json
npx tsx scripts/import-slack-messages.mts --in slack/msgs \
  --channels slack/channels.json --users slack/users.json --out ./live-graph
```

**`--users` is the one to not skip.** Slack knows `U024BE7LH`, the graph keys
people on email, and everything downstream compares handles — so the emitter
merges `handles.slack` into the person the Jira import already wrote. Without
it the trail says "U024BE7LH said" and the rollups count one person twice.

Slack's `ts` is unix **seconds**: `Date.parse('1755950400.001')` is NaN
silently, which is why `slackTsToIso` exists. The channel comes from the
permalink, and a message whose channel cannot be named is skipped rather than
labelled `#unknown`.

**GitHub reads `gh`, not `github-cli.py`** — that one is a write tool
(`pr reply`, `pr resolve`, `ci status`) with no `pr list`, so it cannot say
which PRs exist.

```bash
gh pr list --repo <owner/name> --state all --limit 200 \
  --json number,title,headRefName,author,createdAt,mergedAt,state,url > prs.json
npx tsx scripts/import-github-prs.mts --in prs.json --repo <owner/name> --out ./live-graph
```

**The join is the branch name**, which is why `headRefName` is not optional.
Bots are dropped — Dependabot would otherwise be the majority of every `pr`
count — and key-shaped branches like `release/ABC-123-hotfix` are filtered
against the graph's real issues, because an edge to a node that does not exist
is a contract violation.

**All five emitters merge into one graph.** Run Jira first: it supplies the
project prefixes Confluence and GitHub filter against, and the people Slack
enriches with `handles.slack`.

Four verifiers in `npm run verify`, and none needs a running gateway:

```bash
npx tsx scripts/verify-graph.mts       # the contract, the fixture's cases, the detectors
npx tsx scripts/verify-refresh.mts     # baseline, diff, re-baseline
npx tsx scripts/verify-design.mts      # the app against DIRECTION.md §3 and DESIGN.md
npx tsx scripts/verify-collector.mts   # ANY graph against GRAPH-SCHEMA.md — takes a path
```

**The fourth is the one to hand somebody else.** It takes a directory and checks
only what must be true of *any* graph, so it can be pointed at a real
collector's output — which is what turns "does a real refresh conform?" from a
conversation into a command whose output fits in a message:

```bash
npx tsx scripts/verify-collector.mts /path/to/collector/output
```

**Two more are named commands rather than steps**, because each starts
something the acceptance command promises not to. `verify-providers.mts` stands
up a fake Anthropic endpoint and drives a real tool-use loop; `verify-zoom-capture.mts`
starts an HTTP server speaking enough of Zoom Hub to drive the *real* capture
script through real Chrome:

```bash
npx tsx scripts/verify-providers.mts     # a fake model, our real tool loop
npx tsx scripts/verify-zoom-capture.mts  # a fake Hub, the real capture + import
```

The Zoom one is worth knowing about because that collector's input is a
logged-in browser, so it was the one thing here nobody but the session-holder
could check. It asserts the whole path with no credential: the whiteboard and
the off-prefix doc are filtered, the folder is `<title-slug>_<doc id>`,
`capture.json` carries the document id, a re-run opens **no** note at all (the
incremental index, which is the entire cost argument), a rename *moves* the
folder rather than doubling it, and the result imports and satisfies
`GRAPH-SCHEMA.md`. What it cannot tell you is Zoom's own DOM and payload shape —
the field names are the graph author's `browser.py` reading the real thing — so
`--log-api` on the first real run is what settles that.

`verify-collector.mts` splits severity deliberately. A **contract violation** is
a bug in the collector and exits non-zero; an unmapped status word or an
unresolved person is a **configuration gap** — the app runs, something joins less
well than it could — and only warns. Conflating them would make it cry wolf on the first real export,
which is how a check gets ignored. It also prints the `depends_on` edges in
plain English, because the direction cannot be checked structurally — both ways
are well-formed graphs — and reading four sentences settles it in ten seconds.

The third is the newest and the least obvious. It asserts that the shipped app
still has the destinations the direction lists and no others, that the toolbar is
still capped at three, that nothing in the interface is named for a concept the
direction deleted, and that `app.css` has not started a second design system. It
exists because documents alone did not prevent exactly that — see the section at
the top of this file.

`skill` is the only one of these that writes: a run that proposes appends
`mc.proposal_created` to the durable log, so clean up after a probe the same way
you would after the two memory paths below.

`recall` is the one worth knowing: it posts a turn, parses the SSE stream, and
prints the vault block the agent actually received, with its size. Use it to
confirm memory changes landed rather than guessing from the UI.

The two memory paths, which are the easiest things here to break silently:

```bash
# IN — Slack becomes a note (kind is inferred; check it guessed sensibly)
curl -sX POST localhost:8787/api/slack/capture -H 'content-type: application/json' \
  -d '{"text":"/mc remember we are blocked on the provider secret for MC-103"}' | jq '{id,kind}'

# OUT — a status change makes the vault speak on the ticket
curl -sX POST localhost:8787/api/webhooks/jira -H 'content-type: application/json' \
  -d '{"issue":{"key":"MC-103"},"changelog":{"items":[{"field":"status","toString":"in_progress"}]}}'
curl -s localhost:8787/api/jira/comments | jq -r '.[].body'
```

Both write to the vault, so clean up after: delete the note (`DELETE
/api/vault/notes/:id`), and drop the probe events with `POST /api/vault/log/delete`.
Jira comments are in-memory in mock mode and vanish on the next gateway restart.

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
truth comes from the GRAPH" below. `/api/health` reports `connectors` per
surface, because `mode: mock` alone would hide a live board behind a word that
says fixtures.

The real connector has no `createSticky` either, for the reasons below, and its
only write is `exportSnapshot` (laid out to the right of everything already on
the board, so it can never draw over somebody's work). It encodes the same two
API lessons `scripts/seed-miro.mjs` paid for: transient `500`s on `POST /frames`
and `429`s under a burst both retry, and a frame's child is positioned by its
centre relative to the frame's top-left with `relativeTo` left unsent.

`listConnectors` costs one extra GET per distinct endpoint id, memoised per
call — Miro returns item ids on a connector, never the Jira key. ~4s for 12
arrows on the demo board; it is the first thing that will hurt on a big one.

**The agent has two providers and `MC_MODE` picks.** `agent.ts` owns the
contract, the system prompt, the tool set and the recall wrapper, then hands
them to one of:

| `MC_MODE` | provider | needs | file |
|---|---|---|---|
| `live` | Copilot | `GITHUB_TOKEN` **or** a `gh`/OAuth login | `copilot.ts` |
| any | Copilot, for structured output | the same | `askCopilotStructured` |
| `mock` | **the Claude CLI** (tried first) | **nothing** — your own CLI login | `claude-cli.ts` |
| `mock` | Claude Messages API | `ANTHROPIC_API_KEY` + credit | `claude.ts` |
| none of them | scripted stub | nothing | `agent.ts` |

**The Claude CLI is the default agent, and it costs nothing.** A fresh checkout
with an empty `.env` gets a real agent over the fixtures instead of the stub —
which is what "mock mode is a complete product" was always supposed to mean. It
is tried before the metered API key on purpose.

**It really is the CLI, despite the package name.**
`@anthropic-ai/claude-agent-sdk` is not a second API client: it spawns the
`claude` binary as a child process (`child_process.spawn`, an explicit
`pathToClaudeCodeExecutable` option, and a "Claude Code executable not found"
error when it cannot). That is why it authenticates with no key and no credit —
it is running your CLI login. Reading the package name as "an API SDK" is the
mistake that sends somebody off to reimplement process management, JSON-lines
parsing and MCP tool registration that this already gets for free.

Two impedance mismatches live in `claude-cli.ts` rather than being pushed onto
callers: custom tools arrive as an in-process MCP server whose `tool()` wants a
**Zod** shape (`zodShape` converts our JSON Schema — note that optional is the
default in JSON Schema and the opposite in Zod, and getting it backwards makes
the model invent arguments), and continuity is a `resume` session id per thread
rather than a replayed transcript.

`zodShape` **recurses into nested objects**, and used to not. It passed any
`type: 'object'` through as `z.record(string, unknown)` on the grounds that no
tool nested — `infer.ts` does, and the failure was silent and one-sided: every
per-field description, every enum and the whole `required` list vanished on the
CLI path *only*, so the model omitted a field it had never been shown while the
Messages API path was fine. That reads as a model-quality problem rather than a
schema one, which is what makes it expensive. If you add a nested tool, check it
against `claude-cli.ts` and not just `claude.ts`.

`allowedTools` is restricted to our MCP tools. Without it the agent also
inherits the CLI's own file and shell tools, which have no business answering
"why is MC-102 blocked" — and would let a prompt-injected transcript reach a
shell.

Availability is a **real one-word turn**, because nothing cheaper is honest
here: an SDK importing and a session being creatable both succeed on a machine
that cannot answer. It costs ~4s, so it is cached in
`vault/raw/provider-probe.json` for 24h — `tsx watch` restarts on every save and
paying it per boot is unusable. Delete that file after logging in or out.

**The agent reaches no vendor, and there is no `MC_VENDOR_MCP`.** The four
remote endpoints — `mcp.atlassian.com`, `mcp.slack.com`, `mcp.miro.com`,
`mcp.zoom.us` — were the reason this provider was cheap, because "make the agent
aware of five tools" was a config block rather than a week of adapters. They are
**deleted** (ROADMAP D5), having defaulted to off for a while first.

Two reasons, and the second is the one that decides it. The organisation this
runs in forbids external MCP servers, so with them wired in the live provider
does not start there at all. And they were the old answer to "how do we get real
data in": five collectors now read Jira, Zoom, Confluence, Slack and GitHub into
one graph *ahead of* the turn, and the gateway serves that graph. What the
endpoints bought was the agent reading a vendor live mid-turn; what they cost was
a turn that could not happen.

It cost nothing here, because **our own twenty tools have never involved MCP**:
`defineTool` and the Messages API both take JSON Schema natively, so every
cross-surface join, the vault, the trail and the timeline are unaffected. The
`verify-providers.mts` check that the runtime accepts our session config now
tests the config we actually send; its bare-URL `mcpServers` regression guard
went too, because nothing can produce that shape any more.

**Do not confuse this with the in-process MCP in `structured.ts`**, which
survives untouched and shares only the substring. That one is a transport for
our own functions — no separate process, no network, no endpoint — and
`MC_STRUCTURED=sdk-mcp` names it. The lesson the vendor endpoints were bought
with is kept in `copilot.ts`'s header for whoever wires them back in somewhere
the policy allows: `mcpServers` is `Record<string, MCPServerConfig>` and not bare
URLs, and the transport is per-endpoint — Atlassian's is SSE, the other three are
streamable HTTP.

The Copilot CLI runtime is **bundled** (`@github/copilot` is a dependency of the
SDK) — nothing to install, nothing on PATH. The token goes on
`new CopilotClient({ gitHubToken })` and nowhere else; it was accepted and
silently dropped for a while, which produces the one failure you cannot debug
from outside: `start()` and `createSession()` both succeed and only the first
turn dies on `errorType: "authentication"`. Passing no token is legitimate —
`useLoggedInUser` defaults to true — so the provider is tried even without one.

Both run server-side — neither credential may reach the browser, and `recall()`
needs the vault. The mock provider is not a toy: it is handed the same tools,
the same prompt and the same bounded recall as the live one, which is what stops
the two drifting. Both are real implementations now; Copilot is no longer a
commented-out scaffold. Its SDK import and `client.start()` are each wrapped so
a missing runtime logs and degrades to the stub (the `koffi` native module ships
prebuilt and loads fine under npm's `allowScripts` policy — it is not the cause
of an unavailable Copilot; a missing credential is)
— losing the chat provider must not take down the findings pass, the webhooks and the
sync with it.

**Verify them without a key:**

```bash
npx tsx scripts/verify-providers.mts
```

It stands up a server speaking enough of the Anthropic Messages protocol to
drive a *real* tool-use loop through `claude.ts` — SDK tool runner, our
handlers, real gateway tools; only the model is fake. That is the difference
between "typechecks" and "the wiring works", and it has already caught one bug
`streamReply` had shipped with: a delta landing after `sendAndWait` resolved was
dropped, silently truncating the end of an answer. `ANTHROPIC_BASE_URL` is what
makes the harness possible, and doubles as the proxy knob.

`node scripts/inspect.mjs health` prints which of the three is about to answer.

**The agent sees the front door, and it is context rather than a tool.**
`ContextEnvelope.findings` carries the top `CHAT_FINDINGS` (8) of the alert list
into every global turn, filled **server-side in `/api/chat`** and **only when
`env.finding` is absent** — on an alert the other rows are noise, and the gateway
rather than the browser is the authority on what the list says. Before this, a
chat started from the Ask page answered from vault recall alone and could name a
different "most urgent" than the screen beside it, which is the failure
`related_to` and the dossier already share one assembler to avoid.

It is context and not only a tool because the agreement must not depend on the
model remembering to look — the same argument that keeps `skills.ts`
deterministic. `list_findings` exists as well, for the tail the cut removes and
for filtering by kind; it is read-only, so it needs no `HUMAN_ONLY` entry, and
`runFindings` applies suppression, so a dismissed alert does not return through
it. Filling the envelope fails silently: a chat that will not answer because the
findings pass threw is worse than one that answers without the list.

**`.env` is loaded by `apps/gateway/src/env.ts`, and that import must stay first
in `main.ts`.** In ESM every imported module's body runs before the importer's,
so `loadEnvFile` called from `main.ts`'s body was too late for every
module-level `process.env` read in the gateway — `ANTHROPIC_MODEL`,
`COPILOT_MODEL`, the MCP URLs and `MC_VAULT_DIR` all silently fell back to
defaults. An import sorter that moves that line down restores the bug with no
error and no obviously wrong output. `tsx watch` does not reload `.env`, so
restart the gateway after editing it.

**Ask's starter questions are computed, not written down.** `POST
/api/suggestions` takes the context envelope and returns four questions built
from the same joins the findings pass and the dossier use — the cycle *this* board draws, the ticket
blocked with nothing in the vault saying why, the promise nobody closed — each
carrying the join that makes it worth asking, shown under the button. Four
hardcoded strings could not: they name tickets that may be done and say the
same thing on every screen, which is an advert against the
sentence above them. `suggest.ts` is deterministic for the three reasons
`skills.ts` is, and server-side because the browser has no vault, no event log
and no arrows. It caches the *gathering* for 60s (dropped on any event the log
accepts) and re-ranks per request, so `listConnectors` is not paid on every
route change while a suggestion still follows the focused ticket immediately. It
falls back to a static four when the vault is empty or the gateway is
unreachable — an Ask box with nothing under it reads as the agent having nothing
to offer. Check it with `node scripts/inspect.mjs suggest PAY-9031`; two
different contexts printing the same four questions is the failure worth looking
for.

**It builds its lanes over the window it is asked about, not a window of its
own.** `lensDays` is the window, and `suggestQuestions` runs `buildTimeline`
over it. Pinned to a fixed 21 days instead, it quotes an age nothing else
computed over the asked-for window agrees with. **If you add another consumer
that derives a number from the timeline, derive it over the same window.**

Only the timeline is rebuilt per request — everything that costs network is
window-independent and stays cached, so changing the window costs no I/O. The
second argument to `inspect.mjs suggest` is the window: `suggest PAY-9031 7` and
`… 30` printing the same ages means it is not reaching the lane build.

**The history comes from the fixture, and the generator that used to make it is
gone.** `apps/gateway/src/seed.ts` copies `MC_GRAPH_DIR/events.jsonl` into an
empty vault on first boot and does nothing else — 126 lines, down from 415.

**What went, and why it was dangerous.** There used to be a fallback for a graph
that shipped no history: `CREATED`, `TRANSITIONS`, `surroundings()` and the mock
connectors' `HISTORY`, which generated twelve sprints of MC-* transitions. Its
own comment said what that costs — *"writes transitions for keys that do not
exist… silently, because nothing joins a stray event to anything"* — and the
guard was whether the graph shipped events. True for our generated fixture and
**false for every real collector**, because `import-programme-graph.mts` writes
`graph.json` and no `events.jsonl`. So the only path it could ever run on was
the live one. Measured: **431 MC-* events into a vault whose graph held only
PAY-* keys**, in the append-only log, which is never rebuilt.

A collector's graph with no history is not a gap to paper over — it is a
programme whose transitions have not been observed yet, and they accrue from the
Jira webhook and the scheduled re-derive from the first run. An empty log is the
honest start, and it costs exactly one thing: `aging` claims nothing until
something has moved, which is the same "we do not know beats a fabricated zero"
rule the lane already follows.

**`libs/connectors/src/mock/` went with it** — 1,170 lines. `createMockConnectors`
had been superseded by `createGraphConnectors` and had no caller; `HISTORY`
outlived it by that one fallback. With both gone, `PROFILE_MIX`, `walk()`,
`CURRENT_ITEMS`, `HISTORY_ARROWS`, `ITEMS`, `TRANSCRIPTS` and `STICKIES` are all
gone too. **Everything the demo shows now comes from `fixtures/`**, which
`npm run fixture` generates into the shape a real collector writes — so a reader
on the fixture is reading the shape it will read live, which is the only way
fixtures are a rehearsal rather than a different game.

Three things in the fixture are still load-bearing and easy to break, and they
live in `scripts/fixture/` now: the single deliberate cycle (a second one dilutes
it to noise), the newest transcript being the meeting `/workshop` reads with no
argument, and the *Actions* frame being the only one `/workshop` turns into
ticket proposals.

**`activeSprintOf` sorts sprint names naturally, not lexicographically.**
`"Sprint 9"` sorts after `"Sprint 14"` as a string, which would quietly change
what `/plan` and every skill mean by "this sprint". `compareSprints` is the
shared comparator and is module-private, because every consumer lives in
`libs/domain/src/index.ts` alongside it.

### The Miro connector, and what it drops on purpose

**The board and what we reason about can legitimately differ.** The connector
drops things on purpose: `listConnectors` drops any arrow whose endpoints do not
both resolve to a Jira key, `listAppCards` drops cards with no key, and
`listStickies` drops stickies that are empty after HTML stripping. So an arrow
somebody drew from a sticky to a card is a dependency they think they expressed,
which `/plan` and cycle detection will never see. **Sources counts exactly
these** — "3 stickies carry no key" — because a silent drop is the one thing a
coverage page exists to make visible.

To put the fixture on a real board:

```bash
set -a; source .env; set +a          # the script reads the env, not .env
node scripts/seed-miro.mjs --dry-run # what it would create
node scripts/seed-miro.mjs           # app cards, stickies in frames, arrows
node scripts/seed-miro.mjs --replace # delete what it made before, then recreate
```

**This is the one thing in the repo that creates stickies, and it must stay
outside `MiroConnector`.** The interface has no `createSticky` on purpose —
Miro owns `position` and `frame`, and a workshop board is somebody's thinking in
progress. The script is not imported by the gateway or the shell and only runs
when a human types it; it follows `exportSnapshot`'s three rules (one shot,
only what it made, human-invoked). `--replace` deletes *only* items matching the
fixture, so anything a person drew on that board survives. Moving a card in Miro
afterwards is safe: nothing reconciles.

Two things learned the hard way against the real API, both encoded in the
script: `POST /frames` returns a transient `500` perhaps one time in four and
succeeds on retry, and a frame's child is positioned by its **centre relative to
the frame's top-left corner** — sending `position.relativeTo` explicitly is a
400, the API sets it itself.

## The connection graph — the contract with the collectors

**`docs/GRAPH-SCHEMA.md` is the seam between everything that reads a source and
everything that reasons about one.** Collectors (Python — `programme_graph` for
Jira, plus the `jira-cli` / `confluence-cli` / `github-cli` family, agent-slack,
the Zoom scrape, the Miro export) write `graph.json` and `records/`; the gateway
reads them. The mock is written by a generator emitting the *same* shape, so
going live is a change of which collector wrote the file and never a change of
layer.

`libs/domain/src/graph.ts` is the same contract where the compiler can hold it.
`npx tsx scripts/verify-graph.mts` checks its rules against a fixture.

**The fixture is committed AND generated, so regenerating must change nothing.**
`npm run verify` asserts it byte for byte. It did not hold: `newEvent` stamps
`Date.now()` into the id, so every regenerate rewrote all 46 event ids while
`buildEvents`' own comment said "deterministic, like everything else here" — the
timestamps derived from the spec, the ids did not. The generator has its own
`event()` constructor deriving from `FIXTURE_NOW` and does not call `newEvent`;
keep it that way, and if you add another generated event use it.

**The mock is GENERATED, into the real shape.** `npm run fixture` writes
`fixtures/graph.json`, `observations.json` and `records/` from the spec in
`scripts/fixture/` — the same artefact a real collector produces, so going live
is a change of which collector wrote the file and never a change of layer. The
output is committed, because the demo must run with no credentials.

It is deterministic — no randomness at all, timestamps derived from the spec's
own dates — so a re-run is byte-identical and a demo cannot rearrange itself
between rehearsal and stage. The content is invented (it ships in a repo
strangers open); only the *vocabulary* is real, and it lives in one `VOCAB` block
in `scripts/fixture/programme.ts` so neutralising it before publication is one
edit rather than a search.

**The generator validates before it writes**, and `verify-graph.mts` asserts the
planted cases against the written file. Both matter for the same reason: a
fixture that violates the contract is worse than none, because every detector
developed against it inherits the violation — and a spec edit that quietly drops
the unjoined commitment leaves a demo where the hero alert never fires with
nothing failing anywhere. The cases are listed in `GRAPH-SCHEMA.md` §8 and marked
`⟨CASE⟩` in `scripts/fixture/records.ts`.

**`Note` gained `owner`, `dueAt`, `container` and `joins`.** The first two are
`DIRECTION.md` §5's precision gate — a promise with a named owner and a date is
trackable and "someone should look at that" is not — and `container` is which
closing should check it. `joins` is per-key provenance for `relatedKeys`, which
was a flat list quietly asserting that every join is equally certain; on a real
meeting corpus **none** of the extracted actions named a key, so the join is
usually reconstructed and the confidence belongs on it. A key absent from `joins`
is `EXTRACTED`, so every existing note stays correct without being rewritten.

Two traps in that, both paid for: `create()` builds its `Note` field by field, so
an optional field added to the type and not added there is **silently dropped on
every write** — the note saves, reads back, and is simply missing what the
detector needed. And a round-trip test that compares created-to-decoded passes
trivially when both sides are `undefined`, which is how it hid. `verify-graph.mts`
now asserts literal values, read back through a second store off disk.

**Storage is three layers and only one of them is rebuilt** (`GRAPH-SCHEMA.md`
§2). *Derived* is what a source can be re-read to prove and is rebuilt every run;
*asserted* is what somebody authored — claims, decisions, a dismissal — and is
the vault, which accumulates and is never rebuilt; *observed* is every run's diff
on the event log. The split is by whether a fact can be re-read, not by which
tool wrote it.

**The derived layer is rebuilt rather than updated in place, and the reason is
specific to this product.** Jira does not reliably report link *deletions*, so an
incremental update silently keeps a `blocks` edge Jira no longer has — and "a
declared link that has gone stale" is one of the findings this system exists to
raise, so incrementing would manufacture the defect instead of detecting it. Same
for a card taken off a board or a page unpublished: absence is information, and
in-place updates are blind to it. The duller reason decides it anyway — a mutated
graph cannot be verified against its source, and that question having an answer
is what makes the tiers worth anything.

**Rebuilding is not re-downloading.** Fetch incrementally into a record cache,
re-derive fully from it. "Too expensive" is nearly always a statement about the
network, and the network half stays incremental.

Each run leaves two durable things: the **diff appended to the event log** (never
overwritten — this is what lets a finding name its own moment), and
**`firstSeen`/`lastConfirmed` per edge** so a vanished edge reads as
`lastConfirmed: 3 days ago` rather than silently not existing. Both are
recomputable by replaying the log, which is the property that makes the model
safe: nothing durable may exist that the append-only log cannot regenerate.
`edgeObservationKey` encodes the tuple as JSON rather than joining on a
separator, because real ids already contain `:`, `.` and `/`.

**Two cadences, meeting in the same log.** A scheduled full re-derive twice daily
for everything expensive and everything where absence matters; the existing fast
path (`/api/webhooks/jira`, the 30s canvas poll) for transitions that announce
themselves. Twelve hours is not a compromise for the hero case — a commitment
that was never ticketed is a state predicate. **The first run is a baseline,
never news**, persisted with the identity of what it baselined and re-baselining
rather than reporting when it is stale; `canvas-poll.ts` already implements
exactly this and learned it the hard way.

One thing this asks of `programme_graph`: it computes the right deltas already
and then writes them to a `CHANGES.json` the next refresh replaces, so the change
history is one run deep. **Append instead of overwrite** — the whole transition
story rests on it, and nothing about the rebuild has to move.

**Everything there is `Stored*`, against the `Graph*` family in `index.ts`, and
the split is load-bearing.** `GraphNode`/`GraphEdge` are the *rendered* graph —
what `buildRelationGraph` assembles, four node kinds wide because a picture with
every speaker on it is a hairball. `StoredNode`/`StoredEdge` are what every
source knows, people and squads included. Keeping them apart is what lets both
rules hold at once: the graph remembers a person, the drawing does not show one.
A `GraphNodeKind2` beside `GraphNodeKind` would have been the third silent
namespace collision this repo has paid for.

**`depends_on` runs dependent → blocker, which is the REVERSE of `blocks`.**
`A depends_on B` means A waits for B; `MC-103 blocks MC-102` means MC-102 waits.
The graph keeps the foreign convention because `programme_graph` is the largest
producer and owns it — one flip beats asking six collectors to adopt a convention
from a repo they do not import. `blocksPairOf` is the only place that flip
happens, and `verify-graph.mts` names the fixture's two ends `blocker` and
`waiter` so a reversal cannot look right. Flipping `DEPENDS_ON_IS_REVERSED` fails
two checks; a reversal here renders perfectly while asserting the opposite of the
truth, which is why it is a function and not a `[target, source]` at a call site.

**Tiers are `EXTRACTED` / `INFERRED` / `AMBIGUOUS`**, borrowed from graphify by
way of `programme_graph` — `EdgeProvenance` here already used two thirds of them
independently. The third carries the value: a declared dependency link nothing
corroborates is not a defect in the data, it is the finding. Declared links start
`AMBIGUOUS` and reconciliation promotes only the corroborated ones, which makes
"a dependency Jira never recorded" and "a link that has gone stale" native
outputs rather than a separate cleanup pass.

Two rules the gateway enforces on what it reads, both exported as predicates:

- **`isRenderableEdge`** — an `INFERRED` edge with no `why` is dropped. Same rule
  `GraphEdge.basis` already carries.
- **`isStructuralDependency`** — only `EXTRACTED` may feed cycle detection. This
  is a deliberate *loosening* of the current "nothing inferred touches cycles":
  a declared edge that reconciliation corroborated against independent evidence
  is a stronger claim than anything `infer.ts` produces, and the tier is what
  says so. The test is on the tier, never on the source.

**Text is not in the graph.** `graph.json` holds nodes, edges and the excerpt
that justifies an edge; `records/<kind>/<id>.json` holds bodies and is read on
demand. At programme scale that is the difference between a file loaded at boot
and a file nobody can load — and it matches the interface, where a record is
reached only from a citation.

**Ids are `kind:value`, derived from the source's own identifier**, so a re-run
produces the same id. That determinism is the precondition for change detection:
an id that moves makes every refresh report everything as new. `person:` is keyed
on **email**, the only identifier every source has in common.

**`graphify`'s own tools stay inspection-only.** `graph.html` and `SUMMARY.md`
are good for looking at a graph by hand. Its MCP server must not be in the
product's path — the deployment forbids MCP servers, and routing detection
through a model would break the rule that the firing decision is deterministic
code.

## The scheduled re-derive, and how a transition becomes news

**`apps/gateway/src/refresh.ts` diffs this run against the last one and appends
the result.** The derived graph is a snapshot of *now* — it cannot say a sprint
ended or an arrow closed a loop — so `missing_ticket` survives on it (a state
predicate) and nothing else does. Comparing current state against nothing cannot
see a transition.

**The first run is a baseline, never news, and the baseline is on disk.** Held in
memory, every restart re-baselines and a sprint that closed while the gateway was
down is absorbed and never announced — silently. `canvas-poll.ts` learned this;
this is the same rule and the same 24h staleness window.

**What is stored is a SIGNATURE, not the graph.** Edge identities plus the two
node fields a transition reads from. Two copies of a twenty-thousand-node graph
on disk to answer "what changed" is a lot of bytes for a set difference.

**A foreign generator re-baselines rather than diffing.** `programme_graph`'s
output against ours would read as every id added and every one of ours removed —
a whole programme announced as new because a different collector wrote the file.

**`removed` is the half an in-place update can never produce**, and it is the one
that matters: Jira does not reliably report link deletions, so an edge that
quietly stops existing IS the stale-link finding.

**The scheduler runs skills OR jobs.** A skill gathers and proposes, a job
re-derives; both obey the same three rules, so they share the slot machinery
rather than the job getting a second timer beside it — a second scheduler is a
second place for the catch-up window and the double-run guard to drift. Four
slots: refresh at 07:00 and 19:00, standup at 08:00, tidy at 22:00.

**Twelve hours is not a compromise for the hero case.** A commitment that was
never ticketed is no more true at 09:00 than at 21:00. Transitions that announce
themselves already have a fast path — the Jira webhook, the 30s canvas poll — and
both write to the same log, which is where the two cadences meet.

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
`alerts/`, `app.css`, `main.tsx`, `vite-env.d.ts` and nothing else. `AlertApp`
routes on the hash, the alert list is the front door, and an alert page is what
a row opens. `main.tsx` mounts it, and Ask is built from `conversations.ts` and
the SSE loop in `chat.ts`.

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

**The stylesheet is `docs/design-preview.html`'s, copied verbatim into
`apps/shell/src/app.css`.** `DESIGN.md` says the preview wins where the two
disagree — it is the version tested in a browser — so a design change belongs in
the preview first and here second. Its preview-only rules (`.screen`,
`.caption`, `.notes`, `.switch`) are still in the file and match nothing: it
looked worth stripping them and that is exactly the trap `DESIGN.md` §8 records,
where a regex removes a selector, leaves its block, keeps the brace count even
and silently swallows the next rule. Dead CSS is harmless; a stylesheet that lost
a rule is invisible until one screen renders with browser defaults.

**One stylesheet, one design system.** `app.css` is the whole of it: no
component library, no second reset, no second set of colour tokens. That is what
keeps the shell build at ~231 kB of JS and ~28 kB of CSS, and a library pulled in
to draw one screen costs more than the screen.

**Routing is a hash router in one file, not a library.** Eight *routes* — four
pages, a note, the Ask index, a record and Sources — no nesting.
Hash rather than path because the gateway serves nothing, vite would need a
history fallback for every deep link, and the demo is a repo somebody clones —
"it works however you serve it" beats a clean URL. A finding id carries `:`, so
the route encodes and decodes it.

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
preview's `.row` rules are written against a button, so `app.css` restates the
two declarations that differ rather than editing the copied block.

**The checklist is the alert's argument, and it needs its ticks.** Three ✓ and a
✕ reads in a second; one ✕ alone is a sentence with extra steps. It sorts ticks
first, then crosses, and **this alert's own promise last** — reading order is the
only emphasis a checklist has, and sorting on `tracked` alone leaves the crosses
in vault order so a container with two untracked promises ends on the wrong one.

**A citation opens its record, on the exact line.** `Evidence.ref` carries a
`RecordRef` and `GET /api/records/:surface/:id` returns the whole record with the
cited line marked — `RecordView` scrolls it to centre so the context either side
is visible, which is the only reason to open a record rather than read the quote.
`DIRECTION.md` §3: a citation that drops you at the top of a ninety-minute
transcript has not been followed.

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

**An evidence row with a quote is a citation and will open its record; one
without is our own observation and is deliberately not a link.** "No issue
references this" has nothing to open, and a dead link on an evidence row is worse
than a plain sentence. That distinction is the difference between citing and
asserting, and it is in the preview.

Verify it the way `DESIGN.md` §8 says — **read the DOM, not the screenshot**; the
preview pane serves stale frames often enough to mislead. The check that matters
is that every content edge on every screen resolves to a *single* x:

```js
[...new Set([...document.querySelectorAll('.greet, .rows .row, .quiet')]
  .map(e => Math.round(e.getBoundingClientRect().left)))]   // must be one number
```

## The findings pass — the alert list

**`GET /api/findings` is what the front door becomes.** `apps/gateway/src/findings.ts`
returns `Finding[]`, ranked worst-first, from the loaded graph and the in-memory
vault. It touches no vendor and is deliberately not cached: `/api/work` pays for
a five-surface gather, and this is the screen the app opens on and the one a
notification links into.

**All six kinds fire, and four of them reach the front door.**
`undetected_dependency` and `suspect_link` are `COVERAGE_KINDS`: they fall out of
the graph's tiers **one per edge**, so a real programme produces them by the
hundred (measured: 840 and 268 on a 5,000-issue import) and an alert list whose
promise is "the top row is the one to open" turns into a dashboard. They live on
**Sources** instead — still detected, still deduplicated, still
suppressed by a dismissal, and counted on the page whose question they answer.
`/api/findings` filters on `isAlertKind`, `worthSending` excludes them so a
morning does not open with two hundred pings, and `list_findings` returns them
carrying `shownOn` so the agent does not call one urgent.

**Sources counts them from the PASS, not from the graph.** `findJoinFailures`
used to count `AMBIGUOUS depends_on` edges directly while the detector
deduplicates and honours a dismissal — they agreed by luck, and dismissing one
would have left the page stating the old number for ever.

`missing_ticket` and the two reconciliation findings come
straight off the graph; `disagreement`, `cycle` and `aging` are the lane's own
signals, **wrapped rather than re-detected** — `findContradictions`, `findCycles`
and `buildTimeline` stay the single definition, so a row saying "two sources
disagree" and the alert saying the same cannot come from two ideas of
disagreement. `gatherWorkFacts` in `work.ts` is the shared gather; `buildWorkLane`
is one shaping of it and `runFindings` is another.

**`blocked_by`, `unwritten` and `activity` are deliberately NOT findings.** They
are true, useful on a row you are already reading, and not reasons to interrupt
somebody: "this waits on something unfinished" describes most work most of the
time, and a front door that says so about every ticket is one people stop
opening. A cycle is the case where waiting has actually gone wrong.

**A cycle is one finding about a loop, not one per member.** Every ticket in a
four-ticket loop carries the same signal, so the naive fold puts four
near-identical rows on the front door for one problem. `dedupeKey` is the loop's
sorted members and the subject is the member that sorts first, so the collapse is
stable rather than dependent on walk order. Its evidence deduplicates the walk
too — `findCycles` returns a closed walk with the start repeated (`[A,B,C,D,A]`),
and mapping that directly produced a fifth citation reading "A waits on A".

**Dependency truth comes from the GRAPH, never from a live board read.**
`gatherWorkFacts` takes the arrows to reason over and both callers pass
`projectArrows(source.graph)`. The default still reads the board and the default
is now wrong whenever `MIRO_ACCESS_TOKEN` is set: `listConnectors` then returns
whatever is drawn on the live canvas, which is a different and unreconciled
account of what depends on what. That is not hypothetical — with a live token
pointed at a board carrying an older fixture, the cycle among four reconciled
dependencies simply stopped existing everywhere at once, with nothing failing
anywhere. The board is *evidence*; the graph is the reconciled
result, and only the graph carries the tiers `isStructuralDependency` tests.

**`WorkSignal.evidence` is optional because a row does not need it and an alert
does.** A lane row has one line and its claim is already phrased; an alert page
that says two sources disagree and shows neither record is exactly the uncited
assertion this product exists not to be. The detector is the only thing that
knows *which* records it meant, so it carries them and the row ignores them.
Recomputing the pair at the alert layer is how a row and its page cite different
things.

**A `Finding` is not a `WorkSignal`, and that is the whole reason it exists.**
`WorkRow` hangs signals off a `WorkItem`; the flagship finding — a commitment
nobody ticketed — HAS no work item. The absence is the finding. So
`FindingSubject` is a union of `workitem` / `commitment` / `initiative`, and the
five detectors that already work keep working unchanged.

Severity is `crit` / `warn` / `ok`, matching `DESIGN.md` §1 rather than
`WorkSignal.tone`'s `alarm`/`warn`/`info` — translating between two severity
scales on one screen is how a row and the page it opens disagree about how bad
something is.

**`findMissingTickets` gates on four things and every one is load-bearing:** an
open `commitment`, **no** `relatedKeys`, an `owner` **and** a `dueAt`, and a
container whose `state` is `closed`. The middle pair is `DIRECTION.md` §5's
precision gate; the last is the trigger — an epic done, a sprint ended, a retro
held, which is the only moment that is neither nagging nor too late.

**`firedAt` is when the container closed, not when the pass ran.** A finding that
restamps itself every pass cannot be aged, ranked or deduplicated, and "fired
08:02 today" would be a lie about a promise made in July.

**Staleness must NOT rank a missing ticket down**, and it was written the other
way round first. `stalenessOf` is right about recall — an unconfirmed claim is a
weak basis for the agent to assert something — and exactly backwards here: the
finding *is* that time passed and nothing happened, so the age of the promise is
the reason to interrupt somebody. Applied as decay it downgraded the hero case
from `crit` to `warn` precisely because it had been ignored for seven weeks. The
comment is left in place because it is an obvious-sounding idea somebody will
have again.

**Two findings fall straight out of the graph's tiers and need no detection at
all.** An `INFERRED` dependency with no declared counterpart is one Jira never
recorded; an `AMBIGUOUS` declared link that reconciliation checked and could not
corroborate is one that has gone stale. That is what the tiers are *for* — they
are findings in storage, not decoration.

Check it with `curl -s localhost:8787/api/findings | jq -r '.findings[]|"[\(.severity)] \(.kind) — \(.claim)"'`,
and `npx tsx scripts/verify-graph.mts` asserts the whole chain: the contract
holds, the fixture plants the cases, and the detectors find them. That last link
matters most — a fixture can be perfectly valid and still produce an empty alert
list, which is the one outcome that makes the product look like it does nothing.

## The connectors read the graph

**`createGraphConnectors` projects `graph.json` into the five connector
interfaces**, and `createMockConnectors` is **deleted**. The mock used to *be* the
data — `WorkItem` literals and transcripts as module constants, in a shape that
existed nowhere else — so everything downstream was tuned against something no
collector would ever produce.

The I/O is in `apps/gateway/src/graph-source.ts` and the projections are pure in
`libs/connectors/src/graph/`. That split is not tidiness: **`@mc/connectors` is
still browser-*aliased*, and nothing would catch a `readFile` added to it.**
`BROWSER_FORBIDDEN` in `vite.config.mts` names exactly one library, `@mc/vault`,
and it does not scan imports — so the deny-list that protects the vault would not
protect this. (Nothing in the shell imports `@mc/connectors`. The alias remains,
so the hazard does too.)

`MC_GRAPH_DIR` is the switch. Pointing it at a collector's output instead of
`fixtures/` is the whole of "going live" for Jira, Slack, Zoom and Confluence.

Three things the projection has to do, each of which was a real mismatch:

- **Status is mapped from the vendor's own word**, and the map is now
  **configuration** — `MC_STATUS_MAP` at a flat JSON file, merged over the
  built-in defaults, with `statusCategory` as the last resort. Deliberately not a
  union in the domain: every Jira names these differently and a fixed union is a
  migration every time somebody edits a workflow.

  **The failure it prevents is silent.** `statusCategory` has three values, so a
  word that falls through to it makes `in_review` and `blocked` unreachable — a
  "Peer Review" ticket lands in `in_progress` and the lane looks slightly wrong
  with nothing failing. `node scripts/inspect.mjs statuses` lists every word the
  loaded graph uses, what it became, and whether it got there via the map or by
  falling back, then prints a starting JSON for the rest. Run it first against
  any real export.

  An unknown target is **rejected**, not ignored, and a configured-but-unreadable
  map refuses to boot — falling back to the defaults silently restores the exact
  bug somebody wrote the file to fix. And it does not live in `MC_GRAPH_DIR`,
  which is rebuilt in full every run.
- **`assignee` becomes a handle, not an email.** The graph keys people on email
  because that is the durable id every source shares; the connector's `assignee`
  is compared against Slack authors and transcript speakers all over the app, and
  an email matches none of them.
- **Only `EXTRACTED` dependencies become board arrows**, through `blocksPairOf` —
  the one place the direction flips. A guess must not be able to raise a cycle
  banner.

**The fixture ships its own history and its own claims.** `graph.json` is the
derived layer — a snapshot of now — so it can say a ticket is in Code Review and
cannot say it has been there nine days. `fixtures/events.jsonl` carries the
transitions (`seedHistory` reads it and nothing else), and `fixtures/notes/`
carries the claims, copied into the vault once by `seedNotes` because claims are
the *asserted* layer and the vault is where that lives.

Both are copied rather than read in place, and only into an empty vault: the
fixture is an INPUT, a demo that edits its own inputs cannot be re-run, and a
re-generate would silently discard whatever somebody had written since.

## The work lane and the dossier — what the findings pass is built on

Two routes and the joins behind them. No screen opens either today; they are the
single definition that `findings.ts`, `trace_entity` and `inspect.mjs` all use,
and `DIRECTION.md` §1's evidence view is what will render them.

`gatherWorkFacts` is the shared gather behind the findings pass;
`classifySignalFor` and `findContradictions` are the same functions a
`disagreement` alert is built from; `buildDossier` is what `trace_entity` calls.

**No ticket picked — `GET /api/work?assignee=…`** (`apps/gateway/src/work.ts`).
One person's sprint work ranked by what needs them, where the column is *why*,
in a sentence: two people disagree about whether it is done, it is in a
dependency cycle, the thing it waits on is itself stuck, it has not moved in
three weeks, nothing outside Jira has ever mentioned it. Every one of those is a
cross-surface join, which is the only thing here a Jira tab cannot do.

- It gathers **once** and folds the result over every item. `buildDossier` in a
  loop is the obvious implementation and it is eight `listConnectors` before the
  front door renders — the same bargain `suggest.ts` already made.
- It shares the **rules** and not the gathering: `classifySignalFor` and
  `findContradictions` are the same functions the dossier uses, so a row saying
  "two sources disagree" and the banner you get on clicking it cannot come from
  two definitions of disagreement.
- **The default assignee is whoever has the most to decide**, not whoever sorts
  first alphabetically. Alphabetical answers with three quiet tickets; the
  default should show what the app is for. It is deterministic and breaks ties
  alphabetically, so the fixtures always answer the same way. `assignee` is a
  query parameter because there is no login here — and because switching to a
  colleague's lane is most of its value in a stand-up.
- **Unassigned sprint work is always shown.** It is nobody's row and therefore
  everybody's problem; the reason it is unassigned is that no personal lane has
  ever shown it.
- **"Days in this status" is measured, never `updatedAt`.** One `buildTimeline`
  over the durable log, indexed by key, over the same `TRAIL_DAYS` window the
  dossier uses — which is why `issue.ts` exports it. `updatedAt` means "last
  touched anything" (a comment, a field edit, and in mock mode a value stamped at
  boot) and reading a status age out of it was wrong on every row in both
  directions: the lane said MC-103 had sat 0 days while the dossier said 14, so
  the aging signal never fired on the ticket the lane exists to surface.
  A ticket with no transitions in the window gets no `ageDays` and claims no
  aging signal — "we do not know" beats a fabricated zero.

**A ticket picked — `GET /api/issue/:key`.** The whole context, in the order
somebody actually needs it: the disagreements, then *where it came from*, then
*the chain*, then everything anyone said. `apps/gateway/src/issue.ts` assembles
it — the Jira status, every Slack line, Zoom sentence, Confluence page, vault
note and transition that names the key, newest first — plus the scoped relation
graph, the timeline lane and any *contradictions*. `trace_entity` calls the same
function, so the route and the agent cannot name a different "latest"; a second
hand-rolled assembly in `tools.ts` claimed chronological order while sorting by
nothing, which is what one definition prevents.

Check it with `curl -s localhost:8787/api/issue/PAY-9031 | jq '.contradictions'`
and `curl -s 'localhost:8787/api/work?assignee=sam' | jq '.rows[].signals'`.

**A ticket key is a link to its record, and never to a vendor.** `Answer.tsx`
holds the rule: a key in an agent's answer links to `#/record/jira/<key>`, which
is ours and carries the join, not Atlassian's. Sending somebody to Jira sends
them where they would have gone without this.

**The origin block never calls the filing an origin.** `originOf` takes the
oldest trail entry *that carries a ref* — something a person said or wrote —
because a `workitem.created` event is our own bookkeeping, and rendering it under
"where it came from" is a system inventing provenance out of its own records.

**Two booleans ride along, and they are not the same question.**
`predatesTicket` is strict (the record is older than the filing) and drives the
"before the ticket existed" badge — the strong claim, which must not be asserted
on a conversation that happened an hour after the fact. MC-108 earns it.
`firstIsOrigin` allows `ORIGIN_GRACE_DAYS` on either side and decides the card's
*heading*, because the strict test is wrong in both directions: MC-103's planning
call is stamped **thirty-two seconds after** its creation event and is
unmistakably where the work came from, while MC-2's oldest record is a retro note
written four days *after* it shipped. Every ticket has an earliest record; only
some have an origin. The card says "Where it came from" or "Earliest record
outside Jira" accordingly — check both with
`node scripts/inspect.mjs issue MC-2`.

**It reads the durable log, not the in-memory one.** `seed.ts` writes its
backdated events straight to `vault/raw/events.jsonl`, so at boot `eventLog` has
never heard of a single transition — reading it here was why the trail showed a
status and no history of how the ticket got there. The dossier takes the union of
disk and process (`vault.appendEvent` is fire-and-forget, so an event from a
moment ago may not have landed yet) and hands the *windowed* subset to
`buildTimeline`, because `ageDays` and `flowEfficiency` mean "over the period we
are showing".

**`RelatedRef.direction` is load-bearing.** `blocks` runs `from` → `to`,
blocker-first, so an **inbound** `blocks` edge is the thing in your way. The
chain splits on it — *Waiting on* against *Holding up* — and reading it backwards
names the tickets you are inconveniencing, which is plausible and is the opposite
fact.

**The dossier passes `meetings` to `buildRelationGraph`.** Without that one
argument a recording sits in the trail as a quotation and is absent from the
relations — and the relations are the one place somebody looks to answer "which
meetings is this tangled up in". The keys come off transcripts already fetched
for the trail, so it costs a map and no I/O.

**`people` and `channels` are rolled up from the trail, and counted over
everything.** `PER_SURFACE` trims what the trail *shows* so one chatty channel
cannot bury the other four — counting the rollups off the trimmed list then says
"discussed in three channels" about a ticket discussed in four, which is a worse
lie than showing fewer quotations: the quotations are visibly a sample and a
count reads as a fact. They are deliberately not graph nodes: a node per speaker
would drown the drawing, and `GraphNodeKind` staying four members is what keeps
every consumer of it simple.

`TrailEntry.who` and `.container` carry the author and the channel rather than
being parsed back out of `label`. The label is a string built for a human
(`#eng-platform — sam`) and recovering fields from it breaks the first time a
channel name contains a dash.

**The board's arrows are warmed at boot, and it is worth asking whether they
should be.** `listConnectors` against a live board measured ~4s, so `main.ts`
fires one unawaited `boardArrows` at startup. But dependency truth comes from
the graph now: `/api/findings`, `/api/work` and `/api/suggestions` all pass
`projectArrows(source.graph)` and never reach it, leaving `buildDossier` — and
therefore `/api/issue/:key`, `/summary` and `trace_entity` — as the only
consumers, none of which a screen opens. Unawaited and swallowed on purpose:
boot must not depend on a vendor being up.

## The agent's status read

**`GET /api/issue/:key/summary` is a model's opinion, and everything about it is
arranged so nobody mistakes it for a record.** `apps/gateway/src/summary.ts`
gives one work item a written status — what is true now, what put it there, what
would move it, what not to trust — in its own card, with the provider's name on
it, above the evidence it was drawn from.

Same four rules as `extract.ts` and `infer.ts`, and they are the reason this is
tolerable at all:

- **Additive.** No provider → `createSummariser` returns `null` → no card, and
  every other section renders exactly as before. Never a broken box.
- **Never on the critical path.** It is a *separate route* from the dossier. The
  route answers immediately in every case — `ready`, `pending` (a turn is
  running; a caller polls every 3s), `empty`, `unavailable` — and the front door
  never waits on a model. A route that blocked the fast thing to make the slow
  thing invisible would be the wrong trade twice.
- **It cites.** `IssueSummary.citations` are **indices into the dossier's own
  `trail`**, so "drawn from 11 records — show me which" marks the exact rows.
  Indices and not labels, because labels repeat: two Slack lines from the same
  person in one channel are `#standup — sam` twice and only position separates
  them. `citations` is `required` in the tool schema beside `state` and `why` —
  left optional the model simply stopped citing, and an uncited paragraph is the
  one thing this feature must never become.
- **Labelled as an opinion.** One accent stripe on the page, and it is this
  card's. Everything else in the dossier is a record somebody wrote; mixing the
  two makes the whole page as trustworthy as its least trustworthy part.

**It is cached on the rendered brief, not on the key.** `vault/raw/summary-cache.json`,
keyed on a hash of `renderBrief(dossier)` — the same bargain `infer.ts` makes
with the corpus. So a summary is stable while the ticket is (reopening spends no
turn and does not quietly reword itself under somebody reading it) and
invalidates by itself the moment anything in the brief moves — a new Slack line,
a transition, an arrow drawn on the board — which is exactly when the old read
stopped being true. Delete the file to re-ask everything.

**A poll while a turn is running does not rebuild the dossier.**
`Summaries.pendingFor(key)` is checked before the route assembles anything. A
caller polls every three seconds and a CLI turn takes most of a minute, so the
obvious implementation quietly builds the full five-surface dossier twenty times
over to keep saying "still working" — invisible on fixtures, seconds each against
a live board. `busy` is keyed on the work item while `inFlight` is keyed on the
brief's fingerprint: the first answers "is this ticket busy", the second answers
"have we already asked this exact question", and neither substitutes for the
other.

**Nothing is warmed at boot, and nothing on screen reads a summary.**
`/api/issue/:key/summary` is reachable from `inspect.mjs` and from curl, and from
nowhere in the shell. Walking the active sprint to pre-write cards would be
minutes of CLI child processes per boot for pages nobody can open — silently, a
warm walk being unawaited and logged only on success. `createSummaries` takes the
summariser and nothing else, and has no `stop()`. Ask for a summary and one is
written and cached on the brief's fingerprint. If a screen ever reads one, warm
what *that* screen opens on. See ROADMAP.md G3.

Check it with `node scripts/inspect.mjs summary PAY-9031`.

## Structured output, and the one place MCP appears

**`structured.ts` is the single way this codebase asks a model for typed JSON.**
`summary.ts`, `infer.ts` and `extract.ts` all go through it. Before it, each
wrote the same request twice — once as an in-process MCP tool for the CLI
provider, once as a forced `tool_use` for the Messages API — and the two copies
drifted. That drift is the `zodShape` nesting bug: descriptions, enums and the
whole `required` list vanished on the CLI path **alone** while the API path
stayed correct, so the model omitted fields it had never been shown and it read
as a model-quality problem. One description of the request makes that class of
one-sided bug impossible.

**The MCP here is a transport for our own functions, not an integration.** No
separate process, no network, no `.mcp.json`, nothing to install or approve —
`createSdkMcpServer` is chosen because the CLI SDK has no `tool_choice` and a
tool handler is the only way to force a structured reply out of it. But a
workspace may forbid MCP bluntly, and **nothing this product needs may sit
behind a capability that policy can switch off**. So the transport is a named
choice with two fallbacks:

| `MC_STRUCTURED` | how | needs |
|---|---|---|
| `sdk-mcp` | in-process MCP tool | the `claude` CLI login |
| `messages-api` | native `tool_use`, no MCP anywhere | `ANTHROPIC_API_KEY` |
| `copilot` | one `defineTool` recorder — JSON Schema native, no MCP | Copilot auth |
| `prompt-json` | CLI with **no tools** — schema in the prompt, JSON parsed back | the `claude` CLI login |

`auto` (the default) walks that ladder; naming one pins it and fails rather than
falling through, because a pin that silently degrades is not a pin.
`prompt-json` is deliberately last: a real schema is doing work prose cannot, and
both known bugs here were the model quietly not being told something.

**`MC_STRUCTURED` is read at CALL time, not at module scope.** Same lesson as
`anthropicBaseUrl` in `claude.ts`. Captured at import, the probe below set it per
iteration and every row silently reported whichever backend `auto` had already
picked — four identical runs printed as four different ones, which is worse than
an error because it reads as a passing test.

**`providerCaps()` probes once per process and is shared by all three callers.**
Memoised on the *promise*, so three near-simultaneous boot calls share one probe
rather than racing three. Neither probe is a cheap check: `claudeCliAvailable`
spends a real one-word turn (cached on disk 24h) and `copilotAvailable` starts
the runtime and asks whether it is authenticated — because an SDK importing and
a session being creatable both succeed on a machine that cannot answer.

`npx tsx scripts/probe-mcp.mts` runs all three against the same nested schema and
prints which the machine allows. Run it before assuming — the answer differs per
environment, which is the whole reason the seam exists.

It does **not** coerce. Every caller has its own idea of a usable answer —
`infer.ts` drops edges below a confidence floor and insists on a `basis`,
`summary.ts` requires citations, `extract.ts` has a minimum length — and one
validator for all three would mean nothing in particular.

**The records reach the model as data and it is told so.** Slack lines,
transcript segments and vault notes are written by anyone. The system prompt says
they are not instructions, `allowedTools` is the recorder alone (without it the
CLI agent inherits file and shell tools), and structurally the worst a successful
injection achieves is a wrong paragraph in a card labelled as a model's opinion:
this module writes to no surface, emits no proposal, and cannot reach
`accept_proposal`.

**The contradiction detector is deliberately near-sighted, and that is the
feature.** `classifySignal` in `@mc/domain` is a word list with the same honest
ceiling as `ACTION_CUE`: it misses claims. That is the right side to fail on,
because the banner's only value is that it is believable — a missed claim costs
a disagreement nobody sees, a false one invents an argument two colleagues never
had. Three rules hold it together and all three were bought with a bug:

- **Negations are tested first.** "not done" contains "done".
- **Classification is per key** (`classifySignalFor`). One Slack line routinely
  covers several tickets and says opposite things about them — *"MC-91, MC-93
  and MC-96 are done. Sprint 13 closes with MC-94 still open."* Reading that as
  one claim marked three tickets disputed. The message is split into clauses and
  only the ones naming this key are read; when it names one key or none, the
  whole text is used, because a follow-up sentence is elaborating on it.
- **Only a `dated` note is a claim about a moment.** A `person` or `pattern`
  note is a standing description — "chases external parties and reports it as
  progress" is a habit, not a status report — and reading state out of one is
  the same mistake as reading it out of a runbook. Confluence pages carry no
  signal for that reason too.

`findContradictions` emits **one row per done-claim**, against the newest thing
that disagrees with it. The cross-product is the obvious implementation and
renders one "it shipped" against three "still blocked" as three arguments.

It never says which side is right. It cannot know, and a guess would make the
feature worse than absent — both records go in front of the person who can tell,
with the dates and which is newer.

**The dossier memoises the board arrows for 60s** (`forgetBoardArrows`, dropped
on every event, exactly as `suggest.ts` drops its gathering). `listConnectors`
against a real board measured ~3.9s, which was most of the route's latency.
**Whatever re-fetches on events must key on its own subject, never on
`events.length`.** Keyed on the whole log, the 30s canvas poll tears the request
down and restarts it before it can resolve, and the screen sits on "Loading…"
forever while the network tab shows only 200s.

**Slack's `ts` is unix seconds, not a date.** `slackTsToIso` is in `@mc/domain`
because `Date.parse` on one returns NaN *silently*, which sorts every Slack line
to the bottom of a newest-first trail and drops the timestamp that makes "he
said it was done on Monday" an answer at all.

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
it reads as room to breathe. `app.css` keeps one reading width across every
screen for that reason.

---

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
