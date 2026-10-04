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

export function buildPushPayload(kind: BridgeEventKind, sessionId: string): PushPayload {
  return { kind, sessionId };
}
