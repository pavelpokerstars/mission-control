/**
 * The dossier — everything the system knows about one work item.
 *
 * This is the product, reduced to one function. A vendor tab is a window onto
 * somebody else's system; none of them can answer the only question anyone
 * actually asks, which is "what's the latest on PAY-9031". That answer is
 * a Slack thread, a stand-up sentence, a Confluence page nobody read and a Jira
 * status, and the useful part is usually that two of them disagree.
 *
 * It lives here rather than in `@mc/domain` because assembling it needs all
 * five connectors, the vault and the event log. The *shapes* and the
 * contradiction rule live in domain, so `/api/issue/:key` and the agent's
 * `trace_entity` read the same object — a screen and an answer that name
 * different "latest" are worse than either alone.
 */

import {
  buildRelationGraph,
  buildTimeline,
  byRecency,
  classifySignalFor,
  docNodeId,
  findContradictions,
  meetingNodeId,
  mergeInferred,
  segmentTime,
  slackTsToIso,
  statusEntry,
  type CanvasConnector,
  type DossierChannel,
  type DossierOrigin,
  type DossierPerson,
  type InferredEdge,
  type IssueDossier,
  type McEvent,
  type Owner,
  type RelatedRef,
  type TrailEntry,
  type WorkItem,
  type WorkItemKey,
} from '@mc/domain';
import { lookupStatusWord } from '@mc/connectors';
import type { Connectors } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import type { EventLog } from './events.js';

/**
 * How far back the trail reaches, in days — and how far back a lane is measured.
 *
 * Exported because `work.ts` builds its timeline over the same window on
 * purpose. Two windows would give the lane and the ticket it opens two different
 * answers to "how long has this sat", which is precisely the drift this whole
 * module exists to avoid.
 *
 *
 * Not unbounded: "everything ever said" is a scroll, not an answer, and the
 * event log on a real project is large. A quarter covers "the last few sprints"
 * without turning the newest-first list into an archive.
 */
export const TRAIL_DAYS = 90;

/** Cap per surface, so one chatty channel cannot bury the other four. */
const PER_SURFACE = 12;

/**
 * How far after the filing a record can still be the reason the ticket exists.
 *
 * A day, because that is the shape of the thing being detected: somebody says it
 * in a meeting and somebody files it — before, during, or an hour afterwards.
 * Anything a week later is commentary on work that already existed.
 */
const ORIGIN_GRACE_DAYS = 1;

/**
 * The board's arrows, memoised for a minute — the same bargain `suggest.ts`
 * makes, for the same reason.
 *
 * `listConnectors` costs one GET per distinct endpoint id against a real board:
 * measured at ~3.9s here, which is most of the dossier's latency and all of the
 * reason a caller waits long enough to think it is broken rather than slow.
 * Nothing else this route reads costs network worth caching, and the arrows are
 * the one input that is identical for every key — so one gather serves a whole
 * session of clicking from ticket to ticket.
 */
const ARROWS_TTL_MS = 60_000;
let arrowCache: { at: number; boardId: string; arrows: CanvasConnector[] } | undefined;

export async function boardArrows(c: Connectors, boardId: string): Promise<CanvasConnector[]> {
  if (arrowCache && arrowCache.boardId === boardId && Date.now() - arrowCache.at < ARROWS_TTL_MS) {
    return arrowCache.arrows;
  }
  const arrows = await c.miro.listConnectors(boardId);
  arrowCache = { at: Date.now(), boardId, arrows };
  return arrows;
}

/**
 * Drop it. `main.ts` calls this on every event the log accepts, so the TTL is
 * only ever the backstop for an arrow drawn on the board with no webhook behind
 * it — which is exactly what `canvas-poll.ts` exists to notice.
 */
export function forgetBoardArrows(): void {
  arrowCache = undefined;
}

export async function buildDossier(
  key: WorkItemKey,
  c: Connectors,
  vault: VaultStore,
  log: EventLog,
  /**
   * Relations worked out rather than written down (`infer.ts`). Passed in
   * rather than computed here for the reason the whole module is background:
   * this route is the front door and must not wait on a model. Default empty,
   * so a caller with no inference gets exactly the dossier it got before.
   */
  inferred: InferredEdge[] = [],
): Promise<IssueDossier> {
  const since = Date.now() - TRAIL_DAYS * 86_400_000;
  const fresh = (ts?: string): boolean => {
    if (!ts) return true;
    const t = Date.parse(ts);
    return !Number.isFinite(t) || t >= since;
  };

  const boardId = process.env.MIRO_BOARD_ID ?? 'demo-board';
  const spaceKey = process.env.CONFLUENCE_SPACE_KEY ?? 'MC';

  const [item, items, channels, transcripts, pages, arrows, comments, persisted] =
    await Promise.all([
      c.jira.getItem(key),
      c.jira.listItems(),
      c.slack.listChannels(),
      c.zoom.listTranscripts(),
      c.confluence.listPages(spaceKey),
      boardArrows(c, boardId),
      c.jira.listComments(key),
      /**
       * This key's whole history off disk, with no `since`.
       *
       * `originOf` needs it: a carried-over ticket was filed in the sprint
       * before, routinely outside the 90-day trail, and "when was this filed" is
       * the one date the origin block cannot guess.
       *
       * It has to be the DURABLE log rather than the in-memory one. `seed.ts`
       * writes its backdated events straight to the JSONL — deliberately, so a
       * restart does not replay six months of syncs — so at boot the in-memory
       * log has never heard of a single transition. Reading it here was why the
       * trail showed a status and no history of how the ticket got there.
       */
      vault.readEvents({ key, limit: 5_000 }),
    ]);

  /**
   * Disk plus whatever the process has seen, deduped.
   *
   * `apps/gateway/src/vault.ts` persists every logged event, but it does it
   * fire-and-forget — so an event that arrived a moment ago may not be on disk
   * when this reads. A caller refetching the instant an event lands for its key
   * hits exactly that window. Taking the union costs a Set and closes it.
   */
  const seen = new Set(persisted.map((e) => e.id));
  const history = [...log.forEntity(key).filter((e) => !seen.has(e.id)), ...persisted].sort(
    (a, b) => Date.parse(b.ts) - Date.parse(a.ts),
  );

  const trail: TrailEntry[] = [];

  // ---- Jira: the status itself is a claim, and comments are prose ----------
  if (item) trail.push(statusEntry(item));
  for (const cm of comments) {
    if (!fresh(cm.createdAt)) continue;
    trail.push({
      surface: 'jira',
      ts: cm.createdAt,
      label: `comment — ${cm.author}`,
      quote: cm.body,
      signal: classifySignalFor(cm.body, key),
      who: cm.author,
    });
  }

  // ---- Slack --------------------------------------------------------------
  const slack: TrailEntry[] = [];
  for (const ch of channels) {
    for (const m of await c.slack.listMessages(ch.id)) {
      // Slack's `ts` is unix seconds, not a date — see slackTsToIso.
      const ts = slackTsToIso(m.ts);
      if (!m.mentions.includes(key) || !fresh(ts)) continue;
      slack.push({
        surface: 'slack',
        ts,
        label: `#${ch.name} — ${m.author}`,
        quote: m.text,
        signal: classifySignalFor(m.text, key),
        ref: { surface: 'slack', id: m.ts, parentId: ch.id },
        who: m.author,
        // The channel travels on the entry rather than being re-derived from
        // the label: `#eng-platform — sam` is a string built for a human, and
        // parsing it back to get an id is the kind of round trip that breaks
        // the first time somebody puts a dash in a channel name.
        container: { id: ch.id, name: ch.name },
      });
    }
  }
  // Capped for display, but `channels` and `people` below are counted over ALL
  // of them — "discussed in four channels" is wrong if one of them only lost
  // its last message to a display cap.
  const slackAll = [...slack].sort(byRecency);
  trail.push(...slackAll.slice(0, PER_SURFACE));

  // ---- Zoom ---------------------------------------------------------------
  // A segment's wall time is the meeting's start plus its offset, which is what
  // lets a sentence said in a stand-up sort against a Slack message at all.
  const zoom: TrailEntry[] = [];
  const meetingNodes: { id: string; topic: string; startedAt: string; keys: WorkItemKey[] }[] = [];
  for (const meta of transcripts) {
    if (!fresh(meta.startedAt)) continue;
    const t = await c.zoom.getTranscript(meta.id);
    const spoken = new Set((t?.segments ?? []).flatMap((seg) => seg.mentions));
    if (spoken.size) {
      meetingNodes.push({
        id: meta.id,
        topic: meta.meetingTopic,
        startedAt: meta.startedAt,
        keys: [...spoken],
      });
    }
    for (const seg of t?.segments ?? []) {
      if (!seg.mentions.includes(key)) continue;
      zoom.push({
        surface: 'zoom',
        ts: segmentTime(meta.startedAt, seg.start),
        label: `${meta.meetingTopic} — ${seg.speaker}`,
        quote: seg.text,
        at: seg.start,
        signal: classifySignalFor(seg.text, key),
        ref: { surface: 'zoom', id: meta.id, at: seg.start },
        who: seg.speaker,
        container: { id: meta.id, name: meta.meetingTopic },
      });
    }
  }
  const zoomAll = [...zoom].sort(byRecency);
  trail.push(...zoomAll.slice(0, PER_SURFACE));

  // ---- Confluence ---------------------------------------------------------
  // The page is a pointer, not a claim: a runbook mentioning "blocked" is
  // documenting the concept, not reporting today's state. No signal on purpose.
  for (const p of pages) {
    if (!p.relatedKeys.includes(key)) continue;
    trail.push({
      surface: 'confluence',
      ts: p.updatedAt,
      label: p.title,
      url: p.url,
      ref: { surface: 'confluence', id: p.id },
    });
  }

  // ---- The vault ----------------------------------------------------------
  // Only a `dated` note is a claim about a moment, so only a dated note can
  // agree or disagree about today. A `person` or `pattern` note is a standing
  // description — "chases external parties and reports it as progress" is a
  // habit, not a status report — and reading a state claim out of one is the
  // same mistake as reading one out of a runbook. The vault's own decay model
  // already draws this line; this reuses it rather than inventing a second.
  const notes = vault.list().filter((n) => n.relatedKeys?.includes(key));
  for (const n of notes) {
    trail.push({
      surface: 'vault',
      ts: n.updatedAt,
      label: `${n.kind} — ${n.title}`,
      // A quote is one line of prose beside four other surfaces' plain text,
      // so it is flattened rather than rendered: `**Watch for:**` and
      // `[[provider-signing-secret]]` sitting in a Slack-shaped trail read as
      // corrupted data, not as emphasis. The note itself keeps its markdown —
      // one click away, on its own note page.
      quote: plainText(n.body).slice(0, 240),
      signal: n.recency === 'dated' ? classifySignalFor(n.body, key) : undefined,
      ref: { surface: 'vault', id: n.id },
    });
  }

  // ---- The event log ------------------------------------------------------
  // Transitions only. Every other event type is already represented by the
  // record it was derived from, and listing both says everything twice.
  for (const e of history) {
    if (!fresh(e.ts) || !e.type.endsWith('.status_changed')) continue;
    const to = (e.payload as { to?: string } | undefined)?.to;
    trail.push({
      surface: 'jira',
      ts: e.ts,
      label: to ? `moved to ${to.replace('_', ' ')}` : e.type,
      signal: to ? classifySignalFor(to) : undefined,
    });
  }

  trail.sort(byRecency);

  // ---- Relations, scoped to this key --------------------------------------
  /**
   * Meetings go into the graph too, and used not to.
   *
   * `buildRelationGraph` has taken `meetings` since recordings became nodes, and
   * this call simply never passed them — so the storyline drew "MC-103 was
   * discussed in Sprint 14 planning" and the ticket's own page did not. The
   * recording was in the trail as a quotation and missing from the relations,
   * which is the one place somebody looks to answer "which meetings is this
   * ticket tangled up in".
   *
   * The keys come off the transcripts already fetched for the trail, so this
   * costs a map and no I/O.
   */
  const graph = mergeInferred(
    buildRelationGraph({
      items,
      notes: vault.list(),
      connectors: arrows,
      pages,
      meetings: meetingNodes,
    }),
    inferred,
  );
  const label = new Map(graph.nodes.map((n) => [n.id, n]));
  const pageById = new Map(pages.map((p) => [docNodeId(p.id), p.id]));
  const meetingById = new Map(meetingNodes.map((m) => [meetingNodeId(m.id), m.id]));
  const related: RelatedRef[] = graph.edges
    .filter((e) => e.from === key || e.to === key)
    .map((e) => {
      const other = e.from === key ? e.to : e.from;
      const node = label.get(other);
      // A note or a page has somewhere to open; a work item is handled by the
      // dossier itself, so it deliberately carries no ref.
      const ref =
        node?.kind === 'note'
          ? ({ surface: 'vault', id: other } as const)
          : node?.kind === 'doc' && pageById.has(other)
            ? ({ surface: 'confluence', id: pageById.get(other)! } as const)
            : node?.kind === 'meeting' && meetingById.has(other)
              ? ({ surface: 'zoom', id: meetingById.get(other)! } as const)
              : undefined;
      return {
        id: other,
        kind: node?.kind ?? ('workitem' as const),
        label: node?.label ?? other,
        via: e.kind,
        asserts: e.asserts,
        provenance: e.provenance,
        confidence: e.confidence,
        basis: e.basis,
        status: node?.status,
        direction: e.from === key ? ('out' as const) : ('in' as const),
        ref,
      };
    })
    // An arrow drawn on the board and a Jira link can express the same
    // dependency; showing it twice reads as two dependencies.
    .filter((r, i, all) => all.findIndex((o) => o.id === r.id && o.via === r.via) === i);

  // ---- Time in state ------------------------------------------------------
  // The lane keeps the window it has always had: `ageDays` and `flowEfficiency`
  // mean "over the period we are showing", and widening them silently would
  // change every number derived from them.
  const sinceIso = new Date(since).toISOString();
  const events = history.filter((e) => e.ts >= sinceIso).slice(0, 2_000);
  const lane = buildTimeline(events, { items, notes: vault.list(), mapStatus: lookupStatusWord }).lanes.find((l) => l.key === key);

  const counts: Partial<Record<Owner, number>> = {};
  for (const e of trail) counts[e.surface] = (counts[e.surface] ?? 0) + 1;

  /**
   * People and channels, counted over EVERYTHING, not over the display cap.
   *
   * `PER_SURFACE` trims what the trail shows so one chatty channel cannot bury
   * the other four. Counting the rollups off the trimmed list would then say
   * "discussed in three channels" about a ticket discussed in four, which is a
   * worse lie than showing fewer quotations: the quotations are visibly a
   * sample and the count reads as a fact.
   */
  const everything = [...trail, ...slackAll.slice(PER_SURFACE), ...zoomAll.slice(PER_SURFACE)];

  const peopleBy = new Map<string, DossierPerson>();
  for (const e of everything) {
    if (!e.who) continue;
    const found = peopleBy.get(e.who) ?? { name: e.who, surfaces: [], records: 0 };
    found.records += 1;
    if (!found.surfaces.includes(e.surface)) found.surfaces.push(e.surface);
    if (e.ts && (!found.lastAt || e.ts > found.lastAt)) found.lastAt = e.ts;
    peopleBy.set(e.who, found);
  }

  const channelsBy = new Map<string, DossierChannel>();
  for (const e of everything) {
    if (e.surface !== 'slack' || !e.container) continue;
    const found = channelsBy.get(e.container.id) ?? {
      id: e.container.id,
      name: e.container.name,
      records: 0,
    };
    found.records += 1;
    if (e.ts && (!found.lastAt || e.ts > found.lastAt)) found.lastAt = e.ts;
    channelsBy.set(e.container.id, found);
  }

  const byRecords = <T extends { records: number }>(a: T, b: T): number => b.records - a.records;

  return {
    key,
    item,
    trail,
    contradictions: findContradictions(trail),
    related,
    lane,
    inCycle: graph.cycles.filter((cy) => cy.includes(key)),
    counts,
    origin: originOf(key, trail, related, items, history),
    people: [...peopleBy.values()].sort(byRecords),
    channels: [...channelsBy.values()].sort(byRecords),
  };
}

/**
 * Markdown flattened to the sentence underneath it.
 *
 * Deliberately not a parser. It handles the four things the seed notes actually
 * use — wikilinks, inline links, emphasis and headings — and leaves anything
 * else alone, because a quote is a 240-character preview and the cost of
 * getting an edge case wrong is one odd-looking line, while the cost of pulling
 * in a markdown renderer for it is a dependency on the trail's hot path.
 */
function plainText(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, id: string, alias?: string) => alias ?? id)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![*\w])\*(?!\s)([^*]+?)(?<!\s)\*(?![*\w])/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Where the work came from.
 *
 * Everything here is already in the dossier — this only picks the three records
 * that answer "why does this ticket exist", which is the first thing anybody
 * picking up a ticket wants and the last thing a Jira page tells them.
 *
 * The one rule worth stating: the earliest mention is never the ticket's own
 * creation event or a transition off it. Those are our bookkeeping, and
 * rendering one under a heading reading "where it came from" is a system
 * inventing provenance out of its own records. Only something a person said or
 * wrote counts, which is exactly the set of trail entries that carry a `ref`.
 *
 * Whether that record PREDATES the filing is reported separately rather than
 * used as a filter. It is a much stronger claim — the planning call that named
 * the problem before anybody opened a ticket — and it is the one that makes the
 * demo, so it must not be asserted on a conversation that happened an hour
 * after the fact.
 */
function originOf(
  key: WorkItemKey,
  trail: TrailEntry[],
  related: RelatedRef[],
  items: WorkItem[],
  history: McEvent[],
): DossierOrigin {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const created = history.find((e) => e.type === 'workitem.created')?.ts;

  // Oldest first, and only records that came from a human saying something —
  // the Jira status entry has no clock of its own and the transitions are our
  // own bookkeeping, so neither can be the reason the work exists.
  const spoken = trail
    .filter((e) => e.ref && e.ts)
    .sort((a, b) => Date.parse(a.ts!) - Date.parse(b.ts!));
  const first = spoken[0];
  const filed = created ? Date.parse(created) : NaN;
  const firstAt = first?.ts ? Date.parse(first.ts) : NaN;
  const dated = Number.isFinite(filed) && Number.isFinite(firstAt);
  const predates = dated && firstAt < filed;
  // Undated on either side means we cannot tell, and cannot tell is not "yes".
  const isOrigin = dated && firstAt <= filed + ORIGIN_GRACE_DAYS * 86_400_000;

  const epicKey = byKey.get(key)?.epicKey;
  const epic = epicKey ? byKey.get(epicKey) : undefined;

  /**
   * A `sequence` arrow pointing AT this item, from an investigation.
   *
   * `sequence` runs earlier → later, so the inbound end is the work that came
   * first. Restricted to a spike because that is the pairing the board actually
   * draws (see `PROFILE_MIX` in the mock connectors): an investigation reports,
   * and the work it turned into is filed the same day.
   */
  const spikeRef = related.find(
    (r) => r.via === 'sequence' && r.direction === 'in' && byKey.get(r.id)?.type === 'spike',
  );
  const spike = spikeRef ? byKey.get(spikeRef.id) : undefined;

  return {
    createdAt: created,
    first,
    predatesTicket: predates,
    firstIsOrigin: isOrigin,
    epic: epic ? { key: epic.key, title: epic.title } : undefined,
    spike: spike ? { key: spike.key, title: spike.title } : undefined,
  };
}
