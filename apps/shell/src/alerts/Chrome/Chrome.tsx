/**
 * The frame every page sits in: the app window, the top bar, the toolbar.
 *
 * `DESIGN.md` §3 — one `.appwin`, content in bands separated by hairlines, no
 * grid and no sidebar anywhere. Every band's horizontal padding is
 * `var(--gutter)`, so every content edge on every screen resolves to a single x.
 */

import type { JSX, ReactNode } from 'react';
import { go, hrefFor, type Route } from '../router';

import './Chrome.css';

/**
 * The six the app actually reads, and GitHub was missing from all of it.
 *
 * Not just from this strip: there was no `--s-github` token and no `.github`
 * rule anywhere, so `dotClass('github')` produced a class matching nothing and
 * every GitHub dot rendered transparent. Both render sites are on Sources — the
 * connector row, which lists it with its pull-request count, and the
 * "pull requests join to no ticket" failure row. NOT an evidence row: `github`
 * is deliberately not in `Owner`, so a citation cannot carry it and
 * `readRecord` has no branch to open a PR. The token is GitHub's own merged-PR
 * purple, the one hue the five existing surfaces leave open.
 *
 * `CLAUDE.md` counts FIVE COLLECTORS — Jira, Zoom, Confluence, Slack, GitHub —
 * and Miro is the sixth surface rather than the fifth collector: it is the one
 * read live rather than out of `MC_GRAPH_DIR`. Six dots, and the two counts are
 * different things.
 */
const SOURCES = [
  { key: 'jira', label: 'Jira' },
  { key: 'slack', label: 'Slack' },
  { key: 'zoom', label: 'Zoom' },
  { key: 'conf', label: 'Confluence' },
  { key: 'miro', label: 'Miro' },
  { key: 'github', label: 'GitHub' },
];

/**
 * The connector dots are Sources' status AND its door.
 *
 * `DESIGN.md` §4: Sources is deliberately not in the toolbar. A page you set up
 * once does not need a permanent seat beside the pages you work in, and the
 * toolbar's ceiling is three — a fourth entry and it drifts back toward the
 * launcher-for-tools look the vendor panes were deleted to escape.
 */
/**
 * The toolbar: only the pages you might want from ANYWHERE.
 *
 * `DESIGN.md` §4 — three is the ceiling. An alert, a conversation and a record
 * are always *about* something, so they are never nav items; you reached them
 * from a list or a citation and the way back is the thing you came from. A
 * fourth entry and this drifts back toward the launcher-for-tools look the
 * vendor panes were deleted to escape.
 *
 * Sources is deliberately absent — the connector dots to the right are already
 * its status and its door.
 *
 * **The counts are read from the collections, never written down.** Both were
 * literals in the preview and deleting a note left them lying, twice, on one
 * page (`DESIGN.md` §8).
 */
function Nav({ route, counts }: { route: Route; counts: Counts }): JSX.Element {
  // An alert is "in" Alerts — you got there from the list, and the section you
  // are in is the one you would go back to.
  const on = (name: Route['name']): boolean =>
    route.name === name || (name === 'alerts' && route.name === 'alert');

  const items: { to: Route; label: string; n?: number; hot?: boolean }[] = [
    { to: { name: 'alerts' }, label: 'Alerts', n: counts.alerts, hot: counts.hot },
    { to: { name: 'later' }, label: 'Later', n: counts.later },
    /**
     * Ask's count is a NUMBER YOU HAVE, not a number that wants you, and the
     * badge is deliberately never `hot` for it.
     *
     * The other two are work: an alert is something unanswered and a parked
     * note is something that came back. A conversation count is neither — it
     * says how much you have said, and the red badge in this toolbar means
     * "somebody has to look at this". Drawn in the same neutral as Later's, it
     * reads as what it is: how much is in there.
     */
    { to: { name: 'ask' }, label: 'Ask', n: counts.ask },
  ];

  return (
    <nav className="appnav" aria-label="Sections">
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          {...(on(i.to.name) ? { 'aria-current': 'page' as const } : {})}
          onClick={() => go(i.to)}
        >
          {i.label}
          {!!i.n && <span className={`n${i.hot ? ' hot' : ''}`}>{i.n}</span>}
        </button>
      ))}
    </nav>
  );
}

export interface Counts {
  alerts: number;
  later: number;
  /** Conversations worth showing — a never-used draft is not one. */
  ask: number;
  /** Anything above `ok` — the badge is red only when something needs a person. */
  hot: boolean;
}

export function TopBar({ route, counts }: { route: Route; counts: Counts }): JSX.Element {
  /**
   * On Sources, the dots are replaced by the page's own name.
   *
   * The dots ARE the door to Sources, so drawing them here offers a way into
   * the room you are standing in — and it leaves the page as the only one in
   * the app whose top bar never says where you are. The preview settles it:
   * `#scr-sources` is the one screen whose bar reads
   * `Mission Control · Sources` with the second in `--ink-3`, and it carries no
   * connector strip. `.brand.muted` was in the stylesheet all along with
   * nothing using it — see ROADMAP.md G6, which is what found this.
   */
  const here = route.name === 'sources';
  return (
    <div className="topbar">
      <span className="brand">Mission Control</span>
      <Nav route={route} counts={counts} />
      {here ? (
        <span className="brand muted">Sources</span>
      ) : (
        <button className="sources" onClick={() => go({ name: 'sources' })} title="Sources — what is connected">
          {SOURCES.map((s) => (
            <span key={s.key}>
              <i className={`dot ${s.key}`} />
              {s.label}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}

export function AppWindow({
  route,
  counts,
  children,
}: {
  route: Route;
  counts: Counts;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="appwin">
      <TopBar route={route} counts={counts} />
      {children}
    </div>
  );
}

/**
 * Up one level, from a thing to the list that holds it. Always top-left.
 *
 * Distinct from the "open the alert" link on the right of a context bar, which
 * goes ACROSS to a related page and is not a back — you may never have been
 * there. `DESIGN.md` §4 keeps the two apart because conflating them produces a
 * back button that lies.
 */
export function BackLink({ to, label }: { to: Route; label: string }): JSX.Element {
  return (
    <a className="back" href={hrefFor(to)}>
      ← {label}
    </a>
  );
}

/**
 * `DESIGN.md` §7 — delete acts, and stays undoable.
 *
 * Written twice before this, in `Ask` and `Later`, and the two had already
 * disagreed: `Later` placed the strip past the end of the list when you deleted
 * the last row, and `Ask` did not — so deleting your last conversation removed
 * it with no offer to undo, which is the one thing §7 forbids.
 *
 * No timer. A strip that vanishes after a few seconds is one you must react to
 * rather than decide about; it lives until you leave the page it belongs to.
 */
export function UndoStrip({ label, onUndo }: { label: string; onUndo: () => void }): JSX.Element {
  return (
    <div className="undobar">
      <span className="what">Deleted &ldquo;{label}&rdquo;</span>
      <button type="button" onClick={onUndo}>
        Undo
      </button>
    </div>
  );
}
