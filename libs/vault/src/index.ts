/**
 * @mc/vault — the sixth surface, and the only one Mission Control owns.
 *
 * Every other connector mirrors somebody else's system, which is why writes to
 * them go through proposals. This one is local storage for a single user, so it
 * is directly writable: there is no other system to conflict with and no other
 * human to coordinate with.
 *
 * What it is for: the five surfaces can all answer "what is true right now".
 * None of them accumulates. `explain_blocked` re-derives the same answer from
 * scratch every time it is asked and throws it away, so the system can say
 * "MC-102 is blocked by MC-101" but never "this is the third sprint running".
 * The vault is where the second sentence becomes possible.
 *
 * Node-only — it touches the filesystem. The shell reaches it over HTTP, the
 * way every screen here reaches its data.
 */

export * from './frontmatter.js';
export * from './recall.js';
export * from './store.js';
