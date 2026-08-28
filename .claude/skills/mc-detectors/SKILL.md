---
name: mc-detectors
description: How Mission Control decides an alert: the findings pass and all eight kinds, which six reach the front door, the work lane and the dossier behind them, aging thresholds and their two bases, contradictions, cycles, commitment reconstruction in joins.ts, ranking and severity, suppression and deferral. Use when touching apps/gateway/src/findings.ts, work.ts, issue.ts, act.ts, sources.ts, libs/domain/src/joins.ts — or when the question mentions a finding, an alert kind, severity, staleness, a cycle, a disagreement, a missing or dropped commitment, or why an alert did or did not fire.
---

# The findings pass, the work lane, and the dossier

Area depth for Mission Control. The detectors are deterministic code and must stay so — an
alert list that changes between two runs over the same data is worthless. That rule, and the
invariants the write path depends on, are in `CLAUDE.md`.

**`activeSprintOf` sorts sprint names naturally, not lexicographically.**
`"Sprint 9"` sorts after `"Sprint 14"` as a string, which would quietly change
what `/plan` and every skill mean by "this sprint". `compareSprints` is the
shared comparator and is module-private, because every consumer lives in
`libs/domain/src/index.ts` alongside it.

## The findings pass — the alert list

**`GET /api/findings` is what the front door becomes.** `apps/gateway/src/findings.ts`
returns `Finding[]`, ranked worst-first, from the loaded graph and the in-memory
vault. It touches no vendor and is deliberately not cached: `/api/work` pays for
a five-surface gather, and this is the screen the app opens on and the one a
notification links into.

**All EIGHT kinds fire, and six of them reach the front door.**
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

**The programme fixture carries a realistic `updatedAt` spread and a carry
chain, and both were missing.** Every one of its eighty issues used to be
stamped `day(sprint.end, 12)` — one instant for the whole sprint — so the
bounded basis computed correctly for every row and every row read the same 2.6
days, crossing no threshold. And no issue had more than one `in_sprint` edge, so
`carriedFrom` was empty for all eighty and the carry evidence row was
unreachable. `sprintNames()` on a real board returns a LIST and
`import-jira-issues.mts` emits one edge per name, so carryover is the normal
case live and was the impossible case here. `IDLE` in
`generate-programme-fixture.mts` is the weighted table — ten entries inside a
working week, four in the tail — because uniform scatter flagged twelve of the
twenty active-sprint tickets, which is the dashboard the front door may not
become.

**`projectWorkItems` used to collapse carryover to whichever `in_sprint` edge
came last**, possibly a *closed* sprint — and `gatherWorkFacts` filters on
`i.sprint === activeSprintOf(items)`, so the carried tickets, the ones in play
longest and exactly what the lane exists to surface, dropped out of the sprint
entirely and silently. The active sprint wins now, then the one ending latest,
so the answer is stable rather than dependent on edge order.

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

**A promise nobody typed a key into now produces one of TWO alerts, and they
are different claims rather than one softened.** Measured on the fixture shaped
like real collector output, **zero of twenty-four meetings names a Jira key** —
which is the shape of the real thing, because nobody says a ticket number aloud
in a stand-up. So every promise made in a meeting reached the vault with
`relatedKeys: []` and the flagship alert reported it as *never filed*, including
when it was plainly the ticket everybody in the room was looking at.

| | fires when | claim | button |
|---|---|---|---|
| `missing_ticket` | no filed key **and** no reconstruction | *"… was never filed"* | Create the ticket |
| `unlinked_commitment` | no filed key **and** exactly one reconstruction | *"… is probably ORB-1585, and nothing says so"* | Link it to the ticket |

**Both keep the `missing_ticket:<noteId>` id, and that is not cosmetic.** Three
things key on `Finding.id`: `suppressedIds` and `answeredFindingIds` in `act.ts`
— so every deferral and dismissal already made would come straight back — and
`notifiedIds` in `notify.ts`, which reads `mc.memory_surfaced` off the durable
log. That last one is the expensive one: the first pass after a rename
re-announces every alert the user was already told about. A note produces
exactly one of the two kinds, so uniqueness still holds.

**`libs/domain/src/joins.ts` is the reconstruction, and it is deterministic
code.** `infer.ts` is the right instrument for *"this page is about the same
outage"* and the wrong one here, for the reason `skills.ts` is deterministic:
this feeds a DETECTOR, and an alert list that changes between two runs over the
same data is worthless. The pipeline is `scope ∩ owner ∩ words`:

- **scope** — issues in the promise's own container. NEVER the programme. The
  worked example is `PLT-4412 "Provision the payments settled topic"`, which
  matches the flagship promise beautifully and is in no sprint at all.
- **owner** — the assignee resolves to the same person, through
  `buildIdentities`. This is the filter doing the real work.
- **words** — the titles clear `JOIN_MATCH` (0.4) *and* share `MIN_SHARED_WORDS`
  (2). Two floors, because the coefficient alone runs high for two tiny sets
  sharing one word.

**It mints only when EXACTLY ONE candidate clears, and that refusal is the
design.** Not "highest score, breaking ties" — measured on `fixtures/` for
*"Dana takes the settled event end to end"*, the leader is **PAY-9033 at 0.50
and it is the wrong ticket**, with PAY-9031 and PAY-9032 tied behind at 0.40.
A tie-break by score would mint a confident wrong link with a plausible reason
attached. Two survivors mint nothing and the alert stays `missing_ticket`.

**Nothing writes a reconstruction into the vault.** The vault is the asserted
layer — it accumulates and is never rebuilt — so a stored guess would outlive
any threshold change and could not be undone by switching this off. It runs in
the pass, every time. What a person confirms on the alert *is* written, as
`EXTRACTED`, which is what stops it firing again.

**`Note.joins` was fully built and had no consumer.** It is persisted,
round-tripped through the frontmatter and asserted by `verify-graph.mts`, and
nothing read its tier to decide anything: `findMissingTickets` gated on
`relatedKeys.length > 0` regardless of provenance. So the moment anything
reconstructs a key, the flagship alert goes quiet on promises that genuinely
were never filed — silently. `filedKeys` is the one definition now, and the
checklist reads it too, because a guessed key rendered beside an unticked box
reads as a filed ticket with a broken tick.

**`dropped_commitment` is the other new one: promised out loud, its sprint still
RUNNING, and nothing since has named it.** `missing_ticket` fires when a
container closes and says the tracker never got this; this fires while the
container is open and says the *conversation* dropped it. Mutually exclusive by
construction on `container.state` — `active` here, `closed` there — so neither
detector knows the other exists. `active` and not `!== 'closed'`, because
`future` admits a sprint that has not started and nagging about next sprint is
exactly what the trigger question was settled to avoid.

- **The question is asked from `lastHeardOf`, not from when the promise was
  made.** "Was it ever acknowledged" is a one-shot test that a promise
  acknowledged once the next morning and dropped for two months passes for
  ever — which is the failure this exists to catch.
- **The meeting the promise was made in does not count as hearing of it again.**
  A Zoom note becomes one corpus entry per paragraph, so the paragraphs after
  the promise are all stamped later than it: without this, a promise glanced off
  two lines below itself reads as followed up.
- **The trigger is a meeting having run since**, not a day count. A stand-up is
  where this should have come up, so a stand-up passing it over is the event.
- **`DF_MAX_SHARE` is raised when in doubt, never lowered.** A missed follow-up
  fires at somebody who has been chasing daily; a spurious one only keeps us
  quiet. It is tuned to prefer silence — and it does not discriminate as well as
  it looks: on the fixture, "chase the vendor sandbox" reads as followed up
  because eight records say *"ORB-XXXX is still blocked on the vendor sandbox"*
  about eight unrelated tickets. It failed SAFE, which is the design, and it
  must not be quoted as evidence the rule is precise.
- **`MIN_LIVE_SURFACES` is the "we do not know" guard.** Without it the detector
  fires hardest on a programme whose collectors have stopped running — nothing
  has been said since because nothing has been *read* since.
- **The corpus is opt-in** (`GatherOpts.corpus`). The gather already reads every
  Slack message, transcript paragraph and Confluence page and indexes only the
  keyed minority; `/api/work` must not start paying to materialise the rest.
  `CorpusEntry` keeps tokens, not bodies.
- **The DF index is memoised on `graph.generatedAt` ALONE.** The corpus is the
  derived tier and only a collector run changes it. Keying it on the event log
  would tear it down every thirty seconds under the canvas poll — the documented
  anti-pattern that once left a screen on "Loading…" for ever.

**`vault.create()` used to stamp `createdAt: now`, discarding the draft's own.**
`seedNotes` copies the fixture's claims through that path, so a promise made in
June arrived in the vault dated the moment the gateway booted — and
`dropped_commitment` measures from `createdAt`, so on a freshly seeded vault
every promise had been made "just now" and the detector could not fire at all.
A supplied date wins now; `now` is still the default for a note written by hand.

**`accept_proposal` is a chain of `if` blocks with NO default**, so
`link_commitment` needed a branch or accepting it would settle `accepted`, write
nothing and report success — the failure `update_issue`, `link_issues` and
`post_message` already shipped with. Its Jira comment is provenance rather than
the effect, so a comment failure is reported as such: the vault write has
already happened, and saying *"nothing was written"* when the alert has stopped
firing is the same class of lie as claiming a success that did not happen.

**`askProposal` no longer hardcodes `channel: 'eng-payments'`.** That is the
fixture's own channel; pointed at any other programme it drafted a message to a
channel that does not exist. The channel comes off a Slack evidence label
(`#channel — author`), and when nothing resolves the field is **omitted** rather
than guessed.

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
- **"Days in this status" has TWO bases, and `statusAgeOf` owns the choice.**
  `measured` comes from one `buildTimeline` over the durable log, indexed by
  key, over the same `TRAIL_DAYS` window the dossier uses — which is why
  `issue.ts` exports it. `bounded` comes from `StoredIssue.updatedAt` and reads
  *"at least 31 days in development — last touched 2026-07-26"*.

  **The second basis exists because the first is structurally dead on live
  data.** No collector writes an `events.jsonl` — `import-programme-graph.mts`
  writes `graph.json` and nothing else — so `buildTimeline` has nothing to
  measure until the Jira webhook and the scheduled re-derive have been running
  for weeks. Measured: `fixtures-programme` yields 16 findings, and the same
  directory with `events.jsonl` removed (which IS the live shape) yielded **7,
  with every `aging` row gone**. The detector was not degraded, it could not
  fire at all, and nothing anywhere failed.

  **`updatedAt` was correctly rejected as an ESTIMATE and is honest as a
  BOUND**, and the distinction is the whole of it. Every event that moves
  `updatedAt` — a comment, a field edit, a rank — moves it *forward*, which
  makes `now - updatedAt` *smaller*; a status change necessarily touches the
  issue, so nothing can have left its status since. The error is
  one-directional: it can understate the wait and cannot overstate it. That is
  what makes "at least" sayable, and **the qualifier and the date must survive
  to the reader** — `statusAgeText` is the one place either is worded.

  **A lane that disagrees with the graph is discarded, not preferred.** The
  collector re-read the ticket this morning; the log stopped at whatever webhook
  last arrived. Five of twenty-seven lanes disagreed on `fixtures-programme` and
  two shipped as findings naming a status the ticket was not in — `HLX-1704`
  read *"16 days in backlog"* against a last transition into `In Development`.

  **`buildTimeline` takes a `mapStatus` and abandons a lane it cannot read.**
  An event payload carries the workflow's own word and no `statusCategory`, and
  this used to cast it straight to `WorkItemStatus`. Pass `lookupStatusWord`
  (exported from `@mc/connectors`, the map lookup alone — no category fallback,
  no `'todo'` default) at every call site; `workOpts` does it for the two that
  matter. The *whole lane* is dropped rather than the one event, because
  skipping it silently merges the segments either side and overstates the age.

  **`DEFAULT_AGING_DAYS` is per column, and `null` means never.** This is
  `aging`'s precision gate, as `owner && dueAt` is `missing_ticket`'s. A single
  `AGING_DAYS = 7` shipped *"16 days in backlog"* as a live alert — a backlog
  item ageing is what a backlog IS. `MC_AGING_DAYS` replaces the table, loaded
  by `loadAgingDays` in `graph-source.ts` on exactly the `MC_STATUS_MAP` rules:
  merged over the defaults, unknown key rejected loudly, unreadable file refuses
  to boot, and deliberately not inside `MC_GRAPH_DIR`.

  A ticket with neither basis gets no `ageDays` and claims no aging signal —
  "we do not know" beats a fabricated zero.

- **`flowEfficiency` is `null` when the log cannot express waiting.** It divides
  active by active-plus-waiting, so a workflow that never records a review or
  blocked transition yields 1.0 — *"100% of its measured life was active work"* —
  about a programme nobody measured. `fixtures-programme`'s log moves between
  `Backlog`, `In Development` and `Closed` only, so all twenty-seven lanes would
  have claimed perfect flow. Asked once over the whole timeline, because it is a
  property of the LOG'S VOCABULARY and not of any one ticket.

- **`firedAt` on an aging finding is when it crossed its threshold.** The
  generic `row.lastActivity ?? Date.now()` is wrong here in a way that disables
  ranking entirely: `lastActivity` is the newest thing anybody *said*, and a
  ticket nobody has mentioned is precisely the aging case — so it was
  `undefined` for all seven findings and every one carried the same
  `Date.now()`. `rankFindings` sorts oldest-first inside a severity, so a
  41-day ticket could not outrank a 16-day one.

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

**When the answer is a shape, the chat draws it — and the reason it usually did
not was that the agent was never told the shape.** `Answer.tsx` renders a
```chain fence as the preview's `.inline-graph`, the CSS has been there all
along and `agent.ts` asks for the fence. But `ContextEnvelope.finding` was
`{id, kind, claim}`, so on a cycle alert the model was told *"4 tickets are
waiting on each other"* and not **which four or in what order** — while
`Finding.impact` had carried the ordered walk the whole time
(`in a dependency cycle — A → B → C → D → A`, built once in `work.ts` and copied
by `findings.ts`). It could go and look with a tool call, and against a prompt
saying *"be concise, lead with the answer"* it mostly did not. `impact` rides in
the envelope now, filled by the browser — `AskInline` was handed that exact
`Finding` by the gateway, so there is no second source for it to disagree with,
and filling it server-side would mean a findings pass on every alert-scoped turn
that the `if (!env.finding)` guard exists to skip.

**The fence parser was strict in ways that failed silently, and each one turned a
diagram into a sentence.** Four backticks — which models emit to nest a fence —
matched the *closing* test, opened nothing, and both marker lines vanished, so
the chain fell through as a paragraph reading `A -> B -> C`. `-->`, `=>` and the
en-dash arrow each collapsed the whole walk into one node. `[MISSING]` and
`[at risk]`, had they been accepted verbatim, would have produced
`class="node MISSING"` and `class="node at risk"` — matching nothing, with the
tag stripped out of the label as well, so the one node worth looking at rendered
identically to the others; the tag is lower-cased, hyphenated and checked against
the two classes the stylesheet actually draws. A caption is line one **only when
it has no arrow and a later line does** — both halves matter, because "no arrow
here" alone turns a one-line chain into a caption with zero nodes and an empty
box. And a node is trimmed of a trailing separator: asked for `key · state
[tag]`, a model with no state writes `ORB-1620 · [at-risk]`, and taking the tag
off leaves punctuation promising a word that is not coming.

**The reader's own turn is on the right, in the composer's box.** `.turn.you`
swaps the grid template and places both children on row one — `direction:rtl`
gets the columns right and reorders the bidi run with them, putting a question
mark and a ticket key in the wrong place, and placing only the badge leaves
auto-placement to drop the body to row two so the turn doubles in height instead
of moving. `justify-self:end` is what makes a short message hug the right and a
long one stop at its measure.

The box carries `--app`, and the fill is not optional: `.cited` and
`.inline-graph` are both `--sunk`, and the inline thread sits inside `.ask`,
which is `--sunk` too — an unfilled box there puts a `--sunk` citation pill on a
`--sunk` ground and the citation disappears. **Never `text-align:right`**: the
block is right-aligned and the text inside it is not, or every wrapped message
ragged-lefts and the list markers `padding-left:18px` puts on the left hang out
into the margin.

**`<code>` in an answer needed a rule and did not have one.** The preview has
`.quiet code` and nothing else, because none of its fixture answers use a
backtick; the app's agent quotes field names and ids in them constantly, and
every one rendered in the UA's `monospace` at full size — a different typeface
from every other mono thing on the page, one size too big, mid-sentence.

**Every inline node is keyed on its offset in the WHOLE answer.** It used to be
the offset within whatever substring the recursion was looking at, and the tail
restarts at zero, so siblings collided: React logged *"two children with the same
key"* on essentially every answer and warned they "may be duplicated and/or
omitted". An absolute offset is unique by construction and stable across the
re-render each SSE frame causes, so a streaming answer reconciles instead of
remounting text somebody is part-way through reading.

**A ticket key is a link to its record, and never to a vendor.** `Answer.tsx`
holds the rule: a key in an agent's answer links to `/record/jira/<key>`, which
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

