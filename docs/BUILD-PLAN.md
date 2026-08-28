# Build plan

> **This is the historical sequencing record. `ROADMAP.md` is the live ledger.**
> Every step below has landed, Step 1 included — it is D1 in the roadmap, and
> `/workshop` now writes a `commitment` note when the promise is made. The body
> is deliberately left in the imperative it was written in: a plan read as a
> plan is the only way to see why the order was that order, and rewriting it
> into past tense would turn it into a second, worse copy of the roadmap. Where
> a step landed differently from the way it is instructed here, a note under it
> says so. Read `ROADMAP.md` for what is built and what is left.

**The approach is decided.** Mission Control becomes alert-first, exactly as
`design-preview.html` shows. This file is the bridge from that decision to the
tree, in the order the work should happen.

Read before touching code:

| | |
|---|---|
| `ROADMAP.md` | the live ledger — what is built and what is left |
| `DIRECTION.md` | what we are building and why |
| `DESIGN.md` | what the screen does — the spec |
| `design-preview.html` | what it looks like — open it, click through it |
| `KNOWN-GAPS.md` | what is already broken; read §1 before blaming yourself |

`CLAUDE.md` describes the tree as it stands today. Where the two disagree about
what currently exists, `CLAUDE.md` wins; `docs/design-preview.html` wins over
both about what a screen does.

---

## 1. The one-line summary of the change

The five vendor panes and the two lenses stop being destinations. The front door
becomes a list of findings, each of which opens onto a page carrying its claim,
its evidence and its actions. **Nothing built is thrown away — it is re-pointed.**

---

## 2. What already exists, and what it becomes

Most of this was a re-point rather than a rewrite, and the table is the
argument: every row's left-hand side is still in the tree, doing the same job
behind a different door.

| Existed before, still does | Became | Where |
|---|---|---|
| `GET /api/work` — a ranked lane with `WorkSignal[]` per row | the signals behind an alert | `apps/gateway/src/work.ts`, wrapped by `findings.ts` |
| `GET /api/issue/:key` — the dossier | the alert page's evidence and chain | `apps/gateway/src/issue.ts` |
| `GET /api/issue/:key/summary` | the alert's claim paragraph | `apps/gateway/src/summary.ts` — no screen reads it yet |
| `POST /api/chat` + `conversations.ts` | the conversation pages | `apps/gateway/src/agent.ts`, `apps/shell/src/alerts/conversations.ts` |
| the vault | **Later** | `libs/vault`, `apps/gateway/src/vault.ts` |

**The navigation was not re-pointed. It was deleted**, and §1's "nothing built
is thrown away" is about the engine rather than the screens: the five vendor
panes, the two lens panes and the storyline route went, and what filled them —
the contradiction detector, the citations, the dossier, the summariser — is what
every alert page is now built from. Records survive as a *destination reached
only from a citation* (`apps/shell/src/alerts/RecordView/RecordView.tsx`), which is a
different thing from a pane you could browse to.

Their names are deliberately not listed here. A document that names a deleted
component is how one gets rebuilt — `ROADMAP.md`'s "A wrong turn" is that
mistake already made once, from a stale sentence in shipped code.

**`WorkSignalKind` is already an alert taxonomy** — `disagreement`, `cycle`,
`blocked_by`, `aging`, `unwritten`, `activity`, with severity ranking
(`libs/domain/src/index.ts`). Five of those six detectors exist. The work is
re-homing them behind one type and adding the one that does not.

> **The one type is `FindingKind`, and it grew past this list.** Eight kinds
> ship, of which six reach the front door: `COVERAGE_KINDS` holds `suspect_link`
> and `undetected_dependency`, which are detected and cited like anything else
> but answer *"what is our coverage"* rather than *"what needs you"*, so
> `isAlertKind` sends them to Sources instead. The six names above are a
> different type with different members — `WorkSignalKind` still has all of
> them, still ranking the lane an alert is read from — so neither six may be
> quoted as the other.

---

## 3. The order to build in

Each step is small enough to finish, and each ends in something you can check.
There is no test framework here — verification is **`npm run verify`**, the one
acceptance command: the typecheck, a byte-identical regenerate of both committed
fixtures, the four verifiers and the shell build, in a few seconds with no
credentials, no network and no server. (When this was written that command did
not exist and the answer was `typecheck:all`, `build` and a curl.) Curling the
gateway shows you an answer; it cannot show you that a screen works — curl is
precisely the path that cannot notice a link going nowhere, and one that did is
what "A wrong turn" cost. Open the browser.

### Step 1 — record a commitment when it is made

**The single change everything else rests on.** When this was written, a
`commitment` note was only ever written *when a ticket is created* —
`apps/gateway/src/tools.ts`, inside the `create_issue` accept branch, which
stamps `created.key` straight into `relatedKeys`. So a promise that never became
a ticket could not exist in the vault, and the hero case was undetectable.

Write the note when the promise is extracted, ticket or no ticket. `/workshop`
already finds these (`apps/gateway/src/skills.ts`, and `extract.ts` for the ones
the cue regexes miss).

```bash
curl -s localhost:8787/api/vault/notes | jq '[.[] | select(.kind=="commitment" and (.relatedKeys|length)==0)] | length'
```

Non-zero means the state the detector needs is now reachable.

### Step 2 — the `Finding` type

`WorkRow` hangs signals off a `WorkItem`. The missing ticket **has no work item**
— that is the whole point of it — so the subject must be able to be something
else:

```ts
type FindingSubject =
  | { kind: 'workitem';   key: WorkItemKey }
  | { kind: 'commitment'; noteId: string }
  | { kind: 'initiative'; id: string };
```

In `libs/domain/src/index.ts`, beside `WorkSignal`. Note that a change there
invalidates all five nx projects, so `typecheck:affected` saves nothing.

### Step 3 — the gap detector

A commitment, open, no keys, past its grace window, **gated on owner + date**:

```ts
n.kind === 'commitment' && n.status === 'open' && n.relatedKeys.length === 0
```

The gate is not a limitation — it is what makes the alert believable, and it is
exactly the shape of the case the demo is built on. `/tidy` already handles the
inverse (commitments whose ticket moved on, `skills.ts` case 2); this is the
missing case, not a rewrite of that one.

**Fire when a container closes** — an epic done, a sprint ended, a retro held.
Not continuously; see `DIRECTION.md` §4.

> **What shipped is narrower, and the graph is why.** Exactly two node kinds
> carry a state that can close — `sprint` and `release` — so `findings.ts` keys
> on those. An epic here is a relation between issues rather than a node with a
> state, and nothing models a retro at all. The rule is unchanged; the list of
> things it can watch is shorter than the sentence above promises.

### Step 4 — the findings route and the scheduler slot

A route that returns `Finding[]`, and a slot in `apps/gateway/src/scheduler.ts`
beside `standup` and `tidy`.

Three constraints, all load-bearing:

- **The scheduler writes no field and changes no note.** It reads, it detects,
  and what it produces takes a human before it becomes a vendor write. That is
  the property that makes a background job tolerable.
- **`dedupeKey` on everything it emits**, or two passes leave two identical
  decisions.
- **Check the durable log before repeating**, the way `memory.ts` does — a
  restart must not re-announce a finding it already announced.

> **It landed as four slots, and the first constraint had to be stated more
> carefully.** `SCHEDULE` is `refresh` 07:00, `standup` 08:00, `refresh-pm`
> 19:00, `tidy` 22:00 — the two edges of a working day, each re-derive followed
> by the ceremony that reads it. The route is `GET /api/findings`; the findings
> pass runs inside `refreshJob` rather than in a slot of its own, because a
> notification is about something that just changed and asking on a timer of its
> own would announce yesterday's state every morning.
>
> **And it does post outward — once, deliberately, through one door.** Step 6's
> Slack transport is reached from `refreshJob` via `notify()`, so "the scheduler
> posts nothing" is no longer the true sentence and must not be quoted as one.
> The accurate property is the bullet above plus five gates on that single
> outbound act: `MC_SAFE_MODE` is on unless explicitly turned off and refuses it
> along with every vendor write; it is off again unless `MC_SLACK_WEBHOOK_URL`
> is set; it is deduplicated against the durable log, so nothing is announced
> twice; it refuses to announce a baseline run at all, because a first pass sees
> a quarter of history as new; and what it sends is a **pointer** — a headline,
> the detector's own line about why it matters, and a link to the alert. The
> evidence stays on this machine.

### Step 5 — the front end

Build from `DESIGN.md` plus the preview. In order: the list, then one alert page,
then the conversation, then Later.

**"Start from zero" means the navigation, not the engine.** The contradiction
detector, the citations, the dossier and the summariser are the substance behind
every alert page. Delete the pane switcher and the sidebar; keep what fills them.

A finding is not a vendor and must never reach `FIELD_OWNER` or an
`Evidence.surface` — so **never widen `Surface`**. (This step originally read
"widen `PaneId`"; `Lens` and `PaneId` went with the pane app rather than being
widened, and `libs/domain/src/index.ts` records why.)

### Step 6 — the Slack bot

Planned as small and outside this repo: the company Slack cannot be posted to,
so it runs on a server we control. It is most of the "proactive" claim and it is
the last thing to build, because everything above works without it.

> **Built, and it stayed in this repo** — `slackBot` in
> `apps/gateway/src/notify.ts`, `ROADMAP.md` **G2**. An *incoming webhook* whose
> button is a plain link, so Slack never posts back and nothing needs a public
> request URL. That is what let it ship without waiting on the hosting decision.
> One env var, `MC_SLACK_WEBHOOK_URL`; unset, the review inbox carries the run
> alone.

---

## 4. Fixtures before connectors

The recommendation in `DIRECTION.md` §10 stands: **take one real slice and freeze
it into fixtures** rather than writing four live connectors. At the time,
`libs/connectors/src/real/` contained `miro.ts` and nothing else and the other
four surfaces were mock-only — days of work whose output nobody sees on camera.

> **What happened instead, and it is the better outcome.** The mock connectors
> were deleted and `createGraphConnectors` projects all five surfaces out of
> `graph.json`, so the fixture *is* a collector's output rather than a parallel
> data shape. The five collectors were then written as offline emitters into
> that same file — `ROADMAP.md` track B. Miro remains the only live vendor
> client. Freezing a slice and connecting a source became the same act, which is
> what made both affordable.
>
> **And there are two slices now, not one.** `fixtures/` is the demo, and
> `fixtures-programme/` is the larger one that answers "does this hold at
> programme size"; `npm run verify` regenerates both and fails on a byte of
> drift in either. A second fixture is only affordable because of the paragraph
> above — it is the same emitters writing the same file, not a second data shape
> to maintain.

Two fixture jobs are needed either way:

- **A commitment with no ticket**, with a named owner and a due date, evidenced by
  a Zoom line and a Miro sticky. Without it the detector correctly finds nothing.
- **Hierarchy.** `WorkItem` stops at `epicKey`. The graph author's Jira graph repo already
  encodes epic link vs parent link vs the advanced-roadmap fields — take that
  rather than deriving it again. One level ("this affects Initiative X") is
  enough for the demo; the full cascade is a roadmap slide.

---

## 5. Rules that will bite you

From `DESIGN.md` §8 and `KNOWN-GAPS.md`, repeated because they cost real time:

- **Anything that states a count reads it from the collection.** Never a literal.
- **Every date derives from one constant.** Hand-written dates produced a sprint
  closing on a Saturday.
- **`typecheck:all` is authoritative**, not the root `tsc -b` — the root check is
  weaker and lets `process.env` into browser-safe libs.
- **`@mc/vault` is gateway-only** and deliberately absent from the vite aliases.
  Don't "fix" that.
- **Check `claude-cli.ts` as well as `claude.ts`.** Three provider bugs so far
  have been one-sided — correct on the Messages API path, broken on the CLI one:
  `zodShape` not recursing into nested objects, a resumed thread losing its
  history after a restart, and `subtype: 'success'` being read as a verdict when
  a logged-out CLI returns it alongside `is_error: true`. The first and third
  are fixed; the second is open in `KNOWN-GAPS.md` §1. A one-sided bug reads as
  the model being stupid rather than as a wiring fault, which is what makes it
  expensive. And it is no longer two paths: `copilot.ts` and `openrouter.ts` are
  model backends too — the second chosen by `MC_MODE=openrouter` rather than
  fallen back to — with a scripted stub underneath them all so an empty `.env`
  still answers. A fix on one seam has to be checked on every one of them.
- **A class name is a namespace.** Three collisions so far, each silent.

---

## 6. First session checklist

```bash
npm install          # node_modules may be empty in a fresh checkout
npm run verify       # the acceptance command — a few seconds, no credentials
npm run dev          # shell :4200, gateway :8787
node scripts/inspect.mjs health
node scripts/inspect.mjs work sam
npm run docs                        # docs/html/ is generated and gitignored
open docs/html/everything.html      # all the documentation, one page
open docs/design-preview.html       # the target — committed, open it off disk
```

Then Step 1. It is the smallest change with the largest consequence, and nothing
else can be demonstrated until it lands.
