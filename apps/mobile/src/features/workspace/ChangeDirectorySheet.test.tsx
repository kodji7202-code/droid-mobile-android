import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { ChangeDirectorySheet } from './ChangeDirectorySheet';

const NOT_TRUSTED = Object.assign(new Error('Folder is not trusted: /ext/new'), { code: -32600 });

function setup(changeDirectory: ReturnType<typeof vi.fn>) {
  const connection = {
    validateDirectory: vi.fn(async (path: string) => ({ isValid: true, resolvedPath: path })),
    checkFolderTrust: vi.fn(async () => ({
      isTrusted: false,
      promptRequired: true,
      trustRootPath: '/ext/new',
    })),
    trustFolder: vi.fn(async () => undefined),
    changeDirectory,
  } as unknown as DaemonConnection;
  useConnectionStore.setState({ connection, status: 'ready' });
  const onChanged = vi.fn();
  const onClose = vi.fn();
  render(
    <AppProviders>
      <ChangeDirectorySheet
        open
        initialPath="/ext/new"
        sessionId="s1"
        onClose={onClose}
        onChanged={onChanged}
      />
    </AppProviders>,
  );
  return {
    connection: connection as unknown as Record<string, ReturnType<typeof vi.fn>>,
    onChanged,
    onClose,
  };
}

async function acceptTrust() {
  const user = userEvent.setup();
  const submit = screen.getByTestId('change-directory-submit');
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
  await user.click(await screen.findByRole('button', { name: /trust and switch/i }));
}

describe('ChangeDirectorySheet trust and switch (VAL-WS-006)', () => {
  beforeEach(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
  });

  it('retries once when the daemon still reports the folder as not trusted right after trusting', async () => {
    const changeDirectory = vi
      .fn()
      .mockRejectedValueOnce(NOT_TRUSTED)
      .mockResolvedValueOnce({ resolvedPath: '/ext/new' });
    const { connection, onChanged, onClose } = setup(changeDirectory);
    await acceptTrust();
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('/ext/new'));
    expect(connection.trustFolder).toHaveBeenCalledTimes(1);
    expect(changeDirectory).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByTestId('change-directory-error')).not.toBeInTheDocument();
  });

  it('stops after four attempts and keeps the error visible when trust never shows up', async () => {
    const changeDirectory = vi.fn().mockRejectedValue(NOT_TRUSTED);
    const { onChanged } = setup(changeDirectory);
    await acceptTrust();
    expect(
      await screen.findByTestId('change-directory-error', {}, { timeout: 4000 }),
    ).toHaveTextContent('not trusted');
    expect(changeDirectory).toHaveBeenCalledTimes(4);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('does not retry other errors after trusting', async () => {
    const changeDirectory = vi.fn().mockRejectedValue(new Error('Boom'));
    setup(changeDirectory);
    await acceptTrust();
    expect(await screen.findByTestId('change-directory-error')).toHaveTextContent('Boom');
    expect(changeDirectory).toHaveBeenCalledTimes(1);
  });
});
