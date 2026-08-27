# Mission Control judge demo — delivery plan

**Last reviewed:** 27 August 2026
**Working copy:** `C:\dev\scratch\mc-clone`
**Demo branch:** `judge-demo`
**Main baseline merged locally:** `origin/main` at `4a4ed31`
**Local merge commit:** `aba5371`
**Deployed application commit:** `dc64af5`
**Live site:** https://mc-judge-demo-production.up.railway.app/
**Detailed experience review:** `JUDGE_JOURNEY_REVIEW.md`

This is the shared progress record for the demo. It deliberately separates temporary demo work from changes that improve Mission Control itself, so core product changes can be proposed to `main` as focused PRs.

## Status key

- `[x]` complete and verified
- `[~]` in progress or complete locally but not yet live
- `[ ]` not started
- `[!]` known problem or decision required

## Current position

1. The demo branch is merged with the latest `main`, pushed, and deployed to Railway at `d252127`. The production build and Railway health check pass.
2. The corrected OpenRouter key is valid. A live request now authenticates, but the pinned `meta-llama/llama-3.3-8b-instruct:free` route returned 404 because it had no available endpoints.
3. Railway's `OPENROUTER_MODEL` is now `openrouter/free`. The deployed reasoning exclusion prevents thinking-trace leakage. The answer still uses unrelated vault memory, so M1 remains a blocker for trustworthy alert-scoped answers.
4. The current guided journey is still structurally confusing: a citation moves from step 2 directly to a record page labelled step 4, while step 3 is actually the connector-coverage page. Route number is not a reliable proxy for task progress.
5. The judge gate is a timer and name prompt, not a private session. Browser and server state are not isolated per judge. The current copy over-promises privacy.
6. `Later` and global `Ask` are useful Mission Control features, but neither should interrupt the primary three-minute demo story.
7. Mock data is treated as an opaque deployment asset during assistant sessions. Inspect schemas, paths, and loading code only; do not read fixture contents unless a future task explicitly requires it.

## Scope rule

### Demo changes

Changes that exist to stage, explain, isolate, or reliably host the judge experience. These stay on `judge-demo` unless separately accepted as a product requirement.

### Mission Control changes

Changes that improve comprehension, provenance, AI grounding, or reliability for every user. These should be implemented provider-agnostically and proposed to `main` in focused PRs.

# A. Demo changes

## D0 — Synchronise and establish the baseline

**Why:** We must assess the demo against current Mission Control, not an older UI, and avoid building polish on files that `main` has already replaced.

- [x] Fetch latest `origin/main`.
- [x] Merge `origin/main` into `judge-demo` without rebasing published history.
- [x] Resolve the two shell conflicts by retaining `main`'s component/CSS structure and re-pointing the demo gate and guide imports.
- [x] Run the production build successfully after installing the new font dependencies.
- [x] Push the merge and deploy the merged application to Railway.
- [!] `npm run verify` cannot run on Windows because `scripts/verify.mjs` constructs `C:\C:\...` paths and spawns `npx` rather than `npx.cmd`. Track as M5; do not treat it as a demo regression.

**Acceptance:** `judge-demo` contains current `main`, `npm run build` passes, and the merge is recorded without rewriting remote history.

## D1 — Make OpenRouter reliable and free-only

**Why:** A pinned `:free` model can disappear. OpenRouter's `openrouter/free` route selects an available free endpoint, whereas `openrouter/auto` may include paid models. Reasoning controls are request options, not part of a model slug.

- [x] Confirm Railway has `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and `MC_MODE=openrouter` without exposing secret values.
- [x] Retest after the key correction: authentication now succeeds; the response changed from 401 to a model-endpoint 404.
- [x] Change the code default from the unavailable pinned model to `openrouter/free`.
- [x] Add `reasoning: { exclude: true }` to streaming chat and structured JSON calls, following the proven Toolbelt/Clive pattern.
- [x] Change Railway `OPENROUTER_MODEL` to `openrouter/free`; redeployment succeeded on 27 August.
- [~] Retest the exact suggested alert question: the live route responds and no longer exposes its thinking trace, but it still reasons from unrelated vault memory. Complete M1 before calling the answer trustworthy or demo-ready.
- [ ] Add bounded 429 retry/backoff from the Toolbelt implementation if free-pool rate limits appear during rehearsal.
- [ ] Ensure errors shown to judges are short, helpful UI states rather than raw provider JSON.

**Ownership:** OpenRouter transport and Railway configuration are demo-only today. The context-grounding change in M1 benefits core Mission Control.

**Acceptance:** A clean judge session gets a useful answer from a free route; logs identify `openrouter/free`; no paid fallback, Copilot credential, or Anthropic credential is used.

## D2 — Make the judge session and guide truthful

**Why:** The current `localStorage` timer is shared across tabs, the session ID is never sent to the gateway, and server-side conversations/actions are shared. After expiry, old route and guide state can survive. “Got it” permanently hides the guide and sounds like step completion when it is only dismissal.

- [x] Fix the first-mount bug that immediately persisted guide dismissal (`e2d0c7e`); not yet live.
- [ ] Replace `localStorage` with `sessionStorage` for the judge identity/timer, or change the copy if cross-tab persistence is intentional.
- [ ] Stop claiming the session is private unless gateway data is genuinely namespaced by session.
- [ ] On expiry, return to the start, clear the demo guide state, clear demo conversations, and reset the route.
- [x] Rename `Got it` to `Hide guide`.
- [x] Scope dismissal to the current judge session and add a persistent `Show guide` affordance beside the timer.
- [ ] Track completed actions rather than deriving step number solely from the current route.
- [ ] Make actions non-mutating/simulated for the shared public demo, or namespace mutations and conversations with a signed session token.

**Acceptance:** Two browser tabs cannot inherit one another's claimed private session; expiry produces a clean start; guidance can always be reopened; one judge cannot alter another judge's story.

## D3 — Add the missing introduction and notification hand-off

**Why:** A new judge currently lands on an unexplained alert dashboard. The product direction says alerts arrive from the tools people already use; the demo needs to show that hand-off without pretending the Mission Control alert list is Slack.

- [ ] Add a short screen immediately after name entry:
  - “Work gets promised in Zoom, Slack and Miro. Jira only knows what got filed.”
  - “Mission Control finds the gap, shows the evidence, and gives you somewhere to act.”
- [ ] Include one clearly labelled simulated Slack notification:
  - “Mission Control — Five things need you.”
  - “One Sprint 12 commitment never became a Jira ticket.”
  - CTA: `Open Mission Control`.
- [ ] Keep the existing judge banner gradient and visual tone.
- [ ] Make it unambiguous that the alert list after the CTA is Mission Control, not a Slack replica.
- [ ] Offer `Skip introduction` for repeat reviewers.

**Acceptance:** Without narration, a first-time judge can state the problem, why the alert arrived, and which screen is Slack versus Mission Control.

## D4 — Rebuild the guided three-minute path

**Why:** The present mapping is `alerts → alert → sources coverage → record`, but the natural evidence path is `alerts → alert → cited record → back to alert → inline Ask`. Clicking evidence currently skips from guide step 2 to guide step 4.

1. [ ] Name entry.
2. [ ] Problem pitch plus simulated Slack notification.
3. [ ] Mission Control morning alert list.
4. [ ] Flagship missing-ticket alert with a clear derivation.
5. [ ] Exact Zoom or Miro source at the cited line.
6. [ ] Explicit `Back to this alert` CTA.
7. [ ] Inline, alert-scoped Ask using the suggested stand-up question.
8. [ ] “Demo complete” moment with optional exploration of Later and global Ask.

Additional guide changes:

- [ ] Replace generic numbered route labels with action language such as `Open the alert`, `Open the evidence`, `Ask about this alert`.
- [ ] Do not make the connector coverage screen a mandatory step. It is supporting product information, not part of the flagship investigation.
- [ ] Do not tell judges to ask from the record screen, where there is no composer.
- [ ] Redirect legacy `/#/...` demo links to the new path-based routes, or update every shared/demo link. After the `main` merge, the old step-4 hash URL falls back to the alert list.

**Acceptance:** Five fresh users can complete the hero path without verbal rescue, visiting each intended screen once and never wondering how to reach the next step.

## D5 — Demo polish, deployment, and rehearsal

**Why:** The live environment must match the reviewed branch, and a clean browser is the only trustworthy way to validate the judge experience.

- [ ] Remove or wire the demo-only source-mimic CSS that currently targets classes/attributes the React components do not emit.
- [x] Add an explicit `.railwayignore` so manual uploads exclude dependencies, secrets, vault working state, and live data while retaining `libs/vault` source.
- [x] Attach Railway volume `mc-judge-demo-volume` at `/data`.
- [x] Seed the current fixture tree once to `/data/fixtures` without parsing its contents.
- [x] Set `MC_GRAPH_DIR=/data/fixtures` and `MC_VAULT_DIR=/data/vault`.
- [x] Exclude `fixtures` and `fixtures-programme` from subsequent CLI uploads and container build contexts via `.railwayignore` and `.dockerignore`.
- [ ] Preserve the banner colours; check contrast and wrapping at laptop widths.
- [ ] Update the storyboard to match the final path.
- [ ] Build, typecheck, and run targeted tests locally.
- [ ] Commit demo changes in reviewable batches.
- [x] Push `judge-demo` and deploy application commit `d252127` to Railway (`8ce597f7-b019-4f99-8bb4-9833823671ca`, successful).
- [ ] Test from a clean session: gate, intro, notification, alert, each source, back path, inline Ask, expiry, guide hide/show, Later, and global Ask.
- [ ] Rehearse once with a cold/free-model response and define a graceful fallback message.

**Acceptance:** Live Railway commit matches the branch, the full path works from an empty browser session, and the demo remains useful if the free pool is slow or temporarily unavailable.

# B. Mission Control changes proposed for `main`

## M1 — Ground alert-scoped AI in the evidence actually shown

**Why:** The browser currently sends only the finding ID/kind/claim, and `/api/chat` does not enrich an alert-scoped request with `findingDetail`. The OpenRouter path has no tools, so it cannot see the Zoom quote, Miro note, checklist, or Jira absence displayed on the page. Saying it “reasons across the connected sources” is therefore inaccurate.

- [ ] Build a compact, provider-agnostic alert context bundle in the gateway from `findingDetail`.
- [ ] Include claim, impact, checklist/tracked state, primary evidence citations/quotes, source labels, timestamps, and relevant derived observations.
- [ ] Put that bundle in `ContextEnvelope` before any provider is selected.
- [ ] Add tests proving alert-scoped Ask receives this evidence for OpenRouter, Copilot, Claude CLI, and future providers.
- [ ] Make the answer distinguish source facts from Mission Control's inference.

**Main value:** This is a core product correctness and provenance improvement, not demo polish. Every assistant provider should answer from the same alert evidence.

**Suggested PR:** `feat(chat): ground alert-scoped questions in finding evidence`.

## M2 — Make alert derivation and provenance self-explanatory

**Why:** The current page exposes ingredients but not the reasoning chain. Several labels force users to interpret internal implementation language.

- [ ] Rename `back to the list` to `Back to all alerts`.
- [ ] Rename `What PAY Sprint 12 said would happen` to `Sprint 12 commitments`, with a summary such as `3 tracked in Jira · 2 missing`.
- [ ] Rename `Why we think this was promised` to `Evidence for this commitment` or `Why this alert fired`.
- [ ] Rename `The note it was recorded in` to `Mission Control's saved context` and identify it as an internal synthesis, not a primary source.
- [ ] Link tracked checklist references to their Jira records.
- [ ] Add a compact derivation block:
  1. Sprint 12 closed.
  2. Zoom and Miro record the commitment, owner, and date.
  3. Jira is the expected system of action.
  4. No matching Jira issue or owner assignment exists.
  5. Result: `Missing ticket`.
- [ ] Use consistent source name, record title, author/speaker, timestamp, quote, and `Open source` affordances.

**Main value:** Faster comprehension and a stronger trust model for every alert type.

**Suggested PR:** `feat(alerts): clarify derivation and provenance`.

## M3 — Improve cited-record readability and return path

**Why:** A Zoom transcript is correctly opened inside Mission Control, but speaker and quote still read as a single inline sentence. The record screen also needs to make its relationship to the alert more explicit.

- [ ] Present speaker, timestamp, and quoted text as distinct visual elements.
- [ ] Clearly label the page as a source record viewed through Mission Control.
- [ ] Retain the cited-line highlight and surrounding context.
- [ ] Use `Back to this alert` and preserve the originating alert ID.
- [ ] Consider a small alert-context rail or CTA, not a global Ask prompt on the record itself.

**Main value:** Better scanning and clearer provenance for any source record.

**Suggested PR:** Can accompany M2 if small; otherwise `feat(records): strengthen cited transcript presentation`.

## M4 — Define Later and Ask in the product information architecture

**Later**

- Purpose: a holding area for alerts a user intentionally parks with `Not now`, including follow-up notes and reminders.
- Product value: prevents a valid alert disappearing just because it cannot be acted on immediately.
- Recommendation: keep it in Mission Control. Show it in the demo only as an optional 20–30 second branch after the hero journey: park an alert, then show where it resurfaces.
- [ ] Make the relationship between `Not now` and `Later` explicit in action copy and confirmation.
- [ ] Clarify whether Later is personal, team-shared, or session-specific.

**Global Ask**

- Purpose: open-ended questions across the programme, such as “What needs me today?” or “Which commitments have no owner?”
- Product value: cross-alert discovery and retrieval when the user does not start from one finding.
- Recommendation: keep it in Mission Control, but do not feature it in the primary demo. Alert-scoped Ask is more differentiated because the evidence context is already known.
- [ ] Give the empty state example questions that demonstrate cross-programme scope.
- [ ] Distinguish it visibly and in copy from `Ask about this alert`.

**Demo decision:** Keep both toolbar tabs visible, mark them as `Explore after walkthrough`, and keep the guided path focused on inline Ask.

## M5 — Repair the Windows acceptance runner

**Why:** `npm run verify` currently fails before running its checks on Windows, which prevents a reliable local acceptance signal.

- [ ] Replace URL `.pathname` handling with `fileURLToPath(import.meta.url)`.
- [ ] Resolve `npx.cmd` on Windows (or invoke the package binaries directly).
- [ ] Add a Windows CI job or a platform-specific smoke test.

**Suggested PR:** `fix(verify): run acceptance checks on Windows`.

# Proposed PR boundaries

1. **Demo branch batch 1:** merge current `main`; free-router fix; reasoning exclusion; plan/review refresh.
2. **Demo branch batch 2:** truthful session semantics; intro/notification; action-based guide; clean expiry.
3. **Main PR 1:** M1 provider-agnostic alert evidence context.
4. **Main PR 2:** M2 + M3 copy, derivation, links, and record presentation.
5. **Main PR 3:** M5 Windows verifier repair.

# Verification log

| Date | Target | Result |
|---|---|---|
| 27 Aug 2026 | Fetch/merge latest `origin/main` | Pass; merge commit `aba5371` created locally |
| 27 Aug 2026 | `npm run build` after merge | Pass |
| 27 Aug 2026 | `npm run verify` | Blocked by existing Windows runner defects; checks did not execute |
| 27 Aug 2026 | Live OpenRouter after key correction | Key valid; pinned model returned authenticated 404 “No endpoints found” |
| 27 Aug 2026 | Railway model change | `OPENROUTER_MODEL=openrouter/free`; redeployment succeeded |
| 27 Aug 2026 | Live `openrouter/free` stand-up question | Transport works; failed answer-quality acceptance due to exposed reasoning and missing alert evidence context |
| 27 Aug 2026 | Deploy merged demo application | Pass at `d252127`; Railway deployment `8ce597f7-b019-4f99-8bb4-9833823671ca` healthy |
| 27 Aug 2026 | Live reasoning-exclusion retest | Pass for no thinking-trace leakage; failed grounding acceptance because alert evidence is absent from chat context |
| 27 Aug 2026 | Legacy hash deep link after `main` merge | Failed; `/#/record/...` falls back to the alert list and needs redirect/update |
| 27 Aug 2026 | Persistent Railway demo storage | Pass; deployment `c726fb3b-c0cb-4ff5-9cef-8153f4b1d616` read graph data and vault state from `/data` |
| 27 Aug 2026 | Fixture-free deployment verification | Pass; deployment `ada03324-d6e8-4708-8ee6-cab7204b6db2` omitted fixture directories from the upload and started against `/data/fixtures` and `/data/vault` |
| 27 Aug 2026 | Judge guide recovery | Pass; deployment `63abbaa3-77f3-450a-9c30-13a56012953e` showed the banner despite the legacy dismissal value, then passed hide and reopen checks |

# Decisions recorded

1. Do not make the Mission Control alert list look like Slack. Show a clearly simulated Slack notification before entering the product.
2. Keep the judge banner colours.
3. Make the guide recoverable and action-based; `Got it` becomes `Hide guide`.
4. Use `openrouter/free`, never `openrouter/auto`, and keep reasoning exclusion in code.
5. Treat AI evidence enrichment as a core Mission Control change; treat OpenRouter hosting/provider wiring as demo-specific for now.
6. Keep Later and global Ask in the product, but outside the hero demo path.
7. Treat mock fixtures as opaque in working sessions and keep runtime demo data on Railway storage rather than repeatedly uploading it.
