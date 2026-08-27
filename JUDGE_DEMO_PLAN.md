# Mission Control — Judge Demo Plan

**Repo:** github.com/pavelpokerstars/mission-control
**Local:** `C:\dev\scratch\mc-clone` (clone; original `mission-control` dir was process-locked)
**Branch:** `judge-demo` (NOT main)
**Railway project:** `f4959c3c-b8ae-40d9-a55a-88544f4a336d` → service `mc-judge-demo` (`98793a19-…`)
**Live URL:** https://mc-judge-demo-production.up.railway.app
**AI key:** `OPENROUTER_API_KEY` — shared Railway variable, read at runtime by the gateway.

## Hard constraints (from the brief)
- **Minimum functional changes.** Not committing to `main`. All work lands on `judge-demo`.
- **Judge session:** unique temporary session, 20 min, judge enters name to get in, **no cap on session count**, site loads after they enter their name.
- **AI assistant:** OpenRouter, **free models only**, shared `OPENROUTER_API_KEY`. **No Copilot / no Anthropic key** (directive: use OpenRouter instead of CoPilot, free models only).
- Deliverables: (1) working site, (2) subtle in-UI guidance, (3) written journey review, (4) storyboard, (5) this plan in sync with progress.

## Stages & progress

### Stage 0 — Sync & branch
- [x] Clone repo to `mc-clone`
- [x] Create branch `judge-demo` off main
- [x] Shared `OPENROUTER_API_KEY` visible to the service (confirmed after deploy)

### Stage 1 — Judge session gate (client-side, minimal)
- [x] Name-entry splash (`main.tsx` / `JudgeGate.tsx` + `gate.tsx`)
- [x] On submit: mint `sessionId` (uuid) + `name` + `expiresAt = now+20min` in `localStorage`
- [x] No concurrency cap
- [x] On load: valid session → render app; else gate. After name → app renders.
- [x] 20-min countdown badge; on expiry return to gate.

### Stage 2 — OpenRouter provider (free models, NO Copilot)
- [x] `apps/gateway/src/openrouter.ts` — OpenAI-compatible streaming client; reads `OPENROUTER_API_KEY` + `OPENROUTER_MODEL` (default `meta-llama/llama-3.3-8b-instruct:free`).
- [x] Wired into `agent.ts` `createAgent` via `MC_MODE=openrouter`.
- [x] `askOpenRouterStructured` added → inference / extract / summary passes also run on OpenRouter (so alerts keep their claim sentences + inferred edges).
- [x] `structured.ts`: when `MC_MODE=openrouter`, skip Copilot/Claude-CLI probes and use OpenRouter structured backend.
- [x] **CRITICAL FIX — deploy crash:** the gateway was statically importing `@github/copilot-sdk` / `@anthropic-ai/claude-agent-sdk` (native `koffi`, install script blocked on Railway) and dying at startup before listening. Made those imports **dynamic / lazy** in `claude-cli.ts`, `structured.ts`, `copilot.ts` so on the judge deploy they are never loaded. `providerCaps()` also skips the Copilot/Claude probes under `openrouter`.
- [x] Gateway serves built shell (`express.static` over `apps/shell/dist` + SPA fallback); `MC_BIND=0.0.0.0`/`PORT` for Railway; shell `VITE_MC_GATEWAY` same-origin in prod.

### Stage 3 — Mimic styling (minimal, surface-aware)
- [x] Per-surface colour rails (Slack aubergine, Jira blue, Confluence green, Miro amber) + source chips on evidence rows.
- [x] Per-surface top-band tint; Slack `#` prefix + Confluence header tint.
- [x] `app.css` additions only.

### Stage 4 — Subtle judge guidance
- [x] `Guide.tsx`: thin 4-step strip pointing at the next action per route (check-in → open alert → see sources → ask MC). Dismissible per session.

### Stage 5 — Journey review + feedback
- [x] `JUDGE_JOURNEY_REVIEW.md` — strengths, risks, 3-min tightening, verdict.

### Stage 6 — Storyboard
- [x] `storyboard.html` — 9 frames in the product's own design language.

### Stage 7 — Commit & deploy
- [x] Committed to `judge-demo`, pushed.
- [x] Railway service `mc-judge-demo` created; vars `MC_MODE=openrouter`, `MC_BIND=0.0.0.0`, `OPENROUTER_MODEL`, shared `OPENROUTER_API_KEY`; deploys from `judge-demo`.
- [x] **Live verified:** `/api/health` → ok, mode=openrouter, fixtures loaded; `/` → 200 (shell served).
- [ ] **BLOCKER — AI chat 401 "User not found":** the shared `OPENROUTER_API_KEY` value is rejected by OpenRouter as "User not found". Wiring is correct (request reaches OpenRouter with the key; error is key validity, not missing header). **Action needed from Tom:** confirm/refresh the `OPENROUTER_API_KEY` value in the Railway shared variable. Everything else (gate, alerts, sources, storyboard, guidance) works without it.

## Open questions / decisions
- Session gate is client-side only (localStorage) → minimum change, no backend auth.
- Single Railway service serves gateway API + static shell.
- Free OpenRouter model default; overridable via `OPENROUTER_MODEL`.
