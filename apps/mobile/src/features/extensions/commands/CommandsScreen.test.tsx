import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection, SlashCommand } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../../test/render-app';
import { useConnectionStore } from '../../../stores/connection';
import { useSessionViewStore } from '../../../stores/sessionView';

const HELLO: SlashCommand = { name: 'val-hello', description: 'Validation hello command' };
const REVIEW: SlashCommand = {
  name: 'review',
  description: 'Review the diff',
  argumentHint: '[branch]',
};

function setup(list: () => Promise<SlashCommand[]>, project?: string) {
  const commands = { list: vi.fn(list), release: vi.fn(async () => {}) };
  const connection = { commands } as unknown as DaemonConnection;
  useConnectionStore.setState({ status: 'ready' });
  renderAppAt('/extensions/commands', { connection });
  if (project) {
    act(() => {
      useSessionViewStore.setState({
        activeSessionId: 's1',
        views: { s1: { cwd: project } } as never,
      });
    });
  }
  return commands;
}

afterEach(() => {
  act(() => {
    useConnectionStore.setState({ connection: null, status: 'offline' });
    useSessionViewStore.setState({ activeSessionId: null, views: {} });
  });
});

describe('Extensions > Commands', () => {
  it('is reachable from the hub and titled in English', async () => {
    useConnectionStore.setState({ status: 'ready' });
    const commands = { list: vi.fn(async () => []), release: vi.fn(async () => {}) };
    renderAppAt('/extensions', { connection: { commands } as unknown as DaemonConnection });
    await userEvent.setup().click(screen.getByTestId('extensions-commands'));
    expect(await screen.findByTestId('commands-screen')).toHaveAccessibleName('Commands');
  });

  it('lists the daemon commands with description and argument hint', async () => {
    const commands = setup(async () => [HELLO, REVIEW], 'C:\\scratch');
    const list = await screen.findByTestId('commands-list');
    await waitFor(() => expect(commands.list).toHaveBeenCalledWith('C:\\scratch'));
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('command-row-val-hello')).toHaveTextContent('/val-hello');
    expect(screen.getByTestId('command-description-val-hello')).toHaveTextContent(
      'Validation hello command',
    );
    expect(screen.queryByTestId('command-hint-val-hello')).toBeNull();
    expect(screen.getByTestId('command-hint-review')).toHaveTextContent('[branch]');
    expect(screen.getByTestId('commands-scope')).toHaveTextContent('Project folder: C:\\scratch');
  });

  it('reads the user-level commands when no project is open', async () => {
    const commands = setup(async () => [HELLO]);
    await screen.findByTestId('commands-list');
    expect(commands.list).toHaveBeenCalledWith(undefined);
    expect(screen.getByTestId('commands-scope')).toHaveTextContent('No project is open');
  });

  it('shows a labelled loading state while the request is pending', async () => {
    let finish: (value: SlashCommand[]) => void = () => undefined;
    setup(() => new Promise<SlashCommand[]>((resolve) => (finish = resolve)));
    expect(await screen.findByTestId('commands-loading')).toHaveAccessibleName('Loading commands');
    expect(screen.queryByTestId('commands-empty')).toBeNull();
    finish([HELLO]);
    expect(await screen.findByTestId('commands-list')).toBeInTheDocument();
    expect(screen.queryByTestId('commands-loading')).toBeNull();
  });

  it('shows the empty state when the daemon reports no commands', async () => {
    setup(async () => []);
    expect(await screen.findByTestId('commands-empty')).toHaveTextContent('No commands');
    expect(screen.queryByTestId('commands-list')).toBeNull();
  });

  it('shows an error with retry when the daemon fails, then the list after retrying', async () => {
    const list = vi
      .fn<() => Promise<SlashCommand[]>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue([HELLO]);
    setup(list);
    expect(await screen.findByTestId('commands-error')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('error-state-retry'));
    expect(await screen.findByTestId('command-row-val-hello')).toBeInTheDocument();
  });

  it('releases its scratch session after leaving the section', async () => {
    const commands = setup(async () => [HELLO]);
    await screen.findByTestId('commands-list');
    await userEvent.setup().click(screen.getByTestId('extensions-back'));
    await waitFor(() => expect(commands.release).toHaveBeenCalled());
  });
});
