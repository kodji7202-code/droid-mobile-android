import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '../stores/connection';
import { useSessionViewStore } from '../stores/sessionView';
import { resumeApp } from './useAppResume';

describe('resumeApp', () => {
  const retry = vi.fn();
  const refreshOnResume = vi.fn(async () => undefined);

  beforeEach(() => {
    retry.mockClear();
    refreshOnResume.mockClear();
    useSessionViewStore.setState({ refreshOnResume });
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
});
