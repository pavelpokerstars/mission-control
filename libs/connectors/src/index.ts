/**
 * @mc/connectors — one interface per surface, and the projection of the
 * connection graph into all five.
 *
 * THIS IS THE SEAM between everything that reads a source and everything that
 * reasons about one. `createGraphConnectors` (`graph/index.ts`) projects the
 * `graph.json` a collector wrote; `real/miro.ts` is the one live vendor client,
 * because Miro's board is not in the graph. There is no `mock/` — it was 1,170
 * lines of hand-written `WorkItem` literals in a shape no collector produces,
 * and everything downstream was tuned against it. `MC_GRAPH_DIR` is the switch.
 *
 * IMPORTED BY THE GATEWAY ONLY. It used to be a dependency of the shell too;
 * nothing in `apps/shell/src` imports it, and the stale package edge made nx
 * rebuild the shell on every change here.
 *
 * The per-surface iframe-vs-native decision (`PANE_STRATEGY`) and `liveEmbedUrl`
 * are gone with the screens that read them. Both survived the rebuild by
 * looking like they belonged to a library the app still imports. What the
 * connector drops on purpose — and why Sources counts it — is in CLAUDE.md
 * under "The Miro connector".
 */

import type {
  AppCardMirror,
  CanvasConnector,
  CanvasSticky,
  Transcript,
  WorkItem,
  WorkItemKey,
} from '@mc/domain';


// ---------------------------------------------------------------------------
// Connector interfaces
// ---------------------------------------------------------------------------

export interface JiraConnector {
  listItems(opts?: { sprint?: string }): Promise<WorkItem[]>;
  getItem(key: WorkItemKey): Promise<WorkItem | undefined>;
  createItem(input: Partial<WorkItem> & { title: string }): Promise<WorkItem>;
  updateItem(key: WorkItemKey, patch: Partial<WorkItem>): Promise<WorkItem>;
  linkItems(from: WorkItemKey, to: WorkItemKey, type: string): Promise<void>;

  /**
   * Say something on the ticket, without changing it.
   *
   * This is the one outbound write that needs no proposal, and the reason is
   * `FIELD_OWNER`: a comment is not a field. Nobody owns it as *state*, so
   * writing one cannot start a sync war and cannot make the vault a second
   * source of truth. It is how memory reaches the person who is about to make
   * a decision, in the tool where they are making it — rather than waiting for
   * them to come and ask us.
   */
  comment(key: WorkItemKey, body: string): Promise<JiraComment>;
  listComments(key: WorkItemKey): Promise<JiraComment[]>;
}

export interface JiraComment {
  id: string;
  key: WorkItemKey;
  author: string;
  body: string;
  createdAt: string;
}

export interface MiroConnector {
    listAppCards(boardId: string): Promise<AppCardMirror[]>;
  upsertAppCard(boardId: string, item: WorkItem): Promise<AppCardMirror>;
  listConnectors(boardId: string): Promise<CanvasConnector[]>;

  /**
   * Every sticky on the board, grouped by the frame it sits in.
   *
   * Separate from `listAppCards` because they answer different questions.
   * App cards are Jira, drawn; stickies are the part of a workshop that exists
   * nowhere else yet. A retro board is almost entirely the second kind, and
   * reading only the first is how a tool that "integrates with Miro" manages to
   * miss the entire meeting.
   *
   * Read-only by design — there is no `createSticky` here and there should not
   * be. Anything we want to put back on a board goes through `exportSnapshot`,
   * into a frame we own, with the timestamp in its title.
   *
   * In live mode: GET /v2/boards/{id}/items?type=sticky_note, then a second
   * pass over type=frame to resolve titles. Miro does not return the parent
   * frame's *title* on the item, only `parent.id`.
   */
  listStickies(boardId: string): Promise<CanvasSticky[]>;

  /**
   * Draw a one-shot snapshot into a frame we own, for the retro workshop where
   * people want to draw on it.
   *
   * The three rules that keep this from becoming the sync war it looks like:
   *
   *   1. ONE SHOT. It is never re-rendered, never reconciled, and goes stale on
   *      purpose. The frame title carries the timestamp so nobody mistakes it
   *      for live.
   *   2. ITS OWN FRAME. We write `position` only inside a frame we created, so
   *      we are never moving a card a human is arranging. Miro still owns
   *      position everywhere that matters.
   *   3. HUMAN-INVOKED. The button *is* the gate — this is not something the
   *      agent fires on its own, which is why there is no proposal wrapping it.
   */
  exportSnapshot(boardId: string, input: SnapshotInput): Promise<SnapshotResult>;
}

export interface SnapshotInput {
  title: string;
  nodes: { id: string; label: string; sublabel?: string; x: number; y: number; accent?: string }[];
  edges: { from: string; to: string; emphasis?: 'cycle' | 'critical' }[];
}

export interface SnapshotResult {
  frameId: string;
  title: string;
  itemCount: number;
  url?: string;
}

export interface ConfluenceConnector {
  listPages(spaceKey: string): Promise<ConfluencePage[]>;
  getPage(id: string): Promise<ConfluencePage | undefined>;
  publish(input: { title: string; html: string; relatedKeys: WorkItemKey[] }): Promise<ConfluencePage>;
}

export interface ConfluencePage {
  id: string;
  title: string;
  html: string;
  updatedAt: string;
  relatedKeys: WorkItemKey[];
  url?: string;
}

export interface ZoomConnector {
  listTranscripts(): Promise<Pick<Transcript, 'id' | 'meetingTopic' | 'startedAt' | 'durationSec'>[]>;
  getTranscript(id: string): Promise<Transcript | undefined>;
}

export interface SlackConnector {
  listChannels(): Promise<{ id: string; name: string }[]>;
  listMessages(channelId: string): Promise<SlackMessage[]>;
  post(channelId: string, text: string): Promise<SlackMessage>;
}

export interface SlackMessage {
  ts: string;
  channelId: string;
  author: string;
  text: string;
  mentions: WorkItemKey[];
}

export interface Connectors {
  jira: JiraConnector;
  miro: MiroConnector;
  confluence: ConfluenceConnector;
  zoom: ZoomConnector;
  slack: SlackConnector;
}

/**
 * The graph-backed connectors are the only ones now — `./mock/` is gone.
 *
 * It was 1,170 lines: `createMockConnectors`, the `ITEMS` / `TRANSCRIPTS` /
 * `STICKIES` tables, and the `HISTORY` generator behind twelve invented
 * sprints. `graph.json` is what a real collector writes, so a reader on the
 * fixture is reading the shape it will read live — which is the only way
 * fixtures are a rehearsal rather than a different game — and once
 * `createGraphConnectors` was the default, nothing called any of it.
 *
 * `HISTORY` outlived the rest by one caller: a fallback in `seed.ts` for a
 * graph that ships no history. That fallback was reachable **only** on the live
 * path, where it seeded four hundred transitions for a programme that does not
 * exist. Both went together.
 */
export * from './graph/index.js';
export { createMiroConnector, type MiroConfig } from './real/miro.js';
