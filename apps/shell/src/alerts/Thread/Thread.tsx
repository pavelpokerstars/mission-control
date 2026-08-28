/**
 * The turns, and the box you type into.
 *
 * Shared by the alert's inline tail and the full conversation page, because
 * `DIRECTION.md` §8 is explicit that they are **one thread, not two**: "what
 * you asked inline is in the full view, and what you ask there is the tail when
 * you go back." Two renderers is how they start to disagree about what a turn
 * looks like.
 *
 * What is NOT shared is the subject. §8 warns about exactly that: "It is
 * tempting to make one component serve both and then wonder why the global one
 * keeps asking which ticket you mean." So the subject is the caller's, and this
 * only draws.
 */

import { useEffect, useRef, useState, type JSX } from 'react';
import type { ChatTurn } from '@mc/domain';
import { Answer } from '../Answer/Answer';
import type { Starter } from '../chat';

import './Thread.css';

export function Turns({
  turns,
  streaming,
  scrollOnGrow = false,
  followups,
}: {
  turns: ChatTurn[];
  streaming?: boolean;
  scrollOnGrow?: boolean;
  /**
   * What to do now, under the last answer. `DIRECTION.md` §9's fourth rule:
   * "Every answer can end in an action, so the chat is never a dead end."
   *
   * The caller's, for the same reason the subject is — this only draws. It is
   * rendered inside the last agent turn's body rather than after the thread,
   * because that is where the preview puts it and because a control floating
   * between the thread and the composer belongs to neither.
   */
  followups?: JSX.Element;
}): JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  /**
   * ON GROW, WHICH IS WHAT THE PROP IS CALLED AND WAS NOT WHAT IT DID.
   *
   * The effect fired on mount as well, so an alert that already had a
   * conversation opened at the bottom of that conversation: click a row on the
   * front door and the page arrives ~420px down, at whatever sentence the last
   * answer ended on, with the claim and the evidence above the fold. The same
   * on the way back from a citation. It looks like the router forgetting to
   * scroll and it is this, one component lower — the address change DOES put
   * the page at its top (`AlertApp`), and then the thread pulled it down again.
   *
   * A ref rather than a `useState`, because remembering the previous length
   * must not itself cause a render — and the first run only records, so the
   * tail of a thread you already had is where the page starts, not where it
   * jumps to.
   */
  const seen = useRef<number | undefined>(undefined);
  useEffect(() => {
    const before = seen.current;
    seen.current = turns.length;
    if (before === undefined || turns.length <= before) return;
    if (scrollOnGrow) end.current?.scrollIntoView({ block: 'nearest' });
  }, [turns.length, scrollOnGrow]);

  return (
    <>
      {turns.map((t, i) => (
        <div className={`turn ${t.role === 'user' ? 'you' : 'mc'}`} key={i}>
          <div className="badge">{t.role === 'user' ? 'PP' : 'MC'}</div>
          <div className="body">
            {t.text ? (
              <Answer text={t.text} />
            ) : streaming && i === turns.length - 1 ? (
              /**
               * `DESIGN.md` §9 lists loading as unsettled, and this is the one
               * place in the app where something is genuinely slow: a CLI turn
               * is 20–60 seconds. An empty bubble reads as a failure, so it says
               * what it is doing and roughly how long that takes.
               */
              <p className="quiet">Reading across every connected source… this takes a moment.</p>
            ) : null}
            {/* Only under the finished last answer: mid-stream it would
                appear, move as the text grows, and offer an action about a
                sentence that is not there yet. */}
            {followups && !streaming && t.role === 'agent' && t.text && i === turns.length - 1
              ? followups
              : null}
          </div>
        </div>
      ))}
      <div ref={end} />
    </>
  );
}

export function Composer({
  placeholder,
  busy,
  onSend,
  label,
}: {
  placeholder: string;
  busy?: boolean;
  onSend: (text: string) => void;
  label: string;
}): JSX.Element {
  const [text, setText] = useState('');
  const send = (): void => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    onSend(q);
  };
  return (
    <div className="composer">
      <input
        type="text"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />
      <button type="button" disabled={busy || !text.trim()} onClick={send}>
        {busy ? '…' : 'Ask'}
      </button>
    </div>
  );
}

/**
 * The starter questions, which retire as they are used.
 *
 * Asking one and leaving it on screen invites asking it again. The others are
 * still good questions — `suggest.ts` re-ranks and would offer fresh ones.
 */
export function Suggestions({
  items,
  onPick,
}: {
  items: Starter[];
  onPick: (q: string) => void;
}): JSX.Element | null {
  if (!items.length) return null;
  return (
    <div className="sugg">
      {items.map((s) => (
        <button type="button" key={s.text} onClick={() => onPick(s.text)} title={s.why}>
          {s.text}
        </button>
      ))}
    </div>
  );
}
