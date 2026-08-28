/**
 * OpenRouter — a fourth chat provider, and the only one that runs on a host
 * with no developer logged into it.
 *
 * WHY IT EXISTS ON TOP OF THE LADDER THAT WAS ALREADY THERE. The three in
 * `agent.ts` each assume something a deployed container does not have: the
 * Claude CLI authenticates from a developer's own login, Copilot from a `gh`
 * session or stored OAuth, and `ANTHROPIC_API_KEY` is a metered credential per
 * person. A shared demo URL has none of those and wants none of them — one key
 * in one dashboard variable, answering for everybody who opens the link. That
 * is what this is for, and it is why it is selected by `MC_MODE=openrouter`
 * rather than inserted into the mock ladder: nothing about a laptop changes.
 *
 * NO TOOL LOOP, DELIBERATELY. Every other provider gets the cross-surface tools
 * and calls them; this one is handed the rendered context — the findings, the
 * vault recall, the thread — and reasons over that text. Two reasons, and the
 * second is the load-bearing one. Cheap models are erratic at tool-calling and
 * a stalled loop is a demo that hangs mid-answer. And the context envelope
 * already contains what the tools would have fetched, because `renderContext`
 * is what the richer providers read *first* anyway. What is lost is follow-up
 * retrieval — a question whose answer is not in the envelope gets "I cannot see
 * that from here" instead of a second lookup. For a walkthrough of a fixed
 * fixture that is the right trade; for a real deployment it is not, which is
 * why this is a mode and not the default.
 *
 * `SYSTEM_PROMPT` already tells the model to name the surface it read a claim
 * from, so the answer still shows its working — which is the whole product
 * argument and the thing a demo must not quietly drop.
 */

import { renderContext, type ChatThread, type ContextEnvelope } from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';

/**
 * The free routing pool, not a pinned `:free` model.
 *
 * A specific free model can leave the pool without notice and take the demo
 * with it. `openrouter/free` selects whatever free endpoint is up, and — unlike
 * `openrouter/auto` — never falls through to a paid one, so a shared key cannot
 * quietly start spending.
 *
 * BUT PIN A MODEL FOR ANYTHING PEOPLE WILL WATCH, because the pool's whole
 * property — any free endpoint that is up — is also its hazard, and both ways
 * it fails were seen on the deployed demo:
 *
 *   - a TOOL-TUNED model streamed `<dots_function_call> <invoke name="` into
 *     the content channel, hallucinating the tool frame this provider
 *     deliberately does not use, and the chat rendered the raw markup;
 *   - a REASONING model returned a clean, empty, error-free stream, because
 *     `reasoning: exclude` removes the only channel it wrote to.
 *
 * `supported_parameters` on `/api/v1/models` rules both out before you pay for
 * the lesson: a model with no `tools` cannot emit the first, and one with no
 * `reasoning` cannot produce the second. `mistralai/mistral-small-24b-instruct-2501`
 * has neither, supports `response_format`, and runs about half a cent per
 * walkthrough — which is what the deploy pins today.
 */
export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'openrouter/free';

/**
 * Overridable so the retry can be exercised without a credential.
 * `scripts/stub-openrouter.mjs` answers 429 twice and then streams, which is
 * the only way to test the backoff without either a key or a rate limit.
 */
const OPENROUTER_URL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';

function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || undefined;
}

/**
 * Bounded retry on 429, because a free pool rate-limits under exactly the load
 * a demo produces — several people opening the same link at once.
 *
 * Three attempts, exponential backoff, and never waiting longer than the
 * response actually asked for: `retry-after` first, then the delay named in the
 * error text, then a doubling fallback. A wait longer than `MAX_WAIT_MS` is not
 * a wait, it is a hang, so it gives up and says so in words a reader can act on.
 */
const ATTEMPTS = 3;
const MAX_WAIT_MS = 120_000;
const MAX_BACKOFF_MS = 30_000;

function retryAfterMs(payload: unknown, headers: Headers): number {
  const header = Number.parseFloat(headers.get('retry-after') ?? '0');
  if (header > 0) return header * 1000;
  const message = (payload as { error?: { message?: string } } | undefined)?.error?.message ?? '';
  const m = /try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/.exec(String(message));
  if (!m) return 0;
  return (Number.parseInt(m[1] || '0', 10) * 60 + Number.parseFloat(m[2] || '0')) * 1000;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A sentence, not a status line. This is streamed straight into the chat, so it
 * has to read as something the interface is telling you rather than as a stack
 * trace that leaked.
 */
function friendlyError(status: number): string {
  if (status === 429) return 'The free model pool is busy. Wait a moment and ask again.';
  if (status === 401 || status === 403) return 'The AI provider refused the credential this instance is using.';
  if (status === 404) return 'That model is not available right now. Try again in a moment.';
  if (status >= 500) return 'The AI provider is having trouble. Try again in a moment.';
  return `No answer came back from the AI provider (${status}).`;
}

/** POST with the 429 retry. Every other status is returned for the caller to read. */
async function post(body: unknown): Promise<Response> {
  const key = apiKey();
  if (!key) throw new Error('OPENROUTER_API_KEY is not set — cannot reach OpenRouter');

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        // OpenRouter attributes usage by these two. They are not credentials.
        'HTTP-Referer': process.env.MC_APP_URL ?? 'http://localhost:4200',
        'X-Title': 'Mission Control',
      },
      body: JSON.stringify(body),
    });

    if (res.status !== 429) return res;

    const payload = await res.json().catch(() => ({}));
    const asked = retryAfterMs(payload, res.headers);
    if (asked > MAX_WAIT_MS || attempt === ATTEMPTS - 1) {
      console.warn('[openrouter] rate limited, and out of attempts');
      throw new Error(friendlyError(429));
    }
    await sleep(asked || Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS));
  }

  throw new Error(friendlyError(429));
}

/**
 * The envelope and the thread as an OpenAI message array.
 *
 * The history is trimmed to start on a `user` turn: an assistant message with
 * no question before it is a fragment, and some providers reject the array
 * outright for it. Empty turns are dropped for the same reason — a streaming
 * answer that failed leaves one behind.
 */
function toMessages(
  message: string,
  env: ContextEnvelope,
  thread?: ChatThread,
): { role: 'user' | 'assistant'; content: string }[] {
  const prior = (thread?.history ?? []).filter((t) => t.text.trim());
  while (prior.length && prior[0]!.role !== 'user') prior.shift();

  return [
    ...prior.map((t) => ({
      role: (t.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: t.text,
    })),
    { role: 'user' as const, content: `<context>\n${renderContext(env)}\n</context>\n\n${message}` },
  ];
}

export async function createOpenRouterAgent(cfg: ProviderConfig): Promise<Agent> {
  if (!apiKey()) {
    throw new Error('OPENROUTER_API_KEY is not set — cannot start the OpenRouter provider');
  }
  console.log(`[agent] OpenRouter is live — model=${OPENROUTER_MODEL}`);

  return {
    async *ask(message, env, thread) {
      const res = await post({
        model: OPENROUTER_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: cfg.system },
          ...toMessages(message, cfg.withMemory(message, env), thread),
        ],
        // Bounded and warm rather than long and creative: this answers about a
        // fixed set of records, and a wandering answer is a slower demo.
        max_tokens: 800,
        temperature: 0.3,
        // Some routes emit reasoning tokens into the same stream. Excluded in
        // the BODY — it is a request setting, not part of the model name.
        reasoning: { exclude: true },
      });

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        console.warn(`[openrouter] ${res.status}: ${detail.slice(0, 200)}`);
        throw new Error(friendlyError(res.status));
      }

      // OpenAI SSE: `data: {json}` lines, terminated by `data: [DONE]`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      /**
       * AN EMPTY ANSWER IS INDISTINGUISHABLE FROM A BROKEN ONE, so it has to be
       * caught here and named.
       *
       * A 200 that streams no content at all is a real and silent failure mode,
       * and the way in is the model: on a REASONING model, `reasoning: exclude`
       * strips the only channel it wrote to, and `max_tokens` is spent thinking.
       * Measured on `qwen/qwen3.7-flash` against this exact request — a clean
       * `[DONE]`, no error, no text, and a chat bubble that just sat there empty
       * with nothing in the log to explain it.
       */
      let yielded = false;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        // The tail may be half a frame; it is completed by the next read.
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') {
            if (!yielded) throw new Error(emptyAnswer());
            return;
          }

          let frame: { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
          try {
            frame = JSON.parse(payload);
          } catch {
            // A partial frame that split across reads. Skip it rather than
            // killing the turn — `buffer` will carry the rest.
            continue;
          }
          if (frame.error?.message) throw new Error(frame.error.message);
          const delta = frame.choices?.[0]?.delta?.content;
          if (delta) {
            yielded = true;
            yield delta;
          }
        }
      }

      // The stream ended without `[DONE]` — same failure, same explanation.
      if (!yielded) throw new Error(emptyAnswer());
    },
    async dispose() {},
  };
}

/**
 * Named, because the cause is almost always the model and almost never the
 * gateway — and the reader is the one person who can change it.
 */
function emptyAnswer(): string {
  return (
    `${OPENROUTER_MODEL} returned an empty answer. Reasoning models spend their ` +
    'budget on tokens this provider excludes; set OPENROUTER_MODEL to one without ' +
    'a `reasoning` parameter.'
  );
}

/**
 * The typed answer, for `extract`, `infer` and `summary`.
 *
 * OpenRouter is OpenAI-compatible, so this asks for
 * `response_format: { type: 'json_object' }` and parses the object out. It
 * RETURNS `undefined` RATHER THAN THROWING on every failure — a refusal, a rate
 * limit, prose wrapped around the JSON — because all three callers already
 * treat `undefined` as "the deterministic pass is the whole answer". A cheap
 * model producing a poor object must not be able to take the gateway with it.
 */
export async function askOpenRouterStructured(req: {
  name: string;
  description: string;
  schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  system: string;
  prompt: string;
}): Promise<unknown> {
  if (!apiKey()) return undefined;

  let res: Response;
  try {
    res = await post({
      model: OPENROUTER_MODEL,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `${req.system}\n\nReply with a single JSON object matching this schema, and nothing else:\n` +
            JSON.stringify(req.schema, null, 2),
        },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
      reasoning: { exclude: true },
    });
  } catch {
    // A rate limit that outlived the backoff is not an answer to parse.
    return undefined;
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.warn(`[openrouter] structured ${res.status}: ${detail.slice(0, 200)}`);
    return undefined;
  }

  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    // Some models honour `json_object` and still wrap it in a fence.
    const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(text);
    if (!fenced?.[1]) return undefined;
    try {
      return JSON.parse(fenced[1]);
    } catch {
      return undefined;
    }
  }
}

/** Whether this instance can reach OpenRouter at all. */
export function openRouterAvailable(): boolean {
  return !!apiKey();
}
