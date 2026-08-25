/**
 * Ask — a question about nothing in particular, and the threads that outgrew
 * their alert.
 *
 * `DIRECTION.md` §9: there is no global History destination, because "you would
 * open it knowing only a date" and that fails §3's test. This is not that. It is
 * a composer that starts a chat with no subject, plus the recent list — and its
 * rows are the route back into conversations you started somewhere else.
 *
 * `DESIGN.md` §5: rows are labelled by **what they are about**. A conversation
 * about an alert is titled with the alert and your question becomes the
 * subtitle. That was wrong for several revisions — titled with the question, so
 * the page you left and the page you arrived at named the same thing
 * differently.
 */

import { Fragment, useState, type JSX } from 'react';
import { ask } from './chat';
import { historyOf, relativeTime, useConversations, type Conversation } from './conversations';
import { AppWindow, BackLink, type Counts } from './Chrome';
import { Composer } from './Thread';
import { go, hrefFor, type Route } from './router';

/**
 * The preview's own structure: a `.convrow` container holding a `.rowmain`
 * plus a sibling `.rowdel`.
 *
 * `DESIGN.md` §5 says why — "a delete control cannot live inside the button
 * that opens the row". Making the whole row one anchor is the shortcut, and it
 * costs both the delete and the styling: `a.convrow` underlines, which is the
 * same defect `a.row` and `a.rowmain` each needed a rule for.
 */
function Row({ c, onDelete }: { c: Conversation; onDelete: () => void }): JSX.Element {
  const question = c.turns.find((t) => t.role === 'user')?.text ?? '';
  return (
    <div className={`convrow ${c.alertId ? 'tied' : 'general'}`}>
      <a className="rowmain" href={hrefFor({ name: 'conversation', id: c.id })}>
        <span className="top">
          <span className="chip plain">{c.alertId ? 'Alert' : 'General'}</span>
          <span className="t">{c.alertClaim ?? c.title}</span>
        </span>
        <span className="m">
          {/* The question is the subtitle on a tied row; on an untied one it is
              already the title, and printing it twice reads as a template bug. */}
          {c.alertId && question && <span className="q">&ldquo;{question}&rdquo;</span>}
          <span className="when">{relativeTime(c.updatedAt)}</span>
        </span>
      </a>
      <span className="n">
        {c.turns.length} message{c.turns.length === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        className="rowdel"
        aria-label="Delete this conversation"
        onClick={onDelete}
      >
        ✕
      </button>
    </div>
  );
}

export function Ask({
  about,
  route,
  counts,
}: {
  /** Filtered to one alert's conversations — `DESIGN.md` §7's third case. */
  about?: string;
  route: Route;
  counts: Counts;
}): JSX.Element {
  const conversations = useConversations((s) => s.conversations);
  const newChat = useConversations((s) => s.newChat);
  const removeConversation = useConversations((s) => s.remove);
  const [busy, setBusy] = useState(false);
  /**
   * Same rule as Later — `DESIGN.md` §7. Delete acts, the strip takes the slot
   * the row was in, and undo puts it back at its index. A conversation is
   * cheaper to lose than a note and the rule is the same either way: no
   * "are you sure?", because you already decided before you read it.
   */
  const [undone, setUndone] = useState<{ c: Conversation; index: number }>();

  const restore = (): void => {
    if (!undone) return;
    useConversations.setState((st) => {
      const next = [...st.conversations];
      next.splice(Math.min(undone.index, next.length), 0, undone.c);
      return { conversations: next };
    });
    setUndone(undefined);
  };

  const undoBar = (
    <div className="undobar">
      <span className="what">Deleted &ldquo;{undone?.c.alertClaim ?? undone?.c.title}&rdquo;</span>
      <button type="button" onClick={restore}>
        Undo
      </button>
    </div>
  );

  const all = historyOf(conversations);
  const rows = about ? all.filter((c) => c.alertId === about) : all;

  /**
   * A question typed here starts a chat and opens it.
   *
   * The answer streams on the conversation page rather than here, because §8's
   * split is that asking in place belongs to an alert — this composer's job is
   * to *begin* something, and beginning is a move.
   */
  const start = (text: string): void => {
    setBusy(true);
    const id = newChat();
    void ask(id, text);
    go({ name: 'conversation', id });
    setBusy(false);
  };

  if (about) {
    return (
      <AppWindow route={route} counts={counts}>
        <BackLink to={{ name: 'ask' }} label="all conversations" />
        {/* No summary bar: every row below carries the chip and the alert, so
            naming it once more at the top says it a third time. */}
        <div className="rows">
          {rows.map((c, i) => (
            <Fragment key={c.id}>
              {undone?.index === i && undoBar}
              <Row
                c={c}
                onDelete={() => {
                  setUndone({ c, index: i });
                  removeConversation(c.id);
                }}
              />
            </Fragment>
          ))}
        </div>
      </AppWindow>
    );
  }

  return (
    <AppWindow route={route} counts={counts}>
      <div className="askpagehead">
        <h1>Conversations</h1>
        <Composer
          label="Start a new chat"
          placeholder="Ask anything…"
          busy={busy}
          onSend={start}
        />
        <p className="hint">
          A chat started here is not about anything in particular. One started on an alert already
          knows its subject.
        </p>
      </div>

      {rows.length ? (
        <div className="rows">
          {rows.map((c, i) => (
            <Fragment key={c.id}>
              {undone?.index === i && undoBar}
              <Row
                c={c}
                onDelete={() => {
                  setUndone({ c, index: i });
                  removeConversation(c.id);
                }}
              />
            </Fragment>
          ))}
        </div>
      ) : (
        <p className="quiet">
          Nothing yet. Ask something above, or ask about an alert — those stay with the alert, so
          reopening it in October still shows what you asked in August.
        </p>
      )}
    </AppWindow>
  );
}
