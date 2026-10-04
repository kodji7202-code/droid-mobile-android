import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { stubMatchMedia } from '../../test/match-media';
import { renderAppAt } from '../../test/render-app';

describe('AppearanceScreen', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themePref;
  });

  it('applies the dark palette immediately when Dark is selected, without reload', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/appearance');
    const select = screen.getByTestId('settings-theme-select');
    expect(select).toHaveValue('system');
    await user.selectOptions(select, 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('droidm.theme')).toBe('dark');
    await user.selectOptions(select, 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('droidm.theme')).toBe('light');
  });

  it('follows prefers-color-scheme when System is selected', async () => {
    const restore = stubMatchMedia(true);
    try {
      const user = userEvent.setup();
      renderAppAt('/settings/appearance');
      await user.selectOptions(screen.getByTestId('settings-theme-select'), 'system');
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally {
      restore();
    }
  });

  it('offers every theme choice with localized labels', () => {
    renderAppAt('/settings/appearance');
    const select = screen.getByTestId('settings-theme-select');
    const options = Array.from(select.querySelectorAll('option')).map((option) => option.value);
    expect(options).toEqual(['light', 'dark', 'system']);
    expect(screen.getByRole('option', { name: 'Dark' })).toBeInTheDocument();
  });
});
