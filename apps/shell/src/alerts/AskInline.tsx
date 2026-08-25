/**
 * Asking about an alert, in place.
 *
 * `DIRECTION.md` §8 — "Asking is not navigation. Opening the conversation is."
 * You type, the answer appears where you are standing, and there is no route
 * change and nothing to come back from: the citation you were reading, the
 * checklist and your question stay on screen together, and *Create the ticket*
 * is still directly above you.
 *
 * THE CAP IS THE RULE THE WHOLE DESIGN RESTS ON. §8 again: "the inline thread
 * is the tail, not the archive." Uncapped, a long conversation grows the alert
 * page without bound and the split between here and the full view stops meaning
 * anything. So the last two exchanges, and the header says how many are hidden.
 *
 * It is ONE thread. What you ask here is in the full view, and what you ask
 * there is the tail when you come back — same conversation, same store, two
 * renderings of it.
 */

import { useEffect, useState, type JSX } from 'react';
import type { Finding } from '@mc/domain';
import { ask, suggestions, type Starter, type Subject } from './chat';
import { conversationsFor, openFullLabel, useConversations } from './conversations';
import { Composer, Suggestions, Turns } from './Thread';
import { go } from './router';

/** Two exchanges — a question and its answer, twice. §8 suggests exactly this. */
const TAIL_TURNS = 4;

/** Turns come in pairs; a reader counts exchanges, not bubbles. */
const exchanges = (turns: { role: string }[]): number =>
  turns.filter((t) => t.role === 'user').length;

export function AskInline({ finding }: { finding: Finding }): JSX.Element {
  const conversations = useConversations((s) => s.conversations);
  const streaming = useConversations((s) => s.streaming);
  const newChat = useConversations((s) => s.newChat);

  const mine = conversationsFor(conversations, finding.id);
  /**
   * The thread being shown is the most recent one about this alert — NOT just
   * whatever this page visit started.
   *
   * `DIRECTION.md` §8 settles it: "It is one thread, not two: what you asked
   * inline is in the full view, and **what you ask there is the tail when you
   * go back**." Held only in component state, a reload emptied the inline
   * thread and the header fell back to "1 earlier conversation · open it →" —
   * so a conversation you had just had on the full page was, from here,
   * indistinguishable from one from last month. §9 is the same rule from the
   * other side: reopen it in October and what you asked in August is there.
   *
   * `started` is the override, for the case where you deliberately begin a new
   * one; absent it, the store decides.
   */
  const [started, setStarted] = useState<string>();
  const activeId = started ?? mine[0]?.id;
  const active = conversations.find((c) => c.id === activeId);
  const [starters, setStarters] = useState<Starter[]>([]);

  const subject: Subject = {
    id: finding.id,
    kind: finding.kind,
    claim: finding.claim,
    ...(finding.subject.kind === 'workitem' ? { key: finding.subject.key } : {}),
  };

  useEffect(() => {
    let live = true;
    void suggestions(subject).then((s) => live && setStarters(s));
    return () => {
      live = false;
    };
    // The finding is the input; re-asking on every render would spend a gather
    // per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finding.id]);

  const send = (text: string): void => {
    const id = activeId ?? newChat({ alertId: finding.id, alertClaim: finding.claim });
    setStarted(id);
    setStarters((s) => s.filter((q) => q.text !== text));
    void ask(id, text, subject);
  };

  const turns = active?.turns ?? [];
  const shown = turns.slice(-TAIL_TURNS);
  const hidden = turns.length - shown.length;
  const busy = !!activeId && streaming.includes(activeId);

  /**
   * The one route to the full view, and its label states what it will do —
   * `DESIGN.md` §7's three cases. Once there is a live thread here it says how
   * much of it you are seeing instead, because that is the more useful fact.
   */
  const openFull = (): void => {
    if (activeId) return go({ name: 'conversation', id: activeId });
    if (mine.length === 1) return go({ name: 'conversation', id: mine[0]!.id });
    if (mine.length > 1) return go({ name: 'ask', about: finding.id });
    const id = newChat({ alertId: finding.id, alertClaim: finding.claim });
    go({ name: 'conversation', id });
  };

  return (
    <div className="ask">
      <div className="askhead">
        <span className="lab">Ask about this</span>
        <button type="button" className="openfull" onClick={openFull}>
          {turns.length
            ? hidden > 0
              ? /* `DESIGN.md` §7's exact phrasing — the cap has to announce itself,
                   or a truncated thread reads as a lost one. */
                `showing the last ${exchanges(shown)} of ${exchanges(turns)} · open full conversation →`
              : `${exchanges(turns)} exchange${exchanges(turns) === 1 ? '' : 's'} here · open full conversation →`
            : openFullLabel(mine.length)}
        </button>
      </div>

      {!!shown.length && (
        <div className="thread inline">
          <Turns turns={shown} streaming={busy} scrollOnGrow />
        </div>
      )}

      <Composer
        label="Ask about this alert"
        placeholder="Ask anything about this alert…"
        busy={busy}
        onSend={send}
      />

      {!turns.length && <Suggestions items={starters} onPick={send} />}
    </div>
  );
}
