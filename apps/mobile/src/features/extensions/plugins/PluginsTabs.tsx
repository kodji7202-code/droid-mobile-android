import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

/** Switches between the plugin list and the marketplaces it comes from. */
export function PluginsTabs() {
  const { t } = useTranslation();
  return (
    <nav className="plugins-tabs" aria-label={t('plugins.tabsLabel')} data-testid="plugins-tabs">
      <NavLink
        to="/extensions/plugins"
        end
        className="plugins-tabs__tab"
        data-testid="plugins-tab-plugins"
      >
        {t('plugins.tabs.plugins')}
      </NavLink>
      <NavLink
        to="/extensions/plugins/marketplaces"
        className="plugins-tabs__tab"
        data-testid="plugins-tab-marketplaces"
      >
        {t('plugins.tabs.marketplaces')}
      </NavLink>
    </nav>
  );
}
