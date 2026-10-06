import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en.json';
import { AppProviders } from '../../test/render-app';
import { PushSection } from './PushSection';

vi.mock('../../platform/pushMessaging', () => ({
  pushMessaging: {
    isSupported: () => false,
    getToken: vi.fn(() => Promise.resolve(null)),
    onTokenRefresh: vi.fn(() => () => undefined),
  },
}));

describe('push section outside the Android app', () => {
  it('explains that push is unavailable and offers no registration form', () => {
    render(
      <AppProviders>
        <PushSection />
      </AppProviders>,
    );
    expect(screen.getByTestId('settings-push-unavailable')).toHaveTextContent(en.push.unavailable);
    expect(screen.getByTestId('settings-push-status')).toHaveAttribute(
      'data-state',
      'unregistered',
    );
    expect(screen.queryByTestId('settings-push-register')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-push-secret')).not.toBeInTheDocument();
  });
});
