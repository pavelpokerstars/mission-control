/**
 * Getting an alert to somebody who did not go looking for it.
 *
 * `DIRECTION.md` §3: "The product's front door is a message you did not go
 * looking for." Everything else in this system works when somebody opens the
 * app; this is the half that means they do not have to.
 *
 * A NOTIFICATION CARRIES A POINTER, NEVER A QUOTE. That is a constraint rather
 * than a style choice: meeting transcripts and the claims read out of them do
 * not leave the machine holding them, so a notification that includes the
 * evidence has moved the evidence. It carries what fired, how bad, and a link.
 * The quote lives on the alert page, behind the boundary.
 *
 * It also happens to make every transport safe. A hosted chat carrying a real
 * citation is ruled out by the constraint; a hosted chat carrying "MC-9031: two
 * sources disagree → open it" is not.
 *
 * THE REVIEW INBOX IS THE DEFAULT AND IT ALWAYS WORKS, because the alert list
 * already is one. Anything else — a relay, a mail, a bot — is a second transport
 * behind this interface, and none of them is on the critical path.
 */

import { isAlertKind, newEvent, type Finding } from '@mc/domain';
import { eventLog } from './events.js';

export interface Notification {
  findingId: string;
  severity: Finding['severity'];
  /** One line. What fired, in the words a person would use. */
  headline: string;
  /** Why it matters, in a sentence or two. OUR words, never a record's. */
  detail: string;
  /** When the detector first saw it — not when the pass ran. */
  firedAt: string;
  /** Where to read it. A deep link into the alert, and nothing else. */
  url: string;
}

/**
 * One run's worth of news.
 *
 * `fresh` is what has not been announced before and is never empty — a run with
 * nothing new sends nothing at all. `total` is everything the front door counts,
 * and it is here so that a message and the app cannot state different numbers:
 * saying "3 things need you" beside a list headed "6 things need you" is the
 * same defect as an agent naming a different worst than the screen.
 */
export interface Digest {
  fresh: Notification[];
  total: number;
}

export interface Transport {
  name: string;
  send(n: Notification): Promise<void>;
  /**
   * One message for the whole run, when that is the right shape.
   *
   * The preview's Slack message is not a per-finding ping and not a digest
   * either: a count, ONE claim, one button — *"everything that would make this
   * a digest was left out on purpose"*. A chat channel is a shared room and
   * three pings at 07:00 is how a channel gets muted, which costs every future
   * `crit`. Transports that have no such pressure — the review inbox, which is
   * a list — implement `send` and leave this alone.
   */
  sendDigest?(d: Digest): Promise<void>;
}

/**
 * Where the app is, for the link.
 *
 * A notification whose link does not resolve is worse than no notification — it
 * is an interruption that cannot be acted on, which is precisely what this is
 * supposed to replace.
 */
/**
 * Exported so `/api/health` reports the URL a notification WILL carry, rather
 * than re-deriving `process.env.MC_APP_URL ?? …` beside it. Two defaults for one
 * fact is how the two drift, and health's whole job here is to state what is
 * actually true of this instance.
 */
export const APP_URL = process.env.MC_APP_URL ?? 'http://localhost:4200';

export function notificationFor(f: Finding): Notification {
  return {
    findingId: f.id,
    severity: f.severity,
    headline: f.claim,
    /**
     * `impact` and never `evidence`. The first is the detector's own sentence
     * about why this matters; the second is what somebody said in a meeting.
     * Only one of them may leave this machine.
     */
    detail: f.impact,
    firedAt: f.firedAt,
    url: `${APP_URL}/#/alert/${encodeURIComponent(f.id)}`,
  };
}

/**
 * The transport that needs nothing installed.
 *
 * It writes to the durable log, which is what the review inbox reads — so
 * "notified" is a fact with a timestamp rather than a hope about a third party,
 * and `alreadyNotified` can ask the same log whether this has gone out before.
 */
export const reviewInbox: Transport = {
  name: 'review-inbox',
  async send(n) {
    eventLog.append(
      newEvent({
        source: 'mc',
        type: 'mc.memory_surfaced',
        payload: { notified: n.findingId, severity: n.severity, headline: n.headline, url: n.url },
      }),
    );
  },
};

/**
 * The Slack bot — `DIRECTION.md` §2, under **Settled**.
 *
 * "Notifications via a Slack bot on our own server. The company Slack cannot be
 * posted to." So this is a workspace we control, and the message is the one
 * `design-preview.html` draws at `#scr-slack`: a greeting with the count, ONE
 * claim in an attachment, and a button that opens the app.
 *
 * AN INCOMING WEBHOOK, NOT A BOT TOKEN, and the reason is worth stating because
 * it decides what this depends on. The button is a **link** — Block Kit's `url`
 * button — so nothing is ever posted back to us. An interactive Slack app needs
 * a public HTTPS request URL, which needs somewhere to host it, which is **D4**
 * and undecided. A link button needs none of that: one env var, an outbound
 * POST, and no inbound anything. The design does not ask for more — the button
 * says "Open Mission Control", not "Dismiss".
 *
 * It carries the count, the claim and the `impact`, and never a citation. See
 * the module header: a notification containing the evidence has moved the
 * evidence off the machine that holds it, and that is the constraint that makes
 * a hosted chat tolerable at all.
 *
 * Absent `MC_SLACK_WEBHOOK_URL` this transport does not exist and the review
 * inbox runs alone — additive, never a broken box, exactly like every other
 * provider here.
 */
const SLACK_WEBHOOK = process.env.MC_SLACK_WEBHOOK_URL;

/** "one of them since 8 July", when the oldest is old enough to be worth saying. */
function sinceLine(oldest: string): string {
  const days = Math.floor((Date.now() - Date.parse(oldest)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return '';
  const when = new Date(oldest).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  return ` — one of them since ${when}`;
}

export function slackBlocks(d: Digest): unknown[] {
  // Worst first, then oldest: the lead is the one to open, and among equals the
  // one that has been ignored longest. `rankFindings` already ordered `fresh`,
  // so this only has to not disturb it.
  const lead = d.fresh[0]!;
  const oldest = d.fresh.reduce((a, b) => (a.firedAt <= b.firedAt ? a : b)).firedAt;
  const plural = d.total === 1 ? 'thing needs' : 'things need';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Good morning. *${d.total} ${plural} you*${sinceLine(oldest)}.`,
      },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${lead.headline}*\n${lead.detail}` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open Mission Control' },
          url: lead.url,
          // No `action_id` handler exists and none is needed: a `url` button
          // opens a link and Slack posts nothing back.
          style: lead.severity === 'crit' ? 'danger' : undefined,
        },
      ],
    },
  ];
}

export const slackBot: Transport = {
  name: 'slack',
  /**
   * Per-finding is not this transport's shape, so it defers to the digest of
   * one rather than inventing a second message format that would drift from it.
   */
  async send(n) {
    await slackBot.sendDigest!({ fresh: [n], total: 1 });
  },
  async sendDigest(d) {
    if (!SLACK_WEBHOOK || !d.fresh.length) return;
    const res = await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // `text` is the notification preview on a phone and in the sidebar.
        // Without it Slack shows "This content can't be displayed here".
        text: `${d.total} thing${d.total === 1 ? '' : 's'} need you — ${d.fresh[0]!.headline}`,
        blocks: slackBlocks(d),
      }),
    });
    if (!res.ok) throw new Error(`slack webhook ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
};

/**
 * Everything that will carry this run, inbox first.
 *
 * ORDER IS LOAD-BEARING. The inbox is the one that writes `mc.memory_surfaced`,
 * which is what `notifiedIds` reads, so it must record before anything that can
 * fail — otherwise a webhook outage at 07:00 re-announces the same findings
 * every twelve hours until it comes back.
 */
export function transports(): Transport[] {
  return SLACK_WEBHOOK ? [reviewInbox, slackBot] : [reviewInbox];
}

/**
 * Hand one run to every transport.
 *
 * Lives here rather than inside the scheduler so that "how a run is delivered"
 * sits beside the things that deliver it — and so it can be exercised without a
 * clock. The scheduler decides *when* and *what*; this decides *how*.
 *
 * Returns the transports that failed, so a caller can say so. Nothing throws:
 * the inbox is first and it is the one that records, so a webhook that is down
 * costs the interruption and nothing else. Every finding is still on the front
 * door, and it will not be announced twice when the webhook comes back.
 * Re-announcing forever because a third party is unreachable is the worse
 * failure of the two.
 */
export async function deliver(d: Digest): Promise<string[]> {
  const failed: string[] = [];
  for (const t of transports()) {
    try {
      if (t.sendDigest) await t.sendDigest(d);
      else for (const n of d.fresh) await t.send(n);
    } catch (err) {
      failed.push(t.name);
      console.warn(`[notify] ${t.name} failed:`, err);
    }
  }
  return failed;
}

/**
 * Notify once per finding, ever.
 *
 * Read from the durable log rather than a set in memory, for the reason every
 * other "have we already" in this codebase is: a restart must not re-announce
 * what somebody was already told. `dedupeKey` exists on `Finding` for exactly
 * this, and this is the consumer the roadmap said was waiting for something to
 * do the announcing.
 */
export async function notifiedIds(
  read: (f: { since?: string }) => Promise<{ type: string; payload: unknown }[]>,
): Promise<Set<string>> {
  const events = await read({});
  const out = new Set<string>();
  for (const e of events) {
    if (e.type !== 'mc.memory_surfaced') continue;
    const id = (e.payload as { notified?: string }).notified;
    if (id) out.add(id);
  }
  return out;
}

/**
 * Which findings are worth interrupting somebody about.
 *
 * `ok` never notifies. It is a note in the margin — a link nobody explained, on
 * live work — and a notification about one teaches people to mute the channel,
 * which costs every future `crit`. The front door still shows them.
 */
export function worthSending(f: Finding): boolean {
  /**
   * Coverage never notifies either, for a sharper version of the same reason.
   *
   * `undetected_dependency` and `suspect_link` are one per edge and arrive by
   * the hundred; a morning that opens with two hundred pings is the fastest way
   * to make somebody mute the channel, which costs every future `crit`. They are
   * on Sources, where the question they answer is actually being asked.
   *
   * This also keeps the count honest: the message says "N things need you" and
   * the front door's headline says the same sentence, so both have to be
   * counting the same set.
   */
  return f.severity !== 'ok' && isAlertKind(f.kind);
}
