import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import 'dayjs/locale/ru';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import 'mantine-datatable/styles.css';
import './index.css';
import './i18n';
import App from './App';

// Suppress a known dev-mode warning from mantine-datatable v8.3.13 (latest):
// internal components are not wrapped in forwardRef but receive a ref from
// the table's Provider. The ref is silently dropped — table works fine —
// but React logs a noisy "Function components cannot be given refs" warning
// every render. Remove this filter once the library ships a fix.
if (import.meta.env.DEV) {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('Function components cannot be given refs')) {
      const fromMantineTable = args.some(
        (a) => typeof a === 'string' && a.includes('mantine-datatable'),
      );
      if (fromMantineTable) return;
    }
    originalError(...args);
  };
}

// Calendar week starts on Monday in Turkmenistan/CIS — make the AntD week picker
// and any other dayjs-driven UI render Mon as the first day.
dayjs.extend(updateLocale);
dayjs.updateLocale('en', { weekStart: 1 });
dayjs.updateLocale('ru', { weekStart: 1 });

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
