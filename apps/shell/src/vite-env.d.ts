/// <reference types="vite/client" />

/**
 * `VITE_MIRO_BOARD_ID` is gone, and so is the duplicate block that declared it.
 *
 * It was the board the Miro pane framed, and the pane went with the rest of the
 * pane app — nothing in `apps/shell/src` reads it. The gateway's own
 * `MIRO_ACCESS_TOKEN` and `MIRO_BOARD_ID` are untouched and still live:
 * `listConnectors` and the canvas poll both use them. Only the
 * browser half was dead.
 *
 * This file also declared `ImportMetaEnv` and `ImportMeta` twice. TypeScript
 * merges interfaces, so it compiled and nothing looked wrong — which is how a
 * second copy survives long enough to disagree with the first.
 */
interface ImportMetaEnv {
  /**
   * Where the gateway is. Unset means `http://localhost:8787` under `npm run
   * dev` and same-origin in a build — see `API` in `alerts/api.ts`.
   */
  readonly VITE_MC_GATEWAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
