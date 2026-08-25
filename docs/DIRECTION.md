# Direction — the alert-first rebuild

Where the product is going, why, and what that costs. Written after two planning
sessions (20 and 21 August 2026) so the decisions survive the transcripts they
were made in — which is, with some irony, the problem this product exists to
solve.

**This is built.** It was written as intent — the last line of this paragraph
read *"nothing here has been implemented yet"* — and the rebuild happened:
`apps/shell/src/alerts/` is the whole application, the front door is the
findings list, and the five vendor panes and the two lenses are gone as
destinations. The one thing still outstanding is §1's promise that the graph,
the timeline and the focus lens come back **as evidence**, reached by clicking
"why?" on an alert; `buildStoryline`, `buildTimeline` and `buildRelationGraph`
are kept as its specification.

Read `ROADMAP.md` for what is built and what is left, `CLAUDE.md` for how to
change it safely, and `ARCHITECTURE.md` for the rules layer underneath — field
ownership, the event log, echo suppression. That last one also archives what the
*previous* interface cost, which is history and is labelled as such.

`DESIGN.md` is the other half: what the screen looks like and how it behaves.
This file is the *why*; that one is the *what*.

**Both are written from `docs/design-preview.html`, and that is the one that
decides.** It is committed, standalone and clickable — open it off disk. Its
`every page` screen is the map of §3 below, and where any prose here or in
`DESIGN.md` disagrees with it, the preview wins: it is the version that was
tested in a browser. Read it before building a page.

`HACKATHON.md` (local only, not published) is where the decisions below came from — the two planning
sessions, the argument that ran through them, the board regrouped, the video
storyboard and the cut list. Read it when you want to know *who* decided
something and *what they were weighing*, rather than what was decided.

---

## 1. The one-sentence change

Mission Control stops being **a dashboard that consolidates five sources** and
becomes **an alerting system that can prove itself**.

The front door is a single line of text telling you something you did not know:
a commitment nobody ticketed, a date that moved under you, two people who
disagree about whether something shipped. The graph, the timeline and the focus
lens do not disappear — they are demoted from *front door* to *evidence*, reached
by clicking "why?" on an alert.

> We're on the ship, trying to navigate, trying to get updates as soon as
> possible. Not to run into the iceberg and then get a report after.
>
> — The product lead, 20 Aug, the moment the pitch landed

The graph author, immediately after: *"It's an alerting system."*

### Why this and not the alternatives

The room generated six plausible directions. This one was chosen because it is
the only one whose flagship question **no single tool can answer**.

A missing ticket is invisible to Jira by construction: the absence *is* the
finding, and Jira only knows what exists. Miro cannot see it, Slack cannot see
it, Confluence cannot see it. Every other candidate direction — status roll-ups,
stakeholder lookup, reporting — has a plausible single-tool competitor. This one
has none, which is what converts "all the plumbing" from a criticism into the
only possible mechanism for the answer.

---

## 2. What was decided

Two sessions, 20 and 21 August. The board is a Miro copy of the first session's
stickies, regrouped into eight themes; the second session was conducted against
those group numbers, which is why the transcript refers to work by digit.

| # | Group | Verdict |
|---|---|---|
| 1 | Decision → execution gap | **content of the hero case** |
| 2 | People, ownership & handover | second beat |
| 3 | Leadership bird's-eye status | deferred — not innovative enough to score |
| 4 | Proactive alerts | **chosen — the delivery mechanism** |
| 5 | Context consistency | **chosen — the drill-down** |
| 6 | Ticket → epic → initiative | folded into 3 |
| 7 | Institutional memory & reuse | parked |
| 8 | Reporting | ruled out 20 Aug, 14:38 |

**A trap in that numbering.** The room chose 4 and 5, but the hero case lives in
group 1. Scoped as "build group 4" this produces a notification framework with
nothing worth notifying about. **1 is the content, 4 is the delivery, 5 is the
drill-down** — build the detector first and the feed second.

### Settled

- **Alert first, dashboard second.** Sentry is the agreed mental model.
- **Reporting is out of scope.** Live state replaces periodic snapshots.
- **Two or three personas**, not a feature tour. Executive plus one delivery role.
- **Cut the interface hard.** A purpose-built page per alert type, nothing
  inherited between them.
- **Notifications via a Slack bot on our own server** — the company Slack cannot
  be posted to.
- **Real data, captured once.** See §10; this is the decision most at risk.

### Leaning, not decided

- "The dashboard is a debugging tool, not the interface." The graph author's position,
  twice stated, never conceded to. The delivery lead's counter — *"are we undervaluing some of
  the work then?"* — has no answer on the record. The resolution in §4 is mine,
  not the room's.

### Open

- **Personal alerts or program-level alerts?** The graph author assumed personal; the delivery lead read
  it as alerts against the delivery program. Personal means building a
  configuration surface, which is a whole screen nobody has budgeted.
- **What is the layer behind the notification?** The delivery lead asked this directly on
  21 Aug and the meeting ended without answering. §3 is a proposal, not a record.
- **What stops people gaming it?** The graph author's question, unanswered in the room.
  The answer in §11 is a good one and belongs on camera.

---

## 3. The pages

Eight destinations become four. The test applied to every candidate: **can you
name the moment somebody opens it, and what they do next?**

### It arrives

**The notification.** Not a page. One claim, one button, sent when something
fires. The product's front door is a message you did not go looking for.

### The application

A permanent toolbar of three — **Alerts · Later · Ask** — and four pages. Sources
is reachable but not in the toolbar; see `DESIGN.md` §4 for the full navigation
model and the reasoning behind each route.

| Page | What it is | Built on |
|---|---|---|
| **Mission Control** | What needs you, worst first. When nothing is wrong it says so and you close it. | `GET /api/findings` |
| **The alert** | One page per alert type. The claim, the evidence, **four** actions. | `GET /api/findings/:id`, `POST …/act` |
| **The conversation** | A thread that outgrew its alert, or a question about nothing in particular. | `POST /api/chat` |
| **Later** | What you deferred, the note you left, when it returns — and it is where a deferred alert goes. | `GET/PATCH/DELETE /api/vault/notes` |

**The front door is a pass of its own, and that is the load-bearing choice.** A
ranked list of *work items* cannot carry the flagship finding, because that
finding has no work item — the absence is the finding. So a `Finding` is not a
`WorkSignal`, and `GET /api/findings` is not a re-skin of anything.

`/api/work`, `/api/issue/:key` and `…/summary` answer and are not opened by any
screen; their callers are the agent and `scripts/inspect.mjs`, and they are what
§1's evidence view will be assembled from.

Every one of these is a **list, or a thing you opened from a list**. There is no
third page shape, which is most of why the app is learnable.

### Reached only from a citation

Five record views — a Slack message in its thread, a Zoom segment at its
timestamp, a Jira issue, a Confluence page, a Miro frame. **No menu entry, no
browse mode, no search across them.** You arrive by clicking a piece of
evidence, and the record opens on the exact line with context either side.

A citation that drops you at the top of a ninety-minute transcript has not
really been followed.

### Under the bonnet

**Sources.** What is connected, what is *in scope* (which channels, which
project, which board), and what failed to join. Coverage, never content — see
§6. This is where the animated connector graph belongs, and it is the answer to
"are we undervaluing the work": the graph stops being the front door and becomes
the credential.

### Deleted as destinations

The five vendor panes. The product lead, 21 Aug:

> It's gonna take you to Jira, and then what? I'm just gonna show you the board
> that you already have… it's pretty redundant.

The storyline lens is demoted the same way — evidence and demo footage, not
somewhere you go. **Nothing built is thrown away; it is re-pointed.**

---

## 4. Two arguments, and how they resolve

**Is there a dashboard at all?** The graph author wants none; the delivery lead wants the hub shown for
thirty seconds as *"the brains behind the scenes"*. They are answering different
questions. The graph author is right about the **product**, the delivery lead is right about the
**video**. Build alert-first with a page per alert type, and put one 20–30 second
cutaway in the film showing the graph as the machinery. A credibility shot is not
an interface.

**When is it correct to say a requirement was missed?** The graph author asked this on
21 Aug — *"is it when you close the epic, or is it continuously alerting you as
you're creating the stories, which would be annoying"* — and answered it himself
eight minutes later without anyone noticing.

**Fire when a container closes.** An epic moves to done, a sprint ends, a retro
is held. That is the only moment that is neither nagging nor too late.

---

## 5. The mechanism

The graph author's checklist idea, 21 Aug:

> It processes those conversations and comes up with a checklist. So the alerts
> are against the checklist. You had a conversation about this thing, and that
> now means you should have these requirements satisfied.

It solves three problems at once: it gives the alert a **trigger** (the container
closing), the demo a **picture** (a list of ticks and one red cross reads
instantly on video), and the model a job it is good at — reading a transcript for
what was promised — while the firing decision stays in deterministic code.

### How it maps onto what exists

A checklist item is a `commitment` note, which `@mc/domain` already defines as
*"a promise made aloud that is not a ticket yet, and may never be one."* Its
`relatedKeys` is the tick: keys present means tracked, empty means not.

```ts
// unticketed after the container closed
n.kind === 'commitment' && n.status === 'open' && n.relatedKeys.length === 0
```

**The one change that makes this possible.** Today a commitment note is only ever
written *when a ticket is created* — `tools.ts`, inside the `create_issue` accept
branch, which stamps `created.key` straight into `relatedKeys`. Every commitment
note in `vault/notes/` therefore has keys, and the state we need to detect is
unreachable. Record the promise when it is made, whether or not anyone files
anything. That is the whole unlock.

`/tidy` already handles the inverse — commitments whose ticket has moved on
(`skills.ts`, case 2). There is no case for a commitment with no key aging.

### Precision gate

**Require a named owner and a date.** A promise with both and no ticket is
unambiguously trackable; "someone should look at that" is not. This is the rule
that keeps the alert believable, and it is exactly the case the demo is built on
— the architect wrote down who owned it and when it was due.

Without this gate the detector nags about everything said aloud and gets muted in
a week, which is the failure `surfaceMemory` is deliberately quiet to avoid.

### What fires, and when

| Alert | Trigger | Status |
|---|---|---|
| missing ticket | epic closes · sprint ends · retro held | needs the change above |
| circular dependency | an arrow closes a loop | exists — cycle detection + canvas poll |
| sources disagree | a new record contradicts a "done" claim | exists — `findContradictions` |
| sprint going sideways | daily, over the active sprint | partly — aging and stalled-blocker signals |

Five of six detectors already exist in some form. The work is re-homing them
behind one type and adding one.

### A `Finding` is not a `WorkSignal`

`WorkRow` hangs signals off a `WorkItem`. The missing ticket has no work item to
hang off — that is the entire point of it. So the subject must be able to be
nothing:

```ts
type FindingSubject =
  | { kind: 'workitem'; key: WorkItemKey }
  | { kind: 'commitment'; noteId: string }   // the ticket that does not exist
  | { kind: 'initiative'; id: string };
```

### Constraints that must not break

- **The scheduler stays read-only.** A findings pass may detect and propose; it
  must not post outward by itself. That is the property that makes a background
  job tolerable.
- **`dedupeKey` on everything it emits**, or two passes leave two identical
  decisions.
- **Check the durable log before repeating**, the way `memory.ts` does.
- **Detection stays deterministic.** A model may propose candidates; the rule
  that fires is code, for the three reasons `skills.ts` is.

---

## 6. Sources shows coverage, never content

The rule that keeps the five vendor panes from returning through the back door:
**Sources answers "what does it know?", never "what did they say?"**

Rows show what is *in scope* — `project PAY · epic, story, bug · last 4 sprints`,
`#eng-platform · #standup · #payments · +3`. You can see and change which
channels are read. You cannot click through and read them. The moment a row
expands into a message list, the Slack pane is back with an extra click in front
of it.

**One exception: the failures.** A block listing what did *not* join — arrows
whose ends do not both resolve to a key, pages naming no ticket, a recording with
no transcript. This is repair, not browsing: you only ever see the records that
failed, never the 98% that did not.

It is nearly free. The connectors already drop exactly these
(`listConnectors`, `listAppCards`, `listStickies`) — silently. Counting them
instead of discarding them is the whole change. And it is the most honest thing
in the product: three arrows pointing at something unresolvable is a dependency
somebody believes they expressed and the system will never see. A cross-origin
iframe can never tell you that.

---

## 7. Later, and the act of deferring

**"Not needed" and "not now" are different answers, and only the second one
produces a note.** This was a hole in the design for several revisions: Later's
whole premise is the case the product lead described on the 21st — *"you want to follow up,
but maybe not immediately"* — and nothing in the app could put anything into it.

So an alert has four actions, and **Not now** asks two questions: the note you
will thank yourself for, and when it should come back. That creates a Later note
carrying the alert's own chip. It is the only route to a tied note.

**A reminder may be an event, not a date.** *When the sprint ends · if anything
changes on it · when the thing it waits on moves · if nobody has touched it in a
week.* This is the half a generic snooze tool cannot do, and it is usually the
honest answer — you are waiting for a person or a ticket, not for Tuesday. It is
also a real implementation commitment: each event option is a watch the findings
pass has to evaluate, which is the same machinery §5 describes.

**A note is editable and nameable**, on its own page. A note you parked yourself
can be given a name; one tied to an issue is already named by the issue.

**Deleting anything is undoable in place** rather than confirmed in advance —
see `DESIGN.md` §7 for why, and for the lifetime rule.

---

## 8. Chat — two moves, not one

**Asking is not navigation. Opening the conversation is.** Conflating them is
what makes chat feel like a mode you have to escape, and separating them is what
lets the full view have an honest "back" button.

- **Asking happens in place.** The composer sits at the foot of the alert, below
  the actions. You type, and the answer appears where you are standing — no
  route change, no modal, nothing to come back from. The citation you were
  reading, the checklist and your question stay on screen together, and
  *Create the ticket* is still directly above you.
- **Opening the conversation is a deliberate move.** A link in the ask header,
  carrying the count. You went somewhere, so there is somewhere to return to.

So the inline thread is **the tail, not the archive** — the last couple of
exchanges. It must be **capped** (say two, with the header reading "showing the
last 2 of 9"), or the alert page grows without bound and the split stops meaning
anything. That cap is the rule the whole design rests on.

It is one thread, not two: what you asked inline is in the full view, and what
you ask there is the tail when you go back.

**A consequence worth planning for.** The alert-scoped conversation inherits its
subject; the global one starts cold. It is tempting to make one component serve
both and then wonder why the global one keeps asking which ticket you mean.

## 9. Where chat history lives

**On the thing the conversation was about — not in a chat archive.** Each alert
carries its own conversations. Reopen a ticket in October and what you asked
about it in August is still there. You retrieve by subject, because that is how
people remember: not "what did I ask on the 19th" but "what did we say about the
Kafka thing". It costs no new page; a global History destination would fail the
§3 test, because you would open it knowing only a date.

The global Ask keeps an ordinary recent list on its own page.

**Already built.** `apps/shell/src/alerts/conversations.ts` persists to
`localStorage` — last 30 conversations, auto-titled from the first message,
coalesced writes, streaming addressed by conversation id. It survives a reload.
It is **per-browser**: different laptop, no history. Fine for a demo, a real gap
later.

**A transcript is a poor record.** This product exists because decisions get lost
inside conversations, so burying its own conclusions in a chat log would be a
strange thing to build. When an exchange reaches something worth keeping it
should offer to save the *finding* to Later — durable, cited, attached to the
ticket rather than to a scroll position.

### Four rules for the chat itself

- It already knows what you are looking at; you never restate the context.
- It cites like the page does, and says when it is inferring rather than reading.
- When the answer is a shape, it draws the shape. A dependency chain read as
  prose is worse than seeing it.
- Every answer can end in an action, so the chat is never a dead end.

---

## 10. Scope — the plan is three projects

The decisions commit to rebuilding the front end, building an alert engine that
does not exist, **and** replacing fixtures with four live connectors that have
never been written. `libs/connectors/src/real/` contains `miro.ts` and nothing
else. Any one of these is a reasonable three-day hackathon; together they are
not.

Rough sizing, deliberately not optimistic:

| Track | Estimate |
|---|---|
| Rebuild the entry point | ≈ 2 days |
| The alert engine | ≈ 1.5 days |
| Four real connectors + data modelling | ≈ 4–6 days |

Roughly seven and a half days into a three-day window, and the largest block is
the one nobody sees on camera. The graph author, in the closing confidence vote:

> The days I've spent trying to get just Jira to work — and then having to do
> that for each of the sources, and then build a use case over stuff. That just
> seems like a lot.

### The recommended call: freeze real data into fixtures

Take one real slice — The delivery lead's Zoom transcripts, one real Jira project export, the
matching Slack channels, the Miro board exported rather than connected — pulled
once and written into the fixture format.

You get what the "real data" argument actually wants (real keys, real names, a
gap that genuinely happened) and keep what live connectors would cost you
(determinism, a demo that cannot break on the day, and about four days). The
connectors stay per-surface and credential-gated, so any one can go live later
without a rewrite. That architecture is what makes this option cheap.

This is a recommendation, not a decision the room made.

### Sequencing

1. **Weekend** — make the data call; take the Jira hierarchy from the graph author's graph
   repo (epic link vs parent link vs advanced-roadmap field is business logic we
   do not have — `WorkItem` stops at `epicKey`); cut the navigation, keep the
   engine.
2. **Day 1** — the gap detector end to end on one case, proved by curling the
   gateway.
3. **Day 2** — the alert list and the missing-ticket page; the Slack bot.
4. **Day 3** — the other two alert types onto the same template, then stop
   building. **Half of day three is filming.**

"Start from zero" should mean a new entry route with nothing inherited — not
deleting the contradiction detector, the citations and the dossier, which are the
substance behind every alert page.

---

## 11. The two questions a judge will ask

**"What stops people gaming this the way they game the deck?"** Nothing here is
self-reported. Every signal is a by-product of work people already do — a message
sent, a sticky written, a status moved. There is no field to set to green. The
only way to change what Mission Control says is to change what actually happened.

**"How do I know it isn't making things up?"** Every claim cites the record it
came from, the model's opinion is visually separated from the records, and when
two sources disagree the tool does not pick a winner — it puts both in front of
the person who can tell. Being the demo that says "here is what I cannot know" is
a differentiator.

---

## 12. Where the material lives

| | |
|---|---|
| Session 1 board (original, untouched) | `«board id»` — 31 stickies, 4 authors |
| Session 2 board (regrouped into 8 themes) | `«board id»` — the agenda both sessions ran on |
| Transcripts | 20 Aug 13:40–15:02, 21 Aug 13:33–14:46, both GMT+1 |

Clickable previews of every page described in §3 were produced alongside this
document and are not in the repo; they are Artifacts on claude.ai.
