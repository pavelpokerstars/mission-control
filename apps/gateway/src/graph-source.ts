/**
 * Read `graph.json` and `records/` off disk.
 *
 * WHY THE I/O IS HERE AND THE PROJECTION IS IN `@mc/connectors`. That library is
 * imported by the browser. `apps/shell/vite.config.mts` derives its aliases from
 * `tsconfig.base.json` and keeps `@mc/vault` out with an explicit deny-list,
 * precisely because it touches `node:fs` — so a `readFile` in the connectors lib
 * would hand the shell the same problem with nothing to catch it. The
 * projections stay pure over an already-loaded object; this is the half that
 * knows about a filesystem.
 *
 * WHY THE PATH IS CONFIGURABLE. The mock fixture and a real collector's output
 * are the same artefact, so pointing at one or the other is the whole of "going
 * live" for these surfaces. `MC_GRAPH_DIR` is that switch.
 *
 * Loaded at boot and held for the life of the process — never per request, which
 * would put a multi-megabyte parse on the front door, the mistake `readEvents`
 * already makes and is listed for. The graph is the derived layer: rebuilt by a
 * collector, never by us.
 *
 * ONE GRAPH, IN A CELL, AND EVERYTHING FOLLOWS IT. The process used to hold two
 * copies: `main.ts` loaded one at boot and every route closed over it, while the
 * scheduler loaded its own on each re-derive. So a collector rewriting
 * `graph.json` produced a job that announced a finding whose deep link opened a
 * page built from the older graph, until somebody restarted — and `notify` split
 * one run down the middle, reading findings from the new file and work items
 * from the boot-built connectors.
 *
 * The fix is `currentGraph` / `installGraph` below, and the reason it is a cell
 * rather than a getter threaded through the app is that the obvious version of
 * this DOES NOT WORK. `createGraphConnectors` used to project eagerly into Maps
 * at construction, so every consumer held a snapshot rather than a view and
 * swapping a cell would have left all of them — `tools.ts` dereferences the
 * connectors in 25 places, plus sync, canvas-poll and the inference pass —
 * reading the graph they were built from. It takes a READER now and re-projects
 * on identity change, so the swap reaches roughly eighty call sites that did not
 * have to be touched, in files that include the one holding the human gate.
 *
 * What that cost is the write half, and it is the interesting part: the
 * projections were also where `createItem`, `comment`, `publish` and `post`
 * landed, so re-projecting would have undone the flagship loop — accept an
 * alert's action at 10:00 and the ticket it created is gone at 19:00. The
 * connectors keep a derived half and an asserted half now, exactly as the
 * storage model does one layer up. `createGraphConnectors` carries the merge
 * rule; `verify-graph.mts` asserts a swap keeps what was written.
 *
 * Only a dozen readers hold a `GraphSource` directly rather than through a
 * connector, and they all call `currentGraph()`.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createGraphConnectors,
  createMiroConnector,
  setStatusWords,
  type Connectors,
  type GraphSource,
  type StatusMapReport,
} from '@mc/connectors';
import type { StoredContainer, StoredGraph } from '@mc/domain';
import { guardConnectors } from './safe-mode.js';

/** Where the graph lives. The fixture by default; a collector's output later. */
export const GRAPH_DIR = process.env.MC_GRAPH_DIR ?? join(process.cwd(), 'fixtures');

/**
 * Where the status map lives, if there is one.
 *
 * NOT inside `MC_GRAPH_DIR`. That directory is the *derived* layer — rebuilt in
 * full on every collector run (`GRAPH-SCHEMA.md` §2) — and a hand-written
 * mapping put there is a hand-written mapping somebody's next refresh deletes.
 * Configuration is neither derived nor asserted; it is an input, so it gets its
 * own path.
 */
export const STATUS_MAP_PATH = process.env.MC_STATUS_MAP ?? null;

/**
 * Load the vendor's status words, if configured.
 *
 * Failing loudly, and on purpose. A status map exists because the built-in
 * defaults are wrong for this workflow, so falling back to them silently
 * restores the exact bug somebody wrote the file to fix — a lane where
 * `in_review` and `blocked` have quietly stopped existing.
 */
export async function loadStatusWords(path = STATUS_MAP_PATH): Promise<StatusMapReport | null> {
  if (!path) return null;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read the status map at ${path} (MC_STATUS_MAP). ` +
        `Unset MC_STATUS_MAP to use the built-in defaults. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON. It should be a flat object of the workflow's own ` +
        `status names to ours, e.g. { "In Review": "in_review", "Awaiting QA": "in_review" }. ` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} must be a flat object of vendor status name → ours.`);
  }
  const report = setStatusWords(parsed as Record<string, string>);
  if (report.rejected.length) {
    // Rejected rather than ignored: a typo'd target would otherwise become a
    // status the rest of the app has never heard of, and JSON gets no help from
    // the compiler.
    throw new Error(
      `${path} has ${report.rejected.length} unusable entr${report.rejected.length === 1 ? 'y' : 'ies'}:\n` +
        report.rejected.map((r) => `  ${r}`).join('\n'),
    );
  }
  return report;
}

/**
 * Why this fails rather than starting empty.
 *
 * An unreadable graph is the one case where degrading is worse than stopping: a
 * gateway that boots on nothing serves an alert list saying "Nothing needs you",
 * which is the single most reassuring screen in the product and would be a lie.
 * Better to refuse to start and say why.
 *
 * A graph that is *validly* empty is a different thing and does start — a
 * collector that ran and found nothing is information, and `/api/health` reports
 * `nodes: 0` so it is visible at a glance.
 *
 * The message matters because `MC_GRAPH_DIR` is the whole of the switch for four
 * surfaces, and a typo'd path is the likeliest mistake anybody makes with it.
 * This used to be a bare ENOENT stack trace.
 */
function unreadable(dir: string, cause: unknown): Error {
  const why =
    (cause as { code?: string })?.code === 'ENOENT'
      ? `There is no graph.json in ${dir}.`
      : `${dir}/graph.json could not be parsed — a collector that died mid-write leaves exactly this.`;
  return new Error(
    [
      `Cannot read the connection graph. ${why}`,
      '',
      'MC_GRAPH_DIR is where the gateway reads Jira, Slack, Zoom and Confluence',
      'from — a collector writes graph.json and records/ there, and pointing at it',
      'is the whole of going live for those four surfaces.',
      '',
      `  currently:  MC_GRAPH_DIR=${process.env.MC_GRAPH_DIR ?? '(unset)'}`,
      `  resolved:   ${dir}`,
      '',
      'To run on the committed fixture instead, unset MC_GRAPH_DIR and make sure',
      'fixtures/ exists — `npm run fixture` regenerates it, and `npm run verify`',
      'checks the whole chain without needing a server.',
      '',
      `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    ].join('\n'),
  );
}

export async function loadGraphSource(dir = GRAPH_DIR): Promise<GraphSource> {
  let graph: StoredGraph;
  try {
    graph = JSON.parse(await readFile(join(dir, 'graph.json'), 'utf8')) as StoredGraph;
  } catch (err) {
    throw unreadable(dir, err);
  }
  /**
   * A file that parses but is not a graph. `programme_graph` writing an error
   * payload, or a half-migrated schema, both land here — and without this the
   * first symptom is `nodes.length` on undefined, several layers away.
   */
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw unreadable(dir, new Error('graph.json has no `nodes` and `links` arrays'));
  }
  const records = new Map<string, unknown>();

  // A missing `records/` is legitimate rather than an error: a graph with no
  // bodies still answers every structural question, and a collector that only
  // walked Jira produces exactly that. A record view then shows its metadata
  // and no text, which is honest about what was read.
  let kinds: string[] = [];
  try {
    kinds = await readdir(join(dir, 'records'));
  } catch {
    return { graph, records };
  }

  for (const kind of kinds) {
    let files: string[] = [];
    try {
      files = await readdir(join(dir, 'records', kind));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      records.set(
        `${kind}/${f.slice(0, -'.json'.length)}`,
        JSON.parse(await readFile(join(dir, 'records', kind, f), 'utf8')),
      );
    }
  }
  return { graph, records };
}

/**
 * The sprints and releases, for anything that must agree with
 * `findMissingTickets` about what a container is.
 *
 * It resolves `Note.container` against these **node ids**, so every writer of
 * that field has to draw from the same list — a hand-built string produces a
 * note whose alert can never fire, and nothing anywhere reports it.
 */
export function containersOf(source: GraphSource): StoredContainer[] {
  return source.graph.nodes.filter(
    (n): n is StoredContainer => n.kind === 'sprint' || n.kind === 'release',
  );
}

/**
 * The five connectors over one graph, composed the one way.
 *
 * Exported so the boot path and the twice-daily re-derive cannot drift. They
 * did: `main.ts` composed this inline while `scheduler.ts`'s `notify` reloaded
 * the graph and then kept the BOOT-built connectors — so one run read its
 * findings from the new file and its work items from the old one, and a finding
 * could name a ticket the item list it was ranked against did not contain.
 * Invisible on fixtures, which never change under a running gateway.
 *
 * Miro is the exception it looks like: with a token it is a live client rather
 * than a projection, so it is unaffected by which graph was loaded. It is
 * composed here anyway, because the alternative is two places that both decide
 * what a `Connectors` is.
 */
export function connectorsFor(read: () => GraphSource = currentGraph): Connectors {
  const token = process.env.MIRO_ACCESS_TOKEN;
  // Guarded HERE, at the one place a `Connectors` is composed, so no consumer
  // can hold an unguarded set and no future writer has to remember the rule.
  return guardConnectors({
    ...createGraphConnectors(read, process.env.MIRO_BOARD_ID ?? 'demo-board'),
    ...(token ? { miro: createMiroConnector({ token }) } : {}),
  });
}

// ---------------------------------------------------------------------------
// The live graph
// ---------------------------------------------------------------------------

let cell: GraphSource | undefined;

/**
 * The graph everything reads, right now.
 *
 * ONE CELL, AND EVERYTHING FOLLOWS IT. `createGraphConnectors` takes this as its
 * reader and re-projects when the object changes, so swapping here reaches every
 * consumer that captured a `Connectors` at boot — the agent, the tool set, the
 * sync loop, the canvas poll, the inference pass — without any of them knowing a
 * swap happened. That is why this is a cell rather than a getter threaded
 * through roughly eighty call sites.
 *
 * What it does NOT reach is anything holding a `GraphSource` directly. Those
 * read this function instead; there are about a dozen and they are all in
 * `main.ts`.
 */
export function currentGraph(): GraphSource {
  if (!cell) throw new Error('the graph has not been loaded — call installGraph() first');
  return cell;
}

/**
 * Put a freshly loaded graph in front of everything, and return it.
 *
 * Called once at boot and again by the refresh job after each re-derive, which
 * is the moment a collector's new `graph.json` should become what the app
 * answers from. Returns its argument so a caller can keep using the exact source
 * it installed — the run that diffed a graph should announce that same graph,
 * not whatever the cell holds by the time it gets around to notifying.
 */
export function installGraph(source: GraphSource): GraphSource {
  cell = source;
  return source;
}
