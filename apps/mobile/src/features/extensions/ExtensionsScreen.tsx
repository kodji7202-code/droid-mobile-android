import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRightIcon } from '../../components/icons';

interface ExtensionSection {
  to: string;
  testId: string;
  titleKey: string;
  descriptionKey: string;
}

const SECTIONS: readonly ExtensionSection[] = [
  {
    to: '/extensions/mcp',
    testId: 'extensions-mcp',
    titleKey: 'extensions.mcp.title',
    descriptionKey: 'extensions.mcp.description',
  },
];

/** Extensions hub: one full-width entry per section (>= 48 dp touch targets). */
export function ExtensionsScreen() {
  const { t } = useTranslation();
  return (
    <section className="screen" data-testid="extensions-screen" aria-labelledby="extensions-title">
      <h2 className="screen__title" id="extensions-title">
        {t('nav.extensions')}
      </h2>
      <nav aria-label={t('nav.extensions')}>
        <ul className="settings-list">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <Link to={section.to} className="settings-row" data-testid={section.testId}>
                <span className="extensions-row__text">
                  <span>{t(section.titleKey)}</span>
                  <span className="field__description">{t(section.descriptionKey)}</span>
                </span>
                <ChevronRightIcon className="settings-row__chevron" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </section>
  );
}
