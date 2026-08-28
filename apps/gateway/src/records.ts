/**
 * One record, fetched because somebody followed a citation.
 *
 * WHY THIS EXISTS AS ITS OWN ROUTE. `DIRECTION.md` §3 deletes the five vendor
 * panes as *destinations* and keeps the records: you arrive by clicking a piece
 * of evidence, "and the record opens on the exact line with context either
 * side". So there is no browse mode and no search — every read starts from a
 * `RecordRef` on a citation, which is the only thing that can say WHICH line.
 *
 * WHY IT READS THE PROJECTIONS AND NOT `records/` DIRECTLY. The connectors
 * already turn a stored record into the shape the app speaks — a transcript with
 * `start`/`end` segments, a Slack message with a `ts` and its mentions — and a
 * second reader of the same files would be a second chance to disagree about
 * what a record is. Going live changes which collector wrote the file and
 * nothing here.
 */

import {
  projectMessages,
  projectStickies,
  type Connectors,
  type ConfluencePage,
  type GraphSource,
  type SlackMessage,
} from '@mc/connectors';
import { UNKNOWN_SPEAKER, type Owner, type Transcript, slackTsToIso } from '@mc/domain';
import type { VaultStore } from '@mc/vault';

export interface RecordResult {
  surface: Owner;
  id: string;
  title: string;
  /**
   * The lines, in order, each with enough to render and to mark the cited one.
   *
   * A single shape for five very different records, because the page that shows
   * them is one page: a transcript's segments, a channel's messages and a page's
   * paragraphs are all "things in order, one of which you came here to read".
   */
  lines: { id: string; at?: number; who?: string; text: string; when?: string }[];
  /** The line the citation pointed at, so the view can mark and scroll to it. */
  cited?: string;
  /** Where this sits: a channel, a board, a space. */
  container?: string;
  url?: string;
  /** When the cited thing was said, ISO. The reader's locale formats it. */
  when?: string;
}

/**
 * The vendor's own URL for a record, resolved from the graph node.
 *
 * ONE RESOLUTION POINT, deliberately. `url` is on `StoredNodeBase`, so every
 * collector already writes it — 376 of 398 nodes in `fixtures-programme` carry
 * one — and it was reaching the app for exactly one surface, because
 * `pageRecord` happened to copy it. Resolving here means every record view gets
 * it from the same place, and a surface that gains a url later needs no code.
 *
 * IT IS NEVER CONSTRUCTED. A url a collector did not write is a guess about
 * somebody else's URL scheme, and this page's whole argument is that what it
 * shows can be checked. Absent is a real answer and the view renders nothing.
 */
function vendorUrl(surface: string, id: string, source: GraphSource): string | undefined {
  const want = `${NODE_KIND[surface] ?? surface}:`;
  const nodes = source.graph.nodes.filter((n) => n.id.startsWith(want));

  /**
   * Slack is the one whose citation id is NOT its node id.
   *
   * A `RecordRef` for a message carries the Slack `ts` — unix seconds, which is
   * what every other consumer joins on — while the node is
   * `message:slack/<channel>/<msg id>`. The bridge is the node's own `at`, which
   * is what `projectMessages` derives the `ts` from in the first place.
   *
   * Compared as NUMBERS and without rounding. `Date.parse` normalises `…:00Z`
   * and `…:00.000Z` to the same instant, so the two fixtures' different spellings
   * both match; and Slack's sub-second suffix is the only thing separating two
   * messages posted in the same second, so flooring it would resolve a permalink
   * to the wrong message on the page whose argument is that its citations check out.
   */
  if (surface === 'slack') {
    const want_ = Number(id);
    return nodes.find((n) => 'at' in n && n.at && Date.parse(n.at) / 1000 === want_)?.url;
  }

  return nodes.find(
    (n) => n.id === `${want}${id}` || n.id.endsWith(`/${id}`) || n.id.endsWith(`:${id}`),
  )?.url;
}

/** Our surface word against the graph's node kind. They differ for three of five. */
const NODE_KIND: Record<string, string> = {
  slack: 'message',
  zoom: 'meeting',
  confluence: 'page',
  jira: 'issue',
  miro: 'sticky',
};

async function readRecordRaw(
  ref: { surface: string; id: string; parentId?: string; at?: number },
  c: Connectors,
  vault: VaultStore,
  source: GraphSource,
): Promise<RecordResult | undefined> {
  switch (ref.surface) {
    case 'zoom': {
      const t = await c.zoom.getTranscript(ref.id);
      if (!t) return undefined;
      return transcriptRecord(t, ref.at);
    }

    case 'slack': {
      // The whole channel, not the one message. A line out of its thread is a
      // quotation, not a record, and the argument for following a citation at
      // all is seeing what was said either side of it.
      const channels = await c.slack.listChannels();
      const channel =
        channels.find((ch) => ch.id === ref.parentId) ?? channelHolding(ref.id, source);
      if (!channel) return undefined;
      const messages = await c.slack.listMessages(channel.id);
      return slackRecord(channel.name, messages, ref.id);
    }

    case 'confluence': {
      const page = await c.confluence.getPage(ref.id);
      return page ? pageRecord(page) : undefined;
    }

    case 'miro': {
      /**
       * From the GRAPH, not from `c.miro`.
       *
       * With a real `MIRO_ACCESS_TOKEN` the connector reads the live canvas, and
       * a citation points at the sticky the graph holds — a different board, or
       * the same board since edited. The same reason dependency truth comes from
       * `projectArrows(graph)` rather than `listConnectors`: the board is
       * evidence, and the graph is what we actually reasoned over.
       */
      const stickies = projectStickies(source.graph, process.env.MIRO_BOARD_ID ?? 'demo-board');
      const sticky = stickies.find((s) => s.id.endsWith(ref.id) || s.id === ref.id);
      if (!sticky) return undefined;
      // The frame, not the sticky. A sticky alone says "settled topic — due 12
      // Aug"; the frame it sits in is what says the team called that an action.
      const siblings = stickies.filter((s) => s.frameId === sticky.frameId);
      return {
        surface: 'miro',
        id: sticky.id,
        title: sticky.frameTitle ?? 'Board',
        container: sticky.frameTitle,
        lines: siblings.map((s) => ({ id: s.id, text: s.text })),
        cited: sticky.id,
      };
    }

    case 'vault': {
      const note = vault.get(ref.id);
      if (!note) return undefined;
      return {
        surface: 'vault',
        id: note.id,
        title: note.title,
        container: note.kind,
        lines: note.body.split('\n\n').map((p, i) => ({ id: `p${i}`, text: p.replace(/\n/g, ' ') })),
      };
    }

    case 'jira': {
      const item = await c.jira.getItem(ref.id.replace(/^issue:/, ''));
      if (!item) return undefined;
      const comments = await c.jira.listComments(item.key);
      /**
       * THE STATUS LINE IS THE CITED ONE, and this branch set no `cited` at all.
       *
       * `RecordView` gates the whole context bar on `cited`, so a jira record —
       * twelve of the twenty-two citations in the app once the aging rows became
       * links — opened with no statement of why the reader was there, an empty
       * clock column and one line. That is the page ask #3 is about, reached
       * from a citation, saying nothing.
       *
       * And the status IS what an `aging` or `disagreement` alert is about: the
       * column it has not left. `updatedAt` dates it, which is the same bound
       * `statusAgeOf` reads and the same one the alert's own "at least N days"
       * is computed from.
       */
      return {
        surface: 'jira',
        id: item.key,
        title: `${item.key} — ${item.title}`,
        container: item.sprint,
        lines: [
          {
            id: 'status',
            text: `${item.status.replace('_', ' ')}${item.assignee ? ` · ${item.assignee}` : ''}`,
            ...(item.updatedAt ? { when: item.updatedAt } : {}),
          },
          ...comments.map((cm) => ({ id: cm.id, who: cm.author, text: cm.body })),
        ],
        cited: 'status',
        ...(item.updatedAt ? { when: item.updatedAt } : {}),
      };
    }

    default:
      return undefined;
  }
}

function transcriptRecord(t: Transcript, at?: number): RecordResult {
  return {
    surface: 'zoom',
    // The day it was recorded. The context bar says the day; a timed
    // transcript's lines say their own offset, which is the clock the citation
    // quoted.
    ...(t.startedAt ? { when: t.startedAt } : {}),
    id: t.id,
    title: t.meetingTopic,
    container: t.participants.join(', '),
    /**
     * `at` only when the offsets are real.
     *
     * A Zoom Docs note has no timing, so `annotateTranscript` derived its
     * segments from the body and `start` is a paragraph index. Rendering that
     * as a timestamp would put "0:03" beside a sentence nobody timed, on the
     * page whose entire argument is that its citations are checkable. The line
     * is still addressable — the id is the index — so a citation still opens
     * the record on the right paragraph. It just does not claim a moment.
     *
     * Same for `who`: an unattributed segment carries no speaker rather than
     * naming whoever booked the call.
     */
    lines: t.segments.map((s) => ({
      id: String(s.start),
      ...(t.timed === false ? {} : { at: s.start }),
      ...(s.speaker && s.speaker !== UNKNOWN_SPEAKER ? { who: s.speaker } : {}),
      text: s.text,
    })),
    // Nearest segment rather than exact match: an offset recorded against a
    // quote is a moment, and insisting on the precise start time means a
    // citation silently lands nowhere when the transcript is re-cut.
    //
    // GATED ON `at` ALONE, deliberately — NOT on `timed`. On a Zoom Docs note
    // both `at` and `s.start` are paragraph indices, so the nearest-match
    // compares like with like and the marked line is exactly right. Gating on
    // `timed` too meant every citation into a note opened the record at the top
    // with nothing marked, which is the one thing a citation must never do —
    // and it contradicted the comment above it and GRAPH-SCHEMA §10, both of
    // which promise a note opens at its line index. The line is a POSITION;
    // only `at` on a line would claim a MOMENT, and that stays omitted above.
    ...(at !== undefined && t.segments.length
      ? {
          cited: String(
            t.segments.reduce((best, s) =>
              Math.abs(s.start - at) < Math.abs(best.start - at) ? s : best,
            ).start,
          ),
        }
      : {}),
  };
}

/**
 * The public entry: read the record, then hang the vendor's own URL on it.
 *
 * Wrapped rather than repeated in six branches — the resolution is identical for
 * every surface and a branch that forgets it is a link that silently is not
 * there.
 */
export async function readRecord(
  ref: { surface: string; id: string; parentId?: string; at?: number },
  c: Connectors,
  vault: VaultStore,
  source: GraphSource,
): Promise<RecordResult | undefined> {
  const rec = await readRecordRaw(ref, c, vault, source);
  if (!rec) return undefined;
  return { ...rec, ...(rec.url ? {} : { url: vendorUrl(ref.surface, ref.id, source) }) };
}

/**
 * A Slack `ts` is unix SECONDS, and the record page had been throwing the clock
 * away.
 *
 * `lines[].at` is seconds-into-a-recording — a transcript offset — so a wall
 * clock cannot ride in it. The view rendered `<time>{offset(l.at)}</time>` with
 * `l.at` undefined, which is an empty `<time>` element: a column of nothing,
 * on the one screen whose job is to show you what was said and WHEN. The
 * preview draws a time on every line (`#scr-record`), so this is building what
 * was already designed rather than designing anything.
 *
 * `when` is an ISO instant and the view formats it, because only the browser
 * knows the reader's locale and zone.
 */
function slackRecord(name: string, messages: SlackMessage[], ts: string): RecordResult {
  const cited = messages.find((m) => m.ts === ts);
  return {
    surface: 'slack',
    id: ts,
    title: `#${name}`,
    container: `#${name}`,
    lines: messages.map((m) => ({
      id: m.ts,
      who: m.author,
      text: m.text,
      when: slackTsToIso(m.ts),
    })),
    ...(cited ? { cited: cited.ts, when: slackTsToIso(cited.ts) } : {}),
  };
}

function pageRecord(p: ConfluencePage): RecordResult {
  return {
    surface: 'confluence',
    id: p.id,
    title: p.title,
    // Not `format.ts`'s `stripHtml`: a citation's unit is the paragraph, so the
    // split has to happen before the tags go.
    lines: p.html
      .split(/<\/p>/)
      .map((chunk, i) => ({ id: `p${i}`, text: chunk.replace(/<[^>]+>/g, '').trim() }))
      .filter((l) => l.text),
    ...(p.url ? { url: p.url } : {}),
    ...(p.updatedAt ? { when: p.updatedAt } : {}),
  };
}

/**
 * A citation with no channel on it — ask the graph, which already knows.
 *
 * This used to walk the channel list calling `listMessages` on each until one
 * held the timestamp: O(channels × messages) and a round trip per channel, on a
 * path nothing takes today because every citation the app produces carries
 * `parentId`. One pass over the projection instead, from the same graph the
 * Miro branch above reads for the same reason.
 */
function channelHolding(ts: string, source: GraphSource): { id: string; name: string } | undefined {
  const m = projectMessages(source).find((x) => x.ts === ts);
  return m ? { id: m.channelId, name: m.channelName } : undefined;
}
