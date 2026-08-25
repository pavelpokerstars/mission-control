/**
 * One way to ask a model for a typed answer — and three ways to carry it.
 *
 * WHY THIS EXISTS. Three modules need the same thing: hand the model a schema,
 * a system prompt and a rendered brief, and get back JSON in that shape.
 * `summary.ts` (the ticket's status read), `infer.ts` (relationship edges) and
 * `extract.ts` (action items the cue regexes miss). Before this file each of
 * them wrote the request twice — once as an in-process MCP tool for the CLI
 * provider, once as a forced `tool_use` for the Messages API — and the two
 * copies drifted.
 *
 * That drift is not hypothetical and it is not cheap. `zodShape` used to flatten
 * nested objects, so every per-field description, every enum and the whole
 * `required` list vanished on the CLI path ALONE while the API path stayed
 * correct. The model then omitted fields it had never been shown, which reads as
 * the model being stupid rather than as a schema bug — and the CLI path is the
 * default a fresh checkout uses, so it is the one nobody was comparing against.
 * `KNOWN-GAPS.md` §1 lists another still open. One seam makes that whole class
 * of one-sided bug impossible: there is now a single description of the request,
 * and the backends differ only in how they carry it.
 *
 * WHY IT IS SWAPPABLE, AND NOT JUST SHARED. The in-process MCP server here is
 * not an integration — no separate process, no network transport, no
 * `.mcp.json`, nothing to install or approve. It is a transport for our own
 * functions, chosen because the CLI SDK has no `tool_choice` and a tool handler
 * is the only way to force a structured reply out of it. But a workspace that
 * forbids MCP may forbid it bluntly, and nothing this product needs may sit
 * behind a capability that can be switched off by policy. So the transport is a
 * named choice with two fallbacks, and picking one is an env var rather than a
 * rewrite of three modules.
 *
 * THE THREE BACKENDS, worst-case last:
 *
 *   `sdk-mcp`       the local `claude` CLI, tools as an in-process MCP server.
 *                   Costs nothing beyond the developer's own CLI login, which
 *                   is why it is first — see `claude-cli.ts`.
 *   `messages-api`  `ANTHROPIC_API_KEY`, native `tool_use` with `tool_choice`
 *                   forced. No MCP anywhere in the request. Metered.
 *   `copilot`       the bundled Copilot runtime, one `defineTool` recorder.
 *                   JSON Schema goes straight through and MCP is not involved
 *                   at any point — see `askCopilotStructured`. This is the one
 *                   that carries a deployment where Copilot is the approved
 *                   assistant and MCP is forbidden.
 *   `prompt-json`   the CLI with NO tools at all: ask for a fenced JSON object
 *                   and parse it. The escape hatch for an environment that
 *                   allows the binary and forbids the plumbing. Deliberately
 *                   last: a real schema is doing work that prose cannot, and
 *                   both known bugs in this area were the model quietly not
 *                   being told something.
 *
 * WHAT IT DOES NOT DO. It does not coerce. Every caller has its own idea of what
 * a usable answer is — `infer.ts` drops edges below a confidence floor and
 * insists on a `basis`, `summary.ts` requires citations, `extract.ts` has a
 * minimum text length — and folding those into one validator would produce a
 * validator that means nothing in particular. This returns whatever the model
 * put in the arguments, and `undefined` when nothing came back at all.
 *
 * It also does not decide what happens on failure. It throws; the callers all
 * already wrap their model call so a bad turn degrades to "no summary", "no
 * inferred edges", "the regexes are the whole answer" rather than a dead route.
 */

import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
import { claudeCliAvailable, zodShape } from './claude-cli.js';
import { askCopilotStructured, copilotAvailable } from './copilot.js';

/** One request for a typed answer, in the form every caller already had. */
export interface StructuredAsk {
  /** The tool the model must call. Also names the JSON object in `prompt-json`. */
  name: string;
  description: string;
  /**
   * JSON Schema for the arguments. The Messages API takes it as-is, which is
   * why `type` is pinned to the literal rather than left as `string` — the SDK
   * types the field as a discriminated union and a widened `type` does not fit.
   */
  schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  system: string;
  /** The rendered brief, corpus or transcript. */
  prompt: string;
  maxTokens: number;
  /**
   * Model id for the metered backend. The CLI backends take the developer's
   * own default unless `CLAUDE_CLI_MODEL` overrides it, exactly as the chat
   * provider does — a per-caller model override there would silently spend a
   * different model than the one `inspect.mjs health` reports.
   */
  model: string;
}

export type StructuredBackend = 'sdk-mcp' | 'messages-api' | 'copilot' | 'prompt-json';

/**
 * What this machine can actually reach, probed once at boot rather than here.
 *
 * Both probes cost a real round trip — `claudeCliAvailable` spends a one-word
 * turn, `copilotAvailable` spawns the runtime — and this factory is called
 * three times. `main.ts` pays for each once and passes the answers down, the
 * same way it already did for the CLI alone.
 */
export interface ProviderCaps {
  claudeCli: boolean;
  copilot: boolean;
}

/**
 * Probe every provider once per process, and hand the same answer to all three
 * callers.
 *
 * Memoised on the promise rather than the result, so three near-simultaneous
 * calls at boot share one probe instead of racing three. Without that, starting
 * the gateway spent a `claude` turn AND spawned the Copilot runtime three times
 * apiece before answering its first request.
 *
 * Neither probe is a guess: `claudeCliAvailable` spends a real one-word turn
 * (cached on disk for 24h) and `copilotAvailable` starts the runtime and asks it
 * whether it is authenticated — both because the cheap checks lie. An SDK
 * importing and a session being creatable each succeed on a machine that cannot
 * answer, which is the failure `createCopilotAgent` was already written to
 * avoid: `start()` and `createSession()` both pass unauthenticated, and only the
 * first real turn dies.
 */
let caps: Promise<ProviderCaps> | undefined;

export function providerCaps(): Promise<ProviderCaps> {
  caps ??= (async () => {
    const [claudeCli, copilot] = await Promise.all([
      claudeCliAvailable().catch(() => false),
      copilotAvailable().catch(() => false),
    ]);
    console.log(`[structured] providers — claude-cli=${claudeCli} copilot=${copilot}`);
    return { claudeCli, copilot };
  })();
  return caps;
}

export interface Structured {
  backend: StructuredBackend;
  /**
   * The transport's identity — `claude-cli` or `messages-api`. Deliberately NOT
   * a model id: each caller has its own `ANTHROPIC_*_MODEL` override and only
   * the caller knows which one it just spent, so a model name guessed here
   * would be wrong for two of the three.
   */
  provider: string;
  /** The model's arguments, or `undefined` if it never answered in shape. */
  ask(req: StructuredAsk): Promise<unknown>;
}

/**
 * `auto` walks the ladder. Anything else pins one backend and fails rather than
 * falling through — pinning is what you do when you already know the
 * environment, and a pin that silently degrades to something else is not a pin.
 *
 * READ AT CALL TIME, NOT AT MODULE SCOPE, and the reason is the same one
 * `anthropicBaseUrl` in `claude.ts` carries: a module-level `const` is frozen
 * before anything can change it. `scripts/probe-mcp.mts` sets this per
 * iteration to compare the backends against one schema, and with the value
 * captured at import every row silently reported whichever backend `auto` had
 * already chosen — four identical runs printed as four different ones, which is
 * worse than an error because it reads as a passing test.
 */
function requestedBackend(): StructuredBackend | 'auto' {
  return (process.env.MC_STRUCTURED ?? 'auto').trim() as StructuredBackend | 'auto';
}

const BACKENDS: readonly StructuredBackend[] = ['sdk-mcp', 'messages-api', 'copilot', 'prompt-json'];

// ---------------------------------------------------------------------------
// The backends
// ---------------------------------------------------------------------------

/**
 * The CLI SDK has no `tool_choice`, so the handler captures the call instead of
 * the reply being read off the response.
 *
 * `allowedTools` is the recorder alone. Without it the agent also inherits the
 * CLI's own file and shell tools, and everything these callers pass in is
 * untrusted text — a Slack line, a transcript segment, a note somebody wrote.
 */
async function viaSdkMcp(req: StructuredAsk): Promise<unknown> {
  let captured: unknown;
  const serverName = `mission-control-${req.name}`;
  const server = createSdkMcpServer({
    name: serverName,
    version: '1.0.0',
    tools: [
      tool(req.name, req.description, zodShape(req.schema), async (args) => {
        captured = args;
        return { content: [{ type: 'text' as const, text: '{"ok":true}' }] };
      }),
    ],
  });

  const q = query({
    prompt: `${req.prompt}\n\nCall ${req.name} with your answer.`,
    options: {
      systemPrompt: req.system,
      ...(process.env.CLAUDE_CLI_MODEL ? { model: process.env.CLAUDE_CLI_MODEL } : {}),
      mcpServers: { [serverName]: server },
      allowedTools: [`mcp__${serverName}__${req.name}`],
      permissionMode: 'bypassPermissions',
      maxTurns: 3,
    },
  });
  for await (const _ of q as AsyncIterable<unknown>) {
    // Drained for its side effect: the handler above runs mid-stream.
  }
  return captured;
}

/** Forced `tool_choice`, so the reply is the record rather than a paragraph. */
async function viaMessagesApi(req: StructuredAsk, apiKey: string): Promise<unknown> {
  const client = new Anthropic({ apiKey });
  const res = await client.beta.messages.create({
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: req.name, description: req.description, input_schema: req.schema }],
    tool_choice: { type: 'tool', name: req.name },
    messages: [{ role: 'user', content: req.prompt }],
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  return block && block.type === 'tool_use' ? block.input : undefined;
}

/**
 * The CLI with no tools at all — the answer arrives as text and is parsed.
 *
 * The schema still goes in the prompt. A field list in prose is weaker than a
 * tool schema (that is the whole reason this backend is last), but it is much
 * better than nothing: both bugs this file exists to prevent were the model not
 * being told about a field, and printing the schema is the cheapest way to keep
 * telling it.
 */
async function viaPromptJson(req: StructuredAsk): Promise<unknown> {
  const instruction = [
    req.prompt,
    '',
    '---',
    '',
    `Reply with ONE JSON object matching this JSON Schema, and nothing else — no`,
    `commentary before or after, no explanation. Wrap it in a \`\`\`json fence.`,
    '',
    '```json',
    JSON.stringify(req.schema, null, 2),
    '```',
  ].join('\n');

  let text = '';
  const q = query({
    prompt: instruction,
    options: {
      systemPrompt: req.system,
      ...(process.env.CLAUDE_CLI_MODEL ? { model: process.env.CLAUDE_CLI_MODEL } : {}),
      // No tools, which is the entire point of this backend.
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      maxTurns: 1,
      includePartialMessages: true,
    },
  });
  for await (const m of q as AsyncIterable<Record<string, unknown>>) {
    if (m.type !== 'stream_event') continue;
    const event = m.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      text += event.delta.text ?? '';
    }
  }
  return parseJsonObject(text);
}

/**
 * Pull one JSON object out of a model's prose.
 *
 * Exported for the same reason `slotIsOpen` is: it is the part of this backend
 * that can be wrong in interesting ways, and a pure function can be checked
 * against a table of real replies instead of by spending a turn.
 *
 * Prefers a fenced block, because a model that explains itself first will
 * usually still fence the answer. Falls back to the outermost brace pair, and
 * scans it rather than taking the first `{` and the last `}` — a reply ending
 * in a sentence containing a brace would otherwise swallow the prose too.
 */
export function parseJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
  const candidates = [fenced?.[1], braceSpan(text)].filter((s): s is string => !!s?.trim());
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // Try the next candidate. A fence containing prose is common enough.
    }
  }
  return undefined;
}

/** The first balanced `{…}` span, ignoring braces inside strings. */
function braceSpan(text: string): string | undefined {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

function available(backend: StructuredBackend, caps: ProviderCaps): boolean {
  switch (backend) {
    case 'sdk-mcp':
    case 'prompt-json':
      return caps.claudeCli;
    case 'messages-api':
      return !!process.env.ANTHROPIC_API_KEY;
    case 'copilot':
      return caps.copilot;
  }
}

/**
 * `null` when nothing on this machine can answer — the ordinary case with no
 * CLI login and no key, and a supported state rather than a degraded one. Every
 * caller treats it as "the deterministic pass is the whole answer".
 *
 * `caps` is passed in rather than probed here because both probes cost a real
 * round trip and `main.ts` already pays for each once at boot.
 */
export function createStructured(caps: ProviderCaps, label: string): Structured | null {
  const requested = requestedBackend();
  const wanted: StructuredBackend[] =
    requested === 'auto'
      ? [...BACKENDS]
      : BACKENDS.includes(requested)
        ? [requested]
        : (() => {
            console.warn(
              `[${label}] MC_STRUCTURED="${requested}" is not one of ${BACKENDS.join(', ')} — walking the ladder instead.`,
            );
            return [...BACKENDS];
          })();

  const backend = wanted.find((b) => available(b, caps));
  if (!backend) {
    if (requested !== 'auto') {
      console.warn(`[${label}] MC_STRUCTURED=${requested} is pinned but unavailable — off.`);
    }
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  return {
    backend,
    provider: backend === 'messages-api' ? 'messages-api' : backend === 'copilot' ? 'copilot' : 'claude-cli',
    ask: (req) => {
      switch (backend) {
        case 'sdk-mcp':
          return viaSdkMcp(req);
        case 'messages-api':
          return viaMessagesApi(req, apiKey!);
        case 'copilot':
          return askCopilotStructured({
            name: req.name,
            description: req.description,
            parameters: req.schema,
            system: req.system,
            prompt: req.prompt,
          });
        case 'prompt-json':
          return viaPromptJson(req);
      }
    },
  };
}
