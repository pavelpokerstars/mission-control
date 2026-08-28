# From a meeting to a decision

> **Current, and this is the document that joins a meeting to the front door.**
> The promise somebody makes aloud is written into the vault as it is made
> (step 5), and that note is the subject of the flagship alert weeks later.
>
> `/workshop` is a gateway skill and **not a screen**. Nothing in the four pages
> calls it; it is run over `POST /api/skills/workshop` or `inspect.mjs`, and what
> a person eventually sees is an alert on Mission Control. Read every mention of
> a *proposal* below as `act.ts`'s mechanism for carrying a write and its
> provenance — there is no list of them anybody works through, and there must not
> be one.


How a retro or a planning session becomes tickets, a Confluence page, and
memory — and where a human stands in the middle of it.

`ARCHITECTURE.md` explains what each surface owns and the rules between them.
This is the one flow that uses all of them at once.

---

## The problem

A ceremony ends and its output is scattered across three places that do not
know about each other:

- the **recording**, where things were said
- the **board**, where things were written
- **Confluence**, where some of it may already be written down

Someone has to read all three, work out which sticky is the same ask as which
sentence, check what is genuinely new, write a plan, and then re-type it into
Jira. That is an hour, it happens after everyone has left, and none of it makes
the *next* retro any easier.

## The flow

![How a meeting becomes tickets, a page, and memory](./ceremony-flow.svg)

Read it in five. The diagram draws the first four; the fifth happens inside
`/workshop` and is the one that reaches the front door.

**1 · Gather.** `/workshop` reads the transcript, the board's stickies and
arrows, Confluence page bodies, and the vault. The board is the one the
*meeting* was on — see [Pairing a meeting to a board](#pairing-a-meeting-to-a-board).

**2 · Reconcile.** The same action is routinely said aloud *and* written on a
sticky in different words. A naive union proposes it twice, and being asked the
same question twice is how a list of decisions stops being read. `reconcile()`
folds them into one ask per cluster, and records which records asked for it:

| provenance | meaning | rank |
|---|---|---|
| said **and** written | two records agreed, minutes apart | 0.9 |
| board only | somebody deliberately wrote it on an Actions frame | 0.7 |
| said only | one sentence in a recording | 0.5 |
| inferred | a model read it; no cue, no sticky | 0.35 |

Matching is lexical and **tuned to split rather than merge**: a false split is
one more thing to say no to, a false merge silently loses an action item.

**3 · The pack becomes a note you can edit.** The brief is written to a vault
note (`workshop-<transcriptId>`), and the `publish_doc` proposal points *at that
note* rather than carrying a copy of the text. So the page that reaches
Confluence is what you wrote after reading the pack — not what the skill first
assembled.

The note is **never overwritten by a re-run**. Re-running re-renders the brief
in the chat transcript (always current) and leaves your copy alone. Delete it if
you want a fresh one.

**4 · Nothing leaves without a button.** Every outbound write *that changes a
field* is a proposal; a Jira comment is the one exception, and the table below
says why. Accepting a ticket also writes back into the vault — which is the only
part of this that compounds.

`MC_SAFE_MODE` is on unless `.env` explicitly says otherwise, and it refuses
every vendor write. Accepting under it does not create the ticket, the proposal
stays pending, and the vault loop below never runs. `MC_SAFE_MODE=off` on a
fixture makes the same write real against the in-memory connectors — no
credentials, no network. (On the alert page the primary action still reports the
act in the past tense under safe mode; that is deliberate and `act.ts`'s
`pretendItWorked` is where the cost of it is written down.)

**5 · The promise becomes a note whether or not anybody files anything.** Not on
the diagram, and the step everything at the front door rests on. While
`/workshop` reconciles, every action item carrying a **named owner and a date**
is written straight into the vault as a `dated` `commitment` note whose
`relatedKeys` are deliberately **empty** — `skills.ts`, section *4b*. Owner and
date or no note: an ungated version nags about everything anyone said aloud and
gets muted in a week. The date may be inherited from the sprint the promise was
made in, tagged `due-from-sprint` so no later screen can quote back a deadline
nobody spoke.

That empty `relatedKeys` is the entire point, because it is the state no vendor
tool can represent. When the sprint closes, `findMissingTickets` walks the open
commitments and raises every one whose container has closed and which no ticket
somebody typed references — `missing_ticket` if nothing in the sprint looks like
it, `unlinked_commitment` if something does. That is the alert at the top of
Mission Control, and this is the step that wrote its subject. Until this writer existed
the only thing that made a commitment note was `accept_proposal`, which stamps
the new key in as it goes — so every note had keys and the state the alert is
about was unreachable in a live system.

## Why the loop matters

![The four movements, and why only one of them compounds](./ratchet.svg)

Movements 1–3 are what any meeting-notes tool does. Movement 4 is the
difference, and it happens at both ends of the story: step 5 records the promise
the moment it is made, and accepting a ticket closes the same loop —

- if the vault already holds the promise — normally the note step 5 wrote — the
  new Jira key is attached to it, so `/tidy` can retire the note once the work
  moves on, and the alert stops firing because the checklist is now ticked
- if nothing held it, a `dated` `commitment` note is created carrying the
  evidence

Without that, every retro re-derives the same findings from nothing, and the
system can never say *"third sprint running"*.

## Run it

```bash
node scripts/inspect.mjs skill workshop        # most recent recording
```

Or against a specific meeting and board:

```bash
curl -sX POST localhost:8787/api/skills/workshop \
  -H 'content-type: application/json' \
  -d '{"arg":"sprint-14-planning board=uXjVK..."}' | jq -r .brief
```

The response carries `noteId` (the pack) and `boardId` (which board the run was
about, so a caller can say so — the pairing is a fact about the run rather than
a setting). A run writes proposals to the durable log **and creates notes**, so
clean up after a probe: delete the pack note and any `commitment` notes step 5
wrote, then drop the events with `POST /api/vault/log/delete`.

## Pairing a meeting to a board

A ceremony is about one meeting **and** one board. State it once:

```
/workshop sprint-14-planning board=uXjVK...
```

It is recorded as `miro` evidence on that meeting's brief note, so every later
`/workshop sprint-14-planning` finds the same board without the argument. `MIRO_BOARD_ID`
is the last resort, not the default — one process-wide board makes every retro
look like it was drawn on the same canvas, and a sticky from another meeting
merging with a sentence from this one gets stamped *"said and written"*. A false
corroboration is worse than a missing one.

The skill returns `boardId` so a caller knows which board the run was about.

## The rules this flow obeys

| rule | why |
|---|---|
| The model never holds the accept button | `HUMAN_ONLY` withholds `accept_proposal` *and* `reject_proposal` from every provider. Everything the agent reads is untrusted text. |
| A comment is not a field | Provenance lands as a Jira comment — nobody owns it as *state*, so it needs no proposal and cannot start a sync war. |
| One ceremony is one decision | Proposals from a run share a `batch`, so a ceremony is not twelve separate asks. |
| Reject-the-rest, never accept-the-rest — **not built; a rule for whenever a batch is next put in front of somebody** | Nothing implements it, because nothing shows a batch. Written down in advance because a bulk reject costs a proposal that comes back next run, and a bulk accept would create a dozen real tickets from one click. |
| Briefs are never recalled | A pack is assembled *from* the notes underneath it; injecting one would crowd out every note that holds a claim. |
| Skills work with no LLM | Model extraction is additive, behind the cue regexes, and cached so a re-run renders identically. |

## Where the code is

| concern | file |
|---|---|
| the ceremony, reconciliation, the pack, the commitment note (*4b*) | `apps/gateway/src/skills.ts` |
| the alert that commitment eventually raises | `apps/gateway/src/findings.ts` |
| proposals, accept/reject, provenance, the vault loop | `apps/gateway/src/tools.ts` |
| model-assisted extraction (optional) | `apps/gateway/src/extract.ts` |
| batching and confidence (`batch`, `confidence`, `dedupeKey` — no UI) | `apps/gateway/src/tools.ts` |
| note kinds, `Proposal`, `isRecallable` | `libs/domain/src/index.ts` |
| the real Miro board | `libs/connectors/src/real/miro.ts` |

## What it deliberately does not do

- **Write stickies.** Miro owns `position` and `frame`, and a workshop board is
  somebody's thinking in progress. The only write is `exportSnapshot`, into a
  frame we own, laid out clear of everything already there.
- **Guess a ticket for a keyless sticky.** It names one likely artefact in
  prose, hedged, and never puts that guess on a real Jira issue.
- **Claim a decision is documented because a page mentions the ticket.** It
  checks the words, and says "write it down" when they are not there.

## Known limits

See [KNOWN-GAPS.md](./KNOWN-GAPS.md) — in particular: matching is lexical with
no synonyms, and the extractor has never run against a live API key.

`update_issue` is the one proposal kind left with a working accept branch and
nothing that emits it; a producer needs extraction good enough to name a
specific field change. The other two caught up. `post_message` is what
`act.ts`'s `askProposal` builds, which is the primary action on a
`disagreement`, a `cycle`, an `aging` ticket and a `dropped_commitment` — four
of the six kinds that reach the alert list — and `link_issues` is emitted for an
`undetected_dependency`, which is still detected and still reachable from
`list_findings` and Sources, only kept off the list itself.
