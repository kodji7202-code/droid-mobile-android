import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/biometrics', () => ({
  biometrics: { isAvailable: vi.fn(), authenticate: vi.fn() },
}));

import { biometrics } from '../platform/biometrics';
import { exceedsGrace, LOCK_ENABLED_KEY, LOCK_GRACE_KEY, useLockStore } from './lock';

function reset(partial: Partial<ReturnType<typeof useLockStore.getState>> = {}) {
  useLockStore.setState({ enabled: true, graceSeconds: 30, locked: false, ...partial });
}

describe('exceedsGrace', () => {
  it('locks only when away longer than the grace period', () => {
    expect(exceedsGrace(29_000, 30)).toBe(false);
    expect(exceedsGrace(30_001, 30)).toBe(true);
    expect(exceedsGrace(1, 0)).toBe(true);
  });
});

describe('lock store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(biometrics.authenticate).mockReset();
    reset();
  });

  it('persists the enabled flag and grace period', () => {
    useLockStore.getState().setEnabled(true);
    useLockStore.getState().setGraceSeconds(60);
    expect(window.localStorage.getItem(LOCK_ENABLED_KEY)).toBe('true');
    expect(window.localStorage.getItem(LOCK_GRACE_KEY)).toBe('60');
  });

  it('disabling the lock also unlocks', () => {
    reset({ locked: true });
    useLockStore.getState().setEnabled(false);
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('lock() does nothing while the lock is disabled', () => {
    reset({ enabled: false });
    useLockStore.getState().lock();
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('re-locks after a background longer than the grace period only', () => {
    const store = useLockStore.getState();
    store.onBackground(1_000_000);
    store.onForeground(1_010_000);
    expect(useLockStore.getState().locked).toBe(false);

    store.onBackground(2_000_000);
    store.onForeground(2_040_000);
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('ignores lifecycle events caused by its own prompt', async () => {
    reset({ graceSeconds: 0 });
    vi.mocked(biometrics.authenticate).mockImplementation(() => {
      const store = useLockStore.getState();
      store.onBackground(Date.now());
      store.onForeground(Date.now() + 100);
      return Promise.resolve('success');
    });
    expect(await useLockStore.getState().authenticate('r', 'c')).toBe('success');
    expect(useLockStore.getState().locked).toBe(false);
  });

  it('still locks on a genuine background shortly after the prompt ended', async () => {
    reset({ graceSeconds: 0 });
    vi.mocked(biometrics.authenticate).mockResolvedValue('success');
    await useLockStore.getState().authenticate('r', 'c');
    const now = Date.now();
    useLockStore.getState().onBackground(now + 100);
    useLockStore.getState().onForeground(now + 5_000);
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('counts Home during a pending prompt as a genuine background after it is cancelled', async () => {
    reset({ graceSeconds: 30 });
    vi.mocked(biometrics.authenticate).mockImplementation(() => {
      useLockStore.getState().onBackground(1_000_000);
      return Promise.resolve('cancelled');
    });
    await useLockStore.getState().authenticate('r', 'c');
    useLockStore.getState().onForeground(1_040_000);
    expect(useLockStore.getState().locked).toBe(true);
  });

  it('does not lock when the prompt background was followed by a brief foreground inside the prompt', async () => {
    reset({ graceSeconds: 30 });
    vi.mocked(biometrics.authenticate).mockImplementation(() => {
      const store = useLockStore.getState();
      store.onBackground(1_000_000);
      store.onForeground(1_000_100);
      return Promise.resolve('cancelled');
    });
    await useLockStore.getState().authenticate('r', 'c');
    useLockStore.getState().onForeground(1_040_000);
    expect(useLockStore.getState().locked).toBe(false);
  });
  it('relocks when the app returned over a pending prompt after a long absence', async () => {
    reset({ graceSeconds: 30 });
    vi.mocked(biometrics.authenticate).mockImplementation(() => {
      const store = useLockStore.getState();
      store.onBackground(1_000_000);
      store.onForeground(1_040_000);
      return Promise.resolve('cancelled');
    });
    await useLockStore.getState().authenticate('r', 'c');
    expect(useLockStore.getState().locked).toBe(true);
  });
  it('passes the localized title through to the biometric prompt', async () => {
    vi.mocked(biometrics.authenticate).mockResolvedValue('success');
    await useLockStore.getState().authenticate('r', 'c', 'Titlu');
    expect(biometrics.authenticate).toHaveBeenCalledWith('r', 'c', 'Titlu');
  });

  it('keeps the outcome of a failed prompt', async () => {
    vi.mocked(biometrics.authenticate).mockResolvedValue('failed');
    expect(await useLockStore.getState().authenticate('r', 'c')).toBe('failed');
  });
});
