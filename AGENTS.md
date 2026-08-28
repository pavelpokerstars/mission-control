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

Typecheck, both committed fixtures regenerating byte-identically, four verifiers
and the shell build. A few seconds, no credentials, no network, no server. It is
the closest this repo has to a test suite, because there is no test framework —
so **do not claim a change works because it typechecks**, and do not claim it
works because you curled it either. The interesting bugs here are wiring bugs. Open the browser.

## Two things that differ outside Claude Code

- **`.claude/settings.json` will not run for you.** It registers a `PostToolUse`
  hook (`scripts/typecheck-hook.mjs`) that runs `nx affected -t typecheck` after
  any edit under `apps/` or `libs/` and blocks on type errors. Nothing does that
  automatically here, so run `npm run typecheck:all` yourself after editing —
  it is the authoritative one, stricter than the root `tsc -b`.
- **The provider ladder starts with a login you may not have.** The Claude CLI
  is first and authenticates from a developer's own login, so a machine without
  one falls straight past it to `ANTHROPIC_API_KEY`, and past that to a scripted
  stub; `MC_MODE=live` picks Copilot instead of the ladder and
  `MC_MODE=openrouter` picks OpenRouter. **No rung of it is required** — an
  empty `.env` still runs the whole product over the fixtures, which is the
  headline claim and not a degraded mode. Copilot answers chat *and* structured
  output once `gh auth login` is done: the "structured output does not work"
  this file used to record was two auth gates passing while the turn failed,
  both fixed. `CLAUDE.md`'s provider section and the Copilot entries in
  `KNOWN-GAPS.md` have the detail.
