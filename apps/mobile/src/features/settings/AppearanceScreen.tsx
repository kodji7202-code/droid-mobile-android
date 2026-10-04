import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeProvider';
import type { ThemePreference } from '../../theme/ThemeProvider';
import { SettingsSubHeader } from './SettingsSubHeader';

const THEME_OPTIONS: ThemePreference[] = ['light', 'dark', 'system'];

/**
 * Settings > Appearance (stub): light/dark/system theme chooser. Applies
 * immediately via ThemeProvider (CSS variables, no reload) and persists in
 * localStorage (non-secret setting).
 */
export function AppearanceScreen() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();

  return (
    <section className="screen" data-testid="appearance-screen" aria-labelledby="appearance-title">
      <SettingsSubHeader title={t('settings.appearance')} />
      <div className="field">
        <label className="field__label" htmlFor="settings-theme">
          {t('settings.theme')}
        </label>
        <select
          id="settings-theme"
          className="field__control"
          data-testid="settings-theme-select"
          value={preference}
          onChange={(event) => setPreference(event.target.value as ThemePreference)}
        >
          {THEME_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {t(`settings.theme${option.charAt(0).toUpperCase()}${option.slice(1)}`)}
            </option>
          ))}
        </select>
        <p className="field__description">{t('settings.appearanceDescription')}</p>
      </div>
    </section>
  );
}
