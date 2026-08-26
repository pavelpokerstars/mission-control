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
 * (default a free one); `OPENROUTER_API_KEY` is read at runtime from the
 * environment (set as a shared Railway variable).
 */

import { renderContext, type ChatThread, type ContextEnvelope } from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';

export const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? 'meta-llama/llama-3.3-8b-instruct:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function apiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || undefined;
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
      };

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

      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenRouter ${res.status}: ${detail.slice(0, 300)}`);
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
