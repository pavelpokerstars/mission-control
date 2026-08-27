/**
 * Subtle judge guidance — a thin strip that walks a first-time judge through
 * the 3-minute demo journey without ever becoming a modal wall.
 *
 * It tracks what the judge has actually DONE (in sessionStorage, per judge
 * session) rather than deriving a step number from the route. A route is not
 * progress: a citation used to jump the judge from "step 2" straight to a
 * record labelled "step 4", because the step number was read off the address
 * bar. Actions are progress, and each action is named the way the judge would
 * say it:
 *
 *   1. Open the top alert.
 *   2. Open the evidence (a cited source).
 *   3. Ask about the alert.
 *
 * Completed actions are remembered for the session, so a judge who wanders off
 * to Sources or Later and comes back is still told the next thing they have not
 * done — not a step they have already passed. Dismiss the strip and it stays
 * gone for the session; "Show guide" brings it back without forgetting what was
 * done.
 */

import { useEffect, useState, type JSX } from 'react';
import { useRoute } from './alerts/router';
import { GUIDE_ACTIONS_KEY, GUIDE_DISMISS_KEY } from './gate';
import { useConversations } from './alerts/conversations';

type ActionKey = 'openedAlert' | 'openedEvidence' | 'asked';

interface Step {
  key: ActionKey;
  label: string;
  text: string;
}

const STEPS: Step[] = [
  {
    key: 'openedAlert',
    label: 'Open the top alert',
    text: 'This is your morning check-in. Open the top alert to see what needs you.',
  },
  {
    key: 'openedEvidence',
    label: 'Open the evidence',
    text: 'Scroll to the evidence and open a source to see exactly why Mission Control raised this alert.',
  },
  {
    key: 'asked',
    label: 'Ask about this alert',
    text: 'Ask Mission Control: “What’s the issue here, and what should we clarify at stand-up?”',
  },
];

/** The action a route completes, when it completes one. */
function actionForRoute(name: string): ActionKey | undefined {
  switch (name) {
    case 'alert':
      return 'openedAlert';
    case 'record':
      return 'openedEvidence';
    case 'ask':
    case 'conversation':
      return 'asked';
    default:
      return undefined;
  }
}

interface ActionsState {
  sessionId: string;
  done: ActionKey[];
}

function loadDone(sessionId: string): ActionKey[] {
  try {
    const raw = sessionStorage.getItem(GUIDE_ACTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ActionsState;
    return parsed.sessionId === sessionId ? parsed.done : [];
  } catch {
    return [];
  }
}

function saveDone(sessionId: string, done: ActionKey[]): void {
  try {
    sessionStorage.setItem(GUIDE_ACTIONS_KEY, JSON.stringify({ sessionId, done }));
  } catch {
    /* A blocked write means progress is not remembered across refresh. */
  }
}

export function Guide({
  sessionId,
  resetToken,
  onVisibilityChange,
}: {
  sessionId: string;
  resetToken: number;
  onVisibilityChange: (visible: boolean) => void;
}): JSX.Element | null {
  const route = useRoute();
  // Whether any conversation has turns — asking is an ACTION, and the inline
  // composer asks without a route change, so the route alone cannot see it.
  const hasAsked = useConversations((s) => s.conversations.some((c) => c.turns.length > 0));
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(GUIDE_DISMISS_KEY) === sessionId;
    } catch {
      return false;
    }
  });
  const [done, setDone] = useState<ActionKey[]>(() => loadDone(sessionId));

  // Completing the action the current route is for — the whole point: actions,
  // not addresses, are progress.
  useEffect(() => {
    const key = actionForRoute(route.name);
    if (!key) return;
    setDone((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      saveDone(sessionId, next);
      return next;
    });
  }, [route.name, sessionId]);

  // Asking counts even when it happens in place on the alert page.
  useEffect(() => {
    if (!hasAsked) return;
    setDone((prev) => {
      if (prev.includes('asked')) return prev;
      const asked: ActionKey = 'asked';
      const next = [...prev, asked];
      saveDone(sessionId, next);
      return next;
    });
  }, [hasAsked, sessionId]);

  useEffect(() => {
    if (resetToken === 0) return;
    setDismissed(false);
    try {
      sessionStorage.removeItem(GUIDE_DISMISS_KEY);
    } catch {
      /* ignore */
    }
  }, [resetToken]);

  useEffect(() => {
    onVisibilityChange(!dismissed);
  }, [dismissed, onVisibilityChange]);

  if (dismissed) return null;

  // The first action not yet done, or null when the journey is complete.
  const step = STEPS.find((s) => !done.includes(s.key));
  if (!step) return null;

  return (
    <div className="guide" role="status">
      <span className="step">{step.label}</span>
      <span className="txt">{step.text}</span>
      <button
        type="button"
        className="dismiss"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(GUIDE_DISMISS_KEY, sessionId);
          } catch {
            /* ignore */
          }
        }}
        aria-label="Dismiss guidance"
      >
        Hide guide
      </button>
    </div>
  );
}
