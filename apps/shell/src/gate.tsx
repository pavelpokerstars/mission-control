/**
 * Judge Gate — the unique temporary session.
 *
 * Minimal, client-side, no backend change. The brief asks for a judge to get a
 * unique temporary session: they enter their name, get 20 minutes, the site
 * moves into a short introduction, and there is no cap on how many judges enter
 * at once.
 *
 * Doing this in the browser (a sessionStorage session record) is the smallest
 * change that satisfies all four: each entry is just a new record, so the count
 * is unbounded by construction; the app renders the instant a name is entered;
 * and the 20-minute window is enforced purely on the client. This is walkthrough
 * state, not authentication or isolation of the shared demo data.
 *
 * The record is `mc-judge-session`. On load, `validSession()` returns it when
 * unexpired; otherwise the gate shows and the app does not render. Entering a
 * name writes a fresh record and starts the introduction on the next tick.
 */

export interface JudgeSession {
  id: string;
  name: string;
  /** Epoch ms when the session expires. */
  expiresAt: number;
}

const KEY = 'mc-judge-session';
const INTRO_KEY = 'mc-judge-intro-complete';
const GUIDE_KEY = 'mc-judge-guide-dismissed';
/** 20 minutes, in milliseconds. */
export const SESSION_MS = 20 * 60 * 1000;

function read(): JudgeSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as JudgeSession;
    if (typeof s?.id !== 'string' || typeof s?.name !== 'string') return null;
    return s;
  } catch {
    return null;
  }
}

/** A session that exists and has not expired. */
export function validSession(): JudgeSession | null {
  const s = read();
  if (!s) return null;
  if (Date.now() >= s.expiresAt) {
    clearSession();
    return null;
  }
  return s;
}

/** Create a fresh 20-minute session for `name` and persist it. */
export function startSession(name: string): JudgeSession {
  const session: JudgeSession = {
    id: `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim(),
    expiresAt: Date.now() + SESSION_MS,
  };
  sessionStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

/** Whether this judge has passed the pitch and simulated Slack hand-off. */
export function introComplete(session: JudgeSession): boolean {
  try {
    return sessionStorage.getItem(INTRO_KEY) === session.id;
  } catch {
    return false;
  }
}

/** Persist completion for this tab and this judge session only. */
export function completeIntro(session: JudgeSession): void {
  try {
    sessionStorage.setItem(INTRO_KEY, session.id);
  } catch {
    /* A blocked storage write means the intro may replay after refresh. */
  }
}

/** Remove all judge-shell state. Product data is reset by the shell itself. */
export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
    sessionStorage.removeItem(INTRO_KEY);
    sessionStorage.removeItem(GUIDE_KEY);
    // Clean up records written by the earlier cross-tab implementation.
    localStorage.removeItem(KEY);
  } catch {
    /* The in-memory expiry still returns the judge to the gate. */
  }
}

/** Remaining time in ms (0 if none/expired). */
export function remainingMs(s: JudgeSession | null): number {
  if (!s) return 0;
  return Math.max(0, s.expiresAt - Date.now());
}
