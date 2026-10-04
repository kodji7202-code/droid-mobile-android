import { useTranslation } from 'react-i18next';
import { changeAppLanguage, SUPPORTED_LANGUAGES } from '../../i18n/init';
import type { AppLanguage } from '../../i18n/init';
import { SettingsSubHeader } from './SettingsSubHeader';

const LANGUAGE_LABEL_KEYS: Record<AppLanguage, string> = {
  en: 'language.english',
  ro: 'language.romanian',
};

/**
 * Settings > Language (stub): English/Romanian chooser. Switching is instant
 * (react-i18next re-renders every screen, no reload) and persists in
 * localStorage (non-secret setting).
 */
export function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const current = i18n.language.startsWith('ro') ? 'ro' : 'en';

  return (
    <section className="screen" data-testid="language-screen" aria-labelledby="language-title">
      <SettingsSubHeader title={t('settings.language')} />
      <div className="field">
        <label className="field__label" htmlFor="settings-language">
          {t('settings.language')}
        </label>
        <select
          id="settings-language"
          className="field__control"
          data-testid="settings-language-select"
          value={current}
          onChange={(event) => {
            void changeAppLanguage(event.target.value as AppLanguage);
          }}
        >
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {t(LANGUAGE_LABEL_KEYS[language])}
            </option>
          ))}
        </select>
        <p className="field__description">{t('settings.languageDescription')}</p>
      </div>
    </section>
  );
}
