import { useTranslation } from 'react-i18next';

/**
 * Placeholder screen for the foundation scaffold. It only proves the toolchain
 * (Vite + React + i18n + tests); real features replace it starting with the app
 * shell (architecture.md section 3.2).
 */
export default function App() {
  const { t } = useTranslation();
  return (
    <main className="app-shell" data-testid="app-root">
      <h1>{t('app.title')}</h1>
      <p>{t('app.placeholder')}</p>
    </main>
  );
}
