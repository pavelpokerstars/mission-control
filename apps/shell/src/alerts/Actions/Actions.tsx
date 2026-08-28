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
import { act, type ActionResult } from '../api';
import { DatePicker, fmtDay, isoDay, nextWeekday, plusDays } from '../DatePicker/DatePicker';

import './Actions.css';

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

/**
 * Which kinds WRITE when you press the primary button, and which only draft.
 *
 * `act.ts`'s `APPLIES` is the authority — `create_issue`, `link_issues` and
 * `link_commitment` go straight through `accept_proposal`, so one click is a
 * real tracker write. Everything else drafts a Slack message and sends nothing.
 * Mirrored here rather than fetched because the reader needs it BEFORE the
 * click, and a round trip to find out what a button does is not a disclosure.
 *
 * Keep this in step with `APPLIES`. A kind that starts writing and is not listed
 * here says "drafts" over a button that files a ticket, which is the failure
 * this whole block exists to prevent, inverted.
 */
const WRITES: Partial<Record<Finding['kind'], 'jira' | 'vault'>> = {
  missing_ticket: 'jira',
  undetected_dependency: 'jira',
  /**
   * `link_commitment` APPLIES like the other two and safe mode does NOT stop it,
   * because what it writes is the VAULT — and `safe-mode.ts` says so in its own
   * header: it guards the vendor connectors and leaves ours alone. So the click
   * sticks, the promise records the key as confirmed, and the alert stops
   * firing, on the instance where the other primaries refuse. Only the
   * provenance comment it tries to leave on the ticket is blocked, and `act.ts`
   * reports that separately.
   *
   * Lumping it in with the Jira writers told the reader it was inert here. It is
   * the opposite: it is the one primary that always works.
   */
  unlinked_commitment: 'vault',
};

/**
 * The channel the draft is addressed to, read off the evidence.
 *
 * `askProposal` in `act.ts` derives it the same way and from the same field —
 * a Slack evidence label is `#channel — author`. Deriving it twice is how the
 * button and the message it produces come to name different channels, so if
 * this ever needs more than the label, both should move to one place.
 *
 * Undefined is a real answer, and `act.ts` handles it: nothing in the evidence
 * says where this was discussed, and guessing a channel would be inventing a
 * destination.
 */
function askChannel(finding: Finding): string | undefined {
  return finding.evidence
    .filter((e) => e.surface === 'slack')
    .map((e) => /^#([^\s—]+)/.exec(e.label)?.[1])
    .find(Boolean);
}

/**
 * The sentence under "What now" — where each button goes, before you press it.
 *
 * The complaint this answers: *"when it says 'Ask about…' or 'Ask someone…' we
 * don't know where the message will be sent and that it will be sent on slack.
 * Same thing goes about opening a ticket or 'Not now'."* Every one of those is
 * a destination the button names nothing about.
 *
 * SAFE MODE IS THE FIRST CLAUSE WHEN IT IS ON, because it is the default and it
 * changes what every other clause means. `act.ts` is honest about the refusal
 * AFTER the click — "That did not go through… Nothing was written" — and a
 * button promising a Jira write on an instance that cannot make one is the same
 * defect one step earlier.
 */
function whatHappens(finding: Finding, safe: boolean): string {
  const channel = askChannel(finding);
  const primary = PRIMARY[finding.kind] ?? 'The first button';
  const writes = WRITES[finding.kind];

  /**
   * The destination, in ONE place, because it belongs in every branch.
   *
   * It was written into the writable branch alone — and safe mode is the
   * default, so on eighteen of nineteen alerts the lead named no destination at
   * all, which is the complaint verbatim.
   *
   * No channel is a real answer and not a gap: `act.ts` drafts without one
   * rather than guessing, because nothing in the records says where this was
   * discussed. It does not say "pick one" — there is no channel picker, and
   * naming an affordance that does not exist is the defect one layer up.
   */
  const where = channel
    ? ` to #${channel}`
    : ' addressed to the people in the records above — nothing in them names a channel';
  const parks = 'Not now parks it in Later with your note; dismissing is final.';

  if (safe) {
    // `vault` writes are ours, so safe mode does not stop them. Saying "nothing
    // happens here" over a button that permanently silences the alert would be
    // the worst version of this whole disclosure.
    if (writes === 'vault') {
      return (
        `${primary} records the key on the promise here — that sticks, and this alert stops. ` +
        `This instance is read-only, so the comment it tries to leave on the ticket is the part ` +
        `that cannot go. Asking drafts a Slack message${where}, and nothing sends it. ${parks}`
      );
    }
    return (
      `Read-only instance. ${writes ? `${primary} would write to Jira, and asking` : 'Asking'} ` +
      `would draft a Slack message${where} — and nothing here leaves this machine. ${parks}`
    );
  }

  if (writes === 'vault') {
    return (
      `${primary} records the key on the promise and comments on the ticket, so this alert stops. ` +
      `Asking drafts a Slack message${where}, and nothing sends it. ${parks}`
    );
  }
  return (
    `${writes ? `${primary} writes to Jira now. Asking` : 'Asking'} drafts a Slack message${where}, ` +
    `and nothing sends it. ${parks}`
  );
}

export function Actions({
  finding,
  safeMode = true,
  onDone,
}: {
  finding: Finding;
  /**
   * Whether this instance may write to a vendor. See the gateway's `safe-mode.ts`,
   * which defaults the same way and for the same reason: unset means ON, because
   * the failure of guessing wrong is a button that promises a write it cannot make.
   */
  safeMode?: boolean;
  onDone: () => void;
}): JSX.Element {
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
      <p className="blocklead">{whatHappens(finding, safeMode)}</p>
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
