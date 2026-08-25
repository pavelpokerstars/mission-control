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
import type { Note } from '@mc/domain';
import { deleteNote, explain, parkNote, restoreNote, useJson } from './api';
import { AppWindow, type Counts } from './Chrome';
import { hrefFor, type Route } from './router';

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

export function Later({ route, counts }: { route: Route; counts: Counts }): JSX.Element {
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
    <div className="undobar">
      <span className="what">Deleted &ldquo;{undone?.note.title || undone?.note.body.slice(0, 60)}&rdquo;</span>
      <button type="button" onClick={() => void undo()}>
        Undo
      </button>
    </div>
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
                <span className="chip plain">Note</span>
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
