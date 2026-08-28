/**
 * The gateway, typed.
 *
 * AN ALERT PAGE MUST NOT RE-RENDER UNDER SOMEBODY READING IT. Refetching on an
 * event feed that ticks constantly is right for a live board and wrong here:
 * the whole point is that this is a claim with evidence, and text moving while
 * it is being read is worse than being a minute out of date. `useJson` refetches
 * on its route and nothing else.
 */

import { useEffect, useState } from 'react';
import type { AskAudience, Evidence, Finding, Note, WorkItem } from '@mc/domain';

/**
 * Where the gateway is.
 *
 * Overridable, and in ONE place. It was a literal in two files, so a machine
 * where 8787 is already taken — or a gateway reached from anywhere other than
 * the browser's own host — left the shell unable to talk to it at all, with
 * "Failed to fetch" as the only clue and two files to find.
 *
 * `VITE_` prefixed because that is what vite exposes to the browser; anything
 * else is silently undefined at build time, which is the trap this shape
 * avoids.
 *
 * EMPTY MEANS SAME-ORIGIN, AND THAT IS THE DEPLOYED CASE. A built shell is
 * served BY the gateway — `main.ts` serves `apps/shell/dist` after every
 * `/api/*` route — so the API is wherever this page itself came from, and a
 * relative `/api/…` is correct on any host, any port and behind any proxy. The
 * literal was baked into the bundle instead, which asks the READER's machine
 * for the API: the shell loads, every fetch in it fails, and "Cannot reach the
 * gateway" is the whole of the diagnosis. Nothing on the server looks wrong,
 * because nothing on the server IS wrong — which is why curling it cannot find
 * this and opening it in a browser finds it immediately.
 *
 * `import.meta.env.DEV` is the discriminator because it is exactly the question
 * being asked — is a vite dev server serving this page? — and it is a
 * build-time constant, so the deployed bundle keeps no branch and no mention of
 * localhost at all. `npm run dev` is the one arrangement where the two differ:
 * vite on :4200, gateway on :8787.
 *
 * `vite preview` is the case neither branch fits — a built bundle (so `DEV` is
 * false) served by vite with no gateway behind it. Give it one explicitly:
 * `VITE_MC_GATEWAY=http://localhost:8787`. That is what the override is for.
 */
export const API =
  import.meta.env.VITE_MC_GATEWAY ?? (import.meta.env.DEV ? 'http://localhost:8787' : '');

/**
 * One sentence, in one place, for "the gateway did not answer at all".
 *
 * It read ":8787, start it with `npm run dev`" everywhere, which is true of a
 * developer's machine and false of every deployment — where the gateway is
 * this page's own origin and the reader has nothing to start. Two copies of it
 * had already drifted apart in wording; deriving both from `API` keeps the
 * advice attached to where the shell is actually looking.
 */
export const GATEWAY_UNREACHABLE = import.meta.env.DEV
  ? 'The gateway is not answering on :8787. Start it with `npm run dev`.'
  : 'The gateway is not answering. It serves this page too, so it is likely restarting.';

export interface FindingDetail {
  finding: Finding;
  note?: Note;
  item?: WorkItem;
  container?: { id: string; label: string; closedAt?: string };
  checklist?: { title: string; tracked: boolean; ref: string; subject?: boolean }[];
  /**
   * The decision already made about this, while it still stands.
   *
   * Present exactly when the alert is missing from the list for that reason —
   * you reached this page by its address, from your own parked note or from a
   * notification, rather than by clicking a row. Absent once a deferral lapses,
   * because the alert is then back on the list and the page has nothing to add.
   */
  answered?: { kind: 'deferred' | 'dismissed'; until?: string };
  /**
   * Who a message about this would be addressed to, and where it would go.
   *
   * The gateway's answer, and the only one — the buttons name these people
   * before the click and the draft names them after it, so a second derivation
   * in the browser is how the two come to disagree.
   */
  audience: AskAudience;
  /** Whether this instance may write to a vendor at all — see the gateway's `safe-mode.ts`. */
  safeMode?: boolean;
}

export interface Loaded<T> {
  data?: T;
  error?: string;
  loading: boolean;
  /**
   * Refetch on demand.
   *
   * Deliberately manual. An alert page must not re-render under somebody
   * reading it — the whole point is a claim with its evidence, and text moving
   * mid-sentence is worse than being a minute out of date. But answering an
   * alert changes it, so the one thing that should refetch is the thing that
   * just acted.
   */
  reload: () => void;
}

/**
 * An error a reader can act on, rather than the exception that caused it.
 *
 * `TypeError: Failed to fetch` is what a browser says when a server is not
 * answering, and printing it verbatim tells somebody who did not write this
 * nothing at all. There are only two cases that matter here and they have
 * different answers: the gateway is not running (start it), or this particular
 * thing is not there (it may be gone, which is often the good outcome).
 *
 * The raw text is kept on the end in parentheses. It is the only thing that
 * helps when the cause is neither of those.
 */
export function explain(error: string): string {
  if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(error)) {
    return GATEWAY_UNREACHABLE;
  }
  if (/\b404\b/.test(error)) return 'The gateway does not have it.';
  if (/\b5\d\d\b/.test(error)) return 'The gateway failed while reading it.';
  return error.replace(/^Error:\s*/, '');
}

export function useJson<T>(path: string | undefined): Loaded<T> {
  const [state, setState] = useState<Omit<Loaded<T>, 'reload'>>({ loading: !!path });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!path) {
      setState({ loading: false });
      return;
    }
    let live = true;
    /**
     * KEEP THE OLD DATA WHILE REFETCHING.
     *
     * Clearing it makes the page fall back to its loading branch, which unmounts
     * everything below — and that unmounted the "here is what just happened"
     * strip on an alert the instant it appeared, because acting on a finding
     * triggers exactly this refetch. The POST returned 200, the outcome was
     * real, and the screen showed nothing.
     *
     * It is also the better behaviour generally: an alert page must not flicker
     * under somebody reading it.
     */
    setState((prev) => ({ ...prev, loading: true, error: undefined }));
    fetch(`${API}${path}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return (await r.json()) as T;
      })
      .then((data) => live && setState({ data, loading: false }))
      /**
       * AND KEEP IT WHEN THE REFETCH FAILS, for the same reason.
       *
       * The rule above was applied to the pending state and not to this one, so
       * the strip it exists to protect was destroyed by the other branch instead.
       * Answering the flagship alert makes the finding stop firing — that IS the
       * success — so the refetch it triggers 404s, this cleared `data`, and the
       * page replaced "PAY-9045 created" with "That alert is not there" before
       * anybody could read it. The POST returned 200 and the screen said the
       * opposite.
       *
       * A failed refetch must never replace content somebody is looking at. It
       * still reports `error`, so a page with nothing to show can say so; a page
       * that already has something keeps it. The cost is that a reader is not
       * told their view has gone stale, which is the same trade the loading
       * branch already makes and the better one: the alternative is a banner
       * contradicting the page underneath it.
       */
      .catch((e: unknown) => live && setState((prev) => ({ ...prev, error: String(e), loading: false })));
    return () => {
      live = false;
    };
  }, [path, nonce]);

  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/**
 * What the front door returns, and the two halves are not interchangeable.
 *
 * `findings` is THE LIST — already free of everything a human has deferred or
 * dismissed, and the only one of the two that may be rendered as alerts or
 * counted in the toolbar. `parked` is what was suppressed, carried alongside so
 * a `Later` row can name the alert its note came from: a note is parked exactly
 * when its alert has left the list, so `findings` is the one array that can
 * never resolve one. See `runAlertFindings` in the gateway for why this is two
 * arrays rather than one with a flag on each entry.
 */
export interface AlertFindings {
  findings: Finding[];
  parked: Finding[];
}

export function useFindings(): Loaded<AlertFindings> {
  return useJson<AlertFindings>('/api/findings');
}

export function useFinding(id: string): Loaded<FindingDetail> {
  return useJson<FindingDetail>(`/api/findings/${encodeURIComponent(id)}`);
}

/** The source dot class the stylesheet expects. Confluence is `conf`, not `confluence`. */
export function dotClass(surface: Evidence['surface'] | string): string {
  return surface === 'confluence' ? 'conf' : surface;
}

// ---------------------------------------------------------------------------
// Answering an alert
// ---------------------------------------------------------------------------

export interface ActionResult {
  outcome: string;
  /** The write was refused and nothing happened — no tick over that. */
  failed?: true;
  /** It has gone. The draft stops being editable, because it is no longer a draft. */
  sent?: true;
  /**
   * The draft, so the page can SHOW it.
   *
   * `payload` was not in this type and nothing rendered it, which is how the
   * result strip came to say *"read it before it goes"* over a message the
   * interface never displayed. The gateway had been sending the whole proposal
   * all along; only the shell's view of it was narrow.
   */
  proposal?: { kind: string; evidence: unknown[]; payload?: { text?: string; to?: string[] } };
  note?: Note;
}

export interface ActionInput {
  /**
   * `send` is not a fifth action on the alert — `DESIGN.md` §7 caps it at four.
   * It is what you press inside the result of one of them, on a draft you have
   * read. See the gateway's `ActionName`.
   */
  action: 'primary' | 'ask' | 'defer' | 'dismiss' | 'send';
  note?: string;
  until?: string;
  reason?: string;
  /** "Ask" and "send": narrow it to these people. See the gateway's `ActionInput`. */
  to?: string[];
  /** "Send": the message as the reader left it, which may not be as we wrote it. */
  text?: string;
}

export async function act(id: string, input: ActionInput): Promise<ActionResult> {
  const r = await fetch(`${API}/api/findings/${encodeURIComponent(id)}/act`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as ActionResult;
}

// ---------------------------------------------------------------------------
// Later — parking, editing and deleting a note
// ---------------------------------------------------------------------------

/**
 * Deliberately thin. The vault routes already exist and already validate; this
 * is the typed edge, not a second layer of rules.
 *
 * `assertVaultSafe` rejects land as a 400 with the rule that was broken in the
 * message, so the error is worth surfacing verbatim rather than replacing with
 * "something went wrong".
 */
async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!r.ok) {
    const detail = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(typeof detail?.error === 'string' ? detail.error : `${r.status} ${r.statusText}`);
  }
  /**
   * A body only if there is one.
   *
   * `DELETE /api/vault/notes/:id` answers 204 with nothing, and parsing that
   * threw `Unexpected end of JSON input` — which surfaced as "that did not
   * work" on a delete that had in fact worked, with the row still on screen and
   * the note already gone from the vault. The worst kind of failure report:
   * the one that is wrong in both directions at once.
   */
  if (r.status === 204 || r.headers.get('content-length') === '0') return undefined as T;
  return (await r.json().catch(() => undefined)) as T;
}

/** `DESIGN.md` §6 — Later's composer is the primary action on the page. */
export function parkNote(body: string): Promise<Note> {
  return send<Note>('/api/vault/notes', 'POST', {
    kind: 'idea',
    // Untied and unnamed. `DESIGN.md` §5: "an unnamed note carries no chrome" —
    // the title is an editable field on its page, not something invented here.
    title: '',
    recency: 'dated',
    status: 'open',
    relatedKeys: [],
    tags: ['parked'],
    body,
  });
}

export function saveNote(id: string, patch: Partial<Note>): Promise<Note> {
  return send<Note>(`/api/vault/notes/${encodeURIComponent(id)}`, 'PATCH', patch);
}

export function deleteNote(id: string): Promise<unknown> {
  return send(`/api/vault/notes/${encodeURIComponent(id)}`, 'DELETE');
}

/**
 * Put it back after an undo.
 *
 * A restore is a CREATE with the original id, not an update — the row is gone
 * from the store by then. `vault.create` refuses an id that already exists,
 * which is the right failure: it means the thing was never deleted.
 */
export function restoreNote(n: Note): Promise<Note> {
  return send<Note>('/api/vault/notes', 'POST', {
    id: n.id,
    kind: n.kind,
    title: n.title,
    recency: n.recency,
    status: n.status,
    relatedKeys: n.relatedKeys,
    tags: n.tags,
    evidence: n.evidence,
    body: n.body,
    ...(n.about ? { about: n.about } : {}),
    ...(n.owner ? { owner: n.owner } : {}),
    ...(n.dueAt ? { dueAt: n.dueAt } : {}),
    ...(n.container ? { container: n.container } : {}),
  });
}
