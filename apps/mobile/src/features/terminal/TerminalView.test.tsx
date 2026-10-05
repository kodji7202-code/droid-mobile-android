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
    expect(screen.getByRole('tab')).toHaveTextContent('\u00B7 exited (3)');
    expect(screen.getByRole('tab').textContent).not.toMatch(/[\u00C2\u00C3]/);
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

  it('shows tabs as stale with input disabled until the daemon confirms them, then drops ghosts', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    const tab = screen.getAllByRole('tab')[0]!;
    expect(tab).toHaveAttribute('data-status', 'running');
    let release!: () => void;
    act(() => client.setStatus('reconnecting'));
    expect(tab).toHaveAttribute('data-status', 'stale');
    expect(screen.getByTestId('terminal-key-esc')).toBeDisabled();
    client.daemon.set('s1', []);
    client.listGate = new Promise((r) => (release = r));
    act(() => client.setStatus('ready'));
    expect(screen.getByTestId('terminal-sync-banner')).toBeInTheDocument();
    expect(tab).toHaveAttribute('data-status', 'stale');
    act(() => release());
    await waitFor(() => expect(screen.getByTestId('terminal-empty')).toBeInTheDocument());
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.queryByTestId('terminal-sync-banner')).toBeNull();
  });

  it('disables close while the sidecar is reconnecting and enables it again when ready', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    const close = screen.getByRole('button', { name: 'Close terminal 1' });
    act(() => client.setStatus('reconnecting'));
    expect(close).toBeDisabled();
    await userEvent.click(close);
    expect(client.count('close')).toBe(0);
    act(() => client.setStatus('ready'));
    await waitFor(() => expect(close).toBeEnabled());
  });

  it('keeps the tab and tells the user when the daemon did not confirm the close', async () => {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    client.closeMode = 'fail';
    await userEvent.click(screen.getByRole('button', { name: 'Close terminal 1' }));
    expect(await screen.findByTestId('terminal-close-error')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
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

describe('TerminalView mobile input', () => {
  async function ready() {
    mount();
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    return emulators[0]!;
  }
  const writes = () => client.frames.filter((f) => f.op === 'write').map((f) => f.data);

  it('sends Esc and Tab frames from the extra keys', async () => {
    await ready();
    await userEvent.click(screen.getByTestId('terminal-key-esc'));
    await userEvent.click(screen.getByTestId('terminal-key-tab'));
    expect(writes()).toEqual(['\x1b', '\t']);
  });

  it('follows the cursor-key mode for arrows', async () => {
    const emulator = await ready();
    await userEvent.click(screen.getByTestId('terminal-key-up'));
    emulator.applicationCursor = true;
    await userEvent.click(screen.getByTestId('terminal-key-left'));
    expect(writes()).toEqual(['\x1b[A', '\x1bOD']);
  });

  it('arms Ctrl for exactly one character and toggles off on a second tap', async () => {
    const emulator = await ready();
    const ctrl = screen.getByTestId('terminal-key-ctrl');
    await userEvent.click(ctrl);
    expect(ctrl).toHaveAttribute('aria-pressed', 'true');
    act(() => emulator.type('c'));
    expect(writes()).toEqual(['\x03']);
    expect(ctrl).toHaveAttribute('aria-pressed', 'false');
    act(() => emulator.type('c'));
    expect(writes()).toEqual(['\x03', 'c']);
    await userEvent.click(ctrl);
    await userEvent.click(ctrl);
    expect(writes()).toEqual(['\x03', 'c']);
    act(() => emulator.type('c'));
    expect(writes().at(-1)).toBe('c');
  });

  it('shows a jump-to-bottom control only while scrolled up', async () => {
    const emulator = await ready();
    expect(screen.queryByTestId('terminal-jump-bottom')).not.toBeInTheDocument();
    act(() => emulator.setAtBottom(false));
    await userEvent.click(screen.getByTestId('terminal-jump-bottom'));
    expect(emulator.scrolledToBottom).toBe(1);
    expect(screen.queryByTestId('terminal-jump-bottom')).not.toBeInTheDocument();
  });

  it('copies the selection to the clipboard and pastes clipboard text as input', async () => {
    const emulator = await ready();
    let clip = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          clip = text;
        },
        readText: async () => clip,
      },
    });
    emulator.selection = 'hi-123';
    await userEvent.click(screen.getByTestId('terminal-copy'));
    expect(clip).toBe('hi-123');
    clip = 'echo pasted-ok';
    await userEvent.click(screen.getByTestId('terminal-paste'));
    expect(emulator.pasted).toEqual(['echo pasted-ok']);
    expect(writes()).toEqual(['echo pasted-ok']);
  });
});
