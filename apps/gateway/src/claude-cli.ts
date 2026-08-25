/**
 * The Claude CLI provider — a real agent with no API credit.
 *
 * THIS RUNS YOUR LOCAL `claude` CLI. `@anthropic-ai/claude-agent-sdk` is not a
 * second API path — it is the official programmatic wrapper around the same
 * binary the Claude Code install provides, which it spawns as a child process
 * (hence its `pathToClaudeCodeExecutable` option and its "Claude Code
 * executable not found at …" error). Worth saying plainly, because the package
 * name reads like an API client and the wrong reading sends somebody off to
 * reimplement the process management, the JSON-lines parsing and the MCP tool
 * plumbing that this already gets for free.
 *
 * WHY A THIRD PROVIDER. `claude.ts` talks to the Messages API and bills per
 * token; `copilot.ts` needs a GitHub token. This one authenticates from the
 * developer's existing CLI login, so a checkout with an empty `.env` gets a
 * genuine agent over the fixtures rather than the scripted stub. That matters
 * more here than anywhere else: mock mode is meant to be a complete product,
 * and "complete except the agent" was always the weak claim.
 *
 * It is the same contract as the other two: `agent.ts` owns the tool set, the
 * system prompt and the recall wrapper, and hands them over. `HUMAN_ONLY` has
 * already been stripped before this file sees them, so no provider can reach
 * `accept_proposal`.
 *
 * TWO IMPEDANCE MISMATCHES, both handled here rather than pushed onto callers:
 *
 *   1. Custom tools arrive as an in-process MCP server, and `tool()` takes a
 *      Zod raw shape where `AgentTool` carries JSON Schema (which is what the
 *      Messages API wants). `zodShape` below converts the subset our tools
 *      actually use. Giving `AgentTool` a Zod schema instead would push the
 *      conversion onto `claude.ts` and `copilot.ts`, which both take JSON
 *      Schema natively — one converter here is cheaper than two there.
 *   2. It is turn-based rather than message-based, so conversation continuity
 *      is a `resume` session id rather than a replayed transcript.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { VAULT_DIR } from './vault.js';
import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import { renderContext, type ChatThread, type ContextEnvelope } from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';
import type { AgentTool } from './tools.js';

/** Empty means "whatever the CLI is configured to use", which is the point. */
export const CLAUDE_CLI_MODEL = process.env.CLAUDE_CLI_MODEL ?? undefined;

/**
 * A bound on the agent loop, for the same reason `claude.ts` has one: every
 * question here is answerable in a handful of tool calls, and a run that wants
 * twenty is stuck. Stopping beats five minutes of silence.
 */
const MAX_TURNS = Number(process.env.CLAUDE_CLI_MAX_TURNS ?? 12);

// ---------------------------------------------------------------------------
// JSON Schema → Zod, for the subset our tools use
// ---------------------------------------------------------------------------

interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

function zodProp(p: JsonSchemaProp): ZodTypeAny {
  let base: ZodTypeAny;
  if (Array.isArray(p.enum) && p.enum.length) {
    base = z.enum(p.enum.map(String) as [string, ...string[]]);
  } else {
    switch (p.type) {
      case 'number':
      case 'integer':
        base = z.number();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'array':
        base = z.array(p.items ? zodProp(p.items) : z.string());
        break;
      case 'object':
        /**
         * Recurse when the schema describes the object, pass it through when it
         * does not.
         *
         * This used to always pass through, on the grounds that nothing in the
         * tool set nested. `infer.ts` nests — its `record_relations` takes an
         * array of `{from, to, kind, surface, confidence, basis}` — and the
         * failure was silent and expensive to find: the model was handed
         * `z.record(string, unknown)`, so every per-field description, every
         * enum and the whole `required` list vanished on this path alone. It
         * then produced objects missing a field it had never been told about,
         * and only the CLI provider was affected, which reads as a model
         * quality problem rather than a schema one.
         */
        base = p.properties
          ? z.object(shapeOf(p.properties, new Set(p.required ?? [])))
          : z.record(z.string(), z.unknown());
        break;
      default:
        base = z.string();
    }
  }
  return p.description ? base.describe(p.description) : base;
}

/** One level of `{ name: ZodType }`. Shared by the top level and by nesting. */
function shapeOf(
  properties: Record<string, JsonSchemaProp>,
  required: Set<string>,
): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(properties)) {
    const zt = zodProp(prop);
    // Optional is the default in JSON Schema and the opposite in Zod. Getting
    // this backwards makes the model think every argument is mandatory, which
    // shows up as it inventing values for ones it does not have.
    shape[name] = required.has(name) ? zt : zt.optional();
  }
  return shape;
}

/** The `{ name: ZodType }` shape `tool()` wants, from our JSON Schema. */
export function zodShape(parameters: Record<string, unknown>): ZodRawShape {
  const properties = (parameters.properties ?? {}) as Record<string, JsonSchemaProp>;
  const required = new Set((parameters.required as string[] | undefined) ?? []);
  // Built mutable, handed back as the readonly shape `tool()` declares.
  return shapeOf(properties, required) as ZodRawShape;
}

/** Our tools, as an in-process MCP server. */
function toolServer(tools: AgentTool[]) {
  return createSdkMcpServer({
    name: 'mission-control',
    version: '1.0.0',
    tools: tools.map((t) =>
      tool(t.name, t.description, zodShape(t.parameters), async (args) => {
        const result = await t.handler((args ?? {}) as Record<string, unknown>);
        // MCP wants content blocks. `?? null` because a handler returning
        // nothing would stringify to `undefined`, which is not valid JSON.
        return { content: [{ type: 'text' as const, text: JSON.stringify(result ?? null) }] };
      }),
    ),
  });
}

// ---------------------------------------------------------------------------

/**
 * `null` when the SDK cannot be used at all — the caller falls back the same
 * way it does for Copilot rather than taking the gateway down over a chat
 * provider.
 */
export async function createClaudeCliAgent(cfg: ProviderConfig): Promise<Agent | null> {
  const server = toolServer(cfg.tools);

  // One CLI session per conversation, resumed by id. A single session
  // shared across the history list would let an old thread bleed into a new one
  // — the same reason copilot.ts keys its sessions by thread.
  const sessions = new Map<string, string>();

  return {
    async *ask(message: string, env: ContextEnvelope, thread?: ChatThread) {
      const threadId = thread?.id ?? 'default';
      const resume = sessions.get(threadId);

      // The envelope rides on the current turn only: it describes what the user
      // is looking at *now*, and stapling a stale copy to a resumed session is
      // how an agent starts answering about the alert you left ten minutes ago.
      const prompt = `<context>\n${renderContext(cfg.withMemory(message, env))}\n</context>\n\n${message}`;

      const q = query({
        prompt,
        options: {
          systemPrompt: cfg.system,
          ...(CLAUDE_CLI_MODEL ? { model: CLAUDE_CLI_MODEL } : {}),
          mcpServers: { 'mission-control': server },
          // Only ours. Without this the agent also gets the CLI's own file
          // and shell tools, which have no business answering "why is MC-102
          // blocked" and would let a prompt-injected transcript reach a shell.
          allowedTools: cfg.tools.map((t) => `mcp__mission-control__${t.name}`),
          // Our tools are our own handlers over our own gateway, and there is
          // no interactive terminal here to approve anything. The gate that
          // matters is `HUMAN_ONLY`, which already removed accept/reject.
          permissionMode: 'bypassPermissions',
          includePartialMessages: true,
          maxTurns: MAX_TURNS,
          ...(resume ? { resume } : {}),
        },
      });

      for await (const m of q as AsyncIterable<Record<string, unknown>>) {
        const sid = m.session_id;
        if (typeof sid === 'string') sessions.set(threadId, sid);

        // Token-level deltas, same shape the Messages API streams.
        if (m.type === 'stream_event') {
          const event = m.event as
            | { type?: string; delta?: { type?: string; text?: string } }
            | undefined;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            if (event.delta.text) yield event.delta.text;
          }
          continue;
        }

        if (m.type === 'result' && (m.subtype !== 'success' || m.is_error)) {
          // A refusal or a turn limit is not an exception, but the answer must
          // not sit there looking like a dropped connection. `is_error` is read
          // as well as `subtype` for the reason `claudeCliAvailable` does.
          yield `\n\n_(the agent stopped: ${String(m.result ?? m.subtype)})_`;
        }
      }
    },
    async dispose() {
      sessions.clear();
    },
  };
}

/**
 * Can this provider actually answer?
 *
 * The only honest check is a real one-word turn — the SDK importing proves
 * nothing, exactly as `CopilotClient.start()` succeeding proves nothing. But
 * that turn costs ~6s, and `tsx watch` restarts the gateway on every save, so
 * paying it per boot would put six seconds between saving a file and the
 * gateway answering. Cached next to the event log instead, the same way
 * extraction is: asked once a day per machine, not once per keystroke.
 *
 * **`subtype` alone is not the answer, and reading it alone was a bug.** A
 * logged-out CLI yields `{type:'result', subtype:'success', is_error:true,
 * result:'Not logged in · Please run /login'}` — so the probe said the provider
 * was available, `auto` picked `sdk-mcp` as the first available backend, and
 * every structured call then failed against a machine where Copilot was working
 * the whole time. `is_error` is the field that tells the truth.
 *
 * Delete `vault/raw/provider-probe.json` to force a re-check — which is what
 * you want right after logging in or out.
 */
const PROBE_CACHE = join(VAULT_DIR, 'raw', 'provider-probe.json');
const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

export async function claudeCliAvailable(): Promise<boolean> {
  try {
    const cached = JSON.parse(await readFile(PROBE_CACHE, 'utf8')) as {
      claudeCli?: { ok: boolean; at: string };
    };
    const at = Date.parse(cached.claudeCli?.at ?? '');
    if (Number.isFinite(at) && Date.now() - at < PROBE_TTL_MS) {
      return !!cached.claudeCli?.ok;
    }
  } catch {
    // No cache, or an unreadable one. Ask.
  }

  let ok = false;
  try {
    const q = query({
      prompt: 'Reply with exactly: OK',
      options: { maxTurns: 1, permissionMode: 'bypassPermissions', allowedTools: [] },
    });
    for await (const m of q as AsyncIterable<{ type: string; subtype?: string; is_error?: boolean }>) {
      if (m.type === 'result') {
        ok = m.subtype === 'success' && !m.is_error;
        break;
      }
    }
  } catch {
    ok = false;
  }

  try {
    await mkdir(dirname(PROBE_CACHE), { recursive: true });
    await writeFile(PROBE_CACHE, JSON.stringify({ claudeCli: { ok, at: new Date().toISOString() } }, null, 2));
  } catch {
    // An uncacheable answer is still an answer; it just costs 6s next boot.
  }
  return ok;
}
