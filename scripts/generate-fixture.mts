/**
 * Write the fixture programme to disk, in the shape a real collector produces.
 *
 *   npm run fixture
 *
 * Output is COMMITTED (`fixtures/`), because the demo has to run on a machine
 * with no credentials and half the hackathon score is a stranger doing exactly
 * that. Regenerating is deterministic, so a re-run produces no diff unless the
 * spec in `scripts/fixture/` changed.
 *
 * REGENERATING DOES NOT RESEED A VAULT THAT ALREADY EXISTS. `seedHistory` and
 * `seedNotes` only fill an EMPTY vault, deliberately — the fixture is an input
 * and a demo that overwrites what somebody wrote since cannot be trusted. So a
 * spec change plus a running gateway leaves the new events and claims on disk
 * and invisible, with nothing failing: a detector simply stays quiet about a
 * case you just added. Delete the vault to pick them up.
 */
import { join } from 'node:path';
import { generate } from './fixture/generate.js';

const out = process.argv[2] ?? join(process.cwd(), 'fixtures');
const { nodes, edges, records, events, notes } = await generate(out);
console.log(
  `[fixture] ${nodes} nodes, ${edges} edges, ${records} record(s), ${events} event(s), ${notes} note(s) → ${out}`,
);
