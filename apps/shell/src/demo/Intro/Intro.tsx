/**
 * The two screens between the welcome card and the app: the argument, then the
 * message that hands you over to it.
 *
 * THE NOTIFICATION NAMES REAL ALERTS, and this is the one thing in here worth
 * defending. An earlier version listed three invented ones — "a Sprint 12
 * commitment never made it into Jira" — which was a sentence about nobody's
 * programme, on the screen introducing a product whose entire claim is that
 * nothing is asserted without a source. It was also wrong in a way a reader
 * could catch: the alerts it promised were not the alerts on the front door,
 * because finding ids and claims belong to whichever graph is loaded. So these
 * three rows are the top three of `/api/findings`, phrased by the same
 * `KIND_LABEL` the list uses, and clicking one opens that alert. `alerts/demo.ts`
 * makes the same argument at length about the seeded conversations, for the
 * same reason.
 *
 * IT IS A SIMULATION AND SAYS SO. The point of the screen is that the front
 * door is something that arrives — `DIRECTION.md`'s first move is a
 * notification, not a page — and dressing that up as a real Slack message
 * somebody could screenshot would be a lie about an integration. The bar says
 * "simulated" and the copy says it again.
 */

import { useEffect, useState, type JSX } from 'react';
import { KIND_LABEL } from '../../alerts/AlertList/AlertList';
import { useFindings } from '../../alerts/api';
import { go } from '../../alerts/router';

import './Intro.css';

/**
 * What it reads, in judge-demo's order, plus the one that came later.
 *
 * Those five are `DemoIntro.tsx`'s list verbatim. GitHub is appended rather
 * than slotted in: it is a real surface on this branch — the toolbar draws a
 * connector dot for it and `Sources` counts its pull requests — so a pitch that
 * lists what Mission Control reads and leaves it out is understating the
 * product on the screen whose whole job is to describe it. Last, because that
 * is where the app's own connector row puts it.
 */
const SURFACES = [
  { key: 'zoom', label: 'Zoom' },
  { key: 'slack', label: 'Slack' },
  { key: 'miro', label: 'Miro' },
  { key: 'conf', label: 'Confluence' },
  { key: 'jira', label: 'Jira' },
  { key: 'github', label: 'GitHub' },
];

/**
 * A stable pseudo-random source. Mulberry32 — small, fast, and identical on
 * every machine, which is the only property that matters here.
 */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GNode {
  x: number;
  y: number;
  r: number;
  surface: string;
}

/**
 * Six clusters, one per surface, laid out across the canvas and then wired
 * together — records inside a tool are dense, and the links BETWEEN tools are
 * the ones this product is about, so those are drawn lighter and longer.
 *
 * The three unconnected points on the right are the alerts. They are placed by
 * hand rather than scattered: the whole picture is arguing that they are the
 * exception, and an exception that lands somewhere different on each build is
 * not making the argument.
 */
const GRAPH = (() => {
  const rnd = mulberry(20260828);
  /**
   * SPARSE ENOUGH TO READ AT 420px WIDE, which is the width that set these
   * numbers. The graph is shown at every size now rather than hidden on a
   * phone, and a 720-unit canvas drawn into a 420px column is scaled to 0.58 —
   * so every dot, gap and line is a little over half the size it is here.
   * Sixty-seven records and ninety-eight links survived that as a smudge. These
   * counts are the most that still read as individual points and connections at
   * the smallest width, which makes them the right number at every width.
   */
  const CLUSTERS: { surface: string; x: number; y: number; n: number; spread: number }[] = [
    { surface: 'zoom', x: 78, y: 104, n: 4, spread: 48 },
    { surface: 'slack', x: 130, y: 238, n: 5, spread: 52 },
    { surface: 'conf', x: 240, y: 52, n: 4, spread: 44 },
    { surface: 'jira', x: 296, y: 166, n: 7, spread: 62 },
    { surface: 'github', x: 414, y: 248, n: 4, spread: 48 },
    { surface: 'miro', x: 438, y: 62, n: 3, spread: 42 },
  ];

  const nodes: GNode[] = [];
  const hubs: GNode[] = [];

  /**
   * NOTHING TOUCHES ANYTHING, and it is rejection sampling rather than a nudge.
   *
   * A plain scatter puts two dots on top of each other often enough to notice —
   * at a phone's scale a merged pair reads as one larger node, which is exactly
   * the thing the hubs use to mean something. So a candidate is thrown away and
   * redrawn until it clears every dot already placed by both radii plus a gap.
   * Bounded, because an unbounded search over a full disc is a hang: after
   * `TRIES` it takes the last candidate and the layout is still readable, and
   * with these counts and spreads it has never come close.
   */
  const GAP = 4;
  const TRIES = 60;
  const clears = (x: number, y: number, r: number): boolean =>
    nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= n.r + r + GAP);

  for (const c of CLUSTERS) {
    const hub: GNode = { x: c.x, y: c.y, r: 8, surface: c.surface };
    hubs.push(hub);
    nodes.push(hub);
    for (let i = 0; i < c.n; i++) {
      const r = 4.6 + rnd() * 1.8;
      let x = c.x;
      let y = c.y;
      for (let t = 0; t < TRIES; t++) {
        const angle = rnd() * Math.PI * 2;
        // sqrt keeps the scatter even across the disc rather than bunched at
        // the centre, which is what a plain radius gives you.
        const dist = Math.sqrt(rnd()) * c.spread;
        x = Math.round(c.x + Math.cos(angle) * dist);
        y = Math.round(c.y + Math.sin(angle) * dist * 0.95);
        if (clears(x, y, r)) break;
      }
      nodes.push({ x, y, r, surface: c.surface });
    }
  }

  const edges: { a: GNode; b: GNode; weak?: boolean }[] = [];
  // every record to its own tool's hub
  let at = 0;
  for (const c of CLUSTERS) {
    const hub = nodes[at]!;
    at += 1;
    for (let i = 0; i < c.n; i++) edges.push({ a: nodes[at + i]!, b: hub });
    at += c.n;
  }
  // the tools to each other — the joins that make it one graph
  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) edges.push({ a: hubs[i]!, b: hubs[j]!, weak: true });
  }
  // and the long cross-tool links a shared key actually produces
  const loose = nodes.filter((n) => n.r < 7);
  for (let i = 0; i < 9; i++) {
    const a = loose[Math.floor(rnd() * loose.length)]!;
    const b = loose[Math.floor(rnd() * loose.length)]!;
    if (a !== b && a.surface !== b.surface) edges.push({ a, b, weak: true });
  }

  return {
    nodes,
    edges,
    gaps: [
      { x: 580, y: 118 },
      { x: 628, y: 180 },
      { x: 556, y: 216 },
    ],
    // End-anchored: the label grows LEFTWARDS from the canvas edge, so the
    // larger type it takes at phone widths cannot run off the right of it.
    flag: { x: 706, y: 262 },
  };
})();

const POINTS = [
  {
    n: '01',
    title: 'Find the gap',
    body: 'Spot missing actions, conflicting updates and work that is no longer moving.',
  },
  {
    n: '02',
    title: 'Show the provenance',
    body: 'Keep the original source, speaker, timestamp and record attached to the alert.',
  },
  {
    n: '03',
    title: 'Clarify what happens next',
    body: 'Give the programme team one place to investigate and decide the next action.',
  },
];

export function Intro({
  name,
  onDone,
}: {
  name: string;
  onDone: () => void;
}): JSX.Element {
  const [stage, setStage] = useState<'pitch' | 'handoff'>('pitch');
  const found = useFindings();
  const top = (found.data?.findings ?? []).slice(0, 3);

  /**
   * Each screen opens at its top — the same rule `AlertApp` applies to routes,
   * for the same reason. These are two full pages that swap in place without
   * the address changing, so nothing resets the scroll: pressing the button at
   * the foot of the pitch left the reader partway down the notification, with
   * its headline above them and no indication anything had happened.
   */
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  /** Straight to the alert the row names — the hand-off, doing its job. */
  const openAlert = (id: string): void => {
    onDone();
    go({ name: 'alert', id });
  };

  if (stage === 'handoff') {
    return (
      <main className="mcdemo-page">
        <header className="mcdemo-pagehead">
          <span className="mcdemo-kicker">Simulated notification · Slack</span>
          <button type="button" className="mcdemo-skip" onClick={onDone}>
            Skip to Mission Control
          </button>
        </header>

        <section className="mcdemo-copy">
          <p className="mcdemo-eyebrow">Your morning starts where your team already works</p>
          <h1>Mission Control brings the important gaps to you.</h1>
          <p className="mcdemo-lede">
            This is a simulated Slack alert. It is the hand-off into Mission Control, not a
            replacement dashboard.
          </p>
        </section>

        <section className="mcdemo-slack" aria-label="Simulated Slack morning alert">
          <div className="mcdemo-slackbar"># mission-control-alerts · simulated Slack</div>
          <div className="mcdemo-msg">
            <div className="mcdemo-avatar" aria-hidden="true">
              MC
            </div>
            <div className="mcdemo-msgbody">
              <div className="mcdemo-byline">
                <b>Mission Control</b>
                <span className="mcdemo-apptag">APP</span>
                <time>08:02</time>
              </div>
              <p>
                Morning, {name}. I found several things that need attention across today&rsquo;s
                connected work.
              </p>
              {top.length > 0 && (
                <div className="mcdemo-previews" aria-label="Preview of today&rsquo;s alerts">
                  {top.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className="mcdemo-preview"
                      data-severity={f.severity}
                      onClick={() => openAlert(f.id)}
                    >
                      <span className="mcdemo-kind">{KIND_LABEL[f.kind]}</span>
                      <strong>{f.claim}</strong>
                      <small>{f.impact}</small>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="mcdemo-open" onClick={onDone}>
                Open Mission Control
              </button>
            </div>
          </div>
        </section>

        <p className="mcdemo-foot">
          Next: investigate the highest-priority alert and its evidence.
        </p>
      </main>
    );
  }

  return (
    <main className="mcdemo-page">
      <header className="mcdemo-pagehead">
        <span className="mcdemo-kicker">Mission Control · 1 minute introduction</span>
        <button type="button" className="mcdemo-skip" onClick={onDone}>
          Skip introduction
        </button>
      </header>

      <section className="mcdemo-copy" data-wide="">
        <p className="mcdemo-eyebrow">The problem</p>
        <h1>Work gets promised in meetings and messages. Jira only knows what got filed.</h1>
        <p className="mcdemo-lede">
          Mission Control reads across the tools your programme already uses, finds gaps and
          contradictions, and shows the evidence behind every alert.
        </p>
      </section>

      <section className="mcdemo-flow" aria-label="How Mission Control works">
        <div className="mcdemo-pills">
          {SURFACES.map((s) => (
            <span key={s.key} className="mcdemo-pill" data-surface={s.key}>
              {s.label}
            </span>
          ))}
        </div>
        <span className="mcdemo-arrow" aria-hidden="true">
          →
        </span>
        <div className="mcdemo-out">
          <span className="mcdemo-outlabel">Mission Control</span>
          <strong>Find what needs a human</strong>
          <small>Alert · evidence · action</small>
        </div>
      </section>

      {/**
        * THE ARGUMENT AS A PICTURE, between the claim above it and the three
        * points below.
        *
        * The pills above say which tools are read; the points below say what
        * comes out. Neither shows the thing in between, which is the whole idea:
        * every record carries the same ticket key, so hundreds of them join into
        * ONE graph — and the alert is the handful of places that join does not
        * close.
        *
        * NO LABELS, DELIBERATELY. This is not a diagram anybody is meant to read
        * node by node; it is the scale of the thing. Naming forty boxes would
        * invite reading them and there is nothing there to read. A dot in its
        * source's colour is the same vocabulary as the connector dots in the
        * toolbar, so the palette is already familiar by the time it appears.
        *
        * THE LAYOUT IS SEEDED, NOT RANDOM. `Math.random` here would redraw the
        * graph on every render and every reload — the picture would move under a
        * reader mid-sentence, and two people at the same demo would be looking
        * at different pictures. `MULBERRY` off a fixed seed gives an organic
        * scatter that is the same everywhere, forever, and it is computed once
        * at module scope rather than per render.
        */}
      <section className="mcdemo-graph" aria-labelledby="mcdemo-graphcap">
        <p className="mcdemo-graphcap" id="mcdemo-graphcap">
          Every record carries the same ticket key, so all of it joins into one
          graph. <span>The alerts are the few places it does not.</span>
        </p>
        <svg
          className="mcdemo-svg"
          viewBox="0 0 720 320"
          role="img"
          aria-label="A dense connection graph: several hundred records from Zoom, Slack, Miro, Confluence, Jira and GitHub, joined to one another by the ticket keys they carry. Three points sit apart from it, unconnected — promises that no ticket references, which is what the product raises as an alert."
        >
          {GRAPH.edges.map((e, i) => (
            <line
              key={`e${i}`}
              className="mcdemo-gedge"
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              {...(e.weak ? { 'data-weak': '' } : {})}
            />
          ))}
          {GRAPH.nodes.map((n, i) => (
            <circle
              key={`n${i}`}
              className="mcdemo-gnode"
              data-surface={n.surface}
              cx={n.x}
              cy={n.y}
              r={n.r}
            />
          ))}
          {GRAPH.gaps.map((g, i) => (
            <g key={`g${i}`} className="mcdemo-ggap">
              <circle className="mcdemo-ghalo" cx={g.x} cy={g.y} r={14} />
              <circle className="mcdemo-gdot" cx={g.x} cy={g.y} r={5} />
            </g>
          ))}
          <text className="mcdemo-gflag" x={GRAPH.flag.x} y={GRAPH.flag.y}>
            nothing references these
          </text>
        </svg>
      </section>

      <section className="mcdemo-points">
        {POINTS.map((p) => (
          <article key={p.n}>
            <span>{p.n}</span>
            <strong>{p.title}</strong>
            <p>{p.body}</p>
          </article>
        ))}
      </section>

      <div className="mcdemo-actions">
        <button type="button" className="mcdemo-primary" onClick={() => setStage('handoff')}>
          See today&rsquo;s morning alerts
        </button>
        <span>Next: a simulated Slack notification</span>
      </div>
    </main>
  );
}
