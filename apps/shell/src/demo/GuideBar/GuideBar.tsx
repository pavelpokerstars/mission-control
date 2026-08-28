/**
 * The strip along the top: what to try next, and how long is left.
 *
 * IT TRACKS WHAT WAS DONE, NOT WHERE YOU ARE. A step number read off the
 * address bar is wrong the first time somebody follows a citation: opening a
 * record is step 2 of the story, and the record page is the deepest address in
 * the app, so the strip would announce the last step while the visitor was on
 * their second click. Worse, wandering to `Later` and back would move the
 * number backwards. So each step is an ACTION, done actions are remembered for
 * the walkthrough, and the strip always names the first one still outstanding.
 *
 * ONE STRIP, NOT TWO. The instruction and the session clock share a single
 * element because they were two fixed elements in an earlier version of this
 * and they overlapped: a bar centred on a 1000px column and a chip pinned to
 * the top-right corner collide at every width between them, which is most
 * laptop widths. Hiding the guide leaves the same strip in the same place,
 * collapsed to the clock and a way back — so nothing on this screen ever moves
 * to somewhere the reader has to look for it.
 *
 * TWO ELEMENTS AND NOT ONE, though, and the outer one is only a colour. The
 * bar is a centred pill; `.mcdemo-strip` is the full-width band it sits on.
 * Without it the pill sat straight on the body, which is `--ground` while every
 * surface from the toolbar down is `--app` — so above 1000px the walkthrough
 * came with two darker margins matching nothing else on the page.
 *
 * IT IS A SIBLING OF THE APP, NEVER A PROP INSIDE IT. `AlertApp` and every
 * component under it are untouched by demo mode — the strip renders above the
 * shell and reads the same two public things any screen reads, the route and
 * the conversation store. That is what makes `MC_DEMO=off` mean the product
 * rather than the product with a wrapper switched off inside it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { useRoute } from '../../alerts/router';
import { useConversations } from '../../alerts/conversations';

import './GuideBar.css';
import {
  clockOf,
  remainingMs,
  GUIDE_DONE_KEY,
  GUIDE_HIDDEN_KEY,
  type DemoSession,
} from '../session';

type ActionKey = 'alert' | 'evidence' | 'ask';

interface Step {
  key: ActionKey;
  label: string;
  text: string;
}

/**
 * The three-click argument, in the order the product makes it: a claim, the
 * records behind it, and a question answered from those same records.
 */
const STEPS: Step[] = [
  {
    key: 'alert',
    label: 'Open the top alert',
    text: 'This is your morning check-in. Open the top alert to see what needs you.',
  },
  {
    key: 'evidence',
    label: 'Open the evidence',
    text: 'Scroll to the evidence and open a source to see exactly why Mission Control raised this alert.',
  },
  {
    key: 'ask',
    label: 'Ask about this alert',
    text: 'Ask Mission Control: \u201CWhat\u2019s the issue here, and what should we clarify at stand-up?\u201D',
  },
];

/** The action a route completes, when it completes one. */
function actionForRoute(name: string): ActionKey | undefined {
  if (name === 'alert') return 'alert';
  if (name === 'record') return 'evidence';
  if (name === 'ask' || name === 'conversation') return 'ask';
  return undefined;
}

function loadDone(sessionId: string): ActionKey[] {
  try {
    const raw = sessionStorage.getItem(GUIDE_DONE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { sessionId: string; done: ActionKey[] };
    return parsed.sessionId === sessionId ? parsed.done : [];
  } catch {
    return [];
  }
}

function saveDone(sessionId: string, done: ActionKey[]): void {
  try {
    sessionStorage.setItem(GUIDE_DONE_KEY, JSON.stringify({ sessionId, done }));
  } catch {
    /* Progress is simply not remembered across a reload. */
  }
}

export function GuideBar({
  session,
  onExpire,
  over,
}: {
  session: DemoSession;
  onExpire: () => void;
  /**
   * WHICH SURFACE THE STRIP IS SITTING ON, and it settles two things at once.
   *
   * The band behind the bar takes that surface's colour — `--app` over the app,
   * `--ground` over the introduction, which is a plain page on the body. And
   * the step guidance is shown only over the app: the introduction has its own
   * "Next:" line at the foot of it, and two of them on one screen is the shape
   * of an interface nagging. The clock appears either way, because it started
   * when the name was entered and a timer you cannot see is one that surprises
   * you.
   *
   * One prop rather than two, because these are one fact. A `surface` that could
   * disagree with a `guidance` is a state nobody would notice was impossible.
   */
  over: 'intro' | 'app';
}): JSX.Element {
  const guidance = over === 'app';
  const route = useRoute();

  /**
   * Asking counts even when it never changes the address.
   *
   * `AskInline.send` streams the answer in place, on the alert page — which is
   * the right behaviour and the reason the route alone cannot see this step
   * happen. So the store is watched instead, and the test is `updatedAt`.
   *
   * NOT `createdAt`, WHICH IS THE OBVIOUS ONE AND IS WRONG. `AskInline` opens
   * the most recent thread about this alert rather than starting a new one —
   * `DIRECTION.md` §8, "it is one thread, not two" — and `alerts/demo.ts` has
   * already seeded one for the alert a visitor is most likely to open first.
   * So the question they type appends to a conversation created hours ago in
   * demo time, `createdAt` never moves, and the guide sat on its third step
   * while the answer streamed underneath it. `touch()` stamps `updatedAt` on
   * every append, which moves for a fresh thread and a continued one alike.
   */
  const asked = useConversations((s) =>
    s.conversations.some((c) => c.turns.length > 0 && c.updatedAt > session.startedAt),
  );

  const [done, setDone] = useState<ActionKey[]>(() => loadDone(session.id));
  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(GUIDE_HIDDEN_KEY) === session.id;
    } catch {
      return false;
    }
  });
  const [left, setLeft] = useState(() => remainingMs(session));

  /**
   * HOW FAR DOWN THE FLOATING CLOCK HAS TO SIT, measured rather than guessed.
   *
   * Collapsed, the clock is `fixed` in the top-right corner — and the app's own
   * toolbar ends in the six connector dots, which are the only way in to
   * Sources. So it floats BELOW that band rather than on it. The band's height
   * is not a constant: `.topbar` wraps, and at 800px it is three rows and 99px
   * against roughly 53px on a wide screen, so any hard-coded offset is wrong at
   * most widths. A media query cannot help either, because where it wraps
   * depends on the width of its own contents.
   *
   * A DOM READ RATHER THAN AN IMPORT. `verify-design.mts` forbids `alerts/`
   * importing from `demo/`; this is the other direction and reads nothing but a
   * height. It is still a coupling to a class name the demo layer does not own,
   * so it fails safe: no toolbar found — the introduction, or a rename — and the
   * fallback clears the tallest toolbar measured.
   */
  const laneRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const lane = laneRef.current;
    if (!lane) return;
    const measure = (): void => {
      /**
       * ONE RULE ON BOTH SURFACES: sit 11px under whatever chrome the page has
       * at the top of it. The app's is `.topbar`, the introduction's is its own
       * `.mcdemo-pagehead` — different elements, same relationship, so the clock
       * does not jump when a reader moves from one to the other.
       *
       * The bottom is taken in PAGE coordinates (`top + scrollY`) rather than
       * viewport ones. This runs on resize as well as at layout, and a resize
       * halfway down the page would otherwise measure a chrome that has scrolled
       * off and pin the clock somewhere near the top of the viewport.
       */
      const chrome = document.querySelector(over === 'app' ? '.topbar' : '.mcdemo-pagehead');
      const bottom = chrome
        ? Math.round(chrome.getBoundingClientRect().bottom + window.scrollY)
        : 0;
      lane.style.setProperty('--mcdemo-float-top', `${(bottom || 108) + 11}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  const complete = (key: ActionKey): void =>
    setDone((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveDone(session.id, next);
      return next;
    });

  useEffect(() => {
    const key = actionForRoute(route.name);
    if (key) complete(key);
    // `complete` closes over `setDone` only, which React keeps stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name, session.id]);

  useEffect(() => {
    if (asked) complete('ask');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, session.id]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  const show = (): void => {
    setHidden(false);
    try {
      sessionStorage.removeItem(GUIDE_HIDDEN_KEY);
    } catch {
      /* ignore */
    }
  };

  const hide = (): void => {
    setHidden(true);
    try {
      sessionStorage.setItem(GUIDE_HIDDEN_KEY, session.id);
    } catch {
      /* ignore */
    }
  };

  // Amber under two minutes, red under thirty seconds. A nudge, not an alarm —
  // and the walkthrough ending is a reset for the next visitor, not a failure.
  const urgency = left < 30_000 ? 'out' : left < 120_000 ? 'low' : undefined;
  /**
   * The first action still outstanding, or nothing once all three are done.
   *
   * judge-demo's guide returns null at that point and leaves the session badge
   * behind it, so the walkthrough ends by getting out of the way rather than by
   * congratulating anybody. Same here: the strip collapses to the clock, and
   * without a `Show guide` button, because there is no longer a guide to show.
   */
  const step = STEPS.find((s) => !done.includes(s.key));

  // `Your 20-minute judge session`, with the length read off the session rather
  // than written into the sentence — `MC_DEMO_MINUTES` may not be 20.
  const length = Math.max(1, Math.round((session.expiresAt - session.startedAt) / 60_000));
  const clock = (
    <span className="mcdemo-clock" data-left={urgency} title={`Your ${length}-minute judge session`}>
      <span className="mcdemo-who">{session.name}</span>
      <span className="mcdemo-time">{clockOf(left)}</span>
    </span>
  );

  /**
   * COLLAPSED: the panel goes, and the clock becomes the way back.
   *
   * Hiding used to leave the full-width band in place carrying a quiet bar, so
   * "hide" removed the gradient and the sentence and kept the furniture — the
   * section did not collapse, it just went grey. Now the band drops to a thin
   * transparent lane and the clock is the only thing in it, pinned right.
   *
   * THE LANE IS RESERVED RATHER THAN FLOATED OVER, and that is deliberate. The
   * obvious version is `position: fixed` in the corner, which is what an earlier
   * revision did and what the header above still warns about: the app's own
   * toolbar ends in the six connector dots at the top right — the only way in to
   * Sources — so a chip pinned there covers the one control it lands on. The
   * lane keeps the strip `sticky`, so the clock still follows the page down and
   * still reads as floating above it, while occupying space of its own that
   * nothing else is drawn in. It cannot overlap anything at any width.
   *
   * The whole pill is the control. A separate `Show guide` button next to a
   * clock is two things to aim at where one will do, and the clock is already
   * the thing a reader's eye goes to.
   */
  if (!guidance || hidden || !step) {
    const restorable = guidance && hidden;
    return (
      <div className="mcdemo-strip" data-over={over} data-collapsed="">
        <div className="mcdemo-lane" ref={laneRef}>
          {restorable ? (
            <button
              type="button"
              className="mcdemo-recall"
              onClick={show}
              title="Show the walkthrough guide again"
              aria-label={`${session.name} — ${clockOf(left)} left. Show the guide again.`}
            >
              {clock}
              <span className="mcdemo-recallhint" aria-hidden="true">
                Show guide
              </span>
            </button>
          ) : (
            clock
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mcdemo-strip" data-over={over}>
      <div className="mcdemo-bar" role="status" aria-live="polite">
        <span className="mcdemo-step">{step.label}</span>
        <span className="mcdemo-text">{step.text}</span>
        {clock}
        <button
          type="button"
          className="mcdemo-toggle"
          onClick={hide}
          aria-label="Dismiss guidance"
        >
          Hide guide
        </button>
      </div>
    </div>
  );
}
