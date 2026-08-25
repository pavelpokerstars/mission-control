/**
 * The invented programme the fixture is generated from.
 *
 * WHY IT IS A SPEC AND NOT DATA. Everything here is a short declaration of
 * intent — a ticket's shape, a claim's wording, who said what — and
 * `generate.ts` derives the nodes, edges, records and timestamps from it. Two
 * hundred hand-written nodes would be two hundred chances for the graph and the
 * records to disagree, and the disagreement is silent: an edge cites a record
 * that says something else.
 *
 * WHY THE CONTENT IS INVENTED. The fixture ships in a repo strangers open, so
 * nothing in it may be derived from a real transcript, a real board or a real
 * ticket. What IS copied from reality is the *vocabulary* — the shape of a key,
 * the words a status takes, the id of a custom field — because that is what
 * makes the mock a rehearsal for live rather than a different game.
 *
 * WHY THE VOCABULARY IS IN ONE BLOCK. `VOCAB` below is the only place a real
 * project key, squad id or custom field appears. Publishing this repo may mean
 * neutralising them; that should be one edit, not a search across a generator.
 */

// ---------------------------------------------------------------------------
// Vocabulary — the only part of this file taken from a real instance
// ---------------------------------------------------------------------------

export const VOCAB = {
  projects: { delivery: 'PAY', web: 'WEB', platform: 'PLT' },
  /**
   * The vendor's own status words, not a normalised union.
   *
   * `statusCategory` is the collector's declared reading of them, from config —
   * every Jira names these differently and a fixed union in code is a migration
   * every time somebody edits a workflow.
   */
  statuses: {
    'To Do': 'todo',
    'In Progress': 'doing',
    'Code Review': 'doing',
    QA: 'doing',
    Blocked: 'doing',
    Closed: 'done',
  } as const,
  /** Real field ids, because a collector binding to them is the thing being rehearsed. */
  fields: {
    responsibleSquad: 'customfield_10001',
    epicLink: 'customfield_10002',
    parentLink: 'cf[10003]',
  },
  squads: {
    core: { id: 'ORG-10000011', name: 'Payments Core' },
    web: { id: 'ORG-10000012', name: 'Payments Web' },
    platform: { id: 'ORG-10000013', name: 'Platform Services' },
  },
  tribe: { id: 'TRB-100', name: 'Payments and Wallet' },
  goal: { id: 'GOAL-10', name: 'Reduce payment failure rate' },
  domain: 'example.com',
  slackTeam: 'T0PAYMENTS',
  confluenceSpace: 'PAY',
  githubRepo: { owner: 'example-org', name: 'payments-web' },
  miroBoard: 'uXjVFIXTURE01=',
  zoomAccount: 'zoom-fixture',
} as const;

export type StatusWord = keyof typeof VOCAB.statuses;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface PersonSpec {
  handle: string;
  name: string;
  squad: keyof typeof VOCAB.squads;
  /** A squad this person left, and when. See `sanjay` — the reorg case. */
  formerSquad?: { squad: keyof typeof VOCAB.squads; until: string };
}

/**
 * `sanjay` is the reason `member_of` carries dates.
 *
 * The product wants to say "the person who agreed this moved off the platform
 * team on 31 July, so the person who picks it up now is marcus". Undated
 * membership cannot answer that, and a fixture without the case cannot show it.
 */
export const PEOPLE: PersonSpec[] = [
  { handle: 'riya', name: 'Riya Nair', squad: 'core' },
  { handle: 'dana', name: 'Dana Okafor', squad: 'core' },
  { handle: 'sam', name: 'Sam Whitfield', squad: 'web' },
  { handle: 'priya', name: 'Priya Mehta', squad: 'web' },
  { handle: 'marcus', name: 'Marcus Hale', squad: 'platform' },
  {
    handle: 'sanjay',
    name: 'Sanjay Rao',
    squad: 'core',
    formerSquad: { squad: 'platform', until: '2026-07-31' },
  },
];

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export interface SprintSpec {
  name: string;
  startsAt: string;
  endsAt: string;
  state: 'future' | 'active' | 'closed';
}

/**
 * Three sprints, and the middle one is the trigger.
 *
 * Sprint 12 closing is what makes the commitment gap fire — an alert fires when
 * a container CLOSES, which is the only moment that is neither nagging nor too
 * late. Sprint 14 is active so the lane has live work to rank.
 */
export const SPRINTS: SprintSpec[] = [
  { name: 'PAY Sprint 12', startsAt: '2026-07-06', endsAt: '2026-07-31', state: 'closed' },
  { name: 'PAY Sprint 13', startsAt: '2026-08-03', endsAt: '2026-08-14', state: 'closed' },
  { name: 'PAY Sprint 14', startsAt: '2026-08-17', endsAt: '2026-09-04', state: 'active' },
];

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

export interface IssueSpec {
  key: string;
  level: 'initiative' | 'epic' | 'story' | 'task' | 'bug' | 'spike' | 'incident';
  title: string;
  status: StatusWord;
  assignee?: string;
  sprint?: string;
  parent?: string;
  points?: number;
  createdAt: string;
  resolvedAt?: string;
  /** Prose on the ticket. Where a reconstructed dependency is found. */
  description?: string;
  /** Declared Jira dependency links: this issue waits for these. */
  dependsOn?: string[];
}

export const ISSUES: IssueSpec[] = [
  // ---- hierarchy -----------------------------------------------------------
  { key: 'PAY-9000', level: 'initiative', title: 'Payment reliability programme', status: 'In Progress', createdAt: '2026-06-01' },
  { key: 'PAY-9010', level: 'epic', title: 'Idempotency on the charge endpoint', status: 'Closed', parent: 'PAY-9000', createdAt: '2026-06-08', resolvedAt: '2026-07-31' },
  { key: 'PAY-9020', level: 'epic', title: 'Replay tooling for failed batches', status: 'In Progress', parent: 'PAY-9000', createdAt: '2026-06-08' },
  { key: 'PLT-4400', level: 'epic', title: 'Event backbone', status: 'In Progress', createdAt: '2026-05-20' },

  // ---- Sprint 12, the sprint that closed with a promise unkept --------------
  { key: 'PAY-9011', level: 'story', title: 'Add an idempotency key to the charge endpoint', status: 'Closed', assignee: 'riya', sprint: 'PAY Sprint 12', parent: 'PAY-9010', points: 5, createdAt: '2026-07-06', resolvedAt: '2026-07-24' },
  { key: 'PAY-9012', level: 'story', title: 'Dedupe cache in front of the charge endpoint', status: 'Closed', assignee: 'dana', sprint: 'PAY Sprint 12', parent: 'PAY-9010', points: 3, createdAt: '2026-07-06', resolvedAt: '2026-07-29' },
  { key: 'PAY-9013', level: 'task', title: 'Load test the charge path before the freeze', status: 'Closed', assignee: 'sam', sprint: 'PAY Sprint 12', parent: 'PAY-9010', points: 2, createdAt: '2026-07-09', resolvedAt: '2026-07-30' },

  // ---- Sprint 13 -----------------------------------------------------------
  { key: 'PAY-9021', level: 'story', title: 'Replay a failed batch from the audit log', status: 'Closed', assignee: 'riya', sprint: 'PAY Sprint 13', parent: 'PAY-9020', points: 5, createdAt: '2026-08-03', resolvedAt: '2026-08-13' },
  { key: 'PAY-9022', level: 'bug', title: 'Duplicate charge on retry after a 504', status: 'Closed', assignee: 'dana', sprint: 'PAY Sprint 13', parent: 'PAY-9010', points: 3, createdAt: '2026-08-04', resolvedAt: '2026-08-12' },

  // ---- Sprint 14, active ---------------------------------------------------
  {
    key: 'PAY-9031', level: 'story', title: 'Emit a payment-settled event on the topic',
    status: 'Code Review', assignee: 'dana', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 5,
    createdAt: '2026-08-17',
    // The undetected dependency: prose names PLT-4412, and no Jira link does.
    description:
      'Publish a settled event once the charge clears. Blocked by PLT-4412 — we cannot ' +
      'publish until the topic exists and the platform team owns that.',
  },
  { key: 'PAY-9032', level: 'story', title: 'Consume settled events in the web client', status: 'To Do', assignee: 'sam', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 3, createdAt: '2026-08-17', dependsOn: ['PAY-9031'] },
  { key: 'PAY-9033', level: 'task', title: 'Backfill settled events for July', status: 'To Do', assignee: 'priya', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 2, createdAt: '2026-08-18' },
  { key: 'PAY-9034', level: 'spike', title: 'How do we replay without double-charging?', status: 'Closed', assignee: 'riya', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 1, createdAt: '2026-08-17', resolvedAt: '2026-08-19' },

  // The suspect link: PAY-9035 declares it waits for PAY-9013, which closed
  // three weeks ago and which nothing in prose ever connects to it.
  {
    key: 'PAY-9035', level: 'story', title: 'Alert on settlement lag', status: 'To Do',
    assignee: 'priya', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 3,
    createdAt: '2026-08-18', dependsOn: ['PAY-9013'],
  },

  /**
   * ⟨CASE: aging⟩ Carried out of Sprint 13 and stuck in one status since.
   *
   * Nothing else in the fixture ages: every open ticket was either filed with
   * the sprint or never picked up, and a ticket with no transitions correctly
   * claims no age at all — "we do not know" beats a fabricated zero. Without a
   * case like this the aging detector is code nothing exercises.
   */
  {
    key: 'PAY-9024', level: 'story', title: 'Retry policy for the settlement webhook',
    status: 'In Progress', assignee: 'priya', sprint: 'PAY Sprint 14', parent: 'PAY-9020',
    points: 3, createdAt: '2026-08-05',
  },

  // ---- the cycle, all four corroborated in prose so it legitimately fires ---
  { key: 'PAY-9041', level: 'story', title: 'Reconcile the ledger against the provider', status: 'Blocked', assignee: 'dana', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 5, createdAt: '2026-08-17', dependsOn: ['PAY-9042'], description: 'Blocked by PAY-9042 — reconciliation needs the normalised statement.' },
  { key: 'PAY-9042', level: 'story', title: 'Normalise the provider statement format', status: 'To Do', assignee: 'sam', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 3, createdAt: '2026-08-17', dependsOn: ['PAY-9043'], description: 'Blocked by PAY-9043 — we normalise against whatever the mapping says.' },
  { key: 'PAY-9043', level: 'task', title: 'Agree the provider field mapping', status: 'To Do', assignee: 'riya', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 2, createdAt: '2026-08-17', dependsOn: ['PAY-9044'], description: 'Blocked by PAY-9044 — the mapping follows the ledger schema.' },
  { key: 'PAY-9044', level: 'task', title: 'Freeze the ledger schema', status: 'To Do', assignee: 'dana', sprint: 'PAY Sprint 14', parent: 'PAY-9020', points: 2, createdAt: '2026-08-17', dependsOn: ['PAY-9041'], description: 'Blocked by PAY-9041 — we cannot freeze until reconciliation proves out.' },

  // ---- platform, the other side of the promise -----------------------------
  { key: 'PLT-4412', level: 'story', title: 'Provision the payments settled topic', status: 'To Do', assignee: 'marcus', parent: 'PLT-4400', points: 3, createdAt: '2026-08-19' },
  { key: 'PLT-4405', level: 'story', title: 'Retention policy for payment topics', status: 'Closed', assignee: 'marcus', parent: 'PLT-4400', points: 2, createdAt: '2026-06-22', resolvedAt: '2026-07-18' },

  // ---- web -----------------------------------------------------------------
  { key: 'WEB-2210', level: 'task', title: 'Settlement status in the account page', status: 'To Do', assignee: 'sam', sprint: 'PAY Sprint 14', points: 3, createdAt: '2026-08-18' },
];
