import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../stores/connection';
import { useLockStore } from '../stores/lock';
import { useSessionViewStore } from '../stores/sessionView';
import { resumeApp } from './useAppResume';

describe('resumeApp', () => {
  const retry = vi.fn();
  const refreshOnResume = vi.fn(async () => undefined);

  beforeEach(() => {
    retry.mockClear();
    refreshOnResume.mockClear();
    useSessionViewStore.setState({ refreshOnResume });
    useLockStore.setState({ enabled: false, locked: false });
  });

  it('refreshes open sessions when the socket is ready', () => {
    useConnectionStore.setState({ status: 'ready', retry });
    resumeApp();
    expect(refreshOnResume).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('reconnects when the socket dropped in the background', () => {
    useConnectionStore.setState({ status: 'offline', retry });
    resumeApp();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(refreshOnResume).not.toHaveBeenCalled();
  });

  it.each(['ready', 'offline'] as const)(
    'does nothing while the app lock is closed (status %s)',
    (status) => {
      useLockStore.setState({ enabled: true, locked: true });
      useConnectionStore.setState({ status, retry });
      resumeApp();
      expect(retry).not.toHaveBeenCalled();
      expect(refreshOnResume).not.toHaveBeenCalled();
    },
  );
});
