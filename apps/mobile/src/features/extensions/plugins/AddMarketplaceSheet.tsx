import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '../../../components/Sheet';
import { ActionMessage } from './ActionMessage';
import { validateMarketplaceRepo } from './pluginLogic';

interface AddMarketplaceSheetProps {
  open: boolean;
  onClose: () => void;
  /** Resolves true when the daemon added the marketplace. */
  onSubmit: (repo: string) => Promise<boolean>;
  adding: boolean;
  /** The daemon's refusal of the last submission, when there was one. */
  error: { message: string } | null;
  onDismissError: () => void;
}

function AddMarketplaceForm({
  onClose,
  onSubmit,
  adding,
  error,
  onDismissError,
}: Omit<AddMarketplaceSheetProps, 'open'>) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateMarketplaceRepo(value);
    if (!result.ok) {
      setFieldError(result.error);
      return;
    }
    setFieldError(null);
    if (await onSubmit(result.repo)) onClose();
  };

  return (
    <form className="mcp-form" noValidate onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label className="field__label" htmlFor="marketplace-add-repo">
          {t('marketplaces.form.repo')}
        </label>
        <input
          id="marketplace-add-repo"
          type="text"
          className="field__control"
          data-testid="marketplace-add-repo"
          value={value}
          placeholder="Factory-AI/factory-plugins"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? 'marketplace-add-repo-error' : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setFieldError(null);
          }}
        />
        {fieldError ? (
          <span
            className="field__error"
            id="marketplace-add-repo-error"
            role="alert"
            data-testid="marketplace-add-repo-error"
          >
            {t(`marketplaces.form.errors.${fieldError}`)}
          </span>
        ) : (
          <span className="field__description">{t('marketplaces.form.hint')}</span>
        )}
      </div>
      {error && !adding ? (
        <ActionMessage
          kind="error"
          testId="marketplace-add-error"
          detail={error.message}
          onDismiss={onDismissError}
        >
          {t('marketplaces.errors.add')}
        </ActionMessage>
      ) : null}
      <div className="mcp-form__actions">
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          className="btn btn--primary"
          data-testid="marketplace-add-submit"
          disabled={adding}
        >
          {adding ? t('marketplaces.form.adding') : t('marketplaces.form.save')}
        </button>
      </div>
    </form>
  );
}

/** Add-marketplace form for a GitHub repository (`owner/repo`). */
export function AddMarketplaceSheet({ open, onClose, ...rest }: AddMarketplaceSheetProps) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('marketplaces.form.title')}
      testId="marketplace-add-sheet"
    >
      <AddMarketplaceForm onClose={onClose} {...rest} />
    </Sheet>
  );
}
