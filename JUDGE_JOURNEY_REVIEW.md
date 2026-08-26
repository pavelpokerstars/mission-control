# Judge Journey Review & Feedback

**Product:** Mission Control — an AI intelligence layer that reads across Slack, Jira,
Confluence, Miro and Zoom, finds where they disagree, and surfaces it before
stand-up.
**Demo goal:** a judge, in ~3 minutes, should feel *"this is what it's like when my
tools finally talk to each other."*

---

## 1. What the journey does well

- **The problem framing is strong.** "Five sources of truth" is a felt pain for
  every engineering leader. The opening (Slack → Jira → Confluence → Miro → back
  to Slack) is the single most relatable 25 seconds in the script. Keep it, slow
  it down, let it breathe.
- **The "it comes to you" beat is the product's soul.** Mission Control posting
  into Slack rather than being another dashboard is the differentiator. The
  morning-check-in example (3 items, conflict / missing follow-up / dependency)
  is concrete and believable.
- **Investigate → Ask is the right two-act structure.** Seeing *why* an alert
  fired (the sources behind it) before asking the assistant is exactly the
  "not a black box" promise, and it's the part judges will remember.
- **The value section lands the personas** (Scrum Master, Product Owner,
  developer). That's who judges often are.

## 2. Gaps and risks for a live judge

1. **Latency is the make-or-break risk.** The script implies instant answers.
   With a *free* OpenRouter model the first token can take 3–8s. Mitigations we
   built in: the chat shows "Reading across every connected source… this takes a
   moment." Keep that copy — judging a slow answer is fine; a silent spinner
   reads as broken.
2. **The "Open Mission Control" hand-off must be one click.** If the judge has
   to find the app, the morning-notification → investigation beat collapses. We
   added a subtle 4-step guide strip that points at the next action on each
   screen, so a judge who has never seen the product still flows through it.
3. **Visual source-mimic helps judges "get it" fast.** We added thin per-surface
   colour rails (Slack aubergine, Jira blue, Confluence green, Miro amber) and a
   small source chip on evidence rows, so the judge immediately sees *which tool*
   each claim came from — that's the whole thesis made visible.
4. **The "story" needs a named conflict.** The flagship alert (Slack says one
   thing, Jira says another) is the demo. Make sure it loads first and reads as
   a real disagreement, not a synthetic label. The fixtures already do this.
5. **Don't over-promise the assistant.** A free model reasons over the *joined
   context* we hand it (findings + vault recall), not live tool calls. It will
   answer "what's the issue and what to clarify at stand-up?" credibly. It will
   *not* click through Jira. The script's questions stay within that envelope —
   good. Avoid ad-libbing "show me the ticket" live.

## 3. Suggested tightening (3-minute cut)

- **0:00–0:25** problem — keep, maybe add a literal "5 tabs open" frame.
- **0:25–0:45** intro — cut the abstract "missing follow-ups / dependencies /
  stale decisions" list to one line each; the example carries it.
- **0:45–1:05** morning Slack notification — this is the hero shot; hold it.
- **1:05–1:45** investigate — show the *sources* panel, not just the alert.
- **1:45–2:15** ask — type the exact suggested question; don't free-form.
- **2:15–2:40** value — keep the persona trio, drop the slow sequence animation.
- **2:40–3:05** close — end on the logo + "Stop searching. Start knowing."

## 4. Judge-experience verdict

With the judge gate (unique 20-min name-based session, unlimited concurrency),
the source-mimic styling, the guided 4-step strip, and the OpenRouter-backed
assistant, a judge can go **name → morning check-in → open conflict → see
sources → ask Mission Control** with no instruction from you and no waiting on
infrastructure. That's the bar, and it's met.

**One honest caveat:** the assistant is a free model over pre-joined context, so
its answers are good but not Claude-Opus-deep. For a 3-minute impression that's
the right trade (zero cost, zero card, always up). If a judge probes hard, steer
back to "it surfaces the conflict and shows you the sources" — which is the real
product and which always works.
