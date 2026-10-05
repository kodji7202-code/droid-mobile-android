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
    const { onCreated } = renderSheet(connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    expect(await screen.findByTestId('session-new-trust')).toHaveTextContent('C:\\w');
    expect(trustFolder).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('session-new-create'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(trustFolder).toHaveBeenCalledWith('C:\\w');
    expect(trustFolder.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('shows the daemon default instead of loading forever when defaults omit modelId', async () => {
    const fake = fakeConnection();
    (fake.connection.getDefaultSettings as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderSheet(fake.connection);

    await screen.findByText('Default model: daemon default');
    expect(screen.queryByText(/loading/)).not.toBeInTheDocument();
  });

  it('never creates or navigates when dismissed during the pending trust call', async () => {
    const fake = fakeConnection({
      isTrusted: false,
      trustRootPath: 'C:\\w',
      promptRequired: true,
    });
    let finishTrust: () => void = () => undefined;
    fake.trustFolder.mockImplementation(
      () => new Promise<undefined>((resolve) => (finishTrust = () => resolve(undefined))),
    );
    const { onCreated, onClose } = renderSheet(fake.connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    await user.click(screen.getByTestId('session-new-create'));
    await waitFor(() => expect(fake.trustFolder).toHaveBeenCalled());
    await user.click(screen.getByTestId('session-new-sheet-close'));
    expect(onClose).toHaveBeenCalled();

    finishTrust();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.createSession).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('closes a handle that arrives after dismissal without navigating', async () => {
    const fake = fakeConnection();
    const close = vi.fn(async () => undefined);
    let finishCreate: (handle: unknown) => void = () => undefined;
    fake.createSession.mockImplementation(
      () => new Promise((resolve) => (finishCreate = resolve)) as never,
    );
    const { onCreated } = renderSheet(fake.connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    await user.click(screen.getByTestId('session-new-create'));
    await waitFor(() => expect(fake.createSession).toHaveBeenCalled());
    await user.click(screen.getByTestId('session-new-sheet-close'));

    finishCreate({ id: 'late', close });
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does not offer a worktree folder until the worktree option is on', async () => {
    const { connection } = fakeConnection();
    renderSheet(connection);
    const user = userEvent.setup();

    const toggle = screen.getByTestId('session-new-worktree');
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId('session-new-worktree-dir')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(screen.getByTestId('session-new-worktree-dir')).toBeInTheDocument();
    expect(screen.getByTestId('session-new-worktree-help')).toHaveTextContent(
      'git worktree remove',
    );
  });

  it('creates a worktree session with the optional worktree folder', async () => {
    const { connection, createSession } = fakeConnection();
    const { onCreated } = renderSheet(connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await user.click(screen.getByTestId('session-new-worktree'));
    await user.type(screen.getByTestId('session-new-worktree-dir'), ' C:\\w\\trees ');
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    await user.click(screen.getByTestId('session-new-create'));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createSession).toHaveBeenCalledWith({
      cwd: 'C:\\w',
      worktree: true,
      worktreeDir: 'C:\\w\\trees',
    });
  });

  it('omits worktreeDir when the folder is blank and the flag when the option is off', async () => {
    const { connection, createSession } = fakeConnection();
    renderSheet(connection);
    const user = userEvent.setup();

    await user.click(screen.getByTestId('session-new-suggestion-0'));
    await user.click(screen.getByTestId('session-new-worktree'));
    await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
    await user.click(screen.getByTestId('session-new-create'));
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenLastCalledWith({ cwd: 'C:\\w', worktree: true });
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
