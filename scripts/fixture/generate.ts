/**
 * Turn the invented programme into the file the collectors will one day write.
 *
 * The point of generating rather than hand-writing: `graph.json` and `records/`
 * are the SAME artefact a real collector produces, so going live is a change of
 * which collector wrote the file and never a change of layer. Everything
 * downstream — the detectors, the findings pass, the alert pages — is developed
 * against the real shape from the first day.
 *
 * Deterministic on purpose. A demo that rearranges itself between runs cannot be
 * pointed at in a meeting, and a fixture that changes cannot be reasoned about
 * when a detector suddenly stops firing. There is no randomness here at all: the
 * only derived values are timestamps, and they are derived from the spec's own
 * dates.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  edgeObservationKey,
  isRenderableEdge,
  type ConfidenceTier,
  type EdgeObservation,
  type ObservationIndex,
  type StoredEdge,
  type StoredGraph,
  type StoredNode,
  type StoredRelation,
} from '../../libs/domain/src/index.js';
import type { McEvent, Note } from '../../libs/domain/src/index.js';
import { encodeNote } from '../../libs/vault/src/store.js';
import { ISSUES, PEOPLE, SPRINTS, VOCAB, type IssueSpec } from './programme.js';
import { CLAIMS, MESSAGES, PAGES, PULL_REQUESTS, STICKIES, TRANSCRIPTS } from './records.js';

const GENERATOR = 'mission-control fixture generator';

/** The moment the fixture is "as of". Every relative date derives from it. */
export const FIXTURE_NOW = '2026-08-23T09:00:00.000Z';

const email = (handle: string): string => `${handle}@${VOCAB.domain}`;
const personId = (handle: string): string => `person:${email(handle)}`;
const issueId = (key: string): string => `issue:${key}`;
const sprintId = (name: string): string => `sprint:${name}`;
const squadId = (id: string): string => `squad:${id}`;

/** A day-granular date to a full ISO stamp, at a plausible working hour. */
const at = (day: string, hour = 9): string =>
  day.includes('T') ? new Date(day).toISOString() : new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`).toISOString();

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

interface Built {
  nodes: StoredNode[];
  edges: StoredEdge[];
  /** Full record bodies, written to `records/<kind>/<id>.json`. */
  records: { kind: string; id: string; payload: unknown }[];
  /** Backdated transitions. See `buildEvents`. */
  events: McEvent[];
  /** Claims, as vault notes. See `buildNotes`. */
  notes: Note[];
}

/**
 * The claims, written as vault notes rather than only as graph nodes.
 *
 * A claim is the ASSERTED layer — nobody can re-read a promise out of Jira, so
 * it accumulates and is never rebuilt — and the vault is where that layer lives.
 * The graph carries the same claims as `note` nodes so the relation graph and
 * Sources can see them, but the durable copy — the one a human edits and a
 * detector reads — is the markdown.
 *
 * Encoded with the vault's own `encodeNote`, not a hand-rolled template: the
 * frontmatter is a deliberately small YAML subset, and a second writer of it is
 * a second thing to get subtly wrong.
 */
/** What a citation calls its source, in the words the reader would use. */
function labelFor(surface: string, id: string): string {
  if (surface === 'zoom') return TRANSCRIPTS.find((t) => t.id === id)?.topic ?? id;
  if (surface === 'miro') {
    const s = STICKIES.find((x) => x.id === id);
    return s ? `${s.frame} frame — ${s.author}` : id;
  }
  const m = MESSAGES.find((x) => x.id === id);
  return m ? `#${m.channel} — ${m.author}` : id;
}

function buildNotes(): Note[] {
  return CLAIMS.map((c) => {
    const joins = Object.fromEntries(
      c.joins.map((j) => [
        j.key,
        { tier: j.tier, ...(j.why ? { why: j.why } : {}), ...(j.confidence !== undefined ? { confidence: j.confidence } : {}) },
      ]),
    );
    return {
      id: c.id,
      kind: c.kind,
      title: c.title,
      relatedKeys: c.joins.map((j) => j.key),
      ...(c.joins.length ? { joins } : {}),
      links: [],
      tags: [],
      recency: 'dated' as const,
      verifiedAt: at(c.at),
      status: c.status,
      ...(c.owner ? { owner: `${c.owner}@${VOCAB.domain}` } : {}),
      ...(c.dueAt ? { dueAt: at(c.dueAt, 17) } : {}),
      ...(c.container ? { container: c.container } : {}),
      evidence: c.evidence.map((e) => {
        const [kind, id] = e.record.split(':') as [string, string];
        const surface = (kind === 'zoom' ? 'zoom' : kind === 'miro' ? 'miro' : 'slack') as
          Note['evidence'][number]['surface'];
        return {
          surface,
          // The label is for a person; the ref is for the app. A citation that
          // cannot be opened is an assertion with a footnote.
          label: labelFor(surface, id),
          quote: e.quote,
          ...(e.at !== undefined ? { at: e.at } : {}),
          ref: { surface, id, ...(e.at !== undefined ? { at: e.at } : {}) },
        };
      }),
      createdAt: at(c.at),
      updatedAt: at(c.at),
      body: c.body,
    };
  });
}

/**
 * The history the graph cannot hold.
 *
 * `graph.json` is the derived layer — a snapshot of what is true now — so it
 * says a ticket is in Code Review and cannot say it has been there nine days.
 * Every "how long has this sat" answer, `buildTimeline` and the aging
 * signal read transitions off the durable log instead, and in a fixture there is
 * nobody to have produced them.
 *
 * So the generator emits them, from the SAME spec the nodes come from. Typed out
 * separately they would drift, and the failure is silent in the worst way: the
 * board shows one status and the timeline ends in another.
 *
 * Deterministic, like everything else here — the spread between transitions is a
 * function of the issue's own dates, not a random walk.
 */
function buildEvents(): McEvent[] {
  /**
   * The generator does NOT use `newEvent`, and that is the whole point.
   *
   * `newEvent` stamps `Date.now()` into the id, which is right for an event
   * that is happening and wrong for one that is being generated: every re-run
   * rewrote all 46 ids, so `events.jsonl` was the one output that was not
   * byte-identical and `git status` was dirty after a fixture regenerate that
   * had changed nothing. The claim this file makes about itself — same
   * checkout, same board, same screenshot — has to be true of the ids too.
   *
   * So the id derives from `FIXTURE_NOW`, the fixed clock everything else here
   * already derives from, keeping `newEvent`'s exact shape.
   */
  const stamp = Date.parse(FIXTURE_NOW).toString(36);
  let seq = 0;
  const event = <P>(init: Omit<McEvent<P>, 'id'>): McEvent<P> => ({
    ...init,
    id: `evt_${stamp}_${(seq++).toString(36)}`,
  });

  const events: McEvent[] = [];
  const day = (iso: string, plus = 0, hour = 10): string =>
    new Date(new Date(`${iso}T00:00:00Z`).getTime() + plus * 86_400_000 + hour * 3_600_000).toISOString();

  for (const i of ISSUES) {
    if (i.level === 'initiative' || i.level === 'epic') continue;

    events.push(
      event({
        ts: day(i.createdAt, 0, 9),
        source: 'jira',
        type: 'workitem.created',
        entityKey: i.key,
        actor: i.assignee ?? 'riya',
        payload: i.sprint ? { sprint: i.sprint } : {},
      }),
    );

    // The walk to where it stands now. A resolved ticket runs the whole path
    // inside its own dates; an open one stops at its current status, and the gap
    // between that last transition and today IS "how long it has sat" — the
    // number the aging signal reports and the storyline draws as a tail.
    const from = i.createdAt;
    const to = i.resolvedAt;
    const path: { at: string; from: string; to: string }[] = [];
    const push = (at: string, a: string, b: string): void => path.push({ at, from: a, to: b });

    if (to) {
      const span = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000));
      push(day(from, Math.max(1, Math.round(span * 0.2))), 'todo', 'in_progress');
      push(day(from, Math.max(2, Math.round(span * 0.7))), 'in_progress', 'in_review');
      push(day(to, 0, 16), 'in_review', 'done');
    } else if (i.status === 'To Do') {
      // Never picked up. No transition at all, which is the honest record — and
      // the dossier says "we do not know" rather than inventing a zero.
    } else if (i.status === 'Blocked') {
      push(day(from, 1), 'todo', 'in_progress');
      push(day(from, 3), 'in_progress', 'blocked');
    } else {
      push(day(from, 1), 'todo', 'in_progress');
      if (i.status === 'Code Review' || i.status === 'QA') push(day(from, 2), 'in_progress', 'in_review');
    }

    for (const p of path) {
      events.push(
        event({
          ts: p.at,
          source: 'jira',
          type: 'workitem.status_changed',
          entityKey: i.key,
          actor: i.assignee ?? 'riya',
          payload: { from: p.from, to: p.to },
        }),
      );
    }
  }

  // A closed sprint is a container closing, which is the moment an alert is
  // allowed to fire. There is no `sprint.closed` in `McEventType` yet, so the
  // detector reads `state` off the sprint node; this is here so the log tells
  // the same story the graph does.
  for (const s of SPRINTS) {
    if (s.state !== 'closed') continue;
    events.push(
      event({
        ts: day(s.endsAt, 0, 17),
        source: 'jira',
        type: 'workitem.updated',
        actor: 'riya',
        payload: { sprint: s.name, closed: true },
      }),
    );
  }

  return events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function build(): Built {
  const nodes: StoredNode[] = [];
  const edges: StoredEdge[] = [];
  const records: Built['records'] = [];

  const edge = (
    source: string,
    target: string,
    relation: StoredRelation,
    tier: ConfidenceTier,
    origin: StoredEdge['origin'],
    extra: Partial<StoredEdge> = {},
  ): void => {
    edges.push({ source, target, relation, tier, origin, evidence: [], ...extra });
  };

  // ---- org ----------------------------------------------------------------
  nodes.push({ id: `tribe:${VOCAB.tribe.id}`, kind: 'tribe', label: VOCAB.tribe.name, source: 'jira' });
  nodes.push({ id: `goal:${VOCAB.goal.id}`, kind: 'goal', label: VOCAB.goal.name, source: 'jira' });
  for (const s of Object.values(VOCAB.squads)) {
    nodes.push({ id: squadId(s.id), kind: 'squad', label: s.name, source: 'jira' });
  }

  // ---- people -------------------------------------------------------------
  for (const p of PEOPLE) {
    nodes.push({
      id: personId(p.handle),
      kind: 'person',
      label: p.name,
      source: 'jira',
      email: email(p.handle),
      displayName: p.name,
      // The per-source handles are the identity map, in the graph rather than a
      // side file: a Slack author, a Zoom speaker and a Jira assignee are three
      // different strings for one person, and nothing else reconciles them.
      handles: { slack: p.handle, jira: p.handle, zoom: p.name, github: `${p.handle}-dev` },
    });

    edge(personId(p.handle), squadId(VOCAB.squads[p.squad].id), 'member_of', 'EXTRACTED', 'structural', {
      ...(p.formerSquad ? { validFrom: at(`${p.formerSquad.until}`) } : {}),
    });

    // The reorg. Dated membership is the only thing that can answer "who owns
    // this now" when the person who agreed it has moved on.
    if (p.formerSquad) {
      edge(personId(p.handle), squadId(VOCAB.squads[p.formerSquad.squad].id), 'member_of', 'EXTRACTED', 'structural', {
        validTo: at(p.formerSquad.until),
        why: 'moved teams in the July reorg',
      });
    }
  }

  // ---- sprints ------------------------------------------------------------
  for (const s of SPRINTS) {
    nodes.push({
      id: sprintId(s.name),
      kind: 'sprint',
      label: s.name,
      source: 'jira',
      state: s.state,
      startsAt: at(s.startsAt),
      endsAt: at(s.endsAt, 17),
      ...(s.state === 'closed' ? { closedAt: at(s.endsAt, 17) } : {}),
    });
  }

  // ---- issues -------------------------------------------------------------
  const byKey = new Map<string, IssueSpec>(ISSUES.map((i) => [i.key, i]));
  for (const i of ISSUES) {
    nodes.push({
      id: issueId(i.key),
      kind: 'issue',
      label: i.title,
      source: 'jira',
      key: i.key,
      level: i.level,
      status: i.status,
      statusCategory: VOCAB.statuses[i.status],
      ...(i.assignee ? { assignee: email(i.assignee) } : {}),
      ...(i.points ? { points: i.points } : {}),
      createdAt: at(i.createdAt),
      ...(i.resolvedAt ? { resolvedAt: at(i.resolvedAt, 17) } : {}),
      url: `https://example.atlassian.net/browse/${i.key}`,
      updatedAt: at(i.resolvedAt ?? i.createdAt, 12),
    });

    if (i.parent) {
      const rel: StoredRelation = byKey.get(i.parent)?.level === 'epic' ? 'belongs_to_epic' : 'child_of';
      edge(issueId(i.key), issueId(i.parent), rel, 'EXTRACTED', 'structural', {
        evidence: [{ source: 'jira', ref: issueId(i.parent) }],
      });
    }
    if (i.assignee) {
      edge(issueId(i.key), personId(i.assignee), 'assigned_to', 'EXTRACTED', 'structural');
    }
    if (i.sprint) {
      edge(issueId(i.key), sprintId(i.sprint), 'in_sprint', 'EXTRACTED', 'structural');
    }
    // Ownership follows the assignee's squad, which is how the real custom field
    // is populated in practice.
    const squad = i.assignee ? PEOPLE.find((p) => p.handle === i.assignee)?.squad : undefined;
    if (squad) edge(issueId(i.key), squadId(VOCAB.squads[squad].id), 'owned_by', 'EXTRACTED', 'structural');
    if (i.level === 'initiative') {
      edge(issueId(i.key), `goal:${VOCAB.goal.id}`, 'supports_goal', 'EXTRACTED', 'structural');
    }

    if (i.description) {
      records.push({ kind: 'issue', id: i.key, payload: { key: i.key, title: i.title, description: i.description } });
    }
  }

  // ---- declared dependencies, which start AMBIGUOUS -----------------------
  //
  // A "blocks" link is a claim, not a fact, until something independent
  // corroborates it. Reconciliation below promotes the corroborated ones.
  for (const i of ISSUES) {
    for (const blocker of i.dependsOn ?? []) {
      edge(issueId(i.key), issueId(blocker), 'depends_on', 'AMBIGUOUS', 'declared', {
        evidence: [{ source: 'jira', ref: `${i.key} is blocked by ${blocker}` }],
        reconciled: false,
      });
    }
  }

  // ---- reconstructed dependencies, from prose -----------------------------
  const PROSE_DEP = /\bblocked by ([A-Z][A-Z0-9]+-\d+)\b/gi;
  for (const i of ISSUES) {
    if (!i.description) continue;
    for (const m of i.description.matchAll(PROSE_DEP)) {
      const blocker = m[1]!;
      edge(issueId(i.key), issueId(blocker), 'depends_on', 'INFERRED', 'reconstructed', {
        why: `${i.key}'s description says it is blocked by ${blocker}`,
        score: 3,
        evidence: [{ source: 'jira', ref: issueId(i.key), quote: m[0] }],
      });
    }
  }

  // ---- reconciliation -----------------------------------------------------
  //
  // The three outcomes, and two of them are findings in their own right:
  // corroborated → EXTRACTED, reconstructed-only → stays INFERRED (a dependency
  // Jira never recorded), declared-only → stays AMBIGUOUS (a link nothing backs).
  const declared = edges.filter((e) => e.relation === 'depends_on' && e.origin === 'declared');
  const reconstructed = new Set(
    edges
      .filter((e) => e.relation === 'depends_on' && e.origin === 'reconstructed')
      .map((e) => `${e.source}→${e.target}`),
  );
  for (const d of declared) {
    d.reconciled = true;
    if (reconstructed.has(`${d.source}→${d.target}`)) {
      d.tier = 'EXTRACTED';
      d.why = 'declared in Jira and corroborated by the ticket description';
    } else {
      const target = ISSUES.find((i) => issueId(i.key) === d.target);
      d.why =
        target && VOCAB.statuses[target.status] === 'done'
          ? `declared, uncorroborated, and ${target.key} is already ${target.status}`
          : 'declared in Jira with nothing independent behind it';
    }
  }

  // ---- meetings -----------------------------------------------------------
  for (const t of TRANSCRIPTS) {
    const id = `meeting:zoom/${t.id}`;
    nodes.push({
      id,
      kind: 'meeting',
      label: t.topic,
      source: 'zoom',
      at: at(t.startedAt),
      recordRef: `records/meeting/${t.id}.json`,
    });
    records.push({ kind: 'meeting', id: t.id, payload: t });

    for (const p of t.participants) edge(personId(p), id, 'attended', 'EXTRACTED', 'structural');
    for (const seg of t.segments) {
      for (const key of seg.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
        if (!byKey.has(key)) continue;
        edge(id, issueId(key), 'mentions', 'EXTRACTED', 'structural', {
          evidence: [{ source: 'zoom', ref: id, quote: seg.text, at: seg.at }],
        });
      }
    }
  }

  // ---- messages -----------------------------------------------------------
  for (const m of MESSAGES) {
    const id = `message:slack/${m.channel}/${m.id}`;
    nodes.push({
      id,
      kind: 'message',
      label: `#${m.channel} — ${m.author}`,
      source: 'slack',
      at: at(m.at),
      container: `channel:slack/${m.channel}`,
      recordRef: `records/message/${m.id}.json`,
    });
    records.push({ kind: 'message', id: m.id, payload: m });
    edge(id, personId(m.author), 'authored_by', 'EXTRACTED', 'structural');

    for (const key of m.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
      if (!byKey.has(key)) continue;
      edge(id, issueId(key), 'mentions', 'EXTRACTED', 'structural', {
        evidence: [{ source: 'slack', ref: id, quote: m.text }],
      });
    }

    // The URL join. A Confluence link in a message names no ticket, and this is
    // the only edge that will ever attach it to the work.
    for (const url of m.text.match(/https?:\/\/\S+/g) ?? []) {
      const page = PAGES.find((p) => url.includes(`/${p.id}/`));
      if (!page) continue;
      edge(id, `page:confluence/${page.id}`, 'links_to', 'EXTRACTED', 'structural', {
        evidence: [{ source: 'slack', ref: id, quote: url }],
      });
    }
  }

  // ---- pages --------------------------------------------------------------
  for (const p of PAGES) {
    const id = `page:confluence/${p.id}`;
    nodes.push({
      id,
      kind: 'page',
      label: p.title,
      source: 'confluence',
      at: at(p.at),
      container: `space:confluence/${VOCAB.confluenceSpace}`,
      url: `https://example.atlassian.net/wiki/spaces/${VOCAB.confluenceSpace}/pages/${p.id}`,
      recordRef: `records/page/${p.id}.json`,
    });
    records.push({ kind: 'page', id: p.id, payload: p });
    edge(id, personId(p.author), 'authored_by', 'EXTRACTED', 'structural');
    for (const key of p.keys) {
      edge(id, issueId(key), 'documents', 'EXTRACTED', 'structural', {
        evidence: [{ source: 'confluence', ref: id, quote: p.title }],
      });
    }
  }

  // ---- board --------------------------------------------------------------
  const boardId = `board:miro/${VOCAB.miroBoard}`;
  nodes.push({ id: boardId, kind: 'board', label: 'Payments reliability', source: 'miro' });
  const frames = [...new Set(STICKIES.map((s) => s.frame))];
  for (const f of frames) {
    const id = `frame:miro/${VOCAB.miroBoard}/${f}`;
    nodes.push({ id, kind: 'frame', label: f, source: 'miro' });
    edge(id, boardId, 'on_board', 'EXTRACTED', 'structural');
  }
  for (const s of STICKIES) {
    const id = `sticky:miro/${VOCAB.miroBoard}/${s.id}`;
    nodes.push({ id, kind: 'sticky', label: s.text, source: 'miro', recordRef: `records/sticky/${s.id}.json` });
    records.push({ kind: 'sticky', id: s.id, payload: s });
    edge(id, `frame:miro/${VOCAB.miroBoard}/${s.frame}`, 'in_frame', 'EXTRACTED', 'structural');
    edge(id, personId(s.author), 'authored_by', 'EXTRACTED', 'structural');
    for (const key of s.text.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []) {
      if (!byKey.has(key)) continue;
      edge(id, issueId(key), 'mentions', 'EXTRACTED', 'structural', {
        evidence: [{ source: 'miro', ref: id, quote: s.text }],
      });
    }
  }

  // ---- pull requests ------------------------------------------------------
  for (const pr of PULL_REQUESTS) {
    const id = `pr:github/${VOCAB.githubRepo.owner}/${VOCAB.githubRepo.name}/${pr.number}`;
    nodes.push({
      id,
      kind: 'pr',
      label: pr.title,
      source: 'github',
      at: at(pr.at),
      url: `https://github.com/${VOCAB.githubRepo.owner}/${VOCAB.githubRepo.name}/pull/${pr.number}`,
      recordRef: `records/pr/${pr.number}.json`,
    });
    records.push({ kind: 'pr', id: String(pr.number), payload: pr });
    edge(id, personId(pr.author), 'authored_by', 'EXTRACTED', 'structural');
    // The branch carries the key — a deterministic join nobody has to type.
    const key = pr.branch.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0];
    if (key && byKey.has(key)) {
      edge(id, issueId(key), 'mentions', 'EXTRACTED', 'structural', {
        evidence: [{ source: 'github', ref: id, quote: pr.branch }],
      });
    }
  }

  // ---- claims -------------------------------------------------------------
  //
  // A claim that joins to nothing is kept, and that is the whole point: the
  // missing ticket IS an unjoined claim, so dropping it would throw away the
  // finding this product exists to raise.
  for (const c of CLAIMS) {
    const id = `note:${c.id}`;
    nodes.push({
      id,
      kind: 'note',
      label: c.title,
      source: 'vault',
      noteKind: c.kind,
      status: c.status,
      recency: 'dated',
      verifiedAt: at(c.at),
      ...(c.owner ? { owner: email(c.owner) } : {}),
      ...(c.dueAt ? { dueAt: at(c.dueAt, 17) } : {}),
      ...(c.container ? { container: c.container } : {}),
      updatedAt: at(c.at),
      recordRef: `records/note/${c.id}.json`,
    });
    records.push({
      kind: 'note',
      id: c.id,
      payload: { ...c, owner: c.owner ? email(c.owner) : undefined },
    });

    for (const j of c.joins) {
      edge(id, issueId(j.key), 'annotates', j.tier, j.tier === 'EXTRACTED' ? 'structural' : 'reconstructed', {
        ...(j.why ? { why: j.why } : {}),
        ...(j.confidence !== undefined ? { score: j.confidence } : {}),
        evidence: c.evidence.map((e) => ({
          source: e.record.split(':')[0]!,
          ref: e.record,
          quote: e.quote,
          ...(e.at !== undefined ? { at: e.at } : {}),
        })),
      });
    }
    if (c.owner) edge(id, personId(c.owner), 'assigned_to', 'EXTRACTED', 'structural');
  }

  return { nodes, edges, records, events: buildEvents(), notes: buildNotes() };
}

// ---------------------------------------------------------------------------
// Validation — the generator will not write a graph it would reject on read
// ---------------------------------------------------------------------------

/**
 * Checked here rather than only in `verify-graph.mts` because a fixture that
 * violates the contract is worse than no fixture: every detector developed
 * against it inherits the violation, and nobody finds out until real data
 * arrives and behaves differently.
 */
export function validate(g: Built): string[] {
  const problems: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));

  const seen = new Set<string>();
  for (const n of g.nodes) {
    if (seen.has(n.id)) problems.push(`duplicate node id: ${n.id}`);
    seen.add(n.id);
    if (!/^[a-z]+:/.test(n.id)) problems.push(`node id is not kind:value — ${n.id}`);
  }

  for (const e of g.edges) {
    if (!ids.has(e.source)) problems.push(`edge from a node that does not exist: ${e.source}`);
    if (!ids.has(e.target)) problems.push(`edge to a node that does not exist: ${e.target}`);
    if (!isRenderableEdge(e)) problems.push(`INFERRED edge with no why: ${e.source} -> ${e.target}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function generate(
  outDir: string,
): Promise<{ nodes: number; edges: number; records: number; events: number; notes: number }> {
  const built = build();

  const problems = validate(built);
  if (problems.length) {
    throw new Error(`the generated fixture violates the contract:\n  ${problems.join('\n  ')}`);
  }

  const graph: StoredGraph = {
    directed: true,
    multigraph: true,
    graph: {
      generatedAt: FIXTURE_NOW,
      generator: GENERATOR,
      sources: ['jira', 'slack', 'zoom', 'confluence', 'miro', 'github', 'vault'],
    },
    nodes: built.nodes,
    links: built.edges,
  };

  // A first observation for every edge, so the index exists from the first run
  // rather than being backfilled. `firstSeen` is the fixture's own "as of":
  // claiming to have watched these edges for months would be a lie the demo
  // does not need to tell.
  const observations: ObservationIndex = {};
  for (const e of built.edges) {
    const o: EdgeObservation = { firstSeen: FIXTURE_NOW, lastConfirmed: FIXTURE_NOW, seenCount: 1 };
    observations[edgeObservationKey(e)] = o;
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
  await writeFile(join(outDir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);

  // JSONL, because that is the format the durable log already appends to — the
  // fixture's history and a running gateway's history are one file, not two.
  await writeFile(
    join(outDir, 'events.jsonl'),
    built.events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  const notesDir = join(outDir, 'notes');
  await mkdir(notesDir, { recursive: true });
  for (const n of built.notes) {
    await writeFile(join(notesDir, `${n.id}.md`), encodeNote(n));
  }

  for (const r of built.records) {
    const dir = join(outDir, 'records', r.kind);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${r.id}.json`), `${JSON.stringify(r.payload, null, 2)}\n`);
  }

  return {
    nodes: built.nodes.length,
    edges: built.edges.length,
    records: built.records.length,
    events: built.events.length,
    notes: built.notes.length,
  };
}
