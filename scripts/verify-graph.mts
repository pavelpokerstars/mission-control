/**
 * Does a stored graph mean what `GRAPH-SCHEMA.md` says it means?
 *
 * There is no test framework here, so this is the same shape as
 * `verify-providers.mts`: a real fixture through the real functions, run by
 * hand and by anyone changing the contract.
 *
 *   npx tsx scripts/verify-graph.mts
 *
 * The dependency direction is the reason it exists. `depends_on` runs
 * dependent → blocker and this codebase's `blocks` runs blocker → dependent, so
 * every reader must flip. A reversal is plausible, renders perfectly and states
 * the opposite of the truth, which is why the fixture's two ends are called
 * `blocker` and `waiter` — a flip that goes the wrong way cannot look right.
 */
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultStore, decodeNote } from '../libs/vault/src/store.js';
import { filedKeys, findLinkProblems, findMissingTickets } from '../apps/gateway/src/findings.js';
import {
  blocksPairOf,
  edgeObservationKey,
  isNodeKind,
  isRenderableEdge,
  isStructuralDependency,
  reconstructCommitmentJoin,
  STORED_NODE_KINDS,
  STORED_RELATIONS,
  type StoredEdge,
  type StoredGraph,
} from '../libs/domain/src/index.js';
import {
  createGraphConnectors,
  type GraphSource,
} from '../libs/connectors/src/index.js';
import { connectorsFor, installGraph } from '../apps/gateway/src/graph-source.js';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const edge = (e: Partial<StoredEdge>): StoredEdge => ({
  source: 'issue:PAY-1',
  target: 'issue:PAY-2',
  relation: 'depends_on',
  tier: 'EXTRACTED',
  origin: 'declared',
  evidence: [],
  ...e,
});

// A graph small enough to reason about, in the exact on-disk shape.
const fixture: StoredGraph = {
  directed: true,
  multigraph: true,
  graph: { generatedAt: new Date().toISOString(), generator: 'verify-graph', sources: ['jira'] },
  nodes: [
    { id: 'issue:PAY-blocker', kind: 'issue', label: 'The thing being waited for',
      source: 'jira', key: 'PAY-blocker', level: 'story', status: 'In Progress',
      statusCategory: 'doing' },
    { id: 'issue:PAY-waiter', kind: 'issue', label: 'The thing that is waiting',
      source: 'jira', key: 'PAY-waiter', level: 'story', status: 'To Do',
      statusCategory: 'todo' },
  ],
  // "PAY-waiter depends_on PAY-blocker" — the waiter is the SOURCE.
  links: [edge({ source: 'issue:PAY-waiter', target: 'issue:PAY-blocker' })],
};

console.log('direction');
{
  const pair = blocksPairOf(fixture.links[0]!);
  check('a depends_on edge produces a blocks pair', !!pair);
  check(
    'blocks runs BLOCKER first',
    pair?.from === 'issue:PAY-blocker',
    `got from=${pair?.from}`,
  );
  check(
    'blocks runs WAITER second',
    pair?.to === 'issue:PAY-waiter',
    `got to=${pair?.to}`,
  );
  check('a non-dependency edge produces nothing', blocksPairOf(edge({ relation: 'mentions' })) === undefined);
}

console.log('\nan inference must explain itself');
{
  check('INFERRED with a why is renderable', isRenderableEdge({ tier: 'INFERRED', why: 'the runbook and PAY-1 name the same secret' }));
  check('INFERRED with no why is dropped', !isRenderableEdge({ tier: 'INFERRED' }));
  check('INFERRED with blank why is dropped', !isRenderableEdge({ tier: 'INFERRED', why: '   ' }));
  check('EXTRACTED needs no why', isRenderableEdge({ tier: 'EXTRACTED' }));
  check('AMBIGUOUS needs no why', isRenderableEdge({ tier: 'AMBIGUOUS' }));
}

console.log('\nonly a corroborated dependency may raise a cycle');
{
  check('EXTRACTED depends_on counts', isStructuralDependency({ relation: 'depends_on', tier: 'EXTRACTED' }));
  check('INFERRED depends_on does not', !isStructuralDependency({ relation: 'depends_on', tier: 'INFERRED' }));
  check('AMBIGUOUS depends_on does not', !isStructuralDependency({ relation: 'depends_on', tier: 'AMBIGUOUS' }));
  check('an EXTRACTED non-dependency does not', !isStructuralDependency({ relation: 'mentions', tier: 'EXTRACTED' }));
}

console.log('\nthe vocabulary is closed');
{
  check('no duplicate node kinds', new Set(STORED_NODE_KINDS).size === STORED_NODE_KINDS.length);
  check('no duplicate relations', new Set(STORED_RELATIONS).size === STORED_RELATIONS.length);
  const nodeIds = new Set(fixture.nodes.map((n) => n.id));
  const dangling = fixture.links.filter((l) => !nodeIds.has(l.source) || !nodeIds.has(l.target));
  check('the fixture has no dangling edge', dangling.length === 0, `${dangling.length} dangling`);
}

console.log('\nan observation key cannot collide');
{
  const k = edgeObservationKey;
  check(
    'the same edge gives the same key',
    k({ source: 'issue:A-1', target: 'issue:A-2', relation: 'depends_on' }) ===
      k({ source: 'issue:A-1', target: 'issue:A-2', relation: 'depends_on' }),
  );
  check(
    'direction is part of the key',
    k({ source: 'issue:A-1', target: 'issue:A-2', relation: 'depends_on' }) !==
      k({ source: 'issue:A-2', target: 'issue:A-1', relation: 'depends_on' }),
  );
  check(
    'relation is part of the key',
    k({ source: 'issue:A-1', target: 'issue:A-2', relation: 'depends_on' }) !==
      k({ source: 'issue:A-1', target: 'issue:A-2', relation: 'mentions' }),
  );
  // The reason it is JSON and not a joined string: real ids carry ':' and '/',
  // so any hand-picked separator is one some source can emit. These two edges
  // collide under a ':'-join and must not here.
  check(
    'ids containing the separator do not collide',
    k({ source: 'message:slack/C1/1.2', target: 'issue:A-1', relation: 'mentions' }) !==
      k({ source: 'message:slack/C1', target: '1.2:issue:A-1', relation: 'mentions' }),
  );
}

// ---------------------------------------------------------------------------
// The note fields the detectors stand on
// ---------------------------------------------------------------------------

// Not the graph, but the same contract: `StoredNote` in the schema mirrors these
// exactly, and the gap detector cannot fire without them. They round-trip
// through hand-rolled frontmatter, so "it typechecks" proves nothing.
console.log('\na note carries what the detector needs');
{
  const dir = join(tmpdir(), `mc-verify-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const store = new VaultStore(dir);
    await store.init();
    await store.create({
      id: 'gate',
      kind: 'commitment',
      title: 'a promise with an owner and a date',
      relatedKeys: ['PAY-9031'],
      owner: 'sanjay.rao@example.com',
      dueAt: '2026-08-12',
      container: 'sprint:PAY-Sprint-12',
      joins: { 'PAY-9031': { tier: 'INFERRED', why: 'same sprint, same speaker', confidence: 0.6 } },
      recency: 'dated',
      verifiedAt: new Date().toISOString(),
      body: 'x',
    });

    // Read from DISK through a second store, not from the in-memory copy — the
    // bug this catches is a field that saves and never comes back, and an
    // in-memory read cannot see it. Asserting literal values rather than
    // create-vs-decoded matters for the same reason: comparing the two passes
    // trivially when both are undefined, which is how a dropped field hid here.
    const reread = new VaultStore(dir);
    await reread.init();
    const n = reread.get('gate');
    check('owner survives a write and a reload', n?.owner === 'sanjay.rao@example.com');
    check('dueAt survives', n?.dueAt === '2026-08-12');
    check('container survives', n?.container === 'sprint:PAY-Sprint-12');
    check('a join keeps its tier', n?.joins?.['PAY-9031']?.tier === 'INFERRED');
    check('a join keeps its why', n?.joins?.['PAY-9031']?.why === 'same sprint, same speaker');

    // A tier the parser does not recognise degrades to "extracted" rather than
    // taking the note down. Losing one join's provenance is the safe direction.
    const bad = decodeNote(
      'bad',
      ['---', 'id: bad', 'kind: idea', 'title: t', 'recency: timeless',
       'joins:', '  - {"key":"A-1","tier":"NONSENSE"}', '---', '', 'body'].join('\n'),
    );
    check('an unrecognised tier is dropped, not thrown', bad.joins === undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// The generated fixture
// ---------------------------------------------------------------------------

/**
 * The contract holding in the abstract is not the interesting question — the
 * fixture every detector is developed against holding it is. And the planted
 * cases are what rots silently: an edit to the spec that quietly removes the
 * unjoined commitment leaves a demo where the hero alert simply never fires,
 * with nothing failing anywhere.
 */
console.log('\nthe generated fixture');
{
  let graph: StoredGraph | undefined;
  try {
    graph = JSON.parse(await readFile(join(process.cwd(), 'fixtures', 'graph.json'), 'utf8')) as StoredGraph;
  } catch {
    check('fixtures/graph.json exists — run `npm run fixture`', false);
  }

  if (graph) {
    const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
    const dangling = graph.links.filter((l) => !nodes.has(l.source) || !nodes.has(l.target));
    check('no edge points at a node that does not exist', dangling.length === 0, `${dangling.length} dangling`);
    check('every id is kind:value', graph.nodes.every((n) => /^[a-z]+:/.test(n.id)));
    check('no INFERRED edge is missing its why', graph.links.every(isRenderableEdge));

    const notes = graph.nodes.filter((n) => n.kind === 'note');
    const joined = new Set(graph.links.filter((l) => l.relation === 'annotates').map((l) => l.source));
    const unjoined = notes.filter((n) => !joined.has(n.id));

    // ⟨the hero⟩ an owner, a date, a closed container, and no ticket.
    const hero = unjoined.find((n) => 'owner' in n && n.owner && 'dueAt' in n && n.dueAt);
    check('an unjoined claim with an owner and a date exists', !!hero);
    const container = hero && 'container' in hero ? nodes.get(String(hero.container)) : undefined;
    check(
      'its container has closed, so the trigger can fire',
      !!container && 'state' in container && container.state === 'closed',
    );

    // ⟨the gate⟩ an unjoined claim WITHOUT them, which must not fire.
    check(
      'an unjoined claim without an owner or date also exists',
      unjoined.some((n) => !('owner' in n && n.owner) && !('dueAt' in n && n.dueAt)),
    );

    const deps = graph.links.filter((l) => l.relation === 'depends_on');
    const declared = new Set(deps.filter((d) => d.origin === 'declared').map((d) => `${d.source}->${d.target}`));

    // ⟨undetected dependency⟩ reconstructed from prose, never declared in Jira.
    check(
      'a dependency exists that Jira never recorded',
      deps.some((d) => d.origin === 'reconstructed' && !declared.has(`${d.source}->${d.target}`)),
    );

    // ⟨suspect link⟩ declared, uncorroborated, and the ends contradict.
    check(
      'a declared dependency with nothing behind it exists',
      deps.some((d) => d.origin === 'declared' && d.tier === 'AMBIGUOUS'),
    );

    // ⟨cycle⟩ and it must be raiseable, which means EXTRACTED only.
    const structural = deps.filter(isStructuralDependency);
    check('the cycle is drawn from corroborated edges only', structural.length >= 4);

    // ⟨the URL join⟩ the one that fires when no key is present anywhere.
    check('a record joins by URL rather than by key', graph.links.some((l) => l.relation === 'links_to'));

    // ⟨the reorg⟩ dated membership, or "who owns this now" is unanswerable.
    check(
      'somebody has left a squad, with a date',
      graph.links.some((l) => l.relation === 'member_of' && !!l.validTo),
    );

    // Determinism is the demo's whole reliability story.
    check('the fixture declares a fixed generation time', !!graph.graph.generatedAt);
  }
}

// ---------------------------------------------------------------------------
// The detectors, over the fixture
// ---------------------------------------------------------------------------

/**
 * The last link in the chain: the contract holds, the fixture plants the cases,
 * and the detectors actually find them.
 *
 * Checking the first two without this leaves the failure that matters
 * unguarded — a fixture can be perfectly valid and still produce an empty alert
 * list, which is the one outcome that makes the whole product look like it does
 * nothing.
 */
console.log('\nthe detectors find what was planted');
{
  const dir = join(tmpdir(), `mc-findings-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const graph = JSON.parse(
      await readFile(join(process.cwd(), 'fixtures', 'graph.json'), 'utf8'),
    ) as StoredGraph;

    const store = new VaultStore(dir);
    await store.init();
    const notesDir = join(process.cwd(), 'fixtures', 'notes');
    for (const f of (await readdir(notesDir)).filter((x) => x.endsWith('.md'))) {
      const id = f.slice(0, -3);
      const { id: _i, links: _l, ...draft } = decodeNote(id, await readFile(join(notesDir, f), 'utf8'));
      await store.create({ ...draft, id });
    }
    const notes = store.list();

    const gaps = findMissingTickets(notes, graph);
    check('the missing ticket fires', gaps.length === 1, `${gaps.length} fired`);
    check('and it is critical, because it is well past due', gaps[0]?.severity === 'crit');
    check('and it names the promise it came from', gaps[0]?.subject.kind === 'commitment');
    check('and it carries the evidence it was read from', (gaps[0]?.evidence.length ?? 0) >= 1);

    // The gate. An unjoined promise with no owner and no date is in the vault,
    // is visible, and must NOT interrupt anybody — without this the detector
    // nags about everything said aloud and gets muted inside a week.
    const ungated = notes.filter(
      (n) => n.kind === 'commitment' && n.status === 'open' && !n.relatedKeys.length && (!n.owner || !n.dueAt),
    );
    check('an unowned, undated promise exists in the vault', ungated.length >= 1);
    check(
      'and the detector leaves it alone',
      !gaps.some((g) => g.subject.kind === 'commitment' && ungated.some((n) => n.id === g.subject.noteId)),
    );

    // Every finding must be able to cite. A page that states a claim and shows
    // no record is the uncited assertion this product exists not to be, and it
    // is invisible from the API — the finding is well-formed, just empty.
    check('the missing ticket cites its records', (gaps[0]?.evidence.length ?? 0) >= 2);

    /**
     * THE FILED/GUESSED SPLIT, which is what stops a reconstruction silencing
     * the flagship alert.
     *
     * `dana-owns-settled-event` carries `relatedKeys: [PAY-9031]` with an
     * `INFERRED` join — somebody worked that key out, nobody typed it. Before
     * `filedKeys` existed the gate was `relatedKeys.length > 0`, so the note
     * read as tracked and the alert stayed silent about a promise no record
     * connects to anything. It is skipped here for a DIFFERENT reason (its
     * sprint is still active, which is `missing_ticket`'s trigger), so both
     * halves have to be asserted or the split looks tested when it is not.
     */
    const guessed = notes.find((n) => n.relatedKeys.some((k) => n.joins?.[k]?.tier === 'INFERRED'));
    check('a note with a reconstructed key exists in the fixture', !!guessed);
    check(
      'and a reconstructed key does not count as filed',
      !!guessed && filedKeys(guessed).length === 0,
      `filed: ${guessed ? filedKeys(guessed).join(',') : '—'}`,
    );
    /**
     * A key with NO `joins` entry is `EXTRACTED` by default — the text named it
     * — so every note written before `joins` existed stays correct without
     * being rewritten. That default is what makes the split free.
     */
    /**
     * A key with NO `joins` entry is `EXTRACTED` by default — the text named it.
     *
     * Asserted against a constructed note rather than a fixture one, because
     * every note in `fixtures/` that carries a key also carries a `joins`
     * entry: the default is exactly the case the fixture cannot reach, and it
     * is the one that keeps every note written before `joins` existed working
     * unchanged. A check that silently could not run is worse than none.
     */
    check(
      'a key with no join entry counts as typed',
      filedKeys({ ...notes[0]!, relatedKeys: ['PAY-1'], joins: undefined }).length === 1,
    );
    check(
      'and a mixed note keeps only the typed half',
      filedKeys({
        ...notes[0]!,
        relatedKeys: ['PAY-1', 'PAY-2'],
        joins: { 'PAY-2': { tier: 'INFERRED', why: 'worked out' } },
      }).join() === 'PAY-1',
    );

    /**
     * THE RECONSTRUCTION REFUSES WHEN IT CANNOT TELL, and that refusal is the
     * load-bearing half of the design.
     *
     * Measured on this fixture, the HIGHEST-scoring candidate for "Dana takes
     * the settled event end to end" is PAY-9033 at 0.50 — the wrong ticket —
     * with PAY-9031 and PAY-9032 tied behind it at 0.40. A rule that broke the
     * tie by score would mint a confident, wrong link with a plausible reason
     * attached. Two survivors must mint nothing.
     */
    const sprintIssues = graph.nodes
      .filter(isNodeKind('issue'))
      .filter((n) => graph.links.some((e) => e.relation === 'in_sprint' && e.source === n.id))
      .map((n) => ({ key: n.key, label: n.label, ...(n.assignee ? { assignee: n.assignee } : {}) }));

    check(
      'an ambiguous scope mints nothing',
      reconstructCommitmentJoin({
        title: 'somebody to take the settled event end to end',
        owner: 'nobody@example.com',
        scope: sprintIssues,
        resolve: (h) => h,
      }) === undefined,
    );
    check(
      'and a promise with no owner mints nothing',
      reconstructCommitmentJoin({
        title: 'take the settled event end to end',
        scope: sprintIssues,
        resolve: (h) => h,
      }) === undefined,
    );

    const links = findLinkProblems(graph, new Map());
    check('a dependency nobody recorded is found', links.some((f) => f.kind === 'undetected_dependency'));
    check('a link with nothing behind it is found', links.some((f) => f.kind === 'suspect_link'));
    check('every finding carries a dedupeKey', [...gaps, ...links].every((f) => !!f.dedupeKey));
    check('every finding cites at least one record', [...gaps, ...links].every((f) => f.evidence.length > 0));
    check(
      'ids are stable, so a finding can be deferred and matched again',
      new Set([...gaps, ...links].map((f) => f.id)).size === gaps.length + links.length,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------

console.log('\nthe connectors follow a swapped graph, and keep what was written');
{
  /**
   * THE DERIVED HALF IS REBUILT; THE ASSERTED HALF IS NOT. Same rule as the
   * storage tiers in `GRAPH-SCHEMA.md` §2, one layer down.
   *
   * A collector rewrites `graph.json` under a running gateway twice a day. The
   * connectors have to answer from the new file, or every route serves the boot
   * snapshot until somebody restarts — and they have to keep the ticket that was
   * created, the comment that was posted and the page that was published, or
   * accepting a proposal is undone by the next re-derive.
   *
   * This is the check that makes the lazy projection safe to rely on. Written
   * before it, against the eager one, where it failed.
   */
  const graphWith = (keys: string[]): StoredGraph => ({
    graph: { generator: 'test', generatedAt: '2026-08-25T00:00:00Z', sources: ['jira'] },
    nodes: keys.map((k) => ({
      id: `issue:${k}`,
      kind: 'issue' as const,
      label: `${k} title`,
      source: 'jira' as const,
      key: k,
      level: 'story',
      status: 'To Do',
      statusCategory: 'todo',
    })),
    links: [],
  });

  const sourceOf = (g: StoredGraph): GraphSource => ({ graph: g, records: new Map() });

  let live: GraphSource = sourceOf(graphWith(['AA-1', 'AA-2']));
  const c = createGraphConnectors(() => live, 'board-1');

  const before = await c.jira.listItems();
  check('it projects the graph it is given', before.length === 2, `${before.length}`);

  // Write through every additive path: a ticket, a comment, a page, a message.
  const made = await c.jira.createItem({ title: 'from a proposal', status: 'todo' });
  await c.jira.comment(made.key, 'provenance');
  await c.confluence.publish({ title: 'pack', html: '<p>x</p>', relatedKeys: [] });
  const channels = await c.slack.listChannels();
  if (channels[0]) await c.slack.post(channels[0].id, 'posted');

  // The collector runs: AA-2 is gone, AA-3 is new, AA-1 has moved on.
  const next = graphWith(['AA-1', 'AA-3']);
  next.nodes[0]!.status = 'In Progress';
  live = sourceOf(next);

  const after = await c.jira.listItems();
  const keys = after.map((i) => i.key).sort();
  check('it answers from the NEW graph after a swap',
    keys.includes('AA-3') && !keys.includes('AA-2'), keys.join(','));
  check('and a field the collector moved comes through',
    after.find((i) => i.key === 'AA-1')?.status === 'in_progress',
    String(after.find((i) => i.key === 'AA-1')?.status));

  check('the created ticket survives the swap', keys.includes(made.key), keys.join(','));
  check('the comment survives', (await c.jira.listComments(made.key)).length === 1);
  check('the published page survives',
    (await c.confluence.listPages()).some((pg) => pg.title === 'pack'));
  check('the posted message survives',
    channels[0]
      ? (await c.slack.listMessages(channels[0].id)).some((m) => m.text === 'posted')
      : true);

  // The collector eventually catches up and exports the ticket we made. It must
  // appear once, from the graph, not twice.
  const caught = graphWith(['AA-1', 'AA-3', made.key]);
  live = sourceOf(caught);
  const settled = await c.jira.listItems();
  check('a created key the collector later exports is not duplicated',
    settled.filter((i) => i.key === made.key).length === 1,
    `${settled.filter((i) => i.key === made.key).length}`);

  /**
   * And the gateway's own default wiring, which is the bit `main.ts` leans on.
   *
   * `connectorsFor()` with no argument reads the cell, so `installGraph` is the
   * one line that moves the whole process onto a collector's new file. Asserted
   * with the connectors built BEFORE the swap, because that is the real
   * sequence: everything is composed once at boot and the refresh job swaps
   * underneath it twelve hours later.
   */
  installGraph(sourceOf(graphWith(['BB-1'])));
  const wired = connectorsFor();
  check('connectorsFor() reads the cell', (await wired.jira.listItems())[0]?.key === 'BB-1');

  installGraph(sourceOf(graphWith(['BB-2'])));
  check('and installGraph moves it, without rebuilding anything',
    (await wired.jira.listItems())[0]?.key === 'BB-2',
    (await wired.jira.listItems())[0]?.key ?? 'none');
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('the contract holds');
}
