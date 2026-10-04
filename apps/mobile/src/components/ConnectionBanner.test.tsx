import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionBanner } from './ConnectionBanner';
import { AppProviders } from '../test/render-app';
import { useConnectionStore } from '../stores/connection';

function renderBanner() {
  return render(
    <AppProviders>
      <ConnectionBanner />
    </AppProviders>,
  );
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ status: 'offline', lastErrorKind: null });
  });
});

describe('ConnectionBanner', () => {
  it('is hidden while the connection is ready', () => {
    useConnectionStore.setState({ status: 'ready' });
    renderBanner();
    expect(screen.queryByTestId('connection-banner')).not.toBeInTheDocument();
  });

  it('explains an offline connection and offers the manual retry control', () => {
    useConnectionStore.setState({ status: 'offline' });
    renderBanner();
    const banner = screen.getByTestId('connection-banner');
    expect(banner).toHaveAttribute('data-status', 'offline');
    expect(banner).toHaveTextContent(/No connection to the daemon/i);
    expect(screen.getByTestId('connection-retry')).toHaveAccessibleName('Retry now');
  });

  it('explains a reconnect in progress', () => {
    useConnectionStore.setState({ status: 'reconnecting' });
    renderBanner();
    expect(screen.getByTestId('connection-banner')).toHaveTextContent(/Reconnecting automatically/i);
  });

  it('points a rejected key to the Connect screen instead of a transport message', () => {
    useConnectionStore.setState({ status: 'error', lastErrorKind: 'auth' });
    renderBanner();
    expect(screen.getByTestId('connection-banner')).toHaveTextContent(/rejected the saved API key/i);
  });

  it('calls the manual retry action', async () => {
    const retry = vi.fn();
    useConnectionStore.setState({ status: 'offline', retry });
    const user = userEvent.setup();
    renderBanner();
    await user.click(screen.getByTestId('connection-retry'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
