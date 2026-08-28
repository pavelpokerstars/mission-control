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
import type { Note } from '@mc/domain';
import { useFindings, useJson } from '../api';
import { historyOf, useConversations } from '../conversations';
import { seedDemoConversations } from '../demo';
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

import './AlertApp.css';

export default function AlertApp(): JSX.Element {
  const route = useRoute();

  /**
   * The toolbar's counts, fetched once here rather than in the toolbar itself.
   *
   * `DESIGN.md` §8 — anything that states a count reads it from the collection.
   * Fetching them inside `TopBar` would mean every page issues two extra
   * requests and the number could differ between the badge and the list it is
   * counting, which is the exact bug that rule exists to prevent.
   */
  const findings = useFindings();
  const notes = useJson<Note[]>('/api/vault/notes');
  /**
   * The third count comes from the STORE, not from a request, because that is
   * where conversations live — `conversations.ts` keeps them in `localStorage`
   * and the gateway holds no per-user state. Same rule either way: the number
   * is read from the collection it counts (`DESIGN.md` §8), and `historyOf` is
   * the collection — a never-used draft is not a conversation.
   *
   * It needs no entry in the navigation effect below: this is a subscription,
   * so asking a question or deleting a row moves the badge on the spot.
   */
  const conversations = useConversations((s) => s.conversations);
  const alerts = findings.data?.findings ?? [];
  /**
   * Suppressed alerts, for NAMING and nothing else.
   *
   * Kept out of `alerts` deliberately: that array is what the counts and the
   * list are read from, and a deferral is a promise that the thing is gone
   * until its date. Every row a chip has to label is joined below, where the
   * only question asked of a finding is what it is called.
   */
  const parked = findings.data?.parked ?? [];
  const namedAlerts = [...alerts, ...parked];
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
    ask: historyOf(conversations).length,
    hot: alerts.some((f) => f.severity === 'crit'),
  };

  /**
   * The demo's own conversations, once, into a browser that has none.
   *
   * Here rather than in `Ask` for two reasons. The findings are already in hand
   * — `demo.ts` binds each seeded conversation to a real alert, and a second
   * fetch of this same list is how a count and the thing it counts come to
   * disagree — and an alert's ask header reads its conversations from the same
   * store, so seeding only when somebody opens `Ask` would leave the alert page
   * saying "no conversations yet" about ones that exist.
   */
  useEffect(() => {
    if (findings.data) seedDemoConversations(findings.data.findings);
  }, [findings.data]);

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
      {route.name === 'alerts' && <AlertList route={route} counts={counts} />}
      {route.name === 'alert' && (
        <AlertPage id={route.id} route={route} counts={counts} onActed={() => refresh.current()} />
      )}
      {/* The alerts ride down so a parked note can carry the chip of the alert
          it came from — `DIRECTION.md` §7. Handed over rather than fetched
          again for the reason the counts are: two reads of one list is how a
          row and the badge above it come to disagree. Suppressed ones included,
          because a note is parked exactly while its alert is one of them. */}
      {route.name === 'later' && <Later route={route} counts={counts} alerts={namedAlerts} />}
      {route.name === 'note' && (
        <NotePage id={route.id} route={route} counts={counts} alerts={namedAlerts} />
      )}
      {route.name === 'record' && (
        <RecordView
          refKey={route.ref}
          parentId={route.parentId}
          at={route.at}
          from={route.from}
          kind={route.kind}
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
