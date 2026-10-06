import { useTranslation } from 'react-i18next';
import type { CustomModel } from '@droidmobile/daemon-client';
import { modelLabel } from './useCustomModels';

interface CustomModelRowProps {
  model: CustomModel;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

/** One custom model. The key is shown only as the daemon's mask; there is no way to read or copy it. */
export function CustomModelRow({ model, busy, onEdit, onDelete }: CustomModelRowProps) {
  const { t } = useTranslation();
  const id = model.model;
  const label = modelLabel(model);
  return (
    <li className="mcp-row" data-testid={`custom-model-row-${id}`}>
      <div className="mcp-row__main">
        <span className="mcp-row__text">
          <span className="mcp-row__name" data-testid={`custom-model-name-${id}`}>
            {label}
          </span>
          <span className="mcp-row__meta">
            <span className="chip" data-testid={`custom-model-provider-${id}`}>
              {t(`customModels.providers.${model.provider}`, { defaultValue: model.provider })}
            </span>
            <span className="mcp-row__tools" data-testid={`custom-model-id-${id}`}>
              {model.model}
            </span>
            {!model.isValid ? (
              <span className="chip" data-testid={`custom-model-invalid-${id}`}>
                {t('customModels.invalid')}
              </span>
            ) : null}
          </span>
          {model.baseUrl ? (
            <span className="mcp-row__meta">
              <span className="mcp-row__tools" data-testid={`custom-model-url-${id}`}>
                {model.baseUrl}
              </span>
            </span>
          ) : null}
          <span className="mcp-row__meta">
            <span className="mcp-row__tools" data-testid={`custom-model-key-${id}`}>
              {model.hasApiKey
                ? t('customModels.key.set', { mask: model.apiKeyMask ?? '' })
                : t('customModels.key.none')}
            </span>
          </span>
        </span>
      </div>
      <div className="mcp-row__actions">
        {busy ? (
          <span
            className="spinner"
            role="status"
            aria-label={t('customModels.working')}
            data-testid={`custom-model-pending-${id}`}
          />
        ) : null}
        <button
          type="button"
          className="btn btn--secondary"
          data-testid={`custom-model-edit-${id}`}
          aria-label={t('customModels.editLabel', { name: label })}
          disabled={busy}
          onClick={onEdit}
        >
          {t('customModels.edit')}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          data-testid={`custom-model-delete-${id}`}
          aria-label={t('customModels.deleteLabel', { name: label })}
          disabled={busy}
          onClick={onDelete}
        >
          {t('customModels.delete')}
        </button>
      </div>
    </li>
  );
}
