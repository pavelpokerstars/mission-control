/**
 * Demo mode, as the browser sees it: is it on, and whose walkthrough is this.
 *
 * TWO FACTS, AND THEY COME FROM DIFFERENT PLACES ON PURPOSE. Whether the demo
 * is on is the gateway's to state — `MC_DEMO`, reported by `/api/health` — so
 * that turning it on is a restart rather than a rebuild. Who is walking through
 * it, and how long they have left, is the browser's: a name typed into a card
 * and an expiry, held in `sessionStorage` so a second tab is a second visitor
 * and closing the tab ends it.
 *
 * WHY `sessionStorage` AND NOT `localStorage`. The product's own conversation
 * history uses `localStorage`, correctly — a conversation you had yesterday is
 * still yours. A walkthrough is not: the demo URL is shared, so the state that
 * must not survive is exactly the state that says which visitor this is and how
 * far through they got. `sessionStorage` is per tab and dies with it, which is
 * the lifetime a walkthrough actually has.
 *
 * NONE OF THIS IS AUTHENTICATION. There is no account, the demo data is shared
 * between everybody looking at it, and the timer is enforced by a `setInterval`
 * that any reader could stop. What stops a visitor changing somebody's Jira is
 * `safeMode()` on the gateway, which is on by default and has nothing to do
 * with this file.
 */

/**
 * How the shell answers "is the demo on" before its first paint.
 *
 * THE PRODUCT MUST NOT WAIT FOR THIS. `/api/health` is one same-origin request,
 * but making the app's first render depend on it would put a round trip in
 * front of every reader of every instance — to answer a question that is `false`
 * for all but the demo ones. So the flag is cached in `sessionStorage` and the
 * first paint uses the cached answer: a normal instance renders the app with no
 * delay at all, and a demo instance shows the welcome card immediately on every
 * load after the first in that tab.
 *
 * The fetch still runs, and the answer still wins — the cache is an optimism
 * about what has not changed, not a source of truth. Turning `MC_DEMO` off and
 * restarting corrects a stale cache on the next load, one round trip later.
 */
const FLAG_KEY = 'mc-demo-flag';
const SESSION_KEY = 'mc-demo-session';
/** Whether this visitor has passed the pitch and the hand-off. */
const INTRO_KEY = 'mc-demo-intro';
/** The guide's own two records. They live here so the key names exist once. */
export const GUIDE_DONE_KEY = 'mc-demo-guide-done';
export const GUIDE_HIDDEN_KEY = 'mc-demo-guide-hidden';

export interface DemoConfig {
  on: boolean;
  /** Minutes a walkthrough runs before it returns to the welcome card. */
  minutes: number;
}

const OFF: DemoConfig = { on: false, minutes: 20 };

function readCached(): DemoConfig | undefined {
  try {
    const raw = sessionStorage.getItem(FLAG_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as DemoConfig;
    if (typeof parsed?.on !== 'boolean' || typeof parsed?.minutes !== 'number') return undefined;
    return parsed;
  } catch {
    // Private mode, or storage denied. The fetch below still answers; the only
    // cost is that this tab pays a round trip on every load.
    return undefined;
  }
}

/** The answer to render the first frame with. `undefined` means "not yet asked". */
export function cachedConfig(): DemoConfig | undefined {
  return readCached();
}

/**
 * Ask the gateway, and remember what it said.
 *
 * FAILS TO THE PRODUCT. A gateway that is down, a health route that changed
 * shape, a response that is not JSON — every one of them resolves to `off`,
 * because the alternative is a visitor stuck behind a welcome card on an
 * instance whose whole point is the app behind it. The demo is the deviation;
 * an error is not a reason to deviate.
 */
export async function fetchConfig(api: string): Promise<DemoConfig> {
  let next: DemoConfig = OFF;
  try {
    const res = await fetch(`${api}/api/health`);
    if (res.ok) {
      const body = (await res.json()) as { demo?: Partial<DemoConfig> };
      const on = body.demo?.on === true;
      const minutes = Number(body.demo?.minutes);
      next = { on, minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : OFF.minutes };
    }
  } catch {
    // As above: off.
  }
  try {
    sessionStorage.setItem(FLAG_KEY, JSON.stringify(next));
  } catch {
    /* Not remembering it costs a round trip, nothing else. */
  }
  return next;
}

export interface DemoSession {
  id: string;
  name: string;
  /**
   * Epoch ms this walkthrough began.
   *
   * It is here so the guide can tell what THIS visitor did from what the app
   * came with. `alerts/demo.ts` seeds a conversation history into a cold
   * browser, dated hours and days back, precisely so `Ask` is not empty on the
   * screen that demonstrates retrieving a conversation by subject — and those
   * rows would otherwise read as "they have already asked something" the moment
   * the guide mounted, marking its third step done before the visitor had done
   * anything. A conversation touched after this instant is one they touched;
   * `GuideBar` says why that is `updatedAt` and not `createdAt`.
   */
  startedAt: number;
  /** Epoch ms at which the walkthrough returns to the welcome card. */
  expiresAt: number;
}

function readSession(): DemoSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as DemoSession;
    if (typeof s?.id !== 'string' || typeof s?.name !== 'string') return null;
    if (typeof s?.expiresAt !== 'number' || typeof s?.startedAt !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

/** A walkthrough that exists and has not run out. */
export function validSession(): DemoSession | null {
  const s = readSession();
  if (!s) return null;
  if (Date.now() >= s.expiresAt) {
    endSession();
    return null;
  }
  return s;
}

export function startSession(name: string, minutes: number): DemoSession {
  const startedAt = Date.now();
  const session: DemoSession = {
    id: `d-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    startedAt,
    expiresAt: startedAt + minutes * 60_000,
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* The walkthrough still runs; a reload restarts it at the welcome card. */
  }
  return session;
}

/** Clear every record this file owns, so the next arrival starts where the first did. */
export function endSession(): void {
  for (const k of [SESSION_KEY, INTRO_KEY, GUIDE_DONE_KEY, GUIDE_HIDDEN_KEY]) {
    try {
      sessionStorage.removeItem(k);
    } catch {
      /* The in-memory expiry still returns the visitor to the welcome card. */
    }
  }
}

/** Whether this visitor has already been through the pitch and the hand-off. */
export function introSeen(session: DemoSession): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === session.id;
  } catch {
    return false;
  }
}

export function markIntroSeen(session: DemoSession): void {
  try {
    sessionStorage.setItem(INTRO_KEY, session.id);
  } catch {
    /* A blocked write means the intro replays after a reload. */
  }
}

export function remainingMs(s: DemoSession | null): number {
  return s ? Math.max(0, s.expiresAt - Date.now()) : 0;
}

/** `19:47`, tabular so the strip does not twitch every second. */
export function clockOf(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}
