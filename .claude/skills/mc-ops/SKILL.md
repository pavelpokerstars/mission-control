---
name: mc-ops
description: Verifying and inspecting Mission Control: what each of the four verifiers in npm run verify asserts, the two named ones that start something (verify-providers, verify-zoom-capture), the scripts/inspect.mjs cookbook against a running gateway, the two vault memory paths and how to clean up after probing them, and how docs/html is generated from the markdown. Use when a verifier fails, when inspecting a running gateway, when probing the vault or the event log, or when editing docs/*.md.
---

# Verifying and inspecting

Area depth for Mission Control. `npm run verify` is THE acceptance command and the fact that
there is no test framework are both in `CLAUDE.md`; this is what each check actually asserts
and how to look at a running gateway.

**The docs are generated, and the markdown is the source.** `npm run docs`
(`scripts/render-docs.mjs`) renders every reference into `docs/html/` with the
app's own palette. Edit the `.md`; never edit the HTML, which carries a
"GENERATED FILE" banner and is overwritten. `docs/html/` is gitignored.

The palette lives once, in `docs/doc.css`, and is inlined into every page so
each one renders standing alone with no server and no stylesheet to resolve. A
page that kept its own copy of the CSS would drift from the rest, which is the
failure this repo keeps paying for elsewhere.

With a gateway running, `scripts/inspect.mjs` is the fast way to look at it:

```bash
node scripts/inspect.mjs up               # are :8787 and :4200 answering
node scripts/inspect.mjs health           # mode, graph dir + counts, status map, tools
node scripts/inspect.mjs statuses         # every vendor status word, and what it became
node scripts/inspect.mjs identities       # who the graph knows, and by which handles
node scripts/inspect.mjs work sam         # one lane, with its signals
curl -s localhost:8787/api/findings       # the alert list, worst first
node scripts/inspect.mjs issue PAY-9031  # one work item's whole context
node scripts/inspect.mjs summary PAY-9031 # the agent's read on where it stands
node scripts/inspect.mjs notes            # note ids + status
node scripts/inspect.mjs log 20           # persisted events
node scripts/inspect.mjs stickies         # the non-Jira half of the board
node scripts/inspect.mjs suggest PAY-9031 # Ask's starter questions from there
curl -s localhost:8787/api/skills | jq -r '.skills[]|"\(.name) — \(.description)"'
node scripts/inspect.mjs skill workshop   # run a ceremony, see its proposals
node scripts/inspect.mjs recall "why is PAY-9031 stuck?"
```

Four verifiers in `npm run verify`, and none needs a running gateway:

```bash
npx tsx scripts/verify-graph.mts       # the contract, the fixture's cases, the detectors
npx tsx scripts/verify-refresh.mts     # baseline, diff, re-baseline
npx tsx scripts/verify-design.mts      # the app against DIRECTION.md §3 and DESIGN.md
npx tsx scripts/verify-collector.mts   # ANY graph against GRAPH-SCHEMA.md — takes a path
```

**The fourth is the one to hand somebody else.** It takes a directory and checks
only what must be true of *any* graph, so it can be pointed at a real
collector's output — which is what turns "does a real refresh conform?" from a
conversation into a command whose output fits in a message:

```bash
npx tsx scripts/verify-collector.mts /path/to/collector/output
```

**Two more are named commands rather than steps**, because each starts
something the acceptance command promises not to. `verify-providers.mts` stands
up a fake Anthropic endpoint and drives a real tool-use loop; `verify-zoom-capture.mts`
starts an HTTP server speaking enough of Zoom Hub to drive the *real* capture
script through real Chrome:

```bash
npx tsx scripts/verify-providers.mts     # a fake model, our real tool loop
npx tsx scripts/verify-zoom-capture.mts  # a fake Hub, the real capture + import
```

The Zoom one is worth knowing about because that collector's input is a
logged-in browser, so it was the one thing here nobody but the session-holder
could check. It asserts the whole path with no credential: the whiteboard and
the off-prefix doc are filtered, the folder is `<title-slug>_<doc id>`,
`capture.json` carries the document id, a re-run opens **no** note at all (the
incremental index, which is the entire cost argument), a rename *moves* the
folder rather than doubling it, and the result imports and satisfies
`GRAPH-SCHEMA.md`. What it cannot tell you is Zoom's own DOM and payload shape —
the field names are the graph author's `browser.py` reading the real thing — so
`--log-api` on the first real run is what settles that.

`verify-collector.mts` splits severity deliberately. A **contract violation** is
a bug in the collector and exits non-zero; an unmapped status word or an
unresolved person is a **configuration gap** — the app runs, something joins less
well than it could — and only warns. Conflating them would make it cry wolf on the first real export,
which is how a check gets ignored. It also prints the `depends_on` edges in
plain English, because the direction cannot be checked structurally — both ways
are well-formed graphs — and reading four sentences settles it in ten seconds.

The third is the newest and the least obvious. It asserts that the shipped app
still has the destinations the direction lists and no others, that the toolbar is
still capped at three, that nothing in the interface is named for a concept the
direction deleted, that the stylesheet has not started a second design system,
that every component stylesheet is imported by its component, and that no two of
them claim one scoping class. It
exists because documents alone did not prevent exactly that — see "Before you
build a screen" in `CLAUDE.md`.

`skill` is the only one of these that writes: a run that proposes appends
`mc.proposal_created` to the durable log, so clean up after a probe the same way
you would after the two memory paths below.

`recall` is the one worth knowing: it posts a turn, parses the SSE stream, and
prints the vault block the agent actually received, with its size. Use it to
confirm memory changes landed rather than guessing from the UI.

The two memory paths, which are the easiest things here to break silently:

```bash
# IN — Slack becomes a note (kind is inferred; check it guessed sensibly)
curl -sX POST localhost:8787/api/slack/capture -H 'content-type: application/json' \
  -d '{"text":"/mc remember we are blocked on the provider secret for MC-103"}' | jq '{id,kind}'

# OUT — a status change makes the vault speak on the ticket
curl -sX POST localhost:8787/api/webhooks/jira -H 'content-type: application/json' \
  -d '{"issue":{"key":"MC-103"},"changelog":{"items":[{"field":"status","toString":"in_progress"}]}}'
curl -s localhost:8787/api/jira/comments | jq -r '.[].body'
```

Both write to the vault, so clean up after: delete the note (`DELETE
/api/vault/notes/:id`), and drop the probe events with `POST /api/vault/log/delete`.
Jira comments are in-memory in mock mode and vanish on the next gateway restart.

