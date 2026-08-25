/**
 * Does a re-derive notice the right things, and stay quiet about the rest?
 *
 *   npx tsx scripts/verify-refresh.mts
 *
 * The interesting cases are the ones a graph updated IN PLACE cannot produce: a
 * removed edge, and a container that closed. Both are invisible unless you keep
 * the previous run to compare against, and both are the reason this exists.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { StoredGraph } from '../libs/domain/src/index.js';

let failures = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};

// The vault dir has to be set before `refresh.ts` reads it at module scope.
const dir = await mkdtemp(join(tmpdir(), 'mc-refresh-'));
process.env.MC_VAULT_DIR = dir;
const { runRefresh, diffSignatures, signatureOf, deltaToEvents } =
  await import('../apps/gateway/src/refresh.js');

const base = JSON.parse(
  await readFile(join(process.cwd(), 'fixtures', 'graph.json'), 'utf8'),
) as StoredGraph;

try {
  console.log('the first run is a baseline, never news');
  {
    const r = await runRefresh(base, new Date('2026-08-23T07:00:00Z'));
    check('it baselines', r.baseline);
    check('and announces nothing', r.events === 0, `${r.events} events`);
  }

  console.log('\nan unchanged graph is silent');
  {
    const r = await runRefresh(base, new Date('2026-08-23T19:00:00Z'));
    check('it does not baseline again', !r.baseline);
    check('and emits nothing', r.events === 0, `${r.events} events`);
  }

  console.log('\na changed graph reports exactly what moved');
  {
    // A sprint closes, an edge appears, an edge vanishes.
    const next: StoredGraph = structuredClone(base);
    const sprint = next.nodes.find((n) => n.kind === 'sprint' && 'state' in n && n.state === 'active');
    if (sprint && 'state' in sprint) sprint.state = 'closed';
    const dropped = next.links.pop()!;
    next.links.push({
      source: next.nodes[0]!.id,
      target: next.nodes[1]!.id,
      relation: 'mentions',
      tier: 'EXTRACTED',
      origin: 'structural',
      evidence: [],
    });

    const d = diffSignatures(
      signatureOf(base),
      signatureOf(next),
      '2026-08-24T07:00:00Z',
    );
    check('the new edge is added', d.addedEdges.length === 1, `${d.addedEdges.length}`);
    // The half an in-place update can never produce.
    check('the vanished edge is removed', d.removedEdges.length === 1, `${d.removedEdges.length}`);
    check(
      'and it is the one that went',
      d.removedEdges[0]?.source === dropped.source && d.removedEdges[0]?.target === dropped.target,
    );
    check('the sprint closing is a status change', d.statusChanges.some((c) => c.to === 'closed'));

    const r = await runRefresh(next, new Date('2026-08-24T07:00:00Z'));
    check('it emits events', r.events > 0, `${r.events}`);

    /**
     * THE PAYLOAD, not just the count.
     *
     * `r.events > 0` alone passed while the event said `removed: 1` and never
     * which edge — so the half of a diff that an in-place update cannot produce
     * reached the log as a number nothing could act on. A check that asserts an
     * event was emitted, and not what it carried, is how that survived.
     */
    const emitted = deltaToEvents(d).find((e) => e.type === 'mc.graph_refreshed');
    const pl = (emitted?.payload ?? {}) as {
      added?: number; removed?: number;
      addedEdges?: { source: string; target: string }[];
      removedEdges?: { source: string; target: string }[];
    };
    check('the refresh event carries the added edge identities',
      pl.addedEdges?.length === pl.added, `${pl.addedEdges?.length} of ${pl.added}`);
    check('and the removed ones, which is the half that matters',
      pl.removedEdges?.length === pl.removed, `${pl.removedEdges?.length} of ${pl.removed}`);
    check('and names the edge that actually went',
      pl.removedEdges?.[0]?.source === dropped.source &&
        pl.removedEdges?.[0]?.target === dropped.target,
      JSON.stringify(pl.removedEdges?.[0] ?? null));
  }

  console.log('\na different generator is not a diff');
  {
    const foreign: StoredGraph = structuredClone(base);
    foreign.graph.generator = 'programme_graph';
    const r = await runRefresh(foreign, new Date('2026-08-24T08:00:00Z'));
    // Every id would read as added and every one of ours as removed — a whole
    // programme announced as new because a different collector wrote the file.
    check('it re-baselines instead', r.baseline);
    check('and says why', !!r.why?.includes('generator'), r.why ?? '');
  }

  console.log('\na stale signature re-baselines rather than reporting a season');
  {
    // Reset the stored signature to OUR generator first. The previous case left
    // a foreign one behind, and that branch is checked before staleness — so
    // without this the test passes for the wrong reason, which is worse than
    // failing.
    await runRefresh(base, new Date('2026-08-24T09:00:00Z'));

    const later = new Date('2026-09-01T07:00:00Z');
    const r = await runRefresh(base, later);
    check('it baselines', r.baseline);
    check('and says why', !!r.why?.includes('day old'), r.why ?? '');
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('the refresh behaves');
}
