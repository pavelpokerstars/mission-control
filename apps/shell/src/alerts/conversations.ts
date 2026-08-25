/**
 * Conversation history, kept on the thing the conversation was about.
 *
 * `DIRECTION.md` §9: "On the thing the conversation was about — not in a chat
 * archive. Each alert carries its own conversations. Reopen a ticket in October
 * and what you asked about it in August is still there. You retrieve by
 * subject, because that is how people remember." That is what `alertId` below
 * is for, and it is why there is no global History destination — you would open
 * it knowing only a date, which fails §3's test.
 *
 * The gateway is stateless: `/api/chat` takes a message and streams an answer,
 * it does not remember you. So the transcript lives here and a resumed
 * conversation is replayed as part of the next turn, which keeps the server
 * free of user state and makes "continue where I left off" survive a reload.
 *
 * Streaming updates address a conversation by id, never "the current one", so
 * starting a new chat while an answer is still arriving cannot cross the wires:
 * the old answer keeps landing in the old conversation.
 *
 * **Per-browser.** Different laptop, no history. Fine for a demo, a real gap
 * later — §9 says so.
 */

import { create } from 'zustand';
import type { ChatTurn } from '@mc/domain';

export interface Conversation {
  id: string;
  /** Derived from the first user message. Never empty. */
  title: string;
  /**
   * The alert this is about, when it is about one.
   *
   * `DIRECTION.md` §8: "The alert-scoped conversation inherits its subject; the
   * global one starts cold. It is tempting to make one component serve both and
   * then wonder why the global one keeps asking which ticket you mean."
   * Undefined IS the global case, and the difference is carried here rather
   * than in two components.
   */
  alertId?: string;
  /**
   * What the alert claimed, frozen at the time of asking.
   *
   * `DESIGN.md` §5: "Rows are labelled by what they are about. A conversation
   * about an issue is titled with the *issue*, and the question you asked
   * becomes the subtitle. This was wrong for several revisions: a conversation
   * opened from an alert was titled with your first question, so the page you
   * left and the page you arrived at named the same thing differently."
   *
   * Frozen rather than looked up because an answered alert stops being in
   * `/api/findings`, and a row that loses its label the moment the problem is
   * fixed is a history that erases its own successes.
   */
  alertClaim?: string;
  createdAt: number;
  updatedAt: number;
  turns: ChatTurn[];
}

const KEY = 'mc-chat-conversations';
/** Old chats are cheap to keep but not free — this is a panel, not an archive. */
const MAX_CONVERSATIONS = 30;
const TITLE_MAX = 52;

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function blank(): Conversation {
  const now = Date.now();
  return { id: newId(), title: 'New chat', createdAt: now, updatedAt: now, turns: [] };
}

function titleFrom(text: string): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line || 'New chat';
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

interface Persisted {
  conversations: Conversation[];
  activeId: string;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      // Hand-validated rather than trusted: this is user-editable storage, and a
      // malformed entry here would break the panel on every render.
      const conversations = (parsed.conversations ?? []).filter(
        (c): c is Conversation =>
          !!c && typeof c.id === 'string' && Array.isArray(c.turns) && typeof c.title === 'string',
      );
      const [first] = conversations;
      const activeId = conversations.some((c) => c.id === parsed.activeId)
        ? (parsed.activeId as string)
        : (first?.id ?? blank().id);
      return { conversations, activeId };
    }
  } catch {
    // Corrupt storage costs you your history, not your session.
  }
  const fresh = blank();
  return { conversations: [fresh], activeId: fresh.id };
}

/**
 * Coalesced writes. A streaming answer changes state every few milliseconds and
 * re-serialising the whole archive per chunk is pointless; 300ms of lag on a
 * localStorage write is invisible and a reload mid-answer is not a case worth
 * optimising for.
 */
let pending: ReturnType<typeof setTimeout> | undefined;
function persist(state: Persisted): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ conversations: state.conversations, activeId: state.activeId }),
      );
    } catch {
      // Quota or private mode. History stops persisting; the session still works.
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ChatState extends Persisted {
  /** Ids with an answer still streaming. Not persisted — a reload ends the stream. */
  streaming: string[];

  /**
   * Start a fresh conversation and return its id. Discards unused empty ones.
   *
   * `about` is what makes it alert-scoped. Passing nothing is the global case,
   * and that is the whole of the difference §8 warns about keeping straight.
   */
  newChat(about?: { alertId: string; alertClaim: string }): string;
  /** Resume a past conversation. */
  open(id: string): void;
  remove(id: string): void;
  clearAll(): void;

  appendTurn(id: string, turn: ChatTurn): void;
  /** Append streamed text to the last turn of `id`. */
  appendChunk(id: string, chunk: string): void;
  /** Replace the last turn's text outright — used for error messages. */
  replaceLast(id: string, text: string): void;
  setStreaming(id: string, on: boolean): void;
}

/** Move `id` to the front and stamp it — the history list is most-recent first. */
function touch(conversations: Conversation[], id: string, patch: Partial<Conversation>) {
  const target = conversations.find((c) => c.id === id);
  if (!target) return conversations;
  const updated = { ...target, ...patch, updatedAt: Date.now() };
  return [updated, ...conversations.filter((c) => c.id !== id)];
}

export const useConversations = create<ChatState>((set, get) => ({
  ...load(),
  streaming: [],

  newChat(about) {
    const fresh = { ...blank(), ...(about ? { alertId: about.alertId, alertClaim: about.alertClaim } : {}) };
    set((s) => ({
      // An untouched "New chat" is a draft, not history — drop it rather than
      // leaving a trail of empty rows behind every stray click.
      conversations: [fresh, ...s.conversations.filter((c) => c.turns.length > 0)].slice(
        0,
        MAX_CONVERSATIONS,
      ),
      activeId: fresh.id,
    }));
    return fresh.id;
  },

  open(id) {
    if (get().conversations.some((c) => c.id === id)) set({ activeId: id });
  },

  remove(id) {
    set((s) => {
      const conversations = s.conversations.filter((c) => c.id !== id);
      const [first] = conversations;
      // Deleting the last one leaves an empty panel with nowhere to type.
      if (!first) {
        const fresh = blank();
        return { conversations: [fresh], activeId: fresh.id };
      }
      return {
        conversations,
        activeId: s.activeId === id ? first.id : s.activeId,
      };
    });
  },

  clearAll() {
    const fresh = blank();
    set({ conversations: [fresh], activeId: fresh.id });
  },

  appendTurn(id, turn) {
    set((s) => {
      const target = s.conversations.find((c) => c.id === id);
      if (!target) return s;
      const first = turn.role === 'user' && target.turns.length === 0;
      return {
        conversations: touch(s.conversations, id, {
          turns: [...target.turns, turn],
          // The first question names an UNTIED conversation. A tied one is
          // already named by its alert — see `alertClaim`.
          ...(first && !target.alertId ? { title: titleFrom(turn.text) } : {}),
        }),
      };
    });
  },

  appendChunk(id, chunk) {
    set((s) => {
      const target = s.conversations.find((c) => c.id === id);
      if (!target?.turns.length) return s;
      // Map rather than mutate: the last turn is still owned by the previous
      // state, and React 19's StrictMode double-invokes updaters to catch that.
      const turns = target.turns.map((t, i) =>
        i === target.turns.length - 1 ? { ...t, text: t.text + chunk } : t,
      );
      return { conversations: touch(s.conversations, id, { turns }) };
    });
  },

  replaceLast(id, text) {
    set((s) => {
      const target = s.conversations.find((c) => c.id === id);
      if (!target?.turns.length) return s;
      const turns = target.turns.map((t, i) => (i === target.turns.length - 1 ? { ...t, text } : t));
      return { conversations: touch(s.conversations, id, { turns }) };
    });
  },

  setStreaming(id, on) {
    set((s) => ({
      streaming: on ? [...new Set([...s.streaming, id])] : s.streaming.filter((x) => x !== id),
    }));
  },
}));

useConversations.subscribe((s) => persist(s));

/**
 * Rows worth showing in the history list — a never-used draft is not history.
 * Takes the array rather than the store: a selector returning a fresh array on
 * every call breaks `useSyncExternalStore`'s snapshot identity check.
 */
export function historyOf(conversations: Conversation[]): Conversation[] {
  return conversations.filter((c) => c.turns.length > 0);
}

/** "just now", "12m", "3h", "yesterday", "6 Aug". */
export function relativeTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Every conversation about one alert, newest first.
 *
 * `DIRECTION.md` §9 — you retrieve by subject, not by date. This is that
 * retrieval, and it is why an alert page can say "3 earlier conversations"
 * without a server round trip.
 */
export function conversationsFor(conversations: Conversation[], alertId: string): Conversation[] {
  return historyOf(conversations).filter((c) => c.alertId === alertId);
}

/**
 * The ask header's label, which states what clicking will do.
 *
 * `DESIGN.md` §7 spells out all three, and the point is that the link holds no
 * surprise: with nothing there it starts one, with one it opens it, with
 * several it shows the list.
 */
export function openFullLabel(n: number): string {
  if (n === 0) return 'no conversations yet · start one →';
  if (n === 1) return '1 earlier conversation · open it →';
  return `${n} earlier conversations · see them →`;
}
