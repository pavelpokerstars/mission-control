/**
 * Custom agent tools — the cross-surface joins.
 *
 * Each vendor answers questions about its own product very well. None of them
 * can answer "why is MC-102 blocked", because that answer lives in four systems
 * at once. These tools are the actual product — and they have never gone
 * through MCP: `defineTool` and the Messages API both take JSON Schema
 * natively, which is why retiring the four vendor MCP servers (ROADMAP D5) cost
 * nothing here.
 */

import {
  isAlertKind,
  buildRelationGraph,
  buildTimeline,
  byConcern,
  criticalPath,
  extractKeys,
  FIELD_OWNER,
  findCycles,
  mayWrite,
  newEvent,
  NOTE_KINDS,
  type Evidence,
  type InferredEdge,
  type Note,
  type NoteKind,
  type OwnedField,
  type Proposal,
  type WorkItem,
  type WorkItemKey,
} from '@mc/domain';
import type { Connectors, GraphSource } from '@mc/connectors';
import { recall, type VaultStore } from '@mc/vault';
import { eventLog, type EventLog } from './events.js';
import { runFindings } from './findings.js';
import { stripHtml } from './format.js';
import { buildDossier } from './issue.js';
import { emitVaultEvent, journalProposal } from './vault.js';

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Proposals awaiting a human. In a real build this is a table, not a Map. */
export const proposals = new Map<string, Proposal>();

/**
 * Which accepted proposals earn a decision-journal note.
 *
 * Every *rejection* is journalled — the reasoning behind a no exists nowhere
 * else and is gone by next sprint. Acceptances are journalled only when the
 * choice itself was the interesting part. An accepted `create_issue` leaves a
 * ticket in Jira that says everything the note would, and a transcript run can
 * produce a dozen at once; journalling those turns the vault into a changelog.
 */
const JOURNAL_ON_ACCEPT: ReadonlySet<Proposal['kind']> = new Set(['publish_doc', 'link_issues']);

/** A trail entry's date, for prose. Time of day is noise in a summary sentence. */
function dateOnly(ts?: string): string {
  return ts?.slice(0, 10) ?? 'undated';
}

let pid = 0;
/** `${kind}:${dedupeKey}` → proposal id, for the ones that asked to be unique. */
const dedupe = new Map<string, string>();

/**
 * Options that only some proposals need.
 *
 * An object rather than more positional arguments: `dedupeKey` was the fifth
 * parameter and two more would have made every skill call site a row of
 * undefineds. Callers that need none of it still pass nothing.
 */
export interface ProposeOpts {
  /**
   * Matters for anything that can be run repeatedly. A tidy pass finds the same
   * stale note every time it runs; without this, running it twice before lunch
   * leaves you with two identical decisions to make, which is a good way to
   * teach somebody to ignore the whole queue.
   */
  dedupeKey?: string;
  /** The run that produced this, when one run produces several. */
  batch?: { id: string; label: string };
  /** Corroboration, 0..1. Ranking only — see `Proposal.confidence`. */
  confidence?: number;
}

/**
 * Mint a proposal. Exported so skills can propose too — see skills.ts.
 *
 * WHERE A HUMAN ANSWERS ONE, because this is the function every producer calls
 * and the question it raises: **there is no queue screen, and there must not
 * be.** `DIRECTION.md` §3 lists four pages and a queue is not among them —
 * neither it nor `DESIGN.md` uses the word "proposal" once. The alert page is
 * the review surface: the reader already has the claim, the checklist and every
 * citation in front of them, and a second screen re-asks what they just
 * answered. Accepting is a person calling `/api/tools/accept_proposal`, which
 * `HUMAN_ONLY` withholds from every provider.
 *
 * One was built from a stale comment saying otherwise and removed — see the
 * withdrawn A17 in ROADMAP.md. `dedupeKey`, `batch` and `confidence` below are
 * real and shape what `/api/proposals` returns; none of them implies a page.
 */
export function propose<T>(
  kind: Proposal['kind'],
  rationale: string,
  evidence: Evidence[],
  payload: T,
  opts: ProposeOpts = {},
): Proposal<T> {
  const { dedupeKey, batch, confidence } = opts;
  if (dedupeKey) {
    const existing = proposals.get(dedupe.get(`${kind}:${dedupeKey}`) ?? '');
    // Only a *pending* one counts. Once you have answered it, the finding is
    // allowed to come back — a note you re-verified in March can go stale again.
    if (existing?.status === 'pending') return existing as Proposal<T>;
  }

  const p: Proposal<T> = {
    id: `prop_${pid++}`,
    kind,
    rationale,
    evidence,
    payload,
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...(batch ? { batch } : {}),
    ...(confidence === undefined ? {} : { confidence }),
  };
  proposals.set(p.id, p as Proposal);
  if (dedupeKey) dedupe.set(`${kind}:${dedupeKey}`, p.id);

  // Onto the durable log, so the queue survives a restart. The whole proposal
  // goes in the payload rather than a reference: there is nowhere else it is
  // stored, and a pending decision that cannot be rebuilt is not persisted.
  eventLog.append(
    newEvent({
      source: 'mc',
      type: 'mc.proposal_created',
      entityKey: keyOf(p),
      payload: { proposal: p, dedupeKey },
    }),
  );
  return p;
}

/** Best-effort join key for a proposal, so the log files it under a ticket. */
function keyOf(p: Proposal): string | undefined {
  const payload = p.payload as { relatedKeys?: string[]; key?: string } | undefined;
  return payload?.key ?? payload?.relatedKeys?.[0];
}

/** Title for the log line, when the payload has one worth showing. */
function titleOf(p: Proposal): string | undefined {
  return (p.payload as { title?: string } | undefined)?.title;
}

/**
 * Settle a proposal: flip the status and record it. Every accept and reject
 * path goes through here, so there is one place the log can fall out of step
 * with the map, and it is this one.
 */
function settle(p: Proposal, verdict: 'accepted' | 'rejected', reason?: string): void {
  p.status = verdict;
  eventLog.append(
    newEvent({
      source: 'mc',
      type: verdict === 'accepted' ? 'mc.proposal_accepted' : 'mc.proposal_rejected',
      entityKey: keyOf(p),
      payload: { id: p.id, kind: p.kind, title: titleOf(p), reason },
    }),
  );
}

/**
 * Rebuild the queue from the log at boot.
 *
 * Replayed in order: `created` puts it back, `accepted`/`rejected` settles it.
 * Only the ones still pending matter to a human, but the settled ones are
 * replayed too so `dedupe` does not re-propose something already answered, and
 * so ids never collide with a previous run's.
 */
export async function rehydrateProposals(vault: VaultStore): Promise<number> {
  const events = await vault.readEvents({ limit: 5_000 });
  // readEvents hands back newest-first; replay wants the opposite.
  for (const e of [...events].reverse()) {
    if (e.type === 'mc.proposal_created') {
      const { proposal, dedupeKey } = e.payload as { proposal?: Proposal; dedupeKey?: string };
      if (!proposal) continue;
      proposals.set(proposal.id, proposal);
      if (dedupeKey) dedupe.set(`${proposal.kind}:${dedupeKey}`, proposal.id);
      const n = Number.parseInt(proposal.id.replace('prop_', ''), 10);
      if (Number.isFinite(n) && n >= pid) pid = n + 1;
      continue;
    }
    if (e.type === 'mc.proposal_accepted' || e.type === 'mc.proposal_rejected') {
      const { id } = e.payload as { id?: string };
      const p = id ? proposals.get(id) : undefined;
      if (p) p.status = e.type === 'mc.proposal_accepted' ? 'accepted' : 'rejected';
    }
  }
  return [...proposals.values()].filter((p) => p.status === 'pending').length;
}

export function buildCrossSurfaceTools(
  c: Connectors,
  log: EventLog,
  vault: VaultStore,
  /**
   * Relations worked out rather than written down, as a getter.
   *
   * The agent has to see the same graph a screen does. `trace_entity` and the
   * dossier read one assembler for exactly that reason, and an inferred
   * link visible on screen but absent from the agent's answer would reopen the
   * gap that merge closed. A getter rather than a value because the background
   * pass has not finished when the tools are built.
   */
  inferred: () => InferredEdge[] = () => [],
  /**
   * The loaded graph, for `list_findings`.
   *
   * Optional so that a caller with no graph still gets every other tool rather
   * than none — the same shape `FindingsInput.connectors` uses. Both call sites
   * pass it; the parameter is optional to keep the tool set additive, not
   * because it is expected to be missing.
   *
   * A READER, not a value, for the reason `createGraphConnectors` takes one: the
   * tool set is built once at boot and a collector rewrites the graph under it
   * twice a day. Held as a value, `list_findings` would answer from the boot
   * snapshot while the alert list beside it had moved on — the agent naming a
   * different front door than the screen is the one failure `related_to` and the
   * dossier already share an assembler to avoid.
   */
  readGraph?: () => GraphSource,
): AgentTool[] {
  /**
   * Shared by the `promote_to_pattern` tool and by accepting a proposal for
   * one, because a tidy pass proposes exactly the thing the agent can also be
   * asked for directly. Two call sites, one behaviour.
   */
  const promoteToPattern = async (
    ids: string[],
    title: string,
    body?: string,
  ): Promise<Record<string, unknown>> => {
    const instances = ids.map((id) => vault.get(id)).filter((n): n is Note => !!n);
    if (instances.length < 2) return { error: 'a pattern needs at least two instances' };

    const pattern = await vault.create({
      kind: 'pattern',
      title,
      // A pattern is a claim about shape, not about the state of any one
      // ticket, so it does not rot the way its instances do.
      recency: 'timeless',
      relatedKeys: [...new Set(instances.flatMap((n) => n.relatedKeys))],
      tags: ['retro'],
      evidence: instances.flatMap((n) => n.evidence),
      body: body || `So far:\n\n${instances.map((n) => `- [[${n.id}]] — ${n.title}`).join('\n')}`,
    });

    // `links` is derived from the body by `extractLinks`, so pointing an
    // instance at the pattern means writing the wikilink into its prose. That
    // is deliberate: the link and the sentence explaining it stay together,
    // and there is no second place for them to disagree.
    //
    // Each rewrite is evented. The log used to say "a pattern appeared" and
    // nothing else, so the three notes that were edited to produce it changed
    // silently — the log under-reported its own most interesting write.
    for (const n of instances) {
      const updated = await vault.update(n.id, {
        body: `${n.body}\n\nAn instance of [[${pattern.id}]].`,
      });
      emitVaultEvent('note.updated', updated, { linkedTo: pattern.id, by: 'promote_to_pattern' });
    }

    emitVaultEvent('pattern.detected', pattern, { instances: instances.map((n) => n.id) });
    return { pattern: pattern.id, instances: instances.map((n) => n.id) };
  };

  return [
    {
      name: 'explain_blocked',
      description:
        'Explain why a work item is blocked by gathering evidence from Jira status, ' +
        'Miro dependency arrows, recent Slack discussion and meeting transcripts. ' +
        'Use this for any "why is X stuck / blocked / not moving" question.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'Jira issue key, e.g. MC-102' } },
        required: ['key'],
      },
      async handler(args) {
        const key = String(args.key);
        const item = await c.jira.getItem(key);
        if (!item) return { error: `no such item ${key}` };

        const evidence: Evidence[] = [
          { surface: 'jira', label: `${key} is ${item.status}`, url: item.links.find((l) => l.surface === 'jira')?.url },
        ];

        // Canvas: who points at this item with a 'blocks' arrow?
        //
        // `MIRO_BOARD_ID` first, and the fixture only as the fallback. This was
        // the one call site of sixteen that hardcoded `'demo-board'`, which is
        // invisible in mock mode — the fixture board IS `demo-board` — and a
        // 404 the moment a real `MIRO_ACCESS_TOKEN` is set, because the live API
        // has no board by that name. It took out `explain_blocked`, which is
        // both demo flow #4 and the README's first "Try it" command.
        const connectors = await c.miro.listConnectors(process.env.MIRO_BOARD_ID ?? 'demo-board');
        const blockers = connectors.filter((x) => x.toKey === key && x.semantic === 'blocks');
        for (const b of blockers) {
          const upstream = await c.jira.getItem(b.fromKey);
          evidence.push({
            surface: 'miro',
            label: `canvas arrow: ${b.fromKey} blocks ${key}${upstream ? ` (${b.fromKey} is ${upstream.status})` : ''}`,
          });
        }

        // Slack: most recent mentions.
        for (const ch of await c.slack.listChannels()) {
          const msgs = await c.slack.listMessages(ch.id);
          for (const m of msgs.filter((m) => m.mentions.includes(key)).slice(-3)) {
            evidence.push({ surface: 'slack', label: `#${ch.name} ${m.author}`, quote: m.text });
          }
        }

        // Transcripts: what was said about it.
        for (const meta of await c.zoom.listTranscripts()) {
          const t = await c.zoom.getTranscript(meta.id);
          for (const seg of (t?.segments ?? []).filter((s) => s.mentions.includes(key))) {
            evidence.push({
              surface: 'zoom',
              label: `${meta.meetingTopic} — ${seg.speaker}`,
              at: seg.start,
              quote: seg.text,
            });
          }
        }

        // Confluence: any decision record that references it.
        for (const p of await c.confluence.listPages('MC')) {
          if (p.relatedKeys.includes(key)) {
            evidence.push({ surface: 'confluence', label: p.title, url: p.url });
          }
        }

        // The vault: has this happened before? Every surface above answers
        // "what is true now" and re-derives it from scratch each call. This is
        // the only line here that can produce "for the third sprint running".
        const remembered = vault.list({ key });
        for (const n of remembered) {
          evidence.push({
            surface: 'vault',
            label: `[[${n.id}]] ${n.kind}: ${n.title}`,
            quote: n.body.split('\n').find((l) => l.trim())?.slice(0, 160),
          });
        }

        /**
         * Is this blocker recurring? Counting impediment notes is the obvious
         * check and the wrong one — one well-written note can record three
         * occurrences, and three notes can be three unrelated blockers.
         *
         * The claim "this keeps happening" is encoded structurally instead: an
         * impediment that links to a `pattern` note. That is a judgement the
         * scrum master made deliberately, which is exactly the kind of thing
         * the vault is for and no other surface can hold.
         */
        const recurrence = remembered
          .filter((n) => n.kind === 'impediment')
          .flatMap((n) =>
            n.links
              .map((id) => vault.get(id))
              .filter((p) => p?.kind === 'pattern')
              .map((p) => `[[${n.id}]] is an instance of the pattern [[${p?.id}]]: ${p?.title}`),
          );

        return {
          key,
          status: item.status,
          blockers: blockers.map((b) => b.fromKey),
          recurrence: recurrence.length ? recurrence : undefined,
          evidence,
        };
      },
    },

    {
      name: 'analyze_canvas',
      description:
        'Read the Miro board as a dependency graph. Returns circular dependencies and ' +
        'the critical path with its total estimate. Use when asked whether a plan is ' +
        'feasible, what the longest chain is, or whether the board makes sense.',
      parameters: {
        type: 'object',
        properties: { boardId: { type: 'string' } },
        required: [],
      },
      async handler(args) {
        const boardId = String(args.boardId ?? process.env.MIRO_BOARD_ID ?? 'demo-board');
        const connectors = await c.miro.listConnectors(boardId);
        const items = new Map((await c.jira.listItems()).map((i) => [i.key, i]));
        const cycles = findCycles(connectors);

        // A critical path is only meaningful on an acyclic graph. Reporting one
        // alongside a cycle would be quietly wrong, which is worse than silent.
        const path = cycles.length === 0 ? criticalPath(connectors, items) : undefined;

        return {
          boardId,
          arrowCount: connectors.length,
          cycles,
          cyclesFound: cycles.length,
          criticalPath: path?.path ?? null,
          criticalPathCost: path?.cost ?? null,
          note:
            cycles.length > 0
              ? `Circular dependency detected: ${cycles[0]?.join(' → ')}. ` +
                'This plan cannot be scheduled as drawn — break one arrow before estimating.'
              : 'No cycles. Plan is schedulable.',
        };
      },
    },

    {
      name: 'propose_tickets_from_transcript',
      description:
        'Read a meeting transcript and propose Jira tickets for the action items and ' +
        'decisions in it. Returns PROPOSALS for a human to approve — it does not ' +
        'create anything.',
      parameters: {
        type: 'object',
        properties: { transcriptId: { type: 'string' } },
        required: ['transcriptId'],
      },
      async handler(args) {
        const t = await c.zoom.getTranscript(String(args.transcriptId));
        if (!t) return { error: 'transcript not found' };

        // Deliberately simple heuristics. In live mode the agent reasons over
        // the segments itself; this keeps the mock path honest and debuggable.
        const ACTION = /\b(will|needs to|owns|can you|take|action|todo|follow up)\b/i;
        const DECISION = /\b(decision|we decided|agreed|let us|let's|we'll go with)\b/i;

        const out: Proposal[] = [];
        for (const seg of t.segments) {
          const isAction = ACTION.test(seg.text);
          const isDecision = DECISION.test(seg.text);
          if (!isAction && !isDecision) continue;

          const evidence: Evidence[] = [
            { surface: 'zoom', label: `${t.meetingTopic} — ${seg.speaker}`, at: seg.start, quote: seg.text },
          ];

          // `${transcript}:${offset}` dedupes on the thing that actually
          // identifies a claim — where in which recording it was said. Without
          // it, asking twice about the same meeting (which is the normal way
          // anyone uses this) leaves two of every decision still to be made.
          const at = `${t.id}:${seg.start}`;

          if (isDecision) {
            out.push(
              propose(
                'publish_doc',
                `Decision stated at ${seg.start}s and not yet recorded anywhere durable.`,
                evidence,
                {
                  title: `Decision: ${seg.text.slice(0, 60)}`,
                  relatedKeys: extractKeys(seg.text),
                },
                { dedupeKey: at },
              ),
            );
          } else {
            out.push(
              propose(
                'create_issue',
                `Action item assigned aloud at ${seg.start}s with no matching Jira issue.`,
                evidence,
                {
                  title: seg.text.slice(0, 80),
                  type: 'task',
                  labels: ['from-meeting'],
                  relatedKeys: extractKeys(seg.text),
                },
                { dedupeKey: at },
              ),
            );
          }
        }
        // Two event types that have existed in the union since the beginning
        // with nothing ever emitting them. They belong here: this is the only
        // place a meeting turns into something actionable, and the timeline
        // should show where in the sprint that happened.
        for (const p of out) {
          const evidence = p.evidence[0];
          eventLog.append(
            newEvent({
              source: 'zoom',
              type: p.kind === 'publish_doc' ? 'meeting.decision_extracted' : 'meeting.action_item_proposed',
              entityKey: (p.payload as { relatedKeys?: string[] }).relatedKeys?.[0],
              payload: {
                transcriptId: t.id,
                proposalId: p.id,
                at: evidence?.at,
                title: (p.payload as { title?: string }).title,
              },
            }),
          );
        }

        return { transcriptId: t.id, proposalCount: out.length, proposals: out };
      },
    },

    /**
     * The front door, as a tool.
     *
     * `ContextEnvelope.findings` puts the top of the list into every global
     * turn, which is what stops the agent naming a different "worst" than the
     * screen. This is the other half: the questions that context cannot answer
     * because the list was cut — "how many stale links are there", "show me
     * everything about the cycle", anything past the eighth row. On a real
     * programme the tail is most of the list.
     *
     * Read-only, and it produces no proposal and reaches no vendor, so it needs
     * no `HUMAN_ONLY` entry. Suppression is applied inside `runFindings`, so a
     * dismissed alert does not come back through this door either.
     */
    {
      name: 'list_findings',
      description:
        'Every finding, ranked worst first. Use for "what needs me", "what is most ' +
        'urgent", "what is on the list", and to look past what you were already shown. ' +
        'Filter by kind for questions about one sort of problem. Anything dismissed or ' +
        'deferred is excluded. NOTE the `shownOn` field: "alerts" is the front door, ' +
        '"sources" is a data-coverage fact that deliberately does not interrupt anybody ' +
        '(stale and unrecorded dependency links, which come one per edge and can number ' +
        'in the hundreds). Do not describe a `sources` finding as something that needs ' +
        'them today, and do not include them when counting what needs them.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description:
              'One kind only: missing_ticket, disagreement, cycle, aging, ' +
              'suspect_link, undetected_dependency. Omit for all of them.',
          },
          limit: { type: 'number', description: 'How many to return. Default 20.' },
        },
      },
      async handler(args) {
        const source = readGraph?.();
        if (!source) return { error: 'no graph is loaded, so there is no alert list' };
        const all = await runFindings({ source, vault, items: await c.jira.listItems(), connectors: c });
        const kind = args.kind ? String(args.kind) : undefined;
        const picked = (kind ? all.filter((f) => f.kind === kind) : all).slice(
          0,
          Math.min(Math.max(Number(args.limit ?? 20), 1), 100),
        );
        return {
          total: all.length,
          shown: picked.length,
          // The claim, why it fired and what it is about — not the evidence
          // bodies. A citation is a record, and reading one is `trace_entity`'s
          // job; twenty findings' worth of quotations would crowd out the turn.
          findings: picked.map((f) => ({
            id: f.id,
            kind: f.kind,
            shownOn: isAlertKind(f.kind) ? 'alerts' : 'sources',
            severity: f.severity,
            claim: f.claim,
            impact: f.impact,
            subject: f.subject,
            firedAt: f.firedAt,
          })),
        };
      },
    },

    {
      name: 'trace_entity',
      description:
        'Everything anyone said or wrote about a work item, across all five surfaces, ' +
        'newest first and dated — the full life story of a ticket, plus any places two ' +
        'sources disagree about whether it is finished. Use for "what happened with X", ' +
        '"catch me up on X", and above all "is X actually done".',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
      async handler(args) {
        const key = String(args.key) as WorkItemKey;
        // Same assembler `/api/issue/:key` reads. The old hand-rolled version
        // here drifted from it the moment either changed, and it claimed
        // "chronological order" while sorting by nothing at all.
        const d = await buildDossier(key, c, vault, log, inferred());
        if (!d.item && !d.trail.length) return { error: `no work item ${key}` };

        return {
          key,
          status: d.item ? `${d.item.title} — ${d.item.status}` : undefined,
          mentions: d.trail.length,
          /**
           * Spelled out as sentences rather than handed over as pairs. The
           * disagreement is the answer to the question that gets asked most, and
           * an agent given two objects tends to summarise them into agreement.
           */
          disagreements: d.contradictions.map(
            (co) =>
              `${co.claimsDone.surface} says done (${co.claimsDone.label}, ${dateOnly(co.claimsDone.ts)}) ` +
              `but ${co.claimsBlocked.surface} says not (${co.claimsBlocked.label}, ${dateOnly(co.claimsBlocked.ts)})` +
              (co.apartDays !== null ? ` — ${Math.round(co.apartDays)}d apart, the ${co.latest} claim is newer` : ''),
          ),
          trail: d.trail.map((e) => ({
            when: dateOnly(e.ts),
            surface: e.surface,
            label: e.label,
            quote: e.quote,
            claims: e.signal,
          })),
        };
      },
    },

    {
      name: 'search_pages',
      description:
        'Search Confluence page BODIES for a phrase or a decision, and return the matching ' +
        'pages with the passage that matched. Use this to answer "is this written down ' +
        'anywhere", "what does the spec actually say", or before telling somebody to write ' +
        'a decision record — a page may already contain it under a different title. Note ' +
        'that related_to and the graph only know which pages MENTION a ticket, which is a ' +
        'weaker claim than containing a given decision.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The claim or phrase to look for.' },
          spaceKey: { type: 'string' },
        },
        required: ['query'],
      },
      async handler(args) {
        const q = String(args.query ?? '');
        const pages = await c.confluence.listPages(
          String(args.spaceKey ?? process.env.CONFLUENCE_SPACE_KEY ?? 'MC'),
        );
        const wanted = new Set(
          q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2),
        );
        if (!wanted.size) return { error: 'nothing to search for' };

        const hits = pages
          .map((p) => {
            const text = stripHtml(p.html);
            const lower = text.toLowerCase();
            let shared = 0;
            for (const w of wanted) if (lower.includes(w)) shared++;
            // Where in the page the strongest term landed, so the model can
            // quote a passage rather than assert that a page "covers" this.
            const anchor = [...wanted].map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
            return {
              id: p.id,
              title: p.title,
              url: p.url,
              relatedKeys: p.relatedKeys,
              updatedAt: p.updatedAt,
              match: Math.round((shared / wanted.size) * 100) / 100,
              passage: text.slice(Math.max(anchor - 120, 0), anchor + 280).trim(),
            };
          })
          .filter((h) => h.match > 0.3)
          .sort((a, b) => b.match - a.match);

        return {
          count: hits.length,
          pages: hits,
          note: hits.length
            ? 'match is word overlap, not meaning — read the passage before claiming a page records something.'
            : 'No page contains this. If it was decided, it is not written down.',
        };
      },
    },

    {
      name: 'read_page',
      description:
        'Read one Confluence page in full, as text. Use after search_pages or related_to ' +
        'has named a page and you need what it actually says rather than that it exists.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      async handler(args) {
        const page = await c.confluence.getPage(String(args.id));
        if (!page) return { error: 'unknown page' };
        return {
          id: page.id,
          title: page.title,
          url: page.url,
          updatedAt: page.updatedAt,
          relatedKeys: page.relatedKeys,
          text: stripHtml(page.html),
        };
      },
    },

    {
      name: 'recall',
      description:
        'Search the vault — the scrum master\'s own notes: impediments, commitments people ' +
        'made aloud, decisions and their reasoning, and patterns across sprints. Use this ' +
        'BEFORE answering any "has this happened before", "what did we decide", "who said ' +
        'they would" or "why does this keep happening" question. Vault notes are memory, ' +
        'not fact — always cite them as [[note-id]] and defer to Jira on anything Jira owns.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Free text to match against notes' },
          key: { type: 'string', description: 'Optional Jira key to scope to, e.g. MC-102' },
          kind: { type: 'string', enum: NOTE_KINDS, description: 'Optional note kind filter' },
        },
        required: [],
      },
      async handler(args) {
        const key = args.key ? String(args.key) : undefined;
        const kind = args.kind ? (String(args.kind) as NoteKind) : undefined;
        const candidates = vault.list({ key, kind });

        // A key- or kind-scoped call is a lookup and should return the set. An
        // open text query is a recall and goes through the budget.
        if (key || kind) {
          return {
            count: candidates.length,
            notes: candidates.map((n) => ({
              id: n.id,
              kind: n.kind,
              title: n.title,
              status: n.status,
              relatedKeys: n.relatedKeys,
              verifiedAt: n.verifiedAt,
              body: n.body,
            })),
          };
        }

        const hits = recall(candidates, { text: String(args.query ?? ''), budget: 2_400, limit: 8 });
        return { count: hits.length, notes: hits };
      },
    },

    {
      name: 'capture_note',
      description:
        'Write something to the vault: an idea that is not a ticket yet, an impediment, a ' +
        'commitment someone made in a meeting, or a pattern you noticed across sprints. ' +
        'Use this when information is worth keeping but does not belong in Jira — and ' +
        'especially when the user says something like "remember that" or "note that". ' +
        'Never store status, assignee, estimate or sprint here; link to the Jira key instead.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: NOTE_KINDS },
          title: { type: 'string' },
          body: { type: 'string', description: 'Markdown. Use [[note-id]] to link other notes.' },
          relatedKeys: { type: 'array', items: { type: 'string' }, description: 'Jira keys' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'title', 'body'],
      },
      async handler(args) {
        const body = String(args.body);
        const note = await vault.create({
          kind: String(args.kind) as NoteKind,
          title: String(args.title),
          body,
          // Anything mentioned in the body attaches automatically — same trick
          // extractKeys() plays on transcripts, applied to our own writing.
          relatedKeys: [
            ...new Set([...((args.relatedKeys as string[] | undefined) ?? []), ...extractKeys(body)]),
          ],
          tags: (args.tags as string[] | undefined) ?? [],
        });
        emitVaultEvent('note.created', note, { by: 'agent' });
        return { id: note.id, title: note.title, kind: note.kind };
      },
    },

    {
      name: 'promote_note',
      description:
        'Publish a vault note to Confluence so the team can see it. The vault is private ' +
        'working memory; this is how something graduates into shared, durable record. ' +
        'Returns a proposal — the human still approves the publish.',
      parameters: {
        type: 'object',
        properties: { noteId: { type: 'string' } },
        required: ['noteId'],
      },
      async handler(args) {
        const note = vault.get(String(args.noteId));
        if (!note) return { error: 'unknown note' };
        if (note.promotedTo) return { error: `already published as ${note.promotedTo.id}` };

        return propose(
          'publish_doc',
          `Vault note "${note.title}" has stabilised and is only visible to you. ` +
            'Publishing makes it survive your holiday.',
          [{ surface: 'vault', label: `[[${note.id}]]`, quote: note.title }, ...note.evidence],
          { title: note.title, relatedKeys: note.relatedKeys, noteId: note.id, html: note.body },
        );
      },
    },

    {
      name: 'related_to',
      description:
        'Everything that points at a work item or a note, and everything it points at: ' +
        'canvas dependency arrows, the Jira epic it sits under, vault notes that explain ' +
        'it, other notes those link to, and Confluence pages that document it. Use for ' +
        '"what touches X", "what depends on X", "what have we written about X".',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'A Jira key (MC-102) or a vault note id' },
          depth: { type: 'number', description: 'Hops to follow. 1 = direct neighbours (default), 2 = their neighbours too.' },
        },
        required: ['id'],
      },
      async handler(args) {
        const id = String(args.id);
        const depth = Math.min(Math.max(Number(args.depth ?? 1), 1), 3);

        const [items, arrows, pages] = await Promise.all([
          c.jira.listItems(),
          c.miro.listConnectors(process.env.MIRO_BOARD_ID ?? 'demo-board'),
          c.confluence.listPages(process.env.CONFLUENCE_SPACE_KEY ?? 'MC'),
        ]);
        const graph = buildRelationGraph({ items, notes: vault.list(), connectors: arrows, pages });
        if (!graph.nodes.some((n) => n.id === id)) return { error: `nothing in the graph called ${id}` };

        // Breadth-first over an undirected view: "what relates to this" does not
        // care which way the arrow was drawn.
        const reached = new Set([id]);
        let frontier = [id];
        for (let hop = 0; hop < depth; hop++) {
          const next: string[] = [];
          const visit = (n: string): void => {
            if (reached.has(n)) return;
            reached.add(n);
            next.push(n);
          };
          for (const e of graph.edges) {
            if (frontier.includes(e.from)) visit(e.to);
            if (frontier.includes(e.to)) visit(e.from);
          }
          frontier = next;
          if (!frontier.length) break;
        }

        const label = new Map(graph.nodes.map((n) => [n.id, n]));
        return {
          id,
          neighbours: [...reached]
            .filter((n) => n !== id)
            .map((n) => {
              const node = label.get(n);
              return { id: n, kind: node?.kind, label: node?.label, status: node?.status ?? node?.noteStatus };
            }),
          edges: graph.edges
            .filter((e) => reached.has(e.from) && reached.has(e.to))
            .map((e) => `${e.from} —${e.kind}→ ${e.to} (per ${e.asserts})`),
          inCycle: graph.cycles.filter((cy) => cy.includes(id)),
          onCriticalPath: graph.criticalPath?.path.includes(id) ?? false,
        };
      },
    },

    {
      name: 'what_happened',
      description:
        'The recent history of the project as time-in-state: how long each ticket has ' +
        'sat where it is, when it moved, and what happened around it (meetings, decisions, ' +
        'Slack traffic). Use for "how long has X been blocked", "what changed this week", ' +
        '"catch me up" — and prefer it over trace_entity when the question is about ' +
        'DURATION rather than about evidence.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Optional Jira key to scope to' },
          days: { type: 'number', description: 'How far back to look. Default 14.' },
        },
        required: [],
      },
      async handler(args) {
        const days = Math.min(Math.max(Number(args.days ?? 14), 1), 180);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const key = args.key ? String(args.key) : undefined;

        const [events, items] = await Promise.all([
          vault.readEvents({ since, key, limit: 2_000 }),
          c.jira.listItems(),
        ]);
        const timeline = buildTimeline(events, { items, notes: vault.list() });
        const lanes = key ? timeline.lanes.filter((l) => l.key === key) : timeline.lanes;

        return {
          window: { from: timeline.from, to: timeline.to, days },
          // Rounded here rather than at the renderer: "blocked for 6.03 days"
          // is a worse answer than "blocked for 6 days" and costs more tokens.
          lanes: lanes.map((l) => ({
            key: l.key,
            title: l.title,
            nowIn: l.segments.at(-1)?.status,
            forDays: Math.round(l.ageDays * 10) / 10,
            history: l.segments.map((s) => `${s.status} for ${Math.round(s.days * 10) / 10}d`),
            // Worked vs waited. Say it as a sentence rather than a ratio — an
            // agent asked "how is MC-102 doing" should be able to quote this
            // straight, and "16%" alone invites it to invent what the number
            // means.
            flow:
              l.flowEfficiency === null
                ? undefined
                : `${Math.round(l.flowEfficiency * 100)}% of its measured life was active work ` +
                  `(${Math.round(l.activeDays * 10) / 10}d worked, ${Math.round(l.waitingDays * 10) / 10}d waiting)`,
          })),
          /**
           * Worst-first by the same `byConcern` ranking every other consumer
           * uses, so the agent names the ticket at the top of the user's screen.
           */
          needsAttention: [...lanes]
            .sort(byConcern)
            .slice(0, 3)
            .map((l) => `${l.key} has been ${l.segments.at(-1)?.status} for ${Math.round(l.ageDays)} days`),
          events: timeline.markers
            .filter((m) => !key || m.key === key)
            .map((m) => `${m.ts.slice(0, 10)} [${m.source}] ${m.label}`),
        };
      },
    },

    {
      name: 'resolve_note',
      description:
        'Close a vault note: an impediment that is cleared, a commitment that was kept (or ' +
        'broken), an idea that has been acted on. Records the outcome in the note rather than ' +
        'just flipping a flag — six weeks from now "resolved" alone tells you nothing. Use ' +
        'when the user says something is sorted, done, or no longer true.',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
          outcome: { type: 'string', description: 'What actually happened. Written into the note.' },
        },
        required: ['noteId', 'outcome'],
      },
      async handler(args) {
        const note = vault.get(String(args.noteId));
        if (!note) return { error: 'unknown note' };
        if (note.status === 'resolved') return { error: 'already resolved' };

        const outcome = String(args.outcome);
        const updated = await vault.update(note.id, {
          status: 'resolved',
          body: `${note.body}\n\n**Resolved ${new Date().toISOString().slice(0, 10)}** — ${outcome}`,
        });
        emitVaultEvent('note.resolved', updated, { outcome });
        return { resolved: updated.id, status: updated.status };
      },
    },

    {
      name: 'promote_to_pattern',
      description:
        'Take several notes that turned out to be the same recurring problem and mint the ' +
        'pattern note that links them. THIS IS THE POINT OF THE VAULT: "third sprint running" ' +
        'is only sayable once somebody has said these three things are one thing. Use when the ' +
        'user notices a repeat, or when you spot impediments with the same shape across sprints.',
      parameters: {
        type: 'object',
        properties: {
          noteIds: { type: 'array', items: { type: 'string' }, description: 'The instances' },
          title: { type: 'string', description: 'The shape of the recurrence, not one instance of it' },
          body: { type: 'string', description: 'What keeps happening, and what it costs' },
        },
        required: ['noteIds', 'title'],
      },
      async handler(args) {
        return promoteToPattern(
          (args.noteIds as string[] | undefined) ?? [],
          String(args.title),
          args.body ? String(args.body) : undefined,
        );
      },
    },

    {
      name: 'link_notes',
      description:
        'Connect two vault notes that turned out to be about the same thing, with a sentence ' +
        'saying how. Use when the user says "that is the same as…", or when you notice a note ' +
        'explains another. Links are what turn a pile of notes into something navigable.',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'The note the sentence is written into' },
          to: { type: 'string', description: 'The note it points at' },
          why: { type: 'string', description: 'How they relate. Written into the body.' },
        },
        required: ['from', 'to'],
      },
      async handler(args) {
        const from = vault.get(String(args.from));
        const to = vault.get(String(args.to));
        if (!from || !to) return { error: 'one of those notes does not exist' };
        if (from.id === to.id) return { error: 'a note cannot link to itself' };
        if (from.links.includes(to.id)) return { error: `[[${from.id}]] already links to [[${to.id}]]` };

        // Written as prose, not as a frontmatter field, because `links` is
        // derived from the body — and because a link with no sentence next to
        // it is a link nobody can evaluate a year later.
        const why = args.why ? String(args.why) : `Related to [[${to.id}]].`;
        const updated = await vault.update(from.id, {
          body: `${from.body}\n\n${why.includes(`[[${to.id}]]`) ? why : `${why} — [[${to.id}]]`}`,
        });
        emitVaultEvent('note.updated', updated, { linked: to.id });
        return { from: updated.id, to: to.id, links: updated.links };
      },
    },

    {
      name: 'merge_notes',
      description:
        'Fold several notes about one thing into a single note. Use when the same impediment ' +
        'or idea got captured more than once — from a meeting, then from Slack, then by hand. ' +
        'The originals are ARCHIVED, never deleted, and every piece of evidence is carried ' +
        'across, so nothing a note was citing is lost.',
      parameters: {
        type: 'object',
        properties: {
          keep: { type: 'string', description: 'The note id to keep and merge into' },
          absorb: { type: 'array', items: { type: 'string' }, description: 'Note ids folded in' },
          title: { type: 'string', description: 'Optional new title for the surviving note' },
        },
        required: ['keep', 'absorb'],
      },
      async handler(args) {
        const keep = vault.get(String(args.keep));
        if (!keep) return { error: 'unknown note to keep' };
        const absorb = ((args.absorb as string[] | undefined) ?? [])
          .map((id) => vault.get(id))
          .filter((n): n is Note => !!n && n.id !== keep.id);
        if (!absorb.length) return { error: 'nothing to absorb' };

        const merged = await vault.update(keep.id, {
          title: args.title ? String(args.title) : keep.title,
          relatedKeys: [...new Set([...keep.relatedKeys, ...absorb.flatMap((n) => n.relatedKeys)])],
          tags: [...new Set([...keep.tags, ...absorb.flatMap((n) => n.tags)])],
          // Evidence is the whole reason a merge has to be careful: it is what
          // makes every claim in here checkable, and dropping it on the floor
          // would quietly turn merged notes into hearsay.
          evidence: [...keep.evidence, ...absorb.flatMap((n) => n.evidence)],
          body: [
            keep.body,
            ...absorb.map((n) => `\n---\n\n_Merged in from [[${n.id}]] — "${n.title}"_\n\n${n.body}`),
          ].join('\n'),
        });

        // Archived, not removed. A note somebody cited last sprint has to still
        // resolve, and `archived` already drops it out of recall.
        //
        // Evented individually for the same reason as `promote_to_pattern`: the
        // single `note.updated` below says the survivor grew, not that three
        // other notes just left the vault's working set.
        for (const n of absorb) {
          const archived = await vault.update(n.id, {
            status: 'archived',
            body: `${n.body}\n\n_Merged into [[${merged.id}]]._`,
          });
          emitVaultEvent('note.updated', archived, { mergedInto: merged.id, archived: true });
        }

        emitVaultEvent('note.updated', merged, { mergedFrom: absorb.map((n) => n.id) });
        return { kept: merged.id, archived: absorb.map((n) => n.id), evidence: merged.evidence.length };
      },
    },

    {
      name: 'reclassify_note',
      description:
        'Change what kind of note something is, or how it survives time. Use when a captured ' +
        '"idea" turns out to have been a commitment, or when a claim someone treated as ' +
        'permanent is really only true as of today.',
      parameters: {
        type: 'object',
        properties: {
          noteId: { type: 'string' },
          kind: { type: 'string', enum: NOTE_KINDS },
          recency: { type: 'string', enum: ['timeless', 'dated', 'pointer'] },
        },
        required: ['noteId'],
      },
      async handler(args) {
        const note = vault.get(String(args.noteId));
        if (!note) return { error: 'unknown note' };
        const recency = args.recency ? (String(args.recency) as Note['recency']) : undefined;

        const updated = await vault.update(note.id, {
          ...(args.kind ? { kind: String(args.kind) as NoteKind } : {}),
          ...(recency ? { recency } : {}),
          // Becoming `dated` without a date is what `assertVaultSafe` rejects,
          // and re-classifying is exactly when it would happen. Stamp it now:
          // the claim is being asserted as true today by whoever asked for this.
          ...(recency === 'dated' && !note.verifiedAt ? { verifiedAt: new Date().toISOString() } : {}),
        });
        emitVaultEvent('note.updated', updated, { reclassified: true });
        return { id: updated.id, kind: updated.kind, recency: updated.recency };
      },
    },

    {
      name: 'find_duplicates',
      description:
        'Find notes that look like they are about the same thing — sharing a Jira key and ' +
        'overlapping heavily in wording. Use before capturing something new, and when the ' +
        'vault feels cluttered. Returns candidates for merge_notes; it does not merge anything.',
      parameters: { type: 'object', properties: {}, required: [] },
      async handler() {
        const notes = vault.list().filter((n) => n.status !== 'archived');
        const words = (n: Note): Set<string> =>
          new Set(
            `${n.title} ${n.body}`
              .toLowerCase()
              .split(/[^a-z0-9]+/)
              .filter((w) => w.length > 3),
          );

        const pairs: { a: string; b: string; overlap: number; sharedKeys: string[] }[] = [];
        for (let i = 0; i < notes.length; i++) {
          for (let j = i + 1; j < notes.length; j++) {
            const a = notes[i] as Note;
            const b = notes[j] as Note;
            const sharedKeys = a.relatedKeys.filter((k) => b.relatedKeys.includes(k));
            // A shared key is the cheap precondition: two notes about different
            // tickets are not duplicates however similarly they are written.
            if (!sharedKeys.length || a.kind !== b.kind) continue;

            const wa = words(a);
            const wb = words(b);
            const shared = [...wa].filter((w) => wb.has(w)).length;
            const overlap = shared / Math.max(Math.min(wa.size, wb.size), 1);
            if (overlap > 0.4) pairs.push({ a: a.id, b: b.id, overlap: Math.round(overlap * 100) / 100, sharedKeys });
          }
        }
        return {
          count: pairs.length,
          candidates: pairs.sort((x, y) => y.overlap - x.overlap),
          note: pairs.length ? 'Use merge_notes to fold one into the other.' : 'Nothing looks duplicated.',
        };
      },
    },

    {
      name: 'reject_proposal',
      description:
        'Reject a proposal and record why in the decision journal. Always prefer this over ' +
        'silently dropping a proposal — the reasoning is worthless six weeks from now if ' +
        'nobody wrote it down.',
      parameters: {
        type: 'object',
        properties: {
          proposalId: { type: 'string' },
          reason: { type: 'string', description: "The human's stated reason, verbatim if given" },
        },
        required: ['proposalId'],
      },
      async handler(args) {
        const p = proposals.get(String(args.proposalId));
        if (!p) return { error: 'unknown proposal' };
        if (p.status !== 'pending') return { error: `already ${p.status}` };

        settle(p, 'rejected', args.reason ? String(args.reason) : undefined);
        const note = await journalProposal(vault, p, 'rejected', args.reason ? String(args.reason) : undefined);
        return { rejected: p.id, journaledAs: note.id };
      },
    },

    {
      name: 'accept_proposal',
      description:
        'Apply a previously generated proposal. Only call this after a human has ' +
        'explicitly confirmed it in the UI.',
      parameters: {
        type: 'object',
        properties: { proposalId: { type: 'string' } },
        required: ['proposalId'],
      },
      async handler(args) {
        const p = proposals.get(String(args.proposalId));
        if (!p) return { error: 'unknown proposal' };
        if (p.status !== 'pending') return { error: `already ${p.status}` };

        const token = log.markOutbound(p.id);

        if (p.kind === 'create_issue') {
          const payload = p.payload as {
            title: string;
            type?: WorkItem['type'];
            labels?: string[];
            relatedKeys?: WorkItemKey[];
            /** A vault note that already holds this promise, if one did. */
            noteId?: string;
            /** Where it was asked for, for the provenance comment. */
            meeting?: string;
            boardId?: string;
          };
          const created = await c.jira.createItem({
            title: payload.title,
            type: payload.type ?? 'task',
            labels: payload.labels ?? [],
          });
          await c.miro.upsertAppCard(payload.boardId ?? process.env.MIRO_BOARD_ID ?? 'demo-board', created);

          // Provenance goes on as a COMMENT, not a field. `WorkItem` has no
          // description, and more to the point a comment is the one outbound
          // write with no owner in FIELD_OWNER — nobody owns it as *state*, so
          // it cannot start a sync war and needs no proposal of its own. Same
          // reasoning as surfaceMemory.
          //
          // Its own echo token: this is a second vendor write, and stamping it
          // with the first one would leave the comment webhook unsuppressed.
          const commentToken = log.markOutbound(`${p.id}:provenance`);
          await c.jira.comment(
            created.key,
            [
              `Created from a Mission Control proposal${payload.meeting ? ` — ${payload.meeting}` : ''}.`,
              '',
              p.rationale,
              '',
              ...p.evidence.map(
                (e) =>
                  `- ${e.surface}: ${e.label}` +
                  (e.at === undefined ? '' : ` (${e.at}s)`) +
                  (e.quote ? ` — "${e.quote}"` : ''),
              ),
            ].join('\n'),
          );

          // ---- close the loop with the vault -------------------------------
          // This is the half that makes the next ceremony smarter than this one.
          // Without it a workshop produces tickets and the vault learns nothing,
          // so next sprint the same brief is assembled from the same blank slate.
          const held = payload.noteId ? vault.get(payload.noteId) : undefined;
          if (held) {
            // The promise now has a ticket. Attaching the key is what lets
            // /tidy retire the note once the work moves on.
            const updated = await vault.update(held.id, {
              relatedKeys: [...new Set([...held.relatedKeys, created.key])],
            });
            emitVaultEvent('note.updated', updated, { linkedTo: created.key, via: 'proposal' });
          } else {
            const note = await vault.create({
              kind: 'commitment',
              title: payload.title.slice(0, 90),
              relatedKeys: [...new Set([created.key, ...(payload.relatedKeys ?? [])])],
              evidence: p.evidence,
              // A promise rots — "is Dana still doing this?" is exactly the
              // question a dated claim is for, and it drops straight into
              // /tidy's stale pass and /standup's open commitments.
              recency: 'dated',
              verifiedAt: new Date().toISOString(),
              body: [
                `Tracked as ${created.key}.`,
                '',
                p.rationale,
              ].join('\n'),
            });
            emitVaultEvent('note.created', note, { from: 'proposal', key: created.key });
          }

          settle(p, 'accepted');
          // Not journalled on purpose — see JOURNAL_ON_ACCEPT. A created issue
          // documents itself in Jira; a note per ticket would bury the journal.
          return { created: created.key, echoToken: token, commentToken };
        }

        if (p.kind === 'publish_doc') {
          const payload = p.payload as {
            title: string;
            relatedKeys?: WorkItemKey[];
            html?: string;
            noteId?: string;
          };
          // The NOTE is the source of truth and the payload is a pointer to it.
          //
          // A proposal payload is frozen when it is made, so publishing from
          // `payload.html` would ship the text as the skill first assembled it
          // and silently discard whatever the human wrote on the note page
          // afterwards — which is the entire point of routing a pack through
          // the vault. Falls back to the payload for proposals that carry text
          // and no note.
          const live = payload.noteId ? vault.get(payload.noteId) : undefined;
          const page = await c.confluence.publish({
            title: live?.title ?? payload.title,
            html: live?.body ?? payload.html ?? `<p>Recorded automatically from a meeting by Mission Control.</p>`,
            relatedKeys: live?.relatedKeys ?? payload.relatedKeys ?? [],
          });

          // If this publish came from promote_note, close the loop so the vault
          // knows the note is public and stops offering to promote it again.
          if (payload.noteId && vault.get(payload.noteId)) {
            const promoted = await vault.update(payload.noteId, {
              promotedTo: {
                surface: 'confluence',
                id: page.id,
                url: page.url,
                at: new Date().toISOString(),
              },
            });
            emitVaultEvent('note.promoted', promoted, { pageId: page.id });
          }

          settle(p, 'accepted');
          await journalProposal(vault, p, 'accepted');
          return { published: page.id, echoToken: token };
        }

        // ---- vault reorganisation ------------------------------------------
        // No echo token needed on these: the vault has no webhook to echo back.
        if (p.kind === 'resolve_note') {
          const payload = p.payload as { noteId: string; outcome?: string };
          const note = vault.get(payload.noteId);
          if (!note) return { error: `note ${payload.noteId} is gone` };
          const updated = await vault.update(note.id, {
            status: 'resolved',
            body: `${note.body}\n\n**Resolved ${new Date().toISOString().slice(0, 10)}** — ${
              payload.outcome ?? 'accepted from a tidy pass'
            }`,
          });
          emitVaultEvent('note.resolved', updated, { via: 'proposal' });
          settle(p, 'accepted');
          return { resolved: updated.id };
        }

        if (p.kind === 'reverify_note') {
          const payload = p.payload as { noteId: string };
          const note = vault.get(payload.noteId);
          if (!note) return { error: `note ${payload.noteId} is gone` };
          const updated = await vault.update(note.id, { verifiedAt: new Date().toISOString() });
          emitVaultEvent('note.updated', updated, { via: 'proposal', reverified: true });
          settle(p, 'accepted');
          return { reverified: updated.id, verifiedAt: updated.verifiedAt };
        }

        if (p.kind === 'promote_to_pattern') {
          const payload = p.payload as { noteIds: string[]; title: string; body?: string };
          const made = await promoteToPattern(payload.noteIds, payload.title, payload.body);
          settle(p, 'accepted');
          await journalProposal(vault, p, 'accepted');
          return made;
        }

        // ---- writes to somebody else's system -------------------------------
        // These three were in the Proposal union from the beginning with no
        // branch here, so accepting one settled it and wrote nothing at all —
        // the worst possible failure, because the queue said it had happened.

        if (p.kind === 'update_issue') {
          const payload = p.payload as { key: WorkItemKey; patch: Partial<WorkItem> };
          if (!payload.key || !payload.patch) return { error: 'update_issue needs a key and a patch' };

          // FIELD_OWNER as a runtime guard, not just a doc comment. A proposal
          // that tries to write `position` is Miro's field arriving through the
          // wrong door, and the whole ownership model is one such write from
          // being decorative.
          const foreign = Object.keys(payload.patch).filter(
            (f) => f in FIELD_OWNER && !mayWrite('jira', f as OwnedField),
          );
          if (foreign.length) {
            return { error: `not Jira's to write: ${foreign.join(', ')} — see FIELD_OWNER` };
          }

          const updated = await c.jira.updateItem(payload.key, payload.patch);
          settle(p, 'accepted');
          return { updated: updated.key, patch: payload.patch, echoToken: token };
        }

        if (p.kind === 'link_issues') {
          const payload = p.payload as { from: WorkItemKey; to: WorkItemKey; type?: string };
          if (!payload.from || !payload.to) return { error: 'link_issues needs from and to' };

          await c.jira.linkItems(payload.from, payload.to, payload.type ?? 'relates to');
          log.append(
            newEvent({
              source: 'jira',
              type: 'workitem.linked',
              entityKey: payload.from,
              // NOT the outbound token: `causedBy` is the id of the triggering
              // event, and putting our own echo token here makes `append`
              // suppress this event as an echo of itself. That is exactly what
              // swallowed workitem.linked the first time it was written.
              payload: { from: payload.from, to: payload.to, type: payload.type ?? 'relates to' },
            }),
          );
          settle(p, 'accepted');
          await journalProposal(vault, p, 'accepted');
          return { linked: `${payload.from} → ${payload.to}`, echoToken: token };
        }

        if (p.kind === 'post_message') {
          const payload = p.payload as { channelId?: string; text: string };
          if (!payload.text) return { error: 'post_message needs text' };
          const channel = payload.channelId ?? process.env.SLACK_DEFAULT_CHANNEL ?? 'C-mc';
          const posted = await c.slack.post(channel, payload.text);
          settle(p, 'accepted');
          return { posted: posted.ts, channel, echoToken: token };
        }

        settle(p, 'accepted');
        if (JOURNAL_ON_ACCEPT.has(p.kind)) await journalProposal(vault, p, 'accepted');
        return { ok: true, echoToken: token };
      },
    },
  ];
}
