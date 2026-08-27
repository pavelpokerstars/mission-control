/**
 * Where a citation lands.
 *
 * Not a vendor pane — one record, opened on the exact line, with context either
 * side. `DIRECTION.md` §3: "a citation that drops you at the top of a
 * ninety-minute transcript has not really been followed." That is the whole
 * design brief, and it is why the ref carries an offset or a message id rather
 * than just a document.
 *
 * There is no browse mode and no search here, deliberately. You arrive from a
 * piece of evidence and the way out is back to the thing that cited it. A menu
 * entry would make this a sixth destination, which is what the vendor panes were
 * deleted for being.
 */

import { useEffect, useRef, type JSX } from 'react';
import { explain, dotClass, useJson } from '../api';
import { AppWindow, BackLink, type Counts } from '../Chrome/Chrome';
import type { Route } from '../router';

import './RecordView.css';

interface RecordResult {
  surface: string;
  id: string;
  title: string;
  lines: { id: string; at?: number; who?: string; text: string }[];
  cited?: string;
  container?: string;
  url?: string;
}

/** `852` → `14:12`. A transcript's own clock, which is what the citation quoted. */
function offset(at?: number): string {
  if (at === undefined) return '';
  return `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;
}

export function RecordView({
  refKey,
  parentId,
  at,
  from,
  route,
  counts,
}: {
  /** `surface/id` — the record's identity. */
  refKey: string;
  parentId?: string;
  /** Seconds into a recording. What decides which line you land on. */
  at?: number;
  /** The alert that cited this, so "back" goes where you came from. */
  from?: string;
  route: Route;
  counts: Counts;
}): JSX.Element {
  const query = new URLSearchParams();
  if (parentId) query.set('parentId', parentId);
  if (at !== undefined) query.set('at', String(at));
  const qs = query.toString();
  const { data, error, loading } = useJson<RecordResult>(
    `/api/records/${refKey}${qs ? `?${qs}` : ''}`,
  );
  const hit = useRef<HTMLDivElement>(null);

  /**
   * What the marked line says about itself.
   *
   * A finding id is machine-shaped (`missing_ticket:platform-owns-settled-topic`),
   * so it is turned back into the words a reader would use rather than shown
   * raw — the caption exists to explain why this line is highlighted, and an
   * identifier explains nothing.
   */
  const citedBy = from
    ? `cited by the ${from.split(':')[0]!.replace(/_/g, ' ')} alert`
    : 'the line this citation points at';

  /**
   * Scroll the cited line into view once it exists.
   *
   * Marking it is not enough on a long record: a citation that lands on the page
   * holding the line, somewhere below the fold, has the same problem as one that
   * lands at the top. `center` rather than `start` so the context either side is
   * visible, which is the reason for opening the record at all.
   */
  useEffect(() => {
    hit.current?.scrollIntoView({ block: 'center' });
  }, [data]);

  return (
    <AppWindow route={route} counts={counts}>
      <BackLink
        to={from ? { name: 'alert', id: from } : { name: 'alerts' }}
        label={from ? 'back to the alert' : 'back to the list'}
      />

      {loading && <div className="greet"><h1>Opening…</h1></div>}
      {error && !data && (
        <div className="greet">
          <h1>That record is not there</h1>
          <p>The citation points at something this system can no longer read. {explain(error)}</p>
        </div>
      )}

      {data && (
        <>
          <div className="rec-head">
            <span className="src">
              <i className={`dot ${dotClass(data.surface)}`} />
              {data.surface} · {data.title}
              {data.container && data.container !== data.title ? ` · ${data.container}` : ''}
            </span>
            {data.cited && <span className="why">opened on the line this alert cites</span>}
          </div>

          <div className="transcript">
            {data.lines.map((l) => {
              const isHit = l.id === data.cited;
              return (
                <div
                  className={`line${isHit ? ' hit' : ''}`}
                  key={l.id}
                  ref={isHit ? hit : undefined}
                  // The caption under the marked line, read by `.line.hit::after`.
                  // It names the alert that sent you here, which is the only
                  // reason this record is open.
                  {...(isHit ? { 'data-cited-by': citedBy } : {})}
                >
                  <time>{offset(l.at)}</time>
                  <p className="said">
                    {l.who && <b>{l.who}</b>}
                    <span>{l.text}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </AppWindow>
  );
}
