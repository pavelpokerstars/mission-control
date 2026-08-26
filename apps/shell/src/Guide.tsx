/**
 * Subtle judge guidance — a thin strip that walks a first-time judge through
 * the 3-minute demo journey without ever becoming a modal wall.
 *
 * It reads the live route and shows the one next step that matches where the
 * judge is. Dismiss it and it stays gone for the session (localStorage), so a
 * judge who knows the path can get it out of the way in one click — but one who
 * is seeing the product for the first time gets a pointer at each stage:
 *
 *   1. You are on the morning check-in (the alert list) — open the top alert.
 *   2. You are on an alert — open its sources to see why it fired.
 *   3. You are on sources — open the conflict between Slack and Jira.
 *   4. You are anywhere — ask Mission Control in the chat.
 *
 * The mapping is intentionally loose (a step shows for a set of routes) so the
 * judge is never told something false about where they are.
 */

import { useEffect, useState, type JSX } from 'react';
import { useRoute } from './alerts/router';

const DISMISS_KEY = 'mc-judge-guide-dismissed';

interface Step {
  when: string[];
  label: string;
  text: string;
}

const STEPS: Step[] = [
  {
    when: ['alerts'],
    label: 'STEP 1',
    text: 'This is your morning check-in. Mission Control already read across every tool — open the top alert to see what needs you.',
  },
  {
    when: ['alert'],
    label: 'STEP 2',
    text: 'This alert shows a conflict between sources. Scroll to the evidence and open a source to see exactly why Mission Control raised it.',
  },
  {
    when: ['sources'],
    label: 'STEP 3',
    text: 'These are the tools Mission Control connects. Notice Slack, Jira, Confluence and Miro are all represented — that is what it reasons across.',
  },
  {
    when: ['ask', 'conversation', 'later', 'note', 'record'],
    label: 'STEP 4',
    text: 'Ask Mission Control. Try: "What’s the issue here, and what should we clarify at stand-up?" — it reasons across the connected sources.',
  },
];

export function Guide(): JSX.Element | null {
  const route = useRoute();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }, [dismissed]);

  if (dismissed) return null;

  const step = STEPS.find((s) => s.when.includes(route.name));
  if (!step) return null;

  return (
    <div className="guide" role="status">
      <span className="step">{step.label}</span>
      <span className="txt">{step.text}</span>
      <button
        type="button"
        className="dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss guidance"
      >
        Got it
      </button>
    </div>
  );
}
