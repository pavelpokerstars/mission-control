# Mission Control

**An alerting system for delivery work.** It reads what people said in meetings,
threads and on boards, checks it against what the tracker actually holds, and
interrupts you once — with the quote and one action — when the two disagree.

```bash
npm install
npm run dev          # shell on :4200, gateway on :8787
```

Runs on committed fixtures with **zero credentials**. No tokens, no accounts, no
config. Everything below works immediately.

---

## The idea

A dashboard makes you go and look. This does not:

> The front door is a single line of text telling you something you did not know:
> a commitment nobody ticketed, two people who disagree about whether something
> shipped, four tickets waiting on each other.

The flagship finding is one **no single tool can produce**. A promise that never
became a ticket is invisible to Jira by construction — the absence *is* the
finding, and Jira only knows what exists. Miro cannot see it, Slack cannot see it,
Confluence cannot see it. It takes a promise recorded from a conversation and the
tracker's silence about it, and those two facts never sit in the same system.

Six kinds of finding fire today:

| | |
|---|---|
| **missing ticket** | a promise with an owner and a date that no issue references |
| **sources disagree** | called done on Tuesday, blocked on Wednesday |
| **circular dependency** | nothing in the loop can start |
| **unrecorded dependency** | reconstructed from evidence, never declared in the tracker |
| **stale link** | declared in the tracker, corroborated by nothing |
| **not moving** | it has sat in one status long enough to say so |

---

## Two rules that shape everything

**1. Detection is deterministic.** No model decides whether to interrupt you. A
model may read a transcript for what was promised; the rule that fires is code you
can read, in one file. That is what makes a finding checkable rather than
plausible.

**2. Every claim cites the record it came from**, and clicking a citation opens
that record **on the exact line**, with the context either side. A citation that
drops you at the top of a ninety-minute transcript has not really been followed.

When two sources disagree, the tool does not pick a winner. It cannot know, and a
guess would make the feature worse than absent — so both records go in front of
the person who can tell, with their dates.

---

## Try it

With the gateway running:

```bash
# The front door — what needs a person, worst first
curl -s localhost:8787/api/findings | jq -r '.findings[] | "[\(.severity)] \(.kind) — \(.claim)"'

# One alert, with its checklist and the records it stands on
curl -s 'localhost:8787/api/findings/missing_ticket%3Aplatform-owns-settled-topic' \
  | jq '{claim: .finding.claim, checklist, evidence: .finding.evidence}'

# Answer it. This CREATES the ticket — you are the gate, and you just read the evidence
curl -sX POST 'localhost:8787/api/findings/missing_ticket%3Aplatform-owns-settled-topic/act' \
  -H 'content-type: application/json' -d '{"action":"primary"}' | jq

# Follow a citation to the line it quotes
curl -s 'localhost:8787/api/records/zoom/sprint-12-planning?at=852' \
  | jq -r '.lines[] | "\(if .id == "852" then "▸" else " " end) [\(.at)s] \(.who): \(.text)"'

# The connection graph the findings are read from
jq '{nodes: (.nodes|length), edges: (.links|length)}' fixtures/graph.json
jq -r '.links[] | select(.relation=="depends_on") | "\(.tier)\t\(.source) -> \(.target)"' fixtures/graph.json
```

Then open **http://localhost:4200**.

### Check it still works

There is no test framework. There is one command:

```bash
npm run verify
```

Typecheck, a byte-identical fixture regenerate, the graph contract, the refresh,
the app against `DIRECTION.md` and `DESIGN.md`, the fixture against the collector
contract,
and the shell build — about two seconds, exiting non-zero with a readable line
naming what is wrong. It reads no credential, opens no socket and starts no
server, because if it needs a token it is not the demo.

The middle two are the ones worth knowing. **`verify-graph`** asserts that the
contract holds, that the fixture still contains the cases the detectors exist
for, *and that the detectors still find them* — a fixture can be perfectly valid
and still produce an empty alert list, which is the one outcome that makes the
product look like it does nothing. **The determinism check** asserts that
regenerating `fixtures/` changes nothing, because the fixture is committed and
generated, and a demo that rearranges itself between rehearsal and stage is
worse than one that is out of date.

The stricter typecheck is still worth running on its own while working:

```bash
npm run typecheck:all          # authoritative — stricter than `npm run typecheck`
```

---

## Where the data comes from

`fixtures/` is written by `npm run fixture` — a **generator**, not a fixture file,
emitting the same artefact a real collector produces:

```
graph.json         nodes, edges, and the excerpt that justifies each edge
records/           full bodies, read only when somebody follows a citation
events.jsonl       the transitions, so "nine days in review" is measured
notes/             the claims — promises, decisions, impediments
observations.json  firstSeen / lastConfirmed per edge, so a vanished edge reads
                   as "last confirmed 3 days ago" rather than silently not existing
```

So **going live is a change of which collector wrote the file**, never a change of
layer. `MC_GRAPH_DIR` is the switch. See [docs/GRAPH-SCHEMA.md](docs/GRAPH-SCHEMA.md).

The content is invented — it ships in a repo strangers open — but the *shape* and
the *vocabulary* are real, and the generator is deterministic, so a re-run is
byte-identical and a demo cannot rearrange itself between rehearsal and stage.

---

## Docs

| | |
|---|---|
| [docs/DIRECTION.md](docs/DIRECTION.md) | **Start here** — what the product is and why |
| [docs/DESIGN.md](docs/DESIGN.md) | What the screen does — the interface spec |
| [docs/design-preview.html](docs/design-preview.html) | The clickable target. Open it off disk; it wins over prose |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The ledger — what was built, in what order, and what is left |
| [docs/BUILD-PLAN.md](docs/BUILD-PLAN.md) | How the alert-first work was sequenced, and why in that order |
| [docs/GRAPH-SCHEMA.md](docs/GRAPH-SCHEMA.md) | The contract between the collectors and the gateway |
| [docs/CEREMONY-FLOW.md](docs/CEREMONY-FLOW.md) | How a meeting becomes the commitment note the flagship alert fires on |
| [docs/KNOWN-GAPS.md](docs/KNOWN-GAPS.md) | What is broken, approximate, or deliberately unfinished |
| [CLAUDE.md](CLAUDE.md) | Working notes — commands, invariants, and what breaks if you change them |
| [AGENTS.md](AGENTS.md) | A pointer to the above, for coding agents that do not read `CLAUDE.md` |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The layer underneath — what each surface owns, how events move, echo suppression |

`npm run docs` renders the lot as one page at `docs/html/everything.html` — run
it first, that directory is generated and gitignored.

---

## Layout

```
apps/
  shell/        React + Vite — four pages (Mission Control, an alert, a
                conversation, Later), records reached only from a citation, and
                Sources. One stylesheet, no component library
  gateway/      Node — findings, records, the vault, webhooks, the event log,
                the scheduler, the agent
libs/
  domain/       Finding, WorkItem, Note, McEvent, ContextEnvelope, the graph
                contract, FIELD_OWNER, extractKeys, findCycles, stalenessOf
  connectors/   one interface per surface; `createGraphConnectors` projects graph.json
  vault/        markdown notes + the recall that feeds them to the agent
fixtures/       the generated graph, records, events and claims — the demo's input
vault/          the notes themselves, created on first boot from fixtures/notes/
```

**The whole application is `apps/shell/src/alerts/` — about 3,600 lines.** Four
pages, plus records reached only from a citation and Sources under the bonnet —
the shape `docs/design-preview.html` lays out on its `Six page types` screen. One
stylesheet copied verbatim from that preview, and a hash router in one file. There is no component library and no second set of
colour tokens, which keeps the build at **231 kB of JS and 28 kB of CSS**.


### The screens

The shape is `docs/design-preview.html`'s — open it off disk and click through
it; where it and this disagree, it wins. **It arrives** as a notification, which
is not a page at all: one claim, one button, sent when something fires rather
than on a schedule. Then **four pages, and that is all** — anything not on that
list is not somewhere you can navigate to.

**The list** is the front door: what needs a person, worst first, one sentence
each. It counts what needs a *person*, so an `ok` finding is shown and not
counted — and two kinds are not shown at all. `undetected_dependency` and
`suspect_link` fall out of the graph's tiers one per edge, so a real programme
produces them by the hundred; they are data-coverage facts and they live on
**Sources**, which already counts the links they are derived from.
When nothing is wrong it says so and you close it — which is the part most
dashboards cannot do.

**An alert** states its own case, because a reader may arrive from a
notification having never seen the list: what fired and when, the checklist the
container promised, the records it stands on, and four things you can do. Each
alert type gets the blocks that make *its* argument — the checklist appears on a
missing ticket and nowhere else.

**A conversation** is where a thread goes once it outgrows the alert it started
on — asking happens *on* the alert, inline, and opening the conversation is a
deliberate move rather than a navigation. A question about nothing in particular
starts one from Ask.

**Later** is what you parked, with the note you left and when it comes back.

**A record** is where a citation lands — the transcript at 14:12, on that line,
with the context either side. There is no browse mode and no search: you arrive
from a piece of evidence and the way out is back to the thing that cited it.

**Sources** is coverage, never content: which projects, channels and boards are
in scope, the provenance tiers, and — the honest part — what could not be read.

### The five ideas

**The join key.** Every artefact in every tool carries a Jira issue key. No second
ID space. `extractKeys()` pulls a key out of Slack messages and transcript lines,
which is how unstructured speech attaches to the structured spine. It is a regex,
so it misses — a large share of text-bearing records carry no key at all, and
the fixtures were *written* to make the join work. That is why a model proposes
the rest: additively, tagged with its provenance, and never allowed near cycle
detection.

**Field ownership.** Exactly one surface may write each field (`FIELD_OWNER`).
Jira owns status. Miro owns position and arrows. Anything else is a *proposal*.

**The model does not hold the button.** `HUMAN_ONLY` withholds `accept_proposal`
and `reject_proposal` from every provider, on the shared seam, so a provider
cannot opt back in. Everything the agent reads — Slack, transcripts, ticket
bodies — is untrusted text arriving through tool results, so "a human accepts it"
has to be a fact about the tool set rather than a sentence in a prompt.

A person answering an alert is a different thing entirely: `/api/findings/:id/act`
is **not** a tool, so no provider can reach it, and the four buttons are somebody
deciding in front of the evidence.

**Echo suppression.** Every outbound write is stamped; matching inbound webhooks
are dropped (`EventLog.markOutbound` / `isEcho`). Without this, one card drag
loops forever between Miro and Jira. **Put this in on day 1.**

**Memory, and decay.** The vendor surfaces answer "what is true now" and
accumulate nothing. The vault is the only store we own: markdown notes holding
*interpretation* — impediments, commitments made aloud, decisions and why. It is
what lets the system say "third sprint running". `recall()` injects the relevant
few into every agent turn under a hard ~900-character budget and fails closed.
And memory that never expires becomes confidently wrong, so every note declares
whether it can rot; `stalenessOf()` ranks dated claims down as they age. A stale
note is never deleted or hidden — it arrives marked `may be stale` so the agent
hedges instead of asserting.

### What runs without you asking

`scheduler.ts` fires four slots: a re-derive at 07:00 and 19:00, `/standup` at
08:00, `/tidy` at 22:00. It reads and proposes; it posts nothing and writes no
field, and a slot stays open two hours so a gateway that was down at 08:00 still
runs the standup at 09:30. "Have we already run today" is answered from the
durable log, not from memory. `MC_SCHEDULER=off` turns it off.

A re-derive diffs against the last run and appends what changed, so the system
can say something went wrong *at 07:41* rather than only that it is wrong now.
**The first run is a baseline and notifies nobody** — on a real programme that
would be a morning of alerts about a quarter of history. A notification carries
a **pointer, never a quote**: evidence does not leave the machine holding it,
which is also what makes every transport safe.

---

## Going live

**One switch, not five.** `MC_GRAPH_DIR` points at a collector's output instead
of `fixtures/`, and that is the whole of it for Jira, Slack, Zoom and Confluence
— the mock is *generated into the same shape a real collector produces*, so
going live is a change of which collector wrote the file and never a change of
layer. `docs/GRAPH-SCHEMA.md` is that contract.

**Connectors go live per surface, not all at once.** `MC_MODE` used to be the
only switch, which made "real" all-or-nothing — five vendor credentials before
anything was real, so in practice nothing ever was. Each surface goes live the
moment its own credential is present; `/api/health` reports which.

| surface | goes live on |
|---|---|
| the graph-backed four | `MC_GRAPH_DIR` |
| Miro | `MIRO_ACCESS_TOKEN` |
| Slack notifications | `MC_SLACK_WEBHOOK_URL` |

The notification is an incoming webhook and its button is a link, so nothing is
ever posted back — nothing here needs a public endpoint. Unset, the review inbox
carries the run alone.

**And that is the hosting decision, not an accident of it.** Mission Control
runs single-tenant on one machine inside the evidence boundary: Copilot and the
Claude CLI authenticate as *a person's login* rather than a service account, the
vault has one writer, and a notification deliberately carries a pointer and never
a quote — because the transcripts and the claims read out of them do not leave
the machine holding them. So the gateway binds `127.0.0.1` by default and
`MC_BIND` is the deliberate opt-out. "Who else can see this?" has a structural
answer rather than a policy one, which is the privacy property rather than a
limitation. It does not make the gateway safe to expose — there is still no
authentication on it — it makes exposing it a deliberate act.

**The agent already works with no credential at all.** The provider ladder is
the Claude CLI first — your own CLI login, no key and no credit — then
`ANTHROPIC_API_KEY`, then Copilot in live mode, then a scripted stub. A fresh
checkout with an empty `.env` gets a real agent over the fixtures, which is what
"mock mode is a complete product" was always supposed to mean.
`node scripts/inspect.mjs health` says which one is about to answer.

**On a Copilot deployment, two things change.** Copilot is reachable only at
`MC_MODE=live`, so that is the switch — plus `gh auth login` or `GITHUB_TOKEN`:

```bash
gh auth login
MC_MODE=live npm run dev
node scripts/inspect.mjs health     # confirm Copilot, not the stub
```

Chat works, and so does structured output — but only after two bugs that both
reported success at the auth gate. `GITHUB_TOKEN` set to a **personal access
token** is refused by Copilot's endpoint while `start()` and `getAuthStatus()`
both pass, so `askCopilotStructured` came back empty; `copilotToken()` now
ignores a PAT and lets the `gh` OAuth login through. And `MC_STRUCTURED=auto`
still picked the Claude CLI ahead of it, because the availability probe read
`subtype` and a logged-out CLI answers `subtype:'success'` with `is_error:true`.

```bash
npx tsx scripts/probe-mcp.mts       # which structured backends this machine has
```

It ends in a verdict rather than four rows, and an absent credential is not
counted as a failure — a backend that *has* one and answers wrongly is, because
an auth gate passing and the turn failing is the one failure you cannot debug
from outside.

**Jira is three commands.** `programme_graph` emits no sprint state — sprints
are bare names on an issue — and the flagship finding fires when a commitment's
container *closes*, so without it the alert this product is built on cannot fire
at all, silently. Jira's agile API has it:

```bash
npx tsx scripts/fetch-jira-sprints.mts --board 42 --out sprints.json
npx tsx scripts/import-programme-graph.mts --in graph.json --out ./live-graph --sprints sprints.json
MC_GRAPH_DIR=./live-graph npm run dev
```

Run the fetcher with no `--board` to list the boards the account can see, and
`npx tsx scripts/verify-collector.mts ./live-graph` to check the result against
the contract before the gateway sees it. `node scripts/inspect.mjs statuses` is
the first thing to run against any real export: it lists every status word the
workflow uses and whether it mapped, and a word that falls through is invisible
from the app.

**All five collectors are written**, each a capture command plus an offline
emitter that merges into one `graph.json`:

| surface | capture | emitter |
|---|---|---|
| Jira | `programme_graph refresh`, `fetch-jira-sprints.mts` | `import-programme-graph.mts` |
| Zoom | `capture-zoom-notes.mts` | `import-zoom-notes.mts` |
| Confluence | `confluence-cli.py read` | `import-confluence-pages.mts` |
| Slack | `slack-cli.py message/channel/user list` | `import-slack-messages.mts` |
| GitHub | `gh pr list --json` | `import-github-prs.mts` |

**Run Jira first** — it supplies the project prefixes the others filter their
extracted keys against, and the people Slack enriches with `handles.slack`. Every
emitter is offline (files in, files out, no credential), merges rather than
replaces, and skips a node id another collector wrote, so
`verify-collector.mts` can be pointed at the result at any point.

Run together on a five-source corpus they produce `missing_ticket` and
`disagreement` — which, measured by stripping the fixture back to Jira alone, are
exactly the two that die without them, and exactly the two no single tool can
produce.

What each still costs is in `docs/ROADMAP.md` track B. The short version: Zoom
reaches meeting **notes** rather than transcripts, because the recording API is
blocked, so a citation into one opens at a line rather than a timestamp — and it
is the one capture that needs a sign-in, which is also the only outstanding step
in the whole set. You can check it works before you have one:

```bash
npx tsx scripts/verify-zoom-capture.mts   # the real capture, a fake Hub, no account
```

Keep the mocks working. On demo day, fixtures are what save you when the wifi
dies or a token expires.

---

## What a demo looks like

1. **The front door names something you did not know.** Four findings, worst
   first, each one a sentence rather than a chart. The top row is the one to
   open — that is the whole promise of the screen.

2. **The hero: a promise nobody ticketed.** Sprint 12 planning agreed that the
   platform team would provide a topic. Sanjay accepted it, due 12 August. The
   sprint closed. No issue references it. The alert page shows what that sprint
   said would happen — three ticks and two crosses — with the quote from the
   recording and the sticky somebody wrote, minutes apart.

3. **Follow the citation.** Click the Zoom quote and the transcript opens at
   14:12, on that line, with the four lines either side. Click the Slack quote on
   a disagreement and the channel opens on the message, in its thread.

4. **Answer it.** *Create the ticket* creates one, carrying a comment that names
   the meeting, the rationale and both citations with their timestamps; the
   commitment gains the key and **the alert stops firing**. The result appears
   in place, with `choose something else` beside it — asking is not navigation
   and neither is acting.

   > The click creates rather than drafts, and the gate is not weakened by it:
   > you are standing in front of the claim, the checklist and every citation,
   > and a second confirmation re-asks what you have just answered. What keeps
   > the *model* away from the button is `HUMAN_ONLY`, which governs its tool
   > set — and this route is not a tool. The message actions still draft, because
   > those words go out over your name.

5. **Two of the four answers are "no", and they are different.** *Not needed*
   dismisses it for good and records who decided. *Not now* asks for the note you
   will thank yourself for and when it should come back — a date, or an event
   like "when the sprint ends" — and it lands in Later with that note attached.

6. **Nothing is self-reported.** There is no field to set to green. Every signal
   is a by-product of work people already do: a message sent, a sticky written, a
   status moved. The only way to change what Mission Control says is to change
   what actually happened.

The fixture contains a deliberate four-ticket cycle
(`PAY-9041 → PAY-9042 → PAY-9043 → PAY-9044 → PAY-9041`), invisible in a
backlog and obvious the moment something looks across it. Every planted case is
listed in [docs/GRAPH-SCHEMA.md](docs/GRAPH-SCHEMA.md) §8 and asserted by
`scripts/verify-graph.mts`.
