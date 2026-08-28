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

import { useEffect, useState, type JSX } from 'react';
import { useRoute } from '../alerts/router';
import { useConversations } from '../alerts/conversations';
import {
  clockOf,
  remainingMs,
  GUIDE_DONE_KEY,
  GUIDE_HIDDEN_KEY,
  type DemoSession,
} from './session';

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

  if (!guidance || hidden || !step) {
    return (
      <div className="mcdemo-strip" data-over={over}>
        <div className="mcdemo-bar" data-quiet="">
          {clock}
          {guidance && hidden && (
            <button type="button" className="mcdemo-toggle" onClick={show}>
              Show guide
            </button>
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
