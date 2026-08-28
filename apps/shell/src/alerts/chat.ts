/**
 * Asking, and the stream that answers.
 *
 * Lifted out of the retired `ChatPanel` rather than rewritten — every comment
 * below marks something that was got wrong once already, and the SSE loop in
 * particular is not worth discovering twice.
 *
 * `DIRECTION.md` §9's four rules are the agent's, not this file's: it already
 * knows what you are looking at, it cites, it draws a shape when the answer is
 * one, and every answer can end in an action. What this does is carry the
 * context that makes the first rule possible, and get the words back intact.
 */

import type { ChatTurn, ContextEnvelope } from '@mc/domain';
import { API, GATEWAY_UNREACHABLE } from './api';
import { useConversations } from './conversations';



/**
 * How much of the transcript to replay.
 *
 * The gateway keeps no per-user state, so continuity is the browser's job. Six
 * turns is enough for "and what about the other one?" to resolve, and short
 * enough that a long conversation does not grow the prompt without bound.
 */
const HISTORY_TURNS = 6;

export interface Subject {
  /** The alert this conversation is about. Absent is the global case. */
  id: string;
  kind: string;
  claim: string;
  /**
   * The detector's sentence about why it matters — and, for a `cycle`, the
   * ordered walk itself. `DIRECTION.md` §9: "when the answer is a shape, it
   * draws the shape", which the agent cannot do for a loop whose members it was
   * never told. It is already in hand: the caller was handed the whole
   * `Finding` by the gateway.
   */
  impact?: string;
  /** When the alert is about a work item, so the agent can join on it. */
  key?: string;
}

/**
 * Send a question and stream the answer into a conversation.
 *
 * Returns when the answer is complete. Every update addresses `conversationId`
 * rather than "the current conversation", so starting a new chat mid-answer
 * leaves the answer in the conversation that asked for it.
 */
export async function ask(
  conversationId: string,
  message: string,
  subject?: Subject,
): Promise<void> {
  const { appendTurn, appendChunk, replaceLast, setStreaming, conversations } =
    useConversations.getState();

  const id = conversationId;
  const history: ChatTurn[] = (conversations.find((c) => c.id === id)?.turns ?? []).slice(
    -HISTORY_TURNS,
  );

  setStreaming(id, true);
  appendTurn(id, { role: 'user', text: message });
  // The empty agent turn is the bubble the chunks land in. Appending it up
  // front is what makes the answer appear to be typed rather than to arrive.
  appendTurn(id, { role: 'agent', text: '' });

  /**
   * The envelope, and it is deliberately thin.
   *
   * The envelope's four pane-era fields went with the panes; every field left
   * is optional, and every read in `renderContext` guards.
   * What the agent needs is the subject, and `finding` is how it travels.
   */
  const context: ContextEnvelope = subject
    ? {
        finding: {
          id: subject.id,
          kind: subject.kind,
          claim: subject.claim,
          ...(subject.impact ? { impact: subject.impact } : {}),
        },
        ...(subject.key ? { focusedKey: subject.key as ContextEnvelope['focusedKey'] } : {}),
      }
    : {};

  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, context, thread: { id, history } }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line, and a chunk can split one in
      // half — so the tail is kept and prepended to the next read.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        if (!frame.startsWith('data: ')) continue;
        const data = JSON.parse(frame.slice(6)) as {
          chunk?: string;
          done?: boolean;
          error?: string;
        };
        if (data.chunk) appendChunk(id, data.chunk);
        // A model call can fail mid-answer — a bad key, a rate limit. The
        // gateway sends the reason; dropping it leaves an empty bubble and a
        // user with nothing to act on. Appended rather than replaced, because
        // half an answer plus why it stopped beats neither.
        if (data.error) appendChunk(id, `\n\n⚠ The agent stopped: ${data.error}`);
      }
    }
  } catch (err) {
    replaceLast(id, `${GATEWAY_UNREACHABLE}\n\n${String(err)}`);
  } finally {
    setStreaming(id, false);
  }
}

/**
 * The starter questions for an empty chat, computed rather than written down.
 *
 * `suggest.ts` builds them from the same joins the rest of the app uses — the
 * cycle *this* board draws, the ticket blocked with nothing in the vault saying
 * why. Four hardcoded strings cannot: they name tickets that may be done, and
 * they say the same thing on every alert.
 *
 * It falls back on its own if the gateway cannot answer, so this never has to.
 */
export interface Starter {
  text: string;
  /**
   * The join that makes it worth asking, shown under the button.
   *
   * Without it the claim above — that these are computed from what you are
   * looking at — is asserted rather than demonstrated, which is the one thing
   * this product is not allowed to do.
   */
  why?: string;
}

export async function suggestions(subject?: Subject): Promise<Starter[]> {
  try {
    const res = await fetch(`${API}/api/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        subject ? { focusedKey: subject.key, finding: { id: subject.id, kind: subject.kind } } : {},
      ),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { suggestions?: { text?: string; why?: string }[] };
    // The field is `text`, not `question` — reading the wrong one returned four
    // undefineds that filtered to an empty list, so the panel simply had no
    // starters and nothing anywhere said why.
    return (body.suggestions ?? [])
      .filter((s): s is { text: string; why?: string } => typeof s?.text === 'string')
      .map((s) => ({ text: s.text, ...(s.why ? { why: s.why } : {}) }))
      .slice(0, 3);
  } catch {
    return [];
  }
}
