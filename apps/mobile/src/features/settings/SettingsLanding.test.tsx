import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { stubMatchMedia } from '../../test/match-media';
import { useConnectionStore } from '../../stores/connection';
import { changeAppLanguage } from '../../i18n/init';

const SECTIONS = [
  { rowTestId: 'settings-connection', pageTestId: 'connection-screen', name: 'Connection' },
  { rowTestId: 'settings-security', pageTestId: 'security-screen', name: 'Security' },
  {
    rowTestId: 'settings-notifications',
    pageTestId: 'notifications-screen',
    name: 'Notifications',
  },
  { rowTestId: 'settings-appearance', pageTestId: 'appearance-screen', name: 'Appearance' },
  { rowTestId: 'settings-language', pageTestId: 'language-screen', name: 'Language' },
  { rowTestId: 'settings-defaults', pageTestId: 'defaults-screen', name: 'Defaults' },
  { rowTestId: 'settings-about', pageTestId: 'about-screen', name: 'About & diagnostics' },
];

// Just enough of a connection for every page to mount; the pages' own tests cover their data.
const connection = {
  url: 'ws://127.0.0.1:3101',
  getDefaultSettings: async () => ({}),
  listModels: async () => [],
  getDaemonIdentity: async () => ({ userId: 'u', orgId: 'o' }),
} as unknown as DaemonConnection;

afterEach(async () => {
  window.localStorage.clear();
  await act(async () => {
    await changeAppLanguage('en');
  });
  act(() => {
    useConnectionStore.setState({ status: 'offline' });
  });
});

describe('Settings landing (phone)', () => {
  it('lists exactly the seven sections in order as links', () => {
    renderAppAt('/settings');
    const list = within(screen.getByRole('navigation', { name: 'Settings' }));
    const links = list.getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(SECTIONS.map((section) => section.name));
    expect(links.map((link) => link.getAttribute('data-testid'))).toEqual(
      SECTIONS.map((section) => section.rowTestId),
    );
  });

  it.each(SECTIONS)('opens $name and the back control returns to the landing', async (section) => {
    const user = userEvent.setup();
    renderAppAt('/settings', { connection });
    await user.click(screen.getByTestId(section.rowTestId));
    expect(screen.queryByTestId('settings-screen')).not.toBeInTheDocument();
    expect(await screen.findByTestId(section.pageTestId)).toBeInTheDocument();
    await user.click(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('settings-screen')).toBeInTheDocument();
    expect(screen.queryByTestId(section.pageTestId)).not.toBeInTheDocument();
  });

  it('shows localized notifications content that says the toggles need notifications', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/notifications');
    expect(screen.getByTestId('notifications-unavailable')).toHaveTextContent(
      'available when notifications are enabled',
    );
    await act(async () => {
      await changeAppLanguage('ro');
    });
    expect(screen.getByTestId('notifications-unavailable')).toHaveTextContent(
      'disponibile când notificările sunt activate',
    );
    await user.click(screen.getByTestId('settings-back'));
    expect(screen.getByTestId('settings-notifications')).toHaveTextContent('Notificări');
  });
});

describe('Settings landing (tablet)', () => {
  it('keeps the list beside the open page, marks the open row and hides the back control', async () => {
    const restore = stubMatchMedia(true);
    try {
      const user = userEvent.setup();
      renderAppAt('/settings');
      expect(screen.getByTestId('settings-layout')).toBeInTheDocument();
      expect(screen.getByTestId('settings-select-section')).toBeInTheDocument();
      await user.click(screen.getByTestId('settings-appearance'));
      expect(screen.getByTestId('settings-screen')).toBeInTheDocument();
      expect(screen.getByTestId('appearance-screen')).toBeInTheDocument();
      expect(screen.getByTestId('settings-appearance')).toHaveAttribute('aria-current', 'page');
      expect(screen.getByTestId('settings-language')).not.toHaveAttribute('aria-current');
      expect(screen.queryByTestId('settings-back')).not.toBeInTheDocument();
      expect(screen.queryByTestId('settings-select-section')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('settings-language'));
      expect(screen.getByTestId('language-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('appearance-screen')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
