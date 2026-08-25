/**
 * The scheduler — the ceremonies, without being asked.
 *
 * This is deliberately the smallest file in the gateway, and that is the payoff
 * of having built skills first. "Nightly consolidation" and "morning brief" are
 * not new machinery; they are `/tidy` and `/standup` on a timer. Everything
 * that makes them useful — the gathering, the ranking, the proposals — already
 * exists and is already tested by running them by hand.
 *
 * Three properties it has to have, and the reasons are all the same reason:
 * a background job people cannot trust is worse than no background job.
 *
 *   IT NEVER SURPRISES YOU. Only skills that read and propose. Nothing here
 *   posts to Slack, writes to Jira, or changes a note. `tidy` produces
 *   proposals; a human still presses the button.
 *
 *   IT NEVER DOUBLE-RUNS. "Have we already done today's tidy" is answered from
 *   the durable event log, not from memory, so a restart at 22:05 does not
 *   re-run the 22:00 pass. This is the same reasoning as `surfaceMemory` not
 *   repeating itself. It is also what lets the slot stay open for two hours
 *   after it opens — see `CATCH_UP_HOURS`, and note that widening the window
 *   without that log check would re-fire the ceremony every minute.
 *
 *   IT IS OFF WITH ONE ENV VAR. `MC_SCHEDULER=off`.
 */

import { newEvent } from '@mc/domain';
import type { Connectors, GraphSource } from '@mc/connectors';
import type { VaultStore } from '@mc/vault';
import { eventLog } from './events.js';
import { findSkill } from './skills.js';
import { installGraph, loadGraphSource } from './graph-source.js';
import { runRefresh } from './refresh.js';
import { runFindings } from './findings.js';
import { deliver, notificationFor, notifiedIds, worthSending } from './notify.js';

/**
 * A slot runs a skill OR a job, and the distinction is not cosmetic.
 *
 * A skill gathers and proposes; a job re-derives. Both must obey the same three
 * rules — read-only outward, deduplicated, and "have we already run" answered
 * from the durable log — so they share the slot machinery rather than the job
 * getting its own timer beside it. A second scheduler is a second place for the
 * catch-up window and the double-run guard to drift.
 */
interface JobContext {
  connectors: Connectors;
  vault: VaultStore;
}

interface ScheduledRun {
  /** What the log records, and what `alreadyRan` matches on. */
  name: string;
  /** A skill by name, or a job to call. Exactly one. */
  skill?: string;
  job?: (ctx: JobContext) => Promise<string>;
  /** Local hour, 0–23. */
  hour: number;
  why: string;
}

/**
 * The scrum master's day has two edges worth standing at: before the team
 * starts, and after they stop.
 */
const SCHEDULE: ScheduledRun[] = [
  /**
   * Twice daily, and the hours are the two edges of a working day rather than a
   * round number.
   *
   * Twelve hours of latency is not a compromise for the hero case: a commitment
   * that was never ticketed is a state predicate and is no more true at 09:00
   * than at 21:00. Transitions that announce themselves already have a fast path
   * — the Jira webhook and the thirty-second canvas poll — and both write to the
   * same log this does, which is where the two cadences meet.
   */
  { name: 'refresh', hour: 7, why: 'before the standup reads it', job: refreshJob },
  { name: 'standup', skill: 'standup', hour: 8, why: 'before the team is in the room' },
  { name: 'refresh-pm', hour: 19, why: 'after the day has stopped moving', job: refreshJob },
  { name: 'tidy', skill: 'tidy', hour: 22, why: 'after the day has stopped moving' },
];

/**
 * Re-derive, diff against the last run, append what changed.
 *
 * It reloads the graph from disk rather than using the copy `main.ts` holds:
 * the point of a scheduled re-derive is to notice that a COLLECTOR has written a
 * new file, and a snapshot taken at boot can never notice that.
 */
async function refreshJob({ connectors, vault }: JobContext): Promise<string> {
  // Install it, don't just read it. The cell is what every connector in the
  // process projects through, so this one line is how a collector's new
  // `graph.json` becomes what the whole app answers from — routes included,
  // without a restart. `installGraph` returns its argument so the rest of this
  // run reasons about the exact graph it diffed.
  const source = installGraph(await loadGraphSource());
  const result = await runRefresh(source.graph);

  const summary = result.baseline
    ? `baselined — ${result.why}`
    : result.events
      ? `${result.events} event(s) — +${result.delta!.addedEdges.length}/-${result.delta!.removedEdges.length} edges, ${result.delta!.statusChanges.length} status change(s)`
      : (result.why ?? 'nothing changed');

  /**
   * A baseline run notifies nobody, whatever it found.
   *
   * The first pass sees every finding as new, and on a real programme that is a
   * morning of alerts about a quarter of history. `runRefresh` already refuses
   * to announce a baseline's *diff*; this is the same rule one layer up, and
   * skipping it is how the two halves would disagree.
   */
  if (result.baseline) return summary;

  // The SAME source this run diffed. `connectors` came from boot and is correct
  // now: it projects through the cell that was swapped four lines above.
  const sent = await notify(connectors, vault, source);
  return sent ? `${summary}; notified ${sent}` : summary;
}

/**
 * Send what has not been sent, once each.
 *
 * Deliberately after the re-derive rather than on a timer of its own: a
 * notification is about something that just changed, and asking before the diff
 * would announce yesterday's state every morning.
 */
async function notify(
  connectors: Connectors,
  vault: VaultStore,
  /**
   * The graph the findings are about, and the one `connectors` project.
   *
   * TAKEN AS AN ARGUMENT rather than loaded here, because loading it here is
   * what split a run down the middle: this reloaded the file while `connectors`
   * stayed the boot-built snapshot, so `findMissingTickets` read one graph and
   * `gatherWorkFacts` read another. A finding could then name a ticket the item
   * list it was ranked against did not contain. Both now come from one load in
   * `refreshJob`, which is also the load that produced the diff being announced.
   */
  source: GraphSource,
): Promise<number> {
  const items = await connectors.jira.listItems();
  const findings = await runFindings({ source, vault, items, connectors });

  const already = await notifiedIds((f) => vault.readEvents(f));
  const worth = findings.filter(worthSending);
  const due = worth.filter((f) => !already.has(f.id));
  if (!due.length) return 0;

  /**
   * `total` is everything that needs a person, not just what is new.
   *
   * The message says "N things need you", and the front door's headline says
   * the same sentence — counting only the fresh ones would put a different
   * number in the two places, which is the defect this repo keeps paying for.
   * The *lead* is still the worst of the fresh ones, and a run with nothing
   * fresh sends nothing at all, so this never re-interrupts about old news.
   */
  const digest = { fresh: due.map(notificationFor), total: worth.length };

  await deliver(digest);
  return due.length;
}

/** How often we look at the clock. A minute is plenty for hour-granular runs. */
const TICK_MS = 60_000;

/**
 * How long a missed slot stays catchable, in whole hours after it opened.
 *
 * The slot used to be the scheduled hour and nothing else, so a process that
 * was down from 07:50 to 09:10 simply never ran that day's standup — the most
 * likely hour for a gateway to be restarting is the hour somebody is starting
 * work. Two hours is the width where catching up is still useful: a standup
 * brief at 10:00 is late but worth reading, and one at 20:00 is noise.
 *
 * This is safe to widen only because `alreadyRan` reads the durable log. The
 * window decides when a slot is *eligible*; the log decides whether it is
 * *outstanding*, so a gateway that is up all morning still runs standup once.
 */
const CATCH_UP_HOURS = 2;

function todayAt(hour: number): Date {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Is `run`'s slot open at `now`?
 *
 * Pure, exported and hour-granular so the rule can be checked against a table
 * of clock times instead of by waiting until 08:00. It answers eligibility
 * only — whether the run is still outstanding is `alreadyRan`'s question, and
 * both have to say yes.
 *
 * Deliberately same-day: at 00:30 the previous evening's 22:00 slot is 22 hours
 * behind and reads as negative here, so yesterday's tidy never fires after
 * midnight. The day boundary needs no special case.
 */
export function slotIsOpen(now: Date, run: ScheduledRun): boolean {
  const hoursSince = now.getHours() - run.hour;
  return hoursSince >= 0 && hoursSince <= CATCH_UP_HOURS;
}

/**
 * Has this skill already run on the timer since its slot opened today?
 *
 * Read from the persisted log rather than a flag in memory. The failure this
 * prevents is dull and certain: deploy at lunchtime, and every restart between
 * 22:00 and midnight runs the nightly pass again.
 */
async function alreadyRan(vault: VaultStore, run: ScheduledRun): Promise<boolean> {
  const since = todayAt(run.hour).toISOString();
  const events = await vault.readEvents({ since, limit: 200 });
  return events.some(
    (e) => e.type === 'mc.skill_ran' && (e.payload as { skill?: string }).skill === run.name,
  );
}

export function startScheduler(connectors: Connectors, vault: VaultStore): () => void {
  if ((process.env.MC_SCHEDULER ?? 'on') === 'off') {
    console.log('[scheduler] off (MC_SCHEDULER=off)');
    return () => undefined;
  }

  const tick = async (): Promise<void> => {
    const now = new Date();
    for (const run of SCHEDULE) {
      if (!slotIsOpen(now, run)) continue;

      const skill = run.skill ? findSkill(run.skill) : undefined;
      if (run.skill && !skill) continue;
      if (await alreadyRan(vault, run)) continue;

      // Anything past the scheduled hour is the catch-up path: the process was
      // down when the slot opened. Worth saying in both the log and the console,
      // because "the standup ran at 10:04" is otherwise indistinguishable from a
      // scheduler that has drifted.
      const lateBy = now.getHours() - run.hour;

      try {
        const outcome = skill
          ? await (async () => {
              const result = await skill.run({ connectors, vault });
              return {
                summary: `${result.proposals.length} proposal(s)`,
                payload: {
                  proposals: result.proposals.length,
                  // The brief itself is not in the payload: it is regenerable
                  // from the same inputs, and the log is evidence, not a filing
                  // cabinet.
                  firstLine: result.brief.split('\n')[0],
                },
              };
            })()
          : { summary: await run.job!({ connectors, vault }), payload: {} };

        eventLog.append(
          newEvent({
            source: 'mc',
            type: 'mc.skill_ran',
            payload: {
              skill: run.name,
              why: run.why,
              ...(lateBy > 0 ? { caughtUp: true, lateByHours: lateBy } : {}),
              ...outcome.payload,
            },
          }),
        );
        console.log(
          `[scheduler] ran ${run.skill ? `/${run.skill}` : run.name} — ${outcome.summary}, ${run.why}` +
            (lateBy > 0 ? ` (caught up ${lateBy}h late — the gateway was down at ${String(run.hour).padStart(2, '0')}:00)` : ''),
        );
      } catch (err) {
        eventLog.append(
          newEvent({
            source: 'mc',
            type: 'mc.sync_failed',
            payload: { scheduled: run.name, error: String(err) },
          }),
        );
      }
    }
  };

  // No run on boot: starting the gateway is not a ceremony. The first tick is
  // a minute away, which also keeps startup honest about what it is doing.
  const timer = setInterval(() => void tick(), TICK_MS);
  console.log(
    `[scheduler] on — ${SCHEDULE.map((s) => `${s.name} at ${String(s.hour).padStart(2, '0')}:00`).join(', ')}`,
  );

  return () => clearInterval(timer);
}

/** Exposed so the UI can say what is scheduled without guessing. */
export function scheduleSummary(): (ScheduledRun & { enabled: boolean })[] {
  const enabled = (process.env.MC_SCHEDULER ?? 'on') !== 'off';
  return SCHEDULE.map((s) => ({ ...s, enabled }));
}
