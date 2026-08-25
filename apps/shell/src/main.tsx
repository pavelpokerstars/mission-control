import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AlertApp from './alerts/AlertApp';

/**
 * One stylesheet, one design system.
 *
 * Mantine and `styles.css` are gone from the bundle. They were the pane app's,
 * and the pane app was mounted at `#/panes` for one reason: the record views
 * lived there and a citation had to land somewhere. Citations now open records
 * directly (`RecordView`), so the route was the last thing holding a second
 * component library, a second reset and a second set of colour tokens in a page
 * that renders none of them.
 *
 * `app.css` is `docs/design-preview.html`'s stylesheet, copied verbatim. A design
 * change belongs in the preview first and here second.
 */
import './app.css';

const el = document.getElementById('root');
if (!el) throw new Error('missing #root');
createRoot(el).render(
  <StrictMode>
    <AlertApp />
  </StrictMode>,
);
