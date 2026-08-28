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

import { useEffect, useRef, useState, type JSX } from 'react';
import { andList, type AskAudience, type Finding } from '@mc/domain';
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
  // The fallbacks. `primaryLabel` names the owner when a record does — see
  // below, which is the comment that used to live here saying it could not.
  dropped_commitment: 'Ask the owner where this got to',
};

/**
 * The primary label, with the owner in it when a record names one.
 *
 * This was a plain lookup, under a comment reading *"static, because `PRIMARY`
 * is looked up with no finding in scope — so it cannot name the owner, however
 * much better 'Ask Esme' would read"*. It has a finding in scope now, and an
 * `AskAudience` that says who — which is the whole of the complaint: *"'Ask
 * someone' — who am I sending a message to?"*
 *
 * `Ask both, in one thread` keeps the preview's wording rather than expanding
 * to two names: the label is about the SHAPE of the ask — one conversation
 * with both, not two side channels — and the result strip names them.
 */
function primaryLabel(finding: Finding, audience: AskAudience): string {
  const who = audience.to[0];
  if (!who) return PRIMARY[finding.kind] ?? 'Open it';
  if (finding.kind === 'aging') return `Ask ${who}`;
  if (finding.kind === 'dropped_commitment') return `Ask ${who} where this got to`;
  return PRIMARY[finding.kind] ?? 'Open it';
}

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
 * THE SECOND BUTTON, WHICH WAS `Ask someone` ON EVERY ALERT AND OFTEN THE SAME
 * CALL AS THE FIRST.
 *
 * On a cycle, a disagreement, an aging ticket, a stale link and a dropped
 * commitment the primary already drafts the question — `primaryProposal`
 * returns `askProposal(f)` for all five — so the second button pressed the same
 * one again, under a label that named nobody either time.
 *
 * THE PREVIEW'S ANSWER FOR THE DISAGREEMENT IS `Open MC-102`, AND WE CANNOT
 * HAVE IT. Its result — "opened, with both records pinned beside the ticket" —
 * is a Jira write we do not make, and a button that merely NAVIGATED to the
 * record would break two rules at once: `DESIGN.md` §4 ("a record — click a
 * citation — there is no other way in") and the in-place rule
 * `verify-design.mts` enforces, which is that an action resolves where it was
 * pressed. So the second button stays an ask, and the difference has to be real
 * rather than decorative.
 *
 * It is, wherever the records name more than one person: the primary asks all
 * of them together — that is what "in one thread" MEANS, both seeing the same
 * question — and this asks one of them on their own. Two different messages,
 * and the labels say which is which.
 *
 * Where only one person is named the two genuinely coincide, and the lead says
 * so out loud. That is the preview's own copy, on the one screen where it
 * happens: *"Both Ask buttons draft a Slack message to #eng-platform and send
 * nothing until you read it."*
 */
function secondaryAsk(finding: Finding, audience: AskAudience): { label: string; to?: string[] } {
  const first = audience.to[0];
  if (!WRITES[finding.kind] && audience.to.length > 1 && first) {
    return { label: `Ask ${first} only`, to: [first] };
  }
  return { label: audience.to.length ? `Ask ${andList(audience.to)}` : 'Ask someone' };
}

/** True when both ask buttons would draft the same message — see above. */
function asksTwice(finding: Finding, audience: AskAudience): boolean {
  return !WRITES[finding.kind] && audience.to.length <= 1;
}

/** "to jonas.jost and cleo.calder in #orbit-delivery", or the honest absence. */
function addressed(audience: AskAudience): string {
  const where = audience.channel ? ` in #${audience.channel}` : '';
  return audience.to.length
    ? `to ${andList(audience.to)}${where}`
    : `to nobody yet${where} — nothing in the records names who to ask`;
}

function whatHappens(finding: Finding, safe: boolean, audience: AskAudience): string {
  const primary = primaryLabel(finding, audience);
  const writes = WRITES[finding.kind];

  /**
   * The destination AND the recipients, in one place, because they belong in
   * every branch.
   *
   * It named only the channel before, and often not even that: *"addressed to
   * the people in the records above"* over a payload that carried no recipient
   * at all. Neither absence is a gap to paper over — `act.ts` drafts without a
   * channel rather than guessing where, and without a name rather than guessing
   * who — but the lead has to SAY which of them is missing, because the reader's
   * question is "who am I sending this to" and the answer is sometimes "nobody
   * the records name".
   */
  const where = ` ${addressed(audience)}`;
  const parks = `${
    asksTwice(finding, audience) ? 'Both Ask buttons draft the same message. ' : ''
  }Not now parks it in Later with your note; dismissing is final.`;

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

/** The drafted message, split for display. Empty for anything that is not one. */
function draftLines(result: ActionResult): string[] {
  const text = result.proposal?.payload?.text;
  return text ? text.split('\n').filter((l) => l.trim()) : [];
}

/**
 * Whether this result is a message still waiting to go.
 *
 * `post_message` is the only proposal a person can still change: a ticket and a
 * link are applied by the primary button and are already done by the time the
 * strip renders, and the thing being edited here — words that will go out over
 * somebody's name — is the one that is worth reading twice.
 */
function isUnsentDraft(result: ActionResult): boolean {
  return result.proposal?.kind === 'post_message' && !result.sent && !result.failed;
}

export function Actions({
  finding,
  audience,
  safeMode = true,
  fileNow = 0,
  onDone,
}: {
  finding: Finding;
  /**
   * Who a message about this would go to, computed by the gateway.
   *
   * Handed down rather than re-derived: `askChannel` used to parse the same
   * evidence label `act.ts` parsed, under a comment saying that deriving it
   * twice is how the button and the message it produces come to name different
   * channels. It needs more than the label now, so there is one definition —
   * `askAudience` in `@mc/domain` — and this is its answer.
   */
  audience: AskAudience;
  /**
   * Whether this instance may write to a vendor. See the gateway's `safe-mode.ts`,
   * which defaults the same way and for the same reason: unset means ON, because
   * the failure of guessing wrong is a button that promises a write it cannot make.
   */
  safeMode?: boolean;
  /**
   * Press the primary action from somewhere else on the page.
   *
   * The checklist's cross is where the problem is stated — *"no ticket"* — and
   * `DESIGN.md` §7 puts the answer to it three bands below. A counter rather
   * than a callback because the trigger is an EVENT: the same press can be made
   * again after `choose something else`, and a boolean cannot say "again".
   */
  fileNow?: number;
  onDone: () => void;
}): JSX.Element {
  const [result, setResult] = useState<ActionResult>();
  /**
   * The message as the reader has it, once they have touched it.
   *
   * `undefined` means untouched, and the draft is read from the result — so a
   * fresh draft always shows, and an edited one is never overwritten by a
   * re-render. Storing the drafted text here instead would make those two cases
   * indistinguishable.
   */
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [note, setNote] = useState('');
  const [when, setWhen] = useState(WHEN[0]!.items[1]!.value);
  /** What the calendar holds, only consulted when `when` is `CUSTOM`. */
  const [picked, setPicked] = useState(() => isoDay(plusDays(7)));
  const until = when === CUSTOM ? new Date(`${picked}T09:00:00`).toISOString() : when;
  const second = secondaryAsk(finding, audience);

  /**
   * Fired from the checklist, and scrolled to, because the reader is looking at
   * the row they pressed and the answer arrives a band or two below it.
   *
   * `run` is not in the dependency list on purpose: it is a fresh closure every
   * render, so naming it would re-fire on every keystroke in the defer form.
   * The guard is the counter itself — the value acted on is remembered, so a
   * re-render with the same number does nothing.
   */
  const fired = useRef(0);
  const block = useRef<HTMLDivElement>(null);
  /** Whether the reader is up at the checklist rather than down here. */
  const cameFromTheRow = useRef(false);
  useEffect(() => {
    if (!fileNow || fileNow === fired.current) return;
    fired.current = fileNow;
    cameFromTheRow.current = true;
    void run({ action: 'primary' });
  }, [fileNow]);

  /**
   * Scroll to the answer, but only when it was asked for from somewhere else.
   *
   * Not in the `then` of the call above: the block this ref is on does not exist
   * until the result renders, so at that point `block.current` is still null and
   * the scroll silently did nothing. It has to wait for the mount, which is what
   * an effect on `result` is.
   *
   * And only for the inline press. Pressing a button down here already has the
   * answer in view, and moving the page under somebody who has not gone anywhere
   * is the kind of help nobody asked for.
   */
  useEffect(() => {
    if (!result || !cameFromTheRow.current) return;
    cameFromTheRow.current = false;
    block.current?.scrollIntoView({ block: 'center' });
  }, [result]);

  const run = async (input: Parameters<typeof act>[1]): Promise<void> => {
    setBusy(true);
    try {
      // A new result is a new draft: whatever was half-edited belonged to the
      // last one, and carrying it over would send one alert's words on another.
      setDraft(undefined);
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
      <div className="block" ref={block}>
        <h4>What now</h4>
        <div className={`result${result.failed ? ' failed' : ''}`}>
          {/* The mark states the outcome, so it cannot be a tick over a refusal.
              `.tick` is the class the preview draws and it carries the colour;
              the glyph is what changes. */}
          <span className="tick" aria-hidden="true">{result.failed ? '!' : '✓'}</span>
          <div>
            <p>{result.outcome}</p>
            {/*
              THE DRAFT, VERBATIM, because the line above it says "read it
              before it goes" and nothing showed it.

              The strip reported a citation COUNT instead — *"2 citations went
              with it — the meeting, the rationale and the records it was read
              from"* — which is `create_issue`'s sentence, printed over a Slack
              message that has no meeting and carries its citations as quotes
              inside its own body. So the reader was told to read something the
              interface would not display, under a description of a different
              proposal.

              One line per line and not one per paragraph: the quoted records
              are `>`-prefixed, which is Slack's own quote syntax, and joining
              them into a paragraph would show something other than what will be
              posted. This is the message.
            */}
            {isUnsentDraft(result) ? (
              /*
                THE MESSAGE, EDITABLE, IN A SURFACE OF ITS OWN.
                *"I want to know what the message is before I send it, maybe
                have an option to alter it."* The draft is a starting point: we
                can say who and quote what, and we cannot know the sentence this
                team would actually use. What is posted is what is in this box —
                `send` carries it and `amendProposal` writes it onto the
                proposal, so what is journalled is what went.

                Inside `.draft` rather than loose under the outcome, because the
                sentence above is the app reporting and this is the artefact it
                is reporting on: run together in one weight they read as one
                paragraph, which is what they did.

                The two controls share a row. `Send it` is the act and `choose
                something else` is the way out of having chosen — stacked, the
                link read as a caption on the button.
              */
              <div className="draft">
                <span className="lab">The message</span>
                <div className="noteedit">
                  <textarea
                    className="tall"
                    aria-label="The message, before it goes"
                    value={draft ?? result.proposal?.payload?.text ?? ''}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                </div>
                <div className="editacts">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !(draft ?? result.proposal?.payload?.text ?? '').trim()}
                    onClick={() =>
                      void run({
                        action: 'send',
                        text: draft ?? result.proposal?.payload?.text ?? '',
                        ...(result.proposal?.payload?.to?.length
                          ? { to: result.proposal.payload.to }
                          : {}),
                      })
                    }
                  >
                    Send it
                  </button>
                  <button type="button" className="undo" onClick={() => setResult(undefined)}>
                    choose something else
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/*
                  THE SAME SURFACE ONCE IT HAS GONE, so the two states differ by
                  the editor and nothing else. A quoted record is drawn with the
                  left rule it has everywhere else in this app rather than the
                  `>` it is typed with — the marker is Slack's syntax, and the
                  reader is looking at a record, not at markup.
                */}
                {!!draftLines(result).length && (
                  <div className="draft">
                    <span className="lab">{result.sent ? 'What went' : 'The message'}</span>
                    {draftLines(result).map((line, i) =>
                      line.startsWith('>') ? (
                        <p className="q" key={i}>
                          {line.replace(/^>\s*/, '')}
                        </p>
                      ) : (
                        <p key={i}>{line}</p>
                      ),
                    )}
                  </div>
                )}
                {/*
                  `choose something else` — the preview's own affordance, and
                  `DESIGN.md` §7's "acting stays undoable" applied to an action
                  rather than a delete. No timer and no confirm: the offer lives
                  until you leave the page it belongs to, so this is a decision
                  rather than something you must react to.

                  It re-renders the four buttons. It does NOT undo the effect,
                  and must not be written as though it does — what it undoes is
                  having chosen, while the alert is still in front of you.
                */}
                <p>
                  <button type="button" className="undo" onClick={() => setResult(undefined)}>
                    choose something else
                  </button>
                </p>
              </>
            )}
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
      <p className="blocklead">{whatHappens(finding, safeMode, audience)}</p>
      <div className="acts">
        <button
          className="primary"
          type="button"
          disabled={busy}
          onClick={() => void run({ action: 'primary' })}
        >
          {primaryLabel(finding, audience)}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ action: 'ask', ...(second.to ? { to: second.to } : {}) })}
        >
          {second.label}
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
