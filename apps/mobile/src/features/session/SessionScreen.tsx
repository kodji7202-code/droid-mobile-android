import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useConnectionStore } from '../../stores/connection';
import { useSessionViewStore } from '../../stores/sessionView';
import { toHistory } from './history';

/** Last path segment of a working directory, for a compact header title. */
function folderName(cwd: string | undefined): string | undefined {
  const name = cwd?.split(/[\\/]/).filter(Boolean).pop();
  return name === '' ? undefined : name;
}

export function SessionScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const connection = useConnectionStore((state) => state.connection);
  const status = useConnectionStore((state) => state.status);
  const readyEpoch = useConnectionStore((state) => state.readyEpoch);
  const ready = status === 'ready';
  const view = useSessionViewStore((state) => state.views[id]);
  const open = useSessionViewStore((state) => state.open);
  const loadOlder = useSessionViewStore((state) => state.loadOlder);

  useEffect(() => {
    if (ready && connection && id !== '') {
      void open(connection, id, readyEpoch);
    }
  }, [ready, connection, id, readyEpoch, open]);

  const history = useMemo(() => toHistory(view?.messages ?? []), [view?.messages]);
  const loading = view === undefined ? ready : view.status === 'loading';
  const failed = view?.status === 'error';
  const title = folderName(view?.cwd) ?? t('session.title');

  return (
    <section
      className="screen session-screen"
      data-testid="session-screen"
      aria-labelledby="session-title"
    >
      <div className="sub-header">
        <button
          type="button"
          className="btn btn--ghost sub-header__back"
          data-testid="session-back"
          aria-label={t('common.back')}
          onClick={() => navigate('/sessions')}
        >
          <BackIcon />
        </button>
        <h2 className="sub-header__title" id="session-title" data-testid="session-title">
          {title}
        </h2>
        <select
          className="field__control session-screen__model"
          data-testid="session-model-select"
          aria-label={t('session.model')}
          value={view?.modelId ?? ''}
          disabled
        >
          {view?.modelId ? (
            <option value={view.modelId}>{view.modelId}</option>
          ) : (
            <option value="">{t('session.modelUnknown')}</option>
          )}
        </select>
      </div>
      {view?.cwd ? (
        <p className="session-screen__cwd" data-testid="session-cwd">
          {view.cwd}
        </p>
      ) : null}

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

      {view?.status === 'ready' && history.length === 0 ? (
        <EmptyState title={t('session.emptyTitle')} message={t('session.emptyMessage')} />
      ) : null}

      {history.length > 0 ? (
        <ol className="session-messages" data-testid="session-messages">
          {history.map((message, index) => (
            <li
              key={message.id}
              className={`session-message session-message--${message.role}`}
              data-testid={`msg-${message.role}-${index}`}
            >
              <span className="session-message__role">
                {message.role === 'user' ? t('session.roleUser') : t('session.roleAssistant')}
              </span>
              <p className="session-message__text">{message.text}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
