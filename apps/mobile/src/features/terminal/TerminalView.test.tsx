import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { AppProviders } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';
import { FakeEmulator, FakeTerminalClient } from './fakes';
import { TerminalView } from './TerminalView';
import { disposeTerminalManager, setEmulatorFactoryForTests } from './terminalRegistry';

let client: FakeTerminalClient;
let emulators: FakeEmulator[];

beforeEach(() => {
  client = new FakeTerminalClient();
  emulators = [];
  setEmulatorFactoryForTests(async () => () => {
    const e = new FakeEmulator();
    emulators.push(e);
    return e;
  });
  useConnectionStore.setState({
    connection: { openTerminalClient: () => client } as unknown as DaemonConnection,
  });
});

afterEach(() => {
  disposeTerminalManager();
  setEmulatorFactoryForTests(null);
  useConnectionStore.setState({ connection: null });
});

function mount() {
  return render(
    <AppProviders>
      <TerminalView sessionId="s1" cwd="C:\\work" />
    </AppProviders>,
  );
}

describe('TerminalView', () => {
  it('opens one terminal and attaches only the selected emulator to the DOM', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(client.count('create')).toBe(1);
    await userEvent.click(screen.getByTestId('terminal-new'));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
    const host = screen.getByTestId('terminal-host');
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(emulators[1]!.element);
    await userEvent.click(screen.getAllByRole('tab')[0]!);
    expect(host.firstElementChild).toBe(emulators[0]!.element);
  });

  it('does not create again when the view is remounted', async () => {
    const first = mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    first.unmount();
    mount();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(client.count('create')).toBe(1);
    expect(client.disposed).toBe(false);
  });

  it('shows the exit code in the tab, disables input and offers restart', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    const id = client.frames.find((f) => f.op === 'create')!.terminalId!;
    act(() => {
      client.emit({
        type: 'exit',
        sessionId: 's1',
        terminalId: id,
        exitCode: 3,
        signal: 'SIGTERM',
      });
    });
    expect(screen.getByRole('tab')).toHaveTextContent('exited (3)');
    expect(screen.getByRole('tab')).not.toHaveTextContent(/killed|SIGTERM/i);
    expect(screen.getByTestId('terminal-restart')).toBeInTheDocument();
    emulators[0]!.type('x');
    expect(client.count('write')).toBe(0);
  });

  it('shows the empty state with a New terminal action after closing the last terminal', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    await userEvent.click(screen.getByRole('button', { name: 'Close terminal 1' }));
    await waitFor(() => expect(screen.getByTestId('terminal-empty')).toBeInTheDocument());
    expect(client.count('close')).toBe(1);
    await userEvent.click(screen.getByTestId('terminal-empty-new'));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(client.count('create')).toBe(2);
  });

  it('shows the failure with a retry when the sidecar cannot be created', async () => {
    client.createError = 'no shell';
    mount();
    expect(await screen.findByTestId('terminal-error')).toHaveTextContent('no shell');
    client.createError = null;
    await userEvent.click(screen.getByTestId('terminal-retry'));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
  });
});
