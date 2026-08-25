# Build plan

> **`ROADMAP.md` is the live ledger; this is the reasoning behind it.** Every
> step below has landed, Step 1 included — it is D1 in the roadmap, and
> `/workshop` now writes a `commitment` note when the promise is made. Read this
> for *why* the work was sequenced this way; read `ROADMAP.md` for what is left.

**The approach is decided.** Mission Control becomes alert-first, exactly as
`design-preview.html` shows. This file is the bridge from that decision to the
tree, in the order the work should happen.

Read before touching code:

| | |
|---|---|
| `HACKATHON.md` | how the direction was decided — local only, not published |
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

Most of this is a re-point, not a rewrite. Verified against the tree:

| Today | Becomes | Where |
|---|---|---|
| `GET /api/work` — a ranked lane with `WorkSignal[]` per row | **Mission Control**, the alert list | `apps/gateway/src/work.ts` |
| `GET /api/issue/:key` — the dossier | the alert page's evidence and chain | `apps/gateway/src/issue.ts` |
| `GET /api/issue/:key/summary` | the alert's claim paragraph | `apps/gateway/src/summary.ts` |
| `POST /api/chat` + `conversations.ts` | the conversation pages | `apps/gateway/src/agent.ts`, `apps/shell/src/components/conversations.ts` |
| the vault | **Later** | `libs/vault`, `apps/gateway/src/vault.ts` |
| `GET /api/storyline` | **Sources**, and the "show me the loop" action | `apps/gateway/src/main.ts` |
| `FocusPane` / `StorylinePane` / `VaultPane` / vendor panes | record views, reached only from a citation | `apps/shell/src/panes/` |

**`WorkSignalKind` is already an alert taxonomy** — `disagreement`, `cycle`,
`blocked_by`, `aging`, `unwritten`, `activity`, with severity ranking
(`libs/domain/src/index.ts`). Five of six detectors exist. The work is re-homing
them behind one type and adding the one that does not.

---

## 3. The order to build in

Each step is small enough to finish, and each ends in something you can check.
There is no test framework here — verification is `npm run typecheck:all`,
`npm run build`, and curling the gateway.

### Step 1 — record a commitment when it is made

**The single change everything else rests on.** Today a `commitment` note is
only ever written *when a ticket is created* — `apps/gateway/src/tools.ts`,
inside the `create_issue` accept branch, which stamps `created.key` straight into
`relatedKeys`. So a promise that never became a ticket cannot exist in the vault,
and the hero case is undetectable.

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
invalidates all six nx projects, so `typecheck:affected` saves nothing.

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

### Step 4 — the findings route and the scheduler slot

A route that returns `Finding[]`, and a slot in `apps/gateway/src/scheduler.ts`
beside `standup` and `tidy`.

Three constraints, all load-bearing:

- **The scheduler stays read-only.** It may detect and propose; it must not post
  outward by itself. That is the property that makes a background job tolerable.
- **`dedupeKey` on everything it emits**, or two passes leave two identical
  decisions.
- **Check the durable log before repeating**, the way `memory.ts` does — a
  restart must not re-announce a finding it already announced.

### Step 5 — the front end

Build from `DESIGN.md` plus the preview. In order: the list, then one alert page,
then the conversation, then Later.

**"Start from zero" means the navigation, not the engine.** The contradiction
detector, the citations, the dossier and the summariser are the substance behind
every alert page. Delete the pane switcher and the sidebar; keep what fills them.

Widen `PaneId`, never `Surface` — a finding is not a vendor and must never reach
`FIELD_OWNER` or an `Evidence.surface`.

### Step 6 — the Slack bot

Small, and outside this repo: the company Slack cannot be posted to, so it runs
on a server we control. It is most of the "proactive" claim and it is the last
thing to build, because everything above works without it.

---

## 4. Fixtures before connectors

The recommendation in `DIRECTION.md` §10 stands: **take one real slice and freeze
it into fixtures** rather than writing four live connectors. `libs/connectors/src/real/`
contains `miro.ts` and nothing else; Jira, Slack, Zoom and Confluence are all
mock-only, and that is days of work whose output nobody sees on camera.

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
- **Check `claude-cli.ts` as well as `claude.ts`.** Two provider bugs so far have
  been correct on the API path and broken on the CLI path — which is the default.
  One is still open; see `KNOWN-GAPS.md` §1.
- **A class name is a namespace.** Three collisions so far, each silent.

---

## 6. First session checklist

```bash
npm install          # node_modules may be empty in a fresh checkout
npm run typecheck:all
npm run dev          # shell :4200, gateway :8787
node scripts/inspect.mjs health
node scripts/inspect.mjs work sam
open docs/html/everything.html      # all the documentation, one page
open docs/design-preview.html       # the target
```

Then Step 1. It is the smallest change with the largest consequence, and nothing
else can be demonstrated until it lands.
