/**
 * Demo mode, wrapped around the app rather than woven into it.
 *
 * WHAT THIS IS FOR. A hosted URL somebody opens cold — at a demo, in a review,
 * from a link — needs three things the product deliberately does not have: a
 * sentence saying what it is, the notification that starts the story, and a
 * strip telling a first-time reader what to try. None of those belong on the
 * front door of a tool somebody uses every morning, so they are here, off
 * unless `MC_DEMO` says otherwise.
 *
 * THE PRODUCT IS THE DEFAULT AND STAYS UNTOUCHED. `AlertApp` takes no props
 * from this file, no route is added, `apps/shell/src/alerts/` gains nothing,
 * and the demo stylesheet is outside the seventeen the design system is checked
 * against. With `MC_DEMO` unset this component renders `children` and nothing
 * else — which is why `verify-design.mts` still describes the whole interface
 * with the demo layer sitting next to it.
 *
 * IT NEVER DELAYS THE PRODUCT. The flag comes from `/api/health`, so strictly
 * the first paint cannot know it. Waiting for it would put a round trip in
 * front of every reader of every instance to answer a question that is `false`
 * for nearly all of them, so the first frame renders the app and the cached
 * answer — see `session.ts` — makes that frame correct on every load after the
 * first in a tab.
 *
 * WHY THE ORDER OF THE TWO CHILDREN MATTERS. The strip is rendered BEFORE the
 * app and is a sibling of it, not a parent: `.app-shell` is `overflow-x: clip`
 * specifically so it does not become a scroll container, and a sticky strip
 * placed inside it would be sticky within the shell rather than within the
 * page. Outside, it sticks to the viewport, which is what a guide has to do.
 */

import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { API } from '../alerts/api';
import { useConversations } from '../alerts/conversations';
import { forgetDemoConversations } from '../alerts/demo';
import { go } from '../alerts/router';
import { GuideBar } from './GuideBar';
import { Intro } from './Intro';
import { Welcome } from './Welcome';
import {
  cachedConfig,
  endSession,
  fetchConfig,
  introSeen,
  markIntroSeen,
  startSession,
  validSession,
  type DemoConfig,
  type DemoSession,
} from './session';

import './demo.css';

export function DemoShell({ children }: { children: ReactNode }): JSX.Element {
  const [config, setConfig] = useState<DemoConfig | undefined>(() => cachedConfig());
  const [session, setSession] = useState<DemoSession | null>(() => validSession());
  const [introDone, setIntroDone] = useState<boolean>(() => {
    const s = validSession();
    return s ? introSeen(s) : false;
  });

  useEffect(() => {
    let live = true;
    void fetchConfig(API).then((c) => {
      if (live) setConfig(c);
    });
    return () => {
      live = false;
    };
  }, []);

  /**
   * Put the browser back where the first visitor found it.
   *
   * A demo URL is opened by several people in a day, and everything the product
   * keeps client-side — the conversation history, the address — would otherwise
   * arrive as the previous visitor's leftovers. Dropping the seeded-history
   * flag as well is what lets `alerts/demo.ts` make its offer again, so `Ask`
   * is populated for this visitor rather than merely empty.
   */
  const reset = (): void => {
    forgetDemoConversations();
    useConversations.getState().clearAll();
    go({ name: 'alerts' });
  };

  if (!config?.on) return <>{children}</>;

  if (!session) {
    return (
      <Welcome
        minutes={config.minutes}
        onEnter={(name) => {
          const next = startSession(name, config.minutes);
          reset();
          setIntroDone(false);
          setSession(next);
        }}
      />
    );
  }

  /** The walkthrough ran out. This is a reset for the next arrival, not a lockout. */
  const expire = (): void => {
    endSession();
    reset();
    setIntroDone(false);
    setSession(null);
  };

  const finishIntro = (): void => {
    markIntroSeen(session);
    setIntroDone(true);
  };

  return (
    <>
      <GuideBar session={session} onExpire={expire} over={introDone ? 'app' : 'intro'} />
      {introDone ? children : <Intro name={session.name} onDone={finishIntro} />}
    </>
  );
}
