import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ro from './ro.json';
import { writePref } from '../platform/durablePrefs';

export const LANGUAGE_STORAGE_KEY = 'droidm.lang';
export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** Non-secret preference; safe for localStorage (WEB-KEY-RULE). */
export function readStoredLanguage(): AppLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'ro' ? 'ro' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Switches the app language instantly (react-i18next re-renders every screen)
 * and persists the choice. Also keeps the document language in sync for
 * accessibility.
 */
export function changeAppLanguage(language: AppLanguage): Promise<void> {
  void writePref(LANGUAGE_STORAGE_KEY, language);
  document.documentElement.lang = language;
  return i18next.changeLanguage(language).then(() => undefined);
}

// Resolves once i18next is initialized; inline resources need no async backend.
// Await this before the first render so no raw keys can flash.
export const i18nReady = i18next.use(initReactI18next).init({
  lng: readStoredLanguage(),
  fallbackLng: 'en',
  resources: {
    en: { translation: en },
    ro: { translation: ro },
  },
  interpolation: { escapeValue: false },
});

export default i18next;
