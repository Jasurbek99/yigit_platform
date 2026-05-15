import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import dayjs from 'dayjs';
import updateLocale from 'dayjs/plugin/updateLocale';
import 'dayjs/locale/ru';
import './index.css';
import './i18n';
import App from './App';

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
