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
 * loaders, no data router. `popstate` is already a browser event and
 * `location.pathname` is already the state — a router here would be a dependency
 * wrapping two primitives. (`verify-design.mts` enumerates the sanctioned
 * destinations and fails on a ninth, so this count is checked rather than
 * remembered.)
 *
 * WHY PATHS AND NOT A HASH. The address is part of the product: an alert is
 * something you paste to a colleague, and `#/alert/…` reads as an artefact of
 * the demo rather than as a place. So the address bar shows `/alert/…`, which
 * costs exactly one thing and it is worth naming: **every deep link now needs
 * the server to answer with `index.html`**. Vite's dev server does it by
 * default; `spaFallback` in `vite.config.mts` widens it to the record ids that
 * contain a dot, which its own rule would otherwise mistake for a filename.
 * Anything else serving `dist/` needs the same rewrite.
 *
 * WHY A CLICK LISTENER. Rows and citations are `<a>` elements on purpose —
 * middle-click, copy-link and the browser's own affordances come free — and
 * with a hash those navigated without a reload. With a path they would fetch
 * the whole app again, so `useRoute` installs one document-level listener that
 * turns a plain left-click on an internal link into a `pushState`. Modified
 * clicks and anything with a target are left to the browser, which is what
 * keeps "open in a new tab" working.
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
      /**
       * The KIND of the alert that cited this, which the id does not carry.
       *
       * `missing_ticket` and `unlinked_commitment` deliberately share the id
       * `missing_ticket:<noteId>` — three things key on it and a rename
       * re-announces every alert somebody was already told about. So splitting
       * the id gives the wrong word for one of them, and the record page said
       * "the promise nobody filed" over a citation belonging to an alert whose
       * whole claim is that the promise probably HAS a ticket.
       */
      kind?: string;
      /** Seconds into a recording. This is what decides which LINE you land on. */
      at?: number;
      from?: string;
    }
;

/** The address as the app reads it: everything after the origin. */
function here(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function parseRoute(url: string): Route {
  // The query is kept for `record`, which carries `from` and the ref's own
  // parameters; every other route splits it off.
  const path = (url.split('?')[0] ?? '').replace(/^\/+/, '');
  const [head, ...rest] = path.split('/');
  switch (head) {
    case 'alert':
      // Decoded, because a finding id carries `:` — `missing_ticket:<note>` —
      // and it is percent-encoded on the way into the path.
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
      const q = new URLSearchParams(url.split('?')[1] ?? '');
      const at = Number(q.get('at'));
      return {
        name: 'record',
        ref,
        ...(q.get('parentId') ? { parentId: q.get('parentId')! } : {}),
        ...(Number.isFinite(at) && q.get('at') ? { at } : {}),
        ...(q.get('from') ? { from: q.get('from')! } : {}),
        ...(q.get('kind') ? { kind: q.get('kind')! } : {}),
      };
    }
    case 'later':
      return { name: 'later' };
    case 'note':
      // Decoded: a note id can carry the `:` a finding id does when it was
      // parked from one.
      return rest.length ? { name: 'note', id: decodeURIComponent(rest.join('/')) } : { name: 'later' };
    case 'ask': {
      const q = new URLSearchParams(url.split('?')[1] ?? '');
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
      return '/';
    case 'alert':
      return `/alert/${encodeURIComponent(route.id)}`;
    case 'note':
      return `/note/${encodeURIComponent(route.id)}`;
    case 'conversation':
      return `/conversation/${encodeURIComponent(route.id)}`;
    case 'ask':
      return route.about ? `/ask?about=${encodeURIComponent(route.about)}` : '/ask';
    case 'record': {
      const q = new URLSearchParams();
      if (route.parentId) q.set('parentId', route.parentId);
      if (route.at !== undefined) q.set('at', String(route.at));
      if (route.from) q.set('from', route.from);
      if (route.kind) q.set('kind', route.kind);
      const query = q.toString();
      return `/record/${route.ref}${query ? `?${query}` : ''}`;
    }
    default:
      return `/${route.name}`;
  }
}

/**
 * The one event the app navigates on.
 *
 * `pushState` deliberately fires nothing — the platform assumes the caller knows
 * it just navigated — so this is what tells every mounted `useRoute` that the
 * address moved. `popstate` covers the back button; between them the two are
 * the whole of it.
 */
const MOVED = 'mc:navigated';

/**
 * WE PLACE THE PAGE, NOT THE BROWSER.
 *
 * `history.scrollRestoration` defaults to `auto`, which restores the offset a
 * page had when you left it — right for a document you scrolled through, and
 * wrong for an app whose every address is a different shape. Clicking an alert
 * from a list you had scrolled halfway down opened that alert halfway down, at
 * whatever sentence happened to sit at 900px, and coming back to the alert from
 * a citation did it again. `pushState` does not reset the offset by itself, so
 * without both halves of this the reader lands in the middle of something.
 *
 * `manual` here and a scroll on every address change in `AlertApp`, which is
 * what the preview does on every screen it shows.
 */
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

/** Go to an address, without fetching the application again. */
export function navigate(href: string): void {
  if (href === here()) return;
  window.history.pushState(null, '', href);
  window.dispatchEvent(new Event(MOVED));
}

export function go(route: Route): void {
  navigate(hrefFor(route));
}

/**
 * A left-click on an internal link, without the browser reloading everything.
 *
 * Everything this declines to handle it declines on purpose. A modified click is
 * the reader asking for a new tab or a download; a `target` says the same out
 * loud; another origin is not ours to intercept; and `defaultPrevented` means a
 * component already decided. In every one of those cases doing nothing is the
 * correct behaviour, which is why rows can stay anchors.
 */
function interceptLink(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  if (!a || a.target || a.hasAttribute('download')) return;
  const raw = a.getAttribute('href');
  if (!raw || raw.startsWith('#') || /^[a-z]+:/i.test(raw)) return;
  const url = new URL(a.href);
  if (url.origin !== window.location.origin) return;
  e.preventDefault();
  navigate(`${url.pathname}${url.search}`);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(here()));
  useEffect(() => {
    const on = (): void => setRoute(parseRoute(here()));
    window.addEventListener('popstate', on);
    window.addEventListener(MOVED, on);
    document.addEventListener('click', interceptLink);
    return () => {
      window.removeEventListener('popstate', on);
      window.removeEventListener(MOVED, on);
      document.removeEventListener('click', interceptLink);
    };
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
export function recordHref(e: Evidence, from: string, kind?: string): string {
  const r = e.ref!;
  const q = new URLSearchParams();
  if (r.parentId) q.set('parentId', r.parentId);
  if (r.at !== undefined) q.set('at', String(r.at));
  q.set('from', from);
  if (kind) q.set('kind', kind);
  return `/record/${r.surface}/${encodeURIComponent(r.id)}?${q.toString()}`;
}
