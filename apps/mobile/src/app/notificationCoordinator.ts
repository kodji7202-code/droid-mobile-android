import { exitSpecPlan, missionPermission } from '@droidmobile/daemon-client';
import type { AppNotificationsApi } from '../platform/appNotifications';
import { describePermission } from '../features/chat/permissionDetail';
import type { PendingInteraction } from '../stores/interactions';

export interface NotificationSnapshot {
  enabled: boolean;
  approvals: boolean;
  turns: boolean;
  appActive: boolean;
  viewedSessionId: string | null;
  pending: readonly PendingInteraction[];
  views: Record<
    string,
    { turnActive: boolean; stopRequested: boolean; interrupted: boolean; cwd?: string }
  >;
}

export type Translate = (key: string, options?: Record<string, string>) => string;

const DETAIL_LIMIT = 160;

const folderName = (cwd: string | undefined): string | undefined =>
  cwd
    ?.split(/[\\/]/)
    .filter((part) => part !== '')
    .at(-1);

const clip = (text: string) =>
  text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text;

function requestDetail(entry: PendingInteraction): string | undefined {
  if (entry.kind !== 'permission') return undefined;
  const [first] = describePermission(entry.request);
  if (!first) return undefined;
  switch (first.body.kind) {
    case 'command':
      return first.body.command;
    case 'diff':
    case 'patch':
      return `${first.toolName}: ${first.body.fileName}`;
    default:
      return first.toolName;
  }
}

/** A request the Approve button may answer: a plain tool permission, not a plan or mission decision. */
function approvableFromNotification(entry: PendingInteraction): boolean {
  return (
    entry.kind === 'permission' && !exitSpecPlan(entry.request) && !missionPermission(entry.request)
  );
}

/**
 * Keeps the Android notifications in step with the app state: one per request that waits
 * for an answer and one per turn that finished while the user was elsewhere. Nothing is
 * shown for the session on screen, and everything is withdrawn once it is answered, seen
 * or switched off.
 */
export class NotificationCoordinator {
  private readonly posted = new Map<string, 'request' | 'turn'>();
  private readonly wasActive = new Map<string, boolean>();

  constructor(
    private readonly api: Pick<AppNotificationsApi, 'post' | 'cancel'>,
    private readonly translate: () => Translate,
  ) {}

  update(snapshot: NotificationSnapshot): void {
    const t = this.translate();
    const onScreen = (sessionId: string) =>
      snapshot.appActive && snapshot.viewedSessionId === sessionId;
    const sessionName = (sessionId: string) =>
      folderName(snapshot.views[sessionId]?.cwd) ?? t('session.title');

    const wanted = new Set<string>();

    if (snapshot.enabled && snapshot.approvals) {
      for (const entry of snapshot.pending) {
        if (onScreen(entry.sessionId)) continue;
        const tag = `request:${entry.id}`;
        wanted.add(tag);
        if (this.posted.has(tag)) continue;
        this.posted.set(tag, 'request');
        const session = sessionName(entry.sessionId);
        const detail = requestDetail(entry);
        const permission = entry.kind === 'permission';
        void this.api.post({
          tag,
          channel: 'approvals',
          title: t(
            permission ? 'notifications.local.requestTitle' : 'notifications.local.askTitle',
          ),
          text: detail
            ? t('notifications.local.requestText', { session, detail: clip(detail) })
            : t(
                permission ? 'notifications.local.requestFallback' : 'notifications.local.askText',
                {
                  session,
                },
              ),
          sessionId: entry.sessionId,
          ...(approvableFromNotification(entry)
            ? { approveRequestId: entry.id, approveLabel: t('notifications.local.approve') }
            : {}),
        });
      }
    }

    for (const [sessionId, view] of Object.entries(snapshot.views)) {
      const tag = `turn:${sessionId}`;
      const finished = this.wasActive.get(sessionId) === true && !view.turnActive;
      this.wasActive.set(sessionId, view.turnActive);
      if (onScreen(sessionId) || view.turnActive) continue;
      if (
        finished &&
        snapshot.enabled &&
        snapshot.turns &&
        !view.stopRequested &&
        !view.interrupted
      ) {
        wanted.add(tag);
        this.posted.set(tag, 'turn');
        void this.api.post({
          tag,
          channel: 'turns',
          title: t('notifications.local.turnTitle'),
          text: t('notifications.local.turnText', { session: sessionName(sessionId) }),
          sessionId,
        });
      } else if (this.posted.get(tag) === 'turn' && snapshot.enabled && snapshot.turns) {
        wanted.add(tag);
      }
    }

    for (const tag of [...this.posted.keys()]) {
      if (wanted.has(tag)) continue;
      this.posted.delete(tag);
      void this.api.cancel(tag);
    }
  }
}
