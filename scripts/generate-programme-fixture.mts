/**
 * A second fixture, shaped like what the five collectors actually emit.
 *
 * WHY A SECOND ONE. `fixtures/` is a designed narrative: 70 nodes, every
 * feature represented, and dense enough that everything joins to something. It
 * is the right thing to demo and the wrong thing to develop a detector against,
 * because real collector output looks nothing like it. Measured on a live
 * programme against the committed fixture:
 *
 *              fixture      live
 *   nodes           70       847
 *   edges/node    2.26      0.42     ← real data is SPARSE
 *   node kinds      14         7
 *   relations       16         5
 *
 * The fixture carries `squad`, `tribe`, `goal`, `board`, `frame` and `sticky`
 * nodes and `owned_by` / `member_of` / `attended` / `authored_by` edges. **No
 * collector in this repo emits any of them.** So a reader developed against
 * `fixtures/` is developed against a world that does not arrive, and the
 * failures that do arrive — a record naming no ticket, a status word nobody
 * mapped, a GitHub handle that is not a person — never show up at all.
 *
 * This generator emits only what `import-jira-issues`, `import-slack-messages`,
 * `import-confluence-pages`, `import-github-prs` and `import-zoom-notes`
 * produce, in their proportions, with their join rates and their failure modes.
 *
 * SAME RULES AS `fixtures/`. Deterministic — no randomness, every value derived
 * from an index or a spec date, so a regenerate is byte-identical and
 * `npm run verify` can assert it. Invented content — nothing here is read from
 * any real source, which is what makes it committable where an export of live
 * data is not, however well sanitised.
 *
 *   npx tsx scripts/generate-programme-fixture.mts
 *   MC_GRAPH_DIR=./fixtures-programme npm run dev
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type {
  McEvent,
  Note,
  StoredEdge,
  StoredGraph,
  StoredNode,
} from '../libs/domain/src/index.js';
import { encodeNote } from '../libs/vault/src/store.js';

const OUT = 'fixtures-programme';
/** The moment this fixture is "as of". Every relative date derives from it. */
const NOW = new Date('2026-08-23T09:00:00.000Z');
const GENERATOR = 'mission-control programme fixture generator';

/** Deterministic index selection. No PRNG state, so inserting a spec line does not reshuffle everything after it. */
const h = (s: string): number => parseInt(createHash('sha256').update(s).digest('hex').slice(0, 8), 16);
const pick = <T,>(pool: readonly T[], seed: string): T => pool[h(seed) % pool.length]!;
const day = (offset: number, hour = 10): string =>
  new Date(NOW.getTime() + offset * 86_400_000).toISOString().replace(/T\d\d:/, `T${String(hour).padStart(2, '0')}:`);

// ---------------------------------------------------------------------------
// Vocabulary — copied from reality in SHAPE only, never in content
// ---------------------------------------------------------------------------

const VOCAB = {
  projects: ['ORB', 'HLX'],
  domain: 'example.com',
  space: 'ORB',
  repos: ['example-org/orbit-web', 'example-org/orbit-api'],
  channels: ['orbit-delivery', 'orbit-eng', 'orbit-releases', 'incidents', 'design-review', 'qa', 'platform'],
  /**
   * A real workflow's words, including one this repo's defaults do NOT map.
   *
   * `Pending Review` is deliberate. `statusCategory` has three values, so an
   * unmapped word makes `in_review` and `blocked` unreachable and the lane goes
   * quietly wrong — `inspect statuses` and `verify-collector` both exist to
   * catch it, and neither has anything to catch on a fixture where every word
   * is already mapped.
   */
  statuses: [
    ['Closed', 'done'], ['Backlog', 'todo'], ['To Do', 'todo'], ['In Development', 'doing'],
    ['Code review', 'doing'], ['Pending Review', 'doing'], ['In Progress', 'doing'], ['Blocked', 'doing'],
  ] as const,
} as const;

const FIRST = ['Ada', 'Bo', 'Cleo', 'Dev', 'Esme', 'Finn', 'Greta', 'Hugo', 'Ivy', 'Jonas',
  'Kira', 'Luca', 'Mara', 'Nils', 'Orla'] as const;
const LAST = ['Ash', 'Bright', 'Calder', 'Dunne', 'Ellis', 'Frost', 'Gale', 'Hart', 'Iver',
  'Jost', 'Kerr', 'Lund', 'Moss', 'Nord', 'Oakes'] as const;

const TOPIC = ['the checkout retry', 'the settlement feed', 'the nav rewrite', 'the audit log',
  'the rate limiter', 'the migration job', 'the search index', 'the webhook fan-out',
  'the session store', 'the export pipeline', 'the pricing table', 'the consent banner'] as const;
const VERB = ['Fix', 'Add', 'Remove', 'Rework', 'Investigate', 'Document', 'Split', 'Harden',
  'Instrument', 'Cache', 'Retry', 'Batch'] as const;
const CHATTER = ['Morning all.', 'Nothing blocking from me.', 'Same as yesterday.',
  'I will pick that up after standup.', 'Agreed.', 'Let us take that offline.',
  'Numbers look fine.', 'No update today.', 'That is the last of it.',
  'Can we come back to this on Thursday?', 'Deploy window is Thursday.',
  'The staging box is flaky again.'] as const;
const TASK = ['write up the rollout plan', 'confirm the migration window',
  'add the missing integration test', 'review the schema change', 'chase the vendor sandbox',
  'document the retry policy', 'split the batch job', 'update the runbook',
  'check the cache invalidation', 'agree the error budget', 'draft the decision record',
  'measure the cold start'] as const;

const nodes: StoredNode[] = [];
const edges: StoredEdge[] = [];
const records: { kind: string; name: string; payload: unknown }[] = [];
const notes: Note[] = [];
const events: McEvent[] = [];

// ---------------------------------------------------------------------------
// Jira — run first, because it supplies the keys and people everything joins on
// ---------------------------------------------------------------------------

interface Person { handle: string; name: string; email: string; }
const people: Person[] = FIRST.map((f, i) => {
  const name = `${f} ${LAST[i]!}`;
  const handle = name.toLowerCase().replace(' ', '.');
  return { handle, name, email: `${handle}@${VOCAB.domain}` };
});
for (const p of people) {
  nodes.push({
    id: `person:${p.email}`, kind: 'person', source: 'jira', label: p.name,
    email: p.email, displayName: p.name, handles: { jira: p.handle, slack: p.handle },
  });
}

/** Four closed sprints, one active, two ahead. A container that CLOSES is what fires the flagship alert. */
const SPRINTS = [
  { n: 28, state: 'closed', start: -84, end: -70 },
  { n: 29, state: 'closed', start: -70, end: -56 },
  { n: 30, state: 'closed', start: -56, end: -42 },
  { n: 31, state: 'closed', start: -42, end: -28 },
  { n: 32, state: 'closed', start: -28, end: -14 },
  { n: 33, state: 'active', start: -14, end: 0 },
  { n: 34, state: 'future', start: 0, end: 14 },
] as const;
for (const s of SPRINTS) {
  nodes.push({
    id: `sprint:Orbit ${s.n}`, kind: 'sprint', source: 'jira', label: `Orbit ${s.n}`,
    state: s.state, startsAt: day(s.start), endsAt: day(s.end),
    ...(s.state === 'closed' ? { closedAt: day(s.end, 17) } : {}),
  });
}

/**
 * A future sprint exists as a node and carries NO work, which is both realistic
 * and load-bearing.
 *
 * `activeSprintOf` reads the sprint NAMES on the items and sorts them
 * naturally — it never sees `state`, because `programme_graph` emits sprints
 * only as strings on an issue. So any item filed against the highest-numbered
 * sprint makes that one "active" whatever its node says, and the whole lane
 * moves to work nobody has started. Twelve items in `Orbit 34` sent every
 * planted case out of view and the front door showed nothing but the flagship.
 */
const WORKED = SPRINTS.filter((s) => s.state !== 'future');

const ISSUE_COUNT = 80;
interface Issue { key: string; level: string; status: string; cat: string; sprint: number; assignee?: string; label: string; handle?: string; }
const issues: Issue[] = [];

/**
 * The planted cases live on the ACTIVE sprint, and they have to.
 *
 * `gatherWorkFacts` builds the lane from work that is still in play, so a cycle
 * or a contradiction planted on a closed, resolved ticket is invisible — the
 * detector is correct to ignore it and the fixture looks like it has no cases.
 * Indices 60–71 are the active sprint; see the `sprint` derivation below.
 */
const CYCLE = [60, 62, 64, 66];
const DISPUTED = 61;
const STALE = 63;

/**
 * ⟨CASE: aging, bounded⟩ Work CARRIED out of a closed sprint into the active one.
 *
 * Two things in the live shape were missing here and each disabled a detector
 * silently.
 *
 * **Every issue carried the same `updatedAt`** — `day(sprint.end, 12)` — so all
 * twenty issues in the active sprint were last touched at the same instant. A
 * real Jira spreads `updated` across the sprint, and the spread IS the signal:
 * with no event log to measure from, `now - updatedAt` is the only honest
 * account of how long a ticket has sat, and a fixture where it is constant is a
 * fixture in which `aging` cannot fire on the live shape at all. Measured
 * before this: the bounded basis computed correctly for all six lane rows and
 * every one of them read 2.6 days, so nothing crossed any threshold.
 *
 * **No issue had more than one `in_sprint` edge**, so `carriedFrom` was empty
 * for all eighty and the carry evidence row was unreachable. `sprintNames()` on
 * a real board returns a LIST and `import-jira-issues.mts` emits one edge per
 * name, so carryover is the normal case live and was the impossible case here.
 *
 * These indices are on the active sprint, are not otherwise planted, and each
 * gets an extra `in_sprint` edge to the sprint before plus an `updatedAt` from
 * that sprint — which is what a ticket nobody has touched since actually looks
 * like.
 */
const CARRIED = [65, 67, 69];

/**
 * ⟨CASE: unlinked_commitment, NEGATIVE⟩ Two tickets one person could plausibly
 * mean.
 *
 * `TWIN` is given the same assignee as `TWIN_OF` and a title that overlaps it,
 * both in the same sprint — so a promise phrased about either clears every
 * floor against BOTH, and `reconstructCommitmentJoin` must mint nothing.
 *
 * Without this the refusal path is code nothing exercises, and the refusal is
 * the part of the design that matters: measured on `fixtures/`, the
 * highest-scoring candidate for a real promise was the WRONG ticket, so a rule
 * that broke ties by score would confidently invent a link and attach a
 * plausible reason to it. Ambiguity has to stay a refusal, and a refusal needs
 * a fixture that provokes it.
 */
const TWIN_OF = 57;
const TWIN = 59;

/**
 * Days since a live ticket was last touched, drawn from a WEIGHTED table.
 *
 * Uniform `h % 12` was the first version and it is not what a sprint looks
 * like: it flagged twelve of the twenty tickets in the active sprint, which is
 * the dashboard the front door may not become. Real work clusters — most of it
 * was touched in the last few days, and the interesting minority is the tail.
 *
 * A literal table rather than a distribution because it is readable, it is
 * trivially tunable, and it is deterministic by construction — which the
 * byte-identical regenerate check requires. Fourteen entries: ten inside a
 * working week, four in the tail that `aging` exists to surface.
 */
const IDLE = [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 8, 11, 13, 16];
const PLANTED = new Set([...CYCLE, DISPUTED, STALE]);

for (let i = 0; i < ISSUE_COUNT; i++) {
  const project = i < 68 ? VOCAB.projects[0]! : VOCAB.projects[1]!;
  const key = `${project}-${1200 + i * 7}`;
  // Epics first so `belongs_to_epic` always has a target that already exists.
  const level = i < 6 ? 'epic' : i % 11 === 0 ? 'bug' : i % 17 === 0 ? 'spike' : i % 3 === 0 ? 'task' : 'story';
  const sprint = WORKED[Math.min(WORKED.length - 1, Math.floor(i / 12))]!;
  const [status, cat] = pick(VOCAB.statuses, `st${i}`);
  // A closed sprint's work is overwhelmingly closed. Anything else reads as a
  // programme where nothing ever finishes, which makes every age meaningless.
  const settled = sprint.state === 'closed' && i % 9 !== 0;
  const planted = PLANTED.has(i);
  const person =
    i === TWIN && issues[TWIN_OF]?.assignee
      ? people.find((q) => q.email === issues[TWIN_OF]!.assignee)!
      : i % 13 === 0 && !planted
        ? undefined
        : people[h(`as${i}`) % people.length]!;
  /**
   * The twin borrows the other one's topic and owner, so the pair is
   * indistinguishable to a rule that only reads titles and assignees.
   */
  const twinOf = i === TWIN ? issues[TWIN_OF] : undefined;
  const label = twinOf
    ? `${pick(VERB, `v${i}`)} ${twinOf.label.replace(/^\w+ /, '')}`
    : `${pick(VERB, `v${i}`)} ${pick(TOPIC, `t${i}`)}`;
  const issue: Issue = {
    key, level, label,
    status: planted ? 'In Development' : settled ? 'Closed' : status,
    cat: planted ? 'doing' : settled ? 'done' : cat,
    sprint: sprint.n,
    assignee: person?.email,
    ...(person ? { handle: person.handle } : {}),
  };
  issues.push(issue);

  const created = day(sprint.start - 3, 9);
  const carried = CARRIED.includes(i) && !planted;
  const previous = WORKED[WORKED.indexOf(sprint) - 1];

  /**
   * When Jira last saw this ticket touched, and it must VARY.
   *
   * Settled work stops moving at its resolution. Live work is touched somewhere
   * inside its sprint — deterministically scattered by the same hash everything
   * else here uses, so a re-run is byte-identical. A carried ticket keeps the
   * date it stopped being touched, which is the whole case: it is the ticket
   * nobody has looked at since the sprint before, and it is the one a person
   * needs to see.
   */
  const lastTouched = settled
    ? day(sprint.end - 1, 16)
    : carried && previous
      ? day(previous.start + (h(`up${i}`) % 4), 11)
      : day(sprint.end - IDLE[h(`up${i}`) % IDLE.length]!, 11);

  nodes.push({
    id: `issue:${key}`, kind: 'issue', source: 'jira',
    label,
    key, level: level as never, status: issue.status, statusCategory: issue.cat as never,
    ...(person ? { assignee: person.handle } : {}),
    createdAt: created,
    ...(issue.cat === 'done' ? { resolvedAt: day(sprint.end - 1, 16) } : {}),
    updatedAt: lastTouched,
    url: `https://example.com/browse/${key}`,
  });

  edges.push({
    source: `issue:${key}`, target: `sprint:Orbit ${sprint.n}`, relation: 'in_sprint',
    tier: 'EXTRACTED', origin: 'structural', evidence: [],
  });
  // The carry: still in the sprint it did not finish in, and in this one too.
  if (carried && previous) {
    edges.push({
      source: `issue:${key}`, target: `sprint:Orbit ${previous.n}`, relation: 'in_sprint',
      tier: 'EXTRACTED', origin: 'structural', evidence: [],
    });
  }
  if (person) {
    edges.push({
      source: `issue:${key}`, target: `person:${person.email}`, relation: 'assigned_to',
      tier: 'EXTRACTED', origin: 'structural', evidence: [],
    });
  }
  if (level !== 'epic' && i % 2 === 0) {
    edges.push({
      source: `issue:${key}`, target: `issue:${issues[i % 6]!.key}`, relation: 'belongs_to_epic',
      tier: 'EXTRACTED', origin: 'structural', evidence: [],
    });
  }
}

/**
 * Dependencies, including one deliberate cycle.
 *
 * `A depends_on B` means A waits for B. Only EXTRACTED may feed cycle
 * detection, so the loop is declared-and-corroborated and the guesses below are
 * not. ONE cycle: a second dilutes the banner into noise.
 */
const CYCLE_EDGES = CYCLE;
for (let i = 0; i < CYCLE_EDGES.length; i++) {
  edges.push({
    source: `issue:${issues[CYCLE_EDGES[i]!]!.key}`,
    target: `issue:${issues[CYCLE_EDGES[(i + 1) % CYCLE_EDGES.length]!]!.key}`,
    relation: 'depends_on', tier: 'EXTRACTED', origin: 'declared', reconciled: true, evidence: [],
  });
}
for (let i = 0; i < 12; i++) {
  const a = issues[30 + i]!, b = issues[41 + i]!;
  edges.push({
    source: `issue:${a.key}`, target: `issue:${b.key}`, relation: 'depends_on',
    tier: 'EXTRACTED', origin: 'declared', reconciled: true, evidence: [],
  });
}
// A declared link nothing corroborates, and a guess with nothing declared. Both
// are findings rather than defects, and both belong on Sources rather than the
// front door — see COVERAGE_KINDS.
for (let i = 0; i < 5; i++) {
  edges.push({
    source: `issue:${issues[55 + i]!.key}`, target: `issue:${issues[62 + i]!.key}`,
    relation: 'depends_on', tier: 'AMBIGUOUS', origin: 'declared', reconciled: false, evidence: [],
  });
}
for (let i = 0; i < 4; i++) {
  edges.push({
    source: `issue:${issues[24 + i]!.key}`, target: `issue:${issues[36 + i]!.key}`,
    relation: 'depends_on', tier: 'INFERRED', origin: 'reconstructed',
    why: 'Named together in a release checklist and never linked in the tracker.',
    score: 0.62, reconciled: false, evidence: [],
  });
}

// ---------------------------------------------------------------------------
// Slack — most lines name no ticket, which is the point
// ---------------------------------------------------------------------------

/**
 * THE JOIN RATE IS THE REALISM.
 *
 * `extractKeys` is a regex, so a record joins only when somebody typed a key —
 * and on a real corpus most did not. A fixture where every message carries a
 * key makes the graph look connected and hides the single biggest gap in the
 * product, which is why `infer.ts` exists at all.
 */
const MESSAGE_COUNT = 90;
for (let i = 0; i < MESSAGE_COUNT; i++) {
  const channel = pick(VOCAB.channels, `ch${i}`);
  const author = people[h(`ma${i}`) % people.length]!;
  const carriesKey = i % 4 === 0;
  const subject = issues[h(`mk${i}`) % 60]!;
  const at = day(-70 + i * 0.7, 9 + (i % 8));
  const text = carriesKey
    ? i % 12 === 0
      ? `${subject.key} is done — merged and out on staging.`
      : i % 12 === 4
        ? `${subject.key} is still blocked on the vendor sandbox.`
        : `Picking up ${subject.key} today.`
    : pick(CHATTER, `mc${i}`);
  const name = `msg-${String(i + 1).padStart(4, '0')}`;
  nodes.push({
    id: `message:slack/${channel}/${name}`, kind: 'message', source: 'slack',
    label: text.slice(0, 60), at, container: channel,
    recordRef: `records/message/${name}.json`,
    url: `https://example.com/archives/${channel}/p${i}`,
  });
  records.push({ kind: 'message', name, payload: { id: name, channel, author: author.handle, at, text } });
  if (carriesKey) {
    edges.push({
      source: `message:slack/${channel}/${name}`, target: `issue:${subject.key}`, relation: 'mentions',
      tier: 'EXTRACTED', origin: 'structural',
      evidence: [{ source: 'slack', ref: `message:slack/${channel}/${name}`, quote: text }],
    });
  }
}

/**
 * One pair that cannot both be current, planted on purpose.
 *
 * `findContradictions` reads a done-claim against the newest thing that
 * disagrees, and the detector is worth nothing unless something in the fixture
 * actually trips it.
 */
const disputed = issues[DISPUTED]!;
// Two DIFFERENT people, because the product's claim is that two colleagues
// disagree and neither of them knows it. One person contradicting themselves
// three days apart is a different and much less interesting story.
for (const [n, text, offset, who] of [
  ['dispute-a', `${disputed.key} shipped on Tuesday, closing it out.`, -9, 2],
  ['dispute-b', `${disputed.key} is not done — still waiting on the schema change.`, -6, 9],
] as const) {
  const at = day(offset, 11);
  nodes.push({
    id: `message:slack/orbit-delivery/${n}`, kind: 'message', source: 'slack',
    label: text.slice(0, 60), at, container: 'orbit-delivery',
    recordRef: `records/message/${n}.json`,
  });
  records.push({ kind: 'message', name: n, payload: { id: n, channel: 'orbit-delivery', author: people[who]!.handle, at, text } });
  edges.push({
    source: `message:slack/orbit-delivery/${n}`, target: `issue:${disputed.key}`, relation: 'mentions',
    tier: 'EXTRACTED', origin: 'structural', evidence: [{ source: 'slack', ref: `message:slack/orbit-delivery/${n}`, quote: text }],
  });
}

// ---------------------------------------------------------------------------
// Confluence — a space where most pages are prose about nothing ticketed
// ---------------------------------------------------------------------------

for (let i = 0; i < 60; i++) {
  const name = `page-${String(i + 1).padStart(4, '0')}`;
  const carriesKey = i % 6 === 0;
  const subject = issues[h(`pk${i}`) % 60]!;
  const at = day(-120 + i * 1.6, 14);
  const title = `${pick(VERB, `pv${i}`)} ${pick(TOPIC, `pt${i}`)} — notes`;
  const body = [
    `Written up after the review of ${pick(TOPIC, `pb${i}`)}.`,
    carriesKey ? `The work is tracked as ${subject.key}.` : 'Nothing is ticketed for this yet.',
    pick(CHATTER, `pc${i}`),
  ].join('\n\n');
  nodes.push({
    id: `page:confluence/${name}`, kind: 'page', source: 'confluence', label: title, at,
    container: VOCAB.space, recordRef: `records/page/${name}.json`,
    url: `https://example.com/wiki/spaces/${VOCAB.space}/pages/${1000 + i}`,
  });
  records.push({ kind: 'page', name, payload: { id: name, title, at, body, keys: carriesKey ? [subject.key] : [] } });
  if (carriesKey) {
    edges.push({
      source: `page:confluence/${name}`, target: `issue:${subject.key}`, relation: 'mentions',
      tier: 'EXTRACTED', origin: 'structural',
      evidence: [{ source: 'confluence', ref: `page:confluence/${name}`, quote: `The work is tracked as ${subject.key}.` }],
    });
  }
}

// ---------------------------------------------------------------------------
// GitHub — the branch is the join, and most branches do not carry a key
// ---------------------------------------------------------------------------

/**
 * The author is a GitHub login and mostly does NOT resolve to a person.
 *
 * That is the live result rather than a shortcut: `verify-collector` reported
 * 126 unresolved references on a real import, all of them GitHub. It is a
 * configuration gap and not a contract violation — the alerts still fire,
 * because they key on the ticket — and a fixture where every handle resolves
 * means nobody ever sees the warning that says a rollup is double-counting.
 */
for (let i = 0; i < 120; i++) {
  const repo = pick(VOCAB.repos, `r${i}`);
  const number = 100 + i * 3;
  const carriesKey = i % 5 === 0;
  const subject = issues[h(`gk${i}`) % 60]!;
  const branch = carriesKey
    ? `feature/${subject.key}-${pick(TOPIC, `gb${i}`).replace(/^the /, '').replace(/ /g, '-')}`
    : `chore/${pick(TOPIC, `gb${i}`).replace(/^the /, '').replace(/ /g, '-')}`;
  const at = day(-100 + i * 0.8, 13);
  const merged = i % 7 !== 0;
  const author = i % 6 === 0 ? people[h(`ga${i}`) % people.length]!.handle : `gh-${pick(LAST, `gl${i}`).toLowerCase()}`;
  const name = `${repo.replace(/[^\w.-]+/g, '-')}-${number}`;
  const title = `${pick(VERB, `gt${i}`)} ${pick(TOPIC, `gp${i}`)}`;
  nodes.push({
    id: `pr:github/${repo}/${number}`, kind: 'pr', source: 'github', label: title, at,
    container: repo, recordRef: `records/pr/${name}.json`,
    url: `https://example.com/${repo}/pull/${number}`,
  });
  records.push({ kind: 'pr', name, payload: { number, title, branch, author, at, merged } });
  if (carriesKey) {
    edges.push({
      source: `pr:github/${repo}/${number}`, target: `issue:${subject.key}`, relation: 'mentions',
      tier: 'EXTRACTED', origin: 'structural',
      evidence: [{ source: 'github', ref: `pr:github/${repo}/${number}`, quote: branch }],
    });
  }
}

// ---------------------------------------------------------------------------
// Zoom — NOTES, not transcripts. No speakers and no offsets.
// ---------------------------------------------------------------------------

/**
 * The real Zoom collector reaches Zoom Docs notes, not recordings.
 *
 * The recording API is blocked, so a record carries `body` and never
 * `segments`; `annotateTranscript` derives one segment per paragraph and their
 * `start` is a PARAGRAPH INDEX, not a timestamp. A fixture full of timed,
 * speaker-attributed transcripts rehearses a collector nobody has.
 */
const CEREMONY = ['Daily Scrum', 'Backlog Refinement', 'Sprint Planning', 'Sprint Review', 'Retro'] as const;
interface Meeting { id: string; title: string; at: string; paras: string[]; }
const meetings: Meeting[] = [];

for (let i = 0; i < 24; i++) {
  const id = `mtg-${String(i + 1).padStart(4, '0')}`;
  const kind = pick(CEREMONY, `ck${i}`);
  const at = day(-72 + i * 3, 10);
  const title = `Orbit ${kind} ${at.slice(0, 10)}`;
  const paras = [
    `${title}`,
    ...Array.from({ length: 6 }, (_, k) => pick(CHATTER, `mp${i}:${k}`)),
  ];
  meetings.push({ id, title, at, paras });
}

/**
 * The promises, planted so the flagship alert has something to fire on.
 *
 * Every gate matters and every one is `DIRECTION.md` §5: an OPEN commitment,
 * with a NAMED owner, a due date, NO related key, in a container that has
 * CLOSED. Take any one away and the alert is silently correct to stay quiet.
 */
const PROMISES = [
  { meeting: 2, para: 3, owner: 4, sprint: 29 },
  { meeting: 5, para: 2, owner: 7, sprint: 30 },
  { meeting: 9, para: 5, owner: 1, sprint: 30 },
  { meeting: 12, para: 4, owner: 11, sprint: 31 },
  { meeting: 16, para: 2, owner: 3, sprint: 32 },
  /**
   * ⟨CASE: unlinked_commitment⟩ A promise that IS about a ticket, said in the
   * way people actually say it — by subject, never by key.
   *
   * `about` builds the promise text out of an issue's own title and takes that
   * issue's assignee as the owner, which is exactly the shape a stand-up
   * produces: everybody in the room knows which ticket is meant and nobody says
   * the number. Without a case like this the reconstruction is code nothing
   * exercises, and the flagship alert goes on reporting *"never filed"* about
   * work that is plainly on the board.
   */
  { meeting: 18, para: 4, sprint: 32, about: 55 },
  /**
   * ⟨CASE: unlinked_commitment, NEGATIVE⟩ Two candidates clear both floors, so
   * the rule mints nothing and the alert stays `missing_ticket`.
   *
   * This is the case that decides the whole design. Measured on `fixtures/`,
   * the HIGHEST-scoring candidate for a promise was the wrong ticket, so a
   * "best score wins" rule would confidently invent a link. Ambiguity has to be
   * a refusal, and a refusal needs a fixture that provokes it.
   */
  { meeting: 20, para: 3, sprint: 32, about: 57, ambiguous: true },
  /**
   * ⟨CASE: dropped_commitment⟩ Promised inside the sprint that is STILL
   * RUNNING, and three stand-ups have gone by without it coming up.
   *
   * Every other promise here sits in a closed sprint, which is
   * `missing_ticket`'s trigger and structurally excludes this detector — so
   * without an active-sprint promise the whole rule is unreachable.
   */
  { meeting: 21, para: 2, owner: 6, sprint: 33 },
] as const;

for (const [i, p] of PROMISES.entries()) {
  const m = meetings[p.meeting]!;
  /**
   * A promise built FROM an issue, or one built from the task pool.
   *
   * The `about` form takes the issue's assignee as the owner and its title as
   * the subject, which is what makes the owner filter and the word overlap both
   * fire. The pool form names no real work, which is what keeps the other five
   * as genuine `missing_ticket` cases.
   */
  const target = 'about' in p ? issues[(p as { about: number }).about]! : undefined;
  const owner = target
    ? people.find((q) => q.email === target.assignee)!
    : people[(p as { owner: number }).owner]!;
  const text = target
    ? `${owner.name} to finish ${target.label.toLowerCase().replace(/^\w+ /, '')}.`
    : `${owner.name} to ${pick(TASK, `pr${i}`)}.`;
  m.paras[p.para] = text;
  const sprint = SPRINTS.find((s) => s.n === p.sprint)!;
  const created = m.at;
  notes.push({
    id: `promise-${String(i + 1).padStart(3, '0')}`,
    kind: 'commitment',
    title: text,
    body: `${text}\n\nPromised in ${m.title}. ${owner.name} took it. No date was given, ` +
      `so it is checked against Orbit ${p.sprint}'s close. Nothing in the tracker references it yet.`,
    status: 'open',
    recency: 'dated',
    relatedKeys: [],
    tags: ['workshop', 'promised', 'due-from-sprint'],
    createdAt: created,
    updatedAt: created,
    verifiedAt: created,
    owner: owner.name,
    dueAt: day(sprint.end, 17),
    container: `sprint:Orbit ${p.sprint}`,
    /**
     * The ref is what makes the citation a LINK — `quote` alone renders as
     * prose.
     *
     * `ref.at` is the PARAGRAPH INDEX, matching `annotateTranscript` on an
     * untimed record, and it is deliberately not repeated on the evidence body.
     * `Evidence.at` means seconds into a recording and the alert page renders
     * it as `Math.floor(at / 60)`, so paragraph 3 displayed as "0m in" — a
     * moment nobody recorded, printed beside a quotation. The citation still
     * opens the note at the right paragraph; it just does not claim a clock a
     * Zoom Doc does not have. See `zoomEvidence` in `apps/gateway/src/format.ts`.
     */
    evidence: [{
      surface: 'zoom',
      label: `${m.title} (read by the model)`,
      quote: text,
      ref: { surface: 'zoom', id: m.id, at: p.para },
    }],
  } as Note);
}

for (const m of meetings) {
  nodes.push({
    id: `meeting:zoom/${m.id}`, kind: 'meeting', source: 'zoom', label: m.title, at: m.at,
    recordRef: `records/meeting/${m.id}.json`,
  });
  records.push({
    kind: 'meeting', name: m.id,
    payload: {
      id: m.id, topic: m.title, startedAt: m.at,
      participants: people.slice(0, 5 + (h(m.id) % 5)).map((p) => p.name),
      body: m.paras.join('\n\n'),
    },
  });
}

// ---------------------------------------------------------------------------
// The event log — transitions, so an age is measured rather than guessed
// ---------------------------------------------------------------------------

let seq = 0;
for (const [i, issue] of issues.entries()) {
  if (i % 3 !== 0) continue;
  const sprint = SPRINTS.find((s) => s.n === issue.sprint)!;
  const push = (type: string, from: string, to: string, offset: number): void => {
    events.push({
      id: `evt-${String(++seq).padStart(4, '0')}`,
      ts: day(offset, 11),
      source: 'jira',
      type,
      entityKey: issue.key,
      payload: { from, to },
    } as McEvent);
  };
  push('workitem.status_changed', 'Backlog', 'In Development', i === STALE ? -38 : sprint.start + 1);
  if (issue.cat === 'done') push('workitem.status_changed', 'In Development', 'Closed', sprint.end - 1);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const graph: StoredGraph = {
  directed: true,
  multigraph: true,
  graph: {
    generatedAt: NOW.toISOString(),
    generator: GENERATOR,
    sources: ['jira', 'slack', 'confluence', 'github', 'zoom'],
  },
  nodes,
  links: edges,
};

// Every edge must point at a node that exists — a dangling edge is the one
// contract violation `verify-collector` refuses outright.
const known = new Set(nodes.map((n) => n.id));
const dangling = edges.filter((e) => !known.has(e.source) || !known.has(e.target));
if (dangling.length) {
  console.error(`  ${dangling.length} edge(s) point at a node that does not exist, e.g.`);
  console.error(`    ${dangling[0]!.source} --${dangling[0]!.relation}--> ${dangling[0]!.target}`);
  process.exit(1);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'notes'), { recursive: true });
await writeFile(join(OUT, 'graph.json'), `${JSON.stringify(graph, null, 2)}\n`);
for (const r of records) {
  await mkdir(join(OUT, 'records', r.kind), { recursive: true });
  await writeFile(join(OUT, 'records', r.kind, `${r.name}.json`), `${JSON.stringify(r.payload, null, 2)}\n`);
}
for (const n of notes) await writeFile(join(OUT, 'notes', `${n.id}.md`), encodeNote(n));
await writeFile(join(OUT, 'events.jsonl'), `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);

const kinds = [...new Set(nodes.map((n) => n.kind))].sort();
const rels = [...new Set(edges.map((e) => e.relation))].sort();
console.log(`
  wrote ${OUT}/
    graph.json     ${nodes.length} nodes, ${edges.length} edges  (${(edges.length / nodes.length).toFixed(2)} edges/node)
    records/       ${records.length} across ${[...new Set(records.map((r) => r.kind))].sort().join(', ')}
    notes/         ${notes.length} commitment(s)
    events.jsonl   ${events.length}

  node kinds   ${kinds.join(' ')}
  relations    ${rels.join(' ')}
  join rate    ${edges.filter((e) => e.relation === 'mentions').length} of ${records.length} records name a ticket

  MC_GRAPH_DIR=./${OUT} npm run dev
`);
