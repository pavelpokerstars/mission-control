/**
 * The gate: what this is, and who is looking at it.
 *
 * THE WORDING IS judge-demo's `GateScreen`, to the letter, with one
 * substitution: the length of the walkthrough is read from `MC_DEMO_MINUTES`
 * rather than written into the sentence as "20". At the default the two are the
 * same string; set it to 45 and the copy stays true instead of staying
 * identical, which is the only way a number in prose can be right twice.
 *
 * THE NAME IS FOR THE HAND-OFF, not for an account. The next screen is a
 * simulated morning notification, and "Morning, Sam" is the difference between
 * a screenshot of a product and a message addressed to the person reading it —
 * which is the whole claim being demonstrated, that the front door is something
 * that arrives rather than somewhere you go. Nothing is sent anywhere, nothing
 * is stored beyond this tab, and the demo data is the same for everybody. The
 * fine print says so, because a name field with no explanation reads as a
 * sign-up.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

export function Welcome({
  minutes,
  onEnter,
}: {
  minutes: number;
  onEnter: (name: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const enter = (): void => {
    const trimmed = name.trim();
    if (trimmed) onEnter(trimmed);
  };

  return (
    <div className="mcdemo-welcome">
      <div className="mcdemo-card">
        <div className="mcdemo-wordmark">Mission Control</div>
        <h1>Welcome, judge</h1>
        <p className="mcdemo-lede">
          Enter your name to begin a {minutes}-minute walkthrough. No account is required, and the
          demo content is simulated and shared.
        </p>
        <label className="mcdemo-fieldlabel" htmlFor="mcdemo-name">
          Your name
        </label>
        <input
          id="mcdemo-name"
          ref={input}
          className="mcdemo-input"
          type="text"
          autoComplete="off"
          placeholder="e.g. Judge A"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enter();
          }}
        />
        <button type="button" className="mcdemo-enter" disabled={!name.trim()} onClick={enter}>
          Enter the demo
        </button>
        <p className="mcdemo-fine">
          Your timer and walkthrough progress stay in this browser tab.
        </p>
      </div>
    </div>
  );
}
