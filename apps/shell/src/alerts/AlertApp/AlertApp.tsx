/**
 * The alert-first application.
 *
 * WHAT HAPPENED TO THE PANES. They are gone, which is what `DIRECTION.md` §3
 * asks for — first as destinations, and now as files. The route went when
 * `RecordView` gave citations somewhere to land; the ~8,000 lines behind it
 * stayed one phase longer for one reason, which was that `conversations.ts` was
 * what Ask would be built out of. Ask is built, out of exactly that, so the
 * rest followed.
 *
 * `DIRECTION.md` §3: "Nothing built is thrown away; it is re-pointed." What was
 * worth keeping was re-pointed — the conversation store with its coalesced
 * writes and its streaming-by-id, and the SSE loop, both now in `alerts/`. What
 * went was a second component library, a second stylesheet and five vendor
 * panes the direction deleted.
 */

import { useEffect, useRef, type JSX } from 'react';
import type { Finding, Note } from '@mc/domain';
import { useJson } from '../api';
import { useRoute } from '../router';
import { AlertList } from '../AlertList/AlertList';
import { AlertPage } from '../AlertPage/AlertPage';
import { Ask } from '../Ask/Ask';
import { ConversationPage } from '../ConversationPage/ConversationPage';
import { isParked, Later } from '../Later/Later';
import { NotePage } from '../NotePage/NotePage';
import { RecordView } from '../RecordView/RecordView';
import { Sources } from '../Sources/Sources';
import type { Counts } from '../Chrome/Chrome';
import { Guide } from '../../Guide';

import './AlertApp.css';

export default function AlertApp({
  guideSessionId,
  guideResetToken,
  onGuideVisibilityChange,
}: {
  guideSessionId: string;
  guideResetToken: number;
  onGuideVisibilityChange: (visible: boolean) => void;
}): JSX.Element {
  const route = useRoute();

  /**
   * The toolbar's counts, fetched once here rather than in the toolbar itself.
   *
   * `DESIGN.md` §8 — anything that states a count reads it from the collection.
   * Fetching them inside `TopBar` would mean every page issues two extra
   * requests and the number could differ between the badge and the list it is
   * counting, which is the exact bug that rule exists to prevent.
   */
  const findings = useJson<{ findings: Finding[] }>('/api/findings');
  const notes = useJson<Note[]>('/api/vault/notes');
  const alerts = findings.data?.findings ?? [];
  const counts: Counts = {
    alerts: alerts.filter((f) => f.severity !== 'ok').length,
    /**
     * `isParked` is Later's own test, imported rather than restated.
     *
     * This counted `!!n.about` alone, which is only half of it: a note written
     * in Later's composer carries `tags: ['parked']` and no `about`, because it
     * was never about a finding. So the page listed it and the badge beside the
     * page did not — the two disagreed about what "parked" means, which is
     * `DESIGN.md` §8's rule broken from the inside. One definition, exported by
     * the page that owns the concept.
     */
    later: (notes.data ?? []).filter(isParked).length,
    hot: alerts.some((f) => f.severity === 'crit'),
  };

  /**
   * Re-read the counts on every navigation.
   *
   * `useJson` refetches on its path, and these three paths never change, so
   * without this the counts are whatever they were when the app booted —
   * accepting a proposal or parking an alert left the badge beside it saying
   * the old number until a full reload. That is precisely the bug `DESIGN.md`
   * §8 exists to prevent, arrived at from the other direction: the count was
   * read from the collection, and then the collection was never read again.
   *
   * Keyed on the route rather than on an interval, because navigation is the
   * only moment a count is about to be looked at. `reload` is a fresh closure
   * every render, so it is held in a ref and kept out of the dependency list —
   * naming it there re-runs the effect forever.
   */
  const refresh = useRef<() => void>(() => {});
  refresh.current = () => {
    findings.reload();
    notes.reload();
  };
  const at = route.name === 'alert' ? `alert:${route.id}` : route.name;
  const first = useRef(true);
  useEffect(() => {
    // The initial fetch is already in flight; re-firing it here would double
    // every request on boot.
    if (first.current) {
      first.current = false;
      return;
    }
    refresh.current();
  }, [at]);

  return (
    <div className="app-shell">
      <Guide
        sessionId={guideSessionId}
        resetToken={guideResetToken}
        onVisibilityChange={onGuideVisibilityChange}
      />
      {route.name === 'alerts' && <AlertList route={route} counts={counts} />}
      {route.name === 'alert' && (
        <AlertPage id={route.id} route={route} counts={counts} onActed={() => refresh.current()} />
      )}
      {route.name === 'later' && <Later route={route} counts={counts} />}
      {route.name === 'note' && <NotePage id={route.id} route={route} counts={counts} />}
      {route.name === 'record' && (
        <RecordView
          refKey={route.ref}
          parentId={route.parentId}
          at={route.at}
          from={route.from}
          route={route}
          counts={counts}
        />
      )}
      {route.name === 'ask' && <Ask about={route.about} route={route} counts={counts} />}
      {route.name === 'conversation' && (
        <ConversationPage id={route.id} route={route} counts={counts} />
      )}
      {route.name === 'sources' && <Sources route={route} counts={counts} />}
    </div>
  );
}
