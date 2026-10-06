import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppNotificationsApi } from '../platform/appNotifications';
import { useForegroundStore } from '../stores/foreground';
import { useInteractionStore } from '../stores/interactions';
import { useNotificationSettingsStore } from '../stores/notificationSettings';
import { useSessionViewStore } from '../stores/sessionView';
import { useLocalNotifications } from './useLocalNotifications';

function fakeApi() {
  let tap: ((sessionId: string) => void) | undefined;
  let approve: ((requestId: string, sessionId: string) => void) | undefined;
  const api = {
    isSupported: () => true,
    permissionGranted: vi.fn(async () => true),
    requestPermission: vi.fn(async () => true),
    openSettings: vi.fn(async () => true),
    configure: vi.fn(async () => undefined),
    post: vi.fn(async () => true),
    cancel: vi.fn(async () => undefined),
    onTap: vi.fn((listener: (sessionId: string) => void) => {
      tap = listener;
      return () => undefined;
    }),
    onApprove: vi.fn((listener: (requestId: string, sessionId: string) => void) => {
      approve = listener;
      return () => undefined;
    }),
  } satisfies AppNotificationsApi;
  return {
    api,
    tap: (id: string) => tap?.(id),
    approve: (r: string, s: string) => approve?.(r, s),
  };
}

const permissionRequest = {
  toolUses: [
    {
      toolUse: { id: 'tool-1', name: 'Execute', input: {} },
      details: { type: 'exec', command: 'touch hello.txt', fullCommand: 'touch hello.txt' },
    },
  ],
  options: [{ value: 'proceed_once' }, { value: 'cancel' }],
};

describe('useLocalNotifications', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNotificationSettingsStore.setState({ enabled: true, approvals: true, turns: false });
    useForegroundStore.setState({ appActive: false, viewedSessionId: null });
    useSessionViewStore.setState({ views: {} });
    useInteractionStore.setState({ pending: [], expired: {} });
  });

  it('pushes the channel names and switches to the native side', async () => {
    const { api } = fakeApi();
    renderHook(() => useLocalNotifications(() => undefined, api));
    await waitFor(() => expect(api.configure).toHaveBeenCalled());
    expect(api.configure).toHaveBeenLastCalledWith({
      channelNames: {
        approvals: 'Approval requests',
        turns: 'Finished turns',
        service: 'Background connection',
      },
      enabled: true,
      approvals: true,
      turns: false,
    });
    act(() => useNotificationSettingsStore.getState().setChannel('turns', true));
    await waitFor(() =>
      expect(api.configure).toHaveBeenLastCalledWith(expect.objectContaining({ turns: true })),
    );
  });

  it('opens the session of a tapped notification', () => {
    const { api, tap } = fakeApi();
    const navigate = vi.fn();
    renderHook(() => useLocalNotifications(navigate, api));
    tap('s9');
    expect(navigate).toHaveBeenCalledWith('/sessions/s9');
  });

  it('answers the request with proceed once when Approve is pressed', async () => {
    const { api, approve } = fakeApi();
    renderHook(() => useLocalNotifications(() => undefined, api));
    const answer = useInteractionStore
      .getState()
      .requestPermission('s1', permissionRequest as never);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const id = useInteractionStore.getState().pending[0]?.id ?? '';
    approve(id, 's1');
    await expect(answer).resolves.toBe('proceed_once');
    expect(api.cancel).toHaveBeenCalledWith(`request:${id}`);
  });
});
