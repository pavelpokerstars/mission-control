/**
 * The Claude provider — the mock-mode agent.
 *
 * `@anthropic-ai/sdk`, server-side, because the API key must never reach the
 * browser and because `recall()` needs the vault, which the browser does not
 * have. It gets no vendor MCP servers — and since D5 neither does Copilot, so
 * this is no longer a difference between the two providers. The tools that
 * matter here are the cross-surface joins in `tools.ts`, which no vendor server
 * could offer anyway.
 *
 * Why this provider exists at all: `MC_MODE=live` needs five vendor
 * credentials and a Copilot token before the agent says a word. One
 * `ANTHROPIC_API_KEY` gives you a real agent reasoning over the fixtures, which
 * is the thing worth demoing and the thing worth developing against.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { renderContext, type ChatThread, type ContextEnvelope } from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';
import type { AgentTool } from './tools.js';

/** Opus is the default: this is a reasoning job over contradictory sources. */
export const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5';

/**
 * `medium` rather than the `high` default. This is an interactive conversation
 * answering questions against a handful of small tools — the answer arriving
 * while the user is still reading is part of the product. Raise it for a heavier
 * corpus; the sweep is per-deployment, not universal.
 */
type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const CLAUDE_EFFORT = (process.env.ANTHROPIC_EFFORT ?? 'medium') as Effort;

/** A ceiling, not a target — thinking and reply share it. */
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 16_000);

/**
 * A bound on the tool loop. Every cross-surface question here is answerable in
 * a handful of calls; a run that wants twenty is stuck, and stopping is a
 * better answer than a five-minute silence in a narrow column.
 */
const MAX_ITERATIONS = 12;

/**
 * Our tools, as Claude's.
 *
 * `parameters` is already a JSON Schema and the handlers already take a bag of
 * args, so this is a rename plus a JSON encode of the result. The runner does
 * the parse → run → catch → tool_result dance; a thrown handler comes back to
 * the model as an error it can react to rather than killing the turn.
 */
function runnable(tools: AgentTool[]): BetaRunnableTool<Record<string, unknown>>[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Beta.BetaTool['input_schema'],
    parse: (raw: unknown) => (raw ?? {}) as Record<string, unknown>,
    // `?? null` because a handler that returns nothing stringifies to
    // `undefined`, which is not a string and blows up posting the result.
    run: async (args: Record<string, unknown>) => JSON.stringify((await t.handler(args)) ?? null),
  }));
}

/**
 * The transcript, as messages rather than as one rendered blob.
 *
 * `renderHistory` exists for prompts that have to be a single block — Copilot's
 * session replay is one. A message array is better where the API takes one, so
 * a follow-up ("and the other one?") resolves the way the user expects. The
 * context envelope rides on the *current* turn only: it describes what the user
 * is looking at now, and stapling a stale copy to every past turn is how an
 * agent starts answering about the alert you left ten minutes ago.
 */
function toMessages(
  message: string,
  env: ContextEnvelope,
  thread?: ChatThread,
): Anthropic.Beta.BetaMessageParam[] {
  const prior = thread?.history.filter((t) => t.text.trim()) ?? [];
  // The API wants a user turn first. A transcript that opens on an agent turn
  // is possible (a resumed chat trimmed mid-exchange) and is a 400, not a bug
  // worth surfacing — drop the orphan.
  while (prior.length && prior[0]!.role !== 'user') prior.shift();

  return [
    ...prior.map(
      (t): Anthropic.Beta.BetaMessageParam => ({
        role: t.role === 'user' ? 'user' : 'assistant',
        content: t.text,
      }),
    ),
    { role: 'user', content: `<context>\n${renderContext(env)}\n</context>\n\n${message}` },
  ];
}

/**
 * Where the Messages API lives. Normally unset.
 *
 * Two reasons it is a knob. A deployment may sit behind a gateway or proxy
 * rather than talking to api.anthropic.com directly — and, more usefully here,
 * it is what lets this provider be exercised with no credential at all:
 * `scripts/verify-providers.ts` stands up a server that speaks just enough of
 * the Messages protocol to drive a real tool-use loop through the code below.
 * That is the difference between "typechecks" and "the wiring works", and this
 * file had only ever had the first.
 */
function anthropicBaseUrl(): string | undefined {
  return process.env.ANTHROPIC_BASE_URL;
}

export async function createClaudeAgent(cfg: ProviderConfig): Promise<Agent> {
  // Read at call time, not at module scope: the verification harness points
  // this at a local server it starts, and a module-level const would be frozen
  // before it could.
  const baseURL = anthropicBaseUrl();
  const client = new Anthropic({ apiKey: cfg.key, ...(baseURL ? { baseURL } : {}) });
  const tools = runnable(cfg.tools);
  console.log(`[agent] Claude is live — model=${CLAUDE_MODEL} effort=${CLAUDE_EFFORT}`);

  return {
    async *ask(message, env, thread) {
      /**
       * The system prompt and the tool schemas are the same bytes on every
       * turn, and they render ahead of the messages — so one breakpoint on the
       * system block caches both. Everything volatile (the context envelope,
       * the question) is deliberately after it.
       */
      const runner = client.beta.messages.toolRunner({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        output_config: { effort: CLAUDE_EFFORT },
        system: [{ type: 'text', text: cfg.system, cache_control: { type: 'ephemeral' } }],
        tools,
        messages: toMessages(message, cfg.withMemory(message, env), thread),
        max_iterations: MAX_ITERATIONS,
        stream: true,
      });

      // Outer loop: one pass per model turn (the runner runs the tools between
      // them). Inner loop: the tokens of that turn. Thinking blocks arrive with
      // empty text by default and are skipped here — what reaches the reader
      // is the answer.
      for await (const turn of runner) {
        for await (const chunk of turn) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            yield chunk.delta.text;
          }
        }
      }
    },
    async dispose() {},
  };
}
