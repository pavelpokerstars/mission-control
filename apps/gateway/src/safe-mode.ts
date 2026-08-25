/**
 * Safe mode — Mission Control may read every source and write to none of them.
 *
 * ON BY DEFAULT, and that is the point. Everything else here is arranged so a
 * mistake is cheap: the model cannot reach `accept_proposal` (`HUMAN_ONLY`),
 * only one surface may own each field (`FIELD_OWNER`), and a proposal sits
 * pending until somebody presses a button. All of that still leaves a human one
 * mis-click from creating a real ticket on a real board. This is the switch
 * that says the whole instance is read-only, and it has to be the default
 * because the failure it prevents is irreversible and the cost of it being on
 * is a message telling you to turn it off.
 *
 * WHAT IT BLOCKS: every mutating call on a vendor connector, and the outbound
 * Slack notification. That is the complete set — the guard wraps the
 * `Connectors` object itself rather than each call site, so a new writer added
 * later is covered without anybody remembering to cover it. Same argument as
 * `HUMAN_ONLY` being a filter on the shared tool seam rather than a line in a
 * prompt.
 *
 * WHAT IT DOES NOT BLOCK: the vault, the event log, and proposals. Those are
 * ours — the vault is the only store this product owns, nothing outside can see
 * it, and blocking it would stop the app working rather than stop it doing
 * damage. A proposal is a *record of an intention*; it writes nothing outward
 * until accepted, and accepting is what safe mode refuses.
 *
 * SO A PROPOSAL STILL BUILDS AND STILL SHOWS ITS EVIDENCE. You can read exactly
 * what would have happened, which is the useful half, and the write is what
 * fails.
 */

import type { Connectors } from '@mc/connectors';

/**
 * Read at call time, not at module scope.
 *
 * Same lesson `MC_STRUCTURED` and `anthropicBaseUrl` both record: captured at
 * import, a test or a script that sets it per case silently gets whichever
 * value was current when the module first loaded.
 */
export function safeMode(): boolean {
  const raw = (process.env.MC_SAFE_MODE ?? '').trim().toLowerCase();
  // Unset means ON. Only an explicit, unambiguous "off" turns it off — a typo
  // must fail safe, because the whole value of this is that it cannot be
  // switched off by accident.
  return !['off', 'false', '0', 'no'].includes(raw);
}

export class BlockedBySafeMode extends Error {
  constructor(what: string) {
    super(
      `Blocked by safe mode: ${what}. ` +
        'Mission Control is running read-only. Nothing was written to the source. ' +
        'Set MC_SAFE_MODE=off in .env and restart the gateway to allow writes.',
    );
    this.name = 'BlockedBySafeMode';
  }
}

/** Everything on a connector that changes something in somebody else's tool. */
const WRITES: Record<keyof Connectors, string[]> = {
  jira: ['createItem', 'updateItem', 'linkItems', 'comment'],
  miro: ['upsertAppCard', 'exportSnapshot'],
  confluence: ['publish'],
  slack: ['post'],
  // Read-only by construction; listed so the map is the complete surface and a
  // reader can see that it was considered rather than forgotten.
  zoom: [],
};

/**
 * Wrap the connectors so every write refuses.
 *
 * It throws rather than returning a no-op success. A silent no-op is the worse
 * failure by some distance: `accept_proposal` would report "MC-112 created",
 * the commitment would gain a key that points at nothing, and the alert would
 * stop firing about a ticket that does not exist.
 */
export function guardConnectors(c: Connectors): Connectors {
  if (!safeMode()) return c;

  const out: Record<string, unknown> = {};
  for (const surface of Object.keys(WRITES) as (keyof Connectors)[]) {
    const original = c[surface] as unknown as Record<string, unknown>;
    const guarded: Record<string, unknown> = {};
    // Own AND inherited: a connector may be an object literal or a class.
    for (const key in original) {
      const value = original[key];
      guarded[key] =
        typeof value === 'function' && WRITES[surface].includes(key)
          ? () => Promise.reject(new BlockedBySafeMode(`${surface}.${key}()`))
          : typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(original)
            : value;
    }
    out[surface] = guarded;
  }
  return out as unknown as Connectors;
}

/** For an outbound write that is not a connector call — the Slack webhook. */
export function refuseIfSafe(what: string): void {
  if (safeMode()) throw new BlockedBySafeMode(what);
}

/** One line at boot, because a mode nobody is told about is a mode that surprises. */
export function describeSafeMode(): string {
  return safeMode()
    ? 'safe mode ON — every source is read-only. MC_SAFE_MODE=off to allow writes.'
    : 'safe mode OFF — accepted proposals will write to Jira, Miro, Confluence and Slack.';
}
