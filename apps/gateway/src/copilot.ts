/**
 * The Copilot provider — the live-mode agent.
 *
 * IT SPEAKS TO NO VENDOR, and it used to speak to four.
 *
 * This file was cheap to write because as of 2026 all four planning tools ship
 * official remote MCP servers and the Copilot SDK speaks MCP natively, so
 * "make the agent aware of Jira, Confluence, Miro, Zoom and Slack" was a config
 * block rather than a week of adapters. Those four endpoints — Atlassian,
 * Slack, Miro and Zoom — are gone (ROADMAP D5). Two reasons, and the second is
 * the one that decides it:
 *
 *   - the organisation this runs in forbids external MCP servers, so with them
 *     wired in the live provider does not start there at all; and
 *   - they were the old answer to "how do we get real data in", and they are
 *     not the current one. Five collectors now read Jira, Zoom, Confluence,
 *     Slack and GitHub into one graph AHEAD of the turn, and the gateway serves
 *     that. What the endpoints bought was the agent reading a vendor live
 *     mid-turn; what they cost was a turn that could not happen at all.
 *
 * Nothing about our own tools changed with them: `defineTool` takes JSON Schema
 * natively and has never involved MCP, so every cross-surface join, the vault,
 * the trail and the timeline are untouched. We add custom tools only for things
 * no single vendor can know: the cross-surface joins. This runs server-side
 * because the Copilot token must never reach the browser.
 *
 * ---------------------------------------------------------------------------
 * SWITCHING THIS ON. `npm i @github/copilot-sdk` (done) and set `GITHUB_TOKEN`,
 * then `MC_MODE=live npm run dev:gateway`. `node scripts/inspect.mjs health`
 * says which provider actually answered.
 *
 * This file used to ship with its wiring commented out and three call shapes
 * guessed from the docs. All three are now checked against the installed
 * package's own type declarations, and one of the guesses was wrong:
 *
 *   1. `defineTool`'s `parameters` — GUESSED it might need Zod. It does not:
 *      `ZodSchema<T> | Record<string, unknown>`, so our JSON Schema goes
 *      straight through and `AgentTool` needs no second schema.
 *   2. the system prompt — GUESSED `customAgents[].prompt`. WRONG. It is
 *      `SessionConfigBase.systemMessage`, and `mode: 'append'` is the one to
 *      use: `'replace'` drops the SDK's own guardrails, security included.
 *   3. `assistant.message_delta` + `session.idle` — both real, both typed.
 *
 * And one thing neither the docs nor the guesses caught, recorded for whoever
 * wires vendor MCP back in somewhere the policy allows it: `mcpServers` is
 * `Record<string, MCPServerConfig>`, not `Record<string, string>`. The bare
 * URLs this file used to export would have been rejected at session creation.
 * The transport is per-endpoint too, and not cosmetic — Atlassian's is SSE
 * (`/v1/sse`) and the other three are streamable HTTP, and the runtime connects
 * differently for each. This file no longer sends `mcpServers` at all.
 *
 * WHAT IS STILL UNVERIFIED: no `GITHUB_TOKEN` has ever gone through this, and
 * `CopilotClient` spawns the Copilot CLI runtime, so `client.start()` is the
 * first thing that will fail on a machine without it. That failure is caught
 * and degrades to the stub rather than taking the gateway down.
 * ---------------------------------------------------------------------------
 */

import {
  renderContext,
  renderHistory,
  type ChatThread,
  type ContextEnvelope,
} from '@mc/domain';
import type { Agent, ProviderConfig } from './agent.js';
import type { AgentTool } from './tools.js';

/**
 * `auto`, because a specific model id is a guess about somebody else's account.
 *
 * This defaulted to `gpt-5`, which **this account does not have** — and the
 * failure is the one that is hardest to read from outside: the runtime starts,
 * `getAuthStatus()` says authenticated, and only `session.create` dies with
 * *Model "gpt-5" is not available*. Auth passing and the turn failing looks
 * like a credential problem and is not one.
 *
 * Copilot's model list is per-account and moves: this one offers `auto`,
 * `claude-sonnet-5`, `claude-opus-5`, `gpt-5.6-sol`, `gpt-5.6-terra`,
 * `gpt-5.6-luna` and `gpt-5.3-codex`. The only id that is always present is
 * `auto`, which lets Copilot choose — so it is the honest default, and
 * `COPILOT_MODEL` still pins a specific one when somebody knows their account
 * has it.
 */
export const COPILOT_MODEL = process.env.COPILOT_MODEL ?? 'auto';

/**
 * The Copilot credential, or nothing — and a personal access token counts as
 * nothing. This is the sibling of the trap documented at the `CopilotClient`
 * construction below, one layer up.
 *
 * `gh auth login` leaves an OAuth token in the keyring, and plenty of machines
 * also export a classic PAT as `GITHUB_TOKEN` for git and the API. The PAT wins
 * because it is explicit, and Copilot's endpoint refuses it:
 *
 *   400 checking third-party user token: bad request:
 *   Personal Access Tokens are not supported for this endpoint
 *
 * `start()` and `getAuthStatus()` both pass on a PAT, so the provider reports
 * itself live and only real turns fail. Returning `undefined` restores
 * `useLoggedInUser`, which reaches the OAuth token the endpoint does accept.
 *
 * Deny-listed rather than allow-listed: GitHub adds token formats, and silently
 * discarding a *working* future credential is the worse failure.
 */
let patWarned = false;
export function copilotToken(): string | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return undefined;
  if (token.startsWith('ghp_') || token.startsWith('github_pat_')) {
    // The chat provider and the structured backend both ask, so say it once.
    if (!patWarned) {
      patWarned = true;
      console.warn(
        '[agent] GITHUB_TOKEN is a personal access token, which Copilot does not accept — ' +
          'ignoring it and using the gh/OAuth login instead.',
      );
    }
    return undefined;
  }
  return token;
}

/**
 * Is the SDK there?
 *
 * The specifier is a variable on purpose: a literal `import('@github/...')` is
 * a compile error until the package exists, which would mean this file could
 * not be typechecked in the state it ships in.
 */
const SDK = '@github/copilot-sdk';

export async function copilotSdkInstalled(): Promise<boolean> {
  try {
    await import(SDK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Our tools, as `defineTool` arguments.
 *
 * `AgentTool` was already shaped like this — name, description, JSON Schema
 * parameters, an async handler over a bag of args — so the mapping is a rename.
 * `defineTool` accepts `ZodSchema<T> | Record<string, unknown>`, so the JSON
 * Schema Claude needs is the same object Copilot gets; neither provider forces
 * a second schema on the other.
 */
export interface CopilotToolSpec {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export function toCopilotTools(tools: AgentTool[]): [string, CopilotToolSpec][] {
  return tools.map((t) => [
    t.name,
    { description: t.description, parameters: t.parameters, handler: t.handler },
  ]);
}

/**
 * The slice of a Copilot session this file touches, declared structurally so
 * everything below is real, typechecked code rather than a comment. When the
 * package lands, the SDK's own `Session` satisfies this and the annotation can
 * go — or stay, as the record of what we actually depend on.
 *
 * The docs show two subscription shapes: named events (used here, and the one
 * with a documented payload) and a catch-all `session.on(event => ...)` that
 * switches on `event.type`. If the named form is gone, `streamReply` is the
 * only thing that has to change.
 */
export interface CopilotSessionLike {
  on(event: 'assistant.message_delta', cb: (e: { data: { deltaContent: string } }) => void): void;
  on(event: 'session.idle', cb: () => void): void;
  sendAndWait(input: { prompt: string }): Promise<unknown>;
  /** Optional so a fake session in the harness need not implement it. */
  disconnect?(): Promise<void>;
}

/**
 * The event API, as the `AsyncIterable<string>` the SSE loop consumes.
 *
 * This is the one genuinely fiddly piece of the switch, so it is written and
 * exercised now rather than discovered on the day: deltas arrive on a callback
 * while the turn is in flight, and the generator has to hand them out in order,
 * finish on idle *or* on the send resolving, and still drain whatever landed
 * between the last yield and the end.
 */
/**
 * How long to wait for `session.idle` after the send settles before giving up
 * on it. Short enough that a runtime which never idles cannot hang an answer,
 * long enough that the normal case — idle a few milliseconds later — always
 * wins the race.
 */
const IDLE_GRACE_MS = 250;

export async function* streamReply(
  session: CopilotSessionLike,
  prompt: string,
): AsyncIterable<string> {
  const pending: string[] = [];
  let finished = false;
  let failure: unknown;
  let wake: (() => void) | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;

  const bump = (): void => {
    wake?.();
    wake = undefined;
  };
  const finish = (): void => {
    if (grace) clearTimeout(grace);
    finished = true;
    bump();
  };

  session.on('assistant.message_delta', (e) => {
    if (e.data.deltaContent) {
      pending.push(e.data.deltaContent);
      bump();
    }
  });

  // `session.idle` is the real end of a turn: it fires after the assistant
  // message *and* after any tool calls the model made along the way.
  session.on('session.idle', finish);

  void session.sendAndWait({ prompt }).then(
    () => {
      // Resolving is NOT the end. `sendAndWait` settles on the assistant
      // message, and idle normally follows a beat later — but a delta can still
      // land in between, and ending here dropped it on the floor. The harness
      // caught exactly that: the last three words of an answer, gone, with no
      // error anywhere. A truncated answer is a much worse failure than a
      // quarter-second wait, so idle gets a grace window and wins if it comes.
      grace = setTimeout(finish, IDLE_GRACE_MS);
      // Never hold the process open on account of the backstop.
      grace.unref?.();
    },
    (err: unknown) => {
      // The only path that can surface *why* a turn died.
      failure = err;
      finish();
    },
  );

  while (!finished || pending.length) {
    while (pending.length) yield pending.shift()!;
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }

  if (failure) throw failure;
}

/**
 * `null` means "the SDK is not installed" — the caller falls back to the stub
 * and says so, rather than taking the gateway down over a chat provider.
 */
export async function createCopilotAgent(cfg: ProviderConfig): Promise<Agent | null> {
  // Dynamic rather than static, and the specifier stays a variable. The SDK
  // pulls in `koffi`, a native FFI module whose install script npm's
  // `allowScripts` policy does not run by default — so importing it can throw
  // on a machine where the binary was never built. A chat provider failing to
  // load must not take the findings pass, the webhooks and the sync down with it.
  let sdk: typeof import('@github/copilot-sdk');
  try {
    sdk = (await import(SDK)) as typeof import('@github/copilot-sdk');
  } catch (err) {
    console.warn(`[agent] copilot sdk failed to load — ${String(err)}`);
    return null;
  }

  // THE TOKEN GOES HERE, and nowhere else.
  //
  // `cfg.key` used to be accepted and then never used, which produced the one
  // failure mode you cannot debug from the outside: `start()` succeeds,
  // `createSession()` succeeds, and only the first actual turn dies with
  // `errorType: "authentication" — Session was not created with authentication
  // info or custom provider`. Everything looks wired until the model is asked
  // to say a word.
  //
  // Omitting it is also legitimate: `useLoggedInUser` defaults to true, so the
  // runtime falls back to stored OAuth or `gh` CLI auth. Passing `undefined`
  // keeps that path; passing a token takes priority over it.
  const client = new sdk.CopilotClient(cfg.key ? { gitHubToken: cfg.key } : {});
  try {
    // Spawns the bundled Copilot CLI runtime (`@github/copilot` is a dependency
    // of the SDK, so there is nothing to install separately and nothing has to
    // be on PATH). ~2.5s on a warm machine.
    await client.start();
  } catch (err) {
    console.warn(`[agent] copilot runtime did not start — ${String(err)}`);
    return null;
  }

  // Ask the runtime whether it can actually authenticate, BEFORE claiming to be
  // live. Without this the provider reports success on a machine with no
  // credential at all — `start()` and `createSession()` both succeed unauthed,
  // and only the first turn dies — so `/api/health` would say `copilot — gpt-5`
  // while every question came back as an error. One RPC, no model call, no cost.
  try {
    const auth = await client.getAuthStatus();
    if (!auth.isAuthenticated) {
      console.warn(
        `[agent] copilot runtime started but is not authenticated${
          auth.statusMessage ? ` — ${auth.statusMessage}` : ''
        }. Set GITHUB_TOKEN or run \`gh auth login\`.`,
      );
      await client.stop().catch(() => undefined);
      return null;
    }
    console.log(`[agent] copilot authenticated via ${auth.authType ?? 'unknown'}${auth.login ? ` as ${auth.login}` : ''}`);
  } catch (err) {
    console.warn(`[agent] could not read copilot auth status — ${String(err)}`);
    await client.stop().catch(() => undefined);
    return null;
  }

  // Built once: the schemas and handlers do not change between turns, and
  // rebuilding them per session would re-register the same tools each time.
  const tools = toCopilotTools(cfg.tools).map(([name, spec]) => sdk.defineTool(name, spec));

  // One session per conversation, not per process: a Copilot session carries
  // its own message history, so sharing one across the history list would let
  // an old thread bleed into a new one.
  const sessions = new Map<string, CopilotSessionLike>();
  const sessionFor = async (
    thread?: ChatThread,
  ): Promise<{ session: CopilotSessionLike; fresh: boolean }> => {
    const id = thread?.id ?? 'default';
    const existing = sessions.get(id);
    if (existing) return { session: existing, fresh: false };

    const session = await client.createSession({
      model: COPILOT_MODEL,
      // Required. `streaming` defaults to false, and without it there are no
      // `assistant.message_delta` events at all — the answer would sit empty
      // until the whole turn landed.
      streaming: true,
      tools,
      // `append` keeps the SDK's own system sections, ours included after them.
      // `replace` would drop its guardrails, which is not ours to do from here.
      systemMessage: { mode: 'append', content: cfg.system },
      // Our tools are our own handlers over our own gateway; prompting per call
      // would make the panel unusable.
      onPermissionRequest: sdk.approveAll,
    });
    sessions.set(id, session as CopilotSessionLike);
    return { session: session as CopilotSessionLike, fresh: true };
  };

  console.log(`[agent] Copilot is live — model=${COPILOT_MODEL}`);

  return {
    async *ask(message, env, thread) {
      const { session, fresh } = await sessionFor(thread);
      yield* streamReply(session, promptFor(message, env, thread, fresh, cfg));
    },
    async dispose() {
      // Sessions first, then the runtime. Each session is a live RPC peer in
      // the CLI process; stopping the client without disconnecting them leaves
      // the runtime tearing down connections it is still being spoken to on.
      await Promise.allSettled([...sessions.values()].map((s) => s.disconnect?.()));
      sessions.clear();
      await client.stop();
    },
  };
}

/**
 * One turn's prompt.
 *
 * The context envelope goes on every turn — it describes what the user is
 * looking at *now*. The transcript goes on the first turn of a session only:
 * a resumed chat (or one that outlived a gateway restart) has turns this
 * session never saw, and after they are handed over once the session remembers
 * them itself. `renderHistory` exists for exactly this — Claude gets the same
 * history as a message array instead, because that API takes one.
 */
function promptFor(
  message: string,
  env: ContextEnvelope,
  thread: ChatThread | undefined,
  fresh: boolean,
  cfg: ProviderConfig,
): string {
  const replay =
    fresh && thread?.history.length
      ? `<transcript>\n${renderHistory(thread.history)}\n</transcript>\n\n`
      : '';
  return `<context>\n${renderContext(cfg.withMemory(message, env))}\n</context>\n\n${replay}${message}`;
}

// ---------------------------------------------------------------------------
// Structured output, for `structured.ts`
// ---------------------------------------------------------------------------

/**
 * The Copilot backend for `structured.ts` — a typed answer with no MCP.
 *
 * WHY IT IS HERE AND NOT THERE. Same rule as `zodShape` living in
 * `claude-cli.ts`: the provider owns its own impedance mismatches. This one has
 * three — the runtime is a spawned process that has to be started and
 * authenticated before it can be asked anything, a session is an RPC peer that
 * must be disconnected, and there is no `tool_choice`, so the answer is caught
 * in the handler rather than read off a response.
 *
 * WHY IT IS NEEDED AT ALL. Without it, a machine with Copilot and neither a
 * `claude` login nor an `ANTHROPIC_API_KEY` has no structured backend, so
 * `summary.ts`, `infer.ts` and `extract.ts` all return null. That is a working
 * product — the detectors are deterministic and the alert list, its evidence
 * and its actions are unaffected — but it loses the claim paragraph, its
 * citations and every inferred edge, on exactly the deployment this is being
 * built for.
 *
 * `defineTool` takes JSON Schema directly, so unlike the Claude CLI path there
 * is no schema conversion to get wrong.
 */

/** One runtime for the whole process, started at most once. */
let runtime: Promise<{ sdk: typeof import('@github/copilot-sdk'); client: CopilotClientLike } | null> | undefined;

interface CopilotClientLike {
  createSession(config: Record<string, unknown>): Promise<unknown>;
  getAuthStatus(): Promise<{ isAuthenticated: boolean; authType?: string; login?: string; statusMessage?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

async function copilotRuntime(): Promise<{
  sdk: typeof import('@github/copilot-sdk');
  client: CopilotClientLike;
} | null> {
  runtime ??= (async () => {
    let sdk: typeof import('@github/copilot-sdk');
    try {
      sdk = (await import(SDK)) as typeof import('@github/copilot-sdk');
    } catch (err) {
      console.warn(`[copilot] sdk failed to load — ${String(err)}`);
      return null;
    }
    const token = copilotToken();
    const client = new sdk.CopilotClient(token ? { gitHubToken: token } : {}) as unknown as CopilotClientLike;
    try {
      await client.start();
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) {
        console.warn(
          `[copilot] runtime started but is not authenticated${
            auth.statusMessage ? ` — ${auth.statusMessage}` : ''
          }. Set GITHUB_TOKEN or run \`gh auth login\`.`,
        );
        await client.stop().catch(() => undefined);
        return null;
      }
      return { sdk, client };
    } catch (err) {
      console.warn(`[copilot] runtime did not start — ${String(err)}`);
      await client.stop().catch(() => undefined);
      return null;
    }
  })();
  return runtime;
}

/**
 * Can Copilot answer on this machine?
 *
 * A real check — the SDK importing proves nothing and `start()` succeeding
 * proves nothing either, which is the lesson `createCopilotAgent` already
 * bought: both succeed unauthenticated and only the first turn dies. This asks
 * the runtime, which is one RPC and no model call.
 *
 * The runtime it starts is kept, so the first structured request does not pay
 * the ~2.5s spawn again.
 */
export async function copilotAvailable(): Promise<boolean> {
  return (await copilotRuntime()) !== null;
}

/**
 * Shut the shared runtime down — the one `copilotRuntime` memoises above.
 *
 * This is NOT what `createCopilotAgent`'s `dispose()` reaches. There are two
 * `CopilotClient` instances and two child processes: the agent's, closed over by
 * its own `dispose`, and this one, started by `copilotAvailable` from
 * `providerCaps` at boot on any machine with Copilot auth. Only this function
 * can stop the second.
 *
 * Callers: the gateway's `shutdown` and `scripts/probe-mcp.mts`, which relies on
 * the event loop draining. Anything else that reaches `providerCaps` and then
 * expects the process to exit on its own needs this too.
 */
export async function stopCopilotRuntime(): Promise<void> {
  const r = await runtime;
  runtime = undefined;
  await r?.client.stop().catch(() => undefined);
}

export interface CopilotStructuredRequest {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  system: string;
  prompt: string;
}

/**
 * Ask for one tool call and return its arguments.
 *
 * A fresh session per request on purpose: these are one-shot questions with no
 * continuity between them, and reusing one would carry the previous brief's
 * messages into the next answer — the same bleed `sessionFor` keys by thread to
 * avoid on the chat side.
 */
export async function askCopilotStructured(req: CopilotStructuredRequest): Promise<unknown> {
  const r = await copilotRuntime();
  if (!r) return undefined;

  let captured: unknown;
  const recorder = r.sdk.defineTool(req.name, {
    description: req.description,
    parameters: req.parameters,
    handler: async (args: Record<string, unknown>) => {
      captured = args;
      return { ok: true };
    },
  });

  const session = (await r.client.createSession({
    model: COPILOT_MODEL,
    streaming: false,
    tools: [recorder],
    systemMessage: { mode: 'append', content: req.system },
    onPermissionRequest: r.sdk.approveAll,
  })) as CopilotSessionLike;

  try {
    let idle = false;
    session.on('session.idle', () => {
      idle = true;
    });
    await session.sendAndWait({ prompt: `${req.prompt}\n\nCall ${req.name} with your answer.` });

    // `sendAndWait` settles on the assistant message. The tool call precedes it,
    // so `captured` is normally already set — but `streamReply` learned the hard
    // way that this runtime is not finished when the send resolves, and a
    // dropped answer here is silent. Give idle the same short grace.
    if (captured === undefined && !idle) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, IDLE_GRACE_MS);
        t.unref?.();
      });
    }
    return captured;
  } finally {
    await session.disconnect?.().catch(() => undefined);
  }
}
