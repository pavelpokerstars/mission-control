/**
 * Demo mode — the guided walkthrough that wraps the product, and nothing else.
 *
 * OFF UNLESS SOMEBODY SAID SO, which is the mirror image of `safe-mode.ts` and
 * the same argument read the other way round. Safe mode is on unless explicitly
 * turned off, because the failure it prevents is irreversible. This is off
 * unless explicitly turned on, because what it adds is *not the product*: a
 * welcome card, a one-page pitch, a simulated hand-off and a strip of tips.
 * Every one of those is the right thing to show a visitor and the wrong thing
 * to put in front of somebody doing their morning triage. A typo must fall to
 * the product, never to the demo — so the check is an allow-list rather than
 * `!== 'off'`.
 *
 * WHY IT LIVES ON THE GATEWAY AND NOT IN `VITE_`. A `VITE_` variable is baked
 * into the bundle at build time, so turning the demo on or off would mean a
 * rebuild and a redeploy. This is read per request from `/api/health`, which
 * the shell already asks for, so the switch is a restart — and on a hosted
 * service it is one variable in a dashboard. It is also where every other fact
 * about how this instance is configured already lives: the mode, the per-surface
 * connectors, safe mode. A second mechanism for the same kind of answer is how
 * two of them come to disagree.
 *
 * READ AT CALL TIME, NOT AT MODULE SCOPE — the lesson `safe-mode.ts` and
 * `structured.ts` both record. Captured at import, a script that sets it per
 * case silently gets whichever value was current when the module first loaded.
 */

/** The only spellings that turn it on. Anything else, including a typo, is off. */
const ON = new Set(['on', 'true', '1', 'yes']);

export function demoMode(): boolean {
  return ON.has((process.env.MC_DEMO ?? '').trim().toLowerCase());
}

/**
 * How long a walkthrough runs before it returns to the welcome card.
 *
 * THE TIMER IS A RESET, NOT A LIMIT. A demo URL that several people open in a
 * day accumulates one visitor's wandering as the next one's starting state —
 * conversations they did not have, a guide already halfway through. Expiry is
 * what makes the next arrival's first screen the same as the first arrival's.
 * It is enforced in the browser and it is not a security boundary; the demo
 * data is shared and `safeMode()` is what stops anything being written outward.
 *
 * Clamped rather than validated: a `0` or a `-1` from a mistyped variable would
 * expire the session on the tick after it started, which reads as the app being
 * broken rather than as the variable being wrong. One minute is the floor
 * because it is still demonstrably a timer; four hours is a ceiling nobody
 * needs to exceed and a runaway value cannot get past.
 */
const DEFAULT_MINUTES = 20;
const MIN_MINUTES = 1;
const MAX_MINUTES = 240;

export function demoMinutes(): number {
  const raw = Number((process.env.MC_DEMO_MINUTES ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(raw)));
}

/** What `/api/health` reports, so the shell asks one question and gets both. */
export function demoConfig(): { on: boolean; minutes: number } {
  return { on: demoMode(), minutes: demoMinutes() };
}
