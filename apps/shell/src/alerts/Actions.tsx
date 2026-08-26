/**
 * The four answers to an alert.
 *
 * `DESIGN.md` §7 — two of them are "no", because they are different answers.
 * "Not needed" is a decision and does not come back; "Not now" asks for a note
 * and when it should return. Collapsing them is what leaves Later empty.
 *
 * Each button's label states what it will do, so clicking holds no surprise, and
 * the result strip says what happened in as many words.
 *
 * THERE IS NO QUEUE, AND THERE SHOULD NOT BE. The design preview settles this:
 * clicking an action replaces this block with the result and a
 * `choose something else` link, in place, with no navigation. The alert page IS
 * the review surface — the reader has the claim, the checklist and every
 * citation in front of them, and a second screen re-asks a question they just
 * answered. `DIRECTION.md` §3 lists four pages and a proposal queue is not one
 * of them; neither it nor `DESIGN.md` uses the word "proposal" at all.
 *
 * A `Proposal` is still the internal mechanism for the write and its
 * provenance. That is a fact about `act.ts`, not a screen.
 *
 * THE PRIMARY ACTION COMPLETES. The preview reports "MC-112 created … so this
 * alert will not fire again" — past tense — and only the message actions draft
 * ("Nothing has been sent. Read it before it goes."). That difference is what
 * each button says it will do, and a person clicking "Create the ticket" in
 * front of the claim, the checklist and every citation has already reviewed it;
 * a second screen re-asks what they just answered. `HUMAN_ONLY` is untouched —
 * it withholds both verbs from every provider, and `/act` is not a tool.
 */

import { useState, type JSX } from 'react';
import type { Finding } from '@mc/domain';
import { act, type ActionResult } from './api';
import { DatePicker, fmtDay, isoDay, nextWeekday, plusDays } from './DatePicker';

/** The primary action per alert type. The label is a promise about the effect. */
const PRIMARY: Partial<Record<Finding['kind'], string>> = {
  missing_ticket: 'Create the ticket',
  cycle: 'Ask about the loop',
  disagreement: 'Ask both, in one thread',
  suspect_link: 'Ask whether it still holds',
  undetected_dependency: 'Add the link',
  aging: 'Ask the owner',
  // "Link it", not "Create it": the ticket already exists and the missing thing
  // is the connection. Offering to create one here would file a duplicate.
  unlinked_commitment: 'Link it to the ticket',
  // Static, because `PRIMARY` is looked up with no finding in scope — so it
  // cannot name the owner, however much better "Ask Esme" would read.
  dropped_commitment: 'Ask the owner where this got to',
};

/**
 * What "not needed" means here, which is different per alert.
 *
 * A generic "dismiss" makes the reader supply the reason themselves, and the
 * reason is the interesting part — "it is not really circular" is a fact about
 * the plan that is worth recording, and "already resolved" is not the same
 * claim at all.
 */
const DISMISS: Partial<Record<Finding['kind'], string>> = {
  missing_ticket: 'Not needed — dismiss',
  cycle: 'It is not really circular — dismiss',
  disagreement: 'Already resolved — dismiss',
  suspect_link: 'The link is correct — dismiss',
  undetected_dependency: 'Not a dependency — dismiss',
  aging: 'It is fine where it is — dismiss',
  unlinked_commitment: 'Wrong ticket — dismiss',
  dropped_commitment: 'It was handled elsewhere — dismiss',
};

/**
 * Reminders can be events, not just dates — the half a generic snooze cannot do.
 *
 * You are rarely waiting for Tuesday; you are waiting for a person or a ticket,
 * and this app is already watching both. The event options carry no date, which
 * is deliberate: `suppressedIds` holds a dateless deferral until something
 * evaluates the watch, and re-raising what somebody explicitly parked is the
 * fastest way to teach them the list is not listening.
 */
/**
 * Not a date, and deliberately not parseable as one.
 *
 * Picking it reveals the calendar; what is *sent* is whatever the calendar
 * holds. If this ever reached `until` it would be stored as an unparseable
 * reminder — which `suppressedIds` treats as an event-based watch and holds
 * forever, so the alert would simply never come back.
 */
export const CUSTOM = 'custom';

export const WHEN = [
  {
    group: 'On a date',
    items: [
      { value: plusDays(1).toISOString(), label: 'Tomorrow morning' },
      /**
       * `DESIGN.md` §7 lists five dated options; two were missing. Monday is the
       * one people actually pick — "not this week" is the commonest deferral
       * there is — and it must be computed, not written down: the preview's own
       * bug list records a hand-written "Monday morning" that resolved to a
       * Tuesday, and there is an assertion about it for that reason.
       */
      { value: nextWeekday(1).toISOString(), label: 'Monday morning' },
      { value: plusDays(7).toISOString(), label: 'In a week' },
      { value: plusDays(14).toISOString(), label: 'In two weeks' },
      /** The escape hatch. `CUSTOM` is a sentinel, not a date — see below. */
      { value: CUSTOM, label: 'Pick a date…' },
    ],
  },
  {
    group: 'When something happens',
    items: [
      { value: 'when the sprint ends', label: 'When the sprint ends' },
      { value: 'if anything changes on it', label: 'If anything changes on it' },
      { value: 'when the thing it waits on moves', label: 'When the thing it waits on moves' },
      { value: 'if nobody has touched it in a week', label: 'If nobody has touched it in a week' },
    ],
  },
];


/** Every dated option shows the date it resolves to — `DESIGN.md` §7. */
export function optionLabel(label: string, value: string): string {
  if (value === CUSTOM) return label;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return label;
  return `${label} · ${fmtDay(new Date(t))}`;
}

export function Actions({ finding, onDone }: { finding: Finding; onDone: () => void }): JSX.Element {
  const [result, setResult] = useState<ActionResult>();
  const [busy, setBusy] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(WHEN[0]!.items[1]!.value);
  /** What the calendar holds, only consulted when `when` is `CUSTOM`. */
  const [picked, setPicked] = useState(() => isoDay(plusDays(7)));
  const until = when === CUSTOM ? new Date(`${picked}T09:00:00`).toISOString() : when;

  const run = async (input: Parameters<typeof act>[1]): Promise<void> => {
    setBusy(true);
    try {
      setResult(await act(finding.id, input));
      setDeferring(false);
      // The list has changed underneath — a dismissal or a deferral removes a
      // row — so the caller refreshes rather than leaving a stale count behind.
      onDone();
    } catch (e) {
      setResult({ outcome: `That did not work: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="block">
        <h4>What now</h4>
        <div className="result">
          <span className="tick" aria-hidden="true">✓</span>
          <div>
            <p>{result.outcome}</p>
            {result.proposal && (
              <p>
                {result.proposal.evidence.length} citation
                {result.proposal.evidence.length === 1 ? '' : 's'} went with it — the meeting, the
                rationale and the records it was read from.
              </p>
            )}
            {/*
              `choose something else` — the preview's own affordance, and
              `DESIGN.md` §7's "acting stays undoable" applied to an action
              rather than a delete. No timer and no confirm: the offer lives
              until you leave the page it belongs to, so this is a decision
              rather than something you must react to.

              It re-renders the four buttons. It does NOT undo the effect, and
              must not be written as though it does — what it undoes is having
              chosen, while the alert is still in front of you.
            */}
            <p>
              <button type="button" className="undo" onClick={() => setResult(undefined)}>
                choose something else
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (deferring) {
    return (
      <div className="block">
        <h4>What now</h4>
        <div className="deferform">
          <p className="deferlead">
            Park <b>{finding.claim}</b> and let it come back.
          </p>
          <div className="noteedit">
            <textarea
              aria-label="Why you are leaving it"
              placeholder="Why you are leaving it — the note you will thank yourself for…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="duepick">
            <label className="lab" htmlFor="deferwhen">
              Bring it back
            </label>
            <span className="selwrap">
              <select id="deferwhen" value={when} onChange={(e) => setWhen(e.target.value)}>
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
            {/* Revealed by "Pick a date…", exactly as the preview reveals it. */}
            {when === CUSTOM && <DatePicker value={picked} onChange={setPicked} />}
          </div>
          <div className="editacts">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run({ action: 'defer', note, until })}
            >
              Park it
            </button>
            <button type="button" onClick={() => setDeferring(false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="block">
      <h4>What now</h4>
      <div className="acts">
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void run({ action: 'primary' })}
        >
          {PRIMARY[finding.kind] ?? 'Open it'}
        </button>
        <button type="button" disabled={busy} onClick={() => void run({ action: 'ask' })}>
          Ask someone
        </button>
        <button type="button" disabled={busy} onClick={() => setDeferring(true)}>
          Not now
        </button>
        <button
          className="ghost"
          type="button"
          disabled={busy}
          onClick={() => void run({ action: 'dismiss', reason: DISMISS[finding.kind] })}
        >
          {DISMISS[finding.kind] ?? 'Not needed — dismiss'}
        </button>
      </div>
    </div>
  );
}
