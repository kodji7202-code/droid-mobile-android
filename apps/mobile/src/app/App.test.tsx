import { render, screen } from '@testing-library/react';
import { describe, expect, it, afterEach } from 'vitest';
import App from './App';
import { i18nReady } from '../i18n/init';

describe('App', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('mounts the localized app shell with navigation and connection status', async () => {
    await i18nReady;
    render(<App />);
    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Droid Mobile', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('connection-status')).toBeInTheDocument();
    expect(screen.getByTestId('nav-sessions')).toBeInTheDocument();
  });
});
