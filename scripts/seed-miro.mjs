#!/usr/bin/env node
// Put the fixture onto a real Miro board, so the live embed shows it.
//
//   node scripts/seed-miro.mjs --dry-run     what it would create, no writes
//   node scripts/seed-miro.mjs               create anything missing
//   node scripts/seed-miro.mjs --replace     delete what we made, then recreate
//
// WHY THIS IS NOT A CONNECTOR METHOD, AND MUST NOT BECOME ONE
//
// `MiroConnector` has no `createSticky` and should never grow one: Miro owns
// `position` and `frame`, and a workshop board is somebody's thinking in
// progress. Nothing in the running app writes a sticky, and this script does
// not change that — it is not imported by the gateway or the shell, and it
// only runs when a human types it.
//
// It exists because of a gap the invariant does not cover. In mock mode the
// board the app reasons about lives in the graph, while a real Miro board has
// never heard of it, and nothing in the app draws a board. This closes that gap
// in Miro, once, for a demo board you own. Same three rules `exportSnapshot`
// follows:
//
//   1. ONE SHOT. It seeds; it does not reconcile. Move a card in Miro afterwards
//      and we will not fight you for it — nothing here ever runs again on its
//      own.
//   2. ONLY WHAT IT MADE. `--replace` deletes items matching the fixture and
//      nothing else. Anything a human drew on that board is not ours to touch.
//   3. HUMAN-INVOKED. The command is the gate.
//
// Reads the board from the gateway, so it seeds whatever the connectors are
// serving — the fixtures in mock mode, a real board's contents in live mode.

const GATEWAY = process.env.MC_GATEWAY ?? 'http://localhost:8787';
const API = 'https://api.miro.com/v2';

const TOKEN = process.env.MIRO_ACCESS_TOKEN;
const BOARD = process.env.MIRO_BOARD_ID;

const flags = new Set(process.argv.slice(2));
const DRY = flags.has('--dry-run');
const REPLACE = flags.has('--replace');

// --- geometry ---------------------------------------------------------------
// Our coordinates are top-left origin, y down. Miro's are centre origin, and a
// position is the item's *centre*. A child of a frame is positioned relative to
// that frame's top-left corner — which the API sets itself, and rejects if you
// try to say it out loud.

const CARD_W = 300;
const CARD_H = 150;
const STICKY_W = 150;
const STICKY_H = 172; // what Miro gives a 150-wide square sticky
// The same padding `MiroConnector.exportSnapshot` uses, so a seeded board and an
// exported one agree about where a frame begins. These have to be read against
// the fixture's sticky row pitch: a frame reaching PAD + TITLE above its
// stickies and PAD below has to fit in the gap between rows, or consecutive
// frames overlap on the board.
const FRAME_PAD = 18;
const FRAME_TITLE_H = 26;

const die = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!TOKEN || !BOARD) {
  die(
    'MIRO_ACCESS_TOKEN and MIRO_BOARD_ID must be set.\n' +
      'They are read from the environment — `set -a; source .env; set +a` first, or\n' +
      'run through a tool that loads .env for you.',
  );
}

const base = `${API}/boards/${encodeURIComponent(BOARD)}`;
const headers = {
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
  accept: 'application/json',
};

let writes = 0;

/**
 * One API call, with the two failures this endpoint actually produces: 429 when
 * we go too fast, and a transient 500 that succeeds on a retry (seen repeatedly
 * against a healthy board while working this out).
 */
async function call(method, path, body, attempt = 1) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 200) };
  }

  if ((res.status === 429 || res.status >= 500) && attempt <= 4) {
    const wait = 400 * attempt ** 2;
    process.stderr.write(`  ${res.status} on ${method} ${path} — retrying in ${wait}ms\n`);
    await new Promise((r) => setTimeout(r, wait));
    return call(method, path, body, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  }
  if (method !== 'GET') writes++;
  return json;
}

const get = async (path) => {
  const res = await fetch(`${GATEWAY}${path}`);
  if (!res.ok) throw new Error(`gateway ${path} → HTTP ${res.status}`);
  return res.json();
};

/** Every item on the board, following the cursor. */
async function boardItems() {
  const out = [];
  let cursor;
  do {
    const page = await call('GET', `/items?limit=50${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...(page.data ?? []));
    cursor = page.cursor;
  } while (cursor);
  return out;
}

const ENDPOINT = {
  frame: 'frames',
  app_card: 'app_cards',
  sticky_note: 'sticky_notes',
  connector: 'connectors',
};

// --- gather -----------------------------------------------------------------

let cards, stickies, arrows;
try {
  [cards, stickies, arrows] = await Promise.all([
    get('/api/miro/cards'),
    get('/api/miro/stickies'),
    get('/api/miro/connectors'),
  ]);
} catch (err) {
  die(`Could not read the board from the gateway at ${GATEWAY}.\n${err.message}\nIs it running?`);
}

const items = await get('/api/jira/items');
const titleOf = new Map(items.map((i) => [i.key, i.title]));
const statusOf = new Map(items.map((i) => [i.key, i.status]));
const assigneeOf = new Map(items.map((i) => [i.key, i.assignee ?? 'unassigned']));

/** Matches `STATUS_FILL` in the shell, so a card is the same colour in both. */
const STATUS_COLOR = {
  backlog: '#5d6b7d',
  todo: '#8b98a9',
  in_progress: '#4c8dff',
  blocked: '#ff6b6b',
  in_review: '#ffb454',
  done: '#4ade80',
};

/**
 * The legs of a dependency cycle, so the loop is red on the board too — read
 * from the FINDINGS PASS rather than from a graph route.
 *
 * This used to `get('/api/graph')`, and that route was deleted with the screens
 * that were its only callers. The script then died at the gather step on every
 * run — including `--dry-run` — reporting "Could not read the board from the
 * gateway… Is it running?", which blames a healthy gateway for a route that no
 * longer exists. That is the most expensive kind of wrong error message, and it
 * is why the documented `seed-miro` flow had not been exercised since.
 *
 * `/api/findings` is the front door and a cycle IS a finding there, so this
 * reuses `findCycles` as the single definition rather than reintroducing a
 * second one. The evidence reads "PAY-9042 waits on PAY-9041"; a board arrow
 * runs blocker → waiter, so the leg is `9041|9042` — reversed from the sentence.
 *
 * Emphasis is a nicety, so a failure here degrades rather than dying: the cards,
 * stickies and arrows are the job.
 */
const cycleEdges = new Set();
try {
  const { findings = [] } = await get('/api/findings');
  for (const f of findings.filter((x) => x.kind === 'cycle')) {
    for (const e of f.evidence ?? []) {
      const leg = /^(\S+) waits on (\S+)$/.exec(e.label ?? '');
      if (leg) cycleEdges.add(`${leg[2]}|${leg[1]}`);
    }
  }
} catch (err) {
  console.warn(`  (no cycle emphasis — ${err.message})`);
}
if (cycleEdges.size) console.log(`  ${cycleEdges.size} cycle leg(s) will be drawn red`);

// Frames: a box around every sticky the team filed under one title.
const frameGroups = new Map();
for (const s of stickies) {
  if (!s.frameId) continue;
  frameGroups.set(s.frameId, [...(frameGroups.get(s.frameId) ?? []), s]);
}
const frames = [...frameGroups.entries()].map(([id, group]) => {
  const x = Math.min(...group.map((s) => s.x)) - FRAME_PAD;
  const y = Math.min(...group.map((s) => s.y)) - FRAME_PAD - FRAME_TITLE_H;
  const right = Math.max(...group.map((s) => s.x + STICKY_W)) + FRAME_PAD;
  const bottom = Math.max(...group.map((s) => s.y + STICKY_H)) + FRAME_PAD;
  // `ox`/`oy` is where this frame sits in the fixture's own coordinates. The
  // frame itself gets moved below; its stickies are still described in fixture
  // space, and their position relative to the frame has to be measured from
  // where the frame *was*.
  return { id, title: group[0].frameTitle ?? 'Unframed', x, y, ox: x, oy: y, w: right - x, h: bottom - y, stickies: group };
});

/**
 * Frames go beside the cards here, not below them as they sit in the fixture.
 *
 * The two shapes are opposite and both are right. The fixture lays its stickies
 * out as a narrow column that reads top to bottom. A Miro board is a landscape
 * canvas, and the same coordinates make it 940 wide by 3,000 tall — which opens
 * at 16% zoom, small enough that you cannot read a sticky without driving.
 *
 * Only the frame origins move. Stickies are parented and positioned relative to
 * their frame's top-left corner, so they come along for free, and the *content*
 * — which is what is being seeded — is untouched. Miro owns position anyway;
 * this is a board we are creating from scratch, not one we are rearranging.
 */
const FRAMES_PER_COLUMN = 3;
const GUTTER = 120;
if (frames.length) {
  const cardsRight = Math.max(...cards.map((c) => c.x + CARD_W));
  const cardsTop = Math.min(...cards.map((c) => c.y));
  const columnPitch = Math.max(...frames.map((f) => f.w)) + 60;
  const rowPitch = Math.max(...frames.map((f) => f.h)) + 60;
  frames.forEach((f, i) => {
    f.x = cardsRight + GUTTER + Math.floor(i / FRAMES_PER_COLUMN) * columnPitch;
    f.y = cardsTop + (i % FRAMES_PER_COLUMN) * rowPitch;
  });
}

// Centre the whole layout on the canvas origin, so the board opens on it.
const all = [
  ...cards.map((c) => ({ x: c.x, y: c.y, w: CARD_W, h: CARD_H })),
  ...frames.map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h })),
];
const minX = Math.min(...all.map((b) => b.x));
const minY = Math.min(...all.map((b) => b.y));
const maxX = Math.max(...all.map((b) => b.x + b.w));
const maxY = Math.max(...all.map((b) => b.y + b.h));
const offX = minX + (maxX - minX) / 2;
const offY = minY + (maxY - minY) / 2;

/** Our top-left box → the centre point Miro wants, in canvas coordinates. */
const toCanvas = (x, y, w, h) => ({ x: Math.round(x + w / 2 - offX), y: Math.round(y + h / 2 - offY) });

console.log(
  `${DRY ? 'Would seed' : 'Seeding'} board ${BOARD} — ` +
    `${cards.length} app cards, ${stickies.length} stickies in ${frames.length} frames, ${arrows.length} arrows`,
);

// --- what is already there --------------------------------------------------

const existing = await boardItems();
const ourTitles = new Set(frames.map((f) => f.title));
const ourStickyText = new Set(stickies.map((s) => s.text));
const ourCardKeys = new Set(cards.map((c) => c.key));

const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, '').trim();
const keyOfTitle = (t) => strip(t).match(/^([A-Z][A-Z0-9]+-\d+)/)?.[1];

const mine = existing.filter((i) => {
  if (i.type === 'frame') return ourTitles.has(strip(i.data?.title));
  if (i.type === 'sticky_note') return ourStickyText.has(strip(i.data?.content));
  if (i.type === 'app_card') return ourCardKeys.has(keyOfTitle(i.data?.title));
  return false;
});

if (mine.length && !REPLACE) {
  console.log(
    `\n${mine.length} items on this board already match the fixture. Nothing written.\n` +
      'Re-run with --replace to delete those and seed again. Anything else on the\n' +
      'board is left alone either way.',
  );
  process.exit(0);
}

if (REPLACE && mine.length) {
  console.log(`\nReplacing ${mine.length} previously seeded items (of ${existing.length} on the board).`);
  if (!DRY) {
    // Connectors first: deleting an endpoint leaves a dangling line otherwise.
    const ours = new Set(mine.map((i) => i.id));
    for (const c of existing.filter((i) => i.type === 'connector')) {
      if (ours.has(c.startItem?.id) || ours.has(c.endItem?.id)) {
        await call('DELETE', `/connectors/${c.id}`);
      }
    }
    // Stickies before their frames, or the frame takes its children with it and
    // the second delete 404s.
    for (const i of [...mine].sort((a, b) => (a.type === 'frame' ? 1 : 0) - (b.type === 'frame' ? 1 : 0))) {
      await call('DELETE', `/${ENDPOINT[i.type]}/${i.id}`).catch((e) =>
        process.stderr.write(`  could not delete ${i.type} ${i.id}: ${e.message}\n`),
      );
    }
  }
}

if (DRY) {
  console.log('\n--dry-run: nothing was written. It would create:');
  for (const f of frames) console.log(`  frame   ${f.title} (${f.stickies.length} stickies)`);
  for (const c of cards) console.log(`  card    ${c.key} ${titleOf.get(c.key) ?? ''}`);
  for (const a of arrows) {
    console.log(`  arrow   ${a.fromKey} ${a.semantic} ${a.toKey}${cycleEdges.has(`${a.fromKey}|${a.toKey}`) ? ' (cycle)' : ''}`);
  }
  process.exit(0);
}

// --- write ------------------------------------------------------------------

const idOf = new Map();

for (const c of cards) {
  const status = statusOf.get(c.key) ?? 'backlog';
  const created = await call('POST', '/app_cards', {
    data: {
      title: `${c.key} — ${titleOf.get(c.key) ?? ''}`.trim(),
      description: `Mirrored from Jira by Mission Control. Status is Jira's; this card follows it.`,
      fields: [
        { value: status.replace('_', ' '), tooltip: 'Jira status', fillColor: STATUS_COLOR[status] ?? '#5d6b7d' },
        { value: assigneeOf.get(c.key) ?? 'unassigned', tooltip: 'Assignee' },
      ],
      // "connected" is the App Card's own sync indicator — it says this card has
      // a source system behind it, which is the entire point of the type.
      status: 'connected',
    },
    position: toCanvas(c.x, c.y, CARD_W, CARD_H),
    geometry: { width: CARD_W },
  });
  idOf.set(c.key, created.id);
  process.stdout.write(`  card ${c.key}\r`);
}
console.log(`  ${cards.length} app cards            `);

for (const f of frames) {
  const frame = await call('POST', '/frames', {
    data: { title: f.title, format: 'custom', type: 'freeform' },
    position: toCanvas(f.x, f.y, f.w, f.h),
    geometry: { width: f.w, height: f.h },
  });
  for (const s of f.stickies) {
    await call('POST', '/sticky_notes', {
      data: { content: s.text, shape: 'square' },
      style: { fillColor: 'yellow', textAlign: 'left', textAlignVertical: 'top' },
      // Relative to the frame's top-left corner, and the centre of the sticky —
      // measured in fixture space, which is the only place the two agree.
      position: { x: Math.round(s.x + STICKY_W / 2 - f.ox), y: Math.round(s.y + STICKY_H / 2 - f.oy) },
      geometry: { width: STICKY_W },
      parent: { id: frame.id },
    });
  }
  console.log(`  frame "${f.title}" — ${f.stickies.length} stickies`);
}

let drawn = 0;
for (const a of arrows) {
  const from = idOf.get(a.fromKey);
  const to = idOf.get(a.toKey);
  // An arrow to a ticket with no card on this board has nothing to attach to.
  if (!from || !to) continue;
  const loop = cycleEdges.has(`${a.fromKey}|${a.toKey}`);
  const soft = a.semantic === 'relates' || a.semantic === 'parent';
  await call('POST', '/connectors', {
    startItem: { id: from },
    endItem: { id: to },
    shape: 'elbowed',
    style: {
      strokeColor: loop ? '#ff6b6b' : '#ffd02f',
      strokeWidth: loop ? '3' : '2',
      strokeStyle: soft ? 'dashed' : 'normal',
      endStrokeCap: 'arrow',
    },
    captions: [{ content: a.semantic }],
  });
  drawn++;
}
console.log(`  ${drawn} connectors`);

console.log(
  `\nDone — ${writes} writes. https://miro.com/app/board/${BOARD}/\n` +
    'With MIRO_ACCESS_TOKEN set the gateway reads this board, so seeding it is what\n' +
    'stops the live canvas disagreeing with the fixture everything else reasons about.',
);
