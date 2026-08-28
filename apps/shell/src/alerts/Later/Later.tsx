/**
 * Later — what you deferred, the note you left, and when it comes back.
 *
 * `DIRECTION.md` §7: "not needed" and "not now" are different answers, and only
 * the second produces a note. This page is the whole reason that distinction is
 * worth making — without it, deferring is a dismissal with extra steps.
 *
 * Three things `DESIGN.md` asks of it that were missing for several revisions,
 * all of which the stylesheet was already carrying the classes for:
 *
 * - **A composer** (§6). "Composers are the primary action wherever creating
 *   something is the point… Not a button in a corner: the composer looks like
 *   the thing it makes." Without it, Later could only ever hold what an alert
 *   put there.
 * - **Delete, acting in place and undoable** (§7). No "are you sure?" — the row
 *   goes and an undo strip takes **the slot it occupied**, because the gap is
 *   the clearest possible label for what will come back.
 * - **Editing on a page, not in a row** (§7) — `NotePage` below.
 */

import { useState, type JSX } from 'react';
import type { Finding, Note } from '@mc/domain';
import { deleteNote, explain, parkNote, restoreNote, useJson } from '../api';
import { KIND_LABEL } from '../AlertList/AlertList';
import { AppWindow, UndoStrip, type Counts } from '../Chrome/Chrome';
import { hrefFor, type Route } from '../router';

import './Later.css';

/**
 * When it comes back, in the words it was chosen with.
 *
 * A date renders as a date. A named watch renders as itself — "when the sprint
 * ends" — because that is what somebody picked, and resolving it to a guessed
 * date would be inventing a certainty the reminder deliberately does not have.
 */
export function due(note: Note): string {
  if (!note.dueAt) return 'no date set';
  const t = Date.parse(note.dueAt);
  if (!Number.isFinite(t)) return note.dueAt;
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  const when = new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (days < 0) return `due back ${when}`;
  if (days === 0) return 'back today';
  if (days === 1) return 'back tomorrow';
  return `back ${when}`;
}

/** Only what was parked — see `parked` below for why this is not the whole vault. */
export function isParked(n: Note): boolean {
  return !!n.about || (n.tags ?? []).includes('parked');
}

/**
 * What was deleted, and where it was.
 *
 * The index is the point. `DESIGN.md` §7: the strip goes in the slot the row
 * occupied, and undo restores it at its original position — put it at the top
 * of the list instead and the reader has to hunt for what changed.
 *
 * There is no timer. "The offer lives until you leave the page it belongs to" —
 * a strip that vanishes after a few seconds is one you must react to rather
 * than decide about.
 */
interface Undone {
  note: Note;
  index: number;
}


/**
 * The chip a row carries, which is how you can tell what a note is ABOUT.
 *
 * `DIRECTION.md` §7: **Not now** "creates a Later note carrying the alert's own
 * chip", and the preview draws exactly that — the alert type in its severity
 * colour. Every row read a neutral `Note` until this existed, so a note you
 * deferred from the front door and one you typed into the composer looked
 * identical, and the page could not say which of its rows were tied.
 *
 * READ FROM THE FINDING, never from the id. `about` looks like it carries the
 * kind — `disagreement:ORB-1627` — and for one pair it lies: `missing_ticket`
 * and `unlinked_commitment` deliberately SHARE the `missing_ticket:<noteId>`
 * namespace, because three things key on a finding's id and a rename re-raises
 * every alert somebody was already told about. Splitting the id would print
 * "Missing ticket" over an alert whose whole claim is that the promise probably
 * HAS a ticket. `KIND_LABEL` and the severity come from the alert itself or
 * from nowhere. `NotePage` draws the same component for the page the row opens,
 * because `DESIGN.md` §6 requires the two to be read from one source.
 *
 * AND FROM NOWHERE IS STILL A REAL CASE, though no longer the common one. The
 * caller hands over `/api/findings`' BOTH halves — the list plus the suppressed
 * `parked` ones — so an alert with a deferral still running resolves, which is
 * the state a freshly parked note is in and was the whole point of carrying the
 * second half. What cannot resolve is an alert that has stopped firing
 * altogether: somebody filed the ticket, the loop was broken, the two sources
 * agree again. The note outlives it, there is no kind left to name, and the
 * neutral `Alert` is the honest answer rather than a fallback — the same word
 * `Ask` uses for a tied row.
 */
export function Chip({ note, alerts }: { note: Note; alerts: Finding[] }): JSX.Element {
  if (!note.about) return <span className="chip plain">Note</span>;
  const f = alerts.find((a) => a.id === note.about);
  if (!f) return <span className="chip plain">Alert</span>;
  return <span className={`chip ${f.severity}`}>{KIND_LABEL[f.kind]}</span>;
}

export function Later({
  route,
  counts,
  alerts,
}: {
  route: Route;
  counts: Counts;
  /**
   * Every alert a row here might name — the front door's list AND the ones
   * suppressed by a deferral or a dismissal. Both halves, because a note is
   * parked exactly while its alert is in the second one. Read only to LABEL a
   * row; nothing on this page counts or lists them.
   */
  alerts: Finding[];
}): JSX.Element {
  const { data, loading, error, reload } = useJson<Note[]>('/api/vault/notes');
  const [draft, setDraft] = useState('');
  const [undone, setUndone] = useState<Undone>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string>();

  // The vault is full of notes that are not reminders — commitments, decisions,
  // briefs — and showing them here would turn a list of postponed decisions
  // into a second view of the whole vault.
  const parked = (data ?? []).filter(isParked);

  const park = async (): Promise<void> => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setFailed(undefined);
    try {
      await parkNote(draft.trim());
      setDraft('');
      setUndone(undefined);
      reload();
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: Note, index: number): Promise<void> => {
    setFailed(undefined);
    try {
      await deleteNote(n.id);
      // Acts first, offers second — never a confirm. The row is already gone by
      // the time the strip appears in its place.
      setUndone({ note: n, index });
      reload();
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    }
  };

  const undo = async (): Promise<void> => {
    if (!undone) return;
    setFailed(undefined);
    try {
      await restoreNote(undone.note);
      setUndone(undefined);
      reload();
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    }
  };

  const undoBar = (
    <UndoStrip
      label={undone?.note.title || undone?.note.body.slice(0, 60) || ''}
      onUndo={() => void undo()}
    />
  );

  return (
    <AppWindow route={route} counts={counts}>
      <div className="askpagehead">
        <h1>Later</h1>
        {/* §6 — the composer looks like the thing it makes. */}
        <div className="composer">
          <input
            type="text"
            aria-label="Park a note for later"
            placeholder="Park a note for later…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void park();
            }}
          />
          <button type="button" disabled={busy || !draft.trim()} onClick={() => void park()}>
            Add
          </button>
        </div>
        <p className="hint">
          {loading
            ? 'Reading what you parked…'
            : error
              ? explain(error)
              : parked.length
                ? `${parked.length} thing${parked.length === 1 ? '' : 's'} you parked · nothing is lost, and each one comes back`
                : 'Nothing parked right now.'}
        </p>
      </div>

      {failed && <p className="quiet">That did not work: {failed}</p>}

      {!loading && !parked.length && (
        <>
          {undone && undoBar}
          <p className="quiet">
            Anything you defer from an alert lands here, and so does anything you add above.
          </p>
        </>
      )}

      {parked.map((n, i) => (
        <div key={n.id}>
          {/* The strip takes the slot the row was in — §7. */}
          {undone?.index === i && undoBar}
          <div className="later-row">
            <a className="rowmain" href={hrefFor({ name: 'note', id: n.id })}>
              <span className="top">
                <Chip note={n} alerts={alerts} />
                {n.title && <span className="t">{n.title}</span>}
                <span className="editnote-hint">open</span>
              </span>
              {n.about ? (
                <p className="yournote">
                  <b>
                    Your note ·{' '}
                    {new Date(n.createdAt).toLocaleDateString(undefined, {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </b>
                  {n.body}
                </p>
              ) : (
                <p className="notetext">{n.body}</p>
              )}
            </a>
            <span className="due">{due(n)}</span>
            <button
              type="button"
              className="rowdel"
              aria-label="Delete this note"
              onClick={() => void remove(n, i)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {/* Deleted the last row: the slot is past the end of the list. */}
      {undone !== undefined && undone.index >= parked.length && parked.length > 0 && undoBar}
    </AppWindow>
  );
}
