# Agent instructions

**The working notes are [`CLAUDE.md`](./CLAUDE.md). Read that file — this one is
a pointer, not a summary.**

A summary here would be a second copy of the same rules, free to drift from the
first, which is the failure this repo records more often than any other (one
gutter, one stylesheet, one `days()`, one status map, one list of node kinds).
So there is exactly one set of working notes and every agent reads it.

Read in this order before writing code:

| | |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | **start here** — commands, invariants, and what breaks if you change them |
| [`docs/DIRECTION.md`](./docs/DIRECTION.md) | what the product is and why |
| [`docs/DESIGN.md`](./docs/DESIGN.md) | what the screen does |
| [`docs/design-preview.html`](./docs/design-preview.html) | the clickable target — **it wins over all prose, including `CLAUDE.md`** |
| [`docs/KNOWN-GAPS.md`](./docs/KNOWN-GAPS.md) | read before concluding something here is a bug |

Rule of thumb: **for what exists, `CLAUDE.md` wins. For what to build,
`DIRECTION.md`, `DESIGN.md` and the preview do.** And when code refers to
something that does not exist, the default assumption is that the *code* is
stale — not that the thing needs building. A proposal queue was built once from
exactly that mistake and had to be removed.

## The one command

```bash
npm run verify
```

Typecheck, a byte-identical fixture regenerate, four verifiers and the shell
build. No credentials, no network, no server. It is the closest this repo has to
a test suite, because there is no test framework — so **do not claim a change
works because it typechecks**, and do not claim it works because you curled it
either. The interesting bugs here are wiring bugs. Open the browser.

## Two things that differ outside Claude Code

- **`.claude/settings.json` will not run for you.** It registers a `PostToolUse`
  hook (`scripts/typecheck-hook.mjs`) that runs `nx affected -t typecheck` after
  any edit under `apps/` or `libs/` and blocks on type errors. Nothing does that
  automatically here, so run `npm run typecheck:all` yourself after editing —
  it is the authoritative one, stricter than the root `tsc -b`.
- **The agent provider on this machine is Copilot**, which is only reachable at
  `MC_MODE=live`. `CLAUDE.md`'s provider section has what that costs; the short
  version is that chat works and structured output does not.
