import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelSummary } from '@droidmobile/daemon-client';
import { Sheet } from '../../components/Sheet';
import { filterModels } from './settingsLogic';
import type { ModelsState } from './useSessionSettings';

interface ModelPickerProps {
  /** Prefix of the test ids: `<testId>` is the opener, `<testId>-search` the search field. */
  testId: string;
  label: string;
  value: string | undefined;
  models: ModelsState;
  onRetry: () => void;
  onSelect: (model: ModelSummary) => void;
  disabled?: boolean;
}

/** Opens a searchable list of every model the daemon offers. */
export function ModelPicker({
  testId,
  label,
  value,
  models,
  onRetry,
  onSelect,
  disabled,
}: ModelPickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const all = models.status === 'ready' ? models.models : [];
  const current = all.find((model) => model.id === value);
  const shown = filterModels(all, query);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="field">
      <span className="field__label" id={`${testId}-label`}>
        {label}
      </span>
      <button
        type="button"
        className="btn btn--secondary session-settings__value"
        data-testid={testId}
        aria-labelledby={`${testId}-label ${testId}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {current?.displayName ?? value ?? t('session.modelUnknown')}
      </button>
      <Sheet open={open} onClose={close} title={label} testId={`${testId}-picker`}>
        <div className="field">
          <input
            type="search"
            className="field__control"
            data-testid={`${testId}-search`}
            aria-label={t('session.settings.searchModels')}
            placeholder={t('session.settings.searchModels')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {models.status === 'loading' ? (
          <p role="status" data-testid={`${testId}-loading`}>
            {t('session.settings.modelsLoading')}
          </p>
        ) : null}
        {models.status === 'error' ? (
          <div role="alert" data-testid={`${testId}-error`}>
            <p>{t('session.settings.modelsFailed')}</p>
            <button type="button" className="btn btn--secondary" onClick={onRetry}>
              {t('common.retry')}
            </button>
          </div>
        ) : null}
        {models.status === 'ready' && shown.length === 0 ? (
          <p data-testid={`${testId}-empty`}>{t('session.settings.noModels', { query })}</p>
        ) : null}
        <ul className="model-list" data-testid={`${testId}-list`}>
          {shown.map((model) => {
            const selected = model.id === value;
            return (
              <li key={model.id}>
                <button
                  type="button"
                  className={`btn btn--ghost model-list__row${selected ? ' model-list__row--selected' : ''}`}
                  data-testid={`${testId}-option-${model.id}`}
                  aria-pressed={selected}
                  onClick={() => {
                    close();
                    onSelect(model);
                  }}
                >
                  <span className="model-list__name">{model.displayName}</span>
                  <span className="model-list__provider">{model.provider}</span>
                  {selected ? (
                    <span className="model-list__current">{t('session.settings.current')}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}
