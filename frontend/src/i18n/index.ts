import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import tk from './tk.json';
import ru from './ru.json';
import en from './en.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      tk: { translation: tk },
      ru: { translation: ru },
      en: { translation: en },
    },
    fallbackLng: 'tk',
    supportedLngs: ['tk', 'ru', 'en'],
    detection: {
      // Cookie has no max-age/expires so it is session-scoped.
      // On shared warehouse devices the next user starts with a clean session.
      order: ['cookie', 'navigator'],
      caches: ['cookie'],
      lookupCookie: 'ygt_lang',
      cookieOptions: { path: '/', sameSite: 'lax' },
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
