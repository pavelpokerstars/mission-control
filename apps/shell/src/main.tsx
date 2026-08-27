import { StrictMode, useState, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { GateScreen, SessionBadge } from './JudgeGate';
import {
  clearSession,
  completeIntro,
  introComplete,
  startSession,
  validSession,
  type JudgeSession,
} from './gate';

/**
 * The two typefaces first, then the design system.
 *
 * `fonts.css` must come first: `app.css`'s `--sans` and `--mono` NAME these two
 * families, and with nothing declaring them the browser fell silently through
 * to `ui-sans-serif` and `ui-monospace` — every measurement matching the
 * preview and the wrong typeface on screen. See the header of that file.
 *
 * ONE DESIGN SYSTEM, SEVENTEEN FILES, AND THE ORDER OF THESE FOUR LINES IS THE
 * CONTRACT. `app.css` holds the tokens, the reset and the breakpoint;
 * `alerts/shared.css` holds what more than one screen draws; each component is a
 * folder holding its `.tsx` and the `.css` it imports from beside it.
 *
 * **THE CSS IMPORTS MUST STAND ABOVE `AlertApp`, and an import sorter that
 * moves them below inverts the whole cascade.** CSS is emitted in
 * module-*evaluation* order, which is depth-first: with `import AlertApp`
 * first, every component stylesheet in its subtree arrives BEFORE these three,
 * so `shared.css` lands last and beats the component files it is supposed to
 * lose to. Measured: `.appwin` at byte 0 of the stylesheet and the tokens at
 * 26056. **The dev server does exactly the same** — Vite evaluates the ESM
 * graph depth-first too — so this is visible in a browser either way, which is
 * why `verify-design.mts` asserts these four lines rather than trusting them.
 *
 * So every component file loads after `shared.css` and can override it at equal
 * specificity, and none of them can be reordered into a different result — no
 * component file may claim a scoping class another one claims, which is what
 * `verify-design.mts` asserts.
 *
 * Mantine and `styles.css` are gone from the bundle. They were the pane app's,
 * and the pane app was mounted at a route of its own for one reason: the record
 * views lived there and a citation had to land somewhere. Citations now open
 * records directly (`RecordView`), so the route was the last thing holding a
 * second component library, a second reset and a second set of colour tokens in
 * a page that renders none of them.
 *
 * Every rule in all seventeen is `docs/design-preview.html`'s, copied verbatim.
 * A design change belongs in the preview first and here second.
 *
 * The judge shell wraps `AlertApp`: if there is no valid temporary session the
 * gate renders; entering a name starts the pitch and simulated Slack hand-off;
 * only their `Open Mission Control` action mounts the product. The session badge
 * rides above every post-gate stage while the timer is live.
 */
import './fonts.css';
import './app.css';
import './alerts/shared.css';

import DemoIntro from './DemoIntro';
import AlertApp from './alerts/AlertApp/AlertApp';
import { useConversations } from './alerts/conversations';

function Root(): JSX.Element {
  const [session, setSession] = useState<JudgeSession | null>(() => validSession());
  const [introduced, setIntroduced] = useState<boolean>(() =>
    session ? introComplete(session) : false,
  );
  const [guideResetToken, setGuideResetToken] = useState(0);
  const [guideVisible, setGuideVisible] = useState(true);

  const resetProductState = (): void => {
    useConversations.getState().clearAll();
    window.history.replaceState(null, '', '/');
    setGuideResetToken(0);
    setGuideVisible(true);
  };

  if (!session) {
    return (
      <GateScreen
        onEnter={(name) => {
          const next = startSession(name);
          resetProductState();
          setIntroduced(false);
          setSession(next);
        }}
      />
    );
  }

  const finishIntroduction = (): void => {
    completeIntro(session);
    window.history.replaceState(null, '', '/');
    setIntroduced(true);
  };

  const expireSession = (): void => {
    clearSession();
    resetProductState();
    setIntroduced(false);
    setSession(null);
  };

  return (
    <>
      <SessionBadge
        session={session}
        onExpire={expireSession}
        onShowGuide={() => {
          setGuideVisible(true);
          setGuideResetToken((value) => value + 1);
        }}
        guideVisible={!introduced || guideVisible}
      />
      {introduced ? (
        <AlertApp
          guideSessionId={session.id}
          guideResetToken={guideResetToken}
          onGuideVisibilityChange={setGuideVisible}
        />
      ) : (
        <DemoIntro judgeName={session.name} onComplete={finishIntroduction} />
      )}
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
