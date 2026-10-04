import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { ComponentType, SVGProps } from 'react';
import { ExtensionsIcon, SessionsIcon, SettingsIcon, WorkspaceIcon } from './icons';

export interface NavItemDefinition {
  to: string;
  testId: string;
  labelKey: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const NAV_ITEMS: NavItemDefinition[] = [
  { to: '/sessions', testId: 'nav-sessions', labelKey: 'nav.sessions', icon: SessionsIcon },
  { to: '/workspace', testId: 'nav-workspace', labelKey: 'nav.workspace', icon: WorkspaceIcon },
  { to: '/extensions', testId: 'nav-extensions', labelKey: 'nav.extensions', icon: ExtensionsIcon },
  { to: '/settings', testId: 'nav-settings', labelKey: 'nav.settings', icon: SettingsIcon },
];

function NavItem({ item }: { item: NavItemDefinition }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      data-testid={item.testId}
      className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
    >
      <Icon className="nav-item__icon" />
      <span className="nav-item__label">{t(item.labelKey)}</span>
    </NavLink>
  );
}

/**
 * Phone layout: fixed bottom navigation bar with the four primary
 * destinations (>= 48 dp touch targets, see architecture.md section 5).
 */
export function NavigationBar() {
  const { t } = useTranslation();
  return (
    <nav className="app-nav-bar" data-testid="nav-bar" aria-label={t('nav.label')}>
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
    </nav>
  );
}

/**
 * Tablet layout (>= 840 px): navigation rail on the leading edge with the
 * same four destinations.
 */
export function NavigationRail() {
  const { t } = useTranslation();
  return (
    <nav className="app-nav-rail" data-testid="nav-rail" aria-label={t('nav.label')}>
      {NAV_ITEMS.map((item) => (
        <NavItem key={item.to} item={item} />
      ))}
    </nav>
  );
}
