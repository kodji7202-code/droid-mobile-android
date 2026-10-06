import { useCallback, useState } from 'react';
import type {
  CustomModel,
  CustomModelInput,
  CustomModelTarget,
  DaemonConnection,
} from '@droidmobile/daemon-client';
import { logFailure } from '../../../diagnostics/failures';
import { appLog } from '../../../diagnostics/logBuffer';
import { redactError } from '../mcp/mcpStatus';
import { errorText, useDaemonRead } from '../plugins/useDaemonRead';

export type CustomModelAction = 'add' | 'edit' | 'remove';

export interface CustomModelActionError {
  action: CustomModelAction;
  name: string;
  /** The daemon's own text, secrets redacted; empty when it gave none. */
  message: string;
}

export interface CustomModelNotice {
  action: CustomModelAction;
  name: string;
}

export const modelLabel = (model: Pick<CustomModel, 'model' | 'displayName'>): string =>
  model.displayName?.trim() ? model.displayName : model.model;

const loadModels = (connection: DaemonConnection): Promise<CustomModel[]> =>
  connection.customModels.list();

/**
 * Custom model list plus add, edit and remove. Every change is followed by a
 * re-read, so the screen shows what the daemon now reports and never a guess.
 */
export function useCustomModels(connection: DaemonConnection | null) {
  const { state, refresh, retry } = useDaemonRead(connection, loadModels);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<CustomModelActionError | null>(null);
  const [notice, setNotice] = useState<CustomModelNotice | null>(null);

  const save = useCallback(
    async (input: CustomModelInput, target?: CustomModelTarget) => {
      if (!connection) return false;
      const action: CustomModelAction = target ? 'edit' : 'add';
      const name = input.displayName?.trim() ? input.displayName : input.model;
      setError(null);
      setNotice(null);
      setSaving(true);
      if (input.apiKey) appLog.registerSecret(input.apiKey);
      try {
        await connection.customModels.save(input, target);
        setNotice({ action, name });
        return true;
      } catch (cause) {
        logFailure('custom-model', cause);
        setError({ action, name, message: redactError(errorText(cause)) });
        return false;
      } finally {
        setSaving(false);
        await refresh();
      }
    },
    [connection, refresh],
  );

  const remove = useCallback(
    async (model: CustomModel) => {
      if (!connection) return;
      const name = modelLabel(model);
      const key = String(model.rawIndex);
      setError(null);
      setNotice(null);
      setRemoving((previous) => new Set(previous).add(key));
      try {
        await connection.customModels.remove({ rawIndex: model.rawIndex, model: model.model });
        setNotice({ action: 'remove', name });
      } catch (cause) {
        setError({ action: 'remove', name, message: redactError(errorText(cause)) });
      } finally {
        setRemoving((previous) => {
          const next = new Set(previous);
          next.delete(key);
          return next;
        });
        await refresh();
      }
    },
    [connection, refresh],
  );

  return {
    state,
    retry,
    saving,
    removing,
    error,
    notice,
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
    save,
    remove,
  };
}
