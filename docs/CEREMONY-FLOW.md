# From a meeting to a decision

> Still accurate about `/workshop` and the proposal path, which are unchanged.
> Written before the alert-first direction, so the *destination* of a ceremony is
> surfaced as a finding on the alert list. See `ROADMAP.md`.


How a retro or a planning session becomes tickets, a Confluence page, and
memory — and where a human stands in the middle of it.

`ARCHITECTURE.md` explains the six surfaces and the rules between them. This is
the one flow that uses all of them at once.

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

Read it in four steps.

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

Matching is lexical and **tuned to split rather than merge**: a false split is a
second proposal to reject in one click, a false merge silently loses an action
item.

**3 · The pack becomes a note you can edit.** The brief is written to a vault
note (`workshop-<transcriptId>`), and the publish proposal points *at that note*
rather than carrying a copy of the text. So the page that reaches Confluence is
what you wrote after reading the pack — not what the skill first assembled.

The note is **never overwritten by a re-run**. Re-running re-renders the brief
in the chat transcript (always current) and leaves your copy alone. Delete it if
you want a fresh one.

**4 · Nothing leaves without a button.** Every outbound write is a proposal.
Accepting a ticket also writes back into the vault — which is the only part of
this that compounds.

## Why the loop matters

![The four movements, and why only one of them compounds](./ratchet.svg)

Movements 1–3 are what any meeting-notes tool does. Movement 4 is the difference:

- if the vault already holds the promise, the new Jira key is attached to it, so
  `/tidy` can retire the note once the work moves on
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
about, so a caller can say so — the pairing is a fact about the run, and
embed). A skill run writes proposals to the durable log, so clean up after a
probe — delete the note and drop the events with `POST /api/vault/log/delete`.

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
| The model never holds the accept button | `HUMAN_ONLY` withholds `accept_proposal` from every provider. Everything the agent reads is untrusted text. |
| A comment is not a field | Provenance lands as a Jira comment — nobody owns it as *state*, so it needs no proposal and cannot start a sync war. |
| One ceremony is one decision | Proposals from a run share a `batch`, so a ceremony is not twelve separate asks. |
| Reject-the-rest, never accept-the-rest | A bulk reject costs a proposal that returns next run. A bulk accept creates a dozen real tickets from one click. |
| Briefs are never recalled | A pack is assembled *from* the notes underneath it; injecting one would crowd out every note that holds a claim. |
| Skills work with no LLM | Model extraction is additive, behind the cue regexes, and cached so a re-run renders identically. |

## Where the code is

| concern | file |
|---|---|
| the ceremony, reconciliation, the pack | `apps/gateway/src/skills.ts` |
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
no synonyms, `update_issue`/`link_issues`/`post_message` have working accept
branches but nothing emits them yet, and the extractor has never run against a
live API key.
