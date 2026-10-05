import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CompactResult, SessionHandle } from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';

type Stage =
  | { kind: 'confirm' }
  | { kind: 'running' }
  | { kind: 'failed' }
  | { kind: 'done'; result: CompactResult };

interface CompactSheetProps {
  handle: SessionHandle | undefined;
  onClose(): void;
  /** Called with the result as soon as the daemon finished, to show the successor session. */
  onCompacted(result: CompactResult): void;
}

export function CompactSheet({ handle, onClose, onCompacted }: CompactSheetProps) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>({ kind: 'confirm' });
  const [instructions, setInstructions] = useState('');

  const run = async () => {
    if (!handle) return;
    setStage({ kind: 'running' });
    try {
      const trimmed = instructions.trim();
      const result = await handle.compact(trimmed === '' ? undefined : trimmed);
      setStage({ kind: 'done', result });
      onCompacted(result);
    } catch {
      setStage({ kind: 'failed' });
    }
  };

  const running = stage.kind === 'running';

  return (
    <Sheet
      open
      onClose={running ? () => undefined : onClose}
      title={t('session.actions.compact.title')}
      testId="session-compact"
    >
      {stage.kind === 'confirm' || stage.kind === 'failed' ? (
        <div className="field">
          <p className="session-actions__hint">{t('session.actions.compact.hint')}</p>
          <label className="field__label" htmlFor="session-compact-instructions">
            {t('session.actions.compact.instructionsLabel')}
          </label>
          <textarea
            id="session-compact-instructions"
            className="field__control"
            data-testid="session-compact-instructions"
            rows={3}
            value={instructions}
            placeholder={t('session.actions.compact.instructionsPlaceholder')}
            onChange={(event) => setInstructions(event.target.value)}
          />
          {stage.kind === 'failed' ? (
            <p className="field__error" role="alert" data-testid="session-compact-error">
              {t('session.actions.compact.failed')}
            </p>
          ) : null}
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="session-compact-cancel"
              onClick={onClose}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="session-compact-confirm"
              disabled={!handle}
              onClick={() => void run()}
            >
              {t('session.actions.compact.confirm')}
            </button>
          </div>
        </div>
      ) : null}

      {running ? (
        <div
          role="status"
          className="session-actions__progress"
          data-testid="session-compact-progress"
        >
          <span className="session-actions__spinner" aria-hidden="true" />
          {t('session.actions.compact.progress')}
        </div>
      ) : null}

      {stage.kind === 'done' ? (
        <div className="field" data-testid="session-compact-result">
          <p
            role="status"
            data-testid="session-compact-removed"
            data-removed={stage.result.removedCount}
          >
            {t('session.actions.compact.removed', { count: stage.result.removedCount })}
          </p>
          <p className="session-actions__hint" data-testid="session-compact-successor">
            {t('session.actions.compact.successor', { id: stage.result.newSessionId })}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="session-compact-done"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
