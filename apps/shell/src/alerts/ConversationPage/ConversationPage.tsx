/**
 * One conversation, opened.
 *
 * `DIRECTION.md` §8: "Opening the conversation is a deliberate move… You went
 * somewhere, so there is somewhere to return to." Which is why this page can
 * have an honest back link where the inline thread cannot.
 *
 * It is the SAME thread as the alert's tail — same conversation, same store.
 * What you ask here is the tail when you go back.
 *
 * A conversation about an alert also gets `Open the alert`: a link ACROSS to a
 * related page, on the right of the context bar, no arrow. `DESIGN.md` §4 keeps
 * that apart from the back link, because conflating them produces a back button
 * that lies.
 */

import { useEffect, useState, type JSX } from 'react';
import { ask, suggestions, type Starter, type Subject } from '../chat';
import { useConversations } from '../conversations';
import { useJson, type FindingDetail } from '../api';
import { AppWindow, BackLink, type Counts } from '../Chrome/Chrome';
import { Composer, Suggestions, Turns } from '../Thread/Thread';
import { go, hrefFor, navigate, recordHref, type Route } from '../router';

import './ConversationPage.css';

export function ConversationPage({
  id,
  route,
  counts,
}: {
  id: string;
  route: Route;
  counts: Counts;
}): JSX.Element {
  const conversations = useConversations((s) => s.conversations);
  const streaming = useConversations((s) => s.streaming);
  const c = conversations.find((x) => x.id === id);
  const [starters, setStarters] = useState<Starter[]>([]);

  /**
   * The alert, only when this conversation is tied to one — and it may be gone,
   * which is the good outcome. `alertClaim` is frozen on the conversation for
   * exactly that reason, so the page keeps its name either way.
   */
  const detail = useJson<FindingDetail>(
    c?.alertId ? `/api/findings/${encodeURIComponent(c.alertId)}` : undefined,
  );

  const subject: Subject | undefined =
    c?.alertId && c.alertClaim
      ? {
          id: c.alertId,
          kind: detail.data?.finding.kind ?? c.alertId.split(':')[0]!,
          claim: c.alertClaim,
          // Only once the detail lands — the conversation store keeps the claim
          // but not the impact, so a turn asked before the fetch resolves goes
          // without it rather than with a stale one.
          ...(detail.data?.finding.impact ? { impact: detail.data.finding.impact } : {}),
          ...(detail.data?.finding.subject.kind === 'workitem'
            ? { key: detail.data.finding.subject.key }
            : {}),
        }
      : undefined;

  useEffect(() => {
    if (c?.turns.length) return;
    let live = true;
    void suggestions(subject).then((s) => live && setStarters(s));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c?.id, c?.turns.length, c?.alertId]);

  if (!c) {
    return (
      <AppWindow route={route} counts={counts}>
        <BackLink to={{ name: 'ask' }} label="all conversations" />
        <div className="greet">
          <h1>That conversation is not here</h1>
          <p>
            Conversations are kept in this browser — a different laptop has its own. Start a new one
            from Ask.
          </p>
        </div>
      </AppWindow>
    );
  }

  const busy = streaming.includes(c.id);
  const send = (text: string): void => {
    setStarters((s) => s.filter((q) => q.text !== text));
    void ask(c.id, text, subject);
  };

  /**
   * What to do now, under the last answer — `DIRECTION.md` §9's fourth rule.
   *
   * NAVIGATIONS, NOT A SECOND WAY TO ACT. The preview's follow-ups are all
   * `data-go`, and that is the right reading: `/api/findings/:id/act` has one
   * caller and one result strip, and a second path to the same write is how the
   * two start to disagree about what happened. These take you to where the act
   * is, with everything it needs on screen.
   *
   * The first is the one this page cannot otherwise reach: the record behind the
   * alert's first citation, on the line it quotes. The second repeats the
   * context bar's link on purpose — `.ctxbar` is not sticky, so after a few
   * exchanges it is far above the fold, and the call to action belongs where
   * you finished reading. Same argument as the dossier's sticky rail.
   *
   * A general conversation has no subject, so it gets none. That is honest
   * rather than missing: there is nothing to act on.
   */
  const cite = detail.data?.finding.evidence.find((e) => e.ref);
  const followups =
    c?.alertId && detail.data ? (
      <div className="followups">
        {cite ? (
          <button
            type="button"
            onClick={() => {
              navigate(recordHref(cite, detail.data!.finding.id));
            }}
          >
            Show me where this was said
          </button>
        ) : null}
        <button
          type="button"
          className="sec"
          onClick={() => go({ name: 'alert', id: c.alertId! })}
        >
          Back to the alert to act
        </button>
      </div>
    ) : undefined;

  return (
    <AppWindow route={route} counts={counts}>
      <BackLink to={{ name: 'ask' }} label="all conversations" />

      <div className="ctxbar">
        <span className="chip plain">{c.alertId ? 'Alert' : 'General'}</span>
        {c.alertId ? (
          <>
            <span className="about">
              About <b>{c.alertClaim}</b>
            </span>
            <a className="backlink" href={hrefFor({ name: 'alert', id: c.alertId })}>
              Open the alert
            </a>
          </>
        ) : (
          <span className="about">{c.turns.length ? c.title : 'New chat'}</span>
        )}
      </div>

      {c.turns.length ? (
        <div className="thread">
          <Turns turns={c.turns} streaming={busy} scrollOnGrow followups={followups} />
        </div>
      ) : (
        <div className="emptychat">
          <h3>Ask anything</h3>
          <p>
            {c.alertId
              ? 'This one already knows the alert it came from, so you can go straight to the question.'
              : 'This one starts with no subject, and reads the same sources everything else does. Nothing about the answers changes — only what it began knowing.'}
          </p>
          <Suggestions items={starters} onPick={send} />
        </div>
      )}

      <div className="ask">
        <Composer
          label={c.turns.length ? 'Continue the conversation' : 'Ask anything'}
          placeholder={c.turns.length ? 'Ask anything else…' : 'Ask anything…'}
          busy={busy}
          onSend={send}
        />
      </div>
    </AppWindow>
  );
}
