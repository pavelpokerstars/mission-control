/**
 * Vault wiring for the gateway.
 *
 * Two jobs:
 *
 *  1. Open the store, and mirror the in-memory event log to disk. `EventLog`
 *     keeps 5,000 events and loses them on restart, which is right for echo
 *     suppression and wrong for history. The JSONL mirror is what the dossier's
 *     trail reads, and what consolidation will read later.
 *
 *  2. Turn accepted/rejected proposals into notes. The decision journal is the
 *     cheapest high-value thing in here: at the moment of rejection we know
 *     exactly why, and six weeks later nobody does.
 */

import { join } from 'node:path';
import { newEvent, type McEvent, type Note, type Proposal } from '@mc/domain';
import { openVault, type VaultStore } from '@mc/vault';
import { eventLog } from './events.js';

export const VAULT_DIR = process.env.MC_VAULT_DIR ?? join(process.cwd(), 'vault');

/**
 * Events worth keeping forever. The canvas fires a `card_moved` every time a
 * sticky is nudged; persisting those would bury the log in noise and teach the
 * scrum master to ignore it.
 *
 * `canvas.frame_changed` used to sit alongside `card_moved` here and in
 * `McEventType`, and nothing ever emitted it — Miro's webhooks fire on item
 * create/update/delete only, so a frame edit never reaches us to be discarded.
 * A filter entry for an event that cannot arrive reads as coverage the log does
 * not have. Add both back together if frame webhooks ever land.
 */
const EPHEMERAL: ReadonlySet<string> = new Set(['canvas.card_moved']);

export async function startVault(): Promise<VaultStore> {
  const vault = await openVault(VAULT_DIR);

  eventLog.subscribe((e) => {
    if (EPHEMERAL.has(e.type)) return;
    void vault.appendEvent(e);
  });

  console.log(`[vault] ${VAULT_DIR} — ${vault.list().length} notes`);
  return vault;
}

/** Emit + persist in one call, so vault mutations reach the durable log. */
export function emitVaultEvent(
  type: McEvent['type'],
  note: Note,
  extra: Record<string, unknown> = {},
): void {
  eventLog.append(
    newEvent({
      source: 'vault',
      type,
      entityKey: note.relatedKeys[0],
      payload: { id: note.id, title: note.title, kind: note.kind, ...extra },
    }),
  );
}

/**
 * The decision journal. Called on every accept and every reject.
 *
 * Rejections matter more than acceptances here: an accepted proposal leaves a
 * trail in Jira, a rejected one currently leaves nothing at all.
 */
export async function journalProposal(
  vault: VaultStore,
  proposal: Proposal,
  outcome: 'accepted' | 'rejected',
  reason?: string,
): Promise<Note> {
  const payload = proposal.payload as { title?: string } | undefined;
  const subject = payload?.title ?? proposal.kind;

  const body = [
    `**${outcome}** — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Proposal (\`${proposal.kind}\`): ${subject}`,
    '',
    `The agent's reasoning: ${proposal.rationale}`,
    '',
    reason ? `Why I ${outcome} it: ${reason}` : `_No reason recorded. Add one while you still remember._`,
  ].join('\n');

  const note = await vault.create({
    kind: 'decision',
    title: `${outcome === 'accepted' ? 'Accepted' : 'Rejected'}: ${subject}`.slice(0, 90),
    // A decision is timeless: it records what was chosen at a moment, and that
    // never stops being true, however much the surrounding facts move.
    recency: 'timeless',
    status: 'resolved',
    relatedKeys: (payload as { relatedKeys?: string[] } | undefined)?.relatedKeys ?? [],
    evidence: proposal.evidence,
    body,
  });

  emitVaultEvent('note.created', note, { from: 'proposal', outcome });
  return note;
}
