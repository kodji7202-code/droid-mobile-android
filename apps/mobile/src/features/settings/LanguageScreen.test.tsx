import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAppAt } from '../../test/render-app';
import i18next from '../../i18n/init';

describe('LanguageScreen', () => {
  afterEach(async () => {
    await i18next.changeLanguage('en');
    window.localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('switches to Romanian instantly, without reload, and persists', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/language');
    expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('settings-language-select'), 'ro');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Limbă' })).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('droidm.lang')).toBe('ro');
    expect(document.documentElement.lang).toBe('ro');
    await waitFor(() => {
      expect(screen.getByTestId('settings-language-select')).toHaveValue('ro');
    });
  });

  it('switches back to English', async () => {
    const user = userEvent.setup();
    renderAppAt('/settings/language');
    await user.selectOptions(screen.getByTestId('settings-language-select'), 'ro');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Limbă' })).toBeInTheDocument();
    });
    await user.selectOptions(screen.getByTestId('settings-language-select'), 'en');
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Language' })).toBeInTheDocument();
    });
    expect(window.localStorage.getItem('droidm.lang')).toBe('en');
  });

  it('preselects the persisted language on mount', async () => {
    window.localStorage.setItem('droidm.lang', 'ro');
    await i18next.changeLanguage('ro');
    renderAppAt('/settings/language');
    expect(screen.getByTestId('settings-language-select')).toHaveValue('ro');
    expect(screen.getByRole('heading', { name: 'Limbă' })).toBeInTheDocument();
  });
});
