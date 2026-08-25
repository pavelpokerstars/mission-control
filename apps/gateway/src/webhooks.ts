/**
 * Inbound webhooks — how the outside world tells us something changed.
 *
 * Each handler does the same three things:
 *   1. verify the caller,
 *   2. normalise the vendor payload into an McEvent,
 *   3. append it to the log (which drops it if it is our own echo).
 *
 * Nothing here calls another tool directly. Reactions live in sync.ts and are
 * driven off the log, so the fan-out logic has exactly one home.
 */

import type { Request, Response, Router } from 'express';
import express from 'express';
import { extractKeys, newEvent, type McEvent } from '@mc/domain';
import { eventLog } from './events.js';

/** `capture` from memory.ts, injected so this file stays free of vault imports. */
type SlashCapture = (input: {
  text: string;
  author?: string;
  channelId?: string;
  channelName?: string;
}) => Promise<unknown>;

function authorized(req: Request): boolean {
  const secret = process.env.MC_WEBHOOK_SECRET;
  if (!secret) return true; // dev convenience only
  return req.get('x-mc-secret') === secret;
}

export function webhookRouter(capture: SlashCapture): Router {
  const r = express.Router();

  /**
   * Slack slash commands — `/mc remember dana said the cache is temporary`.
   *
   * Zero-friction capture is the whole point: the thought is worth keeping at
   * the moment it is had, in the window it was had in, and any workflow that
   * requires opening another app to record it will simply not happen. Slack
   * posts these as form-encoded, not JSON, hence the extra parser below.
   *
   * Same 3-second budget as the Events API: reply immediately with something
   * the user sees, then do the work.
   */
  r.post('/slack/commands', express.urlencoded({ extended: true }), (req: Request, res: Response) => {
    const body = req.body as {
      text?: string;
      user_name?: string;
      channel_id?: string;
      channel_name?: string;
    };
    const text = (body.text ?? '').trim();
    if (!text) {
      return res.json({ response_type: 'ephemeral', text: 'Nothing to remember. Try `/mc remember …`' });
    }

    res.json({ response_type: 'ephemeral', text: `Captured. Filing it in the vault…` });

    eventLog.append(
      newEvent({
        source: 'slack',
        type: 'chat.command_received',
        entityKey: extractKeys(text)[0],
        actor: body.user_name,
        payload: { text, channel: body.channel_id },
      }),
    );

    void capture({
      text,
      author: body.user_name,
      channelId: body.channel_id,
      channelName: body.channel_name,
    }).catch((err: unknown) => console.warn(`[capture] ${String(err)}`));
    return undefined;
  });

  /**
   * Jira: configure at Settings → System → Webhooks for
   * jira:issue_created / jira:issue_updated.
   */
  r.post('/jira', (req: Request, res: Response) => {
    if (!authorized(req)) return res.status(401).end();
    const body = req.body as {
      webhookEvent?: string;
      issue?: { key?: string; fields?: Record<string, unknown> };
      changelog?: { items?: { field?: string; fromString?: string; toString?: string }[] };
      user?: { displayName?: string };
    };

    const key = body.issue?.key;
    const statusChange = body.changelog?.items?.find((i) => i.field === 'status');

    const event: McEvent = newEvent({
      source: 'jira',
      type: statusChange
        ? 'workitem.status_changed'
        : body.webhookEvent === 'jira:issue_created'
          ? 'workitem.created'
          : 'workitem.updated',
      entityKey: key,
      actor: body.user?.displayName,
      payload: statusChange
        ? { from: statusChange.fromString, to: statusChange.toString }
        : (body.issue?.fields ?? {}),
      // Jira echoes back a property we set on write; see sync.ts.
      causedBy: (body.issue?.fields?.['mc_correlation'] as string | undefined) ?? undefined,
    });

    const accepted = eventLog.append(event);
    return res.json({ ok: true, accepted: !!accepted });
  });

  /**
   * Confluence: configure at Settings → General → Webhooks for
   * page_created / page_updated.
   *
   * The flow table has promised this row since day one and nothing implemented
   * it. It matters more than it looks: a note citing an ADR has no way to know
   * the ADR was rewritten under it, and `sync.ts` turns this event into a
   * re-verification proposal for exactly those notes.
   */
  r.post('/confluence', (req: Request, res: Response) => {
    if (!authorized(req)) return res.status(401).end();

    const body = req.body as {
      webhookEvent?: string;
      page?: { id?: string | number; title?: string; spaceKey?: string; version?: { number?: number } };
      userAccountId?: string;
    };
    const page = body.page;
    if (!page?.id) return res.json({ ok: true, accepted: false });

    // A first version is a publish; anything after it is an edit. Confluence
    // sends both through the same shape, and the distinction is the whole
    // point — nobody needs re-verifying because a page was created.
    const created = body.webhookEvent === 'page_created' || (page.version?.number ?? 1) <= 1;

    const accepted = eventLog.append(
      newEvent({
        source: 'confluence',
        type: created ? 'doc.published' : 'doc.updated',
        entityKey: extractKeys(page.title ?? '')[0],
        actor: body.userAccountId,
        payload: { pageId: String(page.id), title: page.title, space: page.spaceKey },
      }),
    );
    return res.json({ ok: true, accepted: !!accepted });
  });

  /**
   * Miro: subscribe with the boards webhook API. Fires on item create/update/
   * delete. Note it does NOT cover connectors, tags or comments — for the
   * dependency arrows you must poll listConnectors() or read them from the
   * Web SDK inside the board app.
   */
  r.post('/miro', (req: Request, res: Response) => {
    if (!authorized(req)) return res.status(401).end();

    // Miro sends a one-time challenge on subscription.
    const challenge = (req.body as { challenge?: string }).challenge;
    if (challenge) return res.json({ challenge });

    const body = req.body as {
      event?: { type?: string; item?: { id?: string; type?: string; data?: Record<string, unknown> } };
    };
    const item = body.event?.item;
    const fields = (item?.data?.fields as { value?: string }[] | undefined) ?? [];
    const key = extractKeys(JSON.stringify(item?.data ?? {}))[0];

    const event: McEvent = newEvent({
      source: 'miro',
      type: body.event?.type === 'create' ? 'canvas.card_created' : 'canvas.card_moved',
      entityKey: key,
      payload: { miroItemId: item?.id, itemType: item?.type, fields },
      causedBy: (item?.data?.['mc_correlation'] as string | undefined) ?? undefined,
    });

    const accepted = eventLog.append(event);
    return res.json({ ok: true, accepted: !!accepted });
  });

  /**
   * Zoom: subscribe to recording.transcript_completed. Transcripts take roughly
   * 15–30 minutes to appear after a call, and the account setting must be
   * enabled BEFORE the meeting — this bites every team that tries it on demo
   * day. Record your fixture meetings in week zero.
   */
  r.post('/zoom', (req: Request, res: Response) => {
    if (!authorized(req)) return res.status(401).end();

    // Zoom's endpoint validation handshake.
    const body = req.body as {
      event?: string;
      plainToken?: string;
      payload?: { object?: { uuid?: string; topic?: string; recording_files?: unknown[] } };
    };
    if (body.event === 'endpoint.url_validation') {
      return res.json({ plainToken: body.plainToken, encryptedToken: body.plainToken });
    }

    const obj = body.payload?.object;
    const event: McEvent = newEvent({
      source: 'zoom',
      type: 'meeting.transcript_ready',
      payload: { recordingId: obj?.uuid, meetingTopic: obj?.topic },
    });
    eventLog.append(event);
    return res.json({ ok: true });
  });

  /**
   * Slack Events API. Remember the 3-second ack budget: acknowledge first,
   * process after.
   */
  r.post('/slack', (req: Request, res: Response) => {
    const body = req.body as {
      type?: string;
      challenge?: string;
      event?: { text?: string; user?: string; channel?: string; ts?: string; bot_id?: string };
    };
    if (body.type === 'url_verification') return res.send(body.challenge);

    res.json({ ok: true }); // ack immediately

    const e = body.event;
    if (!e?.text || e.bot_id) return; // ignore our own posts

    eventLog.append(
      newEvent({
        source: 'slack',
        type: 'chat.message_posted',
        entityKey: extractKeys(e.text)[0],
        actor: e.user,
        payload: { text: e.text, channel: e.channel, ts: e.ts },
      }),
    );
  });

  return r;
}
