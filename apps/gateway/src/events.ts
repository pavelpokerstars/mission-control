/**
 * The event log + echo suppression.
 *
 * The failure mode this file exists to prevent:
 *
 *   1. User drags a card on the Miro board.
 *   2. Miro webhook → we update Jira.
 *   3. Jira webhook fires → we update the Miro card.
 *   4. Miro webhook fires → we update Jira.
 *   5. ... forever, until someone's rate limit or someone's sprint dies.
 *
 * The fix is boring and non-negotiable: every write we make is stamped with the
 * id of the event that caused it, and we drop any inbound event carrying a
 * stamp we recognise. Put this in on day 1. Retrofitting it at 2am on day 6 is
 * how hackathon projects fail.
 */

import { randomUUID } from 'node:crypto';
import type { McEvent } from '@mc/domain';

const LOG_LIMIT = 5_000;
/** How long a write we made stays "ours" for echo purposes. */
const ECHO_TTL_MS = 60_000;

export class EventLog {
  private events: McEvent[] = [];
  private subscribers = new Set<(e: McEvent) => void>();

  /** Correlation ids we stamped onto outbound writes, with their expiry. */
  private ourWrites = new Map<string, number>();

  /**
   * Call this immediately before writing to a third-party tool. Attach the
   * returned token to the write (Miro app-card metadata, a Jira property, a
   * Slack message's metadata) so the resulting webhook carries it back.
   *
   * NOT WIRED TODAY. No connector method takes a token, so every caller either
   * discards this return or hands it back to its own caller in a tool result
   * that never reaches the vendor — and inbound, `webhooks.ts` reads an
   * `mc_correlation` property nothing in this tree sets. So `isEcho` cannot
   * match anything. Nothing loops only because the reverse handlers are no-ops
   * and Miro is the one surface with a live client. Attaching it starts with
   * adding the parameter to the connector method, not here.
   */
  markOutbound(causedBy: string): string {
    const token = `mc:${causedBy}:${randomUUID().slice(0, 8)}`;
    this.ourWrites.set(token, Date.now() + ECHO_TTL_MS);
    return token;
  }

  /** True if this inbound event is the echo of a write we just made. */
  isEcho(token?: string): boolean {
    if (!token) return false;
    const expiry = this.ourWrites.get(token);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.ourWrites.delete(token);
      return false;
    }
    return true;
  }

  append(event: McEvent): McEvent | undefined {
    if (this.isEcho(event.causedBy)) return undefined;
    this.events.unshift(event);
    if (this.events.length > LOG_LIMIT) this.events.length = LOG_LIMIT;
    for (const fn of this.subscribers) fn(event);
    return event;
  }

  forEntity(key: string, n = 50): McEvent[] {
    return this.events.filter((e) => e.entityKey === key).slice(0, n);
  }

  subscribe(fn: (e: McEvent) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  /** Periodic cleanup of expired echo tokens. */
  sweep(): void {
    const now = Date.now();
    for (const [token, expiry] of this.ourWrites) {
      if (now > expiry) this.ourWrites.delete(token);
    }
  }
}

export const eventLog = new EventLog();
setInterval(() => eventLog.sweep(), 30_000).unref?.();
