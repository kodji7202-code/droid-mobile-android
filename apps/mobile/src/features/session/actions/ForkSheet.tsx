import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionHandle } from '@droidmobile/daemon-client';
import { Sheet } from '../../../components/Sheet';

interface ForkSheetProps {
  handle: SessionHandle | undefined;
  onClose(): void;
  /** Called with the id of the new, independent session. */
  onForked(newSessionId: string): void;
}

export function ForkSheet({ handle, onClose, onForked }: ForkSheetProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!handle || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const trimmed = title.trim();
      const result = await handle.fork(trimmed === '' ? undefined : { title: trimmed });
      onForked(result.newSessionId);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={busy ? () => undefined : onClose}
      title={t('session.actions.fork.title')}
      testId="session-fork"
    >
      <form className="field" onSubmit={(event) => void submit(event)}>
        <p className="session-actions__hint">{t('session.actions.fork.hint')}</p>
        <label className="field__label" htmlFor="session-fork-title">
          {t('session.actions.fork.titleLabel')}
        </label>
        <input
          id="session-fork-title"
          className="field__control"
          data-testid="session-fork-title"
          value={title}
          placeholder={t('session.actions.fork.titlePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        {failed ? (
          <p className="field__error" role="alert" data-testid="session-fork-error">
            {t('session.actions.fork.failed')}
          </p>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="session-fork-confirm"
          disabled={busy || !handle}
        >
          {busy ? t('session.actions.fork.working') : t('session.actions.fork.confirm')}
        </button>
      </form>
    </Sheet>
  );
}
