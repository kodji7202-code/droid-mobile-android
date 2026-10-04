import { render, screen } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import App from './App';
import { i18nReady } from '../i18n/init';
import { useConnectionStore } from '../stores/connection';

describe('App', () => {
  afterEach(() => {
    window.location.hash = '';
    window.localStorage.clear();
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('opens on the connect screen without a connection, with no navigation', async () => {
    await i18nReady;
    render(<App />);
    expect(screen.getByTestId('connect-url-input')).toBeInTheDocument();
    expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nav-sessions')).not.toBeInTheDocument();
  });

  it('mounts the localized app shell with navigation and connection status', async () => {
    await i18nReady;
    useConnectionStore.setState({ connection: {} as DaemonConnection });
    render(<App />);
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Droid Mobile', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    expect(screen.getByTestId('nav-sessions')).toBeInTheDocument();
  });
});
