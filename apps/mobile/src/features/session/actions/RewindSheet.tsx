import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RewindInfo, RewindResult, SessionHandle } from '@droidmobile/daemon-client';
import { ErrorState } from '../../../components/ErrorState';
import { Sheet } from '../../../components/Sheet';
import { Skeleton } from '../../../components/Skeleton';
import { RewindInfoView } from './RewindInfoView';
import { RewindResultView } from './RewindResultView';
import { defaultRewindTitle, loadAllMessages, rewindEntries, rewindParams } from './rewindLogic';
import type { RewindEntry } from './rewindLogic';

type Stage =
  | { kind: 'loading' }
  | { kind: 'list-failed' }
  | { kind: 'list'; entries: RewindEntry[] }
  | { kind: 'info-loading'; entries: RewindEntry[]; entry: RewindEntry }
  | { kind: 'info-failed'; entries: RewindEntry[]; entry: RewindEntry }
  | { kind: 'confirm'; entries: RewindEntry[]; entry: RewindEntry; info: RewindInfo }
  | { kind: 'running' }
  | { kind: 'failed'; entries: RewindEntry[]; entry: RewindEntry; info: RewindInfo }
  | { kind: 'done'; result: RewindResult };

interface RewindSheetProps {
  handle: SessionHandle | undefined;
  onClose(): void;
  /** Called with the result as soon as the daemon finished, to show the new session. */
  onRewound(result: RewindResult): void;
}

export function RewindSheet({ handle, onClose, onRewound }: RewindSheetProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [title, setTitle] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!handle) return undefined;
    let cancelled = false;
    setStage({ kind: 'loading' });
    loadAllMessages(handle).then(
      (messages) => {
        if (!cancelled) setStage({ kind: 'list', entries: rewindEntries(messages) });
      },
      () => {
        if (!cancelled) setStage({ kind: 'list-failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [handle, attempt]);

  const choose = async (entries: RewindEntry[], entry: RewindEntry) => {
    if (!handle) return;
    setStage({ kind: 'info-loading', entries, entry });
    try {
      const info = await handle.getRewindInfo(entry.id);
      setTitle(
        defaultRewindTitle(
          entry.context ? '' : entry.preview,
          t('session.actions.rewind.titlePrefix'),
        ),
      );
      setStage({ kind: 'confirm', entries, entry, info });
    } catch {
      setStage({ kind: 'info-failed', entries, entry });
    }
  };

  const execute = async (entries: RewindEntry[], entry: RewindEntry, info: RewindInfo) => {
    if (!handle) return;
    setStage({ kind: 'running' });
    try {
      const result = await handle.rewind(rewindParams(entry.id, info, title.trim()));
      setStage({ kind: 'done', result });
      onRewound(result);
    } catch {
      setStage({ kind: 'failed', entries, entry, info });
    }
  };

  const running = stage.kind === 'running';
  const trimmedTitle = title.trim();

  return (
    <Sheet
      open
      onClose={running ? () => undefined : onClose}
      title={t('session.actions.rewind.title')}
      testId="session-rewind"
    >
      {stage.kind === 'loading' ? (
        <div data-testid="session-rewind-loading">
          <Skeleton lines={4} />
        </div>
      ) : null}

      {stage.kind === 'list-failed' ? (
        <ErrorState
          title={t('session.actions.rewind.listFailedTitle')}
          message={t('session.actions.rewind.listFailed')}
          retryLabel={t('common.retry')}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : null}

      {stage.kind === 'list' ? (
        <div data-testid="session-rewind-list" data-count={stage.entries.length}>
          <p className="session-actions__hint">{t('session.actions.rewind.pick')}</p>
          <ul className="session-actions__entries">
            {stage.entries.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className="btn btn--secondary session-actions__entry"
                  data-testid={`session-rewind-entry-${index}`}
                  data-message-id={entry.id}
                  onClick={() => void choose(stage.entries, entry)}
                >
                  {entry.context ? t('session.actions.rewind.contextEntry') : entry.preview}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {stage.kind === 'info-loading' ? (
        <div data-testid="session-rewind-info-loading">
          <Skeleton lines={3} />
        </div>
      ) : null}

      {stage.kind === 'info-failed' ? (
        <ErrorState
          title={t('session.actions.rewind.infoFailedTitle')}
          message={t('session.actions.rewind.infoFailed')}
          retryLabel={t('common.retry')}
          onRetry={() => void choose(stage.entries, stage.entry)}
        />
      ) : null}

      {stage.kind === 'confirm' || stage.kind === 'failed' ? (
        <div className="field" data-testid="session-rewind-confirm-step">
          <RewindInfoView info={stage.info} />
          <label className="field__label" htmlFor="session-rewind-title">
            {t('session.actions.rewind.titleLabel')}
          </label>
          <input
            id="session-rewind-title"
            className="field__control"
            data-testid="session-rewind-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          {stage.kind === 'failed' ? (
            <p className="field__error" role="alert" data-testid="session-rewind-error">
              {t('session.actions.rewind.failed')}
            </p>
          ) : null}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--ghost"
              data-testid="session-rewind-back"
              onClick={() => setStage({ kind: 'list', entries: stage.entries })}
            >
              {t('common.back')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="session-rewind-cancel"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="session-rewind-confirm"
              disabled={trimmedTitle === ''}
              onClick={() => void execute(stage.entries, stage.entry, stage.info)}
            >
              {t('session.actions.rewind.confirm')}
            </button>
          </div>
        </div>
      ) : null}

      {running ? (
        <div
          role="status"
          className="session-actions__progress"
          data-testid="session-rewind-progress"
        >
          <span className="session-actions__spinner" aria-hidden="true" />
          {t('session.actions.rewind.progress')}
        </div>
      ) : null}

      {stage.kind === 'done' ? (
        <>
          <RewindResultView result={stage.result} />
          <button
            type="button"
            className="btn btn--primary"
            data-testid="session-rewind-done"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </>
      ) : null}
    </Sheet>
  );
}
