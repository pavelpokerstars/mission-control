---
name: mc-agent
description: Everything model-backed in Mission Control: the provider ladder (the Claude CLI first and free, then ANTHROPIC_API_KEY, then Copilot at MC_MODE=live, then a stub), structured output and the in-process MCP transport, the context envelope, Ask's computed starter questions, the per-issue summary, extraction and inference. Use when touching apps/gateway/src/agent.ts, claude.ts, claude-cli.ts, copilot.ts, structured.ts, summary.ts, infer.ts, extract.ts, suggest.ts or chat routes — or when the question mentions a provider, a model, MC_MODE, MC_STRUCTURED, MCP, tool schemas, recall, prompt wording, or why the agent answered the way it did.
---

# The agent, its providers, and structured output

Area depth for Mission Control. `HUMAN_ONLY`, the field-ownership rule and echo suppression
live in `CLAUDE.md`'s invariants and are not repeated here — they bind this area hardest,
because everything the agent reads is untrusted text arriving through tool results.

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

> **On a Copilot-only deployment, which is what this is being run on, read that
> paragraph as describing a rung that is not there.** Copilot is reachable
> *only* at `MC_MODE=live` — `agent.ts`'s `mode()` gates it — so going Copilot
> means setting that variable, and two things follow that are easy to miss:
>
> - **Chat works.** `createCopilotAgent` comes up on `gh auth login` or
>   `GITHUB_TOKEN`, and falls back to the stub with a named warning if it does
>   not. `node scripts/inspect.mjs health` says which provider is about to
>   answer.
> - **Structured output works too, and both halves of why it did not are worth
>   knowing**, because each failed with the auth gate reporting success.
>   `askCopilotStructured` returned `{}` because `GITHUB_TOKEN` was a **personal
>   access token**, which Copilot's endpoint refuses (`Personal Access Tokens
>   are not supported for this endpoint`) while `start()` and `getAuthStatus()`
>   both pass on it. `copilotToken()` deny-lists `ghp_` / `github_pat_` and
>   returns `undefined`, which restores `useLoggedInUser` and the OAuth token
>   the endpoint does accept. And `MC_STRUCTURED=auto` still walked to
>   `sdk-mcp` first, because `claudeCliAvailable()` read `subtype` alone — a
>   logged-out CLI yields `subtype:'success'` with `is_error:true`. Both fixed;
>   `npx tsx scripts/probe-mcp.mts` reports `copilot OK` with a nested schema.
>
> `MC_MODE` used to gate vault seeding as well, so choosing Copilot silently
> emptied the fixture's history and claims and the flagship alert stopped
> firing. That is fixed — seeding follows the graph directory now, never the
> mode.

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

