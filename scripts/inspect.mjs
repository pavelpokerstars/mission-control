#!/usr/bin/env node
// Dev inspection for a running gateway.
//
// This replaces a pile of hand-escaped `curl | node -e` one-liners that had
// accreted in .claude/settings.local.json as individual permission entries.
// One script, one permission rule, and the SSE parsing lives somewhere it can
// be read and fixed.
//
//   node scripts/inspect.mjs up
//   node scripts/inspect.mjs health
//   node scripts/inspect.mjs notes
//   node scripts/inspect.mjs log [limit]
//   node scripts/inspect.mjs work [assignee]
//   node scripts/inspect.mjs issue MC-103
//   node scripts/inspect.mjs summary MC-103
//   node scripts/inspect.mjs stickies
//   node scripts/inspect.mjs suggest [FOCUSED-KEY] [WINDOW-DAYS]
//   node scripts/inspect.mjs skill workshop [zoom-001]
//   node scripts/inspect.mjs recall "why is MC-102 stuck?"
//
// `skill` is the only command here with side effects: a run that proposes
// writes `mc.proposal_created` to the durable log. Clean up after a probe with
// POST /api/vault/log/delete — see CLAUDE.md.

const GATEWAY = process.env.MC_GATEWAY ?? 'http://localhost:8787';
const SHELL = process.env.MC_SHELL ?? 'http://localhost:4200';
const RECALL_BUDGET = 900; // keep in sync with libs/vault/src/recall.ts

const [cmd, ...rest] = process.argv.slice(2);

const get = async (path) => {
  const res = await fetch(`${GATEWAY}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

switch (cmd) {
  case 'up': {
    for (const [name, url] of [
      ['gateway', `${GATEWAY}/api/health`],
      ['shell  ', SHELL],
    ]) {
      try {
        const r = await fetch(url);
        console.log(`${name}  ${r.status}`);
      } catch {
        console.log(`${name}  DOWN`);
      }
    }
    break;
  }

  /**
   * Every status word this graph uses, and what it became.
   *
   * The point is to make writing an `MC_STATUS_MAP` cheap on a machine you have
   * just pointed at a real export: a word reading `category` came from
   * `statusCategory`, which is three-valued, so `in_review` and `blocked` were
   * unreachable for every issue in that row. That is the loss a status map
   * exists to prevent, and it is invisible from the app.
   */
  case 'statuses': {
    const h = await get('/api/health');
    const rows = await get('/api/statuses');
    console.log(
      h.status?.configuredFrom
        ? `status map: ${h.status.configuredFrom}`
        : 'status map: built-in defaults (set MC_STATUS_MAP to override)',
    );
    console.log('');
    const w = Math.max(6, ...rows.map((r) => r.vendor.length));
    console.log(`${'vendor'.padEnd(w)}  ${'→ ours'.padEnd(12)} via        issues`);
    for (const r of rows) {
      const flag = r.via === 'map' ? '' : '   ← unmapped';
      console.log(
        `${r.vendor.padEnd(w)}  ${r.mapped.padEnd(12)} ${r.via.padEnd(10)} ${String(r.count).padStart(5)}${flag}`,
      );
    }
    const unmapped = rows.filter((r) => r.via !== 'map');
    if (unmapped.length) {
      console.log('');
      console.log(`${unmapped.length} word(s) fell through to statusCategory. A starting point:`);
      console.log('');
      console.log(JSON.stringify(Object.fromEntries(unmapped.map((r) => [r.vendor, r.mapped])), null, 2));
      console.log('');
      console.log('Save that, correct the targets, and point MC_STATUS_MAP at it.');
    }
    break;
  }

  /**
   * Who the graph thinks these people are.
   *
   * Same purpose as `statuses`: on a machine just pointed at a real export, this
   * is the only way to see that the cross-surface joins have stopped working. A
   * reference nothing resolves falls through and the app keeps running — it just
   * never matches a Jira assignee again.
   */
  case 'identities': {
    const rows = await get('/api/identities');
    const unresolved = rows.filter((r) => !r.resolved);
    const w = Math.max(8, ...rows.map((r) => r.raw.length));
    console.log(`${'reference'.padEnd(w)}  ${'→ resolved'.padEnd(16)} surfaces          refs`);
    for (const r of rows) {
      console.log(
        `${r.raw.padEnd(w)}  ${(r.resolved ?? '—').padEnd(16)} ${r.surfaces.join(',').padEnd(18)}` +
          `${String(r.count).padStart(4)}${r.resolved ? '' : '   ← unresolved'}`,
      );
    }
    console.log('');
    if (!unresolved.length) {
      console.log(`all ${rows.length} reference(s) resolve.`);
      break;
    }
    console.log(
      `${unresolved.length} of ${rows.length} reference(s) resolve to nothing. Every cross-surface`,
    );
    console.log('join involving them — who disagreed, who weighed in, whose lane a row is');
    console.log('in — will quietly return empty.');
    console.log('');
    console.log('The collector should emit a person node per human with the handles each');
    console.log('source uses. The shape, keyed on email because that is the only id every');
    console.log('source shares:');
    console.log('');
    console.log(
      JSON.stringify(
        {
          id: 'person:someone@example.com',
          kind: 'person',
          email: 'someone@example.com',
          displayName: 'Someone',
          handles: Object.fromEntries(
            [...new Set(unresolved.flatMap((r) => r.surfaces))].map((sfc) => [
              sfc,
              unresolved.find((r) => r.surfaces.includes(sfc))?.raw ?? '…',
            ]),
          ),
        },
        null,
        2,
      ),
    );
    break;
  }

  case 'health': {
    const h = await get('/api/health');
    console.log('mode: ', h.mode);
    // Where this instance is reachable from — ROADMAP D4. A health field this
    // command does not print is a field nobody sees, because this prints a
    // hand-picked subset rather than the payload.
    // An older gateway has no `host` field at all, and reporting "(loopback)"
    // for it would be the reassuring lie this whole block exists to avoid —
    // that gateway binds every interface. Say we do not know instead.
    const ho = h.host;
    console.log(
      'host: ',
      ho
        ? [
            `${ho.bind}:${new URL(GATEWAY).port || 80}`,
            ho.loopback ? '(loopback)' : '— REACHABLE FROM THE NETWORK, and unauthenticated',
            `· app at ${ho.appUrl}`,
            `· webhook secret ${ho.webhookAuth}`,
          ].join(' ')
        : 'not reported — a gateway older than ROADMAP D4, which binds every interface',
    );
    const a = h.agent ?? {};
    const effort = a.effort ? ` (effort ${a.effort})` : '';
    console.log('agent:', a.live ? `${a.provider} — ${a.model}${effort}` : a.model);
    console.log('vault:', h.vault?.notes, 'notes at', h.vault?.dir);
    // Where the data is coming from, which is the question on a live machine.
    const g = h.graph ?? {};
    console.log(
      'graph:',
      `${g.nodes ?? '?'} nodes, ${g.edges ?? '?'} edges, ${g.records ?? '?'} records`,
      g.fixture ? '(the committed fixture)' : `from ${g.dir}`,
    );
    if (g.generator) console.log('       written by', g.generator, g.generatedAt ? `at ${g.generatedAt}` : '');
    const st = h.status ?? {};
    console.log(
      'status:',
      `${st.words ?? '?'} vendor words`,
      st.configuredFrom ? `from ${st.configuredFrom}` : '(built-in defaults)',
      st.fallback ? `— ${st.fallback} of ${st.distinct} falling back to statusCategory` : '— all mapped',
    );
    console.log('tools:', (h.tools ?? []).join(', '));
    break;
  }

  case 'notes': {
    const notes = await get('/api/vault/notes');
    console.log(`${notes.length} notes`);
    for (const n of notes) console.log(' ', String(n.status).padEnd(9), n.id);
    break;
  }

  case 'log': {
    const limit = rest[0] ?? '20';
    const events = await get(`/api/vault/log?limit=${encodeURIComponent(limit)}`);
    console.log(`${events.length} persisted events`);
    for (const e of events) {
      console.log('  ', e.source, e.type, e.entityKey ?? '');
    }
    break;
  }

  // The front door, from the terminal. The interesting failure is a lane whose
  // signals do not match the ticket it opens: `work sam` and
  // `issue MC-103` are the two halves and they read the same joins.
  case 'work': {
    const who = rest[0];
    const lane = await get(`/api/work${who ? `?assignee=${encodeURIComponent(who)}` : ''}`);
    console.log(`${lane.sprint} · viewing as ${lane.assignee} · people: ${lane.people.join(', ')}`);
    const show = (rows, heading) => {
      if (!rows.length) return;
      console.log(`\n${heading}`);
      for (const r of rows) {
        const counts = Object.entries(r.counts ?? {})
          .map(([s, n]) => `${s} ${n}`)
          .join(' · ');
        console.log(`  ${r.item.key.padEnd(7)} ${String(r.item.status).padEnd(12)} ${r.item.title}`);
        for (const sig of r.signals) console.log(`      ${sig.tone.padEnd(5)} ${sig.text}`);
        if (counts) console.log(`      ${counts}`);
      }
    };
    show(lane.rows, `assigned to ${lane.assignee}`);
    show(lane.unassigned, 'unassigned');
    break;
  }

  // One work item's whole context — the same object `/api/issue/:key` and
  // `trace_entity` both read. `origin.first` with `predatesTicket` is the one
  // worth checking after a fixture change: it is the claim the demo turns on.
  case 'issue': {
    const key = rest[0];
    if (!key) die('usage: inspect.mjs issue <KEY>   e.g. issue MC-103');
    const d = await get(`/api/issue/${encodeURIComponent(key)}`);
    console.log(`${d.key} — ${d.item?.title ?? '(unknown)'} · ${d.item?.status ?? '?'}`);
    if (d.origin?.first) {
      // Two different questions: `firstIsOrigin` picks the heading (it allows a
      // grace window either way), `predatesTicket` is the strict claim.
      const head = d.origin.firstIsOrigin ? 'came from' : 'earliest record';
      const when = d.origin.predatesTicket ? 'BEFORE the ticket existed' : 'after it was filed';
      console.log(`${head}: ${d.origin.first.surface} · ${d.origin.first.label} · ${when}`);
    }
    for (const c of d.contradictions) {
      console.log(`disagreement: "${c.claimsDone.label}" says done vs "${c.claimsBlocked.label}" says not`);
    }
    for (const cy of d.inCycle) console.log('cycle:', cy.join(' → '));
    console.log('chain:');
    for (const r of d.related) {
      const arrow = r.direction === 'in' ? '←' : '→';
      const guess = r.provenance === 'inferred' ? ' ~inferred' : '';
      console.log(`  ${arrow} ${String(r.via).padEnd(10)} ${r.id}${guess}`);
    }
    console.log(`trail: ${d.trail.length} records —`, JSON.stringify(d.counts));
    break;
  }

  // The agent's read on one ticket. Answers `pending` while a turn runs, and
  // nothing is warmed — asking is what writes the first card, so the first call
  // for any ticket is a cold `pending` and a CLI turn takes most of a minute.
  // Poll every 3s; the answer is then cached on the brief's fingerprint.
  case 'summary': {
    const key = rest[0];
    if (!key) die('usage: inspect.mjs summary <KEY>   e.g. summary MC-103');
    const res = await get(`/api/issue/${encodeURIComponent(key)}/summary`);
    if (res.status !== 'ready') {
      console.log(`${key}: ${res.status}`);
      break;
    }
    const s = res.summary;
    console.log(`${key} — written by ${s.provider} at ${s.generatedAt.slice(0, 16).replace('T', ' ')}\n`);
    console.log(s.state, '\n');
    console.log(s.why, '\n');
    if (s.next) console.log('WHAT WOULD MOVE IT:', s.next, '\n');
    if (s.watch) console.log('WORTH NOT TRUSTING:', s.watch, '\n');
    console.log(`drawn from records ${s.citations.join(', ')}`);
    break;
  }

  case 'stickies': {
    const stickies = await get('/api/miro/stickies');
    console.log(`${stickies.length} stickies`);
    for (const s of stickies) {
      const frame = `[${s.frameTitle ?? 'unframed'}]`.padEnd(16);
      const keys = s.mentions?.length ? ` · ${s.mentions.join(', ')}` : '';
      console.log('  ', frame, s.text + keys);
    }
    break;
  }

  // What Ask would offer from here. The interesting failure is a suggestion
  // that ignores its context, so `suggest` and `suggest PAY-9031` should not
  // print the same four questions.
  case 'suggest': {
    // Second argument is the window in days. `suggest PAY-9031 7` and `… 30`
    // should print different ages for the same ticket — if they do not, the
    // window is not reaching the lane build.
    const [key, windowDays] = rest;
    const res = await fetch(`${GATEWAY}/api/suggestions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(key ? { focusedKey: key } : {}),
        ...(windowDays ? { windowDays: Number(windowDays) } : {}),
      }),
    });
    if (!res.ok) die(`/api/suggestions → HTTP ${res.status}`);

    const { suggestions = [] } = await res.json();
    for (const s of suggestions) console.log(' •', s.text, `\n    ${s.why}`);
    break;
  }

  case 'skill': {
    const [name, ...args] = rest;
    if (!name) die('usage: inspect.mjs skill <name> [arg]   e.g. skill workshop zoom-001');

    const res = await fetch(`${GATEWAY}/api/skills/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args.length ? { arg: args.join(' ') } : {}),
    });
    if (!res.ok) die(`/api/skills/${name} → HTTP ${res.status}`);

    const out = await res.json();
    if (out.error) die(out.error);
    console.log(out.brief);

    // The brief says how many proposals there are; this says what they would
    // write and who claims it, which is the part worth checking before accept.
    if (out.proposals?.length) {
      console.log(`\n${out.proposals.length} proposal(s):`);
      for (const p of out.proposals) {
        const cited = [...new Set((p.evidence ?? []).map((e) => e.surface))].join(' ');
        console.log('  ', String(p.kind).padEnd(13), (p.payload?.title ?? '').slice(0, 56).padEnd(58), cited);
      }
    }
    break;
  }

  case 'recall': {
    const message = rest.join(' ');
    if (!message) die('usage: inspect.mjs recall "<question>" [FOCUSED-KEY]');

    // Every field of the envelope is optional and `renderContext` guards each
    // read, so the honest envelope here is the one fact we have. It used to
    // hardcode `activeSurface: 'jira'`, which injected `active surface: jira`
    // into a real model turn — telling the agent about a pane that has not
    // existed for two iterations.
    const focusedKey = message.match(/\b[A-Z]{2,}-\d+\b/)?.[0];
    const context = focusedKey ? { focusedKey } : {};

    const res = await fetch(`${GATEWAY}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, context }),
    });
    if (!res.ok) die(`/api/chat → HTTP ${res.status}`);

    const raw = await res.text();
    const events = raw
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => {
        try {
          return JSON.parse(l.slice(6));
        } catch {
          return {};
        }
      });

    // Surface stream errors rather than reporting them as an empty recall.
    const failed = events.find((e) => e.error);
    if (failed) die(`gateway error: ${failed.error}`);

    const text = events.map((e) => e.chunk ?? '').join('');

    const start = text.indexOf('from your vault');
    if (start === -1) {
      // The probe reads the context block back out of the reply, which only the
      // stub echoes verbatim. Against live Claude there is nothing to find, and
      // saying "recall failed closed" there would be a lie.
      const { agent } = await get('/api/health');
      if (agent?.live) {
        console.log(
          `agent is live (${agent.provider} — ${agent.model}) — it answers rather than\n` +
            'echoing its context. This probe reads the stub\'s echo; unset the provider key\n' +
            'and restart the gateway to use it.',
        );
      } else {
        console.log('NO RECALL BLOCK (recall failed closed)');
      }
    } else {
      // The stub closes with a `---` rule after the context, so the vault
      // section has a stable end without a line of noise in the answer. (It used
      // to be sliced against "Registered tools", which was printed under every
      // single answer purely so this probe had something to find.)
      const end = text.indexOf('\n---\n', start);
      const block = text.slice(start, end === -1 ? undefined : end);
      // The budget bounds note excerpts, not the rendered header/labels, so
      // the printed total runs a little over it. That is expected.
      console.log(
        `recall block: ${block.length} chars (excerpt budget ${RECALL_BUDGET} + labels)`,
      );
      console.log(block.trimEnd());
    }
    break;
  }

  default:
    die(`unknown command: ${cmd ?? '(none)'}\nsee the header of ${import.meta.url}`);
}
