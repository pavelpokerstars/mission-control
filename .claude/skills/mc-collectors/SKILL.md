---
name: mc-collectors
description: Reading real data into Mission Control, and the shape it arrives in: the five collectors (Jira, Zoom, Confluence, Slack, GitHub), the connection-graph contract, the two committed fixtures and their generators, going live via MC_GRAPH_DIR, status mapping, sprints, the Miro connector, exporting a graph off the machine, and the twice-daily re-derive. Use when touching scripts/import-*.mts, scripts/generate-*-fixture.mts, scripts/export-demo-graph.mts, scripts/capture-zoom-notes.mts, scripts/seed-miro.mjs, libs/connectors/, apps/gateway/src/graph-source.ts, apps/gateway/src/refresh.ts, apps/gateway/src/seed.ts, fixtures/, fixtures-programme/, graph.json or records/ — or when the question mentions a collector, a fixture, the graph schema, a node or edge kind, provenance tiers, a status word, a sprint, identities, or going live.
---

# Collectors, the graph, and the fixtures

Area depth for Mission Control. The rules that hold everywhere — the invariants, field
ownership, echo suppression, "the shipped code is not the specification" — are in
`CLAUDE.md` and still apply. `docs/GRAPH-SCHEMA.md` is the contract itself; this is the
working knowledge around it.

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
See the verifiers in the `mc-ops` skill.

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

## Taking the graph off the machine

**`scripts/export-demo-graph.mts` writes a second graph directory with the same
structure and none of the prose.** It is how work happens somewhere the live
data may not go — another machine, another model, a colleague's laptop.

```bash
npx tsx scripts/export-demo-graph.mts            # live-graph + live-vault → demo-graph
MC_GRAPH_DIR=./demo-graph MC_VAULT_DIR=./demo-vault npm run dev
```

**The rule is that no free text is carried over — regenerated, not redacted.** A
name regex over prose is the tempting version and it does not work: it misses
nicknames, initials and misspellings, and it leaves the business content itself
intact, which is the part a policy is actually about. So every body, title,
quote and excerpt is invented.

**What makes the invented text useful is that it is generated to the CLASS of
what it replaces.** A line claiming a ticket was done emits a line claiming a
ticket is done, against the same remapped key — it calls the real
`classifySignalFor`, so `findContradictions` still fires on the same pair,
`extractKeys` still joins the same records, and a record that joined to nothing
still joins to nothing. Measured on the live graph: 847 nodes, 357 edges, 18
findings and 19 resolving citations, in and out.

**Dates are kept**, deliberately — a sprint's close is the trigger and the age
of a promise is the severity, so shifting them makes every detector's output
untestable against the thing it mirrors. Statuses are kept too, because
`MC_STATUS_MAP` is exactly what is worth tuning off-machine; the run prints the
workflow words it kept verbatim so somebody reads that list once.

**The leak scan is the only reason to trust any of it.** It re-reads every byte
written and fails the run on anything real: the values it aliased, every
distinctive word from a real title, a foreign email domain or host, a vendor
account id, and any ticket key whose prefix it did not mint. That last one is an
**allow-list**, which is the stronger form — asking "did a real prefix survive"
passes for a project that was never registered, and asking "is every prefix one
of ours" cannot. Schema vocabulary, this script's own invented pools and the
kept workflow words are exempt by name, because a scan that flags its own output
is one somebody switches off.

**`.demo-map.json` is the re-identification key and never travels.** It is
written outside the export directory precisely so copying the export cannot pick
it up, and it is gitignored. Keeping it is what makes a re-export stable as the
programme grows — a new joiner does not reshuffle everybody else's alias.

Three things it exposed, all real and all now fixed. `import-github-prs` named a
PR record after its number alone, so PR 214 in two repos was one file (485 nodes
sharing 475 records) — the repo is in the filename now. Every zoom citation was
built by hand with a quote and **no `ref`**, so the flagship alert could not open
the meeting it cited; `zoomEvidence` in `format.ts` is the one place that builds
one now. And the export's own first cut flattened node ids to `message:mes0001`,
which silently emptied the app: every record projection recovers its key from the
id by *shape*, so nothing joined and the trail went from 13 entries to 1 with
nothing failing. Ids keep their structure and only their values are aliased.

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

**There are TWO committed fixtures, and they answer different questions.**
`npm run fixture` writes both and `npm run verify` asserts both regenerate
byte-identically and satisfy `verify-collector`.

| | `fixtures/` | `fixtures-programme/` |
|---|---|---|
| what it is | the demo narrative | what the five collectors actually emit |
| nodes | 70 | 398 |
| edges per node | 2.26 — dense | **0.69 — sparse** |
| node kinds | 14 | **7** |
| relations | 16 | **5** |
| records naming a ticket | most | **59 of 296** |

**Develop a reader against the second one.** `fixtures/` carries `squad`,
`tribe`, `goal`, `board`, `frame` and `sticky` nodes and `owned_by` /
`member_of` / `attended` / `authored_by` edges, and **no collector in this repo
emits any of them** — it is a picture of the design, not of the input. Worse, it
is dense: everything joins to something, so the single largest gap in the
product (a regex join that fires only when somebody typed a key, which on real
prose is a minority of records) is invisible in it. That gap is why `infer.ts`
exists.

`fixtures-programme/` reproduces the failure modes as well as the shape, because
those are the part a fixture usually flatters away: an **unmapped status word**
(`Pending Review`, so `inspect statuses` and `verify-collector` have something to
catch), **GitHub logins that are not people** (the live import reported 126 such
references, all from PRs), Zoom as **notes rather than transcripts** — a `body`
with no speakers and no timing, where `at` is a paragraph index — and a PR
population that dwarfs everything else. Both warnings it raises are the same two
a real import raises.

The planted cases live on the **active sprint**, and they have to: `gatherWorkFacts`
builds the lane from work still in play, so a cycle on a closed resolved ticket
is invisible and the detector is right to ignore it. And the future sprint holds
**no work at all**, because `activeSprintOf` reads the sprint *names* on items and
sorts them naturally — it never sees a node's `state`. Twelve items filed against
the highest-numbered sprint silently moved the whole lane onto work nobody had
started, and the front door showed the flagship alert and nothing else.

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

