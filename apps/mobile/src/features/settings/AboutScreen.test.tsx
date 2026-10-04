import { act, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus, DaemonConnection, DaemonIdentity } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { version as packageVersion } from '../../../package.json';

function renderAbout(connection: Partial<DaemonConnection>, status: ConnectionStatus) {
  useConnectionStore.setState({ status });
  return renderAppAt('/settings/about', { connection: connection as DaemonConnection });
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });
});

describe('AboutScreen', () => {
  it('shows the app version from package.json and the SDK version', () => {
    renderAbout({}, 'offline');
    expect(screen.getByTestId('about-app-version')).toHaveTextContent(packageVersion);
    expect(screen.getByTestId('about-sdk-version')).toHaveTextContent('0.9.1');
  });

  it('reads the daemon protocol version on demand while ready', async () => {
    const getDaemonIdentity = vi.fn(
      async (): Promise<DaemonIdentity> => ({
        userId: 'user-1',
        orgId: 'org-1',
        daemonProtocolVersion: '1.244.0',
      }),
    );
    renderAbout({ getDaemonIdentity } as Partial<DaemonConnection>, 'ready');
    await waitFor(() => expect(screen.getByTestId('about-protocol-version')).toHaveTextContent('1.244.0'));
    expect(getDaemonIdentity).toHaveBeenCalledTimes(1);
  });

  it('does not probe the daemon while not ready and shows Unknown', () => {
    const getDaemonIdentity = vi.fn();
    renderAbout({ getDaemonIdentity } as Partial<DaemonConnection>, 'offline');
    expect(getDaemonIdentity).not.toHaveBeenCalled();
    expect(screen.getByTestId('about-protocol-version')).toHaveTextContent('Unknown');
  });

  it('shows Unknown when the identity probe fails, without breaking the page', async () => {
    const getDaemonIdentity = vi.fn(async () => {
      throw new Error('unreachable');
    });
    renderAbout({ getDaemonIdentity } as Partial<DaemonConnection>, 'ready');
    await waitFor(() => expect(getDaemonIdentity).toHaveBeenCalled());
    expect(screen.getByTestId('about-protocol-version')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('about-app-version')).toHaveTextContent(packageVersion);
  });
});
