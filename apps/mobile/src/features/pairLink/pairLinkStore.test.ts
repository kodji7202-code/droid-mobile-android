import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPairLinkMemory, usePairLinkStore } from './pairLinkStore';

const FAKE_KEY = 'fk-fakefakefake0001';
const LINK_A = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3101';
const LINK_B = 'droidmobile://pair?v=1&url=ws%3A%2F%2F10.0.2.2%3A3109';

function reset() {
  usePairLinkStore.setState({
    pending: null,
    notice: null,
    forConnect: null,
    forAddForm: null,
  });
  resetPairLinkMemory();
}

describe('pair link store', () => {
  beforeEach(reset);
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('keeps one pending link when the same link is delivered twice', () => {
    const { receive } = usePairLinkStore.getState();
    receive(LINK_A);
    const first = usePairLinkStore.getState().pending;
    receive(LINK_A);
    expect(usePairLinkStore.getState().pending).toBe(first);
  });

  it('suppresses the warm delivery that follows a cold-start one after the dialog closed', () => {
    vi.useFakeTimers();
    const { receive, dismiss } = usePairLinkStore.getState();
    receive(LINK_A);
    dismiss();
    receive(LINK_A);
    expect(usePairLinkStore.getState().pending).toBeNull();
    vi.advanceTimersByTime(1500);
    receive(LINK_A);
    expect(usePairLinkStore.getState().pending).not.toBeNull();
  });

  it('opens a new dialog for a different link', () => {
    const { receive, dismiss } = usePairLinkStore.getState();
    receive(LINK_A);
    dismiss();
    receive(LINK_B);
    expect(usePairLinkStore.getState().pending?.summary.host).toBe('10.0.2.2:3109');
  });

  it('reports an invalid link once and opens no dialog', () => {
    const { receive } = usePairLinkStore.getState();
    receive('droidmobile://pair?v=2&url=wss%3A%2F%2Fx.example.invalid');
    receive('droidmobile://pair?v=2&url=wss%3A%2F%2Fx.example.invalid');
    const state = usePairLinkStore.getState();
    expect(state.pending).toBeNull();
    expect(state.notice).toEqual({ seq: expect.any(Number), error: 'invalid' });
  });

  it('release build rejects ws:// with the secure-connection error; debug opens the dialog', () => {
    vi.stubEnv('VITE_DROID_BUILD', 'release');
    usePairLinkStore.getState().receive(LINK_A);
    expect(usePairLinkStore.getState().pending).toBeNull();
    expect(usePairLinkStore.getState().notice?.error).toBe('insecure');

    reset();
    vi.stubEnv('VITE_DROID_BUILD', 'debug');
    usePairLinkStore.getState().receive(LINK_A);
    expect(usePairLinkStore.getState().pending).not.toBeNull();
  });

  it('ignores other droidmobile:// links without a notice', () => {
    usePairLinkStore.getState().receive('droidmobile://other');
    const state = usePairLinkStore.getState();
    expect(state.pending).toBeNull();
    expect(state.notice).toBeNull();
  });

  it('never calls console or serializes the raw link into the store state', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) =>
      vi.spyOn(console, name).mockImplementation(() => undefined),
    );
    const link = `${LINK_A}&key=${FAKE_KEY}`;
    usePairLinkStore.getState().receive(link);
    usePairLinkStore.getState().receive('droidmobile://pair?v=2');
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    const state = usePairLinkStore.getState();
    expect(JSON.stringify(state.pending?.summary)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(state)).not.toContain('droidmobile://pair');
    for (const spy of spies) spy.mockRestore();
  });
});
