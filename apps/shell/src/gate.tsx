/**
 * Judge Gate — the unique temporary session.
 *
 * Minimal, client-side, no backend change. The brief asks for a judge to get a
 * unique temporary session: they enter their name, get 20 minutes, the site
 * loads straight after, and there is no cap on how many judges enter at once.
 *
 * Doing this in the browser (a localStorage session record) is the smallest
 * change that satisfies all four: each entry is just a new record, so the count
 * is unbounded by construction; the app renders the instant a name is entered;
 * and the 20-minute window is enforced purely on the client, which is fine for a
 * demo where the valuable thing is "the judge can use it" not "the judge is
 * cryptographically fenced out".
 *
 * The record is `mc-judge-session`. On load, `validSession()` returns it when
 * unexpired; otherwise the gate shows and the app does not render. Entering a
 * name writes a fresh record and the app renders on the next tick.
 */

export interface JudgeSession {
  id: string;
  name: string;
  /** Epoch ms when the session expires. */
  expiresAt: number;
}

const KEY = 'mc-judge-session';
/** 20 minutes, in milliseconds. */
export const SESSION_MS = 20 * 60 * 1000;

function read(): JudgeSession | null {
  try {
    const raw = localStorage.getItem(KEY);
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
    localStorage.removeItem(KEY);
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
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

/** Remaining time in ms (0 if none/expired). */
export function remainingMs(s: JudgeSession | null): number {
  if (!s) return 0;
  return Math.max(0, s.expiresAt - Date.now());
}
