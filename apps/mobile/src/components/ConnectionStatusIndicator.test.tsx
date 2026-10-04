import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ConnectionStatus } from '@droidmobile/daemon-client';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import { useConnectionStore } from '../stores/connection';

const ALL_STATUSES: ConnectionStatus[] = [
  'connecting',
  'authenticating',
  'ready',
  'reconnecting',
  'offline',
  'error',
];

describe('ConnectionStatusIndicator', () => {
  it('indicates ready in the data attribute, visible text and accessible name', () => {
    useConnectionStore.setState({ status: 'ready' });
    render(<ConnectionStatusIndicator />);
    const indicator = screen.getByTestId('connection-status');
    expect(indicator).toHaveAttribute('data-status', 'ready');
    expect(indicator).toHaveTextContent('Connected');
    expect(indicator).toHaveAccessibleName(/connected/i);
  });

  it.each(ALL_STATUSES)('renders the %s state from the daemon-client status', (status) => {
    useConnectionStore.setState({ status });
    render(<ConnectionStatusIndicator />);
    const indicator = screen.getByTestId('connection-status');
    expect(indicator).toHaveAttribute('data-status', status);
    expect(indicator).toHaveAccessibleName(/.+/);
  });
});
