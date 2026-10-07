import { exitSpecPlan, missionPermission } from '@droidmobile/daemon-client';
import type { AppNotificationsApi, LocalNotification } from '../platform/appNotifications';
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
  text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}â€¦` : text;

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
 * The tags the FCM bridge puts on its pushes (`approvals:<sessionId>`, `turn:<sessionId>`).
 * A local notification under the same tag and the push for the same event replace each other
 * whenever the later one arrives, so the two paths never leave a duplicate.
 */
const approvalsTag = (sessionId: string) => `approvals:${sessionId}`;
const turnTag = (sessionId: string) => `turn:${sessionId}`;

/**
 * Keeps the Android notifications in step with the app state: one per session that has a
 * request waiting for an answer (showing its oldest request) and one per turn that finished
 * while the user was elsewhere. Nothing is shown for the session on screen, and everything
 * is withdrawn once it is answered, seen or switched off. A post that Android refused is
 * tried again when the switches or the foreground state change.
 */
export class NotificationCoordinator {
  private readonly posted = new Map<string, 'request' | 'turn'>();
  private readonly shownRequest = new Map<string, string>();
  private readonly wasActive = new Map<string, boolean>();
  private readonly unsentTurns = new Set<string>();
  private readonly refused = new Set<string>();
  private conditions = '';
  private clearedViewed: string | null = null;

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

    const conditions = [
      snapshot.enabled,
      snapshot.approvals,
      snapshot.turns,
      snapshot.appActive,
    ].join();
    if (conditions !== this.conditions) {
      this.conditions = conditions;
      this.refused.clear();
    }

    const wanted = new Set<string>();

    if (snapshot.enabled && snapshot.approvals) {
      const oldest = new Map<string, PendingInteraction>();
      for (const entry of snapshot.pending) {
        if (!onScreen(entry.sessionId) && !oldest.has(entry.sessionId)) {
          oldest.set(entry.sessionId, entry);
        }
      }
      for (const [sessionId, entry] of oldest) {
        const tag = approvalsTag(sessionId);
        const attempt = `${tag}#${entry.id}`;
        wanted.add(tag);
        if (this.shownRequest.get(tag) === entry.id || this.refused.has(attempt)) continue;
        this.shownRequest.set(tag, entry.id);
        this.posted.set(tag, 'request');
        const session = sessionName(sessionId);
        const detail = requestDetail(entry);
        const permission = entry.kind === 'permission';
        this.send(
          {
            tag,
            channel: 'approvals',
            title: t(
              permission ? 'notifications.local.requestTitle' : 'notifications.local.askTitle',
            ),
            text: detail
              ? t('notifications.local.requestText', { session, detail: clip(detail) })
              : t(
                  permission
                    ? 'notifications.local.requestFallback'
                    : 'notifications.local.askText',
                  { session },
                ),
            sessionId,
            ...(approvableFromNotification(entry)
              ? { approveRequestId: entry.id, approveLabel: t('notifications.local.approve') }
              : {}),
          },
          attempt,
          () => {
            if (this.shownRequest.get(tag) === entry.id) this.shownRequest.delete(tag);
          },
        );
      }
    }

    for (const [sessionId, view] of Object.entries(snapshot.views)) {
      const tag = turnTag(sessionId);
      const finished = this.wasActive.get(sessionId) === true && !view.turnActive;
      this.wasActive.set(sessionId, view.turnActive);
      if (onScreen(sessionId) || view.turnActive) {
        this.unsentTurns.delete(sessionId);
        this.refused.delete(tag);
        continue;
      }
      const alertable = snapshot.enabled && snapshot.turns;
      if (finished && alertable && !view.stopRequested && !view.interrupted) {
        this.unsentTurns.add(sessionId);
      }
      if (!alertable) this.unsentTurns.delete(sessionId);
      if (this.unsentTurns.has(sessionId) && !this.refused.has(tag)) {
        this.unsentTurns.delete(sessionId);
        wanted.add(tag);
        this.posted.set(tag, 'turn');
        this.send(
          {
            tag,
            channel: 'turns',
            title: t('notifications.local.turnTitle'),
            text: t('notifications.local.turnText', { session: sessionName(sessionId) }),
            sessionId,
          },
          tag,
          () => this.unsentTurns.add(sessionId),
        );
      } else if (this.posted.get(tag) === 'turn' && alertable) {
        wanted.add(tag);
      }
    }

    for (const tag of [...this.posted.keys()]) {
      if (wanted.has(tag)) continue;
      this.posted.delete(tag);
      this.shownRequest.delete(tag);
      void this.api.cancel(tag);
    }

    const viewed = snapshot.appActive ? snapshot.viewedSessionId : null;
    if (viewed !== this.clearedViewed) {
      this.clearedViewed = viewed;
      // The bridge pushes under the same tags, so the user's own look at the session withdraws them.
      if (viewed !== null) {
        void this.api.cancel(approvalsTag(viewed));
        void this.api.cancel(turnTag(viewed));
      }
    }
  }

  /** A post that Android refused is remembered as refused, not as delivered, and retried later. */
  private send(notification: LocalNotification, attempt: string, onRefused: () => void): void {
    void this.api.post(notification).then((posted) => {
      if (posted) return;
      this.refused.add(attempt);
      onRefused();
    });
  }
}
