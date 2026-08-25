/**
 * Routes, because a notification has to be able to link to one.
 *
 * WHY THE APP GREW A ROUTER. Navigation used to be `activeSurface` on the
 * context bus, which is fine for a pane switcher and useless here: the product's
 * front door is "a message you did not go looking for", and a Slack card or an
 * email has to open *one alert*. That needs an address.
 *
 * WHY IT IS ONE FILE AND NOT A LIBRARY. Eight routes — four pages, a note, the
 * Ask index, a record and Sources — no nesting, no
 * loaders, no data router. `hashchange` is already a browser event and
 * `location.hash` is already the state — a router here would be a dependency
 * wrapping two primitives. (`verify-design.mts` enumerates the sanctioned
 * destinations and fails on a ninth, so this count is checked rather than
 * remembered.)
 *
 * WHY HASH AND NOT PATH. The gateway serves nothing and vite's dev server would
 * need a history fallback for every deep link; a hash route works from a file://
 * open, from a static host and behind any path. The demo is a repo somebody
 * clones, so "it works however you serve it" is worth more than a clean URL.
 */

import type { Evidence } from '@mc/domain';

import { useEffect, useState } from 'react';

export type Route =
  | { name: 'alerts' }
  | { name: 'alert'; id: string }
  | { name: 'later' }
  /**
   * One parked note, with room to write.
   *
   * `DESIGN.md` §5 makes a note one of the four things you *open* — "an alert, a
   * conversation, a note, a record" — and §7 is explicit: "A note is editable
   * and nameable, **on its own page**", because editing in a row is how a
   * textarea ends up inside a button. `DIRECTION.md` §7 wants the same: a note
   * you parked yourself can be given a name, one tied to an issue is already
   * named by the issue.
   *
   * Not a seventh toolbar entry. It is reached by clicking a row in Later, the
   * way an alert is reached from the list.
   */
  | { name: 'note'; id: string }
  /**
   * Ask — the list of conversations, and the composer that starts one.
   *
   * `about` filters it to one alert's conversations. `DESIGN.md` §7's third
   * case: "n earlier conversations · see them →" goes to Ask, filtered — not to
   * a fourth page, and not to whichever one happens to be newest.
   */
  | { name: 'ask'; about?: string }
  /**
   * One conversation, opened.
   *
   * `DIRECTION.md` §3 lists it as one of the four pages, and §8 is why it has a
   * route at all: "Asking is not navigation. Opening the conversation is… You
   * went somewhere, so there is somewhere to return to." That is the honest
   * back button the split buys.
   */
  | { name: 'conversation'; id: string }
  | { name: 'sources' }
  /**
   * A record, and the alert that cited it.
   *
   * `from` rides in the route rather than in memory so that a reload, a
   * bookmark or a link somebody pasted still knows where "back" goes — the
   * route IS the state, which is the reason for having one.
   */
  | {
      name: 'record';
      /** `surface/id` — the record's identity. */
      ref: string;
      /** The Slack channel, when the id alone cannot find it. */
      parentId?: string;
      /** Seconds into a recording. This is what decides which LINE you land on. */
      at?: number;
      from?: string;
    }
;

function parseRoute(hash: string): Route {
  // The query is kept for `record`, which carries `from` and the ref's own
  // parameters; every other route splits it off.
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [head, ...rest] = path.split('/');
  switch (head) {
    case 'alert':
      // Decoded, because a finding id carries `:` — `missing_ticket:<note>` —
      // and an encoded colon in a hash is common enough to matter.
      return rest.length ? { name: 'alert', id: decodeURIComponent(rest.join('/')) } : { name: 'alerts' };
    case 'record': {
      const ref = rest.join('/');
      if (!ref) return { name: 'alerts' };
      /**
       * The query is part of the route, not a string smuggled alongside it.
       *
       * `at` and `parentId` decide which LINE a citation lands on, and the first
       * version parsed the path and dropped the query — so the record opened at
       * the top with nothing marked, which is precisely the failure this whole
       * feature exists to avoid, and it looked like a working page.
       */
      const q = new URLSearchParams(hash.split('?')[1] ?? '');
      const at = Number(q.get('at'));
      return {
        name: 'record',
        ref,
        ...(q.get('parentId') ? { parentId: q.get('parentId')! } : {}),
        ...(Number.isFinite(at) && q.get('at') ? { at } : {}),
        ...(q.get('from') ? { from: q.get('from')! } : {}),
      };
    }
    case 'later':
      return { name: 'later' };
    case 'note':
      // Decoded: a note id can carry the `:` a finding id does when it was
      // parked from one.
      return rest.length ? { name: 'note', id: decodeURIComponent(rest.join('/')) } : { name: 'later' };
    case 'ask': {
      const q = new URLSearchParams(hash.split('?')[1] ?? '');
      const about = q.get('about');
      return about ? { name: 'ask', about } : { name: 'ask' };
    }
    case 'conversation':
      return rest.length
        ? { name: 'conversation', id: decodeURIComponent(rest.join('/')) }
        : { name: 'ask' };
    case 'sources':
      return { name: 'sources' };
    default:
      return { name: 'alerts' };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'alerts':
      return '#/';
    case 'alert':
      return `#/alert/${encodeURIComponent(route.id)}`;
    case 'note':
      return `#/note/${encodeURIComponent(route.id)}`;
    case 'conversation':
      return `#/conversation/${encodeURIComponent(route.id)}`;
    case 'ask':
      return route.about ? `#/ask?about=${encodeURIComponent(route.about)}` : '#/ask';
    case 'record': {
      const q = new URLSearchParams();
      if (route.parentId) q.set('parentId', route.parentId);
      if (route.at !== undefined) q.set('at', String(route.at));
      if (route.from) q.set('from', route.from);
      const query = q.toString();
      return `#/record/${route.ref}${query ? `?${query}` : ''}`;
    }
    default:
      return `#/${route.name}`;
  }
}

export function go(route: Route): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = (): void => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/**
 * The href for a citation: its record, on the line it quotes.
 *
 * Lives here rather than beside the evidence row because two pages need it —
 * the alert, and a conversation's follow-up offering to show where a thing was
 * said. `at` and `parentId` are part of the ROUTE and not a query smuggled
 * beside it; the first version of the record page parsed the path and dropped
 * the query, so every citation opened at the top of a ninety-minute transcript
 * with nothing marked.
 */
export function recordHref(e: Evidence, from: string): string {
  const r = e.ref!;
  const q = new URLSearchParams();
  if (r.parentId) q.set('parentId', r.parentId);
  if (r.at !== undefined) q.set('at', String(r.at));
  q.set('from', from);
  return `#/record/${r.surface}/${encodeURIComponent(r.id)}?${q.toString()}`;
}
