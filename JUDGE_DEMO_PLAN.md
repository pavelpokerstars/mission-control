# Mission Control — Judge Demo Plan

**Repo:** github.com/pavelpokerstars/mission-control
**Local:** `C:\dev\scratch\mission-control` (cloned to `mc-clone` — dir lock resolved)
**Branch:** `judge-demo` (NOT main)
**Railway project:** `f4959c3c-b8ae-40d9-a55a-88544f4a336d` (mc-judge-demo, production)
**AI key:** `OPENROUTER_API_KEY` — shared Railway variable, read at runtime by the gateway.

## Hard constraints (from the brief)
- **Minimum functional changes.** We are not committing to `main`. All work lands on `judge-demo` and deploys from there.
- **Judge session:** unique temporary session, 20 min, judge enters their name to get in, **no cap on session count** (many judges at once), and the **site loads after they enter their name**.
- **AI assistant** runs through OpenRouter against **free models** using the shared `OPENROUTER_API_KEY`.
- Deliverables: (1) working site, (2) subtle in-UI guidance, (3) written journey review/feedback, (4) a storyboard of the journey, (5) this plan kept in sync with progress.

## Stages & progress

### Stage 0 — Sync & branch
- [x] Clone repo to `C:\dev\scratch\mission-control`
- [x] Create branch `judge-demo` off main
- [ ] Confirm Railway link + shared `OPENROUTER_API_KEY` visible to the service

### Stage 1 — Judge session gate (client-side, minimal)
- [x] Add a name-entry splash in the shell (`main.tsx` / new `JudgeGate` + `gate.tsx`).
- [x] On submit: mint `sessionId` (uuid) + `name` + `expiresAt = now + 20min`, persist in `localStorage`.
- [x] No concurrency cap — each entry is just a new localStorage session.
- [x] On load: if valid (unexpired) session exists, render the app directly; else show gate. After entering name the app renders.
- [x] Show a subtle 20-min countdown + "session expires" note. On expiry, return to gate.
- [x] **Verify:** build passes; gate + badge wired; session logic unit-reviewed.

### Stage 2 — OpenRouter provider (free models)
- [x] Add `apps/gateway/src/openrouter.ts` — OpenAI-compatible client to OpenRouter chat/completions, streaming, reads `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (default free `meta-llama/llama-3.3-8b-instruct:free`).
- [x] Wire into `agent.ts` `createAgent`: `MC_MODE=openrouter` selects it; shares SYSTEM_PROMPT, vault recall.
- [x] Gateway serves built shell (`express.static` over `apps/shell/dist` + SPA fallback); `MC_BIND=0.0.0.0`/`PORT` for Railway; shell `VITE_MC_GATEWAY` same-origin in prod.
- [x] **Verify:** gateway boots `mode=openrouter`, `/api/health` reports openrouter live; `/api/chat` reaches OpenRouter (401 on dummy key proves wiring + SSE + error path); static `/` returns 200 with `#root`, `/api/*` not shadowed.

### Stage 3 — Mimic styling (minimal, surface-aware)
- [x] Added per-surface colour rails (Slack aubergine, Jira blue, Confluence green, Miro amber) + source chips on evidence rows.
- [x] Per-surface top-band tint on each page's topbar; Slack `#` prefix + Confluence header tint.
- [x] Kept to `app.css` additions only; no component rewrites.
- [x] **Verify:** build passes with new CSS.

### Stage 4 — Subtle judge guidance
- [x] Added `Guide.tsx`: a thin 4-step strip that points at the next action per route (check-in → open alert → see sources → ask MC). Dismissible, persists dismissal for the session.
- [x] **Verify:** mounted in `AlertApp`; build passes.

### Stage 5 — Journey review + feedback
- [x] Written `JUDGE_JOURNEY_REVIEW.md` — strengths, risks (latency, hand-off, source-mimic, named conflict, model limits), 3-min tightening, verdict.

### Stage 6 — Storyboard
- [x] `storyboard.html` — 9 frames (gate → problem → morning Slack → check-in → conflict → sources → ask MC → value → close), each with what the judge sees/does + VO beat, drawn in the product's own design language.

### Stage 7 — Commit & deploy
- [ ] `git add` only the intended changes; commit to `judge-demo`; push.
- [ ] Railway: create the service, set `MC_MODE=openrouter`, `MC_BIND=0.0.0.0`, `OPENROUTER_API_KEY` (shared), `OPENROUTER_MODEL`, `PORT`; deploy from `judge-demo`.
- [ ] **Verify:** live URL loads, gate works, chat answers via OpenRouter.

## Open questions / decisions made
- Session gate is **client-side only** (localStorage) → minimum change, no backend auth, satisfies "no cap" and "loads after name".
- Single Railway service serves both gateway API and static shell (no separate frontend host).
- Free OpenRouter model chosen for cost + no card; can be overridden via `OPENROUTER_MODEL`.
