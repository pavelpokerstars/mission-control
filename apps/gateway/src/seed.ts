/**
 * Backdated history for mock mode.
 *
 * The five surfaces answer "what is true now", and on a cold start the event
 * log agrees with them: it is empty. That is fine for anything reading current
 * state, and useless for `buildTimeline` — and therefore for the `aging`
 * finding — which has nothing to measure until a ticket has *moved* once.
 *
 * So on first boot — `MC_MODE=mock`, which is the default and therefore the
 * live-collector path too — we copy whatever history the graph shipped and
 * nothing else: `MC_GRAPH_DIR/events.jsonl`, 46 events across `PAY-*`, `PLT-*`
 * and `WEB-*` spanning 22 June to 20 August in the committed fixture. We invent
 * no transitions. A graph that shipped no history is a programme whose
 * transitions have not been observed yet; they accrue from the Jira webhook and
 * the scheduled re-derive from the first run.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *  1. It does not go through `eventLog`. Appending 46 events to the live log on
 *     boot would run every one of them through `startSync`, which would upsert a
 *     Miro card per event and post "PAY-9031 is now BLOCKED" to Slack — weeks
 *     late, every time the gateway restarts. History is written straight to the
 *     raw JSONL, which is what the timeline reads anyway.
 *
 *  2. It does not run when the log already has anything in it. Seeding is a
 *     cold-start convenience, not a fixture that fights real usage.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GRAPH_DIR } from './graph-source.js';
import type { McEvent } from '@mc/domain';
import { decodeNote, type VaultStore } from '@mc/vault';

/**
 * SEED FROM THE GRAPH'S OWN `events.jsonl`, AND FROM NOTHING ELSE.
 *
 * There used to be a fallback here — `CREATED`, `TRANSITIONS`, `surroundings()`
 * and the mock connectors' `HISTORY` — for when the graph shipped no history.
 * It described the MC-* programme the fixtures replaced, and its own comment
 * said exactly what that costs: "seeding from those tables writes transitions
 * for keys that do not exist… silently, because nothing joins a stray event to
 * anything."
 *
 * The guard was whether the graph shipped events. That is true for our
 * generated fixture and **false for every real collector** —
 * `import-programme-graph.mts` writes `graph.json` and no `events.jsonl` — so
 * the one path the fallback could ever be reached on was the live one.
 * Measured: **431 MC-* events written into a vault whose graph held only PAY-*
 * keys**, into the append-only log, which is never rebuilt.
 *
 * A collector's graph with no history is not a gap to paper over. It is a
 * programme whose transitions have not been observed yet; they accrue from the
 * Jira webhook and the scheduled re-derive from the first run onward. An empty
 * log is the honest starting state, and `runRefresh` treats the first pass as a
 * baseline for the same reason.
 */
export async function seedHistory(vault: VaultStore): Promise<number> {
  const existing = await vault.readEvents({ limit: 1 });
  if (existing.length > 0) return 0;

  const shipped = await shippedEvents();
  for (const e of shipped) await vault.appendEvent(e);
  return shipped.length;
}

/**
 * `events.jsonl` from wherever the graph came from, if it is there.
 *
 * Read directly rather than through `eventLog`, exactly as the rest of this file
 * writes: replaying these through the sync layer would upsert a Miro card per
 * event and post a six-week-late "PAY-9031 is now IN REVIEW" to Slack on every
 * restart.
 */
async function shippedEvents(): Promise<McEvent[]> {
  try {
    const raw = await readFile(join(GRAPH_DIR, 'events.jsonl'), 'utf8');
    return raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as McEvent);
  } catch {
    return [];
  }
}

/**
 * Copy the fixture's claims into the vault, once, if it is empty.
 *
 * Claims are the ASSERTED layer: nobody can re-read a promise out of Jira, so
 * they accumulate and are never rebuilt. The vault is where that layer lives, so
 * a fixture's claims have to arrive there rather than staying in `graph.json` —
 * the graph carries them as nodes for the relations and for Sources, but the copy a
 * human edits and a detector reads is the markdown.
 *
 * Copied rather than read in place, and only into an empty vault, for the same
 * reason `seedHistory` refuses to run twice: the fixture is an INPUT. A demo
 * that edits its own inputs cannot be re-run, and a re-generate would silently
 * discard whatever somebody had written since.
 */
export async function seedNotes(vault: VaultStore): Promise<number> {
  if (vault.list().length > 0) return 0;

  let files: string[] = [];
  try {
    files = (await readdir(join(GRAPH_DIR, 'notes'))).filter((f) => f.endsWith('.md'));
  } catch {
    return 0;
  }

  let written = 0;
  for (const f of files) {
    const id = f.slice(0, -'.md'.length);
    const note = decodeNote(id, await readFile(join(GRAPH_DIR, 'notes', f), 'utf8'));
    // Straight through `create`, so `assertVaultSafe` sees every one of them —
    // a fixture that could not be written by hand is a fixture that is lying
    // about what the vault accepts.
    const { id: _id, links: _links, ...draft } = note;
    await vault.create({ ...draft, id });
    written++;
  }
  return written;
}
