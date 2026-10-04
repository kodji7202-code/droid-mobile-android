import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { i18nReady } from './i18n/init';

describe('App', () => {
  it('renders the localized placeholder behind the app-root test id', async () => {
    await i18nReady;
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Droid Mobile' })).toBeInTheDocument();
    expect(screen.getByTestId('app-root')).toBeInTheDocument();
  });
});
