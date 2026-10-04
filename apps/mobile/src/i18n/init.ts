import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ro from './ro.json';

// Resolves once i18next is initialized; inline resources need no async backend.
// Await this before the first render so no raw keys can flash.
export const i18nReady = i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    ro: { translation: ro },
  },
  interpolation: { escapeValue: false },
});

export default i18next;
