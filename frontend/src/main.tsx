import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import 'mantine-datatable/styles.css';
import './index.css';
import './i18n';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Clean up orphaned Mantine modal/overlay backdrops on Vite HMR.
// Mantine renders Modal portals (overlay + content) directly into document.body
// via nodes marked with data-portal="true". It also sets overflow:hidden on
// <body> to lock scroll while a modal is open. When HMR replaces a component
// that had a Modal mounted, React unmount callbacks don't fire — so the portal
// DOM and the scroll lock survive, leaving the page grayed out and unclickable.
if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    // Remove all Mantine portal nodes (overlay backdrops, modal content, etc.)
    document
      .querySelectorAll('[data-portal], [data-mantine-portal]')
      .forEach((el) => el.remove());
    // Reset body scroll lock that Mantine's useLockScroll sets
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  });
}
