/**
 * Watching the canvas for new arrows.
 *
 * Miro's board webhooks fire on item create/update/delete and **do not cover
 * connectors** — the one thing on the board we most need to hear about, since
 * an arrow between two app cards is a human stating a dependency. That is not
 * an oversight we can work around with a different subscription; the only ways
 * to see a new connector are to poll `listConnectors` or to run a Web SDK app
 * inside the board itself.
 *
 * So: poll. It closes the gap that made demo flow #2 half-wired — `sync.ts` has
 * reacted to `canvas.connector_created` since the beginning by writing a Jira
 * issue link, and until now nothing at runtime ever emitted one. The arrows in
 * the fixture came from the seeder, backdated.
 *
 * Two properties worth keeping:
 *
 *   THE FIRST PASS IS A BASELINE, NOT NEWS. A board that already has forty
 *   arrows must not produce forty "dependency drawn" events on boot, each of
 *   which would write a Jira link.
 *
 *   IT ONLY REPORTS ADDITIONS. A removed arrow is not a removed dependency —
 *   somebody may be mid-rearrangement — and unlinking Jira issues because a
 *   line was briefly deleted is exactly the kind of destructive helpfulness
 *   that gets an integration switched off.
 *
 * THE BASELINE IS ON DISK, and that is what makes the first property survivable.
 * Held only in memory, "the first pass is a baseline" meant every restart
 * re-baselined: an arrow drawn while the gateway was down was absorbed into the
 * new baseline and never produced a Jira link. The gap was invisible — no error,
 * no missing event, just a dependency the team drew and the system never saw.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { newEvent } from '@mc/domain';
import type { Connectors } from '@mc/connectors';
import { eventLog } from './events.js';
import { VAULT_DIR } from './vault.js';

const DEFAULT_INTERVAL_MS = 30_000;

/** Next to the other machine-generated state, and gitignored with it. */
const BASELINE_FILE = join(VAULT_DIR, 'raw', 'canvas-baseline.json');

/**
 * How old a saved baseline may be and still count as news.
 *
 * Persisting exists to survive a restart — minutes, or a night. A baseline from
 * three months ago means the poller has not run in three months, and treating
 * every arrow drawn since as *new* would fan out hundreds of Jira links in one
 * tick. That is the same destructive helpfulness the additions-only rule above
 * exists to avoid, so past this age we re-baseline and say so.
 */
const BASELINE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Baseline {
  /** Which board these ids came from — another board must not inherit them. */
  boardId: string;
  at: string;
  ids: string[];
}

async function loadBaseline(boardId: string): Promise<Set<string> | undefined> {
  try {
    const saved = JSON.parse(await readFile(BASELINE_FILE, 'utf8')) as Baseline;
    if (saved.boardId !== boardId) {
      console.log(`[canvas] saved baseline is for ${saved.boardId}, not ${boardId} — re-baselining`);
      return undefined;
    }
    const age = Date.now() - Date.parse(saved.at);
    if (!Number.isFinite(age) || age > BASELINE_MAX_AGE_MS) {
      console.log(
        `[canvas] saved baseline is ${Math.round(age / 3_600_000)}h old — re-baselining rather ` +
          'than reporting every arrow drawn since as new',
      );
      return undefined;
    }
    console.log(
      `[canvas] resuming from a baseline of ${saved.ids.length} arrows — anything drawn while ` +
        'the gateway was down will be reported',
    );
    return new Set(saved.ids);
  } catch {
    // No file, or an unreadable one. Either way the next pass is a baseline,
    // which is the same behaviour this had before it persisted anything.
    return undefined;
  }
}

async function saveBaseline(boardId: string, ids: Set<string>): Promise<void> {
  try {
    await mkdir(dirname(BASELINE_FILE), { recursive: true });
    const body: Baseline = { boardId, at: new Date().toISOString(), ids: [...ids] };
    await writeFile(BASELINE_FILE, JSON.stringify(body), 'utf8');
  } catch (err) {
    // Losing the file costs one restart's worth of arrows, not the poller.
    console.warn(`[canvas] could not save baseline: ${String(err)}`);
  }
}

export function startCanvasPoll(c: Connectors): () => void {
  const interval = Number(process.env.MC_CANVAS_POLL_MS ?? DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(interval) || interval <= 0) {
    console.log('[canvas] poll off (MC_CANVAS_POLL_MS=0)');
    return () => undefined;
  }

  const boardId = process.env.MIRO_BOARD_ID ?? 'demo-board';
  let seen: Set<string> | undefined;
  // One load, before the first tick. `tick` awaits it rather than racing it, so
  // the first pass after a restart diffs against disk instead of re-baselining.
  const restoring = loadBaseline(boardId).then((s) => {
    seen = s;
  });

  const tick = async (): Promise<void> => {
    try {
      await restoring;
      const connectors = await c.miro.listConnectors(boardId);
      const ids = new Set(connectors.map((x) => x.id));

      if (!seen) {
        seen = ids;
        await saveBaseline(boardId, ids);
        return;
      }

      for (const arrow of connectors) {
        if (seen.has(arrow.id)) continue;
        eventLog.append(
          newEvent({
            source: 'miro',
            type: 'canvas.connector_created',
            entityKey: arrow.toKey,
            payload: {
              connectorId: arrow.id,
              fromKey: arrow.fromKey,
              toKey: arrow.toKey,
              semantic: arrow.semantic,
              boardId,
            },
          }),
        );
      }

      // Only when it actually moved — an unchanged board is the common case and
      // does not need a write every thirty seconds.
      const changed = ids.size !== seen.size || [...ids].some((id) => !seen?.has(id));
      seen = ids;
      if (changed) await saveBaseline(boardId, ids);
    } catch (err) {
      // A board we cannot read is not a reason to take the gateway down, and
      // the next tick is thirty seconds away.
      console.warn(`[canvas] poll failed: ${String(err)}`);
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), interval);
  console.log(`[canvas] polling ${boardId} for new arrows every ${Math.round(interval / 1000)}s`);
  return () => clearInterval(timer);
}
