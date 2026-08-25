# Mission Control — architecture & information flow


> **The layer underneath.** `DIRECTION.md` says what the product is;
> `DESIGN.md` and `docs/design-preview.html` say what the screen does. This says
> what each surface owns, how events move between them, and why — the machinery
> the alert engine stands on.
>
> For the single flow that exercises all of it — a meeting becoming tickets, a
> Confluence page and memory — see **[CEREMONY-FLOW.md](./CEREMONY-FLOW.md)**,
> which is shorter and has diagrams.
>
> **Worked examples use `MC-101`–`MC-105`.** The fixture is `PAY-*`, `PLT-*` and
> `WEB-*`, so no printed output here can be reproduced by running anything.
> Treat every example as illustrative.

---

## 1. What each tool is for

The system falls apart if two tools both think they own the same fact. So decide
once, write it down, and never negotiate again:

| Tool | Role | Owns |
|---|---|---|
| **Jira** | the database | `status`, `assignee`, `estimate`, `sprint`, `title`, `type`, `epicKey` |
| **Miro** | the view | `position`, `connectors`, `frame` |
| **Confluence** | the memory | `spec`, `decisionRecord` |
| **Zoom** | the input | `transcript` — the spoken record, evidence, never authority |
| **Slack** | the nervous system | `discussion` — live conversation in, notifications out |
| **Vault** | the memory | `synthesis`, `impediment`, `commitment`, `pattern` — *ours* |

**This table is live, and it is `FIELD_OWNER` in `libs/domain/src/index.ts`** —
the field names above are the literal keys. It is enforced at runtime rather
than only documented, in two places. `accept_proposal`'s `update_issue` branch
filters its patch through `mayWrite('jira', field)` and refuses any field Jira
does *not* own — `position`, `frame`, `spec` — with `not Jira's to write`; Jira's
own fields are what the branch exists to write, so they pass. And
`assertVaultSafe` builds `FOREIGN_FIELDS` from every key above that the vault
does not own, so a note whose body opens a line with `status:` or `transcript:`
is thrown out at write time.

GitHub is a sixth **source** and deliberately not a `Surface`: it owns no field,
so it stays out of the union that `FIELD_OWNER` and `Evidence` are keyed on, and
appears only where a source is being counted. Same argument that keeps a view
that re-draws what others own out of `Owner`: it has nothing of its own to be
right about.

**Who owns a fact does not depend on how it is shown**, which is why this table
survived the interface being rebuilt around it untouched.

### Why a sixth surface

The five vendor tools can all answer *what is true right now*. Not one of them
accumulates. `explain_blocked` re-derives the same answer from scratch on every
call and throws it away, so the system can say "MC-102 is blocked by MC-103" and
can never say "for the third sprint running".

That second sentence is the scrum master's whole job, and it needs somewhere to
live. The vault is markdown on disk (`@mc/vault`), single-user, private by
default. Two rules keep it from decaying into a stale mirror of Jira:

1. **It owns interpretation, and only interpretation.** Look at the bottom of
   `FIELD_OWNER`: `synthesis`, `impediment`, `commitment`, `pattern`. Not one is
   a fact about the work. `assertVaultSafe()` rejects a note that caches a field
   another surface owns — enforced in the write path, not in a style guide.
2. **Timeless, dated, or pointer.** Every note declares which kind of truth it
   holds, and a `dated` note always carries a `verifiedAt` — though not by the
   refusal you would expect. `assertVaultSafe()` does throw on an undated dated
   note, but `create` back-fills the moment of writing first, so the throw can
   only fire on an update: `POST /api/vault/notes` stamps today and returns 201,
   while switching an existing note to `dated` with no date is a 400. A
   hand-edited file is the one way an undated dated note exists, and
   `stalenessOf()` reads it as fully rotted rather than fresh. Re-verifying is a
   separate action from saving, because "I edited this" and "I confirmed this is
   still true" are different claims.

   And the declaration *does* something. `stalenessOf()` ranks a dated claim down
   as it ages past its last verification — fresh for 14 days, fully rotted at 42,
   two sprints and six. Timeless notes do not rot and keep a much gentler drift,
   because a pattern note from three sprints ago is often the single most useful
   thing in the vault. The field earns its keep in three places, not one:
   `stalenessOf()` ranks with it; the write path refuses a dated note carrying no
   `verifiedAt` and stamps the date when a note is re-classified into `dated`;
   and the contradiction detector reads it directly, so only a `dated` note
   carries a `signal` into the trail and a `person` or `pattern` note can never
   raise a `disagreement` alert (see below). Before those three it was
   decoration: `verifiedAt` was written on every dated note, shown, re-stampable
   by hand, and never once read to make a decision.

   **Decay never deletes and never hides.** It changes what the system
   volunteers, not what it holds. A stale note still appears in an explicit
   lookup, still sits on its note page, still counts as evidence, and wins on a
   join-key match — you do want the only thing anyone ever wrote about MC-102,
   told that it is old. It simply arrives marked `may be stale` so the agent
   hedges instead of asserting. Dropping it silently would make the vault lie by
   omission, which is worse than the staleness.

   The other half — a **needs re-verification** view, oldest claim first,
   filtering to exactly the notes the agent has started hedging about — is
   specified and not built.

Notes hang off the same join key as everything else (`relatedKeys`), so the
vault never invents a second ID space for *work* — only for things that are not
work: a person, a recurring pattern, an idea that has not earned a ticket.

Confluence stays the team-visible record. The vault is the working memory behind
it, and `promote_note` is how something graduates — through the same proposal
flow as every other write.

Note what Zoom is *not*. A thing said in a meeting is not a decision. It becomes
real only when it lands in Jira or Confluence. That distinction is what stops
your system from acting on someone thinking out loud — and it's a good line in
the pitch.

### The agent's read — the only opinion among the records, and nothing renders it yet

`GET /api/issue/:key/summary` gives one work item a written status: what is true
now, what put it there, what would move it, what not to trust. It is the same
four rules `extract.ts` and `infer.ts` keep.

**No screen reads it.** The card it was written for lived on the dossier pane,
which went with the pane app; the route is reached from
`scripts/inspect.mjs summary <key>` and from curl, and from nowhere in the shell.
The four rules below are the specification for whatever renders it next —
`DIRECTION.md` §1's evidence view is the candidate — and where they say "the
page", read "whatever renders this".

- **Additive.** No provider → `createSummariser` returns `null` → the route
  answers `unavailable` and nothing is rendered; `GET /api/issue/:key` never
  consults it either way, so the dossier is identical with a provider and
  without one. Never a broken box.
- **Never on the critical path.** A *separate route* from the dossier, written on
  demand and cached on disk against a hash of the rendered brief. It answers
  immediately in every case — `ready`, `pending`, `empty`, `unavailable` — and
  while a turn is running it answers `pending` without assembling anything.
  There is no boot warm-up: it walked the active sprint writing cards for pages
  nothing in the shell can open, and ROADMAP G3 removed it.
- **It cites.** `citations` are indices into the dossier's own `trail`, so
  whatever renders it can mark the exact rows behind "drawn from 11 records".
  Indices and not labels, because labels repeat: two Slack lines from one person
  in one channel are the same label twice, and only position separates them.
  `citations` is `required` in the tool schema beside `state` and `why` — left
  optional, the model simply stopped citing.
- **Labelled as an opinion**, and separated from the records by design: whatever
  renders it gets the provider's name and the page's one accent. Everything else
  in a dossier is a record somebody wrote, and mixing the two makes the whole
  page as trustworthy as its least trustworthy part.

The records reach the model as data and it is told so; `allowedTools` is the
recorder alone. Structurally the worst a successful injection achieves is a wrong
paragraph in a card labelled as a model's opinion — this module writes to no
surface, emits no proposal, and cannot reach `accept_proposal`.

The contradiction detector is deliberately near-sighted, and that is the
feature. `classifySignal` is a word list that will miss claims — the right side
to fail on, because a `disagreement` alert's only value is that it is believable. A missed
claim costs a disagreement nobody sees; a false one invents an argument two
colleagues never had. Three rules hold it together:

- **Negations are tested first** — "not done" contains "done".
- **Classification is per key.** One Slack line routinely covers several tickets
  and says opposite things about them; reading *"MC-91, MC-93 and MC-96 are
  done. Sprint 13 closes with MC-94 still open"* as one claim marked three
  tickets disputed.
- **Only a `dated` note is a claim about a moment.** A `person` or `pattern`
  note is a standing description, and reading state out of one is the same
  mistake as reading it out of a runbook.

It never says which side is right. It cannot know, and a guess would make the
feature worse than absent — both records go in front of the person who can tell,
with the dates and which is newer.

## 2. The join key

The hardest problem in this project isn't any single integration. It's: *how do
you know that a Miro card, a Jira ticket, a Confluence heading and a sentence in
a transcript are all about the same thing?*

**Answer: use the Jira issue key. Don't invent a second ID space.**

`MC-123` is free, stable, human-readable, already in your team's vocabulary, and
already typed into Slack messages and spoken aloud in meetings. Where an artefact
carries it, this is how:

| Surface | How the key is carried |
|---|---|
| Jira | it *is* the key |
| Miro | **App Card** with the key at the head of its title, regex-extracted like the rest |
| Confluence | regex-extracted from title + body by the importer, then filtered to the graph's own project prefixes |
| Slack | regex-extracted from message text, stored with `channel:ts` |
| Zoom | regex-extracted per transcript segment, with its time offset — except a Zoom Docs note, which has no timing: the segment is a paragraph and the offset is its index (`timed: false`) |

It is also the system's blind spot, and everything downstream is shaped around
it. The join fires only when somebody typed a key, and most text-bearing records
carry none — in the committed fixture, *written* to make the join work, most
transcript segments and most stickies do not. *"Someone needs to own the dedupe
cache"* is a commitment with no key in it. That is why `sources.ts` counts the
misses out loud ("pages name no ticket", "stickies carry no key"), and why
`infer.ts` exists at all: a model proposes the edges the regex cannot see,
additively, provenance-tagged, and never allowed near cycle detection.

That last column is doing real work. One regex —

```ts
/\b([A-Z][A-Z0-9]+-\d+)\b/g
```

— is how unstructured human speech attaches itself to your structured spine. It
is `extractKeys()` in `libs/domain/src/index.ts`, and it runs at whichever layer
owns the text rather than in a per-surface adapter. There is no Slack, Zoom or
Confluence adapter: those surfaces reach us through `MC_GRAPH_DIR`, and Miro is
the only live vendor client.

**At collect time** — `import-slack-messages.mts`, `import-confluence-pages.mts`
and `import-github-prs.mts` write the keys into the record, because all three
filter what they find against the graph's own project prefixes.

**At read time** — `projectMessages` and `projectStickies` in
`libs/connectors/src/graph/index.ts`, `keyOf` in the live Miro client, and
`annotateTranscript` in the domain, which fills a Zoom segment's `mentions` after
the projection has deliberately left them empty.

Nothing else in the system is this cheap relative to what it buys.

### Why Miro App Cards, specifically

Not sticky notes. Miro's **App Card** type exists precisely to mirror third-party
items on a canvas: it renders external state on the card face and round-trips
edits back out. Miro documents the exact backend flow for keeping them in sync.
Using the purpose-built primitive means your Jira↔Miro mapping is first-class
rather than something you parse out of sticky-note text at 3am.

---

## 3. How information flows

### The rule that prevents sync wars

> **Exactly one surface may write each field.**

Encoded as `FIELD_OWNER` in the domain lib. Anything else that changes an owned
field is a **proposal**, not a write. Miro may not set status. Jira may not set
position. Read this table out loud before adding any new write path.

### The event log

Nothing calls anything else directly. Every change from every tool becomes one
`McEvent` on a single append-only log, and the sync layer reacts to *the log*:

```ts
{ id, ts, source, type, entityKey?, actor?, payload, causedBy?, summary?, editedAt? }
```

This gives you one file to read when debugging "why did that Jira update happen"
— which on day 5 at 2am is worth more than it sounds.

The last two are the hand-correction pair. `PATCH /api/vault/log/:id` may rewrite
`summary` — how the entry reads, which `describeEvent` returns in place of the
derived line — and `entityKey`, what it is filed under, which is where the log is
actually wrong in practice. It may never rewrite `payload`: that is what the
source sent, and what notes cite as evidence. `updateEvent` stamps `editedAt` on
every correction, because a silently rewritten history makes every citation
untrustworthy.

The in-memory log dies with the process, which is right for echo suppression and
useless as history, so it is mirrored to `vault/raw/events.jsonl`. That file is
what `buildTimeline` reads, and therefore what the `aging` finding measures with.

**Mock mode seeds it, from the graph and from nothing else.** Fixtures describe a
team's present; the timeline draws transitions and a cold start has none. So
`apps/gateway/src/seed.ts` copies `MC_GRAPH_DIR/events.jsonl` into the vault on
first boot, and copies `MC_GRAPH_DIR/notes/` in beside it, because claims are the
asserted layer and the vault is where that lives. Both run only when the vault is
empty, and both write straight to the raw JSONL rather than through `eventLog`:
replaying them through `startSync` would upsert a Miro card per event and post
"PAY-9041 is now BLOCKED" to Slack days late, on every restart. `rm -rf vault`
to reseed.

It generates nothing. There used to be a fallback that synthesised transitions
for a graph shipping no history, and its guard was whether `events.jsonl` existed
— true for the fixture and false for every real collector, so the only path it
could run on was the live one. It wrote hundreds of events for keys the graph had
never heard of, into an append-only log. A collector's graph with no history is a
programme whose transitions have not been observed yet; an empty log is the
honest start.

It reaches back past the previous sprint boundary deliberately. A window here
defaults to a fortnight, so a fortnight of history would make every window end
exactly at its own left edge — and the one claim this system exists to make,
"third sprint running", cannot be checked against a window holding one sprint.

### Echo suppression — do this on day 1

The failure mode that kills these systems:

1. User drags a card on the Miro board
2. Miro webhook → you update Jira
3. Jira webhook fires → you update the Miro card
4. Miro webhook fires → you update Jira
5. …forever, until a rate limit or a sprint dies

The fix is boring and non-negotiable: **stamp every outbound write with a
correlation token, and drop any inbound event carrying a token you recognise.**
`EventLog.markOutbound()` / `EventLog.isEcho()` in `apps/gateway/src/events.ts`.

Retrofitting this on day 6 is a classic way to lose a hackathon. Twenty lines,
day 1.

One subtlety that costs an hour if you get it wrong: the token belongs on the
**vendor** write, so their webhook carries it back and gets dropped. Your own
log entry recording that you made the write must use `causedBy: <triggering
event id>` instead. Stamp your own record with the token and `append` discards
it as an echo of itself — no error, no event, just a gap in the log.

**Only the inbound half is wired today, and this is the gap to close first.**
`markOutbound` mints and registers a token, and then no vendor write carries it:
no connector method takes one — `linkItems(from, to, type)`, `comment(key, body)`,
`upsertAppCard(boardId, item)`, `post(channelId, text)` — so `sync.ts` drops the
return with an explicit `void token`, `memory.ts` calls it as a bare statement,
and `tools.ts` hands it back as an `echoToken` nobody reads. `webhooks.ts` looks
for an `mc_correlation` property on the inbound Jira fields and Miro item data,
and **nothing in the tree sets it**, so `isEcho` can never match. Nothing loops
anyway, for reasons that are accidents of what is built rather than of this
mechanism: the reverse-direction handlers are no-ops and Miro is the only surface
with a live client. **Attaching the token is the first thing a new write path has
to do**, and it starts by adding the parameter to the connector method — every
caller is already holding a token with nowhere to put it.

### What webhooks do not tell you

Miro's board webhooks cover item create/update/delete and **not connectors** —
which is to say, not the arrows, which are the only part of the board that
carries the plan. There is no subscription that fixes this; the options are to
poll `listConnectors` or to run a Web SDK app inside the board. `canvas-poll.ts`
polls. Its first pass establishes a baseline rather than reporting news, or an
existing board writes one Jira link per arrow the moment you start the gateway.

### Two paths in, and the map shows one of them

The map below is the **vendor** picture: webhooks in, mirrored writes out. Every
arrow on it is wired — inbound handlers in `webhooks.ts`, the fan-out in
`sync.ts`, the human-gated writes in `tools.ts` — with the one exception the
table marks. What almost none of it can do is *reach a vendor*. **Miro is the
only surface with a live client** (`real/miro.ts`, on `MIRO_ACCESS_TOKEN`); Jira,
Confluence, Zoom and Slack are always the graph projection, which the gateway
says at boot: `[connectors] miro=live jira/confluence/zoom/slack=graph`. So
`jira.createItem`, `jira.comment`, `confluence.publish` and `slack.post` land in
that projection's own memory — which is what makes the created ticket appear in
the demo, and is not Atlassian — and `jira.linkItems` is a deliberate no-op. The
one outbound that leaves the process is `notify.ts`'s Slack incoming webhook,
and it carries the findings digest rather than a mirrored write. Read the table
as the contract each connector implements against, not as traffic you can watch
today. What it does not show is the collector path the product runs on by
default:

```
  Jira ─┐
  Zoom  │   five collectors          the gateway
  Conf  ├─► capture + emit  ──►  graph.json  ──►  findings pass  ──►  the alert list
  Slack │   (offline, files)      records/       (deterministic)      + a notification
  GitHub┘   (run by hand)              │                                    │
                                       └──► the vault ◄── claims somebody authored
                                              (never rebuilt)
```

**Nothing here schedules a collector.** Every one is a hand-run command —
`npx tsx scripts/import-programme-graph.mts` and its four siblings — so a new
`graph.json` appears when somebody puts one there. What runs twice daily is the
gateway's own half: `refreshJob` re-reads `graph.json` off disk at 07:00 and
19:00, diffs it against the last run's signature, and appends a summary event
plus a `mc.container_closed` for each container that shut. It reads no vendor and
starts no capture.

Three things that map cannot say, and they are the whole difference. **The
collectors read the vendors *ahead of* a turn**, not during one, which is what
retired the four vendor MCP endpoints. **The derived layer is rebuilt rather
than updated**, because absence is information: a rebuild can see that a link
Jira quietly dropped is gone, where an in-place update cannot. Reading that
absence as a finding is not wired yet — `refresh.ts` computes the removals and
logs only their count — so a stale link is still raised from the `AMBIGUOUS` tier
on the current graph. And **the findings pass is code, not a model**: a
model may propose candidates, but the rule that fires is deterministic, for the
same three reasons `skills.ts` is.

`GRAPH-SCHEMA.md` is the contract at the seam. What follows is the vendor layer.

```
                    ┌─────────────────────────────────┐
      speaks        │                                 │  notifies
   ┌───────────────►│         MISSION CONTROL         ├────────────┐
   │                │       gateway + event log       │            │
   │         ┌─────►│                                 │            ▼
┌──┴───┐     │      └─┬─────────────┬─────────────┬───┘       ┌────────┐
│ ZOOM │     │        │             │             │           │ SLACK  │
└──────┘     │ writes │   publishes │     mirrors │           │        │
  evidence   │        ▼             ▼             ▼           └───┬────┘
  only       │    ┌────────┐  ┌────────────┐  ┌────────┐          │
             │    │  JIRA  │  │ CONFLUENCE │  │  MIRO  │          │ commands
             │    └────────┘  └────────────┘  └─────┬──┘          │
             │                                      │ arrows,     │
             ├──────────────────────────────────────┘ polled      │
             │                                                    │
             └────────────────────────────────────────────────────┘
```

**No arrow runs between two vendors, and that is the point.** Jira's card on the
board is `sync.ts` reacting to a `workitem.*` event; an arrow drawn in Miro
becomes a Jira link because `canvas-poll.ts` polls `listConnectors` and `sync.ts`
answers the `canvas.connector_created` it emits. Both legs pass through the
gateway and its event log, which is what makes echo suppression and `FIELD_OWNER`
enforceable at all — a direct vendor-to-vendor wire would have nowhere to stamp
an outbound token. Slack's line is the same shape: a slash command lands on
`/api/webhooks/slack/commands`, becomes a `chat.command_received` event and a
note in the vault, and reaches no vendor.

Directional summary:

| From → To | Trigger | What moves | Auto? |
|---|---|---|---|
| Zoom → Mission Control | any Zoom POST that is not the validation handshake — you subscribe to `recording.transcript_completed`, but the handler does not check the type | a **pointer**: the recording uuid and the meeting topic. No transcript, no speaker, no offsets — the words arrive offline, through the collector | yes |
| Mission Control → Jira | human accepts a proposal | new issues from action items | **no — human gate** |
| Jira → Miro | issue webhook | app card fields refresh | yes |
| Miro → Jira | connector drawn | issue link created | yes |
| Miro → Jira | card field edited | *specified, not built.* The webhook collapses every non-create item event into `canvas.card_moved`, which `sync.ts` discards; there is no `canvas.card_edited`. The `update_issue` proposal branch that would receive it is written and unexercised | — |
| Mission Control → Confluence | decision extracted + accepted | decision record page | **no — human gate** |
| Jira → Slack | status → blocked / done | notification | yes |
| Slack → Mission Control | message with a key, slash command | context + commands | yes |
| Confluence → Mission Control | `page_created` / `page_updated` | context; and on an **edit** — any version past the first — a re-verify proposal for every note citing that page. A publish creates nothing to re-verify | yes → **proposal** |
| Miro → Mission Control | connector **poll**, not webhook | new dependency arrows | yes |
| Slack → the vault | `/mc remember …` — the slash command at `POST /api/webhooks/slack/commands` | a note, with the message as evidence | yes |
| The vault → Jira | ticket moves to in_progress or blocked | a **comment** carrying what we remember | yes — see below |

The pattern: **mirroring is automatic, creation is not.** Anything that makes new
work requires a human to press a button. That is both the safe design and the
better demo — the judges get to watch someone approve.

### The exception, and why it is not one

The last row writes to Jira with no human gate, which looks like a violation and
is not. Read `FIELD_OWNER` again: a **comment is not a field**. Nobody owns it as
state, so posting one changes nothing, cannot loop, and cannot make the vault a
second source of truth about the work. Every other outbound write *creates or
changes* something; this one only talks. It still carries an echo token.

This is the difference between a second brain and a search engine. Until this
existed, everything the vault knew was available only if you asked for it —
which requires you to already be in Mission Control, already wondering. Now the memory arrives at the ticket,
at the moment somebody starts work on it.

It is aggressively quiet, and that is the feature. Two transitions only
(`in_progress`, `blocked` — the moments a warning is still cheap), four note
kinds worth interrupting for, and never the same note twice on the same ticket,
checked against the durable log so a restart cannot make it repeat itself. A bot
that comments on everything gets muted within a week. See
`apps/gateway/src/memory.ts`.

The inbound half of that file matters just as much and is less glamorous:
knowledge bases die of **capture friction** long before they die of staleness. If
recording a thought means leaving the conversation and opening another app to
write markdown, it does not get recorded. So capture is `/mc remember …`, typed
where the thought was had: Slack posts it to `POST /api/webhooks/slack/commands`,
which answers inside Slack's three-second budget and files the note behind the
reply. `POST /api/slack/capture` is the same call without Slack, and is the IN
half of CLAUDE.md's two memory paths. There is deliberately no button in this
app: capture that requires you to already be in Mission Control is capture that
does not happen. The kind is inferred by regex (`inferKind`) and is a starting
guess; correcting it is a `PATCH /api/vault/notes/:id`, because the note page
edits the title, the body and when it comes back — not the kind.

---

## Sources

- **Why nothing is embedded**, which is why a citation opens *our* record rather
  than a vendor's page: Atlassian Cloud sends `X-Frame-Options: SAMEORIGIN`, so
  [Jira](https://community.atlassian.com/forums/Jira-Service-Management/in-a-frame-because-it-set-X-Frame-Options-to-sameorigin/qaq-p/1350156)
  and [Confluence](https://jira.atlassian.com/browse/CONFCLOUD-66693) refuse to
  render inside another app. Miro alone ships an embed built for it
  ([Live Embed](https://developers.miro.com/docs/miro-live-embed-introduction)),
  and nothing in the shell uses one.
- [Miro App Cards — backend flow](https://developers.miro.com/docs/backend-flow-for-app-cards) · [App card use cases](https://developers.miro.com/docs/app-card-use-cases) · [2-way sync example](https://developers.miro.com/docs/enable-2-way-sync-between-app-cards-and-github-cards)
- **Retired (ROADMAP D5).** All four planning tools ship remote MCP servers and
  the Copilot SDK speaks MCP natively, which is why "make the agent aware of five
  vendors" was once a config block. They are gone: this deployment forbids
  external MCP servers, and five collectors read the vendors into one graph
  *ahead of* the turn instead. [Miro](https://developers.miro.com/docs/miro-mcp) ·
  [Atlassian](https://www.atlassian.com/blog/announcements/remote-mcp-server) ·
  [Slack](https://mcpservers.org/remote-mcp-servers/slack) ·
  [Zoom](https://developers.zoom.us/docs/mcp). The transport lesson is kept in
  `copilot.ts`'s header, not here.
- **Not reachable:** [Zoom Cloud Recording transcript API](https://www.recall.ai/blog/zoom-transcript-api)
  — blocked in this deployment, which is why the Zoom collector scrapes Docs
  notes instead (`GRAPH-SCHEMA.md` §10).
- [Copilot SDK is now generally available](https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/) · [Build your first Copilot-powered app](https://docs.github.com/en/copilot/how-tos/copilot-sdk/getting-started) · [Custom agents & MCP](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/custom-agents)

Prior art (surveyed Aug 2026 from vendor material, not hands-on):

- [Spinach.io — AI Scrum Master](https://www.spinach.ai/content/ai-scrum-master) · [on the Atlassian Marketplace](https://marketplace.atlassian.com/apps/1231257/spinach-io-your-ai-scrum-master)
- [Atlassian Rovo](https://www.atlassian.com/software/rovo) · [Rovo features](https://www.atlassian.com/software/rovo/features)
- [Miro Canvas 26 — shared AI workspaces](https://windowsnews.ai/article/miro-canvas-26-shared-ai-workspaces-for-teams-agents-and-workflow-automation.423724) · [Miro dependency tracker](https://miro.com/templates/dependency-tracker/)
- [Glean](https://www.glean.com/) · [Unito Jira connectors](https://unito.io/connectors/jira/)
- [mem0 — State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026), on staleness as an open problem
