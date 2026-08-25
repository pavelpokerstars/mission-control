/**
 * The real Miro connector — REST v2, bearer token.
 *
 * Miro is the one surface where "real" is reachable without an OAuth dance — a
 * board token is a header — and the one that is NOT projected from
 * `MC_GRAPH_DIR`. That makes this adapter the only place a live vendor read
 * enters the system, and the hazard it carries is specific: `listConnectors`
 * against a real board returns today's canvas, which is a different account of
 * what depends on what from the reconciled graph. Everything that reasons about
 * dependencies takes the graph instead; this serves Sources, the sticky half of
 * a ceremony, and the records a citation opens.
 *
 * WHAT IT DELIBERATELY CANNOT DO
 *
 * There is no `createSticky`, here or on the interface. Miro owns `position`
 * and `frame`, and a workshop board is somebody's thinking in progress — the
 * one thing in this repo that writes stickies is `scripts/seed-miro.mjs`, which
 * a human types and nothing imports. The only write below is `exportSnapshot`,
 * under the three rules on `MiroConnector.exportSnapshot`: one shot, its own
 * frame, human-invoked.
 *
 * TWO THINGS LEARNED THE HARD WAY, both already paid for in seed-miro.mjs:
 *
 *   1. `POST /frames` returns a transient 500 roughly one time in four and
 *      succeeds on retry. So does 429 under any burst. `call()` retries both.
 *   2. A frame's child is positioned by its CENTRE relative to the frame's
 *      top-left corner, and sending `position.relativeTo` explicitly is a 400 —
 *      the API sets it itself.
 */

import { extractKeys, type AppCardMirror, type CanvasConnector, type CanvasSticky, type WorkItem, type WorkItemKey } from '@mc/domain';
import type { MiroConnector, SnapshotResult } from '../index.js';

const API = 'https://api.miro.com/v2';

/**
 * Frame geometry. `scripts/seed-miro.mjs` carries the same constants and is
 * where the reasoning behind them lives — they have to be read against the
 * fixture's sticky row pitch or consecutive frames overlap on the board.
 */
const SNAPSHOT_NODE_W = 220;
const SNAPSHOT_NODE_H = 100;
const FRAME_PAD = 40;

interface MiroItem {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
  position?: { x?: number; y?: number };
  parent?: { id?: string };
}

/**
 * Miro's app-card fields, which is where a mirrored ticket's status lives. The
 * API calls them `customFields`; ours are `{label, value}` either way.
 */
interface MiroCustomField {
  value?: string;
  tooltip?: string;
}

export interface MiroConfig {
  token: string;
}

export function createMiroConnector(cfg: MiroConfig): MiroConnector {
  const headers = {
    authorization: `Bearer ${cfg.token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };

  /**
   * One API call, with the two failures this API actually produces: 429 when we
   * go too fast, and a transient 5xx that succeeds on a retry. Backoff is
   * quadratic and capped at four attempts — beyond that it is not transient.
   */
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text.slice(0, 200) };
    }

    if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
      await new Promise((r) => setTimeout(r, 400 * attempt ** 2));
      return call<T>(method, path, body, attempt + 1);
    }
    if (!res.ok) {
      throw new Error(`miro ${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json as T;
  }

  /** Every item on a board, following the cursor. */
  async function boardItems(boardId: string, type?: string): Promise<MiroItem[]> {
    const out: MiroItem[] = [];
    let cursor: string | undefined;
    do {
      const q = new URLSearchParams({ limit: '50' });
      if (type) q.set('type', type);
      if (cursor) q.set('cursor', cursor);
      const page = await call<{ data?: MiroItem[]; cursor?: string }>(
        'GET',
        `/boards/${encodeURIComponent(boardId)}/items?${q}`,
      );
      out.push(...(page.data ?? []));
      cursor = page.cursor;
    } while (cursor);
    return out;
  }

  /**
   * Frame id → title, which stickies need and the item payload does not carry.
   * Miro returns only `parent.id` on a child, never the parent's title, so this
   * second pass is not an optimisation to remove.
   */
  async function frameTitles(boardId: string): Promise<Map<string, string>> {
    const frames = await boardItems(boardId, 'frame');
    return new Map(
      frames.map((f) => [f.id, String((f.data as { title?: string } | undefined)?.title ?? 'Unframed')]),
    );
  }

  /**
   * The Jira key a board item stands for.
   *
   * An app card carries it in the title; a sticky only ever has whatever
   * somebody typed. `extractKeys` is the same join used on transcripts and Slack
   * — there is one ID space here and this is how unstructured text enters it.
   */
  function keyOf(item: MiroItem): WorkItemKey | undefined {
    const d = item.data as { title?: string; content?: string } | undefined;
    return extractKeys(`${d?.title ?? ''} ${d?.content ?? ''}`)[0];
  }

  /** Miro sends sticky content as HTML even when the user typed plain text. */
  function plain(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return {
    
    async listAppCards(boardId) {
      const items = await boardItems(boardId, 'app_card');
      const out: AppCardMirror[] = [];
      for (const item of items) {
        const key = keyOf(item);
        // An app card with no Jira key in it is somebody else's integration.
        // Claiming it would put a foreign card in our graph under a made-up id.
        if (!key) continue;
        const fields = (item.data as { fields?: MiroCustomField[] } | undefined)?.fields ?? [];
        out.push({
          miroItemId: item.id,
          boardId,
          key,
          x: item.position?.x ?? 0,
          y: item.position?.y ?? 0,
          ...(item.parent?.id ? { frameId: item.parent.id } : {}),
          fields: fields.map((f, i) => ({
            // Miro's custom fields carry no label of their own, so the tooltip
            // is where a name can live. Falls back to a positional one.
            label: f.tooltip ?? `field ${i + 1}`,
            value: String(f.value ?? ''),
          })),
        });
      }
      return out;
    },

    async upsertAppCard(boardId, item) {
      const fields = [
        { value: item.status, tooltip: 'Status' },
        { value: item.assignee ?? 'unassigned', tooltip: 'Assignee' },
      ];
      const data = { title: `${item.key} ${item.title}`, fields };

      const existing = (await boardItems(boardId, 'app_card')).find((c) => keyOf(c) === item.key);
      const saved = existing
        ? await call<MiroItem>('PATCH', `/boards/${encodeURIComponent(boardId)}/app_cards/${existing.id}`, { data })
        : await call<MiroItem>('POST', `/boards/${encodeURIComponent(boardId)}/app_cards`, { data });

      return {
        miroItemId: saved.id,
        boardId,
        key: item.key,
        x: saved.position?.x ?? 0,
        y: saved.position?.y ?? 0,
        ...(saved.parent?.id ? { frameId: saved.parent.id } : {}),
        fields: fields.map((f) => ({ label: f.tooltip, value: f.value })),
      };
    },

    async listConnectors(boardId) {
      const out: CanvasConnector[] = [];
      let cursor: string | undefined;
      const byId = new Map<string, WorkItemKey | undefined>();

      // Endpoints are separate: connectors are not returned by /items.
      do {
        const q = new URLSearchParams({ limit: '50' });
        if (cursor) q.set('cursor', cursor);
        const page = await call<{
          data?: { id: string; startItem?: { id?: string }; endItem?: { id?: string }; shape?: string; captions?: { content?: string }[] }[];
          cursor?: string;
        }>('GET', `/boards/${encodeURIComponent(boardId)}/connectors?${q}`);

        for (const c of page.data ?? []) {
          const from = c.startItem?.id;
          const to = c.endItem?.id;
          if (!from || !to) continue;
          // Resolve endpoint ids to keys lazily, and remember the misses too so
          // a board of forty arrows between the same cards is not forty fetches.
          for (const id of [from, to]) {
            if (byId.has(id)) continue;
            try {
              const item = await call<MiroItem>('GET', `/boards/${encodeURIComponent(boardId)}/items/${id}`);
              byId.set(id, keyOf(item));
            } catch {
              byId.set(id, undefined);
            }
          }
          const fromKey = byId.get(from);
          const toKey = byId.get(to);
          // An arrow between two things that are not tickets is a drawing, not
          // a dependency. Silently dropping it is right: the alternative is
          // inventing edges in the relation graph. Sources counts what is
          // dropped, because a silent drop is what a coverage page is for.
          if (!fromKey || !toKey) continue;

          const caption = (c.captions ?? []).map((x) => plain(String(x.content ?? ''))).join(' ').toLowerCase();
          const semantic: CanvasConnector['semantic'] = caption.includes('relates')
            ? 'relates'
            : caption.includes('parent')
              ? 'parent'
              : caption.includes('then') || caption.includes('sequence')
                ? 'sequence'
                : 'blocks';

          out.push({ id: c.id, fromKey, toKey, semantic });
        }
        cursor = page.cursor;
      } while (cursor);

      return out;
    },

    async listStickies(boardId) {
      const [items, titles] = await Promise.all([
        boardItems(boardId, 'sticky_note'),
        frameTitles(boardId),
      ]);
      const out: CanvasSticky[] = [];
      for (const item of items) {
        const text = plain(String((item.data as { content?: string } | undefined)?.content ?? ''));
        if (!text) continue;
        const frameId = item.parent?.id;
        out.push({
          id: item.id,
          boardId,
          text,
          ...(frameId ? { frameId, frameTitle: titles.get(frameId) ?? 'Unframed' } : {}),
          x: item.position?.x ?? 0,
          y: item.position?.y ?? 0,
          mentions: extractKeys(text),
        });
      }
      return out;
    },

    async exportSnapshot(boardId, input): Promise<SnapshotResult> {
      // Lay the snapshot out to the right of everything already on the board,
      // so we never draw on top of somebody's work. Rule 2 of the three.
      const existing = await boardItems(boardId);
      const rightEdge = existing.reduce((max, i) => Math.max(max, i.position?.x ?? 0), 0);

      const xs = input.nodes.map((n) => n.x);
      const ys = input.nodes.map((n) => n.y);
      const minX = Math.min(...xs, 0);
      const minY = Math.min(...ys, 0);
      const width = Math.max(...xs, 0) - minX + SNAPSHOT_NODE_W + FRAME_PAD * 2;
      const height = Math.max(...ys, 0) - minY + SNAPSHOT_NODE_H + FRAME_PAD * 2;

      const originX = rightEdge + FRAME_PAD * 2 + width / 2;

      const frame = await call<MiroItem>('POST', `/boards/${encodeURIComponent(boardId)}/frames`, {
        data: { title: input.title, format: 'custom', type: 'freeform' },
        position: { x: originX, y: 0 },
        geometry: { width, height },
      });

      // Children are positioned by their CENTRE relative to the frame's
      // top-left corner, and `position.relativeTo` must NOT be sent — the API
      // sets it and 400s if we say it out loud.
      const created = new Map<string, string>();
      for (const n of input.nodes) {
        const card = await call<MiroItem>('POST', `/boards/${encodeURIComponent(boardId)}/shapes`, {
          data: { shape: 'round_rectangle', content: `<b>${n.label}</b>${n.sublabel ? `<br>${n.sublabel}` : ''}` },
          style: n.accent ? { fillColor: n.accent } : undefined,
          position: {
            x: n.x - minX + FRAME_PAD + SNAPSHOT_NODE_W / 2,
            y: n.y - minY + FRAME_PAD + SNAPSHOT_NODE_H / 2,
          },
          geometry: { width: SNAPSHOT_NODE_W, height: SNAPSHOT_NODE_H },
          parent: { id: frame.id },
        });
        created.set(n.id, card.id);
      }

      let edges = 0;
      for (const e of input.edges) {
        const from = created.get(e.from);
        const to = created.get(e.to);
        if (!from || !to) continue;
        await call('POST', `/boards/${encodeURIComponent(boardId)}/connectors`, {
          startItem: { id: from },
          endItem: { id: to },
          style: e.emphasis === 'cycle' ? { strokeColor: '#ff6b6b', strokeWidth: '3' } : undefined,
        });
        edges++;
      }

      return {
        frameId: frame.id,
        title: input.title,
        itemCount: created.size + edges,
        url: `https://miro.com/app/board/${boardId}/?moveToWidget=${frame.id}`,
      };
    },
  };
}

export type { WorkItem };
