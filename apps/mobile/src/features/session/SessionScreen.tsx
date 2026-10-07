import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMediaQuery } from '../../app/useMediaQuery';
import { BackIcon, ContextIcon, SettingsIcon } from '../../components/icons';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useToast } from '../../components/Toast';
import { useConnectionStore } from '../../stores/connection';
import { useForegroundStore } from '../../stores/foreground';
import { useInteractionStore } from '../../stores/interactions';
import { useSessionViewStore } from '../../stores/sessionView';
import { ChatComposer, WAITING_STATE } from '../chat/ChatComposer';
import { InteractionHost } from '../chat/InteractionHost';
import { useChatScroll } from '../chat/useChatScroll';
import { Transcript } from '../chat/Transcript';
import { MissionControl } from '../missions/MissionControl';
import { useMissionView } from '../missions/useMissionView';
import { UsageChip } from '../chat/UsageChip';
import type { SessionHandle } from '@droidmobile/daemon-client';
import { CompactSheet } from './actions/CompactSheet';
import { ForkSheet } from './actions/ForkSheet';
import { RewindSheet } from './actions/RewindSheet';
import { SessionActionsMenu } from './actions/SessionActionsMenu';
import type { SessionAction } from './actions/SessionActionsMenu';
import { ContextUsageSheet } from './ContextUsageSheet';
import { SessionSettingsSheet } from './SessionSettingsSheet';
import { useSettingsSnapshot } from './useSessionSettings';

const HEADER_FOLLOW_INTERVAL_MS = 2000;

/** Last path segment of a working directory, for a compact header title. */
function folderName(cwd: string | undefined): string | undefined {
  const name = cwd?.split(/[\\/]/).filter(Boolean).pop();
  return name === '' ? undefined : name;
}

export function SessionScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  // The list stays visible beside the chat from 840 px, so there is nothing to go back to.
  const wide = useMediaQuery('(min-width: 840px)');
  const connection = useConnectionStore((state) => state.connection);
  const status = useConnectionStore((state) => state.status);
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const ready = status === 'ready';
  const view = useSessionViewStore((state) => state.views[id]);
  const open = useSessionViewStore((state) => state.open);
  const setActiveSessionId = useSessionViewStore((state) => state.setActiveSessionId);
  const loadOlder = useSessionViewStore((state) => state.loadOlder);
  const send = useSessionViewStore((state) => state.send);
  const retry = useSessionViewStore((state) => state.retry);
  const interrupt = useSessionViewStore((state) => state.interrupt);
  const cancelQueued = useSessionViewStore((state) => state.cancelQueued);
  const consumeRestored = useSessionViewStore((state) => state.consumeRestored);
  const awaitingApproval = useInteractionStore((state) =>
    state.pending.some((item) => item.sessionId === id),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // The handle is captured when the action opens so a sheet that is still showing its result survives the switch to another session.
  const [action, setAction] = useState<{ kind: SessionAction; handle?: SessionHandle } | null>(
    null,
  );
  const { showToast } = useToast();
  const { snapshot } = useSettingsSnapshot(view?.handle, HEADER_FOLLOW_INTERVAL_MS);
  const isMission = snapshot?.interactionMode === 'mission';
  const missionView = useMissionView(id, isMission);

  useEffect(() => {
    if (id !== '') {
      setActiveSessionId(id);
    }
  }, [id, setActiveSessionId]);

  useEffect(() => {
    if (id === '') return undefined;
    useForegroundStore.getState().setViewedSessionId(id);
    return () => useForegroundStore.getState().setViewedSessionId(null);
  }, [id]);

  useEffect(() => {
    if (ready && connection && id !== '') {
      void open(connection, id, readyEpoch);
    }
  }, [ready, connection, id, readyEpoch, open]);

  const loadCommands = useCallback(
    () => (connection ? connection.commands.listForSession(id) : Promise.resolve([])),
    [connection, id],
  );

  const items = view?.items;
  const itemCount = items?.length ?? 0;
  const lastText = items?.at(-1);

  const missing = view?.notFound === true;
  useEffect(() => {
    if (missing) navigate('/sessions', { replace: true, state: { sessionNotFound: true } });
  }, [missing, navigate]);

  const contentSignal = useMemo(
    () => ({ itemCount, lastText, interrupted: view?.interrupted }),
    [itemCount, lastText, view?.interrupted],
  );
  const { away, jumpToLatest } = useChatScroll({
    contentSignal,
    hasMore: Boolean(view?.hasMore),
    loadingOlder: Boolean(view?.loadingOlder),
    active: view?.status === 'ready',
    loadOlder: () => void loadOlder(id),
  });

  const loading = view === undefined ? ready : view.status === 'loading';
  const failed = view?.status === 'error';
  const title = folderName(view?.cwd) ?? t('session.title');
  const contextRefreshKey = [
    view?.turnActive ? 'busy' : 'idle',
    view?.usage?.inputTokens ?? 0,
    view?.usage?.outputTokens ?? 0,
  ].join(':');

  return (
    <section
      className="screen session-screen"
      data-testid="session-screen"
      aria-labelledby="session-title"
    >
      <div
        style={{ display: 'contents' }}
        inert={awaitingApproval}
        data-testid="session-background"
      >
        <div className="sub-header">
          {wide ? null : (
            <button
              type="button"
              className="btn btn--ghost sub-header__back"
              data-testid="session-back"
              aria-label={t('common.back')}
              onClick={() => navigate('/sessions')}
            >
              <BackIcon />
            </button>
          )}
          <h2 className="sub-header__title" id="session-title" data-testid="session-title">
            {title}
          </h2>
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="session-context-open"
            aria-label={t('session.context.open')}
            disabled={view?.status !== 'ready'}
            onClick={() => setContextOpen(true)}
          >
            <ContextIcon />
          </button>
          <SessionActionsMenu
            open={menuOpen}
            disabled={view?.status !== 'ready' || view.turnActive}
            onToggle={() => setMenuOpen((value) => !value)}
            onSelect={(kind) => {
              setMenuOpen(false);
              if (kind === 'context') setContextOpen(true);
              else setAction({ kind, handle: view?.handle });
            }}
          />
          <button
            type="button"
            className="btn btn--secondary session-screen__model"
            data-testid="session-settings-open"
            aria-label={t('session.settings.open')}
            disabled={view?.status !== 'ready'}
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
            <span className="session-screen__model-name">
              {snapshot?.modelId ?? t('session.modelUnknown')}
            </span>
          </button>
        </div>
        {view?.cwd ? (
          <p className="session-screen__cwd" data-testid="session-cwd">
            {view.cwd}
          </p>
        ) : null}

        <UsageChip usage={view?.usage} />

        {!ready ? (
          <p
            className="sessions-notice sessions-notice--offline"
            role="status"
            data-testid="session-offline"
          >
            {t('session.offline')}
          </p>
        ) : null}

        {loading ? (
          <div data-testid="session-loading">
            <Skeleton lines={4} />
          </div>
        ) : null}

        {failed ? (
          <ErrorState
            title={t('session.loadFailedTitle')}
            message={t('session.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={
              connection
                ? () => {
                    void open(connection, id, readyEpoch);
                  }
                : undefined
            }
          />
        ) : null}

        {view?.status === 'ready' && view.hasMore ? (
          <div className="session-list__more">
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="session-load-older"
              disabled={view.loadingOlder}
              onClick={() => void loadOlder(id)}
            >
              {view.loadingOlder ? t('session.loadingOlder') : t('session.loadOlder')}
            </button>
          </div>
        ) : null}

        {view?.status === 'ready' && itemCount === 0 && !isMission ? (
          <EmptyState title={t('session.emptyTitle')} message={t('session.emptyMessage')} />
        ) : null}

        {view?.status === 'ready' && isMission ? (
          <MissionControl
            view={missionView}
            threadEmpty={itemCount === 0}
            thread={
              <Transcript
                items={items ?? []}
                retryDisabled={view.status !== 'ready'}
                onRetry={(itemId) => void retry(id, itemId)}
              />
            }
          />
        ) : null}

        {items && itemCount > 0 && !isMission ? (
          <Transcript
            items={items}
            retryDisabled={view?.status !== 'ready'}
            onRetry={(itemId) => void retry(id, itemId)}
          />
        ) : null}

        {view?.interrupted ? (
          <p
            className="sessions-notice sessions-notice--offline"
            role="status"
            data-testid="chat-interrupted"
          >
            {t('chat.connectionLost')}
          </p>
        ) : null}

        {away ? (
          <div className="chat-jump">
            <button
              type="button"
              className="btn btn--primary chat-jump__button"
              data-testid="chat-jump-latest"
              onClick={jumpToLatest}
            >
              {t('session.jumpToLatest')}
            </button>
          </div>
        ) : null}

        <ChatComposer
          queued={view?.queued ?? []}
          restored={view?.restored}
          onRestoredConsumed={(nonce) => consumeRestored(id, nonce)}
          onCancelQueued={(requestId) => void cancelQueued(id, requestId)}
          loadCommands={loadCommands}
          turnActive={Boolean(view?.turnActive) || awaitingApproval}
          workingState={awaitingApproval ? WAITING_STATE : (view?.workingState ?? 'idle')}
          disabled={view?.status !== 'ready'}
          stopInDialog={awaitingApproval}
          onSend={(text, attachments) => void send(id, text, attachments)}
          onInterrupt={() => void interrupt(id)}
        />
      </div>

      <SessionSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        handle={view?.handle}
      />
      <ContextUsageSheet
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        handle={view?.handle}
        refreshKey={contextRefreshKey}
      />
      {action?.kind === 'fork' ? (
        <ForkSheet
          handle={action.handle}
          onClose={() => setAction(null)}
          onForked={(newId) => {
            setAction(null);
            showToast(t('session.actions.fork.done'), 'success');
            navigate(`/sessions/${newId}`);
          }}
        />
      ) : null}
      {action?.kind === 'compact' ? (
        <CompactSheet
          handle={action.handle}
          onClose={() => setAction(null)}
          onCompacted={(result) => {
            if (result.newSessionId !== id) {
              navigate(`/sessions/${result.newSessionId}`);
            } else if (connection) {
              void open(connection, id, readyEpoch);
            }
          }}
        />
      ) : null}
      {action?.kind === 'rewind' ? (
        <RewindSheet
          handle={action.handle}
          onClose={() => setAction(null)}
          onRewound={(result) => navigate(`/sessions/${result.newSessionId}`)}
        />
      ) : null}
      <InteractionHost sessionId={id} />
    </section>
  );
}
