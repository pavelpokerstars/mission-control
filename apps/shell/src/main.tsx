import { StrictMode, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import AlertApp from './alerts/AlertApp';
import { GateScreen, SessionBadge } from './JudgeGate';
import { startSession, validSession, type JudgeSession } from './gate';

/**
 * One stylesheet, one design system.
 *
 * `app.css` is `docs/design-preview.html`'s stylesheet, copied verbatim. A design
 * change belongs in the preview first and here second.
 *
 * The judge gate wraps `AlertApp`: if there is no valid temporary session the
 * gate renders and the product does not; entering a name starts one and the
 * product mounts immediately. The session badge rides above the app while a
 * session is live.
 */

import './app.css';

function Root(): JSX.Element {
  const [session, setSession] = useState<JudgeSession | null>(() => validSession());

  if (!session) {
    return (
      <GateScreen
        onEnter={(name) => {
          setSession(startSession(name));
        }}
      />
    );
  }

  return (
    <>
      <SessionBadge
        session={session}
        onExpire={() => setSession(null)}
      />
      <AlertApp />
    </>
  );
}

const el = document.getElementById('root');
if (!el) throw new Error('missing #root');
createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
