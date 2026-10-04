import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connection';
import { useInteractionStore } from '../../stores/interactions';
import { useSessionViewStore } from '../../stores/sessionView';
import { AskUserDialog, PermissionDialog } from './InteractionDialogs';
import { describePermission } from './permissionDetail';

/**
 * Shows the open daemon request of one session, answers it through the
 * interaction store and reports a request that could no longer be answered.
 */
export function InteractionHost({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const status = useConnectionStore((state) => state.status);
  const pending = useInteractionStore((state) => state.pending);
  const expired = useInteractionStore((state) => state.expired[sessionId] === true);
  const answerPermission = useInteractionStore((state) => state.answerPermission);
  const answerAskUser = useInteractionStore((state) => state.answerAskUser);
  const expire = useInteractionStore((state) => state.expire);
  const markDenied = useSessionViewStore((state) => state.markDenied);
  const follow = useSessionViewStore((state) => state.follow);

  useEffect(() => {
    // A dropped socket takes the daemon-side request with it; answering later is rejected.
    if (status !== 'ready') expire({ notify: true });
  }, [status, expire]);

  const entry = pending.find((item) => item.sessionId === sessionId);

  return (
    <>
      {expired ? (
        <p
          className="sessions-notice sessions-notice--offline"
          role="status"
          data-testid="interaction-expired"
        >
          {t('chat.requestExpired')}
        </p>
      ) : null}
      {entry?.kind === 'permission' ? (
        <PermissionDialog
          key={entry.id}
          entry={entry}
          onDecide={(decision) => {
            if (decision === 'deny') {
              markDenied(
                sessionId,
                describePermission(entry.request).map(({ toolUseId, toolName, input }) => ({
                  id: toolUseId,
                  name: toolName,
                  input,
                })),
              );
            }
            answerPermission(entry.id, decision);
            void follow(sessionId);
          }}
        />
      ) : null}
      {entry?.kind === 'askuser' ? (
        <AskUserDialog
          key={entry.id}
          entry={entry}
          onAnswer={(answer) => {
            answerAskUser(entry.id, answer);
            void follow(sessionId);
          }}
        />
      ) : null}
    </>
  );
}
