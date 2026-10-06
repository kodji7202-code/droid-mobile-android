import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CustomModel } from '@droidmobile/daemon-client';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { Skeleton } from '../../../components/Skeleton';
import { useConnectionStore } from '../../../stores/connection';
import { ExtensionList } from '../ExtensionList';
import { ExtensionsSubHeader } from '../ExtensionsSubHeader';
import { ActionMessage } from '../plugins/ActionMessage';
import { CustomModelRow } from './CustomModelRow';
import { CustomModelSheet } from './CustomModelSheet';
import { modelLabel, useCustomModels } from './useCustomModels';

type FormTarget = { kind: 'add' } | { kind: 'edit'; model: CustomModel };

/** Extensions > Custom models: the daemon's bring-your-own-key models with add, edit and delete. */
export function CustomModelsScreen() {
  const { t } = useTranslation();
  const connection = useConnectionStore((state) => state.connection);
  const models = useCustomModels(connection);
  const [form, setForm] = useState<FormTarget | null>(null);
  const [deleting, setDeleting] = useState<CustomModel | null>(null);
  const { state, error, notice } = models;
  const list = state.status === 'ready' ? state.data : [];
  const saveFailure = error && error.action !== 'remove' ? error : null;
  const removeFailure = error?.action === 'remove' ? error : null;
  const editing = form?.kind === 'edit' ? form.model : null;

  const openForm = (target: FormTarget) => {
    models.dismissError();
    setForm(target);
  };

  const addButton = (
    <button
      type="button"
      className="btn btn--primary"
      data-testid="custom-model-add"
      onClick={() => openForm({ kind: 'add' })}
    >
      {t('customModels.add')}
    </button>
  );

  const confirmDelete = () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    void models.remove(target);
  };

  return (
    <section
      className="screen"
      data-testid="custom-models-screen"
      aria-label={t('extensions.customModels.title')}
    >
      <ExtensionsSubHeader
        title={t('extensions.customModels.title')}
        backTo="/extensions"
        actions={state.status === 'ready' && list.length > 0 ? addButton : null}
      />
      {state.status === 'loading' ? (
        <div
          role="status"
          data-testid="custom-models-loading"
          aria-label={t('customModels.loading')}
        >
          <Skeleton />
        </div>
      ) : null}
      {state.status === 'error' ? (
        <div data-testid="custom-models-error">
          <ErrorState
            title={t('customModels.loadFailedTitle')}
            message={t('customModels.loadFailed')}
            onRetry={models.retry}
            retryLabel={t('common.retry')}
          />
        </div>
      ) : null}
      {removeFailure ? (
        <ActionMessage
          kind="error"
          testId="custom-models-action-error"
          detail={removeFailure.message}
          onDismiss={models.dismissError}
        >
          {t('customModels.errors.remove', { name: removeFailure.name })}
        </ActionMessage>
      ) : null}
      {notice ? (
        <ActionMessage
          kind="success"
          testId="custom-models-notice"
          onDismiss={models.dismissNotice}
        >
          {t(`customModels.notices.${notice.action}`, { name: notice.name })}
        </ActionMessage>
      ) : null}
      {state.status === 'ready' ? (
        <ExtensionList
          testId="custom-models-list"
          label={t('extensions.customModels.title')}
          empty={
            list.length === 0
              ? {
                  testId: 'custom-models-empty',
                  content: (
                    <EmptyState
                      title={t('customModels.empty.title')}
                      message={t('customModels.empty.message')}
                      action={addButton}
                    />
                  ),
                }
              : null
          }
        >
          {list.map((model) => (
            <CustomModelRow
              key={`${model.rawIndex}:${model.model}`}
              model={model}
              busy={models.removing.has(String(model.rawIndex))}
              onEdit={() => openForm({ kind: 'edit', model })}
              onDelete={() => setDeleting(model)}
            />
          ))}
        </ExtensionList>
      ) : null}
      <CustomModelSheet
        key={editing ? `${editing.rawIndex}:${editing.model}` : 'add'}
        open={form !== null}
        onClose={() => setForm(null)}
        editing={editing}
        otherModels={list
          .filter((model) => model.rawIndex !== editing?.rawIndex)
          .map((model) => model.model)}
        onSubmit={models.save}
        saving={models.saving}
        error={saveFailure}
        onDismissError={models.dismissError}
      />
      <ConfirmDialog
        open={deleting !== null}
        testId="custom-model-delete-dialog"
        title={t('customModels.deleteConfirm.title', {
          name: deleting ? modelLabel(deleting) : '',
        })}
        message={t('customModels.deleteConfirm.message', {
          name: deleting ? modelLabel(deleting) : '',
        })}
        confirmLabel={t('customModels.delete')}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
