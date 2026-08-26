/**
 * Mission Control — what needs you, worst first.
 *
 * The front door, and the one screen whose promise is that the top row is the
 * row to open. Everything about it is arranged around not diluting that:
 * no charts, no counts of things that are fine, no velocity, and nothing on
 * screen that is here to be impressive rather than to be done.
 *
 * When nothing is wrong it says so and you close it. `DESIGN.md` calls that a
 * feature, and it is the part most dashboards cannot do.
 */

import type { JSX } from 'react';
import type { Finding, FindingKind, FindingSeverity } from '@mc/domain';
import { dotClass, explain, useFindings } from './api';
import { AppWindow, type Counts } from './Chrome';
import { go, hrefFor, type Route } from './router';

/**
 * The alert type, in the words a person would use.
 *
 * A chip on a row and the chip on the page it opens are read from the same
 * place, so they cannot disagree — `DESIGN.md` §6. `FindingKind` is the
 * machine's word; this is the human's, and there is exactly one mapping.
 */
export const KIND_LABEL: Record<FindingKind, string> = {
  missing_ticket: 'Missing ticket',
  disagreement: 'Sources disagree',
  cycle: 'Circular dependency',
  suspect_link: 'Stale link',
  undetected_dependency: 'Unrecorded dependency',
  aging: 'Not moving',
  unlinked_commitment: 'Probably this ticket',
  dropped_commitment: 'Raised, then dropped',
};

const DAY_MS = 86_400_000;

/**
 * How long this has been true, in the shortest honest form.
 *
 * On the right of the row, where a status column would be on a board — because
 * "44 days" is the fact that decides whether you open it, and the status is
 * something you already have five tabs for.
 */
function since(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) return 'new';
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  return `${days} days`;
}

/** The surfaces this finding was read from, deduplicated, in a stable order. */
function surfacesOf(f: Finding): string[] {
  return [...new Set(f.evidence.map((e) => dotClass(e.surface)))];
}

function Row({ f }: { f: Finding }): JSX.Element {
  return (
    <a className={`row ${f.severity}`} href={hrefFor({ name: 'alert', id: f.id })}>
      <div>
        <div className="meta">
          <span className={`chip ${f.severity}`}>{KIND_LABEL[f.kind]}</span>
          <span className="srcs">
            {surfacesOf(f).map((s) => (
              <i key={s} className={`dot ${s}`} />
            ))}
          </span>
        </div>
        <h3>{f.claim}</h3>
        <p className="sub">{f.impact}</p>
      </div>
      <span className="go">{since(f.firedAt)} →</span>
    </a>
  );
}

/**
 * The heading counts what needs a person, not what was found.
 *
 * An `ok` finding is a note in the margin — a link nobody explained, on live
 * work — and counting it as a thing that "needs you" is how a list stops being
 * believed. `DESIGN.md` §8: anything that states a count reads it from the
 * collection, never a literal.
 */
function headline(findings: Finding[]): string {
  const needy = findings.filter((f) => f.severity !== 'ok').length;
  if (!needy) return 'Nothing needs you';
  return `${needy} thing${needy === 1 ? '' : 's'} need${needy === 1 ? 's' : ''} you`;
}

/**
 * The line under the heading, and it is a real sentence.
 *
 * `3 source(s)` is the classic tell that nobody read the output — this app is
 * one where a count in the wrong shape undermines the claim above it, because
 * the whole argument is that these findings come from joining sources no single
 * tool can join. Pluralised properly, and it says WHICH sources rather than how
 * many, because the names are the interesting part.
 */
function subhead({
  findings,
  loading,
  error,
}: {
  findings: Finding[];
  loading: boolean;
  error?: string;
}): string {
  if (error) return explain(error);
  if (loading) return 'Reading across every connected source.';
  const names = [...new Set(findings.flatMap(surfacesOf))].sort();
  if (!names.length) return 'Everything that is connected agrees with everything else.';
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
  return `Read across ${list}.`;
}

export function AlertList({ route, counts }: { route: Route; counts: Counts }): JSX.Element {
  const { data, error, loading } = useFindings();
  const findings = data?.findings ?? [];

  return (
    <AppWindow route={route} counts={counts}>
      <div className="greet">
        <h1>{loading ? 'Looking…' : error ? 'Cannot reach the gateway' : headline(findings)}</h1>
        <p>
          {subhead({ findings, loading, error })}
          {/**
           * What you pushed away, on the page you pushed it away from.
           *
           * `DESIGN.md` §6 and the preview both put it here, and the reason is
           * the one that makes Later worth having: a deferral you can only
           * reach from the toolbar is a deferral nobody looks at, and the list
           * is where you are standing when you decide something can wait.
           * Hidden at zero — an empty pointer is an advert for an empty page.
           */}
          {counts.later > 0 ? (
            <>
              {' · '}
              <button type="button" className="laterlink" onClick={() => go({ name: 'later' })}>
                {counts.later} parked for later →
              </button>
            </>
          ) : null}
        </p>
      </div>

      {findings.length > 0 && (
        <div className="rows">
          {findings.map((f) => (
            <Row key={f.id} f={f} />
          ))}
        </div>
      )}

      {!loading && !error && findings.length === 0 && (
        <p className="quiet">
          Nothing has changed that needs a decision. This is the screen you want to be able to close.
        </p>
      )}

      {findings.some((f) => f.severity === 'ok') && (
        <p className="quiet">
          The last row is worth a look but not an interruption — it is here so nothing is hidden, not
          because it needs you today.
        </p>
      )}
    </AppWindow>
  );
}

export type { FindingSeverity };
