/**
 * The sync layer — the only place that fans one change out to other tools.
 *
 * Everything reacts to the event log. Nothing reacts to a webhook directly.
 * That means there is exactly one file to read when you are debugging "why did
 * that update to Jira happen", which at 2am on day 5 is worth a great deal.
 *
 * The rules encoded here:
 *   - Jira status change  → refresh the Miro app card, notify Slack.
 *   - Miro card edit      → propose a Jira update (never write silently).
 *   - Transcript ready    → generate proposals, post a digest to Slack.
 *   - Every outbound write mints an echo token. None of them carries it yet —
 *     see `markOutbound` in `events.ts` for what is missing and why.
 */

import type { Connectors } from '@mc/connectors';
import { newEvent, type McEvent, type WorkItemStatus } from '@mc/domain';
import type { VaultStore } from '@mc/vault';
import { eventLog } from './events.js';
import { APP_URL } from './notify.js';
import { surfaceMemory } from './memory.js';
import { propose } from './tools.js';

export function startSync(c: Connectors, vault: VaultStore): () => void {
  return eventLog.subscribe((e) => {
    void react(c, vault, e).catch((err) => {
      eventLog.append(
        newEvent({
          source: 'mc',
          type: 'mc.sync_failed',
          entityKey: e.entityKey,
          payload: { cause: e.id, error: String(err) },
        }),
      );
    });
  });
}

async function react(c: Connectors, vault: VaultStore, e: McEvent): Promise<void> {
  switch (e.type) {
    // -----------------------------------------------------------------------
    // Jira changed → the canvas and the team should both find out.
    // -----------------------------------------------------------------------
    case 'workitem.status_changed':
    case 'workitem.updated':
    case 'workitem.created': {
      if (!e.entityKey) return;
      const item = await c.jira.getItem(e.entityKey);
      if (!item) return;

      const token = eventLog.markOutbound(e.id);
      const boardId = process.env.MIRO_BOARD_ID ?? 'demo-board';
      await c.miro.upsertAppCard(boardId, item);

      // Only interrupt humans for things humans care about.
      const worthAnnouncing =
        e.type === 'workitem.status_changed' &&
        (item.status === 'blocked' || item.status === 'done');

      if (worthAnnouncing) {
        const channel = process.env.SLACK_DEFAULT_CHANNEL ?? 'C-mc';
        const verb = item.status === 'blocked' ? 'is now BLOCKED' : 'is done';
        await c.slack.post(channel, `${item.key} "${item.title}" ${verb} — updated by ${e.actor ?? 'someone'}.`);
      }

      // The vault gets a chance to speak. It usually declines: only two
      // transitions qualify, only some notes are worth interrupting a human
      // for, and it never repeats itself. See memory.ts.
      if (e.type === 'workitem.status_changed') {
        await surfaceMemory(c, vault, {
          key: item.key,
          status: (e.payload as { to?: WorkItemStatus }).to ?? item.status,
          causedBy: e.id,
        });
      }

      void token;
      return;
    }

    // -----------------------------------------------------------------------
    // Canvas changed. Position is Miro's to own, so we ignore pure moves.
    // A field edit is a *proposal* against Jira, not a write.
    // -----------------------------------------------------------------------
    case 'canvas.card_moved':
      return; // Miro owns position. Nothing to propagate.

    case 'canvas.connector_created': {
      const p = e.payload as { fromKey?: string; toKey?: string };
      if (!p.fromKey || !p.toKey) return;
      // A drawn arrow is unambiguous intent, so this one we do apply.
      eventLog.markOutbound(e.id);
      await c.jira.linkItems(p.fromKey, p.toKey, 'Blocks');
      // Record that we did. The write happened here and nothing else said so,
      // which made "why does Jira think MC-103 blocks MC-102" unanswerable from
      // the log — the one thing the log exists to answer.
      //
      // `causedBy` is the *triggering event*, never the outbound token. The
      // token exists so the vendor's webhook echo gets dropped on the way back
      // in; putting it on our own record makes `append` suppress it as an echo
      // of itself, which is exactly what happened the first time this was
      // written.
      eventLog.append(
        newEvent({
          source: 'jira',
          type: 'workitem.linked',
          entityKey: p.fromKey,
          payload: { from: p.fromKey, to: p.toKey, type: 'Blocks', drawnOn: 'miro' },
          causedBy: e.id,
        }),
      );
      return;
    }

    // -----------------------------------------------------------------------
    // A page changed under a note that cites it.
    //
    // The vault's decay model handles claims going stale by *age*. This is the
    // other way they go stale: the source moved. A note citing ADR-014 is not
    // wrong because time passed, it is wrong because somebody rewrote ADR-014.
    // -----------------------------------------------------------------------
    case 'doc.updated': {
      const p = e.payload as { pageId?: string; title?: string };
      if (!p.pageId && !p.title) return;

      const citing = vault.list().filter((n) =>
        n.evidence.some(
          (ev) =>
            ev.surface === 'confluence' &&
            ((p.title && ev.label.includes(p.title)) || (p.pageId && ev.url?.includes(p.pageId))),
        ),
      );

      for (const note of citing) {
        propose(
          'reverify_note',
          `"${p.title ?? 'A Confluence page'}" changed, and [[${note.id}]] cites it as evidence. ` +
            'The note may now be describing a decision that no longer says what it did.',
          [
            { surface: 'confluence', label: p.title ?? String(p.pageId) },
            { surface: 'vault', label: `[[${note.id}]] ${note.kind}: ${note.title}` },
          ],
          { noteId: note.id, title: `Re-verify: ${note.title}`, relatedKeys: note.relatedKeys },
          // One pending ask per note per page, however often the page is edited.
          { dedupeKey: `${note.id}:${p.pageId ?? p.title}` },
        );
      }
      return;
    }

    // -----------------------------------------------------------------------
    // A meeting finished. This is the flow that makes the demo.
    // -----------------------------------------------------------------------
    case 'meeting.transcript_ready': {
      const p = e.payload as { recordingId?: string; meetingTopic?: string };
      if (!p.recordingId) return;
      const channel = process.env.SLACK_DEFAULT_CHANNEL ?? 'C-mc';
      eventLog.markOutbound(e.id);
      await c.slack.post(
        channel,
        // A POINTER, NEVER A QUOTE — the same rule notify.ts keeps, and the
        // reason this says where to look rather than what was found.
        `Transcript ready for "${p.meetingTopic ?? 'meeting'}". ` +
          `Open Mission Control to see what it found: ${APP_URL}`,
      );
      return;
    }

    default:
      return;
  }
}
