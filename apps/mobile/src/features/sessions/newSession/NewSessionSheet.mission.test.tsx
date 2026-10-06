import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../../test/render-app';
import { dismissTopOverlay } from '../../../components/backDismiss';
import { NewSessionSheet } from './NewSessionSheet';

function fakeConnection(defaults: Record<string, unknown> = { modelId: 'model-x' }) {
  const createSession = vi.fn(async () => ({ id: 'new-1' }));
  const connection = {
    validateDirectory: vi.fn(async (path: string) => ({ isValid: true, resolvedPath: path })),
    checkFolderTrust: vi.fn(async () => ({
      isTrusted: true,
      trustRootPath: 'C:\\w',
      promptRequired: false,
    })),
    trustFolder: vi.fn(async () => undefined),
    createSession,
    getDefaultSettings: vi.fn(async () => defaults),
  } as unknown as DaemonConnection;
  return { connection, createSession };
}

async function renderReady(connection: DaemonConnection) {
  const onCreated = vi.fn();
  render(
    <AppProviders>
      <NewSessionSheet
        connection={connection}
        suggestions={['C:\\w']}
        onCreated={onCreated}
        onClose={vi.fn()}
      />
    </AppProviders>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByTestId('session-new-suggestion-0'));
  await waitFor(() => expect(screen.getByTestId('session-new-create')).toBeEnabled());
  return { user, onCreated };
}

describe('NewSessionSheet mission mode', () => {
  it('offers Normal, Spec and Mission with a cost description for Mission', async () => {
    const { connection } = fakeConnection();
    await renderReady(connection);

    const group = screen.getByTestId('session-new-mode');
    expect(group).toHaveTextContent('Normal');
    expect(group).toHaveTextContent('Spec');
    expect(group).toHaveTextContent('Mission');
    expect(screen.getByTestId('session-new-mode-auto')).toBeChecked();
    expect(screen.getByTestId('session-new-mode-mission-desc')).toHaveTextContent(
      /multiple workers.*substantial credits/i,
    );
    expect(screen.queryByTestId('session-new-mission-hint')).not.toBeInTheDocument();
  });

  it('recommends High autonomy for Mission without changing the selected level', async () => {
    const { connection } = fakeConnection({ modelId: 'model-x', autonomyLevel: 'low' });
    const { user } = await renderReady(connection);
    const autonomy = screen.getByTestId('session-new-autonomy') as HTMLSelectElement;
    await waitFor(() => expect(autonomy.value).toBe('low'));

    await user.click(screen.getByTestId('session-new-mode-mission'));

    expect(screen.getByTestId('session-new-mission-hint')).toHaveTextContent(/High/);
    expect(autonomy.value).toBe('low');
    await user.selectOptions(autonomy, 'off');
    expect(autonomy.value).toBe('off');
  });

  it('asks for cost confirmation and creates nothing on Cancel', async () => {
    const { connection, createSession } = fakeConnection();
    const { user } = await renderReady(connection);
    await user.click(screen.getByTestId('session-new-mode-mission'));

    await user.click(screen.getByTestId('session-new-create'));
    const dialog = await screen.findByTestId('mission-start-confirm');
    expect(dialog).toHaveTextContent(/expensive|credits/i);
    await user.click(screen.getByTestId('mission-start-confirm-cancel'));

    expect(screen.queryByTestId('mission-start-confirm')).not.toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('creates with the chosen autonomy and no prompt on Confirm, and asks again next time', async () => {
    const { connection, createSession } = fakeConnection({
      modelId: 'model-x',
      autonomyLevel: 'high',
    });
    const { user, onCreated } = await renderReady(connection);
    await user.click(screen.getByTestId('session-new-mode-mission'));
    await user.selectOptions(screen.getByTestId('session-new-autonomy'), 'low');

    await user.click(screen.getByTestId('session-new-create'));
    expect(createSession).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId('mission-start-confirm-confirm'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-1' }));
    expect(createSession).toHaveBeenCalledWith({
      cwd: 'C:\\w',
      interactionMode: 'mission',
      autonomyLevel: 'low',
    });

    await user.click(screen.getByTestId('session-new-create'));
    expect(await screen.findByTestId('mission-start-confirm')).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('closes the confirmation on the Android back action without creating', async () => {
    const { connection, createSession } = fakeConnection();
    const { user } = await renderReady(connection);
    await user.click(screen.getByTestId('session-new-mode-mission'));
    await user.click(screen.getByTestId('session-new-create'));
    await screen.findByTestId('mission-start-confirm');

    let dismissed = false;
    act(() => {
      dismissed = dismissTopOverlay();
    });
    expect(dismissed).toBe(true);

    await waitFor(() =>
      expect(screen.queryByTestId('mission-start-confirm')).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId('session-new-sheet')).toBeInTheDocument();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('creates Normal and Spec sessions without confirmation', async () => {
    const { connection, createSession } = fakeConnection();
    const { user } = await renderReady(connection);
    await user.click(screen.getByTestId('session-new-mode-spec'));
    await user.click(screen.getByTestId('session-new-create'));

    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('mission-start-confirm')).not.toBeInTheDocument();
    expect(createSession).toHaveBeenCalledWith({ cwd: 'C:\\w', interactionMode: 'spec' });
  });
});
