import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAppAt } from '../test/render-app';
import { stubMatchMedia } from '../test/match-media';
import { useConnectionStore } from '../stores/connection';
import { useInteractionStore } from '../stores/interactions';

const NAV_TEST_IDS = ['nav-sessions', 'nav-workspace', 'nav-extensions', 'nav-settings'];

const DESTINATIONS: Array<{ navTestId: string; screenTestId: string }> = [
  { navTestId: 'nav-sessions', screenTestId: 'sessions-screen' },
  { navTestId: 'nav-workspace', screenTestId: 'workspace-screen' },
  { navTestId: 'nav-extensions', screenTestId: 'extensions-screen' },
  { navTestId: 'nav-settings', screenTestId: 'settings-screen' },
];

describe('AppShell (phone width)', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders the four primary destinations with a bottom navigation bar', () => {
    renderAppAt('/sessions');
    for (const testId of NAV_TEST_IDS) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }
    expect(screen.getByTestId('nav-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-rail')).not.toBeInTheDocument();
  });

  it('keeps the connection-status indicator visible on every destination', async () => {
    const user = userEvent.setup();
    renderAppAt('/sessions');
    for (const { navTestId, screenTestId } of DESTINATIONS) {
      await user.click(screen.getByTestId(navTestId));
      expect(screen.getByTestId(screenTestId)).toBeInTheDocument();
      expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    }
  });

  it('marks the active destination with aria-current and styled state', async () => {
    const user = userEvent.setup();
    renderAppAt('/sessions');
    const workspaceTab = screen.getByTestId('nav-workspace');
    expect(workspaceTab).not.toHaveAttribute('aria-current', 'page');
    await user.click(workspaceTab);
    expect(screen.getByTestId('nav-workspace')).toHaveAttribute('aria-current', 'page');
  });

  it('redirects the index route to the Sessions destination', () => {
    renderAppAt('/');
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
  });

  it('shows a localized not-found state for unknown routes', () => {
    renderAppAt('/does-not-exist');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
  });

  it('keeps the shell usable with an explanatory banner and retry control when not ready', () => {
    useConnectionStore.setState({ status: 'offline', lastErrorKind: 'connection' });
    renderAppAt('/sessions');
    expect(screen.getByTestId('sessions-screen')).toBeInTheDocument();
    expect(screen.getByTestId('connection-banner')).toHaveAttribute('data-status', 'offline');
    expect(screen.getByTestId('connection-retry')).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toHaveAttribute('data-status', 'offline');
  });

  it('hides the banner while ready', () => {
    useConnectionStore.setState({ status: 'ready' });
    renderAppAt('/settings');
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('settings-about')).toBeInTheDocument();
  });
});

describe('AppShell (>= 840 px width)', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('renders the navigation rail instead of the bottom bar', () => {
    const restore = stubMatchMedia(true);
    try {
      renderAppAt('/settings');
      expect(screen.getByTestId('nav-rail')).toBeInTheDocument();
      expect(screen.queryByTestId('nav-bar')).not.toBeInTheDocument();
      for (const testId of NAV_TEST_IDS) {
        expect(within(screen.getByTestId('nav-rail')).getByTestId(testId)).toBeInTheDocument();
      }
    } finally {
      restore();
    }
  });
});

describe('AppShell while a request dialog is open', () => {
  afterEach(() => {
    useInteractionStore.getState().reset();
  });

  it('makes the shell navigation inert only for the session that has the dialog', () => {
    renderAppAt('/sessions/s1');
    expect(screen.getByTestId('nav-bar').closest('[inert]')).toBeNull();
    act(() => {
      void useInteractionStore.getState().requestPermission('s1', {
        toolUses: [],
        options: [],
      } as never);
    });
    expect(screen.getByTestId('nav-bar').closest('[inert]')).not.toBeNull();
    expect(screen.getByTestId('connection-status').closest('[inert]')).not.toBeNull();
  });

  it('keeps the shell usable when the pending request belongs to another session', () => {
    renderAppAt('/sessions/s2');
    act(() => {
      void useInteractionStore.getState().requestPermission('s1', {
        toolUses: [],
        options: [],
      } as never);
    });
    expect(screen.getByTestId('nav-bar').closest('[inert]')).toBeNull();
  });
});
