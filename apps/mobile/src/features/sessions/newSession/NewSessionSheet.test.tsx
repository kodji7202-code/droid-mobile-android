import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../../test/render-app';
import { NewSessionSheet } from './NewSessionSheet';

interface Trust {
  isTrusted: boolean;
  trustRootPath: string;
  promptRequired: boolean;
}

function fakeConnection(
  trust: Trust = { isTrusted: true, trustRootPath: 'C:\\w', promptRequired: false },
) {
  const validateDirectory = vi.fn(async (path: string) => {
    if (path === 'C:\\missing') return { isValid: false, error: 'Directory not found' };
    if (path === 'C:\\w\\notes.txt') return { isValid: false, error: 'Path is not a directory' };
    return { isValid: true, resolvedPath: path };
  });
  const checkFolderTrust = vi.fn(async () => trust);
  const trustFolder = vi.fn(async () => undefined);
  const createSession = vi.fn(async () => ({ id: 'new-1' }));
  const getDefaultSettings = vi.fn(async () => ({ modelId: 'model-x' }));
  const connection = {
    validateDirectory,
    checkFolderTrust,
    trustFolder,
    createSession,
    getDefaultSettings,
  } as unknown as DaemonConnection;
  return { connection, validateDirectory, checkFolderTrust, trustFolder, createSession };
}

function renderSheet(connection: DaemonConnection) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <AppProviders>
      <NewSessionSheet
        connection={connection}
        suggestions={['C:\\w']}
        onCreated={onCreated}
        onClose={onClose}
      />
    </AppProviders>,
  );
  return { onCreated, onClose };
}

describe('NewSessionSheet', () => {
  it('shows the daemon error text and keeps create disabled for invalid directories', async () => {
    const { connection } = fakeConnection();
    renderSheet(connection);
    const user = userEvent.setup();
    expect(screen.getByTestId('session-new-create')).toBeDisabled();
    await screen.findByText('Default model: model-x');

    await user.type(screen.getByTestId('session-new-cwd'), 'C:\\missing');
    expect(await screen.findByTestId('session-new-error')).toHaveTextContent('Directory not found');
    expect(screen.getByTestId('session-new-create')).toBeDisabled();

    await user.clear(screen.getByTestId('session-new-cwd'));
    await user.type(screen.getByTestId('session-new-cwd'), 'C:\\w\\notes.txt');
    await waitFor(() =>
      expect(screen.getByTestId('session-new-error')).toHaveTextContent('Path is not a directory'),
    );
    expect(screen.getByTestId('session-new-create')).toBeDisabled();
  });

  it('creates a session in a valid trusted directory without trusting it again', async () => {
    const { connection, trustFolder, createSession } = fakeConnection();
    const { onCreated } = renderSheet(connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    expect(screen.queryByTestId('session-new-trust')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('session-new-create'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-1' }));
    expect(createSession).toHaveBeenCalledWith({ cwd: 'C:\\w' });
    expect(trustFolder).not.toHaveBeenCalled();
  });

  it('asks for trust first and trusts only when the user confirms', async () => {
    const { connection, trustFolder, createSession } = fakeConnection({
      isTrusted: false,
      trustRootPath: 'C:\\w',
      promptRequired: true,
    });
    const { onCreated, onClose } = renderSheet(connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    expect(await screen.findByTestId('session-new-trust')).toHaveTextContent('C:\\w');
    expect(trustFolder).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('session-new-sheet-close'));
    expect(onClose).toHaveBeenCalled();
    expect(trustFolder).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('session-new-create'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(trustFolder).toHaveBeenCalledWith('C:\\w');
    expect(trustFolder.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('reports a failed creation inline and stays usable', async () => {
    const fake = fakeConnection();
    fake.createSession.mockRejectedValueOnce(new Error('boom'));
    const { onCreated } = renderSheet(fake.connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    await user.click(screen.getByTestId('session-new-create'));

    expect(await screen.findByTestId('session-new-create-error')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
  });
});
