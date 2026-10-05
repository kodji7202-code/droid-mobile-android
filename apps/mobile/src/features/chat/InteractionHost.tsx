import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { exitSpecPlan } from '@droidmobile/daemon-client';
import type { PermissionRequest } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';
import { useInteractionStore } from '../../stores/interactions';
import { useSessionViewStore } from '../../stores/sessionView';
import { ExitSpecDialog } from './ExitSpecDialog';
import { AskUserDialog, PermissionDialog } from './InteractionDialogs';
import { expectedAutonomy, knownSessionIds, waitForNewSession } from './newSessionWatch';
import { describePermission } from './permissionDetail';

type NewSessionState = 'idle' | 'searching' | 'missing';

/**
 * Shows the open daemon request of one session, answers it through the
 * interaction store and reports a request that could no longer be answered.
 */
export function InteractionHost({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const pending = useInteractionStore((state) => state.pending);
  const expired = useInteractionStore((state) => state.expired[sessionId] === true);
  const answerPermission = useInteractionStore((state) => state.answerPermission);
  const answerPermissionOption = useInteractionStore((state) => state.answerPermissionOption);
  const answerAskUser = useInteractionStore((state) => state.answerAskUser);
  const markDenied = useSessionViewStore((state) => state.markDenied);
  const follow = useSessionViewStore((state) => state.follow);
  const interrupt = useSessionViewStore((state) => state.interrupt);

  const navigate = useNavigate();
  const connection = useConnectionStore((state) => state.connection);
  const cwd = useSessionViewStore((state) => state.views[sessionId]?.cwd);
  const [newSession, setNewSession] = useState<NewSessionState>('idle');
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const entry = pending.find((item) => item.sessionId === sessionId);

  const chooseSpecOption = async (id: string, value: string, request: PermissionRequest) => {
    if (value === 'cancel') {
      markDenied(
        sessionId,
        describePermission(request).map(({ toolUseId, toolName, input }) => ({
          id: toolUseId,
          name: toolName,
          input,
        })),
      );
      answerPermission(id, 'deny');
      void follow(sessionId);
      return;
    }
    if (!value.startsWith('proceed_new_session') || !connection) {
      answerPermissionOption(id, value);
      void follow(sessionId);
      return;
    }
    let known: Set<string> | undefined;
    try {
      known = await knownSessionIds(connection);
    } catch {
      known = undefined;
    }
    answerPermissionOption(id, value);
    void follow(sessionId);
    if (!known) {
      setNewSession('missing');
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setNewSession('searching');
    const created = await waitForNewSession({
      connection,
      known,
      cwd,
      autonomy: expectedAutonomy(value),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    if (created) {
      setNewSession('idle');
      navigate(`/sessions/${created}`);
    } else {
      setNewSession('missing');
    }
  };

  return (
    <>
      {newSession === 'searching' ? (
        <p className="sessions-notice" role="status" data-testid="exit-spec-searching">
          {t('chat.exitSpec.newSessionSearching')}
        </p>
      ) : null}
      {newSession === 'missing' ? (
        <p
          className="sessions-notice sessions-notice--offline"
          role="status"
          data-testid="exit-spec-missing"
        >
          {t('chat.exitSpec.newSessionMissing')}{' '}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="exit-spec-open-sessions"
            onClick={() => {
              setNewSession('idle');
              navigate('/sessions');
            }}
          >
            {t('chat.exitSpec.openSessions')}
          </button>
        </p>
      ) : null}
      {expired ? (
        <p
          className="sessions-notice sessions-notice--offline"
          role="status"
          data-testid="interaction-expired"
        >
          {t('chat.requestExpired')}
        </p>
      ) : null}
      {entry?.kind === 'permission' && exitSpecPlan(entry.request) ? (
        <ExitSpecDialog
          key={entry.id}
          entry={entry}
          onStop={() => void interrupt(sessionId)}
          onChoose={(value) => void chooseSpecOption(entry.id, value, entry.request)}
        />
      ) : null}
      {entry?.kind === 'permission' && !exitSpecPlan(entry.request) ? (
        <PermissionDialog
          key={entry.id}
          entry={entry}
          onStop={() => void interrupt(sessionId)}
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
          onStop={() => void interrupt(sessionId)}
          onAnswer={(answer) => {
            answerAskUser(entry.id, answer);
            void follow(sessionId);
          }}
        />
      ) : null}
    </>
  );
}
