/**
 * Who is reading this, when anything knows — and nothing does by default.
 *
 * THE PRODUCT HAS NO LOGIN. There is no account, no session and no user record
 * anywhere in this app: the gateway is single-tenant and the vault has one
 * writer, so "who am I" has never had an answer to give. The chat drew one
 * anyway — `Turns` hard-coded the initials `PP` on every reader's own turn, so
 * every visitor to the deployed demo watched their own question attributed to
 * somebody else's initials.
 *
 * So the honest default is NOTHING, and the badge is simply not drawn. A name
 * appears only when some layer above actually knows one and says so.
 *
 * WHY THIS FILE EXISTS AT ALL, rather than a prop. Demo mode is the one layer
 * that does know a name — a visitor types it into the welcome card — and
 * `scripts/verify-design.mts` asserts that nothing under `alerts/` imports from
 * `demo/`. That rule is right and this keeps it: the dependency runs the only
 * way it is allowed to, `demo/` calling `setViewer` on the way in, and `alerts/`
 * reading a value it knows nothing about the origin of. `AlertApp` still takes
 * no props, and with `MC_DEMO` off nobody ever calls the setter, so the badge
 * stays absent — which is the correct answer for the product.
 *
 * It is deliberately not a store: this is set once, before the app renders, and
 * a subscription would be machinery for an event that does not happen.
 */

let viewer: string | undefined;

/** The reader's name, or `undefined` when nothing knows it. */
export function getViewer(): string | undefined {
  return viewer;
}

/** Told by a layer that actually knows. An empty name clears it. */
export function setViewer(name: string | undefined): void {
  viewer = name?.trim() || undefined;
}

/**
 * Up to two initials, for a badge 30px wide.
 *
 * `Judge A` → `JA`, `sam` → `S`. Punctuation and extra words are dropped rather
 * than squeezed: a third letter does not fit the box, and a badge that overflows
 * is worse than one that says less. Returns nothing for a name with no letters
 * in it at all, so the caller draws no badge rather than an empty one.
 */
export function initialsOf(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const parts = name
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => [...w][0]!.toUpperCase());
  return letters.length ? letters.join('') : undefined;
}
