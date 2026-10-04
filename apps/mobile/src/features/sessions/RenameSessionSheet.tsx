import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../components/Sheet';

interface RenameSessionSheetProps {
  initialTitle: string;
  busy: boolean;
  onSubmit(title: string): void;
  onClose(): void;
}

export function RenameSessionSheet({
  initialTitle,
  busy,
  onSubmit,
  onClose,
}: RenameSessionSheetProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initialTitle);
  const trimmed = title.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed !== '' && !busy) {
      onSubmit(trimmed);
    }
  };

  return (
    <Sheet open onClose={onClose} title={t('sessions.renameTitle')} testId="session-rename-sheet">
      <form className="field" onSubmit={submit}>
        <label className="field__label" htmlFor="session-rename-input">
          {t('sessions.renameLabel')}
        </label>
        <input
          id="session-rename-input"
          className="field__control"
          data-testid="session-rename-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="session-rename-save"
          disabled={trimmed === '' || busy}
        >
          {t('sessions.renameSave')}
        </button>
      </form>
    </Sheet>
  );
}
