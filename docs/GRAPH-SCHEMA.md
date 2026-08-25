# The connection graph — the contract

One file is the seam between everything that *reads* a source and everything
that *reasons* about one. Collectors write it; the gateway reads it. Neither
side knows the other's language, and that is the point — the collectors are
Python because they already work against the real instances, the gateway is
TypeScript because that is where the product is.

```
collectors (Python)                        gateway (TypeScript)
  programme_graph (Jira)  ─┐
  jira-cli, confluence-cli │
  github-cli, agent-slack  ├─→  graph.json  ─→  detectors, alerts
  zoom scrape, miro export │     records/       the interface
  the mock generator      ─┘
```

`DIRECTION.md` says why the product is alert-first. `DESIGN.md` says what the
screen does. This says what the data is, and it is the one document a new
collector has to satisfy.

---

## 1. Two files, and why the text is not in the graph

**`graph.json`** — every node and every edge. Metadata and joins only: labels,
dates, ids, status, and on an edge the *excerpt* that justifies it. This is
loaded whole, on every boot, and held in memory.

**`records/<kind>/<id>.json`** — the full content of one record: a Slack
message's body, a transcript's segments, a Confluence page's HTML. Read on
demand, never at boot.

The split is not tidiness. The programme graph runs at tens of thousands of
nodes; putting every Slack message body in it makes the one file the whole
product waits on unloadable. It also matches how the interface works — a record
is **reached only from a citation** (`DIRECTION.md` §3), so its full text is
wanted exactly when somebody clicks, and never before.

`graph.json` is [networkx node-link
JSON](https://networkx.org/documentation/stable/reference/readwrite/json_graph.html),
which is what `programme_graph` already emits and what `graphify.serve` reads:

```json
{
  "directed": true, "multigraph": true,
  "graph": { "generatedAt": "...", "generator": "...", "sources": ["jira", "slack"] },
  "nodes": [ { "id": "issue:PAY-12345", "kind": "issue", "label": "..." } ],
  "links": [ { "source": "...", "target": "...", "relation": "...", "tier": "..." } ]
}
```

Adopting that shape rather than inventing one means `graph.html`, `SUMMARY.md`
and the MCP server keep working as **inspection tools for a human**, at no cost.
They are not in the product's path — see §9.

---

## 2. Storage — three layers, and only one of them is rebuilt

The graph is not one thing with one lifetime. It is three, and conflating them
is how a graph either rots or forgets.

| layer | lifetime | holds |
|---|---|---|
| **derived** | rebuilt every run, disposable | what a source can be re-read to prove: Jira structure, links, hierarchy, board arrows, the page inventory |
| **asserted** | durable, accumulates, never rebuilt | what somebody authored: claims, decisions, a dismissal, a deferral — the vault |
| **observed** | durable, append-only, ordered | what changed and when: every run's diff, as events |

**The split is by whether a fact can be re-read, not by which tool wrote it.**
A Jira status is derived even though a human set it, because Jira can be asked
again. A commitment somebody made aloud is asserted, because nothing can re-read
it — the recording is evidence for the claim, not the claim itself.

### Why the derived layer is rebuilt and not updated in place

The obvious design is to build the graph once and keep it current as things
change. It is the wrong one here, for a reason specific to this product:

**Jira does not reliably report link *deletions*.** An incremental update sees
additions and status changes and silently misses removals, so the graph keeps a
`blocks` edge Jira no longer has — indefinitely, invisibly. The same is true of a
card taken off a board, a sticky deleted, a page unpublished. **Absence is
information, and in-place updates are blind to it.**

That matters more here than it would elsewhere, because "a declared link that has
gone stale" is one of the findings this system exists to raise (§7). An
incremental graph would *manufacture* that defect rather than detect it.

The second reason is duller and decides it anyway: an incrementally-mutated graph
**cannot be verified**. One bad merge corrupts an edge and nothing ever notices,
because there is no independent regeneration to compare against. A rebuilt graph
can always be asked "does this match the source?", and that question having an
answer is what makes the tiers in §7 worth anything.

### Fetch incrementally, derive fully

Rebuilding is not re-downloading. The expensive part of a refresh is the network,
and that part *is* incremental:

```
raw records        incremental fetch into an append-only cache   ← the network cost
      ↓            full re-derive every run, entirely local      ← cheap
derived graph      disposable, always matches the source
      ↓            diff against the previous run
observed log       append-only, durable, ordered
      ↓
merged view        derived + asserted + observed, in memory, per read
```

So a run tops up the record cache, then rebuilds the graph from it. "Rebuilding
is too expensive" is nearly always a statement about fetching, and fetching is
the half that stays incremental.

### What each run leaves behind

Two durable things, and together they are the accumulating graph that a pure
rebuild cannot give you:

- **The diff, appended to the event log.** Added and removed nodes and edges,
  tier changes, status changes. Never overwritten. This is the transition
  history, and it is what makes a finding able to say *when* something became
  true rather than only that it is true now.
- **`firstSeen` / `lastConfirmed` per edge**, in an index keyed by
  `(source, target, relation)`. An edge that vanishes then reads as
  `lastConfirmed: 3 days ago` instead of silently not existing — which is the
  stale-link finding arriving as a fact rather than a guess.

**The diff replays; the index does not.** The rule this model rests on — nothing
durable may exist that the append-only log cannot regenerate — holds for the
first of the two. `mc.graph_refreshed` carries the added and removed edge
**identities**, so a consumer can name the edge that vanished at 07:41 rather
than read that two did, which is what makes "a declared link has gone stale"
actionable. The lists are capped at 500 with a `truncated` flag; `added` and
`removed` remain the true totals.

**The index is state, deliberately.** Rebuilding `firstSeen` from an empty file
would need the baseline run to record every edge it saw, and a baseline is a
single JSONL line — measured at 36 kB for this repo's 158 edges, so roughly
**4.4 MB on one line** for a 5,000-issue programme, on a file `readEvents`
parses whole on every call. `seenCount` is not replayable either, because a run
in which nothing moved emits no event while the index still records the
confirmation. So delete `graph-observations.json` and every surviving edge is
re-stamped as first seen today. Repair it by re-observing, not by replaying.

### Two cadences

| | what | why |
|---|---|---|
| **scheduled re-derive** | twice daily | everything expensive, and everything where *absence* matters — structure, links, arrows, inventory |
| **the fast path** | webhooks and polls | transitions that can announce themselves: `POST /api/webhooks/jira`, the 30-second canvas poll |

They meet in the same event log, which is what lets a finding be precise about
its own moment — *"fired 07:41 today, when the fourth arrow was drawn"* — while
the twelve-hourly pass carries the things nothing pushes. Twelve hours is not a
compromise for the hero case: a commitment that was never ticketed is a state
predicate, and it is not more true at 09:00 than at 21:00.

**The first run is a baseline, never news.** A re-derive against an empty or stale
index reports everything as new, which on a real programme is tens of thousands
of events and, worse, a morning of alerts about a quarter of history. The rule
and its persistence are not optional: the baseline is written to disk, carries
the identity of what it baselined, and re-baselines rather than reports if it is
older than a day. `canvas-poll.ts` already implements exactly this, for exactly
this reason, and it learned it the hard way — held in memory, every restart
re-baselined and an arrow drawn while the process was down was absorbed and never
produced a link.

### What this asks of a collector

**Append the diff; do not overwrite it.** `programme_graph` computes exactly the
right deltas today — `tier_changes`, `status_changes`, added and removed — and
then writes them to a `CHANGES.json` that the next refresh replaces. So the
change history is currently one run deep and disappears on the following run.

Appending instead is a small change and the whole transition story rests on it.
Nothing else about the rebuild needs to move: it stays a pure function of the
source at time T, which is the property worth protecting.

---

## 3. Ids

`kind:value`, derived from the source's own identifier so that re-running a
collector produces the same id. That determinism is the whole precondition for
`diff.py`-style change detection: an id that moves turns every refresh into
"everything is new".

| kind | id | from |
|---|---|---|
| `issue` | `issue:PAY-12345` | the Jira key |
| `person` | `person:jsmith@example.com` | **email, always** — see §6 |
| `squad` `tribe` `goal` | `squad:ORG-10000011` | the field value |
| `sprint` | `sprint:PAY-Sprint-14` | project + sprint name |
| `release` | `release:PAY-2026.9` | project + fix version |
| `component` | `component:PAY-payments` | project + component |
| `message` | `message:slack/C0123/1755950400.001` | channel + `ts` |
| `meeting` | `meeting:zoom/rec-8842` | the recording id |
| `page` | `page:confluence/2140476323` | the page id |
| `pr` | `pr:github/FlutterInt/fips-web-client/4210` | owner/repo/number |
| `sticky` `frame` `board` | `sticky:miro/«board»/«item»` | board + item |
| `note` | `note:dana-owns-dedupe-cache` | the vault slug |

**Jira keys are the spine and stay bare inside the `issue:` id.** The regex that
finds them in prose is the same on both sides — `\b([A-Z][A-Z0-9]+-\d+)\b`, in
`@mc/domain`'s `extractKeys` and in `programme_graph`'s `ISSUE_KEY_PATTERN`,
arrived at independently. Do not "improve" either without the other.

---

## 4. Nodes

Every node carries `id`, `kind`, `label`, `source` (which collector wrote it) and
optionally `url` and `updatedAt`. Per-kind attributes below are what the product
reads; a collector may add more and the gateway will ignore them.

**Work.** `issue` — every Jira issue at every level. `level` distinguishes them
(`initiative` · `epic` · `story` · `task` · `bug` · `spike` · `incident`), so
adding a hierarchy level is a value rather than a new node kind. Carries
`status`, `statusCategory`, `assignee`, `points`, `createdAt`, `resolvedAt`.

> `status` is the vendor's own string — `Code Review`, `QA`, `Closed`. It is
> **not** mapped to a fixed union. `statusCategory` (`todo` · `doing` · `done`)
> is the collector's declared reading of it, from config, because every Jira
> names these differently and a union in code is a migration every time a
> workflow changes.

**Containers** — the things whose closing fires an alert (`DIRECTION.md` §4).
`sprint` and `release` carry `state` (`future` · `active` · `closed`) and
`closedAt`. An `epic` is an `issue`, and closes like one.

> This is what the tree does not have today: `WorkItem.sprint` is a bare string
> with no dates and no state, so "the sprint ended" is unobservable. It is a
> node here precisely so that it can close.

**Org.** `person`, `squad`, `tribe`, `goal`. A `person` carries `email`,
`displayName` and the per-source handles it is known by (§6).

**Records.** `message` · `meeting` · `page` · `pr` · `sticky` · `frame` ·
`board`. Each carries `at` (when it happened), `container` where it has one (a
channel, a board), and a pointer to its `records/` file.

**Vault.** `note` carries `noteKind`, `status`, `recency`, `verifiedAt` and —
new, and required by the gap detector — `owner`, `dueAt` and `container`.

> A `commitment` with an owner, a due date and no ticket **is** the missing-ticket
> alert. `DIRECTION.md` §5's precision gate is those two fields, and `Note` has
> neither today.

---

## 5. Edges

Every edge is `{ source, target, relation, tier, origin, why?, score?, evidence[] }`.

**Direction is stated once, here, and every relation has exactly one.** Getting
one backwards is the most expensive class of bug available in this system: it is
plausible, it renders, and it says the opposite of the truth.

### Hierarchy — child → parent
`child_of` · `belongs_to_epic`

### Dependency — dependent → blocker
`depends_on`. **`A depends_on B` means A is waiting for B.** B is the blocker.

> ⚠ **This is the reverse of the gateway's own convention.** `@mc/domain`'s
> `blocks` runs blocker-first: `MC-103 blocks MC-102` means MC-102 is waiting.
> So `A depends_on B` ≡ `B blocks A`, and the adapter **flips**.
>
> The graph keeps `depends_on` because `programme_graph` is the largest producer
> and owns that convention. One flip, in one function, asserted in one test,
> beats asking six collectors to adopt a foreign one. `CLAUDE.md` already records
> what the alternative costs: a prompt that read the direction backwards produced
> *every* inferred dependency reversed, drawn confidently the wrong way round.

### Ownership — issue → thing
`assigned_to` (→ `person`) · `owned_by` (→ `squad`) · `responsible_tribe`
(→ `tribe`) · `supports_goal` (→ `goal`)

### Membership — person → org, issue → container
`member_of` · `in_sprint` · `targets_release` · `has_component` · `in_frame`
(sticky → frame) · `on_board` (frame → board)

> `member_of` may carry `validFrom` / `validTo`. That is the one piece of history
> the graph keeps, and it exists for a sentence the product wants to say out
> loud: *"sanjay moved off the platform team on 31 July, so the person who picks
> this up now is marcus."* Without dated membership that answer is unavailable.

### Authorship — record → person
`authored_by` · `attended` (person → meeting)

### Reference — record → the thing it is about
`mentions` (a key found in the text) · `links_to` (a URL found in the text) ·
`documents` (a page about an issue) · `annotates` (a note about an issue) ·
`co_occurs` (same window, same people) · `similar_to` (wording)

> `mentions` and `links_to` are the two deterministic joins and they are not the
> same one. **A large share of text-bearing records carry no key at all**, in
> fixtures written to make the join work.
> `links_to` catches the Confluence page somebody pasted into Slack — every tool
> here emits canonical URLs, and no key regex will ever find one.

---

## 6. People are the join everything else rests on

> **Built — `ROADMAP.md` B3.** `StoredPerson` is a node kind, `buildIdentities`
> resolves every person reference through `handles` at the projection seam, and
> `import-slack-messages.mts --users` merges `handles.slack` into the person the
> Jira import already wrote. `node scripts/inspect.mjs identities` lists every
> reference the map could not place. The section below is why it is shaped this
> way.

`person` is a first-class node and **email is the id**. Every source carries one:
`jira-cli` assigns by username-as-email, `confluence-cli` authenticates with one,
GitHub and Slack both expose one.

A `people.json` map — email → per-source handle — is the whole mechanism, and it
is hand-maintained until it is not:

```json
{ "jsmith@example.com": { "slack": "U024BE7LH", "jira": "jsmith",
                             "github": "jsmith-flutter", "zoom": "John Smith" } }
```

Without it, a Zoom speaker, a Slack author and a Jira assignee are three
different strings and every "who should I ask" answer is guesswork.

> The gateway's `GraphNodeKind` deliberately excludes people, on the grounds that
> a graph with every speaker on it is a hairball. That is right about a **render**
> and wrong about **storage**. Store people; let each view filter to the kinds it
> draws. Separating the storage model from the render model is what makes both
> rules true at once — which is why `GraphNodeKind` has four members and
> `STORED_NODE_KINDS` has sixteen.

---

## 7. Tiers, and the loop that makes them worth having

Every edge carries one, in `programme_graph`'s vocabulary — which is also
`graphify`'s, and which `@mc/domain`'s `EdgeProvenance` already uses two thirds
of:

| tier | meaning |
|---|---|
| `EXTRACTED` | a deterministic fact, or a declared claim that evidence corroborates |
| `INFERRED` | reconstructed from evidence by a rule. Carries its evidence, always |
| `AMBIGUOUS` | declared but uncorroborated, or contradicted |

`origin` is orthogonal and says where it came from: `structural` (the source
asserts it), `declared` (the source *claims* it — a dependency link), or
`reconstructed` (we worked it out).

**Declared dependency links start `AMBIGUOUS`.** They are claims to be tested,
not facts. Reconciliation then compares them against independently reconstructed
evidence and produces the three outcomes that are, directly, two alert types:

| outcome | tier | what it is |
|---|---|---|
| corroborated | → `EXTRACTED` | the link is real |
| **reconstructed, never declared** | `INFERRED` | **a dependency Jira never recorded** |
| **declared, nothing behind it** | `AMBIGUOUS` | **a stale or wrong link** |

Two rules the gateway enforces on top:

- **An `INFERRED` edge without a `why` is dropped.** An unexplained dashed line
  is a machine asserting a dependency nobody can check, which is worse than no
  line: a reader can only trust it or ignore it, and they ignore it.
- **Only `EXTRACTED` edges feed cycle detection.** The cycle banner accuses a
  team of an unschedulable plan and offers to fly you to it. A guess must not be
  able to raise one. Note this *is* a loosening of the current rule, which
  excludes everything inferred — a reconciled, corroborated edge is a stronger
  claim than anything `infer.ts` produces, and the tier is what says so.

---

## 8. The fixture, and what it plants

`npm run fixture` writes `fixtures/` — `graph.json`, `observations.json` and
`records/` — from the spec in `scripts/fixture/`. The output is **committed**,
because the demo has to run on a machine with no credentials and a stranger
cloning the repo is most of what is being judged.

It is a *generator* rather than a fixture file, and that is the whole point:
`graph.json` here is the same artefact a real collector produces, so going live
is a change of which collector wrote the file and never a change of layer. Every
detector is developed against the real shape from the first day.

**Deterministic.** There is no randomness in it — the only derived values are
timestamps, from the spec's own dates — so a re-run produces no diff and a demo
cannot rearrange itself between rehearsal and stage.

**Invented, and that is a constraint rather than a convenience.** Nothing in it
is derived from a real transcript, board or ticket, because it ships in a repo
strangers open. What *is* taken from reality is the vocabulary — the shape of a
key, the words a status takes, the id of a custom field — and it lives in one
`VOCAB` block in `scripts/fixture/programme.ts` so that neutralising it before
publication is one edit rather than a search.

**The generator validates before it writes.** A fixture that violates the
contract is worse than no fixture: every detector developed against it inherits
the violation, and nobody finds out until real data behaves differently.

### What is planted, and why each one is there

Each is marked `⟨CASE⟩` in `scripts/fixture/records.ts`, and each is asserted by
`npx tsx scripts/verify-graph.mts` — because the planted cases are exactly what
rots silently. An edit that quietly drops the unjoined commitment leaves a demo
where the hero alert never fires, with nothing failing anywhere.

| case | what it is | why it must exist |
|---|---|---|
| **missing ticket** | a commitment with an owner, a due date, a **closed** container and no key | the hero. The container closing is the trigger |
| **the gate holds** | a commitment with no owner and no date | proves the precision gate is real and not a sentence in a document |
| **an inferred join** | a claim naming no key, joined via speaker and sprint, carrying its `why` | the join that fires on real data when the key join does not |
| **undetected dependency** | reconstructed from a ticket's prose, never declared in Jira | `INFERRED`, and a headline finding |
| **suspect link** | declared, uncorroborated, and the blocker is already `Closed` | `AMBIGUOUS`, the other headline finding |
| **a cycle** | four issues, declared *and* corroborated, so all four are `EXTRACTED` | only corroborated edges may raise a cycle (§7) |
| **sources disagree** | "it is done" on the Tuesday, "still blocked" on the Wednesday, Jira says Code Review | the tool must not pick a winner |
| **the URL join** | a Slack message linking a Confluence page, naming no ticket anywhere | measured on a real corpus, **no** extracted action named a key — this is the join that works |
| **the reorg** | somebody left a squad on a date | "the person who agreed this has moved; who owns it now" |
| **records that join to nothing** | a page naming no ticket, a sticky with no key | Sources' "what we could not read" (§7), and honest |

---

## 9. Rules for collectors

1. **Collectors do not interpret.** Fetch, normalise, emit. Every rule that
   decides what is true, what fires and what is shown lives in the gateway.
   Detection split across two languages gets two definitions of "blocked".
2. **Collectors are read-only.** `jira-cli.py` can create, transition and
   assign; the pipeline calls none of it. Writes go through the gateway's
   proposal path and a human pressing the button — `FIELD_OWNER` and
   `HUMAN_ONLY` are the product, not a formality.
3. **The mock is written by a generator that emits this exact shape.** Not TS
   object literals in a fixture file. Going live must be a change of *which
   collector wrote the file*, never a change of layer — otherwise everything
   downstream is tuned against a shape that was never real.
4. **Emit the vendor's own vocabulary** — its *shape*, not its contents. Project
   keys that look like project keys, the workflow's own status words
   (`Code Review`, `QA`, `Closed`), custom fields as custom fields
   (`customfield_10001` responsible squad, `customfield_10002` epic link,
   `cf[10003]` initiative). The mapping to anything else is the gateway's job
   and belongs in config.

   **The values here are invented and the shapes are not.** A collector binding
   to `customfield_NNNNN`, or to an eight-digit squad id, is the thing being
   rehearsed; *which* five digits is not, and this repo is one strangers open.
   The whole vocabulary lives in one `VOCAB` block in
   `scripts/fixture/programme.ts` for exactly that reason.
5. **Every edge earns its evidence.** `{ source, ref, quote?, at? }` — enough for
   the interface to cite it and deep-link to the record it came from.
6. **`graphify`'s own tools stay inspection-only.** `graph.html`, `SUMMARY.md`
   and `graphify.serve` are useful for looking at the graph by hand. None of them
   is in the product's path, and the MCP server in particular must not be: the
   deployment forbids MCP servers, and routing detection through a model would
   break the rule that the firing decision is deterministic code.

---

## 10. What each collector emits

§9 is the rules; this is the shape, per surface, written from **what the gateway
actually reads** rather than from intent — every field below is dereferenced by a
projection in `libs/connectors/src/graph/index.ts`, and a field absent from this
list is a field nothing consumes.

Each block was checked against the committed fixture's own nodes and records
rather than written from memory, which caught three mistakes in the first draft —
including a sticky's frame, documented as a field where the code reads an edge.
If you change a projection, check this section against it.

Check any output with:

```bash
npx tsx scripts/verify-collector.mts /path/to/output
```

It validates the contract, reports **what each surface contributed**, and lists
the status words and person references that did not resolve. Contract violations
exit non-zero; configuration gaps only warn.

### How much each surface is worth

Measured, by stripping the fixture back to Jira alone and running the findings
pass: **seven findings became four.**

| surface | without it |
|---|---|
| **jira** | nothing at all — there is no work to alert about |
| **zoom** | **the flagship finding stops existing.** A promise nobody ticketed has to have been *made* somewhere, and a conversation is where |
| **slack** | no `disagreement`. A "done" claim needs something that contradicts it, and that is almost always a message |
| **miro** | the board half of `/workshop` — an action written on a sticky but never said aloud is invisible |
| **confluence** | a decision can never be shown as *already written down*, so `/tidy` nags for a record that exists |
| **github** | no code-side corroboration |
| **person nodes** | the alerts still fire, and every "who weighed in" rollup counts the same human two or three times |

The two that go first — a commitment nobody tracked, and two sources
disagreeing — are exactly the two **no single tool can produce**. Jira alone
leaves the structural findings (`cycle`, `suspect_link`,
`undetected_dependency`), which are real and are not the product's argument.

### Jira

Nodes, no records needed — everything is on the node:

```json
{ "id": "issue:PAY-9031", "kind": "issue", "label": "Emit a payment-settled event",
  "key": "PAY-9031", "level": "story", "source": "jira",
  "status": "Code Review", "statusCategory": "doing",
  "assignee": "dana@example.com", "points": 5, "url": "https://…",
  "createdAt": "2026-08-05T09:00:00Z", "updatedAt": "2026-08-18T16:00:00Z" }
```

**`source` is on every node**, naming which collector wrote it — that is what
lets `/api/sources` count coverage per surface without guessing. `assignee`,
`points` and `url` are optional; the rest is not.

`status` is the **workflow's own word**, untouched — `MC_STATUS_MAP` maps it, and
`statusCategory` is the fallback. Since a category has three values, an unmapped
word makes `in_review` and `blocked` unreachable; `inspect statuses` shows which.
`assignee` is an **email**, resolved through the person nodes.

Containers are nodes too, and `state: "closed"` is what makes the flagship
finding *fire*:

```json
{ "id": "sprint:PAY Sprint 12", "kind": "sprint", "label": "PAY Sprint 12",
  "state": "closed", "startsAt": "2026-07-06", "endsAt": "2026-07-31",
  "closedAt": "2026-07-31T17:00:00Z" }
```

### Slack

A node plus a record. `id` is channel + `ts`, per §3.

```json
{ "id": "message:slack/C0123/1755950400.001", "kind": "message",
  "label": "#eng-payments — dana", "recordRef": "records/message/eng-payments-1.json" }
```

```json
{ "id": "eng-payments-1", "channel": "eng-payments",
  "author": "U0G9QF9C6", "at": "2026-08-19T16:20:00Z",
  "text": "PAY-9031 is still blocked — can't publish until the topic exists." }
```

`author` may be whatever Slack calls the user; a person node's
`handles.slack` is what makes it the same human as the Jira assignee.

### Zoom

```json
{ "id": "meeting:zoom/sprint-12-planning", "kind": "meeting",
  "label": "PAY Sprint 12 planning", "recordRef": "records/meeting/sprint-12-planning.json" }
```

```json
{ "id": "sprint-12-planning", "topic": "PAY Sprint 12 planning",
  "startedAt": "2026-07-06T10:00:00Z",
  "participants": ["Riya Sharma", "Dana Okafor"],
  "segments": [{ "at": 852, "speaker": "Riya Sharma",
                 "text": "Platform can give us the topic. Sanjay owns it — due the twelfth." }] }
```

**`segments[].at` is seconds into the recording, and it is load-bearing.** It is
what a citation deep-links to, so a transcript with no offsets can be quoted and
never opened at the line. `speaker` resolves through `handles.zoom`.

**A meeting may carry `body` instead of `segments`, and often will.** An
organisation that blocks the recording API leaves exactly one reachable Zoom
artifact: the **Docs note** — the AI summary and its next steps — captured
through a logged-in browser. It is prose. It has no speakers and no offsets, and
`scripts/import-zoom-notes.mts` emits it like this:

```json
{ "id": "abc123", "topic": "Sprint planning - 2026-08-12",
  "startedAt": "2026-08-12T00:00:00.000Z", "participants": [],
  "body": "Quick recap\n\nThe team reviewed…\n\nNext steps\n\nPlatform to provide…" }
```

**The id is the Zoom document id and NOTHING derived from the title**, which is
the §3 determinism rule applied to the one source whose titles are edited in
place. This example used to read `sprint-planning-abc123`, and a title-derived
id means renaming a note in Zoom produces a *second* meeting for one document
while every stored citation to the first dangles.

It is case-folded to stay safe as a filename — `records/meeting/<id>.json`, on a
filesystem that is case-insensitive by default — so an id the fold would change
carries six characters of the raw id's digest after it
(`meeting:zoom/ab7xq-d12317`). Measured before that: `aB7xQ` and `Ab7Xq` were
two different meetings and became one node and one record, with the second
simply absent and nothing failing. An id that is already lowercase and
alphanumeric is unchanged, which is the common case and the one above.

`annotateTranscript` turns that body into one segment per paragraph so the ten
consumers of `segments` — the trail, the inference pass, `/workshop`, the
suggestions, `trace_entity` — keep working unchanged, and **the keys still
join**, which is the whole mechanism. Two things it must never do, and both are
enforced rather than remembered:

- **`Transcript.timed` is `false`** on a derived record, and `records.ts` then
  emits **no `at`** on a line. A citation into a note opens it at a line index.
  Rendering the paragraph number as a timestamp would put a moment beside a
  sentence nobody timed, on the page whose argument is that its citations are
  checkable.
- **`speaker` is `UNKNOWN_SPEAKER`**, never a name. A room sharing one
  microphone is a real meeting and Zoom emits a single track; attributing those
  words to whoever booked the call is an invented citation. `records.ts` omits
  `who` rather than showing it.

**`participants` is empty on a note, deliberately.** Zoom Docs name people in
the prose — *"Riya to draft the ADR"* — but a name in a sentence is not a
participant list, and `buildIdentities` would resolve invented handles into the
trail.

### Confluence

```json
{ "id": "page:conf/48210331", "kind": "page", "label": "ADR-014 — dedupe cache",
  "recordRef": "records/page/48210331.json" }
```

```json
{ "id": "48210331", "title": "ADR-014 — dedupe cache", "author": "riya",
  "at": "2026-07-22T11:00:00Z", "body": "<p>…</p>",
  "keys": ["PAY-9012"] }
```

`keys` is the join. `extractKeys` will find them in the body as well, but a page
that states them explicitly joins even when the prose does not name one.

### Miro

A sticky's text is its `label`, and **its frame is an edge, not a field** — the
first draft of this section said `"frame": "Actions"` on the node, and
`projectStickies` reads neither that nor the record: it walks `in_frame` edges to
`frame` nodes.

```json
{ "id": "sticky:miro/uXjVK/3458764", "kind": "sticky",
  "label": "Settled topic — PLATFORM own — due 12 Aug", "source": "miro" }
{ "id": "frame:miro/uXjVK/3458700", "kind": "frame", "label": "Actions", "source": "miro" }
{ "source": "sticky:miro/uXjVK/3458764", "target": "frame:miro/uXjVK/3458700",
  "relation": "in_frame", "tier": "EXTRACTED" }
```

**The frame's label decides whether `/workshop` proposes a ticket** — only one
the team called *Actions* does, because a "went badly" sticky is not a ticket. A
sticky with no `in_frame` edge still appears on the board half; it just never
becomes a proposal.

Positions are **not** emitted. `projectStickies` lays them out itself, because
Miro owns `position` and nothing here may write it back.

### GitHub

```json
{ "id": "pr:github/payments/4198", "kind": "pr", "label": "Add idempotency key",
  "recordRef": "records/pr/4198.json" }
```

### People — the one that closes the identity map

```json
{ "id": "person:dana@example.com", "kind": "person",
  "email": "dana@example.com", "displayName": "Dana Okafor",
  "handles": { "jira": "dana", "slack": "U0G9QF9C6", "zoom": "Dana Okafor" } }
```

Keyed on email because it is the only identifier every source shares. Everything
downstream compares handles, so without this a Jira account id, a Slack user id
and a Zoom display name are three different people. `inspect identities` lists
every reference that resolves to nothing and prints this shape for it.

### Edges

Every edge carries a `relation` and a `tier`. Direction per §5 — and the one to
get right is `depends_on`, which runs **dependent → blocker**, the reverse of
`blocks`. `verify-collector.mts` prints yours as English sentences, because both
directions are well-formed graphs and only a human can say which is true.

```json
{ "source": "issue:PAY-9032", "target": "issue:PAY-9031",
  "relation": "depends_on", "tier": "EXTRACTED",
  "why": "PAY-9032's description names it as a blocker",
  "evidence": [{ "source": "jira", "ref": "issue:PAY-9032",
                 "quote": "blocked by PAY-9031" }] }
```

Only `EXTRACTED` feeds cycle detection — a guess must not be able to accuse a
team of an unschedulable plan. `INFERRED` without a `why` is dropped on read.

---

## 11. Connecting the real sources

Read against the actual tools rather than from intent. **`programme_graph` is
the only one that produces a graph**; the rest are read/write CLIs and scrapes,
so §10's shapes are what somebody has to emit *into*, not what already exists.

**All five emitters are written now**, and `ROADMAP.md`'s "The five collectors,
run together" has the run that proves they merge into one graph. What follows is
what each reads and what still costs something.

| surface | capture | emitter | what still costs something |
|---|---|---|---|
| **Jira** | `programme_graph refresh` + `fetch-jira-sprints.mts` | `import-programme-graph.mts` | nothing — sprint state was the last gap and the fetcher closed it |
| **Confluence** | `confluence-cli.py read <id> --format json` | `import-confluence-pages.mts` | the CLI drops `version.when`; an undated page is **refused** rather than guessed. One line upstream fixes it |
| **Slack** | `slack-cli.py message/channel/user list` | `import-slack-messages.mts` | nothing. `--users` also closes the identity map |
| **Zoom** | `capture-zoom-notes.mts` (Playwright, logged-in profile) | `import-zoom-notes.mts` | **notes, not transcripts** — the recording API is blocked, so no speakers and no offsets. See §10 |
| **GitHub** | `gh pr list --json` | `import-github-prs.mts` | `github-cli.py` is a write tool with no `pr list`, so `gh` is the reader |
| **Miro** | live, via `MIRO_ACCESS_TOKEN` | — | nothing — this one was always done |

Every emitter is **offline**: files in, files out, no credentials, no network, so
`verify-collector.mts` can be pointed at the result. Every one **merges** rather
than replaces, identifies its own output by a `collector` marker, and skips a
node id another collector wrote. **Run Jira first** — it supplies the project
prefixes Confluence and GitHub filter their extracted keys against, and the
people Slack enriches with `handles.slack`.

### `programme_graph` → us: an adapter, not an exporter change

```bash
npx tsx scripts/import-programme-graph.mts \
  --in data/programme_graph/graph.json --out ./live-graph \
  --sprints sprints.json --people people.json
```

**Most of it already lines up**, because this contract was designed from that
tool. Node ids are `kind:value`. The envelope is networkx `node_link_data`, which
is where `links` rather than `edges` comes from. Tiers are the same three words.
Origins are the same three words. Eight of ten relation names are identical.
Declared dependencies start `AMBIGUOUS` and are promoted by reconciliation.

What the adapter does, and every line of it was found by reading the tool:

| | |
|---|---|
| `confidence` → `tier` | same three values, different name. **The single most load-bearing line** — `isStructuralDependency` tests the tier, and an absent one means no cycle detection at all |
| `reconciled` passed through | `reconcile.py` marks every dependency edge it touched, so a reader can tell *"checked and still AMBIGUOUS"* — the stale-link finding — from *"never reconciled"*, which is not a finding. **Both reconciliation findings are silent without it** |
| `issue_type` → `level` | Jira's own word to our fixed five; hierarchy is a value here, not a node kind |
| `story_points` → `points`, `updated` → `updatedAt` | renames |
| `statusCategory` **derived** | not in their output, and it is our last-resort fallback. Coarse on purpose — `MC_STATUS_MAP` is the real answer, reading the vendor word we pass through untouched |
| `label` stripped of its key | theirs is `"PAY-9031 Emit a settled event"`; ours is the summary, because the key is already a column |
| `mentions_issue` → `mentions`, `targets_fix_version` → `targets_release` | the only two relation names that differ |
| `person:<display name>` → `person:<email>` | `_normalize_assignee` reduces Jira's user object to a display name. We key on email — the only identifier every source shares — so a `--people` map re-keys them, **and every edge pointing at them is rewritten too**. Forgetting that leaves every `assigned_to` dangling, which is what "no edge points at a node that does not exist" caught |
| sprint nodes **synthesised** | see below |

### The one that stops the flagship finding

**`programme_graph` emits no sprint nodes.** Sprints exist only as
`sprint_names[]` strings on an issue — no state, no dates.

`findMissingTickets` fires when a commitment's **container closes**, resolving
`note.container` against a sprint node whose `state` is `closed`. With no such
node there is no trigger, and the alert this product is built on cannot fire on
real data — **silently**, because nothing errors and the front door simply says
nothing needs you.

Jira's agile API has all of it, so this is a fetch nobody has written rather than
information that does not exist:

```
GET /rest/agile/1.0/board/{boardId}/sprint
```

Until it is written, pass it by hand — the adapter takes a `--sprints` file and
**warns loudly when nothing is closed**:

```json
{ "PAY Sprint 12": { "state": "closed", "endsAt": "2026-07-31",
                     "closedAt": "2026-07-31T17:00:00Z" } }
```

### Verified end to end

Against a synthetic input shaped exactly as `programme_graph` writes one:
adapter → `verify-collector` reports the contract holding → the gateway runs →
**`undetected_dependency` and `suspect_link` both fire, quoting the tool's own
evidence** (*"description names it as a blocker"*, *"Jira link: is blocked by"*).
And `inspect statuses` flags `Selected for Dev` as falling through, which is the
`MC_STATUS_MAP` entry to write first.

The three findings that need the other surfaces stay absent, as measured in §10:
Jira alone cannot produce a promise nobody ticketed, or two sources disagreeing.
