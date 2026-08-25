/**
 * Does this machine allow the structured-output backends?
 *
 * Run it in any environment before assuming which one works — the whole point
 * of `structured.ts` is that the answer differs per machine. Each backend is
 * asked the same question with the same schema, so the output is comparable.
 *
 *   npx tsx scripts/probe-mcp.mts
 *
 * `copilot` is the one that matters for a deployment where GitHub Copilot is the
 * approved assistant and MCP is forbidden — it reaches a model through
 * `defineTool`, which takes JSON Schema natively and involves no MCP at all.
 */
import {
  createStructured,
  parseJsonObject,
  providerCaps,
  type StructuredBackend,
} from '../apps/gateway/src/structured.js';
import { stopCopilotRuntime } from '../apps/gateway/src/copilot.js';

const SCHEMA = {
  type: 'object' as const,
  properties: {
    verdict: { type: 'string', description: 'Exactly the word: works' },
    n: { type: 'number', description: 'Exactly 42' },
    nested: {
      type: 'object',
      description: 'Proves nested schemas survive the conversion.',
      properties: { colour: { type: 'string', description: 'Exactly: green' } },
      required: ['colour'],
    },
  },
  required: ['verdict', 'n', 'nested'],
};

const BACKENDS: StructuredBackend[] = ['sdk-mcp', 'messages-api', 'copilot', 'prompt-json'];

// A pure check first: the one part of prompt-json that can be wrong quietly.
const parseCases: [string, string, boolean][] = [
  ['fenced', '```json\n{"a":1}\n```', true],
  ['fenced, with prose', 'Sure!\n```json\n{"a":1}\n```\nHope that helps.', true],
  ['bare object', 'here: {"a":1}', true],
  ['brace in a string', '{"a":"} not the end","b":2}', true],
  ['trailing prose with a brace', '{"a":1} and then {oops', true],
  ['no object at all', 'I could not answer that.', false],
];
console.log('parseJsonObject');
let parseOk = true;
for (const [name, input, want] of parseCases) {
  const got = parseJsonObject(input) !== undefined;
  const pass = got === want;
  parseOk &&= pass;
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}`);
}
console.log('');

const caps = await providerCaps();

const results: { backend: string; state: 'ok' | 'odd' | 'failed' | 'unavailable'; detail?: string }[] = [];

for (const backend of BACKENDS) {
  process.env.MC_STRUCTURED = backend;
  const s = createStructured(caps, 'probe');
  if (!s) {
    results.push({ backend, state: 'unavailable' });
    console.log(`${backend.padEnd(13)} unavailable on this machine`);
    continue;
  }
  const t0 = Date.now();
  try {
    const out = (await s.ask({
      name: 'record_probe',
      description: 'Record the probe result.',
      schema: SCHEMA,
      system: 'You are a test fixture. Answer exactly as instructed, with no commentary.',
      prompt: 'Report verdict="works", n=42, nested.colour="green".',
      maxTokens: 500,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
    })) as Record<string, unknown> | undefined;

    const nested = (out?.nested ?? {}) as Record<string, unknown>;
    const shaped = out?.verdict === 'works' && out?.n === 42 && nested.colour === 'green';
    results.push({ backend, state: shaped ? 'ok' : 'odd' });
    console.log(
      `${backend.padEnd(13)} ${shaped ? 'OK  ' : 'ODD '} ${Date.now() - t0}ms  ${JSON.stringify(out)}`,
    );
  } catch (err) {
    results.push({ backend, state: 'failed', detail: String(err).slice(0, 160) });
    console.log(`${backend.padEnd(13)} FAILED ${Date.now() - t0}ms  ${String(err).slice(0, 160)}`);
  }
}

/**
 * A verdict, not just a table.
 *
 * The point of this probe is that the answer differs per environment — a
 * workspace may forbid MCP bluntly, and nothing this product needs may sit
 * behind a capability policy can switch off. So it ends by saying whether that
 * property currently holds, rather than leaving somebody to read four rows and
 * work it out.
 */
console.log('');
const ok = results.filter((r) => r.state === 'ok').map((r) => r.backend);
const unavailable = results.filter((r) => r.state === 'unavailable').map((r) => r.backend);
const broken = results.filter((r) => r.state === 'failed' || r.state === 'odd');

if (ok.length) {
  console.log(`${ok.length} of ${results.length} backend(s) work here: ${ok.join(', ')}`);
  console.log(`\`auto\` walks the ladder in order, so this machine gets ${ok[0]}.`);
} else {
  console.log('NO backend works here. Structured output is how `summary.ts`, `infer.ts` and');
  console.log('`extract.ts` ask for typed JSON, so all three degrade to null — which is a');
  console.log('supported state, not a crash: the app runs and those three features are off.');
}
if (unavailable.length) {
  console.log('');
  console.log(`unavailable (no credential on this machine): ${unavailable.join(', ')}`);
  console.log('  messages-api  needs ANTHROPIC_API_KEY');
  console.log('  copilot       needs GITHUB_TOKEN, or a gh/OAuth login');
}
if (broken.length) {
  console.log('');
  console.log('These have a credential and did not answer correctly, which is the');
  console.log('interesting case — an auth gate passing and the turn failing is the one');
  console.log('failure you cannot debug from outside:');
  for (const b of broken) console.log(`  ${b.backend}  ${b.state}${b.detail ? ` — ${b.detail}` : ''}`);
}
console.log('');

// `copilotAvailable` above memoises a started runtime — a spawned child this
// process would otherwise orphan, leaving the event loop it drains to exit held
// open. Setting `process.exitCode` rather than calling `process.exit` is what
// makes this necessary.
await stopCopilotRuntime();

// A broken backend is a failure; an absent credential is not.
if (!parseOk || broken.length) process.exitCode = 1;
