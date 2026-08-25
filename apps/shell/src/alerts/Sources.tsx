/**
 * Sources — what is connected, what is in scope, and what failed to join.
 *
 * Coverage, never content (`DIRECTION.md` §6). There is no route from here into
 * a record: the moment a row expands into a message list, the Slack pane is back
 * with an extra click in front of it.
 *
 * Nobody visits this twice. You set it up, and afterwards it is a place you point
 * at rather than work in — which is exactly why it is safe to make it the
 * impressive one, and why it is not in the toolbar. The connector dots in the top
 * bar are already its status and its door.
 */

import type { JSX } from 'react';
import { explain, dotClass, useJson } from './api';
import { AppWindow, type Counts } from './Chrome';
import type { Route } from './router';

interface SourcesReport {
  stats: { records: number; things: number; connections: number };
  tiers: Record<string, number>;
  rows: { surface: string; label: string; scope: string; count: string; state: string }[];
  failures: { surface: string; what: string; one: string; why: string; count: number }[];
  generatedAt: string;
  generator: string;
}

/**
 * What each tier means, in a sentence rather than a word.
 *
 * `EXTRACTED` / `INFERRED` / `AMBIGUOUS` is the vocabulary the graph speaks and
 * it is meaningless to a reader who has not read the schema. This is the one
 * place the counts are shown, so it is the one place they have to be explained —
 * and the third is the interesting one: an unsupported claim is a finding, not a
 * defect in the data.
 */
const TIER_MEANING: Record<string, string> = {
  EXTRACTED: 'read straight out of a record, or checked against one',
  INFERRED: 'worked out from evidence, and carrying the reason',
  AMBIGUOUS: 'asserted somewhere and corroborated by nothing',
};

export function Sources({ route, counts }: { route: Route; counts: Counts }): JSX.Element {
  const { data, loading, error } = useJson<SourcesReport>('/api/sources');

  return (
    <AppWindow route={route} counts={counts}>
      {loading && <div className="greet"><h1>Counting…</h1></div>}
      {error && !data && (
        <div className="greet">
          <h1>Cannot reach the gateway</h1>
          <p>{explain(error)}</p>
        </div>
      )}

      {data && (
        <>
          <div className="stat-strip">
            <div className="stat">
              <span className="n">{data.stats.records}</span>
              <span className="l">records read</span>
            </div>
            <div className="stat">
              <span className="n">{data.stats.things}</span>
              <span className="l">things</span>
            </div>
            <div className="stat">
              <span className="n">{data.stats.connections}</span>
              <span className="l">connections</span>
            </div>
            <div className="stat">
              <span className="n">{counts.alerts}</span>
              <span className="l">alerts open</span>
            </div>
          </div>

          <div className="conn">
            {data.rows.map((r) => (
              <div className="conn-row" key={r.label}>
                <i className={`dot ${dotClass(r.surface)}`} />
                <span className="nm">
                  {r.label}
                  <small className="scope">{r.scope}</small>
                </span>
                <span className="count">{r.count}</span>
                <span className={`chip ${r.state === 'connected' ? 'ok' : 'warn'}`}>
                  {r.state === 'connected' ? 'Connected' : 'Not yet'}
                </span>
              </div>
            ))}
          </div>

          <p className="quiet">
            Read from <code>{data.generator}</code>, generated{' '}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>

          {/* The credential. How much of what this holds is settled, and how much
              is still a question — stated as a number rather than implied by a
              confident interface. */}
          <div className="block topped flush">
            <h4>How much of this is settled</h4>
            <p className="blocklead">
              Every connection carries a tier. Nothing here is hidden behind a
              confident sentence — the third row is the one worth reading.
            </p>
            <div className="conn">
              {Object.entries(data.tiers).map(([tier, n]) => (
                <div className="conn-row" key={tier}>
                  <i className={`dot ${tier === 'AMBIGUOUS' ? 'miro' : tier === 'INFERRED' ? 'zoom' : 'jira'}`} />
                  <span className="nm">
                    {tier.toLowerCase()}
                    <small className="scope">{TIER_MEANING[tier]}</small>
                  </span>
                  <span className="count">{n}</span>
                </div>
              ))}
            </div>
          </div>

          {data.failures.length > 0 && (
            <div className="block topped flush">
              <h4>What we could not read</h4>
              <p className="blocklead">
                The only place in the product where you look at individual records
                — and you only ever see the ones that did not join. Nothing here
                is browsing; each row is a thing to repair.
              </p>
              <div className="conn failbox">
                {data.failures.map((f) => (
                  <div className="conn-row" key={`${f.surface}-${f.what}`}>
                    <i className={`dot ${dotClass(f.surface)}`} />
                    <span className="nm">
                      {f.count} {f.count === 1 ? f.one : f.what}
                      <small className="scope">{f.why}</small>
                    </span>
                    <span className="count">{f.surface}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </AppWindow>
  );
}
