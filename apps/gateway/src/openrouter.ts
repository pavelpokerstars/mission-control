/**
 * The OpenRouter provider — the hackathon judge-demo agent.
 *
 * Runs the existing Mission Control system prompt and cross-surface tools
 * against OpenRouter's OpenAI-compatible API, so the demo's "Ask Mission
 * Control" chat answers for real using a FREE model and the shared
 * OPENROUTER_API_KEY (no card, no per-judge credential).
 *
 * It is OpenAI-compatible, so the wiring below is a plain SSE parse of
 * `chat/completions` with `stream: true`. We do NOT use tool-calling here:
 * the tools matter for the richer providers, but for a free-model demo the
 * reliable, low-latency path is to hand the model the rendered context
 * (findings, the vault recall) and let it reason over that text. The
 * `SYSTEM_PROMPT` already tells it to cite surfaces by name, which is exactly
 * what a judge needs to see — reasoning across the joined context, not a
 * black box. Keeping the tool loop out also avoids free-model tool-call
 * flakiness stalling the demo mid-answer.
 *
 * Select it with `MC_MODE=openrouter`. `OPENROUTER_MODEL` overrides the model
 * (default OpenRouter's rotating free-model pool); `OPENROUTER_API_KEY` is read
 * at runtime from the environment (set as a shared Railway variable).
 */

import { renderContext, type ChatThread, type ContextEnvelope } from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';

// A pinned `:free` model can disappear from the pool without notice. The free
// router selects an available free endpoint and never falls through to paid
// models (unlike `openrouter/auto`). This is the same route Clive uses.
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openrouter/free';
// Base URL override: rehearsal / offline testing point a stub here instead of
// spending the shared key. Defaults to the real provider.
const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';

function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || undefined;
}

/**
 * Bounded 429 retry, ported from the toolbelt router (`C:\dev\toolbelt` —
 * `src/toolbelt/llm_router.py` / `js/llm-router.mjs`). The free pool rate-limits
 * under load, and a judge should see a short wait and a retry, not a raw
 * provider error. Three attempts, exponential backoff capped at 30s, and never
 * waiting longer than the 429 actually asked for.
 */
const ATTEMPTS_PER_PROVIDER = 3;
const MAX_WAIT_MS = 120_000;

function retryAfterMs(payload: unknown, headers: Headers): number {
  const headerValue = Number.parseFloat(headers.get('retry-after') ?? '0');
  if (headerValue > 0) return headerValue * 1000;
  const message = (payload as { error?: { message?: string } } | undefined)?.error?.message ?? '';
  const match = String(message).match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/);
  if (!match) return 0;
  return (Number.parseInt(match[1] || '0', 10) * 60 + Number.parseFloat(match[2] || '0')) * 1000;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Short, judge-facing words instead of raw provider JSON. The gateway streams
 * this straight into the chat, so it must read as a UI state, not a stack trace.
 */
function friendlyError(status: number): string {
  if (status === 429) {
    return 'Mission Control is asking the free AI pool too fast. Please wait a moment and try again.';
  }
  if (status === 401 || status === 403) {
    return 'Mission Control cannot reach its AI provider (an access problem).';
  }
  if (status === 404) return 'The free model is temporarily unavailable. Please try again in a moment.';
  if (status >= 500) return 'The AI provider is having trouble. Please try again in a moment.';
  return `Mission Control could not get an answer (${status}).`;
}

/**
 * POST to OpenRouter with bounded 429 retry. Non-429 responses are returned as
 * they are, so each caller keeps its own error handling; only a 429 that
 * outlives the backoff throws.
 */
async function postOpenRouter(body: unknown): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error('OPENROUTER_API_KEY is not set — cannot reach OpenRouter');

  for (let attempt = 0; attempt < ATTEMPTS_PER_PROVIDER; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://mission-control.demo',
        'X-Title': 'Mission Control Judge Demo',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const payload = await res.json().catch(() => ({}));
      const waitMs = retryAfterMs(payload, res.headers);
      if (waitMs > MAX_WAIT_MS || attempt === ATTEMPTS_PER_PROVIDER - 1) {
        console.warn('[openrouter] rate limited, giving up');
        throw new Error(friendlyError(429));
      }
      await sleep(waitMs || Math.min(1000 * 2 ** attempt, 30_000));
      continue;
    }

    return res;
  }

  throw new Error(friendlyError(0));
}

/** Turn the context envelope + thread into an OpenAI message array. */
function toMessages(
  message: string,
  env: ContextEnvelope,
  thread?: ChatThread,
): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const prior = (thread?.history ?? []).filter((t) => t.text.trim());
  while (prior.length && prior[0]!.role !== 'user') prior.shift();

  const history = prior.map((t) => ({
    role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: t.text,
  }));

  return [
    ...history,
    {
      role: 'user',
      content: `<context>\n${renderContext(env)}\n</context>\n\n${message}`,
    },
  ];
}

export async function createOpenRouterAgent(cfg: ProviderConfig): Promise<Agent> {
  const key = apiKey();
  if (!key) {
    throw new Error('OPENROUTER_API_KEY is not set — cannot start the OpenRouter provider');
  }
  console.log(`[agent] OpenRouter is live — model=${OPENROUTER_MODEL}`);

  return {
    async *ask(message, env, thread) {
      const body = {
        model: OPENROUTER_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: cfg.system },
          ...toMessages(message, cfg.withMemory(message, env), thread),
        ],
        // Free models are small; keep the answer bounded and snappy for a demo.
        max_tokens: 800,
        temperature: 0.3,
        // Some free routes expose reasoning tokens. Ask OpenRouter to exclude
        // them from the response; the setting belongs in the request body, not
        // in OPENROUTER_MODEL.
        reasoning: { exclude: true },
      };

      const res = await postOpenRouter(body);

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        console.warn(`[openrouter] ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(friendlyError(res.status));
      }

      // OpenAI SSE: lines `data: {json}` terminating in `data: [DONE]`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const json = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
              error?: { message?: string };
            };
            if (json.error?.message) throw new Error(json.error.message);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch (e) {
            if (e instanceof Error && jsonErr(e)) throw e;
            // A partial JSON line is rare but possible mid-chunk; ignore it and
            // let the next read complete the frame rather than killing the turn.
          }
        }
      }
    },
    async dispose() {},
  };
}

function jsonErr(e: unknown): boolean {
  return e instanceof SyntaxError ? false : e instanceof Error;
}

/**
 * Structured (typed) answer over OpenRouter for the inference / extract /
 * summary passes.
 *
 * These three need a `tool_choice`-style forced JSON reply. OpenRouter is
 * OpenAI-compatible, so we ask for `response_format: { type: 'json_object' }`
 * and parse the object out of the reply. Free models honour `json_object`, and
 * a malformed reply just returns `undefined` — every caller already degrades to
 * its deterministic pass on `undefined`, so a weak free-model answer never
 * takes the gateway down.
 *
 * Only used when `MC_MODE=openrouter`, so the shared `OPENROUTER_API_KEY` is
 * the sole credential for every model call on the Railway judge deploy — no
 * Copilot, no Anthropic key.
 */
export async function askOpenRouterStructured(req: {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  system: string;
  prompt: string;
}): Promise<unknown> {
  const key = apiKey();
  if (!key) return undefined;

  let res: Response;
  try {
    res = await postOpenRouter({
      model: OPENROUTER_MODEL,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `${req.system}\n\nYou MUST reply with a single JSON object matching this schema and nothing else:\n${JSON.stringify(req.schema, null, 2)}`,
        },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
      reasoning: { exclude: true },
    });
  } catch {
    // A 429 that outlived the backoff is a rate limit, not an answer to parse.
    return undefined;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[openrouter] structured ${res.status}: ${detail.slice(0, 200)}`);
    return undefined;
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // Some free models wrap the object in prose; let the caller's parser/validate
    // path have a go, but here we only return a real object or undefined.
    const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
