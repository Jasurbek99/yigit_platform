import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import 'dayjs/locale/ru';
import './index.css';
import './i18n';
import App from './App';

// Sentry error tracking. DSN comes from VITE_SENTRY_DSN with the project DSN
// baked in as default; set VITE_SENTRY_DSN='' to disable.
// Only active in production builds — never reports from local dev (import.meta.env.PROD).
// EU (de) region keeps event data in the EU for our KZ/RU users.
const SENTRY_DSN =
  import.meta.env.VITE_SENTRY_DSN ??
  'https://dad83704bd8fb98b0a82a7089505765d@o4507190478438400.ingest.de.sentry.io/4511568418308176';

if (SENTRY_DSN && import.meta.env.PROD) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    // To disable sending user data, uncomment the line below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/react/configuration/options/#dataCollection
    // sendDefaultPii: false,
  });
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
