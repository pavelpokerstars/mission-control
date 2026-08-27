import { useState, type JSX } from 'react';

import './DemoIntro.css';

type Stage = 'pitch' | 'slack';

export default function DemoIntro({
  judgeName,
  onComplete,
}: {
  judgeName: string;
  onComplete: () => void;
}): JSX.Element {
  const [stage, setStage] = useState<Stage>('pitch');

  if (stage === 'slack') {
    return (
      <main className="intro-shell">
        <header className="intro-head">
          <span className="intro-kicker">Simulated notification · Slack</span>
          <button type="button" className="intro-skip" onClick={onComplete}>
            Skip to Mission Control
          </button>
        </header>

        <section className="intro-copy">
          <p className="intro-eyebrow">Your morning starts where your team already works</p>
          <h1>Mission Control brings the important gaps to you.</h1>
          <p>
            This is a simulated Slack alert. It is the hand-off into Mission Control, not a
            replacement dashboard.
          </p>
        </section>

        <section className="slackwin intro-slack" aria-label="Simulated Slack morning alert">
          <div className="bar"># mission-control-alerts · simulated Slack</div>
          <div className="msg">
            <div className="avatar" aria-hidden="true">MC</div>
            <div>
              <div className="who">
                <b>Mission Control</b>
                <span className="app-tag">APP</span>
                <time>08:02</time>
              </div>
              <p>
                Morning, {judgeName}. I found several things that need attention across today's
                connected work.
              </p>
              <div className="intro-alerts" aria-label="Preview of today's alerts">
                <article className="intro-alert intro-alert-critical">
                  <span>Missing ticket</span>
                  <strong>A Sprint 12 commitment never made it into Jira</strong>
                  <small>Seen in Zoom and Miro · expected in Jira</small>
                </article>
                <article className="intro-alert">
                  <span>Sources disagree</span>
                  <strong>One delivery is being called both done and not done</strong>
                  <small>Slack updates conflict one day apart</small>
                </article>
                <article className="intro-alert">
                  <span>Blocked work</span>
                  <strong>A dependency loop is holding several tickets</strong>
                  <small>Derived from the connected delivery records</small>
                </article>
              </div>
              <button type="button" className="slackbtn" onClick={onComplete}>
                Open Mission Control
              </button>
            </div>
          </div>
        </section>

        <p className="intro-foot">Next: investigate the highest-priority alert and its evidence.</p>
      </main>
    );
  }

  return (
    <main className="intro-shell intro-pitch">
      <header className="intro-head">
        <span className="intro-kicker">Mission Control · 1 minute introduction</span>
        <button type="button" className="intro-skip" onClick={onComplete}>
          Skip introduction
        </button>
      </header>

      <section className="intro-copy intro-copy-wide">
        <p className="intro-eyebrow">The problem</p>
        <h1>Work gets promised in meetings and messages. Jira only knows what got filed.</h1>
        <p>
          Mission Control reads across the tools your programme already uses, finds gaps and
          contradictions, and shows the evidence behind every alert.
        </p>
      </section>

      <section className="intro-flow" aria-label="How Mission Control works">
        <div className="intro-sources">
          <span className="source-pill source-zoom">Zoom</span>
          <span className="source-pill source-slack">Slack</span>
          <span className="source-pill source-miro">Miro</span>
          <span className="source-pill source-conf">Confluence</span>
          <span className="source-pill source-jira">Jira</span>
        </div>
        <span className="intro-arrow" aria-hidden="true">→</span>
        <div className="intro-mc-card">
          <span>Mission Control</span>
          <strong>Find what needs a human</strong>
          <small>Alert · evidence · action</small>
        </div>
      </section>

      <section className="intro-benefits">
        <article>
          <span>01</span>
          <strong>Find the gap</strong>
          <p>Spot missing actions, conflicting updates and work that is no longer moving.</p>
        </article>
        <article>
          <span>02</span>
          <strong>Show the provenance</strong>
          <p>Keep the original source, speaker, timestamp and record attached to the alert.</p>
        </article>
        <article>
          <span>03</span>
          <strong>Clarify what happens next</strong>
          <p>Give the programme team one place to investigate and decide the next action.</p>
        </article>
      </section>

      <div className="intro-actions">
        <button type="button" className="intro-primary" onClick={() => setStage('slack')}>
          See today's morning alerts
        </button>
        <span>Next: a simulated Slack notification</span>
      </div>
    </main>
  );
}
