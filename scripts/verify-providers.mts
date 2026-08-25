/**
 * Exercise the chat providers with no vendor credential.
 *
 *   npx tsx scripts/verify-providers.mts
 *
 * WHY THIS EXISTS. The providers were written, typechecked and shipped without
 * a single request ever going through any of them — `docs/KNOWN-GAPS.md` said
 * so under "Neither model provider has ever been run". Typechecking proves the
 * shapes agree with the SDK's declarations; it proves nothing about the parts
 * that actually break, which in this codebase are always the wiring: whether a
 * tool the model asks for is really invoked, whether its result is encoded in a
 * form the API accepts, and whether streamed deltas reach the panel in order.
 *
 * So this stands up a server that speaks just enough of the Anthropic Messages
 * protocol to drive a REAL tool-use loop through `claude.ts`:
 *
 *   turn 1 — the fake model asks for `explain_blocked`, and the SDK's tool
 *            runner must call our handler and post a `tool_result` back
 *   turn 2 — the fake model streams prose, which must arrive as chunks
 *
 * Nothing here mocks the SDK. `claude.ts`, the real `@anthropic-ai/sdk` tool
 * runner and the real gateway tools all run; only the model is fake. That is
 * the seam worth faking, because it is the only one we cannot pay for.
 *
 * Copilot cannot be driven that way — `CopilotClient` spawns its own bundled
 * runtime over RPC rather than speaking HTTP to a URL we control — so it is
 * checked against the real thing instead, which turns out to run unauthenticated
 * right up to the model turn. The Claude CLI needs no fake at all: it authenticates
 * from the developer's own login, so its checks are the real provider.
 *
 * Every check here passes with no vendor credential of any kind.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClaudeAgent } from '../apps/gateway/src/claude.js';
import {
  COPILOT_MODEL,
  streamReply,
  toCopilotTools,
  type CopilotSessionLike,
} from '../apps/gateway/src/copilot.js';
import { claudeCliAvailable, zodShape } from '../apps/gateway/src/claude-cli.js';
import { z } from 'zod';
import type { AgentTool } from '../apps/gateway/src/tools.js';
import type { ContextEnvelope } from '@mc/domain';

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------------------
// A fake Messages API
// ---------------------------------------------------------------------------

/** One SSE frame, in the shape the SDK's stream parser expects. */
function sse(res: ServerResponse, type: string, data: Record<string, unknown>): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

interface Recorded {
  turns: number;
  /** Every tool_result block the SDK posted back to us. */
  toolResults: { tool_use_id: string; content: unknown }[];
  /** The tool schemas the SDK sent, so we can assert the mapping survived. */
  toolNames: string[];
  systemSeen: string;
}

function fakeAnthropic(rec: Recorded, wantTool: string) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const payload = JSON.parse(body || '{}') as {
        tools?: { name: string }[];
        system?: { text?: string }[] | string;
        messages?: { role: string; content: unknown }[];
      };
      rec.turns++;
      rec.toolNames = (payload.tools ?? []).map((t) => t.name);
      rec.systemSeen =
        typeof payload.system === 'string'
          ? payload.system
          : (payload.system ?? []).map((s) => s.text ?? '').join('');

      // Harvest any tool_result the runner posted back on this request.
      for (const m of payload.messages ?? []) {
        if (!Array.isArray(m.content)) continue;
        for (const block of m.content as { type?: string; tool_use_id?: string; content?: unknown }[]) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            rec.toolResults.push({ tool_use_id: block.tool_use_id, content: block.content });
          }
        }
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const first = rec.turns === 1;
      sse(res, 'message_start', {
        message: {
          id: `msg_${rec.turns}`,
          type: 'message',
          role: 'assistant',
          model: 'fake',
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });

      if (first) {
        // Turn 1: demand a tool call. This is the branch that proves the runner
        // reaches our handler at all.
        sse(res, 'content_block_start', {
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_verify_1', name: wantTool, input: {} },
        });
        sse(res, 'content_block_delta', {
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"key":"MC-102"}' },
        });
        sse(res, 'content_block_stop', { index: 0 });
        sse(res, 'message_delta', {
          delta: { stop_reason: 'tool_use', stop_sequence: null },
          usage: { output_tokens: 1 },
        });
      } else {
        // Turn 2: ordinary prose, streamed in pieces.
        sse(res, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        for (const piece of ['MC-102 is blocked ', 'on the provider ', 'signing secret.']) {
          sse(res, 'content_block_delta', {
            index: 0,
            delta: { type: 'text_delta', text: piece },
          });
        }
        sse(res, 'content_block_stop', { index: 0 });
        sse(res, 'message_delta', {
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 3 },
        });
      }
      sse(res, 'message_stop', {});
      res.end();
    });
  });
}

// ---------------------------------------------------------------------------

// Every field of the envelope is optional and `renderContext` guards each read,
// so an empty one is a valid envelope rather than a stub. NOTE that `scripts/`
// is typechecked by NOTHING — the root tsconfig includes only apps/*/src and
// libs/**/src — so a domain type change cannot surface here as an error.
const ENVELOPE: ContextEnvelope = {};

async function verifyClaude(): Promise<void> {
  console.log('\nclaude.ts — a real tool-use loop against a fake Messages API');

  let ran = 0;
  const tools: AgentTool[] = [
    {
      name: 'explain_blocked',
      description: 'Why is a ticket blocked.',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      async handler(args) {
        ran++;
        return { key: args.key, blockedBy: 'provider-signing-secret', sprints: 3 };
      },
    },
  ];

  const rec: Recorded = { turns: 0, toolResults: [], toolNames: [], systemSeen: '' };
  const server = fakeAnthropic(rec, 'explain_blocked');
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as { port: number };
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const agent = await createClaudeAgent({
      key: 'sk-ant-fake-for-verification',
      tools,
      system: 'SYSTEM-PROMPT-MARKER',
      withMemory: (_m, env) => env,
    });

    let text = '';
    let chunks = 0;
    for await (const piece of agent.ask('Why is MC-102 blocked?', ENVELOPE)) {
      text += piece;
      chunks++;
    }
    await agent.dispose();

    check('the tool schema reached the API', rec.toolNames.includes('explain_blocked'),
      `sent: ${JSON.stringify(rec.toolNames)}`);
    check('the system prompt was sent', rec.systemSeen.includes('SYSTEM-PROMPT-MARKER'));
    check('the runner looped for a second turn', rec.turns === 2, `turns=${rec.turns}`);
    check('our handler actually ran', ran === 1, `ran=${ran}`);
    check('a tool_result was posted back', rec.toolResults.length === 1,
      `got ${rec.toolResults.length}`);

    // The handler returns an object; claude.ts JSON-encodes it. If that encoding
    // is wrong the API rejects the turn, which is exactly the failure that
    // "it typechecks" cannot catch.
    const encoded = JSON.stringify(rec.toolResults[0]?.content ?? '');
    check('the tool result carried the handler payload',
      encoded.includes('provider-signing-secret'), encoded.slice(0, 120));

    check('the reply streamed in more than one chunk', chunks > 1, `chunks=${chunks}`);
    check('the reply text arrived intact',
      text === 'MC-102 is blocked on the provider signing secret.', JSON.stringify(text));
  } finally {
    delete process.env.ANTHROPIC_BASE_URL;
    await new Promise<void>((r) => server.close(() => r()));
  }
}

async function verifyCopilot(): Promise<void> {
  console.log('\ncopilot.ts — SDK contract and the event→stream bridge');

  const tools: AgentTool[] = [
    {
      name: 'explain_blocked',
      description: 'Why is a ticket blocked.',
      parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
      handler: async () => ({ ok: true }),
    },
  ];

  try {
    const sdk = await import('@github/copilot-sdk');
    check('the SDK loads', true);

    // The guess this file used to carry was that `parameters` might need Zod.
    // It does not — and this is the assertion that keeps that true.
    const defined = toCopilotTools(tools).map(([name, spec]) => sdk.defineTool(name, spec));
    check('defineTool accepts our JSON Schema', defined.length === 1 && defined[0]?.name === 'explain_blocked');
    check('the handler survives the mapping', typeof defined[0]?.handler === 'function');
  } catch (err) {
    check('the SDK loads', false, String(err));
  }

  // The bridge, against a fake session: deltas arrive on a callback while the
  // turn is in flight, and the generator must hand them out in order, finish on
  // idle, and drain whatever landed after the last yield.
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const session: CopilotSessionLike = {
    on(event: string, cb: (e: never) => void) {
      (handlers[event] ??= []).push(cb as (e: unknown) => void);
    },
    async sendAndWait() {
      const emit = (t: string): void =>
        handlers['assistant.message_delta']?.forEach((h) => h({ data: { deltaContent: t } }));
      emit('MC-102 is blocked ');
      emit('on the secret.');
      // Late delta, after the send resolves but before idle — the drain case.
      setTimeout(() => {
        emit(' Three sprints.');
        handlers['session.idle']?.forEach((h) => h(undefined as never));
      }, 10);
      return {};
    },
  } as CopilotSessionLike;

  let out = '';
  for await (const piece of streamReply(session, 'why?')) out += piece;
  check('the bridge streams deltas in order and drains the tail',
    out === 'MC-102 is blocked on the secret. Three sprints.', JSON.stringify(out));

  // ---- against the real runtime -------------------------------------------
  // The CLI is bundled (`@github/copilot` is a dependency of the SDK), so all
  // of this runs with no credential. Only the model turn needs one, which is
  // exactly the boundary asserted at the end.
  const sdk = await import('@github/copilot-sdk');
  const client = new sdk.CopilotClient();
  try {
    await client.start();
    check('the bundled runtime starts (no token needed)', true);

    const defined = toCopilotTools(tools).map(([n, s]) => sdk.defineTool(n, s));
    const live = await client.createSession({
      model: COPILOT_MODEL,
      streaming: true,
      tools: defined,
      systemMessage: { mode: 'append', content: 'MARKER' },
      onPermissionRequest: sdk.approveAll,
    });
    check('the runtime accepts our exact session config', true);

    // The bare-URL `mcpServers` regression guard went with D5. It asserted that
    // the runtime rejects the shape this file used to send — and nothing in the
    // repo can send `mcpServers` to Copilot any more, so it guarded a config
    // that has no producer while costing a real session round trip. The lesson
    // it was protecting is in copilot.ts's header, where somebody wiring vendor
    // MCP back in would actually read it.

    // And the boundary: everything above works without a credential; the turn
    // itself is where one becomes necessary.
    let authError = '';
    live.on('session.error', (e: { data?: { errorType?: string } }) => {
      authError = e.data?.errorType ?? '';
    });
    try {
      await live.sendAndWait({ prompt: 'Say OK.' }, 15_000);
    } catch {
      /* reported on the event */
    }
    check('a turn fails on authentication and nothing else',
      authError === 'authentication' || !!process.env.GITHUB_TOKEN,
      `errorType=${authError || '(none)'} — set GITHUB_TOKEN and this becomes a real answer`);

    await live.disconnect?.();
  } catch (err) {
    check('the bundled runtime starts (no token needed)', false, String(err).slice(0, 160));
  } finally {
    await client.stop().catch(() => undefined);
  }
}

async function verifyClaudeCode(): Promise<void> {
  console.log('\nclaude-cli.ts — the no-credential provider');

  // The JSON Schema → Zod conversion is where a silent behaviour change hides:
  // optional is the default in JSON Schema and the opposite in Zod, so getting
  // it backwards makes every argument look mandatory and the model starts
  // inventing values for ones it does not have.
  const shape = zodShape({
    type: 'object',
    properties: {
      key: { type: 'string', description: 'A Jira key' },
      kinds: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
      kind: { type: 'string', enum: ['idea', 'impediment'] },
    },
    required: ['key'],
  });
  const parsed = z.object(shape).safeParse({ key: 'MC-102' });
  check('required stays required, the rest optional', parsed.success,
    JSON.stringify(parsed.error?.issues?.slice(0, 2)));
  check('a missing required argument is rejected', !z.object(shape).safeParse({}).success);
  check('enum and array props survive the conversion',
    z.object(shape).safeParse({ key: 'MC-1', kind: 'idea', kinds: ['a'], limit: 2 }).success);
  check('an invalid enum value is rejected',
    !z.object(shape).safeParse({ key: 'MC-1', kind: 'nonsense' }).success);

  const live = await claudeCliAvailable();
  check('the Claude CLI can answer (cached probe)', live,
    'no Claude CLI login found — the provider falls back to ANTHROPIC_API_KEY, then the stub');
}

/**
 * Does the gateway actually let go of the provider runtime?
 *
 * `copilotAvailable` memoises a STARTED runtime — a spawned child process — and
 * `stopCopilotRuntime` is the only thing that can reach it. `agent.dispose()`
 * cannot: that closes a different `CopilotClient` over a different child. So the
 * teardown either names this explicitly or leaks one process per gateway run.
 *
 * The regression this guards is a reorder, not a rewrite: somebody moves
 * `server.close(() => process.exit(0))` up one line and every shutdown after it
 * orphans the runtime, silently — `process.exit` does not wait, and an
 * interactive Ctrl-C hides it because the terminal signals the whole process
 * group. Only a SIGTERM to the pid alone shows it, which is what this sends.
 *
 * Spawned rather than asserted against the source, because "the call is on line
 * N" says nothing about whether shutdown completes. What matters is that the
 * process goes away by itself, and the only honest way to learn that is to ask
 * it to.
 *
 * WHAT IT CANNOT SEE, stated so nobody reads more into a green tick than is
 * there: without Copilot auth, `copilotRuntime` starts the client, finds it
 * unauthenticated, stops it itself and memoises null — so there is no child to
 * orphan and the leak cannot manifest. On this machine the check proves the
 * teardown COMPLETES, which is the regression the added `await` can introduce
 * and which was verified by injecting a promise that never settles. Proving
 * nothing is orphaned needs a credential; `pgrep -f copilot` after a run is the
 * manual version.
 */
async function verifyShutdown(): Promise<void> {
  console.log('\nthe gateway lets go of the provider runtime');

  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const vault = await mkdtemp(join(tmpdir(), 'mc-shutdown-'));
  // Not 8787: a gateway the developer is already running must not be killed by
  // a verifier, and must not make this report a failure that is not theirs.
  const port = '8799';
  const gw = spawn('npx', ['tsx', 'apps/gateway/src/main.ts'], {
    env: { ...process.env, PORT: port, MC_VAULT_DIR: vault, MC_SCHEDULER: 'off' },
    stdio: 'ignore',
  });

  const exited = new Promise<number>((res) => gw.on('exit', () => res(Date.now())));
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await fetch(`http://localhost:${port}/api/health`).then((r) => r.ok).catch(() => false);
  }
  check('it starts', up, `no answer on :${port} after 20s`);

  if (up) {
    const sent = Date.now();
    gw.kill('SIGTERM');
    const done = await Promise.race([
      exited,
      new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
    ]);
    check('SIGTERM to the pid alone completes the teardown', done !== null,
      'still running after 15s — shutdown is hanging, or an await in it never settles');
    if (done !== null) console.log(`         (exited ${((done - sent) / 1000).toFixed(1)}s after the signal)`);
  }

  if (gw.exitCode === null) gw.kill('SIGKILL');
  await rm(vault, { recursive: true, force: true });
}

await verifyClaude();
await verifyClaudeCode();
await verifyCopilot();
await verifyShutdown();

console.log(`\n${failures ? `${failures} check(s) FAILED` : 'all checks passed'}\n`);
process.exit(failures ? 1 : 0);
