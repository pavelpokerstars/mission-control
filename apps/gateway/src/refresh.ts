/**
 * A scheduled re-derive, and the two durable things it leaves behind.
 *
 * WHY THIS EXISTS AT ALL. The derived graph is a snapshot of *now* — it can say
 * a ticket is in Code Review and cannot say it has been there nine days, and it
 * cannot say anything about the moment a sprint ended or an arrow closed a loop.
 * `commitment_gap` survives that, because "a promise with no ticket" is a state
 * predicate. Nothing else does: a disagreement, a cycle closing, a container
 * closing are all *transitions*, and comparing current state against nothing
 * cannot see one.
 *
 * So each run diffs the freshly-derived graph against the previous run and
 * appends the result to the durable log. `GRAPH-SCHEMA.md` §2 is the model; this
 * is the half of it that runs.
 *
 * THE FIRST RUN IS A BASELINE, NEVER NEWS, and the baseline is on disk. Held in
 * memory, "the first pass is a baseline" means every restart re-baselines, and a
 * sprint that closed while the gateway was down is absorbed and never announced
 * — silently, which is the worst way to lose one. `canvas-poll.ts` learned this
 * the hard way and this is the same rule, for the same reason.
 *
 * WHAT IS STORED IS A SIGNATURE, NOT THE GRAPH. Two full copies of a
 * twenty-thousand-node graph on disk to answer "what changed" is a lot of bytes
 * for a set difference. The signature holds edge identities and the handful of
 * node fields a transition can be read from.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  edgeObservationKey,
  newEvent,
  type ConfidenceTier,
  type EdgeKey,
  type GraphDelta,
  type McEvent,
  type ObservationIndex,
  type StoredGraph,
  type StoredRelation,
} from '@mc/domain';
import { eventLog } from './events.js';
import { VAULT_DIR } from './vault.js';

const SIGNATURE_FILE = join(VAULT_DIR, 'raw', 'graph-signature.json');
const OBSERVATIONS_FILE = join(VAULT_DIR, 'raw', 'graph-observations.json');

/**
 * How old a signature may be and still count as news.
 *
 * Persisting exists to survive a restart, not a quarter. A signature from three
 * months ago means nothing has re-derived in three months, and reporting every
 * change since as new would put a season of history on the front door in one
 * tick. Past this we re-baseline and say so — the same rule and the same number
 * as `canvas-poll.ts`.
 */
const SIGNATURE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Signature {
  at: string;
  /** What produced the graph, so a different collector's output cannot inherit this. */
  generator: string;
  /** `edgeObservationKey` → tier. Identity and the one attribute that moves. */
  edges: Record<string, ConfidenceTier>;
  /** Node id → the fields a transition is read from. */
  nodes: Record<string, { status?: string; state?: string }>;
}

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

export function signatureOf(g: StoredGraph): Signature {
  const edges: Record<string, ConfidenceTier> = {};
  for (const e of g.links) {
    edges[edgeObservationKey({ source: e.source, target: e.target, relation: e.relation })] = e.tier;
  }

  const nodes: Record<string, { status?: string; state?: string }> = {};
  for (const n of g.nodes) {
    const status = 'status' in n ? n.status : undefined;
    const state = 'state' in n ? n.state : undefined;
    if (status || state) nodes[n.id] = { ...(status ? { status } : {}), ...(state ? { state } : {}) };
  }

  return { at: g.graph.generatedAt, generator: g.graph.generator, edges, nodes };
}

const keyOf = (encoded: string): EdgeKey => {
  const [source, target, relation] = JSON.parse(encoded) as [string, string, StoredRelation];
  return { source, target, relation };
};

/**
 * What changed between two runs.
 *
 * `removed` is the half a graph updated in place can never produce, and the half
 * that matters most here: Jira does not reliably report link deletions, so an
 * edge that quietly stops existing is exactly the "declared link that has gone
 * stale" this system is supposed to raise.
 */
export function diffSignatures(prev: Signature, next: Signature, at: string): GraphDelta {
  const prevEdges = new Set(Object.keys(prev.edges));
  const nextEdges = new Set(Object.keys(next.edges));

  const addedEdges = [...nextEdges].filter((k) => !prevEdges.has(k)).map(keyOf);
  const removedEdges = [...prevEdges].filter((k) => !nextEdges.has(k)).map(keyOf);

  const tierChanges = [...nextEdges]
    .filter((k) => prevEdges.has(k) && prev.edges[k] !== next.edges[k])
    .map((k) => ({ edge: keyOf(k), from: prev.edges[k]!, to: next.edges[k]! }));

  const prevNodes = new Set(Object.keys(prev.nodes));
  const nextNodes = new Set(Object.keys(next.nodes));

  /**
   * A status change and a container closing are both "this node's word moved",
   * so they come out of one comparison — `state` for a sprint, `status` for an
   * issue. Reading them separately would mean two walks over the same nodes and
   * two chances to disagree about what "before" was.
   */
  const statusChanges = [...nextNodes]
    .filter((id) => prevNodes.has(id))
    .flatMap((id) => {
      const a = prev.nodes[id]!;
      const b = next.nodes[id]!;
      const from = a.status ?? a.state;
      const to = b.status ?? b.state;
      return from && to && from !== to ? [{ node: id, from, to }] : [];
    });

  return {
    at,
    generator: next.generator,
    addedNodes: [...nextNodes].filter((id) => !prevNodes.has(id)),
    removedNodes: [...prevNodes].filter((id) => !nextNodes.has(id)),
    addedEdges,
    removedEdges,
    tierChanges,
    statusChanges,
  };
}

export function isEmptyDelta(d: GraphDelta): boolean {
  return (
    !d.addedNodes.length &&
    !d.removedNodes.length &&
    !d.addedEdges.length &&
    !d.removedEdges.length &&
    !d.tierChanges.length &&
    !d.statusChanges.length
  );
}

// ---------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------

/** Statuses that mean a container has closed. Config-shaped, like `STATUS_WORDS`. */
const CLOSED = new Set(['closed', 'done']);

/**
 * The diff, as events on the durable log.
 *
 * One summary event carrying the whole delta, plus a named event for each thing
 * a detector or a notification actually watches. The summary is what makes the
 * change history replayable; the named events are what make it *actionable*
 * without every consumer having to understand a delta.
 */
/**
 * How many edge identities a single refresh event may carry.
 *
 * The payload used to be counts alone — `removed: 2`, never WHICH two — which
 * made the most valuable half of a diff unactionable: "a declared link has gone
 * stale" is the finding, and an edge that quietly stopped existing cannot be
 * named from a number. The identities are carried now.
 *
 * Capped, because a re-derive is not always small. A collector re-importing a
 * programme moves thousands of edges at once, and the log is JSONL — one event
 * is one line, read whole by `readEvents` on every call. Measured on this repo's
 * fixture, 158 edges serialise to 36 kB, so a 5,000-issue programme's ~20k edges
 * would be a **4.4 MB single line**. `truncated` says when the list is partial;
 * `added`/`removed` stay the true totals, so a count is never a lie even when
 * the list is short.
 */
const MAX_EDGE_IDS = 500;

export function deltaToEvents(d: GraphDelta): McEvent[] {
  const cap = (ks: GraphDelta['addedEdges']): GraphDelta['addedEdges'] => ks.slice(0, MAX_EDGE_IDS);
  const out: McEvent[] = [
    newEvent({
      ts: d.at,
      source: 'mc',
      type: 'mc.graph_refreshed',
      payload: {
        generator: d.generator,
        added: d.addedEdges.length,
        removed: d.removedEdges.length,
        tierChanges: d.tierChanges.length,
        statusChanges: d.statusChanges.length,
        // The identities, so a consumer can name the edge that went rather than
        // only count it. `removed` is the half an in-place update cannot produce.
        addedEdges: cap(d.addedEdges),
        removedEdges: cap(d.removedEdges),
        ...(d.addedEdges.length > MAX_EDGE_IDS || d.removedEdges.length > MAX_EDGE_IDS
          ? { truncated: true }
          : {}),
      },
    }),
  ];

  for (const c of d.statusChanges) {
    // A container closing is the moment an alert may fire, so it gets its own
    // event rather than being something every consumer re-derives from a status
    // string it would have to know the closing words for.
    if (CLOSED.has(c.to.toLowerCase()) && !CLOSED.has(c.from.toLowerCase())) {
      out.push(
        newEvent({
          ts: d.at,
          source: 'mc',
          type: 'mc.container_closed',
          payload: { container: c.node, from: c.from, to: c.to },
        }),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/**
 * How long we have believed each edge.
 *
 * THIS FILE IS THE ONLY COPY, and it is the one durable thing here that the
 * append-only log cannot rebuild. `deltaToEvents` above writes the *cardinality*
 * of a diff and never an edge identity, and `runRefresh` appends nothing at all
 * on a baseline run or a run where nothing moved — while this index is updated
 * on every run including those, so `seenCount` counts runs the log has no record
 * of. Delete `graph-observations.json` and the next run stamps every surviving
 * edge `firstSeen: now, seenCount: 1`, and every edge that had already vanished
 * is forgotten — which is exactly the `lastConfirmed: 3 days ago` claim this
 * index exists to make. Re-baselining the *signature* does not cost it: both
 * paths read this index and merge into it.
 *
 * THE EDGE IDENTITIES ARE ON THE EVENT NOW, so the change history is replayable:
 * a consumer can name the edge that vanished at 07:41 rather than read that two
 * did. FULL regeneration of this index still is not reachable, and the reason is
 * a measured number rather than an unfinished task. Rebuilding `firstSeen` from
 * an empty index needs the baseline run to record every edge it saw, and a
 * baseline is one JSONL line: 158 edges serialise to 36 kB on this fixture, so a
 * 5,000-issue programme would put ~4.4 MB on a single line that `readEvents`
 * parses whole on every call. That is a worse problem than the one it solves.
 *
 * So: treat this file as STATE. Delete it and the next run stamps every
 * surviving edge `firstSeen: now, seenCount: 1`.
 */
export function updateObservations(
  index: ObservationIndex,
  g: StoredGraph,
  at: string,
): ObservationIndex {
  const next: ObservationIndex = { ...index };
  for (const e of g.links) {
    const key = edgeObservationKey({ source: e.source, target: e.target, relation: e.relation });
    const seen = next[key];
    next[key] = seen
      ? { ...seen, lastConfirmed: at, seenCount: seen.seenCount + 1 }
      : { firstSeen: at, lastConfirmed: at, seenCount: 1 };
  }
  return next;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

export interface RefreshResult {
  /** True on the first run, or after a stale signature. Nothing is announced. */
  baseline: boolean;
  delta?: GraphDelta;
  events: number;
  why?: string;
}

export async function runRefresh(graph: StoredGraph, now = new Date()): Promise<RefreshResult> {
  const at = now.toISOString();
  const next = signatureOf(graph);

  const prev = await readJson<Signature>(SIGNATURE_FILE);
  const observations = (await readJson<ObservationIndex>(OBSERVATIONS_FILE)) ?? {};

  const stale = prev ? now.getTime() - Date.parse(prev.at) > SIGNATURE_MAX_AGE_MS : false;
  // A different collector's output is not a diff against ours — every id would
  // read as added and every one of ours as removed.
  const foreign = prev ? prev.generator !== next.generator : false;

  if (!prev || stale || foreign) {
    await writeJson(SIGNATURE_FILE, next);
    await writeJson(OBSERVATIONS_FILE, updateObservations(observations, graph, at));
    return {
      baseline: true,
      events: 0,
      why: !prev
        ? 'first run — nothing to compare against'
        : foreign
          ? `a different generator wrote this graph (${prev.generator} → ${next.generator})`
          : 'the last signature is over a day old',
    };
  }

  const delta = diffSignatures(prev, next, at);
  await writeJson(SIGNATURE_FILE, next);
  await writeJson(OBSERVATIONS_FILE, updateObservations(observations, graph, at));

  if (isEmptyDelta(delta)) return { baseline: false, delta, events: 0, why: 'nothing changed' };

  const events = deltaToEvents(delta);
  for (const e of events) eventLog.append(e);
  return { baseline: false, delta, events: events.length };
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
