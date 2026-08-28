/**
 * Mission Control gateway.
 *
 * Holds everything the browser must not: the Anthropic key, MCP OAuth sessions,
 * vendor API credentials, the event log, and the sync rules.
 */

// MUST BE FIRST, AND MUST STAY FIRST. In ESM every imported module's body runs
// before this one's, so `.env` has to be loaded by an import rather than by a
// statement down in this file — otherwise every module-level `process.env` read
// in the gateway sees defaults. See env.ts for the full account.
import './env.js';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import {
  auditIdentities,
  auditStatusWords,
  statusMapReport,
  projectArrows,
  type Connectors,
} from '@mc/connectors';
import {
  isAlertKind,
  newEvent,
  type ChatThread,
  type ContextEnvelope,
  type NoteKind,
  type NoteStatus,
} from '@mc/domain';
import { agentStatus, createAgent } from './agent.js';
import { APP_URL, transports } from './notify.js';
import { eventLog } from './events.js';
import { boardArrows, buildDossier, forgetBoardArrows } from './issue.js';
import { buildWorkLane, workOpts } from './work.js';
import { createSummaries, createSummariser } from './summary.js';
import { createExtractor } from './extract.js';
import { createRelationizer, startInference } from './infer.js';
import { providerCaps } from './structured.js';
import { stopCopilotRuntime } from './copilot.js';
import {
  connectorsFor,
  currentGraph,
  installGraph,
  GRAPH_DIR,
  STATUS_MAP_PATH,
  containersOf,
  loadGraphSource,
  loadStatusWords,
} from './graph-source.js';
import { findingDetail, runAlertFindings, runFindings } from './findings.js';
import { actOnFinding, forgetAnswered, indexAnswer, type ActionInput } from './act.js';
import { describeSafeMode, safeMode } from './safe-mode.js';
import { demoConfig, demoMode } from './demo.js';
import { readRecord } from './records.js';
import { buildSources } from './sources.js';
import { webhookRouter } from './webhooks.js';
import { startSync } from './sync.js';
import { seedHistory, seedNotes } from './seed.js';
import { startCanvasPoll } from './canvas-poll.js';
import { capture, type CaptureInput } from './memory.js';
import { findSkill, SKILLS } from './skills.js';
import {
  FALLBACK,
  forgetSuggestionFacts,
  suggestQuestions,
  type SuggestInput,
} from './suggest.js';
import { scheduleSummary, startScheduler } from './scheduler.js';
import { buildCrossSurfaceTools, proposals, rehydrateProposals } from './tools.js';
import { emitVaultEvent, startVault, VAULT_DIR } from './vault.js';

// `.env` is loaded by the `./env.js` import at the top of this file, not here.
// These two always worked because they are read below that old call site; the
// module-level reads in claude.ts, copilot.ts, extract.ts and vault.ts did not.
const PORT = Number(process.env.PORT ?? 8787);
const MODE = process.env.MC_MODE ?? 'mock';

/**
 * THE INTERFACE THIS BINDS, AND THE DEFAULT IS THE HOSTING DECISION.
 *
 * `ROADMAP.md` D4: single-tenant, self-hosted, on one machine inside the
 * evidence boundary. That is not a limitation dressed up — it is the privacy
 * property, and `notify.ts` already implements the other half of the same
 * argument ("a notification carries a POINTER, never a quote", because the
 * transcripts do not leave the machine holding them). A gateway reachable from
 * the network is that boundary being a policy rather than a fact.
 *
 * It used to be `app.listen(PORT)`, which binds every interface — so the vault
 * write routes and `POST /api/tools/:name` were open to anything on the same
 * network, while the shell beside it already bound loopback via vite's default.
 * The gateway was the asymmetric one.
 *
 * `127.0.0.1` rather than `::1`: everything documented reaches this by the name
 * `localhost`, which on macOS resolves to both, and curl falls back from a
 * refused `::1` to `127.0.0.1` but not the other way about on every client.
 *
 * THE ESCAPE HATCH MUST EXIST — a container or a devcontainer cannot use a
 * loopback bind — and it must not be silent, which is what the boot warning is
 * for. This does not make the gateway safe to expose; it makes exposing it a
 * deliberate act. There is still no authentication, `cors()` still allows every
 * origin, and webhook signatures are still unverified: `KNOWN-GAPS.md` §3.
 */
const BIND = (process.env.MC_BIND ?? '').trim() || '127.0.0.1';
/**
 * `MC_BIND=` with nothing after it is the shape a `.env` routinely has, and
 * `??` does not catch it — an empty string is not nullish, and Node treats a
 * falsy host as "every interface". So the line somebody writes while *thinking*
 * about the bind produced the exact opposite of the default. `.trim() || …`
 * treats blank as unset, which is the only reading that is not a trap.
 */
const LOOPBACK = BIND === 'localhost' || BIND === '::1' || /^127(\.\d{1,3}){3}$/.test(BIND);

async function main(): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  /**
   * Connectors are chosen PER SURFACE, not per mode.
   *
   * `MC_MODE` used to be the only switch, which made "real" all-or-nothing:
   * five vendor credentials before anything was real, so in practice nothing
   * ever was. Each surface instead goes real the moment its own credential is
   * present, and falls back to the fixture otherwise. Same interface either
   * way — which is the entire point of the connectors lib.
   *
   * Miro matters most here because it is the one surface NOT read from
   * `MC_GRAPH_DIR`. With a token set, `listConnectors` returns whatever is drawn
   * on the live canvas today — a different and unreconciled account of what
   * depends on what. That is why dependency truth is taken from the graph
   * instead: `findings.ts`, `/api/work` and `/api/suggestions` all pass
   * `projectArrows(currentGraph().graph)`, and `records.ts` cites the sticky we reasoned
   * over rather than the one on the board now.
   */
  const miroToken = process.env.MIRO_ACCESS_TOKEN;

  // The fixture and a real collector's output are the same artefact, so which
  // one this reads is the whole of "going live" for Jira, Slack, Zoom and
  // Confluence — see `graph-source.ts` and `docs/GRAPH-SCHEMA.md`.
  /**
   * The status map, before anything projects a work item.
   *
   * Order matters: `createGraphConnectors` reads `STATUS_WORDS` when it projects,
   * so loading the map after the connectors are built would leave every item
   * already mapped by the defaults — the configuration would appear to be
   * ignored, with nothing failing.
   */
  const statusMap = await loadStatusWords();
  if (statusMap) {
    console.log(`[status] ${statusMap.words} vendor status words from ${STATUS_MAP_PATH}`);
  }

  // Installed in the cell rather than held as a local: `connectorsFor` reads the
  // cell, so the refresh job swapping it reaches every consumer below without
  // any of them being rebuilt. See `currentGraph` in graph-source.ts.
  installGraph(await loadGraphSource());
  const connectors: Connectors = connectorsFor();
  console.log(
    `[connectors] miro=${miroToken ? 'live' : 'mock'} jira/confluence/zoom/slack=graph ` +
      `(${currentGraph().graph.nodes.length} nodes, ${currentGraph().graph.links.length} edges, ` +
      `${currentGraph().records.size} record(s) from ${GRAPH_DIR})`,
  );

  const vault = await startVault();

  /**
   * Seed from whatever the GRAPH shipped, never from what the agent runs on.
   *
   * This used to be gated on `MODE === 'mock'`, which coupled two unrelated
   * things: `MC_MODE` selects the chat provider, and Copilot is only reachable
   * at `MC_MODE=live` — so choosing Copilot silently turned the fixture's
   * history and claims off, and the flagship alert stopped firing with nothing
   * failing anywhere. `seed.ts`'s own header says mock is "the live-collector
   * path too", so the mode was never the right question.
   *
   * The gate is redundant as well as wrong: both functions already refuse to
   * run into a non-empty vault and return 0 when the graph ships no
   * `events.jsonl` / `notes/` — which is every real collector, since
   * `import-programme-graph.mts` writes neither.
   */
  const seeded = await seedHistory(vault);
  if (seeded) console.log(`[seed] wrote ${seeded} backdated event(s) — the graph's own history`);
  const notes = await seedNotes(vault);
  if (notes) console.log(`[seed] wrote ${notes} claim(s) into the vault`);

  // Before anything can act on one: put back the proposals already pending.
  const pending = await rehydrateProposals(vault);
  if (pending) console.log(`[proposals] ${pending} still waiting on a human`);

  const agent = await createAgent(connectors, vault, currentGraph);
  /**
   * Relationship inference over the records the join key cannot place.
   *
   * Tried CLI-first, so it works in a checkout with an empty `.env` rather than
   * only for whoever has a billing account — see infer.ts. `providerCaps` is
   * memoised and shared with the summariser and the extractor, so the three of
   * them cost one probe between them rather than three each.
   * Null when nothing can answer, and then the graph is exactly what it was
   * before this existed.
   */
  const inference = startInference(
    connectors,
    vault,
    await createRelationizer(await providerCaps()),
    currentGraph,
  );
  // Inference is handed to the tools as a getter rather than a snapshot: it is
  // filled in by a background pass that has almost certainly not finished yet,
  // and a snapshot taken here would be empty for the life of the process.
  const tools = buildCrossSurfaceTools(connectors, eventLog, vault, () => inference.edges(), currentGraph);
  // Null when nothing on this machine can answer, and then skills run on the cue
  // regexes alone, exactly as before — see extract.ts for why it is additive
  // rather than a replacement. It now reaches the CLI login as well as a billing
  // account, so a fresh checkout gets the model-read actions the regexes drop.
  const extract = createExtractor(await providerCaps()) ?? undefined;
  // Anything landing in the log — a status change, a note, an accepted
  // proposal — may have moved something the starter questions are derived from.
  // Cheaper than a shorter TTL in suggest.ts and more correct than a longer one:
  // the suggestions are a minute behind only when nothing has happened.
  eventLog.subscribe((e) => {
    forgetSuggestionFacts();
    forgetBoardArrows();
    // A dismissal or a deferral, folded straight into the front door's index so
    // the next request does not re-read the whole log to find it.
    indexAnswer(e);
  });

  /**
   * The agent's status read on one ticket — its own service, and deliberately
   * not part of `buildDossier`.
   *
   * Same ladder and the same cached probe as inference, so it costs nothing in a
   * fresh checkout. NOTHING IS WARMED: the boot walk of the active sprint went
   * once it was settled that no screen reads a summary (ROADMAP G3), which is
   * why `createSummaries` takes the summariser and nothing else — the
   * `Connectors` and `dossierFor` it used to take existed only to feed that
   * walk. A card is written when somebody asks, and cached on the brief's
   * fingerprint.
   */
  const summaries = createSummaries(createSummariser(await providerCaps()));

  /**
   * Pull the board's arrows once, now, rather than on somebody's first click.
   *
   * `listConnectors` against a live board measured ~4s — one GET per distinct
   * endpoint id — and `buildDossier` needs it to draw the chain. Memoised for
   * 60s afterwards (`boardArrows`), so this is the only cold fetch in a session.
   *
   * NOTE WHAT THIS NO LONGER SERVES. Dependency truth comes from the graph, so
   * `/api/findings`, `/api/work` and `/api/suggestions` all pass
   * `projectArrows(currentGraph().graph)` and never reach here. The only consumers left
   * are `/api/issue/:key`, its `/summary` and `trace_entity` — none of which a
   * screen opens. Whether this warm still earns its ~4s is a live question for
   * whoever builds the evidence view (ROADMAP G3).
   *
   * Deliberately unawaited and deliberately swallowed: a board that cannot be
   * read is already handled everywhere downstream, and boot must not depend on
   * a vendor being up.
   */
  void boardArrows(connectors, process.env.MIRO_BOARD_ID ?? 'demo-board').catch(() => {});

  const stopSync = startSync(connectors, vault);
  const stopCanvasPoll = startCanvasPoll(connectors);
  const stopScheduler = startScheduler(connectors, vault);

  /**
   * The instrument panel for going live, and it has to be right.
   *
   * It used to hardcode `jira/confluence/zoom/slack: 'mock'`, written before the
   * connectors read `graph.json` — so on a machine pointed at a collector's
   * output it reported fixtures while serving real data. That is exactly the
   * failure the comment beside it warned about for Miro ("mode: mock alone would
   * hide a live board behind a word that says fixtures"), in the same object,
   * for the other four surfaces.
   *
   * The question somebody actually curls this to answer is "am I reading real
   * data, and how much of it?", so it now says which directory the graph came
   * from and what was in it. A collector that produced an empty file is the
   * failure mode worth seeing at a glance.
   */
  app.get('/api/health', (_req, res) => {
    const graphed = currentGraph().graph.nodes.length > 0;
    res.json({
      ok: true,
      mode: MODE,
      // Per surface, because it is per surface.
      connectors: {
        miro: miroToken ? 'live' : 'mock',
        jira: graphed ? 'graph' : 'empty',
        confluence: graphed ? 'graph' : 'empty',
        zoom: graphed ? 'graph' : 'empty',
        slack: graphed ? 'graph' : 'empty',
      },
      /**
       * WHERE the graph came from, and what was in it. `MC_GRAPH_DIR` is the
       * whole of the switch for four surfaces, so the one thing this must never
       * be silent about is which file it read.
       */
      graph: {
        dir: GRAPH_DIR,
        fixture: GRAPH_DIR.endsWith('/fixtures'),
        nodes: currentGraph().graph.nodes.length,
        edges: currentGraph().graph.links.length,
        records: currentGraph().records.size,
        // The collector that wrote it, and when. `generator` is how `refresh.ts`
        // decides to re-baseline rather than report a whole programme as new,
        // so it is the field that says "a different tool produced this".
        generator: currentGraph().graph.graph?.generator ?? null,
        generatedAt: currentGraph().graph.graph?.generatedAt ?? null,
        sources: currentGraph().graph.graph?.sources ?? [],
      },
      /**
       * How the workflow's own status words are being read. The `fallback` count
       * is the number worth looking at: every one of those is an issue whose
       * status came from `statusCategory`, which is three-valued, so `in_review`
       * and `blocked` were unreachable for it.
       */
      status: (() => {
        const audit = auditStatusWords(currentGraph().graph);
        return {
          configuredFrom: STATUS_MAP_PATH,
          words: statusMapReport().words,
          distinct: audit.length,
          fallback: audit.filter((a) => a.via !== 'map').length,
        };
      })(),
      boardId: process.env.MIRO_BOARD_ID ?? null,
      /**
       * Where this instance is reachable from, and by whom — ROADMAP D4.
       *
       * The same class of fact D2 added the graph directory for and D3 added
       * `status.fallback` for: health is where an instance says what is
       * actually true about itself, because the alternative is a word that
       * reassures while the reality differs. It reports the bind and never a
       * verdict — there is no `secure` boolean here, because there is no
       * authentication and nothing may claim otherwise.
       */
      host: {
        bind: BIND,
        loopback: LOOPBACK,
        /** What a notification's deep link will actually carry — notify.ts's own value. */
        appUrl: APP_URL,
        webhookAuth: process.env.MC_WEBHOOK_SECRET ? 'set' : 'unset',
      },
      agent: agentStatus(),
      tools: tools.map((t) => t.name),
      /**
       * Which transports will carry the next run. "Will I actually be told?" is
       * a question somebody curls this to answer, and the review inbox always
       * answering means the honest report is which OTHERS are on.
       */
      notify: transports().map((t) => t.name),
      safeMode: safeMode(),
      /**
       * The walkthrough, and whether this instance is wearing it.
       *
       * The shell asks this before it decides what to mount, so the answer has
       * to be here rather than in the bundle — see `demo.ts` for why a `VITE_`
       * flag was the wrong shape. `on: false` is the product, which is the
       * answer for every instance nobody has deliberately turned it on for.
       */
      demo: demoConfig(),
      vault: { dir: VAULT_DIR, notes: vault.list().length },
    });
  });

  // ---- the vendor read-throughs -------------------------------------------
  //
  // These fed the five vendor panes, which are gone as destinations. They are
  // kept on the rule the ROADMAP already applies to four other routes: a route
  // is an interface, and this gateway is documented as something you curl —
  // "what does it actually see on Zoom?" is worth being able to ask. They are
  // reads; the one WRITE among them was the Slack pane's composer and went.
  // `GET /api/miro/stickies` has a live caller in scripts/inspect.mjs.
  app.get('/api/jira/items', async (_req, res) => res.json(await connectors.jira.listItems()));
  app.get('/api/jira/items/:key', async (req, res) => {
    const item = await connectors.jira.getItem(req.params.key);
    return item ? res.json(item) : res.status(404).json({ error: 'not found' });
  });
  // The half of the board that is not a mirror of Jira. Read-only — there is no
  // POST here, and `exportSnapshot` is the connector's only write, with no
  // caller today. `scripts/inspect.mjs stickies` reads this one.
  app.get('/api/miro/stickies', async (_req, res) =>
    res.json(await connectors.miro.listStickies(process.env.MIRO_BOARD_ID ?? 'demo-board')),
  );

  app.get('/api/miro/connectors', async (_req, res) =>
    res.json(await connectors.miro.listConnectors(process.env.MIRO_BOARD_ID ?? 'demo-board')),
  );

  // The mirrored half: Jira as it is drawn on the canvas, with the positions
  // Miro owns. This fed a fallback view that is gone; it is kept as a curl
  // target. In mock mode it is always the graph's own projection, because
  // nothing we do here reaches miro.com without MIRO_ACCESS_TOKEN.
  app.get('/api/miro/cards', async (_req, res) =>
    res.json(await connectors.miro.listAppCards(process.env.MIRO_BOARD_ID ?? 'demo-board')),
  );
  app.get('/api/confluence/pages', async (_req, res) =>
    res.json(await connectors.confluence.listPages(process.env.CONFLUENCE_SPACE_KEY ?? 'MC')),
  );
  app.get('/api/zoom/transcripts', async (_req, res) => res.json(await connectors.zoom.listTranscripts()));
  app.get('/api/zoom/transcripts/:id', async (req, res) => {
    const t = await connectors.zoom.getTranscript(req.params.id);
    return t ? res.json(t) : res.status(404).json({ error: 'not found' });
  });
  app.get('/api/slack/channels', async (_req, res) => res.json(await connectors.slack.listChannels()));
  app.get('/api/slack/channels/:id/messages', async (req, res) =>
    res.json(await connectors.slack.listMessages(req.params.id)),
  );

  /**
   * Capture: a Slack message becomes a note without anybody opening this app.
   * Reached from `/mc remember …` as a real slash command in live mode, and
   * documented as a curl (CLAUDE.md's "two memory paths"). This is the IN half;
   * `surfaceMemory` is the OUT half.
   */
  app.post('/api/slack/capture', async (req, res) => {
    try {
      const note = await capture(vault, req.body as CaptureInput);
      return res.status(201).json(note);
    } catch (err) {
      // assertVaultSafe rejections land here — quoting a message that happens
      // to contain `status: blocked` is exactly the guard doing its job.
      return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  /** What Mission Control has said on a ticket. See memory.ts for why it may. */
  app.get('/api/jira/items/:key/comments', async (req, res) =>
    res.json(await connectors.jira.listComments(req.params.key)),
  );

  /**
   * All of them at once, so the issue list can mark the rows that carry one
   * without a request per row. Fine against the mock's in-memory array; a live
   * adapter would want a single JQL query behind this rather than a fan-out.
   */
  app.get('/api/jira/comments', async (_req, res) => {
    const items = await connectors.jira.listItems();
    const all = await Promise.all(items.map((i) => connectors.jira.listComments(i.key)));
    return res.json(all.flat());
  });

  /**
   * Everything anyone said about one ticket, newest first, with the
   * disagreements called out.
   *
   * The only route that answers the question the product exists for. Same
   * assembler as the agent's `trace_entity`, so the route and the agent cannot
   * name a different "latest".
   */
  app.get('/api/issue/:key', async (req, res) => {
    inference.refresh();
    const dossier = await buildDossier(req.params.key, connectors, vault, eventLog, inference.edges());
    // An unknown key is a 404, not an empty dossier: a blank trail reads as
    // "nothing was ever said about this" rather than "no such ticket".
    if (!dossier.item && !dossier.trail.length) {
      return res.status(404).json({ error: `no work item ${req.params.key}` });
    }
    return res.json(dossier);
  });

  /**
   * One developer's lane: their sprint work, ranked by what needs them.
   *
   * The front door before a ticket is picked. `assignee` is a query parameter
   * rather than an identity because there is no login here — and because being
   * able to switch to a colleague's lane is most of what makes it useful in a
   * stand-up. An unknown or absent name falls back to the first person with
   * work, so a caller always gets something real.
   */
  /**
   * The front door — everything that needs somebody, worst first.
   *
   * Deliberately NOT cached and deliberately cheap: it reads the loaded graph
   * and the in-memory vault, and touches no vendor. `/api/work` pays for a
   * five-surface gather; this one must not, because it is the screen the app
   * opens on and the one a notification links into.
   */
  /**
   * Coverage, never content — see `sources.ts`. Cheap and uncached: it counts the
   * loaded graph and touches nothing.
   */
  /**
   * What the workflow calls its statuses, and what we made of them.
   *
   * A read-only audit, and the thing that makes `MC_STATUS_MAP` writable without
   * guessing: pointed at a real export it names the words in use and flags the
   * ones falling through to `statusCategory`.
   */
  app.get('/api/statuses', (_req, res) => res.json(auditStatusWords(currentGraph().graph)));

  /**
   * Every person reference in the graph, and whether the identity map placed it.
   *
   * The joins this product exists for are cross-surface, and they all compare
   * handles: a Slack author's claim against a Jira assignee's status, who weighed
   * in on a ticket, whose lane a row belongs to. An unresolved reference is not
   * an error — it falls through and the app keeps running — it is a join that
   * silently will not fire, which is the worst failure available here.
   */
  app.get('/api/identities', (_req, res) => res.json(auditIdentities(currentGraph())));

  /**
   * Sources takes the coverage findings rather than re-deriving their counts.
   *
   * `findJoinFailures` used to count `AMBIGUOUS depends_on` edges straight off
   * the graph while the detector deduplicated and applied suppression — so
   * dismissing one made the alert list say 1 and this page go on saying 2, with
   * nothing failing. Two definitions of the same number is the defect this repo
   * keeps paying for; the detector is the definition.
   */
  app.get('/api/sources', async (_req, res) => {
    try {
      const items = await connectors.jira.listItems();
      const all = await runFindings({ source: currentGraph(), vault, items, connectors });
      res.json(buildSources(currentGraph(), all.filter((f) => !isAlertKind(f.kind))));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * The front door is the ALERT kinds only.
   *
   * `undetected_dependency` and `suspect_link` are one per edge, so they arrive
   * by the hundred on a real programme and turn "the top row is the one to
   * open" into a wall. They are coverage facts and they live on Sources now —
   * see `COVERAGE_KINDS`. Still detected, still suppressed by a dismissal, and
   * still reachable through `list_findings`; they simply stop interrupting.
   *
   * TWO ARRAYS, AND ONLY THE FIRST IS THE LIST. `findings` is unchanged and
   * still free of everything a human has answered; `parked` carries those, for
   * the one thing that has to name an alert it is not listing — a `Later` row
   * showing the chip of the alert its note was parked from. See
   * `runAlertFindings` for why they are not one array with a flag.
   */
  app.get('/api/findings', async (_req, res) => {
    try {
      const items = await connectors.jira.listItems();
      res.json(await runAlertFindings({ source: currentGraph(), vault, items, connectors }));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Answering an alert. See `act.ts` for what each of the four does — and note
   * that the primary one APPLIES its proposal, so it reaches a vendor.
   */
  /**
   * Applying a proposal, through the ONE implementation of it.
   *
   * `accept_proposal` already does the vendor write, the provenance comment,
   * the echo token and the vault ratchet, correctly. The primary action on an
   * alert needs exactly that, so it calls the same handler rather than a second
   * copy — a second copy is how the comment or the token quietly stops being
   * written on one of the two paths.
   *
   * This is a function in the gateway, not a tool the agent holds: `HUMAN_ONLY`
   * strips both verbs from every provider, and `/act` is reachable only over
   * HTTP from somebody clicking.
   */
  const applyProposal = async (proposalId: string): Promise<Record<string, unknown>> => {
    const tool = tools.find((t) => t.name === 'accept_proposal');
    if (!tool) throw new Error('accept_proposal is not registered');
    return (await tool.handler({ proposalId })) as Record<string, unknown>;
  };

  app.post('/api/findings/:id/act', async (req, res) => {
    try {
      const items = await connectors.jira.listItems();
      const detail = await findingDetail(req.params.id, { source: currentGraph(), vault, items, connectors });
      if (!detail) return res.status(404).json({ error: 'no such finding' });

      const body = req.body as ActionInput;
      /**
       * `send` is here and is not a fifth action on the alert — `DESIGN.md` §7
       * caps that at four, and this one has no button in the `.acts` row. It is
       * what the result strip offers once a draft is on screen and has been
       * read, which is the only place in the app that posts.
       */
      if (!['primary', 'ask', 'defer', 'dismiss', 'send'].includes(body?.action)) {
        return res
          .status(400)
          .json({ error: 'action must be primary, ask, defer, dismiss or send' });
      }
      res.json(
        await actOnFinding(
          detail.finding,
          body,
          vault,
          detail.note,
          applyProposal,
          // The same audience the page named before the click.
          detail.audience,
        ),
      );
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * A record, reached from a citation and nowhere else.
   *
   * The query carries the rest of the `RecordRef` — a Slack channel, a
   * transcript offset — because that is what decides which LINE you land on, and
   * a citation that opens the top of a ninety-minute recording has not been
   * followed.
   */
  app.get('/api/records/:surface/:id', async (req, res) => {
    try {
      const at = Number(req.query.at);
      const record = await readRecord(
        {
          surface: req.params.surface,
          id: req.params.id,
          ...(typeof req.query.parentId === 'string' ? { parentId: req.query.parentId } : {}),
          ...(Number.isFinite(at) ? { at } : {}),
        },
        connectors,
        vault,
        currentGraph(),
      );
      if (!record) return res.status(404).json({ error: 'no such record' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/findings/:id', async (req, res) => {
    try {
      const items = await connectors.jira.listItems();
      const detail = await findingDetail(req.params.id, { source: currentGraph(), vault, items, connectors });
      if (!detail) return res.status(404).json({ error: 'no such finding' });
      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/work', async (req, res) => {
    const who = typeof req.query.assignee === 'string' ? req.query.assignee : undefined;
    // The same reconciled arrows the findings pass uses, so the lane and the
    // alert list cannot disagree about what is in a cycle.
    return res.json(await buildWorkLane(who, connectors, vault, workOpts(currentGraph())));
  });

  /**
   * The agent's read on where a ticket stands.
   *
   * A separate route from the dossier and not a field on it, so the front door
   * never waits on a model — see summary.ts. It answers immediately in every
   * case: `ready` with the text, `pending` while a turn is running (a caller
   * polls), `empty` when the model gave nothing usable, `unavailable` when this
   * machine has no provider at all. Nothing is shown for the last two,
   * because an empty box reads as a broken feature rather than as an absent one.
   */
  app.get('/api/issue/:key/summary', async (req, res) => {
    // A turn is already running for this key — say so without assembling a
    // dossier. A caller polls every three seconds and a turn takes most of a
    // minute; building the full five-surface answer twenty times over to repeat
    // "still working" is the kind of waste that only shows up under a live
    // board, where each build is seconds rather than milliseconds.
    if (summaries.pendingFor(req.params.key)) return res.json({ status: 'pending' });

    const dossier = await buildDossier(req.params.key, connectors, vault, eventLog, inference.edges());
    if (!dossier.item && !dossier.trail.length) {
      return res.status(404).json({ error: `no work item ${req.params.key}` });
    }
    return res.json(await summaries.get(dossier));
  });

  /**
   * THE LENSES AND THE SNAPSHOT EXPORT ARE GONE — deleted, not disabled.
   *
   * `GET /api/storyline` and `POST /api/miro/snapshot` had no caller — not the
   * shell, not `scripts/inspect.mjs`. The snapshot route could not have worked
   * even if something had called it: its contract took the graph's coordinates
   * from the browser, and nothing in the app lays a graph out. A route whose
   * contract names a caller that does not exist is not dormant capability.
   *
   * WHAT SURVIVES, AND WHY IT IS NOT THE SAME THING. `MiroConnector.export-
   * Snapshot` stays: it is the only sanctioned write to a board, it carries the
   * three rules that keep a one-shot export from becoming a sync war, and
   * `scripts/seed-miro.mjs` is written against those rules. `buildStoryline` and
   * `buildTimeline` stay in `@mc/domain` — the second is what `aging` measures
   * with, and both are models rather than routes.
   *
   * Restoring either means a caller first. See ROADMAP.md G3.
   */

  // ---- the vault -----------------------------------------------------------
  // Unlike every write that leaves this machine, these are direct — no proposal
  // step. There is no third-party system to conflict with and no second human to
  // coordinate with, so the ceremony would buy nothing.
  app.get('/api/vault/notes', (req, res) => {
    const { kind, status, key, tag, q } = req.query as Record<string, string | undefined>;
    res.json(
      vault.list({
        kind: kind as NoteKind | undefined,
        status: status as NoteStatus | undefined,
        key,
        tag,
        q,
      }),
    );
  });

  app.get('/api/vault/notes/:id', (req, res) => {
    const note = vault.get(req.params.id);
    if (!note) return res.status(404).json({ error: 'not found' });
    return res.json({ ...note, backlinks: vault.backlinks(note.id).map((n) => n.id) });
  });

  app.post('/api/vault/notes', async (req, res) => {
    try {
      const note = await vault.create(req.body);
      emitVaultEvent('note.created', note, { by: 'human' });
      return res.status(201).json(note);
    } catch (err) {
      // assertVaultSafe rejections land here — a 400, not a 500. The note broke
      // a rule, the server is fine, and the message says which rule.
      return res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.patch('/api/vault/notes/:id', async (req, res) => {
    try {
      const note = await vault.update(req.params.id, req.body);
      emitVaultEvent(note.status === 'resolved' ? 'note.resolved' : 'note.updated', note);
      return res.json(note);
    } catch (err) {
      const message = String(err instanceof Error ? err.message : err);
      return res.status(message.startsWith('no such note') ? 404 : 400).json({ error: message });
    }
  });

  app.delete('/api/vault/notes/:id', async (req, res) => {
    await vault.remove(req.params.id);
    return res.status(204).end();
  });

  /**
   * The durable log — the history behind every event, read by
   * `scripts/inspect.mjs log` and by curl. There is no live stream any more;
   * the SSE feed had no client once the front door stopped re-rendering under
   * a reader.
   */
  app.get('/api/vault/log', async (req, res) => {
    const { source, key, since, limit } = req.query as Record<string, string | undefined>;
    res.json(
      await vault.readEvents({
        source,
        key,
        since,
        limit: limit ? Number(limit) : 500,
      }),
    );
  });

  /**
   * Both delete paths drop the answered-findings index.
   *
   * It is built from this log and then kept current by *appends*, so a removal
   * is the one mutation it cannot see: without this, dismissing a finding and
   * then deleting the dismissal leaves it hidden until the next restart, which
   * is exactly the silent staleness the unwindowed read existed to avoid.
   */
  app.delete('/api/vault/log/:id', async (req, res) => {
    const removed = await vault.deleteEvents([req.params.id]);
    forgetAnswered();
    return removed ? res.status(204).end() : res.status(404).json({ error: 'not found' });
  });

  /**
   * Bulk delete and clear-all. POST rather than DELETE because the id list is a
   * body, and DELETE-with-a-body is inconsistently supported by proxies.
   */
  app.post('/api/vault/log/delete', async (req, res) => {
    const { ids, all } = req.body as { ids?: string[]; all?: boolean };
    const removed = all ? await vault.clearEvents() : await vault.deleteEvents(ids ?? []);
    forgetAnswered();
    return res.json({ removed });
  });

  // ---- agent ---------------------------------------------------------------
  /**
   * How many findings ride along on a global question.
   *
   * Enough that "what needs me" is answerable in order, few enough that a
   * programme with eleven hundred of them does not spend the prompt on a list
   * nobody asked for. The list is already ranked worst-first, so a cut here
   * costs the tail rather than the point — and `list_findings` reaches the rest.
   */
  const CHAT_FINDINGS = 8;

  app.post('/api/chat', async (req, res) => {
    const { message, context, thread } = req.body as {
      message: string;
      context: ContextEnvelope;
      /** Absent for a one-shot caller like scripts/inspect.mjs. */
      thread?: ChatThread;
    };

    /**
     * The front door, added here rather than sent by the browser.
     *
     * The gateway owns `/api/findings`, so it is the authority on what the list
     * says; a client-supplied copy could be stale or simply wrong, and this is
     * the one thing the answer must agree with. Only when the conversation is
     * not already about one alert — see `ContextEnvelope.findings`.
     *
     * Failure is silent on purpose. A chat that will not answer because the
     * findings pass threw is a worse outcome than a chat that answers without
     * the list, which is exactly what it did before this existed.
     */
    const env: ContextEnvelope = { ...(context ?? {}) };
    if (!env.finding) {
      try {
        const found = await runFindings({
          source: currentGraph(),
          vault,
          items: await connectors.jira.listItems(),
          connectors,
        });
        if (found.length) {
          env.findings = found.slice(0, CHAT_FINDINGS).map((f) => ({
            id: f.id,
            kind: f.kind,
            claim: f.claim,
            severity: f.severity,
          }));
        }
      } catch {
        /* answer without it */
      }
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
      for await (const chunk of agent.ask(message, env, thread)) {
        res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
    }
    res.end();
  });

  /**
   * Starter questions for an empty chat.
   *
   * A POST for a read, because the input is the context envelope and a
   * `selection[]` in a query string is a worse shape than a body. Nothing here
   * writes — see suggest.ts for why this is computed rather than asked of the
   * model, and why the browser cannot compute it itself.
   */
  app.post('/api/suggestions', async (req, res) => {
    try {
      const suggestions = await suggestQuestions(
        connectors,
        vault,
        (req.body ?? {}) as SuggestInput,
        // The reconciled graph, never the live board — see gatherFacts.
        projectArrows(currentGraph().graph),
      );
      return res.json({ suggestions });
    } catch (err) {
      // The suggestions are a starting point, not a feature to fail loudly: a
      // broken pass must not leave an empty box where the invitation goes.
      console.warn('[suggest] falling back:', err);
      return res.json({ suggestions: FALLBACK });
    }
  });

  // Direct tool invocation — how a person reaches the same logic the agent uses
  // without going through the LLM. This is the route `accept_proposal` and
  // `reject_proposal` are reached by, and the reason `HUMAN_ONLY` withholding
  // them from every provider is a real gate rather than a prompt instruction.
  app.post('/api/tools/:name', async (req, res) => {
    const tool = tools.find((t) => t.name === req.params.name);
    if (!tool) return res.status(404).json({ error: 'unknown tool' });
    try {
      return res.json(await tool.handler(req.body ?? {}));
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  /**
   * Pending proposals, worst-first.
   *
   * Sorted here rather than at either caller because the agent reads this route
   * too, and the two must agree about which proposal is the most worth reading.
   * Confidence descending, then newest, so an uncorroborated inference never
   * sits above a decision two records asked for. Missing confidence sorts as
   * 0.5 — neither promoted nor buried, which is the honest place for "nobody
   * scored this". Nothing in the shell reads this route, by design: the alert
   * page is the review surface, and accepting is a human act over
   * `/api/tools/accept_proposal`.
   */
  app.get('/api/proposals', (_req, res) => {
    const rank = (p: { confidence?: number }): number => p.confidence ?? 0.5;
    return res.json(
      [...proposals.values()].sort(
        (a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt),
      ),
    );
  });

  // ---- skills --------------------------------------------------------------
  // The ceremonies, as procedures. Deterministic on purpose — see skills.ts.

  app.get('/api/skills', (_req, res) =>
    res.json({
      skills: SKILLS.map((s) => ({ name: s.name, label: s.label, description: s.description })),
      schedule: scheduleSummary(),
    }),
  );

  app.post('/api/skills/:name', async (req, res) => {
    const skill = findSkill(req.params.name);
    if (!skill) return res.status(404).json({ error: `no skill called ${req.params.name}` });
    try {
      const { days, from, to, arg } = req.body as {
        days?: number;
        from?: string;
        to?: string;
        arg?: string;
      };
      const result = await skill.run({
        connectors,
        vault,
        days,
        from,
        to,
        arg,
        extract,
        // The same container list `findMissingTickets` resolves against — see
        // SkillContext.containers for why a writer must not invent its own.
        containers: containersOf(currentGraph()),
      });
      eventLog.append(
        newEvent({
          source: 'mc',
          type: 'chat.command_received',
          payload: { skill: skill.name, proposals: result.proposals.length },
          summary: `ran /${skill.name} — ${result.proposals.length} proposal(s)`,
        }),
      );
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  app.use('/api/webhooks', webhookRouter((input) => capture(vault, input)));

  /**
   * SERVE THE BUILT SHELL, so one deployed process is the whole app.
   *
   * The shell is a Vite build in `apps/shell/dist` and the gateway already owns
   * the API. Serving those files from here makes a deployment one service, one
   * origin and one URL — which is also what makes `MC_APP_URL` in `notify.ts` a
   * single host rather than two that have to be kept agreeing, and what stops
   * `cors()` being load-bearing in production.
   *
   * THE CATCH-ALL IS THE POINT, not a convenience. The shell routes on
   * `location.pathname` (`apps/shell/src/alerts/router.ts`), and `notify.ts`
   * sends `/alert/<id>` as a path for exactly that reason — a hash would open
   * the front door instead of the one alert the notification was about. So
   * every deep link arrives as a request for a file that does not exist, and
   * anything that is not `/api/*` and not a real asset has to answer
   * `index.html` and let the router read the path. `spaFallback` in the shell's
   * vite config is this same rule for the dev server and `vite preview`; this
   * is it for a built deployment, and without it every citation link and every
   * notification 404s on a reload.
   *
   * Registered AFTER every `/api/*` route so it cannot shadow one, and the
   * pattern excludes `/api/` so an unknown API path still 404s as itself rather
   * than being handed HTML with a 200 — which is the failure that looks like a
   * broken client instead of a wrong URL.
   *
   * `MC_SERVE_STATIC=0` opts out for the local pairing: `npm run dev` runs vite
   * on :4200 with its own fallback and the gateway on :8787, and there a second
   * copy of the shell served from a `dist/` nobody rebuilt is a way to spend an
   * afternoon debugging the wrong build.
   */
  if ((process.env.MC_SERVE_STATIC ?? '1') !== '0') {
    const dist = fileURLToPath(new URL('../../shell/dist', import.meta.url));
    if (existsSync(dist)) {
      app.use(express.static(dist));
      app.get(/^(?!\/api\/).*/, (_req, res) => {
        // Absolute: `res.sendFile` resolves a relative path against cwd, which
        // is whatever directory the process was started from.
        res.sendFile(join(dist, 'index.html'), (err) => {
          if (err) res.status(404).send('Mission Control shell not built. Run `npm run build`.');
        });
      });
      console.log(`[static] serving the shell from ${dist}`);
    } else {
      console.warn(`[static] ${dist} not found — run \`npm run build\`. Serving the API only.`);
    }
  }

  const server = app.listen(PORT, BIND, (err?: Error) => {
    /**
     * `MC_BIND` is user-supplied, so the bind can fail — `EADDRNOTAVAIL` for an
     * address this host does not have, `ENOTFOUND` for a typo or for `[::1]`
     * copied out of a URL. Express forwards that to THIS callback rather than
     * throwing, because it registers the callback with `server.once('error')`
     * as well as with `listening`. Ignoring the argument therefore printed a
     * successful boot banner, the whole exposure warning, and a reachable URL
     * for a socket that was never opened — then stayed alive serving nothing.
     * Measured on the container path the escape hatch exists for.
     */
    if (err) {
      console.error(`cannot bind MC_BIND=${BIND}:${PORT} — ${err.message}`);
      process.exit(1);
    }
    const reach = LOOPBACK ? `http://localhost:${PORT}` : `http://${BIND}:${PORT}`;
    console.log(`mission-control gateway  mode=${MODE}  ${reach}`);
    console.log(`  ${describeSafeMode()}`);
    // Said out loud for the same reason the bind warning is: demo mode changes
    // the first screen a visitor sees, and a wrapper the operator forgot they
    // switched on is indistinguishable from the app behaving strangely.
    if (demoMode()) {
      const { minutes } = demoConfig();
      const each = `${minutes} minute${minutes === 1 ? '' : 's'}`;
      console.log(`  MC_DEMO is on — the walkthrough wraps the app, ${each} a session.`);
    }
    if (MODE === 'mock') {
      console.log('running on fixtures — no credentials needed. set MC_MODE=live to go real.');
    }
    if (!LOOPBACK) {
      // Loud, because the default is a decision (ROADMAP D4) and overriding it
      // gives up the one property that made the missing authentication
      // survivable. An opt-out nobody is warned about is how a property rots.
      console.log(
        `\n  ⚠  MC_BIND=${BIND} — this gateway is reachable from the network,\n` +
          `     and THERE IS NO AUTHENTICATION ON IT. Every route is open, the\n` +
          `     vault writes and POST /api/tools/:name included.\n` +
          `     ${
            process.env.MC_WEBHOOK_SECRET
              ? 'MC_WEBHOOK_SECRET guards /api/webhooks/* ONLY. POST /api/slack/capture\n     writes to the vault and is NOT under it.'
              : 'MC_WEBHOOK_SECRET is unset, so even /api/webhooks/* is unauthenticated.'
          }\n` +
          `     See docs/KNOWN-GAPS.md §3 and ROADMAP.md D4.\n`,
      );
    }
  });

  const shutdown = async (): Promise<void> => {
    stopSync();
    stopScheduler();
    stopCanvasPoll();
    inference.stop();
    await agent.dispose();
    // `agent.dispose()` stops a DIFFERENT Copilot client and a different child:
    // the agent's own, from `createCopilotAgent`. The shared runtime that
    // `providerCaps` starts at boot is memoised separately and only
    // `stopCopilotRuntime` can reach it. Without this line `process.exit(0)`
    // below orphans it rather than killing it — invisible under an interactive
    // Ctrl-C, which reaches the child through the process group, and a leak on
    // every SIGTERM to the gateway pid alone.
    await stopCopilotRuntime();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
