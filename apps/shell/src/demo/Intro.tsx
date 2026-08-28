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
import { KIND_LABEL } from '../alerts/AlertList/AlertList';
import { useFindings } from '../alerts/api';
import { go } from '../alerts/router';

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
