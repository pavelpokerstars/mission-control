/**
 * The conversations a demo starts with.
 *
 * WHY THIS IS IN THE BROWSER AND NOT IN A FIXTURE. Everything else the app
 * shows is seeded server-side — `seedNotes` copies the graph's claims into the
 * vault, and `Later`'s parked notes arrive the same way. Conversations cannot:
 * `conversations.ts` keeps them in `localStorage` because the gateway is
 * stateless by design, so there is no server-side collection for a fixture to
 * write into. A demo that opens `Ask` on "Nothing yet" hides the half of
 * `DIRECTION.md` §9 that matters — that you retrieve a conversation **by
 * subject**, from the alert it was about.
 *
 * WHY THEY ARE RESOLVED FROM THE LIVE FINDINGS RATHER THAN WRITTEN DOWN. A
 * conversation tied to an alert carries that alert's id, and finding ids belong
 * to whichever graph is loaded — `fixtures/` raises `disagreement:PAY-9031`,
 * `fixtures-programme/` raises `disagreement:ORB-1627`, and a real collector's
 * output raises neither. Hard-coding one set gives the other a row whose
 * "Open the alert" link goes nowhere, which is exactly the defect CLAUDE.md
 * describes as the one curl cannot see. So each spec below names an alert
 * **kind**, binds to whatever finding of that kind is actually on the front
 * door, and is dropped when there is none.
 *
 * WHY THE ANSWERS ARE COMPOSED FROM THE FINDING. The product's argument is that
 * nothing is asserted without a source, and a seeded answer inventing facts
 * about somebody's programme would break that on the one screen meant to
 * demonstrate it. Every sentence here is either the finding's own `claim`,
 * `impact` or a quoted piece of its evidence, or a statement about how the app
 * itself behaves. A spec that cannot say anything true about the data returns
 * `undefined` and is skipped.
 *
 * WHEN IT RUNS. Once, into a browser with no conversation history, and never
 * again — the same shape as `seedHistory`: a cold-start convenience, not a
 * fixture that fights real usage. Delete the rows and they stay deleted.
 */

import type { Finding } from '@mc/domain';
import { historyOf, useConversations, type Conversation } from './conversations';

/**
 * Set the first time this runs, whether or not anything was written.
 *
 * Checked BEFORE the history test, because the two answer different questions:
 * the history test says "this browser is already in use, leave it alone", and
 * this says "the offer has been made". Without it, deleting every seeded row
 * would empty the history and the next reload would put them all back — an undo
 * the reader did not ask for, on the page whose own rule is that delete acts.
 */
const SEEDED_KEY = 'mc-demo-seeded';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `conversations.ts` caps a derived title at the same width. */
const TITLE_MAX = 52;

interface Spec {
  /** How long ago the last turn landed. Sets the row order and its "when". */
  ago: number;
  /**
   * The alert KIND this is about — bound to a real finding at seed time.
   * Absent is the global case: a chat that started with no subject.
   */
  about?: Finding['kind'];
  question: string;
  /** `undefined` when the loaded data cannot support a truthful answer. */
  answer(finding: Finding | undefined, all: Finding[]): string | undefined;
}

/** `- label — "quote"`, for the evidence that carries one. */
function quoted(f: Finding): string[] {
  return f.evidence
    .filter((e) => e.quote)
    .map((e) => `- ${e.label} — *"${e.quote}"*`);
}

/**
 * Newest first, which is the order `Ask` draws them in.
 *
 * Two specs naming the same kind bind to the SAME finding, which is deliberate:
 * it is what makes an alert's ask header read "2 earlier conversations · see
 * them →" and gives the filtered `/ask?about=…` view something to filter.
 */
const SPECS: Spec[] = [
  {
    ago: 2 * HOUR,
    about: 'cycle',
    question: 'Why has none of this moved?',
    answer: (f) => {
      // The walk is the tail of the impact line — "in a dependency cycle — A → B
      // → C → A". No arrow in it means this graph phrases it some other way, and
      // a chain with one node is a box containing a sentence.
      const walk = f!.impact.split('—').pop()?.trim() ?? '';
      if (!/->|→/.test(walk)) return undefined;
      return [
        'Because they are waiting on each other. Every ticket in this set is blocked by another one in',
        'the same set, so there is no end to start from.',
        '',
        '```chain',
        'the loop, as the board draws it',
        walk,
        '```',
        '',
        'I am drawing it rather than describing it, because the shape is the answer. Breaking it means',
        'taking one of those arrows off the board, which is a scheduling decision rather than an',
        'engineering one.',
      ].join('\n');
    },
  },
  {
    ago: 5 * HOUR,
    about: 'disagreement',
    question: 'Which of the two is right?',
    answer: (f) => {
      const lines = quoted(f!);
      if (lines.length < 2) return undefined;
      return [
        'Nothing here settles it, and that is the finding. Both of these are on the record and they',
        'cannot both be current:',
        '',
        ...lines,
        '',
        `${f!.impact}.`,
        '',
        'Either citation opens the message itself, at the line it quotes — which is the quickest way to',
        'work out who to ask rather than which to believe.',
      ].join('\n');
    },
  },
  {
    ago: 26 * HOUR,
    about: 'missing_ticket',
    question: 'Who is meant to be doing this?',
    answer: (f) => {
      const lines = quoted(f!);
      if (!lines.length) return undefined;
      return [
        'Nobody the tracker can tell you about — it was taken in the room and never filed. What the',
        'records hold is this:',
        '',
        `- ${f!.impact}`,
        ...lines,
        '',
        'Creating the ticket from the alert carries all of that across as the first comment on it, so',
        'whoever picks it up gets the meeting, the rationale and the citations rather than a one-line',
        'summary of them.',
      ].join('\n');
    },
  },
  {
    ago: 27 * HOUR,
    about: 'missing_ticket',
    question: 'Where was it said?',
    answer: (f) => {
      const first = f!.evidence.find((e) => e.quote);
      if (!first) return undefined;
      return [
        `In ${first.label}:`,
        '',
        `*"${first.quote}"*`,
        '',
        'That citation opens the record at the line it quotes, so you can read what was said either side',
        'of it. Nothing in the tracker references it, which is the whole of the claim.',
      ].join('\n');
    },
  },
  {
    ago: 3 * DAY,
    question: 'What needs me first this morning?',
    answer: (_f, all) => {
      const top = all.slice(0, 3);
      if (!top.length) return undefined;
      const crit = all.filter((f) => f.severity === 'crit').length;
      return [
        'These three, worst first:',
        '',
        ...top.map((f) => `- **${f.claim}** — ${f.impact}`),
        '',
        crit
          ? `${crit} of the ${all.length} open alerts are critical and the rest will keep. Every one of them`
          : `${all.length} open alerts, none of them critical. Every one of them`,
        'is on the front door with the records it was read from, so none of this is a summary you have',
        'to take my word for.',
      ].join('\n');
    },
  },
  {
    ago: 6 * DAY,
    question: 'What is quietly aging?',
    answer: (_f, all) => {
      const aging = all.filter((f) => f.kind === 'aging');
      if (!aging.length) return undefined;
      return [
        `${aging.length} ticket${aging.length === 1 ? ' has' : 's have'} stopped moving:`,
        '',
        ...aging.slice(0, 4).map((f) => `- ${f.claim} — ${f.impact}`),
        '',
        'These are the ones a stand-up never reaches, because nothing has changed about them since the',
        'last one. That is most of the case for a list that reads the clock rather than the room.',
      ].join('\n');
    },
  },
];

function titleFrom(question: string): string {
  return question.length > TITLE_MAX ? `${question.slice(0, TITLE_MAX - 1)}…` : question;
}

/**
 * Put the demo's conversations in, if this browser has none.
 *
 * Takes the findings the app has already fetched rather than fetching its own —
 * `AlertApp` reads them for the toolbar counts, and a second request for the
 * same list is how the badge and the page it counts come to disagree.
 */
export function seedDemoConversations(findings: Finding[]): void {
  if (!findings.length) return;

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(SEEDED_KEY);
  } catch {
    // Private mode, or storage denied. Nothing here is worth failing a render
    // for, and a browser that cannot persist would re-seed on every reload.
    return;
  }
  if (seen) return;

  const mark = (): void => {
    try {
      localStorage.setItem(SEEDED_KEY, new Date().toISOString());
    } catch {
      // As above.
    }
  };

  // Already in use. The offer is spent, and nothing demo-shaped goes into a
  // history somebody has been writing.
  if (historyOf(useConversations.getState().conversations).length) {
    mark();
    return;
  }

  const bound = new Map<string, Finding>();
  const now = Date.now();
  const made: Conversation[] = [];

  for (const spec of SPECS) {
    const finding = spec.about
      ? (bound.get(spec.about) ?? findings.find((f) => f.kind === spec.about))
      : undefined;
    if (spec.about && !finding) continue;

    const text = spec.answer(finding, findings);
    if (!text) continue;

    if (spec.about && finding) bound.set(spec.about, finding);
    const at = now - spec.ago;
    made.push({
      id: `demo-${made.length + 1}`,
      title: titleFrom(spec.question),
      // Frozen at the time of asking, exactly as a real one is — an answered
      // alert leaves `/api/findings`, and a row that loses its label the moment
      // the problem is fixed is a history that erases its own successes.
      ...(finding ? { alertId: finding.id, alertClaim: finding.claim } : {}),
      createdAt: at,
      updatedAt: at,
      turns: [
        { role: 'user', text: spec.question },
        { role: 'agent', text },
      ],
    });
  }

  mark();
  const [first] = made;
  if (!first) return;
  useConversations.setState({ conversations: made, activeId: first.id });
}
