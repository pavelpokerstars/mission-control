/**
 * Our own month grid, because the native one is browser chrome.
 *
 * `DESIGN.md` §6: "The native date panel cannot be restyled and opens in the
 * wrong theme." It is also the only control on the page a reader cannot tell is
 * ours. Monday first, today outlined, past dates disabled, selection filled in
 * `--btn`, drawn on the app's own surfaces — every class here is already in
 * `app.css`, copied from the preview, and none of it was being used.
 *
 * It flips upward when it would overflow `.appwin`, whose `overflow: hidden`
 * would otherwise clip it — the one behaviour in §6 that is not styling.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import './DatePicker.css';

/** `2026-08-24`, in local time — `toISOString()` would shift the day west of UTC. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function plusDays(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** The next Monday — never today, so "Monday morning" is always in the future. */
export function nextWeekday(target: number, from = new Date()): Date {
  const d = new Date(from);
  d.setHours(9, 0, 0, 0);
  const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/**
 * Every dated option shows the date it resolves to — `DESIGN.md` §7, and one of
 * the rules bought with a bug: hand-written dates produced a "Monday morning"
 * that was a Tuesday.
 */
export function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function DatePicker({
  value,
  onChange,
}: {
  /** `YYYY-MM-DD`. */
  value: string;
  onChange: (iso: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => new Date(`${value}T00:00:00`));
  const [up, setUp] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  /**
   * Flip up when there is not room below. Measured on open rather than guessed,
   * because the panel's height depends on how many weeks the month spans.
   */
  useEffect(() => {
    if (!open || !pop.current) return;
    const win = wrap.current?.closest('.appwin');
    if (!win) return;
    const room = win.getBoundingClientRect().bottom - wrap.current!.getBoundingClientRect().bottom;
    setUp(room < pop.current.getBoundingClientRect().height + 12);
  }, [open, cursor]);

  // Click-away and Escape. A panel you can only close by choosing a date is a
  // panel that has trapped you.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  // Weeks start on Monday, so Sunday (0) becomes 6.
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const today = isoDay(new Date());
  // Nothing before tomorrow: "bring it back yesterday" is not a reminder.
  const min = isoDay(plusDays(1));

  return (
    <span className="datepick" ref={wrap}>
      <button type="button" className="datebtn" onClick={() => setOpen((o) => !o)}>
        {fmtDay(new Date(`${value}T00:00:00`))}
      </button>
      {/*
        `.calpop.up` — the preview's own class, not an attribute of my own
        invention. The first version set `data-up` and the logic was correct
        while nothing in the stylesheet listened to it, so the panel measured
        the overflow, decided to flip, and rendered downward anyway. The
        stylesheet is the design; look in it before adding a hook to it.
      */}
      <div className={`calpop${up ? ' up' : ''}`} ref={pop} hidden={!open}>
        <div className="calhead">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(y, m - 1, 1))}
          />
          <span className="mon">
            {new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setCursor(new Date(y, m + 1, 1))}
          />
        </div>
        <div className="calgrid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span className="cdow" key={`${d}${i}`}>
              {d}
            </span>
          ))}
          {Array.from({ length: lead }, (_, i) => <span className="cempty" key={`e${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const iso = isoDay(new Date(y, m, i + 1));
            return (
              <button
                type="button"
                key={iso}
                className={`cday${iso === today ? ' today' : ''}`}
                disabled={iso < min}
                {...(iso === value ? { 'aria-pressed': true as const } : {})}
                onClick={() => {
                  onChange(iso);
                  setOpen(false);
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
    </span>
  );
}
