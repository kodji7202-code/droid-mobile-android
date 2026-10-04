import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { stubMatchMedia } from '../test/match-media';

function ThemeProbe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <p data-testid="preference">{preference}</p>
      <p data-testid="resolved">{resolved}</p>
      <button type="button" data-testid="set-dark" onClick={() => setPreference('dark')} />
      <button type="button" data-testid="set-light" onClick={() => setPreference('light')} />
      <button type="button" data-testid="set-system" onClick={() => setPreference('system')} />
    </div>
  );
}

function renderThemeProbe() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

describe('ThemeProvider', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themePref;
  });

  it('defaults to system and reflects it on the document root', () => {
    renderThemeProbe();
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(document.documentElement.dataset.themePref).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
  });

  it('applies dark immediately and persists the choice', async () => {
    const user = userEvent.setup();
    renderThemeProbe();
    await user.click(screen.getByTestId('set-dark'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePref).toBe('dark');
    expect(window.localStorage.getItem('droidm.theme')).toBe('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('resolves system to dark when prefers-color-scheme is dark', async () => {
    const restore = stubMatchMedia(true);
    try {
      const user = userEvent.setup();
      renderThemeProbe();
      await user.click(screen.getByTestId('set-system'));
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    } finally {
      restore();
    }
  });

  it('restores a persisted preference on mount', () => {
    window.localStorage.setItem('droidm.theme', 'dark');
    renderThemeProbe();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
  });

  it('switching back to light removes the dark palette immediately', async () => {
    const user = userEvent.setup();
    renderThemeProbe();
    await user.click(screen.getByTestId('set-dark'));
    await user.click(screen.getByTestId('set-light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('droidm.theme')).toBe('light');
  });
});
