# Known gaps

An honest inventory of what is broken, approximate, or deliberately unfinished.
Written so the next person does not have to rediscover it — and so nobody
mistakes a scaffold for a product.

Verified against the tree, not recalled. Where something is a *decision* rather
than a defect it is in the last section, because the difference matters.

---

## 1. Correctness and data integrity

### A commitment note written before `zoomEvidence` cites without linking

**The fix is forward-looking, and the notes already in the vault do not get it
retroactively.** `Evidence.ref` is what makes a citation a link — `quote` is
not — and five sites in `skills.ts` and `tools.ts` built zoom evidence by hand
with a quote and no ref. So the flagship alert named a meeting, showed the
sentence somebody said, and clicking it did nothing.

It is one helper now (`zoomEvidence` in `format.ts`), so a sixth citation cannot
reintroduce it. But a note is a *stored* record: measured on the live vault,
**all 18 missing-ticket alerts are backed by notes written before the fix and
still carry no ref**, while the 8 notes written after it do — and those 8 will
not fire until their sprint closes, which is the trigger working as designed.

There is no migration and deliberately so. A ref is `{surface, id, at}` where
`at` is a paragraph index into a specific recording, and the only thing that
knows it is the extraction run that produced the note — reconstructing one from
the stored `label` means parsing prose, which is the thing `ref` exists to avoid.
The honest options are to leave them (they degrade to a sentence, which the
interface already has a meaning for) or to delete and re-run those ceremonies,
which mints new note ids and therefore new finding ids. Neither is free; pick
per note rather than in bulk.

### `Ask someone` named nobody, said nothing, and was often the same button twice

**Fixed.** Four separate defects behind one complaint — *"'Ask someone' — who am
I sending a message to, what message am I sending?"*

**Nobody.** `post_message`'s payload was `{channel?, text}`. There was no
recipient field at all, so the result strip's *"addressed to the people in the
records above"* was a sentence in the interface over a body that named nobody.
`askAudience` in `@mc/domain` derives them from the records and from nowhere
else — Slack labels are `#channel — author`, a promise carries its `owner`, a
ticket its `assignee` — and `FindingDetail.audience` carries the answer, so the
buttons name the same people before the click that the draft names after it.
Empty is a real answer and the lead says it out loud: *"to nobody yet — nothing
in the records names who to ask."*

**Nothing.** The strip said *"Drafted. Read it before it goes"* and then printed
a citation COUNT. The draft itself was never rendered anywhere in the app, so
the one instruction it gave could not be followed. Worse, the count's sentence —
*"the meeting, the rationale and the records it was read from"* — is
`create_issue`'s, printed over a Slack message that has no meeting. The message
is now shown verbatim, one line per line, because the `>` quotes are Slack's own
syntax and joining them into a paragraph would show something other than what
would be posted.

**The same button twice.** `primaryProposal` returns `askProposal(f)` for
`cycle`, `disagreement`, `suspect_link`, `aging` and `dropped_commitment`, so on
five of the eight kinds the second button re-pressed the first. Where the records
name more than one person the two are now different acts — all of them together,
or one of them alone — and where they do not, the lead says they coincide. See
`DESIGN.md` §9 for why the preview's own answer (`Open MC-102`) is not available.

**One template for every kind**, which asked a question that did not apply.
Measured on the flagship alert, over a single Zoom quote:

```
Esme Ellis to chase the vendor sandbox was never filed.
> Esme Ellis to chase the vendor sandbox. — Orbit Daily Scrum 2026-06-18
Which of these is current?
```

"Which of these" refers to nothing. `askQuestion` is per-kind now — the question
is the only part of the message a person actually answers, so it is the one part
that cannot be generic.

**And the channel it named was not the channel it would have used.**
`accept_proposal` reads `payload.channelId`; `askProposal` wrote
`payload.channel`. So accepting a draft the page said was going to
#orbit-delivery would have posted it to `SLACK_DEFAULT_CHANNEL ?? 'C-mc'`. The
audience carries both now, because they are different strings and the app needs
each: the name is what a reader recognises, and `SlackConnector.post` takes the
id.

**Still open.** On an alert where only one person is named, the two ask buttons
genuinely do draft the same message and the lead admits it rather than hiding
it. The fix is a second act that is not an ask, and the preview's is a Jira
write — pinning both records on the ticket — which is a feature rather than a
correction.

### People were addressed by their login everywhere a person appeared

**Fixed.** The graph has carried `displayName` beside `handles.slack` on every
person node since the identity map was built — Slack's `users.list` has
`real_name` and `import-slack-messages.mts --users` merges it into the person
Jira wrote — and nothing read it. `buildIdentities` indexed every alias, and
both of the questions it could answer (`resolve`, `canonical`) come back with a
HANDLE, which is right for joining and wrong for reading. So an alert said
*"#orbit-delivery — jonas.jost"*, a button said *"Ask hugo.hart"*, and a drafted
message opened *"jonas.jost, cleo.calder —"*.

`Identities.nameOf` is the third question, and `personName` in `graph-source.ts`
is the one function every display site calls, so "we show names and join on
handles" is a fact about one place rather than a convention nine call sites are
expected to remember. It is memoised against the graph OBJECT, so a collector's
re-derive invalidates it by identity and a per-message lookup does not walk every
node.

It falls through to the identifier when nobody is known, and `nameOf` returns
`undefined` rather than the handle so a caller has to make that choice — a name
we do not have is not a name to invent. The `label` fallback is skipped when it
is just the handle or the email again, for the same reason.

**And the first version of the name test rejected everybody on `fixtures/`.**
It skipped the display name whenever it matched ANY entry in `handles`, meaning
to catch a `label` that is only the login back again. On that graph a Zoom handle
IS a display name — `handles.zoom` is literally "Sanjay Rao" — so six of six
people were indexed with no name and the front door went on printing
`sanjay@example.com`. Silently, because falling through to the raw identifier is
this function's designed behaviour when it does not know somebody, so there was
nothing to notice. The test is against the CANONICAL handle now, which is the
one that is a login by construction. Found by running the other fixture; the
programme one has `handles.slack === handles.jira === the login` and passed
either way.

**Changed at the display sites only.** `m.author`, `item.assignee` and
`cm.author` stay handles everywhere they are compared — `classifySignalFor`, the
lane's assignee filter, `?assignee=`, the identity map itself — because they are
join keys. One consequence worth knowing before a live Slack connector sends a
draft: a name in the body reads correctly and does not NOTIFY anybody, and the
way back to `<@U…>` is `Identities.canonical` on the same map.

The seeded demo conversations froze the old wording in `localStorage`, so
`demo.ts` gained a `SEED_VERSION`: a history of nothing but `demo-` rows is a
previous vintage and is replaced, and anything else is a conversation somebody
had and is never touched.

### The commitment alerts said the sprint twice

**Fixed.** `missing_ticket`'s impact was three clauses and the middle one
repeated the last: *"Taken by Esme Ellis, with no date given · checked against
Orbit 29's close · Orbit 29 has closed and no issue references it"* — the sprint
twice, its closing twice, wrapping to two lines under each of six near-identical
rows on the front door. A line that reads as boilerplate is a line nobody reads,
which costs the alert the one sentence that explains it.

Two clauses now, the container named once, and the owner by NAME rather than
whatever the meeting called them — on a real graph, an email. The
inherited-date distinction survives the cut and had to: an inherited date never
reaches `crit`, because "Sanjay said the twelfth and it is three weeks past" is
a stronger claim than "nobody gave a date and the sprint has closed". `no date
given` beside the container's close says exactly that without spelling out the
arithmetic.

`dropped_commitment` lost its surface list for the same reason — *"with nothing
on Slack, Confluence or a later meeting naming it"*, in those words, every time,
while the row already carries a dot per surface the finding was read from. And
the due date stopped being an ISO stamp: `shortDate` writes `Aug 12`, which is
how every other date in this interface is written.

### Every alert with a conversation opened part-way down itself

**Fixed.** Clicking a row on the front door landed ~420px into the alert, at
whatever sentence the last answer ended on, with the claim and the evidence
above the fold; coming back from a citation did the same. It reads as the router
forgetting to scroll and it was one component lower: `Turns` in `Thread.tsx`
takes `scrollOnGrow`, and its effect fired on MOUNT as well as on growth, so an
alert that already had an inline exchange scrolled itself to the bottom of it.
Seeding demo conversations is what made it happen on every alert rather than the
few somebody had used.

The effect records the previous length and only scrolls when it increases, so
the tail of a thread you already had is where the page starts rather than where
it jumps to. Two things went in beside it, because the browser's default is
wrong here for a second reason: `history.scrollRestoration` is `manual` now, and
`AlertApp` scrolls to the top on every address change — keyed on the whole
address, since `at` collapses every record to one key and two citations opened
one after the other are two pages. The record view's scroll to its cited line
runs when the fetch resolves, after that one, so it still wins.

### A cycle's four citations said Miro, opened nothing, and repeated the impact

**Fixed.** The rows were built in `work.ts` with `surface: 'miro'` hardcoded and
no `ref`, which was wrong twice over. Wrong about the surface: every path that
reaches a finding sets `arrows` from `projectArrows` over the graph's
`depends_on` edges, so on a programme with no board at all — `/api/health`
reports `miro: mock` — four rows claimed Miro. And wrong about being unopenable:
four grey sentences restating the walk already printed in the impact line, with
nothing to click, which is a citation block asking the reader to take our word.

Each row now cites the ticket that WAITS — a real record, and the place somebody
goes to remove the link, which is the only act that breaks a loop. Same shape as
the aging signal's own row a few lines above it: our observation in the label,
the Jira record in the ref. `Evidence.ref`'s doc comment used to give a cycle's
arrows as its example of "nothing to open"; it now says what changed and why.

If the lane is ever fed `boardArrows` — a live Miro canvas — the label becomes
Miro's account of the arrow while the citation stays the ticket. Still true,
still the right place to act, and the first assumption to check if these rows
start looking wrong.

### The action was three bands below the sentence that stated the problem

**Fixed, narrowly.** *"If it says 'no ticket', I would be able to open a ticket
right there."* The checklist's cross is where the problem is named and the button
that answers it was two bands and a scroll away, so the `no ticket` cell is now
`no ticket · file it →` and presses the same primary action. The row grows no
second result surface: `Actions` reports it where it always does, and scrolls
there, because the reader is up at the checklist and the answer arrives below.

**Only on the row the alert is about**, and that guard is the whole reason this
needed a gateway change. The checklist is every promise made in the container and
several can be untracked at once — Orbit 32 has three — while the primary action
files a ticket for THIS finding's note whatever was pressed. Without a flag, an
inline button on the third row would have created the first row's ticket and
reported success. `FindingDetail.checklist[].subject` is set from the note id, not
matched on the title, because two promises in one sprint can be worded the same.

Two things fell out of testing it, both older than the button. The strip drew a
green panel and a green tick over *"That did not go through: blocked by safe
mode"* — `ActionResult.failed` now carries the refusal and `.result.failed`
wears the severity it is, which is `DESIGN.md` §1's rule that every colour means
something. And the scroll was written in the `then` of the call, where the block
it scrolls to has not mounted yet; it is an effect on `result` now.

### Seventeen date bands for seventeen messages

**Fixed, and the first fix was the wrong one — worth recording because it is the
kind that looks right in the diff.** `dayMark` draws the day as its own row
rather than squeezing it into the 74px stamp, which is right whenever a day
holds several messages and pure cost when it holds one. This fixture's Slack
channel is one message per day for seventeen days, so the record page was more
band than message, with the date on one row and the clock it belongs to on the
next.

The first attempt drew the band **only where a day grouped more than one line**
and folded `Fri 14 Aug` into the stamp everywhere else. It halved the height and
it was wrong: Slack itself breaks a channel by day and puts only a clock on each
message, and a date repeated on every line is precisely what the divider exists
to avoid.

So the divider is back on every day change, and what the crowding actually
wanted is a divider that costs a **hairline rather than a band** — the date, then
a rule across the rest, which is Slack's own day break in this app's own
vocabulary. 31px down to 21px, and it now separates rather than merely labels.

The label sizes itself and carries `white-space: nowrap`. Pinned to the 74px
stamp column it lined up prettily with the clocks and then wrapped — "MON, JULY
20" is ~78px at 10px mono with this letter-spacing, so every divider became two
lines and read as broken. The column width is not ours to guarantee; the month's
name belongs to the reader's locale.

A Zoom transcript is unaffected and draws none: its lines carry an offset rather
than a wall clock, and a meeting is one day by construction.

### A deferred alert became one of its own sources

**Fixed, and worth knowing because it was invisible by construction.** `act.ts`'s
`defer` writes `relatedKeys: [f.subject.key]` on the note it creates, and
`gatherWorkFacts` folded every vault note joined to a key into the ticket's
trail with a `signal` read off its body. So parking a work-item alert made the
reader's own note a source about that ticket, and `findContradictions` — which
reads the trail — could pick it as one of the two disagreeing voices.

Measured on the demo data, with a note whose body ended *"the schema change
either landed or it did not"*:

```
“idea — ORB-1627 is called done and not done” says done,
“#orbit-delivery — jonas.jost” says not — 1 day apart
```

The alert quoted the note back as evidence for itself and displaced the Slack
message that actually made the claim. Nothing failed, and it is unobservable
until the reminder lapses — a live deferral suppresses the alert — so it
surfaces at the moment somebody has forgotten writing the note.

The trail now skips any note carrying `about`, which is set only by `defer` and
means "this is my handling of an alert" rather than anything said about the
work. Notes written about the work itself carry no `about` and are unaffected.

### `Open the alert` on a parked note was a dead link while its deferral ran

**Fixed.** Reproduced against `fixtures/`, on a throwaway vault:

```
POST /api/findings/aging:PAY-9024/act  {"action":"defer","until":"2026-09-30"}
GET  /api/findings/aging:PAY-9024   ->  404
```

`runFindings` drops what a human has already answered, which is right for the
front door and wrong for a direct address — and `findingDetail` read through the
same call, so an alert you deferred could not be opened at all until the
reminder lapsed. The note that deferring creates carries `Open the alert`,
`DESIGN.md` §4's one ACROSS link and the only route from a parked note back to
what it is about, so it landed on *"That alert is not there"* for exactly the
notes it exists for, with a perfectly good id in the address.

**A list filters; an address does not.** `FindingsInput.includeAnswered` is
opt-in — a new route that forgets it gets the safe behaviour — and
`findingDetail` is the one caller that sets it. The same distinction the vault's
decay model already draws, where a stale note still answers an explicit lookup
and only stops being volunteered.

A page that opens for a suppressed finding would then have silently contradicted
the list it is missing from, and offered *Not now* on something already put
away, so `FindingDetail.answered` carries the standing decision and the alert
page states it beside the fired line — `Parked until 30 September`,
`Parked — nothing brings it back until you ask` for an event-based reminder, or
`Dismissed — you said this was not needed`. It is absent the moment a deferral
lapses, because the alert is back on the list and the page has nothing to add.

`Answer` gained a `dismissed` flag to make that sentence possible: `forever` is
set by a dismissal **and** by a dateless deferral, which is right for
suppressing and useless for saying which of the two happened.

**And the same cause had a second symptom**, closed the same day. `Chip` in
`Later.tsx` looks a note's alert up to draw its kind and severity, and it looked
in `/api/findings` — the list — so a row could not name the alert it was parked
from for as long as the deferral ran, which is the whole life of a parked note.
`/api/findings` now answers with two arrays: `findings`, unchanged and still the
list, and `parked` beside it. Nothing that reads `findings` changed behaviour,
which is the point — folding the suppressed ones inline with a flag would have
moved "a dismissal stays gone" from one place to every consumer. See
`runAlertFindings`.

A neutral `Alert` chip is still what a row gets when its alert has stopped
firing altogether — the ticket was filed, the loop was broken — and that is the
honest answer rather than a fallback: the note outlives the finding, and there
is no kind left to name.

### `typecheck:all` skipped `@mc/vault` entirely, and nothing said so

**Fixed, and worth knowing because the mechanism is invisible.** `.gitignore`
carried `vault/` — the runtime notes directory, correctly ignored. A gitignore
pattern with no leading slash matches a directory of that name at **any** depth,
so it also matched `libs/vault`, the library.

Git was unaffected: ignore rules do not apply to files already tracked, so
`git status` was clean, every file was committed, and `git check-ignore` reported
the library as *not* ignored. **nx** resolves the pattern against the filesystem
instead, so `@mc/vault` was never in the project graph — and
`npm run typecheck:all`, the check this repo calls authoritative and the only one
that applies `types: []` to the platform-neutral libs, ran five projects while
claiming six.

The root `tsc -b` includes `libs/**/src/**/*`, so the library was never
*unchecked* — which is exactly why this never surfaced as an error. It passes the
strict check now that the check runs. The fix is one character: `/vault/`.

The general shape: **an ignore pattern is a namespace, and an unanchored one is a
collision waiting for a directory to be named the same thing.** The same rule
this repo already records for CSS class names and for `GraphNodeKind`.


**The raw event log grows without bound.** `LOG_LIMIT` in
`apps/gateway/src/events.ts` caps the *in-memory* log at 5,000. Nothing caps
`vault/raw/events.jsonl`. It is append-only and never rotated, and proposals now
write their whole payload into it. At one user's rate this is fine for a long
time; it is not fine forever.

**`readEvents` parses the entire log on every call.**
`libs/vault/src/store.ts` reads the whole JSONL, `JSON.parse`s each line, then
filters in memory — `since` and `limit` reduce the *result*, not the I/O. This
runs on every scheduler tick (60s), on every status change that reaches
`surfaceMemory`, on every skill run, at boot for proposal rehydration, and on
**every findings request**, which is the front door. The dossier reads it
unwindowed on top of that, deliberately, because `originOf` needs a filing date
that may predate the 90-day trail. At 25 lines it is free. At 100k it is the
first thing that will hurt, and the front door is where it will show up first.

**A status summary costs a real model turn, and nothing warms one.**
`apps/gateway/src/summary.ts` writes on demand only, reachable from
`inspect.mjs summary` and curl: the first write is typically 20–60 seconds on the
CLI provider, cached on the brief's fingerprint. There is no queue and no
priority. Nothing on screen reads a summary, so nobody waits on it today — **the
moment a screen does, this is a live gap**, and the thing to warm is whatever
that screen opens on.

**A summary invalidates on anything, including things that did not change it.**
The cache key is a hash of the whole rendered brief, so a Jira comment, a new
Slack line or an arrow drawn on the board all discard a summary that may have
been perfectly current — and the next open pays a turn again. That is the right
side to fail on (a stale read presented as current is worse than a slow one) but
it does mean a chatty ticket is never cached for long.

**`claude-cli.ts` drops conversation history after a gateway restart, and it is
the only provider that does.** Continuity there is a `resume` session id held in
an in-memory `Map` keyed by thread — and `ask()` never reads `thread.history` at
all. The other two both handle the cold case: `claude.ts` builds its `messages`
array from the history every turn, and `copilot.ts` replays
`renderHistory(thread.history)` on the first turn of a session, with a comment
naming this exact scenario — *"a resumed chat (or one that outlived a gateway
restart) has turns this session never saw"*.

So after a restart — and `tsx watch` restarts on every save — resuming a
conversation shows its full transcript, the browser dutifully posts the last
`HISTORY_TURNS` (6), `claude-cli.ts` discards them and starts a fresh CLI
session. Ask "and who owns that?" and the agent does not know what "that" is.
It reads as the model being stupid rather than as lost state, which is what makes
it expensive to diagnose.

This is the same one-sided asymmetry as the `zodShape` nesting bug: correct on
the Messages API path, broken on the CLI path, and the CLI path is the default a
fresh checkout uses. The fix is to mirror `promptFor` — when there is no `resume`
id but `thread.history` is non-empty, inline the transcript once.

**Nothing evaluates an event-based reminder.** "Not now" accepts a named watch
as well as a date — "when the sprint ends", "if anything changes on it" — and
`act.ts` stores the string it was given, because inventing a date for it would
be a certainty the reminder deliberately does not have. `suppressedIds` then
holds the finding indefinitely, and `Later` renders the watch as itself. Nothing
ever fires one: a finding parked on an event comes back when somebody opens
Later and asks for it, and not before.

**A superseded thing kept alive by one fallback is more dangerous than dead
code**, because the fallback runs somewhere. `seedHistory` used to fall back to
generated `HISTORY` tables when no `events.jsonl` shipped beside the graph —
never true of our fixture and **always** true of a real collector, so the only
path it could ever run on was the live one, where it wrote 431 transitions for a
programme that does not exist. It reads `events.jsonl` and nothing else now.

**~~A Slack citation with no channel scans every channel.~~ Fixed.**
`firstChannelHolding` in `apps/gateway/src/records.ts` walked the channel list
calling `listMessages` on each until one held the timestamp — O(channels ×
messages) and a round trip per channel. Every citation the app produces carries
`parentId`, so nothing took it; it was a cliff waiting for the first caller.
`channelHolding` asks the graph instead, one pass over `projectMessages`, from
the same source the Miro branch beside it already reads for the same reason.

**A record renders whole.** `readRecord` returns every line of a channel or a
transcript and the view marks one. At fixture size that is seven lines; a real
`#eng-platform` is thousands, and nothing windows it. The cited line is found and
scrolled to, so the page works — it just downloads and renders a year of
messages to show you five.

**~~And the front door's read cannot be windowed.~~ Still true, and no longer
per-request.** `suppressedIds` takes the whole log with no `since`,
deliberately: an alert list is a promise that a decision made yesterday is still
made today, and a window would silently expire dismissals. So the fix was never
a narrower read — it is an index of answered findings, which is what
`answeredFindingIds` in `act.ts` now is.

Three things make it safe, and the third was a regression the fix introduced:

| | |
|---|---|
| the **decisions** are cached, never the resolved set | a deferral expires with the clock rather than with an event, so `until` is compared per call and a parked finding returns on time with nothing to trigger it |
| appends fold straight in | `indexAnswer`, on the `eventLog.subscribe` in `main.ts`, so answering an alert costs no re-read |
| **deletes drop it** | built from appends, an index cannot see a *removal* — measured: dismissing a finding and then deleting the dismissal left it hidden until the next restart. Both log-delete routes call `forgetAnswered()` now |

One rule, one fold: `suppressedIds` and the index share `foldAnswer`, so the
whole-log read and the incremental one cannot drift. The tricky orderings are
why — *any* deferral still in the future suppresses, whatever was written after
it, which is why the index keeps the furthest-out date rather than the last one.

**~~The Copilot structured-output backend returns `{}`.~~ Fixed — it was the
token, and then it was the ladder.** `askCopilotStructured` in
`apps/gateway/src/copilot.ts` is written, typechecks, and now answers: measured
`OK` in ~3.5s against a nested schema. Two things stood in front of it, and both
are the same shape — an auth gate reporting success while the turn fails:

| | |
|---|---|
| a **personal access token** in `GITHUB_TOKEN` | Copilot's endpoint refuses it — `Personal Access Tokens are not supported for this endpoint` — while `start()` and `getAuthStatus()` both pass, so the provider reported itself live and only real turns failed. `copilotToken()` deny-lists `ghp_` / `github_pat_` and returns `undefined`, restoring `useLoggedInUser` and the OAuth token the endpoint accepts. Deny-listed rather than allow-listed: GitHub adds token formats, and discarding a *working* future credential is the worse failure |
| `claudeCliAvailable()` read `subtype` alone | a logged-out CLI yields `{type:'result', subtype:'success', is_error:true, result:'Not logged in'}`. So the probe said yes, `MC_STRUCTURED=auto` picked `sdk-mcp` as the first *available* backend, and every structured call failed on a machine where Copilot had been working all along — for up to 24h at a time, because the answer is cached. It reads `is_error` too now |

The second one is the more general lesson and `streamReply` had it as well:
**this SDK's `subtype` is not a verdict.** `npx tsx scripts/probe-mcp.mts` is
the check, and it deliberately treats "has a credential and answered wrongly"
as the failing case while an absent credential is not.

This is the same shape of gap `copilot.ts` already carried for the chat provider
and for the same reason: no GitHub credential has been available on any machine
this has been developed on.

**Nothing ages summaries out of the cache file.** `vault/raw/summary-cache.json`
accumulates an entry per distinct brief, and a ticket that changes ten times
leaves ten. It is small and gitignored, and it has the same shape as the problem
`inference-cache.json` and the raw event log already have.

**~~`ageDays` was `updatedAt`, not a measured status age.~~ Fixed.**
`apps/gateway/src/work.ts` used to read "days in this status" off
`WorkItem.updatedAt`, which is "last touched anything" — a comment, a field edit,
and in mock mode a value stamped at boot. It was wrong on every row and in both
directions: `/api/work` claimed MC-103 had been in todo for 0 days while the
dossier said 14, so the `aging` signal never fired on the ticket it exists to
raise, and it claimed 24 days for MC-94 where the truth was 19.

It now runs `buildTimeline` once over the durable log and indexes the lanes by
key — the same function and the same 90-day window (`TRAIL_DAYS`, exported from
`issue.ts` for exactly this) the dossier uses, so the two cannot disagree.
Verified: `/api/work` and `/api/issue/:key` both report 14d / 8d / 19d for
MC-103 / MC-102 / MC-94. A ticket with no transitions in the window has no
`ageDays` and claims no aging signal, which is the honest answer rather than a
fabricated zero.

**`/api/work` only knows people who have work in the active sprint.**
`WorkLane.people` is derived from the sprint's assignees, and `?assignee=` falls
back to the busiest person when the name is not in that list — so asking for
somebody whose sprint items are all closed, or who is only on backlog work,
silently answers with a different person's lane. There is no directory here and
no login — see §6 — so a real user list has nowhere to come from yet.

**The proposals map is never pruned.** `proposals` in
`apps/gateway/src/tools.ts` accumulates every proposal ever made, and
`rehydrateProposals` replays all of them at boot. Settled ones are kept
deliberately — the dedupe map needs them and ids must not collide — but nothing
ever ages them out.

**~~Vault writes inside multi-note operations are only partly evented.~~ Fixed.**
`promote_to_pattern` and `merge_notes` each rewrite the notes they fold together
and used to emit one event for the *result* only, so the log said "a pattern
appeared" without saying "and these three notes changed". Both now emit a
`note.updated` per rewritten note, carrying which operation did it
(`by: 'promote_to_pattern'`, or `mergedInto` + `archived: true`). Verified: a
two-instance promote writes `note.updated` × 2 alongside `pattern.detected`.

**`buildTimeline` approximates the first segment.** When the first event for a
ticket is a change *out of* some status, the lane opens a segment at the window
edge with that status. It is the honest reading of incomplete history, but it
means `activeDays` / `waitingDays` for a long-lived ticket are lower bounds, not
measurements. Flow efficiency inherits the approximation.

**~~A starter question's numbers can disagree with the timeline they are drawn
from.~~ Fixed.** `suggest.ts` built its lanes over a fixed 21 days whatever
window it was asked about, so a suggestion could quote an age nothing else
agreed with — the class of disagreement `byConcern` exists to prevent, arriving
through the window rather than through the ranking.

`suggestQuestions` builds its lanes over exactly the window it is handed
(`lensDays`), so agreement is structural rather than coincidental. **Any
consumer that derives a number from the timeline has to derive it over the same
window**; that is the rule, and it holds for whatever reads the timeline next.

The gather was split to make this cheap: everything that costs network
(`listConnectors`, stickies, pages, the newest recording) is window-independent
and stays cached across a window change; only `buildTimeline` re-runs, filtering
already-fetched events in memory. Changing the window costs no I/O.

Verified against MC-102: at 7d the timeline reports 7 waiting / 7 active and the
suggestion says "7 days waiting and 7 days being worked"; at 14d and 30d both
say 11 and 2. `node scripts/inspect.mjs suggest PAY-9031 7` takes the window
as a third argument for exactly this check.

**`stalenessOf` can return `Infinity`, and every formatter now survives it.** A
`dated` note with no `verifiedAt` (only reachable by hand-editing a file, since
`assertVaultSafe` rejects it) returns `days: Infinity`. The defect was never the
`Infinity` — it was that each formatting site had to remember its own
`Number.isFinite` guard, and `skills.ts` had two that remembered and four that
did not, so `/standup`'s open-commitments line printed `unconfirmed Infinityd`.

The guard first went inside both `days()` helpers, which fixed the symptom and
left the cause: one rule written twice, in two files, free to disagree again the
next time either was touched. There is now a single `days()` in
`apps/gateway/src/format.ts`, and the only thing the two call sites vary is the
suffix — `DayStyle` is `'compact'` for `/standup`'s table cells (`13d`) and
`'prose'` for the starter questions' sentences (`13 days`). That difference is
deliberate and is why the helpers were separate in the first place; it is now a
parameter rather than a copy. `pct()` moved with it, having been byte-identical
in both.

Every consumer is covered: the shared helper, plus the inline guards in
`renderRecalledNote` (`libs/domain`) and `surfaceMemory` (`memory.ts`), which
render their own phrasing ("a long time"). A new formatter is only exposed if it
reaches for `stalenessOf().days` without going through one of them.

**~~`stripHtml` was written four times, and had drifted four ways.~~ Fixed, into
the same file and for the same reason.** `infer.ts` and `skills.ts` each had one
and `tools.ts` had the body inline twice. All four turn a Confluence body into
prose; none of them agreed on how. Two collapsed whitespace and trimmed, one
collapsed without trimming, one did neither, and the tag pattern was `<[^>]*>`
in one place and `<[^>]+>` in the other three — so the *same* page reached the
inference prompt, the workshop pack and two agent tools as four different
strings. One `stripHtml` in `format.ts` now, replacing a tag with a **space**
rather than nothing, because `fo<b>o</b>` is one word to a reader and `foo` to a
tokeniser but a dropped tag glues `</b><b>` pairs across a real boundary far
more often than it saves a word.

`records.ts` is the deliberate exception and says so inline: it splits on
`</p>` before stripping, because a citation's unit is the paragraph and not the
body.

**~~The undo strip was written twice, and the two had already disagreed.~~
Fixed, and it was hiding a real defect.** `Ask` and `Later` each carried their
own `.undobar` JSX and their own placement rule, and `Ask.tsx`'s comment said
*"same rule as Later"* while implementing less of it. `Later` placed the strip
past the end of the list when you deleted the last row and in its empty branch
when you deleted the only one; `Ask` did **neither**, so deleting your last
conversation removed it with no offer to undo — which is precisely what
`DESIGN.md` §7 forbids, on the page where the rule is cheapest to honour.

One `UndoStrip` in `Chrome.tsx` now, and `Ask` builds its row list once instead
of rendering the same JSX in both the filtered and unfiltered branches — the
"build a shared half once and place it twice" rule, which is what let the two
halves drift in the first place. Verified in the browser rather than by
typecheck: delete the last of two, delete down to empty, undo from both, and the
row returns at its original index.

**~~The recall budget under-counts by one character per note.~~ Fixed.**
`renderContext` joins rendered notes with `\n` and the budget summed the
rendered lengths without the separators, so a full block could run a few
characters over 900. `recall()` now charges a `SEPARATOR` per note. Measured
across three questions the block lands at 846 / 896 / 899 characters against the
900 budget — packing to the edge without crossing it.

**Capture heuristics are regex guesses.** `inferKind` in
`apps/gateway/src/memory.ts` classifies a Slack message by keyword. "I'll take
the blocked one" reads as a commitment and an impediment; first match wins. And
`kind` drives recall ranking, so a wrong guess is not cosmetic. Nothing on screen
offers it either — the note page edits the title, the body and the reminder — so
correcting one means `PATCH /api/vault/notes/:id` or an edit to the file on disk.

**`/workshop` reads a meeting with the same regexes, and they over-fire on
decisions.** `DECISION_CUE` in `apps/gateway/src/skills.ts` matches "let us",
so "Let us start with where MC-102 stands" is listed as a decision in the pack.
Actions are the safer half: action cues win when both fire (a decision cue is
frequently a noun inside somebody's task — "take the decision record"), and
questions are never decisions. The asymmetry is deliberate — only actions become
proposals, so a false decision costs a line in a document a human reads before
publishing, while a false action would cost a ticket.

**Workshop reconciliation is lexical, not semantic.** `similarity()` is an
overlap coefficient over de-stopworded tokens with trailing-`s` stripped, at
0.6, or 0.4 when the two texts share a Jira key. It merges "Dana owns the cache"
with the sticky "Dana owns the dedupe cache" and will not merge either with
"Dana has the caching work" — no synonyms, no word order, no negation. Tuned to
split rather than merge: a false split shows a human two similar proposals to
reject in one click, a false merge silently loses an action item. In live mode
the model can do this better; this has to work with no LLM at all.

**A pending proposal does not update when its evidence improves.** `propose()`
returns the existing pending proposal for a `dedupeKey`, so re-running
`/workshop` after somebody adds a corroborating sticky leaves the pending
proposal carrying the first run's rationale and citations. Correct for one ask
and one decision, but the evidence a human is shown can lag the board.

**`documented` in the workshop pack joins on the key; `pageRecording` joins on
the words, and neither joins on meaning.** The pack now asks both questions —
"does a page contain this decision" (word containment ≥ 0.7 of the decision's
non-stopword tokens) before falling back to "does a page mention this ticket".
Still lexical: it cannot see a decision restated in different vocabulary, so it
will say "write it down" about something already recorded under other words.
That direction is the safe one — the cost is a page somebody re-reads rather
than a team talked out of writing the record it needed.

**Model-extracted actions are unverified against a real key.** `extract.ts`
compiles, and its output path (coerce → `reconcile` → proposal) is exercised by
the deterministic candidates that share it. No `ANTHROPIC_API_KEY` has ever run
through `createExtractor` itself, so the tool-call shape, the forced
`tool_choice` and the cache round-trip are unproven against the live API.

**Nothing produces `update_issue`, `link_issues` or `post_message`.** Their
`accept_proposal` branches exist and are correct — before this they settled and
wrote nothing, which was worse — but no code path emits one, so they have never
run. A producer needs extraction good enough to name a specific field change.
`linkItems` is also a deliberate no-op in the graph-backed Jira connector
(`libs/connectors/src/graph/index.ts`) — arrows come from the graph and a demo
write must not edit the fixture — so `link_issues` will demo as an event with
nothing behind it until a real Jira adapter exists.

---

## 2. Scale — fine on fixtures, wrong in live mode

### The front door has no cap, and two findings scale with the programme

**Measured, on a synthetic 5,000-issue Jira import: 1,108 findings.**
840 `undetected_dependency` and 268 `suspect_link`, every one of them `warn` or
`ok`, all on one page.

Performance is not the problem — the front door answered in **30ms** with 5,100
nodes and 6,666 edges, because the graph is loaded once at boot. The problem is
that `rankFindings` sorts and returns *everything*, and an alert list whose
promise is "the top row is the one to open" becomes a dashboard, which is the
one thing it must not be.

**Four of the six kinds are naturally bounded** and stay small: `missing_ticket`
is one per unticketed promise, `disagreement` one per done-claim, `cycle` one per
loop, `aging` one per stalled ticket. The two reconciliation findings are
different in kind — they fall straight out of the graph's tiers, one per edge,
so they scale with the size of the programme and the state of its link hygiene.

That is not a bug in the detector. A declared link nothing corroborates *is* a
finding, and on a programme with poor link hygiene there are genuinely hundreds.
It is a question the design does not answer: **`DIRECTION.md` §3 and `DESIGN.md`
never contemplated a finding type that arrives by the hundred.**

**RESOLVED — they moved to Sources.** `COVERAGE_KINDS` in `@mc/domain` is the
switch, and everything with an opinion about "what needs a person" reads it:
`/api/findings`, `worthSending`, and `list_findings`'s `shownOn`. The options
below are kept because the reasoning is worth having if the question reopens at
a different scale. See ROADMAP.md, "Settled — the front door floods".

Options, at the time:

| | |
|---|---|
| **group them** | one row saying "268 declared links nothing supports", opening a list. Keeps the front door honest and keeps `DESIGN.md`'s "nothing is hidden" |
| **make them `ok`** | they stop being counted as needing a person, and the front door already shows `ok` rows below the fold |
| **move them to Sources** | they are data-quality facts about coverage, which is what that page is for — and its tier counts already say `AMBIGUOUS 2` |
| **cap and rank** | simplest, and the one that breaks "nothing here is hidden" |

The third was taken.

**Check this first against a real export.** The count depends entirely on the
link hygiene of the Jira being read, which is one of the things this product
exists to expose, so it could legitimately be very large.


**`explain_blocked` and `trace_entity` fan out over everything.** Each call
lists every Slack channel and all their messages, every transcript, and every
Confluence page. On six fixtures that is instant; against live APIs it is dozens
of sequential calls per question and a rate limit waiting to happen. The fix is
a mention index maintained off the event log — `key → [{surface, ref, ts}]` — so
the joins become a lookup.

**`GET /api/jira/comments` fans out per item.** One `listComments` call per work
item. Acceptable against an in-memory mock; a live adapter wants a single JQL
query behind that route.

**The real Miro `listConnectors` costs a GET per distinct endpoint id.** Miro
returns item ids on a connector and never the Jira key, so each endpoint is
fetched to resolve one. Memoised within a call, so a board of forty arrows
between twelve cards is twelve fetches, not eighty — but it is still ~4s for the
demo board's 12 arrows, and `canvas-poll` runs it every 30 seconds. The fix is a
board-level item cache keyed on the poller's own diff.

**`POST /api/suggestions` re-gathers whenever the log accepts an event.** It
pays `listConnectors`, every sticky, the newest transcript and 21 days of events
per gather. The 60s cache makes a walk through the app one gather rather than one
per page, but the invalidation is deliberately aggressive — on a live board with
a busy webhook feed, the cache is dropped faster than it is used and every
conversation opened pays the full cost, `listConnectors` included. The fix is the same
board-level item cache the poller wants, plus invalidating on the event *types*
the rules actually read rather than on all of them.

**`upsertAppCard` lists every app card to find one.** Called on each accepted
`create_issue` and on each sync fan-out. A key→itemId map held across calls
would make it a single POST/PATCH.

**`find_duplicates` is O(n²) with full-body tokenisation.** Every pair, every
time. Fine at six notes, unusable at a few thousand.

**No retry, no outbox.** `sync.ts` writes directly. A failure becomes an
`mc.sync_failed` event and the fan-out is simply lost — there is no replay path
and nothing reads `mc.sync_failed`.

**~~The canvas poller loses arrows drawn while the gateway is down.~~ Fixed.**
Its first pass after any restart re-established the baseline in memory, so
connectors added in the gap were absorbed silently and never produced a Jira
link — no error, no missing event, just a dependency the team drew that the
system never saw.

The id set now persists to `vault/raw/canvas-baseline.json` (gitignored, beside
the other machine-generated state) and is loaded before the first tick. It is
stamped with its `boardId`, so another board cannot inherit it, and with a
timestamp: past `BASELINE_MAX_AGE_MS` (24h) it re-baselines instead, because a
baseline from three months ago would report every arrow drawn since as new and
fan out hundreds of Jira links in one tick — the same destructive helpfulness
the additions-only rule exists to avoid.

Verified end to end against the live board: drop one id from the saved baseline,
restart, and exactly one `canvas.connector_created` appears, for exactly that
arrow.

**~~The scheduler misses a slot entirely if the process is down for that hour.~~
Fixed.** It checked `now.getHours() === run.hour`, so a gateway restarting
between 07:50 and 09:10 simply never ran that day's standup — and the hour a
gateway is most likely to be restarting is the hour people start work.

A slot now stays open for `CATCH_UP_HOURS` (2) after it opens. That is only safe
because `alreadyRan` reads the durable log: the window decides when a run is
*eligible*, the log decides whether it is *outstanding*, and both must agree. A
caught-up run is marked `caughtUp` / `lateByHours` in its `mc.skill_ran` payload
and says so on the console, so "the standup ran at 10:04" is never confused with
a scheduler that has drifted. Two hours is where catching up stops being worth
it — a standup brief at 10:00 is late but readable, one at 20:00 is noise.

The rule is a pure exported `slotIsOpen(now, run)` so it can be checked against a
table of clock times rather than by waiting until 08:00; ten cases pass,
including the day boundary (at 00:30 the previous evening's 22:00 slot reads as
negative, so yesterday's tidy never fires after midnight).

Confirmed in the wild rather than only in the table: a restart at 23:13, one
hour into the widened tidy window, did **not** re-run the 22:00 pass — the log
check caught it, and exactly one `mc.skill_ran` exists for the day.

---

## 3. Security

**There is no authentication on the gateway.** `app.use(cors())` allows every
origin, and every route — including the vault write routes and
`POST /api/tools/:name` — is open to anything that can reach the port.

**"Anything that can reach the port" is now a much smaller set, and that is the
decision rather than the fix.** `ROADMAP.md` D4 settles hosting as single-tenant
on one machine inside the evidence boundary, so the gateway binds `127.0.0.1`
rather than every interface. Nothing above is *solved* by that: it is the reason
the gap is survivable, not a control. Everything here is live again the moment
somebody points `MC_BIND` at anything that is **not** loopback — which is the
case, and only that case, where the gateway prints a warning at boot naming the
absence of authentication. A bind it cannot open refuses to start rather than
reporting a URL it never listened on.

The three that remain open, and are this section's to close if the port is ever
exposed: no authentication at all, `cors()` allowing every origin, and the
unverified webhook signatures below. **Binding `0.0.0.0` to make an inbound
vendor webhook fire is the specific wrong fix**, because it trades all three
away to buy a cadence the 07:00/19:00 re-derive already covers.

**Webhook verification is optional and weak.** `MC_WEBHOOK_SECRET` is compared
as a plain header when set, and when unset every webhook is accepted. Real
Jira/Miro/Slack/Zoom endpoints sign their payloads; none of those signatures are
checked.

**`docs/HACKATHON.md` is out of the TREE and not out of the HISTORY.** It is
gitignored and untracked, so every document calling it "local only" is right
about the working tree and wrong about the repository. It is 278 lines with four
named colleagues, verbatim quotes and meeting times, and it is one command away:

```bash
git show 0fdb184:docs/HACKATHON.md    # still works from HEAD today
```

Deleting it removed it from the tree only, and **private does not fix this** —
anyone invited to a private repo can run `git log -p`.

**So publication is a lineage that starts at a squashed snapshot, and never the
original history.** The orphan commit is still the root — `publish` points at
`1a37663 "Mission Control — an alerting system that can prove itself"` — but the
work since is committed on top of it rather than re-squashed each time, on the
branch `latest-main`, which is what `origin/main` now holds.

**The rule stands, and it is about the OLD history.** `main` locally still
carries the 84-commit lineage that contains `docs/HACKATHON.md`, and it is not
an ancestor of anything published. Before any push, these four must hold:

```bash
git merge-base --is-ancestor main HEAD          # must FAIL
git rev-list HEAD -- docs/HACKATHON.md | wc -l  # must print 0
git rev-list --max-parents=0 HEAD               # must be the orphan root
git rev-list --left-right --count origin/main...HEAD   # must be 0 behind
```

**Never push `main`, or anything descended from it, to `origin`.** That is the
line, and it is not the same as "never push" — a branch rooted at the snapshot
carries none of what the rule exists to keep back, and the four checks above are
how you tell the two apart rather than remembering which is which.

Worth knowing about the numbers this section used to quote: they were a snapshot
too. It said `origin/main` was one commit and that publishing meant rebuilding
the orphan; both were true when written and neither is now. A safety rule that
has drifted from the repository it describes is the kind that gets somebody to
ignore it, so it states the CHECKS rather than the counts.

**Nothing sanitises Confluence HTML.** A page body is stored as the API returned
it, and `RecordView` renders it as text — there is no `dangerouslySetInnerHTML`
anywhere in the shell, so a live space's markup shows rather than runs. That is
the current safety and it is incidental: anything that renders a record body as
HTML needs a sanitiser first.

**Everything the agent reads is untrusted text, and the agent is now a real
model on both paths.** Slack messages, Zoom transcripts, Jira descriptions and
Miro stickies reach the model (Claude in mock mode, Copilot in live) through
tool results, and any of them can contain instructions aimed at it. Two things
are done about this and neither is complete:

- `accept_proposal` and `reject_proposal` are withheld from both providers
  (`HUMAN_ONLY` in `apps/gateway/src/agent.ts`) — the only outbound write and
  the only way to settle a decision are reachable over `POST /api/tools/:name`,
  which a person calls and the model cannot, so the human gate is structural
  rather than a prompt rule.
- Everything the agent *can* still call either reads, or writes to our own
  vault: `capture_note`, `promote_note`, `merge_notes`, `resolve_note` and
  friends. A successful injection can therefore pollute the vault — write a
  false note, resolve a live impediment — which recall will then feed back into
  later turns. Nothing detects that today, and little of it is visible: `Later`
  lists parked reminders and the note page renders one note you already have the
  id of, so a fabricated note nobody parked is only reachable through the vault
  routes or the file on disk.

Tool results are not fenced or labelled as data, and the system prompt does not
tell the model to distrust them. Both are worth doing before live mode.

---

## 4. Testing

**There is no test framework.** Verification is `typecheck`, `build`, and
curling the gateway. The interesting bugs here are wiring bugs, and two of them
in this codebase's history were caught only by manual end-to-end runs: an
outbound echo token stamped on our own log entry silently suppressed
`workitem.linked`, and proposals held in an in-memory map vanished on restart,
so a decision somebody had been promised was still waiting had quietly gone.

**The Claude CLI provider is the one that has actually answered.**
`claude-cli.ts` runs through `@anthropic-ai/claude-agent-sdk`, authenticating
from the developer's own Claude CLI login, and has been driven end to end with
no credential at all — real tool calls, real vault recall, streamed into a
conversation (*"third sprint running with the same shape… [[provider-signing-secret]] …
[[third-party-waits]]"*). It is tried before the metered API key in mock mode.

Its limits are worth stating. The availability probe is a real turn cached for
24h in `vault/raw/provider-probe.json`, so a login that expires mid-day still
reports live until the cache rolls or the file is deleted. `zodShape` covers the
JSON Schema subset our tools use — string, number, boolean, enum, array and
nested objects; anything outside it becomes `z.record`, which the model sees as
untyped. And it inherits the CLI's own model selection rather than
pinning one, so answers can differ between machines in a way `claude.ts` does not.

**No vendor key has gone through the other two providers, but their wiring is
exercised.** `npx tsx scripts/verify-providers.mts` stands up a server that
speaks enough of the Anthropic Messages protocol to drive a real tool-use loop
through `claude.ts` — the SDK's tool runner, our handlers and the gateway tools
all run; only the model is fake. It asserts the tool schema reaches the API, the
system prompt is sent, the runner loops for a second turn, our handler is
actually invoked, the `tool_result` carries the handler's payload, and the reply
streams in order. All pass.

What that still does not cover: a real model choosing tools sensibly, real rate
limits, and real error shapes. `ANTHROPIC_BASE_URL` is what makes the harness
possible and is also the knob for a proxy.

`copilot.ts` is no longer a scaffold — the SDK is installed and the wiring is
live code, checked against the package's own type declarations. Three shapes
this file used to guess at are now settled: `defineTool` takes
`ZodSchema | Record<string, unknown>` so our JSON Schema goes straight through;
the system prompt is `SessionConfigBase.systemMessage` (`mode: 'append'`), not
`customAgents[].prompt` as the docs suggested; and `assistant.message_delta`
plus `session.idle` are both real. A fourth thing was simply wrong and typed
its way out: `mcpServers` is `Record<string, MCPServerConfig>`, not bare URLs.

The Copilot path is verified further than that, because the CLI runtime is
**bundled** — `@github/copilot` is a dependency of the SDK, so there is nothing
to install and nothing has to be on PATH. With no credential at all, the harness
confirms: the runtime starts (~2.5s), and a session is created with our exact
config (tools, `streaming: true`, `systemMessage`).

It used to confirm one more thing, and the check went with **D5**: the bare-URL
`mcpServers` shape the code once sent was rejected outright —
`TypeError: Cannot use 'in' operator to search for 'workingDirectory'` — a bug
that would have crashed session creation on the first live turn. With the four
vendor endpoints deleted, nothing in the repo can produce that shape, so the
guard was testing a config with no producer. The lesson lives in `copilot.ts`'s
header instead, where somebody wiring vendor MCP back in would read it.

The boundary is now exactly one thing: **the model turn needs authentication**,
and fails with `errorType: "authentication" — Session was not created with
authentication info or custom provider`. Set `GITHUB_TOKEN`, or be logged in
via `gh` / stored Copilot OAuth, and that check becomes a real answer.

Two auth bugs were found by pushing to that boundary and are fixed: `cfg.key`
was accepted and never passed to the SDK (it belongs on
`new CopilotClient({ gitHubToken })`), and `createAgent` refused to even try
Copilot without `GITHUB_TOKEN` — but `useLoggedInUser` defaults to true, so a
developer with `gh auth login` was being handed the stub while a working
provider sat right there.

The SDK also pulls `koffi`, a native module whose install script npm's
`allowScripts` policy does not run. **It does not need to run** — koffi ships
prebuilt binaries and `require('koffi')` returns 3.1.4 on a tree installed under
that policy. The import is still wrapped, which is right, but "Copilot is
unavailable because koffi did not build" was a wrong diagnosis carried in two
documents: measured, the runtime starts and only the credential is missing.

**~~`askCopilotStructured` returns `{}` — the Copilot structured backend does not
work.~~ Fixed.** B5 assumed this only needed a credential to *verify*; with one,
it turned out to need two fixes, neither of them where the narrowing below was
looking.

Evidence, kept because the narrowing was sound and still landed short:

| | |
|---|---|
| Copilot auth | **works** — `copilotAvailable() = true` once `gh auth login` is done |
| the SDK's tool calling | **works** — a direct `defineTool` + `createSession` + `sendAndWait` fires the handler with `{"verdict":"works"}` |
| our `askCopilotStructured` | returned `{}` on `claude-sonnet-5`, `gpt-5.6-sol` and `auto`, and on a **flat** schema as well as a nested one |

So it was not the model, not the account, and not the nested-schema bug that bit
the CLI path — `zodShape` was the obvious suspect and was not it. The suspects
left standing were `systemMessage: { mode: 'append' }`, the `Call <name> with
your answer.` suffix and the shared memoised client. **It was none of those
either.**

It was the credential. `GITHUB_TOKEN` held a **personal access token**, which
this endpoint refuses — `400 checking third-party user token: bad request:
Personal Access Tokens are not supported for this endpoint` — while `start()`
and `getAuthStatus()` both pass on one, so every check upstream of the turn said
yes. `copilotToken()` ignores a PAT so `useLoggedInUser` reaches the OAuth token
instead. Measured after the fix: `copilot OK 3557ms
{"verdict":"works","n":42,"nested":{"colour":"green"}}`.

**The general lesson is the one this file keeps paying for**: every check short
of a real turn was passing, so the narrowing kept looking at our request shape
rather than at what we were authenticating with.

**It blocks nothing**, which is why it is recorded rather than fixed in place:
`claude-cli` is the default, `MC_STRUCTURED=auto` walks past Copilot, and every
caller of `structured.ts` degrades to no-provider rather than to a wrong answer.

**The model default was a separate bug, and is fixed.** `COPILOT_MODEL`
defaulted to `gpt-5`, which this account does not have — and the failure mode is
the one that is hardest to read from outside: the runtime starts,
`getAuthStatus()` says authenticated, and only `session.create` dies with *Model
"gpt-5" is not available*. It is `auto` now, the one id always present.
`listModels()` on this account returns: `auto`, `claude-sonnet-5`,
`claude-opus-5`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`,
`gpt-5.3-codex`.

**Recall ranking is tuned by feel.** The weights in `libs/vault/src/recall.ts`
(spine 20, decay 8, title 4, open impediment 3) were chosen by reasoning and
spot checks. Nobody can tell whether a change to them makes retrieval better or
worse. Twenty labelled questions with expected note ids, run on every change,
would close this.

---

**`.env` was ignored by every module-level read, and was for a long time.**
`main.ts` called `loadEnvFile` in its own body, and in ESM a module's body runs
*after* every module it imports — so `ANTHROPIC_MODEL`, `ANTHROPIC_EFFORT`,
`ANTHROPIC_MAX_TOKENS`, `COPILOT_MODEL`, the four vendor MCP server URLs (since
deleted — `ROADMAP.md` D5), `ANTHROPIC_EXTRACT_MODEL` and `MC_VAULT_DIR` all
evaluated against defaults unless you exported them into the shell by hand.
`PORT` and `MC_MODE` worked, which is why nobody noticed: they are read in
`main.ts` itself, below the call.

Fixed by `apps/gateway/src/env.ts`, imported first in `main.ts`. **That import
must stay first** — an import sorter that moves it below the others silently
restores the bug, with no error and nothing obviously wrong in the output.

## 5. Fixtures and docs

**~~Three of six seed notes have frontmatter `links` that disagree with their
body.~~ Fixed, by not storing the field.** `decodeNote` derives `links` from the
body via `extractLinks` and ignores frontmatter entirely, so a stored copy was
write-only: never read back, overwritten on the next save, and free to drift in
between — which three of the six had done.

Correcting the three copies would have left the mechanism that produced them, so
`encodeNote` no longer writes `links` at all and the line is gone from all six
fixtures. Nothing is lost: Obsidian and every other reader parse `[[wikilinks]]`
out of the body, which is where the truth already was. Verified by round-trip —
a note created with two wikilinks reports both through the API, writes no
`links:` line, and after an edit that drops one, reports one.

**`apps/shell/vite.config.mts` is typechecked by nothing.** The shell project
pins `types: ["vite/client"]` so that a node global in browser code fails
loudly, and the config imports `node:url` — including it would force node types
back in and undo the guarantee. The root `tsc -b` does not reach it either
(it includes `apps/shell/src/**/*`). Vite transpiles the file without checking
it, so a type error there shows up when the dev server starts rather than at
`npm run typecheck`. It is 25 lines and mostly literals; the cost of a fourth
tsconfig to cover it has not been worth paying.

**~~The root `tsconfig.json` and the vite aliases duplicate the same path
mapping.~~ Fixed.** They were two hand-maintained lists of the same four
mappings: add a library, update `paths`, forget the other, and tsc resolves it
while vite does not — an error that only appears when somebody starts the dev
server, pointing at an import rather than at the config.

`vite.config.mts` now derives `resolve.alias` from `tsconfig.base.json`, which
is the one place a `@mc/*` package's location is written down, **minus an
explicit `BROWSER_FORBIDDEN` deny-list**. That deny-list is the whole subtlety:
a naive `paths` → `alias` copy would helpfully alias `@mc/vault` and silently
undo the invariant its absence enforces. Deriving without it would have been a
worse bug than the drift.

Verified both directions: `@mc/vault` is absent and all three others present;
and adding a fifth path to `tsconfig.base.json` makes it appear in the vite
aliases with no second edit. The build produces a byte-identical bundle hash.

One constraint this introduces: `tsconfig.base.json` must stay strict JSON — no
comments. The per-project tsconfigs are free to have them (`apps/shell` does).
If one is ever added there, vite throws at startup naming the file and the
reason, which is loud, immediate, and easier to diagnose than what it replaced.

**Jira comments are in-memory** and vanish on gateway restart, unlike notes and
the event log — the graph-backed connector holds them in an array, because
`graph.json` is the derived layer and a demo write must not edit it. `linkItems`
is a no-op for the same reason, so a drawn arrow produces a `workitem.linked`
event with nothing observable behind it.

**~~`apps/shell/dist/` grows forever.~~ Fixed, without touching
`emptyOutDir`.** That flag stays `false` on purpose — rmdir is not permitted on
some mounted filesystems, and a stale dist would fail the build there — but the
consequence was that every build left its predecessors behind, reaching 29 asset
files and 15 MB against the three files one build produces.

A `prebuild` script now clears the directory, wrapped in a `try` that warns and
carries on, so the filesystems `emptyOutDir: false` protects still build. npm
runs it ahead of `build` automatically. Verified: a build over a dirty dist
leaves exactly `index.html` plus one JS and one CSS asset.

### Some gateway routes have no caller

The browser calls `/api/findings` (and `/api/findings/:id`, `…/act`),
`/api/records/:surface/:id`, `/api/vault/notes`, `/api/sources`, `/api/chat` and
`/api/suggestions`, and nothing else — **not** `/api/tools/:name`, which is the
human gate a person reaches by hand and which no screen may call. Most of the rest are reached by `scripts/inspect.mjs`, the skills,
the scheduler or the agent's own tools, which is a real caller and not a dead
one. These four are reached by nothing at all — not the shell, not
`inspect.mjs`, not the docs:

| route | why it is unused |
|---|---|
| `GET /api/jira/items/:key` | nothing wants one item; `/api/jira/items` returns the list |
| `GET /api/jira/items/:key/comments` | the bulk `/api/jira/comments` answers the same question in one request |
| `DELETE /api/vault/log/:id` | `POST /api/vault/log/delete` covers single *and* bulk, and is the one the docs name |

They are left in rather than deleted — a route is an interface, and this gateway
is explicitly documented as something you curl.

**A fourth was deleted rather than left in.** `PATCH /api/vault/log/:id` mutated
an **append-only** log, which is contrary to the model everything durable rests
on — an unused route is cheap, but an interface nobody should reach for is not.
It went with `Vault.updateEvent` and the `editedAt` field only that method wrote.
The
per-key comments route is the shape a live Jira adapter would want, since the
bulk one fans out N requests against the mock, which section 2 already flags.

### Dead code — none left, and how to check

Unused locals, parameters and imports fail `npm run typecheck`:
`noUnusedLocals` and `noUnusedParameters` are on in `tsconfig.base.json`, so the
compiler is the check and there is nothing to run by hand.

**`noUnusedLocals` stops at the file, and it also stops at the declaration.** It
sees an unused local; it does not see a module nothing imports, a dependency
nothing imports, a **class method nobody calls**, or an **interface field
nobody reads**. The last two are the ones that rot quietly, because the type
still compiles and the field still serialises. Two were found that way and are
gone:

| | |
|---|---|
| `MiroConfig.defaultBoardId` | accepted at the call site (`connectorsFor` passed `MIRO_BOARD_ID` into it) and **never read** by `miro.ts`, whose every method takes an explicit `board`. The same shape as the `cfg.key` bug in `copilot.ts`: a config field that looks wired and is not |
| `Vault.updateEvent` / `McEvent.editedAt` | the only writer of `editedAt` was the `PATCH` route above, so both went with it |

And one was the reverse — a field with no reader because its reader was never
written. `DossierOrigin.firstIsOrigin` decides whether the origin block says
*"where it came from"* or *"earliest record outside Jira"*, and `CLAUDE.md` says
to check both with `inspect.mjs issue MC-2` — which printed neither, because it
only read `predatesTicket`. It reads both now.

Checks worth re-running rather than trusting this paragraph:

```bash
# a dependency nothing imports any more
for d in $(jq -r '.dependencies|keys[]' package.json); do
  grep -rql "from '$d" apps libs scripts || echo "UNUSED $d"
done

# an nx project nothing imports — check every @mc/* against its own exports
npx nx show projects
```

Both have found real things: three npm dependencies and a whole `@mc/*` library
outlived what imported them, and neither typecheck said a word.

For unused *exports*, which the compiler will not flag either, the test is
whether a symbol has any reference outside its own file.

### Over-exported symbols — 100 of 388, and mostly on purpose

**This section used to say "six", and six was wrong by a factor of seventeen.**
Measured rather than recalled: 100 of 390 exported symbols have no reference
outside the file that declares them. None of them is *dead* — every one is used
— the surface is just wider than anything needs.

**83 of the 100 are types**, and for most of those `export` is correct even with
no importer: `StoredIssue`, `StoredNote` and the rest of `graph.ts` are the
published contract in `GRAPH-SCHEMA.md`, which collectors written outside this
repo are built against, and an interface naming a function's parameter has to be
exportable for the signature to be nameable.

**17 are values**, and the ones that stay exported have a reason:

| | |
|---|---|
| `slotIsOpen`, and `structured.ts`'s neighbour | pure, and exported so the rule can be checked against a table rather than at 08:00 |
| `buildStoryline`, `recordOfNode`, `STORYLINE_*`, `STATUS_FLOW` | the evidence view's specification — `CLAUDE.md` says do not delete these as unused |
| `COVERAGE_KINDS`, `renderBrief`, `findJoinFailures`, `reviewInbox`, `slackBot`, `rankFindings`, `describeEvent`, `buildIdentities`, `FIXTURE_NOW` | named in the documents as the thing that decides something; a reader greps for them |
| `CopilotToolSpec`, `promptFor`, `stripCommand`, `Skill`, `SkillResult`, `ProposeOpts` | `copilot.ts`'s neighbours are the seam `verify-providers.mts` reaches through, and `CopilotToolSpec` has to stay exported for `toCopilotTools`'s return type to be nameable |

Ten were narrowed to file scope because they were module-internal and named in
no document: `findFromWorkRows`, `slackBlocks`, `isEmptyDelta`,
`updateObservations`, `parseRoute`, `validate`, and the four `project*`
projections in `@mc/connectors` — which `export * from './graph/index.js'` was
putting on the package's public API for no consumer.

Re-measure rather than trusting the number above; it moves with every module
added.

---

## 6. Deliberate, not defects

Listed so nobody "fixes" them.

**`sync.ts` has no `chat.message_posted` reaction.** Any automatic outward
response to every Slack message is the noise that gets an integration muted.
Those events still reach the log, the timeline, `/catchup` and the context
envelope — the event is used, it just has no side effect.

**`@mc/vault` is absent from the vite aliases.** It touches `node:fs`; a browser
import must fail loudly. See CLAUDE.md.

**A folded reference loses its position in time, and its note-to-note links.**
`buildStoryline` folds an `annotates` / `documents` / `mentions` edge onto the
work item it points at, so a Confluence page naming four tickets is four marks
on those tickets rather than a node of its own — which is what took the fixture
from 307 connections to 38. The cost is that "when was this written" is no
longer a position on the axis (it is on the mark, and in the ticket's own
context), and that `links` edges (note → note) disappear whenever either end was
folded, because the endpoint is no longer a node. The records themselves are
untouched.

**`buildStoryline` returns every node in the range it was asked for.** There is
no windowing inside it and there must not be: an edge dropped because one end
sat outside the view is a dependency that vanishes when somebody looks closer,
which is the one thing a picture of dependencies may not do. The node count is
therefore bounded by the fetch. At 172 nodes and 307 edges that is comfortable;
whatever draws this at ten thousand should cull by *screen* extent, never by
data window.

**The alert list does not split into two columns at any width.** It is ranked
worst-first, and reading left-right-left-right across two columns destroys the
one thing that ranking is for. It centres at a capped measure instead, which
leaves real margin on a very wide window — deliberate, and the same reading
width every screen uses.

**The status summary is a separate route from the dossier, and slower.** Folding
it into `GET /api/issue/:key` would put a model turn in front of every ticket
anybody opens. The dossier is the product and the summary is a reading of it; the
fast half must never wait on the slow one. See summary.ts.

**The status summary has no "regenerate" button.** It is keyed on the brief's
content, so it re-asks exactly when the records change and never otherwise. A
button would exist to let somebody spend a turn hoping for a different answer,
which is not a feature — delete `vault/raw/summary-cache.json` if you genuinely
want a fresh read.

**Decay never deletes or hides.** A stale note still appears in explicit
lookups, still counts as evidence, and still wins on a join-key match. It only
stops being volunteered unqualified.

**Editing a note writes without a proposal.** Single user, no external system to
conflict with. Agent-initiated *restructuring* is gated; a human editing one
note is not.

**The Miro snapshot export goes stale on purpose.** One shot, its own frame,
never reconciled.

**Skills call no model.** Deterministic gathering is what keeps mock mode a
complete product and keeps the brief reproducible.

**Nor do the starter questions.** `suggest.ts` is a fixed list of rules over the
same joins the findings pass uses, for the same three reasons — it runs with an
empty `.env`, there is one file to read when a suggestion is wrong, and an ask
box that offers four different questions every time you open it reads as noise. It
is *narrow* by design: it will never surprise you with a question no rule
anticipated, and widening it is a rule, not a prompt.

**The vault store assumes a single writer.** Documented at the top of
`libs/vault/src/store.ts`. There is no locking, no merge, no conflict
resolution, and the whole class of problems that makes shared knowledge bases
hard is simply absent. If that assumption changes, that file breaks first.

**A vendor write blocked by SAFE MODE is reported as though it had happened.**
Asked for, and it is the one place this app says something happened that did
not — so it is worth knowing exactly how narrow it is. Only
`BlockedBySafeMode`, which is OUR refusal, thrown before the call is made, where
nothing was attempted and nothing failed; a vendor that refuses or is down still
says so, unchanged. No key is invented, and none of the consequences are
claimed — the sentences report the act alone, so nothing names a ticket that
does not exist or says the alert will stop firing, which it will not. And the
LOG is untouched: `accept_proposal` throws before it settles, so the proposal
stays pending and the durable record still says the decision was never carried
out. The honest version of the same thing is one line — `MC_SAFE_MODE=off` on a
fixture makes these writes real against the in-memory graph connectors, with no
credentials and no network, and then the ticket exists and the alert genuinely
stops. See `pretendItWorked` in `act.ts`.

**The demo's parked notes all carry a reminder that has already lapsed.** Both
fixtures ship four `idea` notes so `Later` opens on something (`buildParked` in
`scripts/fixture/generate.ts`, and the matching block in the programme
generator). The two tied to an alert carry a date in the PAST on purpose:
deferring suppresses the alert it was deferred from (`suppressedIds`), and
nothing seeds a `mc.finding_deferred` event to go with them — so a future date
would draw a note claiming to hold an alert that is still on the front door. A
lapsed deferral is the coherent shape: it came back, the alert is in the list,
and the note says why it was pushed away. The two untied notes hold no alert, so
one carries a future date and one carries none, which is also how all three
branches of `Later`'s `due()` come to be drawn.

**The demo's conversations are seeded in the browser, once.** `Ask` reads
`localStorage`, because the gateway keeps no per-user state, so there is no
server-side collection for a fixture to write into — `apps/shell/src/alerts/demo.ts`
is the equivalent, and it binds each seeded conversation to whichever real
finding of that KIND is on the front door rather than to a written-down id,
which is what keeps `Open the alert` live on any graph. It runs only into a
browser with no history and sets a flag whether or not it wrote anything, so
deleting the rows is permanent — an undo nobody asked for would break the page's
own rule that delete acts. Clear `mc-demo-seeded` to be offered them again.
