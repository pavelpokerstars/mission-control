import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * The two typefaces first, then the design system.
 *
 * `fonts.css` must come first: `app.css`'s `--sans` and `--mono` NAME these two
 * families, and with nothing declaring them the browser fell silently through
 * to `ui-sans-serif` and `ui-monospace` — every measurement matching the
 * preview and the wrong typeface on screen. See the header of that file.
 *
 * ONE DESIGN SYSTEM, SEVENTEEN FILES, AND THE ORDER OF THESE FOUR LINES IS THE
 * CONTRACT. `app.css` holds the tokens, the reset and the breakpoint;
 * `alerts/shared.css` holds what more than one screen draws; each component is a
 * folder holding its `.tsx` and the `.css` it imports from beside it.
 *
 * **THE CSS IMPORTS MUST STAND ABOVE `AlertApp`, and an import sorter that
 * moves them below inverts the whole cascade.** CSS is emitted in
 * module-*evaluation* order, which is depth-first: with `import AlertApp`
 * first, every component stylesheet in its subtree arrives BEFORE these three,
 * so `shared.css` lands last and beats the component files it is supposed to
 * lose to. Measured: `.appwin` at byte 0 of the stylesheet and the tokens at
 * 26056. **The dev server does exactly the same** — Vite evaluates the ESM
 * graph depth-first too — so this is visible in a browser either way, which is
 * why `verify-design.mts` asserts these four lines rather than trusting them.
 *
 * So every component file loads after `shared.css` and can override it at equal
 * specificity, and none of them can be reordered into a different result — no
 * component file may claim a scoping class another one claims, which is what
 * `verify-design.mts` asserts.
 *
 * Mantine and `styles.css` are gone from the bundle. They were the pane app's,
 * and the pane app was mounted at a route of its own for one reason: the record
 * views lived there and a citation had to land somewhere. Citations now open
 * records directly (`RecordView`), so the route was the last thing holding a
 * second component library, a second reset and a second set of colour tokens in
 * a page that renders none of them.
 *
 * Every rule in all seventeen is `docs/design-preview.html`'s, copied verbatim.
 * A design change belongs in the preview first and here second.
 */
import './fonts.css';
import './app.css';
import './alerts/shared.css';

import AlertApp from './alerts/AlertApp/AlertApp';
/**
 * THE DEMO IMPORT IS LAST, AND IT IS NOT A FOURTH LAYER.
 *
 * `demo/demo.css` arrives through this component rather than as a line beside
 * the three above, and both halves of that are deliberate. It is not one of the
 * seventeen `verify-design.mts` checks against the preview — a welcome card and
 * a strip of tips are not in the design and must not be added to it — so it
 * must not sit in the layer list that check reads. And last in evaluation order
 * means its rules are emitted after every component stylesheet, so nothing the
 * app draws can win against the strip by accident. Its classes are all
 * `mcdemo-` prefixed as well; the order is the belt and the prefix is the
 * braces.
 *
 * With `MC_DEMO` unset this renders `<AlertApp />` and nothing else. That is
 * the whole of the contract: demo mode is a wrapper around the product, never a
 * change to it.
 */
import { DemoShell } from './demo/DemoShell';

const el = document.getElementById('root');
if (!el) throw new Error('missing #root');
createRoot(el).render(
  <StrictMode>
    <DemoShell>
      <AlertApp />
    </DemoShell>
  </StrictMode>,
);
