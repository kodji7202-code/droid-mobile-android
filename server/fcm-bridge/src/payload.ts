import type { Message } from 'firebase-admin/messaging';

/**
 * Opaque, minimal push payload for FCM messages (architecture.md section 3.4):
 * only the event kind and the daemon session id ever leave the PC. No code, file
 * content or secret material is ever included.
 */
export type BridgeEventKind = 'permission_prompt' | 'idle_prompt' | 'stop';

export interface PushPayload {
  kind: BridgeEventKind;
  sessionId: string;
}

export type AndroidChannel = 'approvals' | 'turns';

export const CHANNEL_BY_KIND: Readonly<Record<BridgeEventKind, AndroidChannel>> = {
  permission_prompt: 'approvals',
  idle_prompt: 'turns',
  stop: 'turns',
};

/** Fixed text: the notification never varies with anything the hook sent. */
export const NOTIFICATION_TITLE = 'Droid Mobile';
export const NOTIFICATION_BODY = 'Open the app to see what needs your attention.';

/** FCM time-to-live: a push that could not be delivered within an hour is stale. */
export const PUSH_TTL_MS = 3_600_000;

export function buildPushPayload(kind: BridgeEventKind, sessionId: string): PushPayload {
  return { kind, sessionId };
}

/** Returns null for hook events the bridge ignores (for example `auth_success`). */
export function mapHookEvent(
  hookEventName: 'Notification' | 'Stop',
  notificationType: string | undefined,
): BridgeEventKind | null {
  if (hookEventName === 'Stop') return 'stop';
  if (notificationType === 'permission_prompt') return 'permission_prompt';
  if (notificationType === 'idle_prompt') return 'idle_prompt';
  return null;
}

/**
 * Android replaces a notification that carries the same tag. The app posts and cancels its
 * own turn and approval notifications under these tags, so a push and a local notification
 * for the same event end up as one.
 */
export function notificationTag(kind: BridgeEventKind, sessionId: string): string {
  return `${kind === 'permission_prompt' ? 'approvals' : 'turn'}:${sessionId}`;
}

export function buildMessage(token: string, kind: BridgeEventKind, sessionId: string): Message {
  const { kind: dataKind, sessionId: dataSessionId } = buildPushPayload(kind, sessionId);
  return {
    token,
    data: { kind: dataKind, sessionId: dataSessionId },
    notification: { title: NOTIFICATION_TITLE, body: NOTIFICATION_BODY },
    android: {
      priority: 'high',
      ttl: PUSH_TTL_MS,
      notification: {
        channelId: CHANNEL_BY_KIND[kind],
        tag: notificationTag(kind, dataSessionId),
      },
    },
  };
}
