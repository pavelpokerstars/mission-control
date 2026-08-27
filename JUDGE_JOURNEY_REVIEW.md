# Judge journey review

**Reviewed:** 27 August 2026, after merging current `main` locally and testing the live Railway deployment.
**Detailed work plan:** `JUDGE_DEMO_PLAN.md`

## Verdict

The product idea is strong and the flagship missing-ticket alert is credible, but the self-guided demo is not ready yet. A judge can see useful evidence, but the experience does not consistently explain how the alert arrived, how Mission Control derived it, or where to go next. The guide is exposing gaps in the app journey rather than causing them.

## What is working

1. The alert list is an effective Mission Control home: concise, urgent, and visually confident.
2. The judge banner colours are distinctive and should remain.
3. The missing-ticket example makes the cross-tool problem tangible: a spoken Zoom commitment, a Miro action, and an absence in Jira.
4. Opening a citation at the relevant transcript line is the right provenance pattern.
5. Inline `Ask about this` is the right conclusion to the investigation because the question should inherit the alert's context.

## What is confusing and why

### Entry

After entering a name, the judge lands directly in an unfamiliar dashboard. There is no short explanation of the work problem or the hand-off from Slack/another notification channel into Mission Control. Styling the alert list as Slack would blur product boundaries; a simulated Slack notification before the dashboard is the clearer solution.

### Alert detail

The page has the right raw material but its labels are implementation-shaped:

- `What PAY Sprint 12 said would happen` sounds as though the sprint itself spoke. `Sprint 12 commitments` is clearer.
- `Why we think this was promised` weakens confidence. `Evidence for this commitment` says what the section contains.
- `The note it was recorded in` does not explain that this is Mission Control's internal saved synthesis, distinct from primary Zoom/Miro evidence.
- `back to the list` omits which list. Use `Back to all alerts`.

The derivation should be explicit: sprint closed; Zoom and Miro contain a dated owned commitment; Jira is the expected action system; no matching issue exists; therefore Mission Control raised a missing-ticket alert.

### Guidance

The four numbered steps are mapped to routes, not completed actions. Clicking the evidence link on step 2 opens a record route that is labelled step 4. The nominal step 3 is the connector coverage screen, which is not on the investigation path. The record screen then tells the judge to Ask even though it has no composer. This is why users become stuck.

The guide should follow actions and the natural path: alert list → alert → cited record → back to alert → inline Ask. It should be hideable and reopenable. `Got it` currently means “dismiss forever,” not “I completed this step.”

### Source record

It is correct that the Zoom record appears inside Mission Control: the product is showing connected evidence, not impersonating Zoom. It needs stronger labelling as a source record and clearer separation between timestamp, speaker, and quote. `Back to this alert` should be the dominant next action.

### Session

The UI claims a private, tab-held 20-minute session. The implementation stores the timer in `localStorage`, so it is shared across tabs, and the generated ID is not used to isolate gateway data. Conversations, Later notes, and actions can therefore be shared. Either implement session namespacing or describe it honestly as a timed demo pass and keep demo mutations simulated.

## AI assessment

There are two separate changes:

1. **Demo infrastructure:** Use OpenRouter's `openrouter/free` route and send `reasoning: { exclude: true }` in the request. This keeps the judge deployment free-only and resilient to individual free models disappearing.
2. **Core Mission Control:** Enrich every alert-scoped question server-side with the alert's full evidence bundle before choosing a provider. At present OpenRouter sees the claim and general recalled context, but not necessarily the Zoom quote, Miro action, checklist, and Jira absence displayed on the page. This change benefits all providers and belongs in `main`.

The corrected Railway key is valid. After changing Railway to `openrouter/free`, the live transport produced a response. That test was not an answer-quality pass: the currently deployed code exposed the model's long thinking trace and the model reached for unrelated vault memories because it lacked the alert evidence bundle. The local reasoning-exclusion change addresses the first problem; the provider-agnostic context work addresses the second.

## Later and Ask

`Later` is valuable when a user accepts that an alert matters but cannot act immediately. `Not now` should visibly park it there and explain when/how it will resurface. It is worth an optional short demo branch, not a mandatory hero step.

Global `Ask` is for programme-wide questions when the user is not already inside an alert. It is a legitimate destination, but the main demo should use inline alert-scoped Ask because that better demonstrates automatic context and provenance. After the guided story completes, both can be offered as optional exploration.

## Recommended three-minute flow

1. Enter name.
2. Read a two-sentence problem pitch.
3. See a clearly simulated Slack notification and choose `Open Mission Control`.
4. Open the top missing-ticket alert.
5. Read the explicit derivation and open the Zoom citation.
6. Return via `Back to this alert`.
7. Ask: “What is the issue here, and what should we clarify at stand-up?”
8. End the guided story; optionally explore Later or global Ask.

The plan should not declare the demo ready until that flow succeeds from a clean session on the live deployment without verbal rescue.
