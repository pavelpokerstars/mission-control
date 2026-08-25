/**
 * One parked note, with room to write.
 *
 * `DESIGN.md` §7: "Editing happens on a page, not in a row. Clicking a note
 * opens it with room to write, its reminder picker, and its link to the issue."
 * The row version is what puts a textarea inside a button.
 *
 * TWO SHAPES, AND THE DIFFERENCE IS WHETHER IT IS TIED. §5: on an untied note
 * the context bar's subject is an **editable name field** — "text until you
 * hover it, so an unnamed note carries no chrome". A note parked from an alert
 * is already named by the alert, and gets `Open the alert` on the right instead:
 * an ACROSS link, not a back — §4 keeps the two apart because conflating them
 * produces a back button that lies.
 *
 * THE PICKER'S FIRST OPTION IS `Leave it — <current date>` (§7), so opening a
 * note never silently reschedules it. That is the whole reason the option
 * exists, and it is why `KEEP` is the initial value rather than a date.
 */

import { useEffect, useState, type JSX } from 'react';
import type { Note } from '@mc/domain';
import { explain, deleteNote, saveNote, useJson } from './api';
import { AppWindow, BackLink, type Counts } from './Chrome';
import { DatePicker, fmtDay, isoDay, plusDays } from './DatePicker';
import { WHEN, CUSTOM, optionLabel } from './Actions';
import { due } from './Later';
import { go, hrefFor, type Route } from './router';

/** Leave the reminder exactly as it is. Selected on open, always. */
const KEEP = 'keep';

export function NotePage({
  id,
  route,
  counts,
}: {
  id: string;
  route: Route;
  counts: Counts;
}): JSX.Element {
  const { data, error, loading } = useJson<Note>(`/api/vault/notes/${encodeURIComponent(id)}`);
  const [title, setTitle] = useState<string>();
  const [body, setBody] = useState<string>();
  const [when, setWhen] = useState(KEEP);
  const [picked, setPicked] = useState(() => isoDay(plusDays(7)));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [saved, setSaved] = useState(false);

  // Seed the fields once the note arrives, and not on every render — otherwise
  // typing is overwritten by the fetched value on the next tick.
  useEffect(() => {
    if (!data) return;
    setTitle((t) => t ?? data.title);
    setBody((b) => b ?? data.body);
  }, [data]);

  if (loading && !data) {
    return (
      <AppWindow route={route} counts={counts}>
        <BackLink to={{ name: 'later' }} label="all notes" />
        <div className="greet">
          <h1>Opening…</h1>
        </div>
      </AppWindow>
    );
  }

  // `!data` alone: a failed refetch leaves the note on screen rather than
  // replacing an open note with "not there". See `useJson`.
  if (!data) {
    return (
      <AppWindow route={route} counts={counts}>
        <BackLink to={{ name: 'later' }} label="all notes" />
        <div className="greet">
          <h1>That note is not there</h1>
          <p>It may have been deleted since the link was made. {error ? explain(error) : ''}</p>
        </div>
      </AppWindow>
    );
  }

  const save = async (): Promise<void> => {
    setBusy(true);
    setFailed(undefined);
    try {
      const patch: Partial<Note> = { title: title ?? data.title, body: body ?? data.body };
      // `keep` writes no date at all, which is what makes opening a note safe.
      if (when !== KEEP) {
        patch.dueAt = when === CUSTOM ? new Date(`${picked}T09:00:00`).toISOString() : when;
      }
      await saveNote(data.id, patch);
      setSaved(true);
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setFailed(undefined);
    try {
      await deleteNote(data.id);
      // Back to the list, where §7's undo strip lives. It cannot live here —
      // the page it belongs to is the one that still has the row.
      go({ name: 'later' });
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <AppWindow route={route} counts={counts}>
      <BackLink to={{ name: 'later' }} label="all notes" />

      <div className="ctxbar">
        <span className="chip plain">Note</span>
        {data.about ? (
          <>
            <span className="about">
              About <b>{data.title}</b>
            </span>
            {/* ACROSS, not back — §4. No arrow, right-hand side. */}
            <a className="backlink" href={hrefFor({ name: 'alert', id: data.about })}>
              Open the alert
            </a>
          </>
        ) : (
          <input
            type="text"
            className="titleinput"
            aria-label="Name this note"
            placeholder="Name this note…"
            value={title ?? ''}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
      </div>

      <div className="block flush">
        <h4>Your note</h4>
        <div className="noteedit">
          <textarea
            className="tall"
            aria-label="Your note"
            value={body ?? ''}
            onChange={(e) => {
              setBody(e.target.value);
              setSaved(false);
            }}
          />
        </div>

        <div className="duepick">
          <label className="lab" htmlFor="notewhen">
            Bring it back
          </label>
          <span className="selwrap">
            <select id="notewhen" value={when} onChange={(e) => setWhen(e.target.value)}>
              {/* First, and selected — opening a note must not reschedule it. */}
              <option value={KEEP}>Leave it — {due(data).replace(/^back /, '')}</option>
              {WHEN.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((o) => (
                    <option key={o.value} value={o.value}>
                      {optionLabel(o.label, o.value)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </span>
          {when === CUSTOM && <DatePicker value={picked} onChange={setPicked} />}
        </div>

        <div className="editacts">
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {saved ? 'Saved' : 'Save'}
          </button>
          <button type="button" onClick={() => go({ name: 'later' })}>
            Cancel
          </button>
          <button type="button" className="ghostdel" onClick={() => void remove()}>
            Delete this note
          </button>
        </div>

        {failed && <p className="quiet">That did not work: {failed}</p>}

        <p className="hint">
          Written{' '}
          {new Date(data.createdAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}{' '}
          · comes back {due(data).replace(/^back /, '')}
          {data.dueAt && Number.isFinite(Date.parse(data.dueAt))
            ? ` (${fmtDay(new Date(data.dueAt))})`
            : ''}
        </p>
      </div>
    </AppWindow>
  );
}
