import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConnectionNotices } from './ConnectionNotices';
import { AppProviders } from '../test/render-app';
import { useConnectionStore } from '../stores/connection';

function renderNotices() {
  return render(
    <AppProviders>
      <ConnectionNotices />
    </AppProviders>,
  );
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ versionWarning: null });
  });
});

describe('ConnectionNotices', () => {
  it('shows a non-blocking toast for a version warning and consumes it', async () => {
    renderNotices();
    act(() => {
      useConnectionStore.setState({
        versionWarning: { localFactoryProtocolVersion: '1.201.1', peerFactoryProtocolVersion: '1.244.0' },
      });
    });
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveTextContent(/Protocol mismatch/i);
    expect(toast).toHaveTextContent('1.244.0');
    expect(useConnectionStore.getState().versionWarning).toBeNull();
  });

  it('renders nothing without a warning', () => {
    renderNotices();
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });
});
