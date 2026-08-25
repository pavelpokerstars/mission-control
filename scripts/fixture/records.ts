/**
 * What people said, and what they promised.
 *
 * This half is the point. A fixture of tickets alone can only demonstrate things
 * Jira already knows; every finding this product exists to raise lives in the
 * gap between these records and the work above them.
 *
 * Each planted case is marked ⟨CASE⟩ so a reader can find what a detector is
 * supposed to catch without reverse-engineering it from the data.
 */

export interface ClaimSpec {
  id: string;
  kind: 'commitment' | 'decision' | 'impediment';
  title: string;
  body: string;
  /** The precision gate. A claim without both is deliberately not alertable. */
  owner?: string;
  dueAt?: string;
  /** The sprint or epic whose closing should check this. */
  container?: string;
  status: 'open' | 'resolved';
  /** Keys the claim is about, with how we came to believe each one. */
  joins: { key: string; tier: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS'; why?: string; confidence?: number }[];
  /** Which transcript segment or record it was read from. */
  evidence: { record: string; quote: string; at?: number }[];
  at: string;
}

export const CLAIMS: ClaimSpec[] = [
  /**
   * ⟨CASE: missing ticket⟩ THE HERO.
   *
   * An owner, a date, a container that has closed, and no key at all. Every
   * other claim here exists partly to prove this one is not the only thing the
   * detector can see.
   */
  {
    id: 'platform-owns-settled-topic',
    kind: 'commitment',
    title: 'Platform to provide the payments settled topic',
    owner: 'sanjay',
    dueAt: '2026-08-12',
    container: 'sprint:PAY Sprint 12',
    status: 'open',
    joins: [],
    at: '2026-07-06T13:14:00Z',
    evidence: [
      { record: 'zoom:sprint-12-planning', at: 852, quote: 'Platform can give us the topic. Sanjay owns it — his team said the twelfth of August at the latest.' },
      { record: 'miro:sticky-actions-1', quote: 'Settled topic — PLATFORM own — due 12 Aug' },
    ],
    body: [
      'Agreed aloud in Sprint 12 planning and never filed. The replay work assumes',
      'the topic exists; nothing in Jira says anyone is building it.',
      '',
      'Sanjay accepted it for the platform team. Note that he moved to Payments Core',
      'on 31 July, so whoever picks this up is not who agreed it.',
    ].join('\n'),
  },

  /**
   * The kept promises from the same sprint, so the checklist has ticks.
   *
   * The cross only means something against them. A checklist of one missing
   * item is a sentence with extra steps; four ticks and a cross is the picture
   * that reads in a second from across a room, which is the whole reason the
   * block exists.
   */
  {
    id: 'idempotency-key-charge-endpoint',
    kind: 'commitment',
    title: 'Add an idempotency key to the charge endpoint',
    owner: 'riya',
    dueAt: '2026-07-24',
    container: 'sprint:PAY Sprint 12',
    status: 'resolved',
    joins: [{ key: 'PAY-9011', tier: 'EXTRACTED' }],
    at: '2026-07-06T13:02:00Z',
    evidence: [
      { record: 'zoom:sprint-12-planning', at: 120, quote: 'Two things this sprint: idempotency on the charge endpoint, and the replay path.' },
    ],
    body: 'Filed the same morning and closed inside the sprint.',
  },
  {
    id: 'dedupe-cache-staging',
    kind: 'commitment',
    title: 'Dedupe cache in front of the charge endpoint',
    owner: 'dana',
    dueAt: '2026-07-29',
    container: 'sprint:PAY Sprint 12',
    status: 'resolved',
    joins: [{ key: 'PAY-9012', tier: 'EXTRACTED' }],
    at: '2026-07-06T13:10:00Z',
    evidence: [
      { record: 'zoom:sprint-12-planning', at: 610, quote: 'PAY-9012 is the cache. I can have it in staging inside the week.' },
    ],
    body: 'Named its own ticket in the room, which is the easy case.',
  },
  {
    id: 'load-test-before-freeze',
    kind: 'commitment',
    title: 'Load test the charge path before the freeze',
    owner: 'sam',
    dueAt: '2026-07-30',
    container: 'sprint:PAY Sprint 12',
    status: 'resolved',
    joins: [{ key: 'PAY-9013', tier: 'EXTRACTED' }],
    at: '2026-07-06T13:36:00Z',
    evidence: [
      { record: 'miro:sticky-actions-2', quote: 'Load test before the freeze — PAY-9013' },
      { record: 'zoom:sprint-12-planning', at: 2_210, quote: 'I will load test the charge path before the freeze. That is PAY-9013.' },
    ],
    body: 'Said and written — the strong case, two records minutes apart.',
  },

  /**
   * ⟨CASE: the gate holds⟩ A promise with no owner and no date.
   *
   * It must be stored, must be visible, and must NOT fire. Without a case like
   * this the precision gate is a claim in a document rather than something the
   * fixture demonstrates.
   */
  {
    id: 'write-down-cache-decision',
    kind: 'commitment',
    title: 'Somebody should write down why we chose a cache over a constraint',
    container: 'sprint:PAY Sprint 12',
    status: 'open',
    joins: [],
    at: '2026-07-06T13:31:00Z',
    evidence: [
      { record: 'zoom:sprint-12-planning', at: 1_940, quote: 'We should write down why we went with the cache rather than a database constraint.' },
    ],
    body: 'Said aloud, nobody took it, no date. Real, and deliberately not alertable.',
  },

  /**
   * ⟨CASE: an inferred join⟩ The claim names no key; the join is reconstructed
   * from who was speaking and what the sprint was about. It carries its `why`,
   * without which it would be dropped.
   */
  {
    id: 'dana-owns-settled-event',
    kind: 'commitment',
    title: 'Dana takes the settled event end to end',
    owner: 'dana',
    dueAt: '2026-08-29',
    container: 'sprint:PAY Sprint 14',
    status: 'open',
    joins: [
      { key: 'PAY-9031', tier: 'INFERRED', why: 'Dana is the assignee of the only settled-event story in the sprint being planned', confidence: 0.72 },
    ],
    at: '2026-08-17T13:09:00Z',
    evidence: [
      { record: 'zoom:sprint-14-planning', at: 410, quote: 'Dana takes the settled event end to end, publisher and the consumer contract.' },
    ],
    body: 'No ticket named in the room. The join is reconstructed, and says so.',
  },

  {
    id: 'cache-over-constraint',
    kind: 'decision',
    title: 'A dedupe cache, not a database constraint',
    status: 'resolved',
    container: 'sprint:PAY Sprint 12',
    joins: [{ key: 'PAY-9012', tier: 'EXTRACTED' }],
    at: '2026-07-06T13:28:00Z',
    evidence: [
      { record: 'zoom:sprint-12-planning', at: 1_705, quote: 'A cache in front of it. A unique constraint means a migration on the hot table and we are not doing that before the freeze.' },
    ],
    body: 'Recorded in Confluence four days later. See [[adr-011-cache-over-constraint]].',
  },

  {
    id: 'provider-secret-blocks-reconciliation',
    kind: 'impediment',
    title: 'Reconciliation is blocked on a provider signing secret',
    owner: 'dana',
    dueAt: '2026-08-26',
    container: 'sprint:PAY Sprint 14',
    status: 'open',
    joins: [{ key: 'PAY-9041', tier: 'EXTRACTED' }],
    at: '2026-08-20T09:02:00Z',
    evidence: [
      { record: 'slack:eng-payments-6', quote: 'PAY-9041 is still blocked on the provider signing secret. I cannot test it until we have one.' },
    ],
    body: 'Raised twice. The provider owes us a sandbox credential and nobody has chased it.',
  },
];

// ---------------------------------------------------------------------------
// Records — what the claims are read from
// ---------------------------------------------------------------------------

export interface TranscriptSpec {
  id: string;
  topic: string;
  startedAt: string;
  participants: string[];
  segments: { at: number; speaker: string; text: string }[];
}

export const TRANSCRIPTS: TranscriptSpec[] = [
  {
    id: 'sprint-12-planning',
    topic: 'PAY Sprint 12 planning',
    startedAt: '2026-07-06T13:00:00Z',
    participants: ['riya', 'dana', 'sam', 'sanjay'],
    segments: [
      { at: 120, speaker: 'riya', text: 'Two things this sprint: idempotency on the charge endpoint, and the replay path.' },
      { at: 610, speaker: 'dana', text: 'PAY-9012 is the cache. I can have it in staging inside the week.' },
      { at: 852, speaker: 'riya', text: 'Platform can give us the topic. Sanjay owns it — his team said the twelfth of August at the latest.' },
      { at: 900, speaker: 'sanjay', text: 'Twelfth is fine. I will get it on our board.' },
      { at: 1_705, speaker: 'riya', text: 'A cache in front of it. A unique constraint means a migration on the hot table and we are not doing that before the freeze.' },
      { at: 1_940, speaker: 'dana', text: 'We should write down why we went with the cache rather than a database constraint.' },
      { at: 2_210, speaker: 'sam', text: 'I will load test the charge path before the freeze. That is PAY-9013.' },
    ],
  },
  {
    id: 'sprint-14-planning',
    topic: 'PAY Sprint 14 planning',
    startedAt: '2026-08-17T13:00:00Z',
    participants: ['riya', 'dana', 'sam', 'priya'],
    segments: [
      { at: 90, speaker: 'riya', text: 'Reconciliation is the big one. Four tickets and they are tangled.' },
      { at: 410, speaker: 'dana', text: 'Dana takes the settled event end to end, publisher and the consumer contract.' },
      { at: 780, speaker: 'sam', text: 'I cannot start the consumer until the publisher exists, so PAY-9032 waits on PAY-9031.' },
      { at: 1_150, speaker: 'priya', text: 'Settlement lag alerting is mine. I do not know what it depends on yet.' },
      { at: 1_520, speaker: 'riya', text: 'The spike closed. We replay from the audit log and we key on the settlement id.' },
    ],
  },
  {
    id: 'sprint-12-retro',
    topic: 'PAY Sprint 12 retro',
    startedAt: '2026-07-31T15:00:00Z',
    participants: ['riya', 'dana', 'sam'],
    segments: [
      { at: 200, speaker: 'riya', text: 'The sprint closed clean apart from one thing nobody filed.' },
      { at: 460, speaker: 'sam', text: 'The load test found nothing, which is either good news or a bad load test.' },
    ],
  },
];

export interface MessageSpec {
  id: string;
  channel: string;
  author: string;
  at: string;
  text: string;
}

export const MESSAGES: MessageSpec[] = [
  { id: 'eng-payments-1', channel: 'eng-payments', author: 'dana', at: '2026-07-29T10:12:00Z', text: 'Dedupe cache is on staging. PAY-9012 done from my side.' },
  { id: 'eng-payments-2', channel: 'eng-payments', author: 'riya', at: '2026-08-17T09:40:00Z', text: 'Sprint 14 board is up. PAY-9041 through PAY-9044 are the reconciliation chain.' },

  /**
   * ⟨CASE: sources disagree⟩ Sam calls it done on the Tuesday; Dana says it is
   * blocked on the Wednesday; Jira says Code Review. The detector must not pick
   * a winner — both go in front of the person who can tell.
   */
  { id: 'standup-1', channel: 'standup', author: 'sam', at: '2026-08-18T09:14:00Z', text: 'PAY-9031 is done, moving on to the consumer side.' },
  { id: 'eng-payments-3', channel: 'eng-payments', author: 'dana', at: '2026-08-19T16:20:00Z', text: 'PAY-9031 is not done — it cannot publish anywhere until the topic exists. Still waiting on platform.' },

  /**
   * ⟨CASE: the URL join⟩ Names no ticket anywhere. A key regex finds nothing;
   * the link to the Confluence page is what attaches it, and the page is what
   * carries the ticket. This is the join that fires on real data when the key
   * join does not.
   */
  { id: 'eng-payments-4', channel: 'eng-payments', author: 'riya', at: '2026-07-10T11:05:00Z', text: 'Wrote up why we went with the cache: https://example.atlassian.net/wiki/spaces/PAY/pages/48210331/Cache+over+constraint' },
  { id: 'eng-payments-5', channel: 'eng-payments', author: 'sam', at: '2026-07-10T11:31:00Z', text: 'Good. That was the bit I could never remember the reasoning for.' },

  { id: 'eng-payments-6', channel: 'eng-payments', author: 'dana', at: '2026-08-20T09:02:00Z', text: 'PAY-9041 is still blocked on the provider signing secret. I cannot test it until we have one.' },
  { id: 'eng-platform-1', channel: 'eng-platform', author: 'marcus', at: '2026-08-19T14:02:00Z', text: 'Picked up PLT-4412. Nobody told us it was urgent — it landed on our board yesterday.' },
  { id: 'standup-2', channel: 'standup', author: 'priya', at: '2026-08-20T09:11:00Z', text: 'On PAY-9035. Waiting to hear what it actually blocks on.' },
];

export interface PageSpec {
  id: string;
  title: string;
  at: string;
  author: string;
  /** Keys the page names in its body. */
  keys: string[];
  body: string;
}

export const PAGES: PageSpec[] = [
  {
    id: '48210331',
    title: 'Cache over constraint',
    at: '2026-07-10T10:50:00Z',
    author: 'riya',
    keys: ['PAY-9012'],
    body: [
      'We chose a dedupe cache in front of the charge endpoint rather than a unique',
      'constraint on the charges table.',
      '',
      'A constraint means a migration on a hot table, and the freeze is on the 31st.',
      'The cache is reversible; the migration is not. PAY-9012 carries the work.',
    ].join('\n'),
  },
  {
    id: '48210488',
    title: 'Replay runbook',
    at: '2026-08-13T16:00:00Z',
    author: 'riya',
    keys: ['PAY-9021'],
    body: 'How to replay a failed batch from the audit log, keyed on settlement id.',
  },
  {
    /** ⟨CASE: a page that joins to nothing⟩ Names no key. Sources shows it as unread. */
    id: '48210502',
    title: 'Provider onboarding notes',
    at: '2026-08-05T09:00:00Z',
    author: 'marcus',
    keys: [],
    body: 'Sandbox credentials, rate limits, and who to email. Names no ticket.',
  },
];

export interface StickySpec {
  id: string;
  frame: string;
  text: string;
  author: string;
}

export const STICKIES: StickySpec[] = [
  { id: 'sticky-actions-1', frame: 'Actions', text: 'Settled topic — PLATFORM own — due 12 Aug', author: 'riya' },
  { id: 'sticky-actions-2', frame: 'Actions', text: 'Load test before the freeze — PAY-9013', author: 'sam' },
  { id: 'sticky-went-well-1', frame: 'Went well', text: 'Cache shipped inside the sprint', author: 'dana' },
  /** ⟨CASE: an unresolvable sticky⟩ No key, no obvious owner. Sources counts it. */
  { id: 'sticky-watch-1', frame: 'Watch', text: 'The provider keeps changing the statement format', author: 'sam' },
];

export interface PullRequestSpec {
  number: number;
  title: string;
  branch: string;
  author: string;
  at: string;
  merged: boolean;
}

/** Branch names carry the key — a free GitHub↔Jira join, and a real convention. */
export const PULL_REQUESTS: PullRequestSpec[] = [
  { number: 4210, title: 'Publish settled events', branch: 'feature/PAY-9031-settled-events', author: 'dana', at: '2026-08-19T11:00:00Z', merged: false },
  { number: 4198, title: 'Dedupe cache', branch: 'feature/PAY-9012-dedupe-cache', author: 'dana', at: '2026-07-28T15:20:00Z', merged: true },
  { number: 4221, title: 'Ledger schema draft', branch: 'feature/PAY-9044-ledger-schema', author: 'dana', at: '2026-08-21T09:30:00Z', merged: false },
];
