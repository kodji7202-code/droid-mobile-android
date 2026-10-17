import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../app/App';
import { biometrics } from '../../platform/biometrics';
import { useConnectionStore } from '../../stores/connection';
import { useLockStore } from '../../stores/lock';
import { resetPairLinkMemory, usePairLinkStore } from './pairLinkStore';

vi.mock('../../platform/biometrics', () => ({
  biometrics: { isAvailable: vi.fn(), authenticate: vi.fn() },
}));

const authenticate = vi.mocked(biometrics.authenticate);
const LINK = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101';

beforeEach(() => {
  window.localStorage.clear();
  authenticate.mockReset();
  resetPairLinkMemory();
  usePairLinkStore.setState({ pending: null, notice: null, forConnect: null, forAddForm: null });
  useLockStore.setState({ enabled: true, locked: true, graceSeconds: 30 });
  useConnectionStore.setState({ connection: null, restore: vi.fn(() => Promise.resolve()) });
});

afterEach(() => {
  act(() => useLockStore.setState({ enabled: false, locked: false }));
  window.location.hash = '';
});

describe('pair link with the app lock', () => {
  it('keeps the dialog away until the unlock succeeds, then shows it', async () => {
    authenticate.mockResolvedValueOnce('failed');
    render(<App />);
    expect(await screen.findByTestId('lock-error')).toBeInTheDocument();

    act(() => usePairLinkStore.getState().receive(LINK));
    expect(screen.getByTestId('lock-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('pair-link-dialog')).not.toBeInTheDocument();

    authenticate.mockResolvedValueOnce('success');
    fireEvent.click(screen.getByTestId('lock-unlock'));
    await waitFor(() => expect(screen.getByTestId('pair-link-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('pair-link-host')).toHaveTextContent('10.0.2.2:3101');
    expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument();
  });

  it('never shows the dialog after a cancelled prompt', async () => {
    authenticate.mockResolvedValue('cancelled');
    render(<App />);
    act(() => usePairLinkStore.getState().receive(LINK));
    expect(await screen.findByTestId('lock-error')).toHaveAttribute('data-problem', 'cancelled');
    expect(screen.queryByTestId('pair-link-dialog')).not.toBeInTheDocument();
  });
});
