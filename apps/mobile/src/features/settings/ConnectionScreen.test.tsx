import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConnection } from '@droidmobile/daemon-client';
import { renderAppAt } from '../../test/render-app';
import { useConnectionStore } from '../../stores/connection';

const KEY = 'fk-test-key-12345678';
const FIRST = { id: 'a', label: 'First', url: 'ws://127.0.0.1:3101' };
const SECOND = { id: 'b', label: 'Second', url: 'wss://example.test' };

const actions = {
  addConnection: vi.fn(),
  switchTo: vi.fn(),
  updateConnection: vi.fn(),
  forget: vi.fn(),
};

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue(undefined);
  useConnectionStore.setState({
    ...actions,
    savedConnections: [FIRST, SECOND],
    savedActiveId: 'a',
    status: 'ready',
  });
});

afterEach(() => {
  act(() => {
    useConnectionStore.setState({
      connection: null,
      status: 'offline',
      savedConnections: [],
      savedActiveId: null,
    });
  });
});

function renderPage() {
  return renderAppAt('/settings/connection', { connection: {} as DaemonConnection });
}

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

describe('ConnectionScreen', () => {
  it('shows the active connection with transport, status and exactly one active marker, never a key', () => {
    renderPage();
    expect(screen.getByTestId('connection-active-label')).toHaveTextContent('First');
    expect(screen.getByTestId('connection-active-url')).toHaveTextContent('ws://127.0.0.1:3101');
    expect(screen.getByTestId('connection-active-transport')).toHaveTextContent('ws');
    expect(screen.getByTestId('connection-active-status')).toHaveTextContent('Connected');
    expect(screen.getAllByTestId(/^connection-active-marker-/)).toHaveLength(1);
    expect(screen.getByTestId('connection-active-marker-a')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(KEY);
  });

  it('shows the insecure banner for an active ws:// connection only', () => {
    renderPage();
    expect(screen.getByTestId('connect-insecure-banner')).toBeInTheDocument();
    act(() => useConnectionStore.setState({ savedActiveId: 'b' }));
    expect(screen.queryByTestId('connect-insecure-banner')).toBeNull();
  });

  it('switches to a saved connection', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('connection-switch-b'));
    await waitFor(() => expect(actions.switchTo).toHaveBeenCalledWith('b'));
    expect(screen.queryByTestId('connection-switch-a')).toBeNull();
  });

  it('shows an error when switching fails because the key is missing', async () => {
    const { MissingKeyError } = await import('../../stores/connection');
    actions.switchTo.mockRejectedValue(new MissingKeyError());
    renderPage();
    fireEvent.click(screen.getByTestId('connection-switch-b'));
    expect(await screen.findByTestId('connection-switch-error')).toHaveTextContent(
      /not stored on this device/,
    );
  });

  it('adds a connection after validation and closes the form', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('connection-add'));
    type('connection-form-label', 'Third');
    type('connection-form-url', 'ws://127.0.0.1:3106');
    type('connection-form-key', KEY);
    fireEvent.click(screen.getByTestId('connection-form-submit'));
    await waitFor(() =>
      expect(actions.addConnection).toHaveBeenCalledWith({
        label: 'Third',
        url: 'ws://127.0.0.1:3106',
        apiKey: KEY,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('connection-form')).toBeNull());
  });

  it('keeps the form open with a typed error when the daemon rejects the addition', async () => {
    actions.addConnection.mockRejectedValue(Object.assign(new Error('rejected'), { kind: 'auth' }));
    renderPage();
    fireEvent.click(screen.getByTestId('connection-add'));
    type('connection-form-url', 'ws://127.0.0.1:3106');
    type('connection-form-key', KEY);
    fireEvent.click(screen.getByTestId('connection-form-submit'));
    expect(await screen.findByTestId('connection-form-error')).toHaveTextContent(
      /rejected this API key/,
    );
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.getByTestId('connection-form')).toBeInTheDocument();
  });

  it('refuses a malformed key locally without calling the manager', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('connection-add'));
    type('connection-form-url', 'ws://127.0.0.1:3106');
    type('connection-form-key', 'not-a-key');
    fireEvent.click(screen.getByTestId('connection-form-submit'));
    expect(screen.getByTestId('connection-form-error')).toBeInTheDocument();
    expect(actions.addConnection).not.toHaveBeenCalled();
  });

  it('edits label and URL with an empty key field and saves without a key', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('connection-edit-b'));
    expect(screen.getByTestId('connection-form-key')).toHaveValue('');
    type('connection-form-label', 'Work PC');
    fireEvent.click(screen.getByTestId('connection-form-submit'));
    await waitFor(() =>
      expect(actions.updateConnection).toHaveBeenCalledWith('b', {
        label: 'Work PC',
        url: SECOND.url,
        apiKey: undefined,
      }),
    );
  });

  it('asks for confirmation naming the connection; cancel keeps it, confirm forgets it', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('connection-forget-b'));
    expect(screen.getByTestId('connection-forget-dialog')).toHaveTextContent('Second');
    fireEvent.click(screen.getByTestId('connection-forget-dialog-cancel'));
    expect(actions.forget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('connection-forget-b'));
    fireEvent.click(screen.getByTestId('connection-forget-dialog-confirm'));
    await waitFor(() => expect(actions.forget).toHaveBeenCalledWith('b'));
  });
});
