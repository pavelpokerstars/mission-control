/**
 * The gate screen and the persistent session badge.
 *
 * `GateScreen` shows only when there is no valid session. It asks for a name,
 * starts a 20-minute session, and the app renders immediately after — the
 * parent swaps it out on submit, so there is no second click and nothing to
 * "load into". (A judge who lands and types their name is in the product the
 * instant they hit enter.)
 *
 * `SessionBadge` is the subtle always-on reminder: who the session is for and
 * how long is left. On expiry it calls `onExpire`, which returns the parent to
 * the gate. It is the one piece of "temporary session" the judge sees after
 * entry, and it is quiet on purpose — a small chip, not a banner.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import { remainingMs, SESSION_MS, type JudgeSession } from './gate';

export function GateScreen({ onEnter }: { onEnter: (name: string) => void }): JSX.Element {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (): void => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onEnter(trimmed);
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-logo">Mission Control</div>
        <h1>Welcome, judge</h1>
        <p className="gate-sub">
          You get a private 20-minute session to explore the demo. Enter your name to begin —
          no account, no limit on how many judges join at once.
        </p>
        <label className="gate-label" htmlFor="judge-name">
          Your name
        </label>
        <input
          id="judge-name"
          ref={inputRef}
          className="gate-input"
          type="text"
          placeholder="e.g. Judge A"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className="gate-btn" disabled={!name.trim()} onClick={submit}>
          Enter the demo
        </button>
        <p className="gate-fine">Your session is temporary and held only in this browser tab.</p>
      </div>
    </div>
  );
}

export function SessionBadge({
  session,
  onExpire,
}: {
  session: JudgeSession;
  onExpire: () => void;
}): JSX.Element {
  const [left, setLeft] = useState(remainingMs(session));

  useEffect(() => {
    const t = setInterval(() => {
      const r = remainingMs(session);
      setLeft(r);
      if (r <= 0) {
        clearInterval(t);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [session]);

  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const clock = `${mm}:${ss.toString().padStart(2, '0')}`;
  // Turn amber under 2 minutes, red under 30 seconds — a nudge, not an alarm.
  const near = left < 30_000 ? 'near' : left < 120_000 ? 'warn' : '';

  return (
    <div className={`session-badge ${near}`} title="Your 20-minute judge session">
      <span className="sb-name">{session.name}</span>
      <span className="sb-clock">{clock}</span>
    </div>
  );
}

export const SESSION_LENGTH_MS = SESSION_MS;
