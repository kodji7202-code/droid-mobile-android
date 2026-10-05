import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DaemonConnection,
  ModelSummary,
  SessionHandle,
  SessionSettingsSnapshot,
  SettingsPatch,
} from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';

const APPLY_TIMEOUT_MS = 12_000;

/**
 * Follows the settings the SDK session holds for the daemon. The SDK merges
 * the daemon's settings_updated notifications into that copy, so a local read
 * on a short interval picks up external changes without any network traffic.
 */
export function useSettingsSnapshot(handle: SessionHandle | undefined, intervalMs: number) {
  const [snapshot, setSnapshot] = useState<SessionSettingsSnapshot | undefined>(
    () => handle?.settingsSnapshot,
  );

  const refresh = useCallback(() => {
    const next = handle?.settingsSnapshot;
    setSnapshot((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, [handle]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  return { snapshot, refresh };
}

export type SettingsField = keyof SettingsPatch;

export type ModelsState =
  { status: 'loading' } | { status: 'ready'; models: ModelSummary[] } | { status: 'error' };

export function useModels(connection: DaemonConnection | null, enabled: boolean) {
  const [state, setState] = useState<ModelsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !connection) return undefined;
    let cancelled = false;
    setState({ status: 'loading' });
    connection.listModels().then(
      (models) => {
        if (!cancelled) setState({ status: 'ready', models });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connection, enabled, attempt]);

  return { state, reload: () => setAttempt((n) => n + 1) };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Applies settings changes through the daemon. A change is only reflected in
 * `snapshot` once the daemon accepted it; until then `pending` holds the
 * choice, and a failure leaves the daemon's value in place with `failed` set.
 */
export function useApplySettings(
  handle: SessionHandle | undefined,
  refresh: () => void,
  open: boolean,
): {
  pending: SettingsPatch;
  failed: boolean;
  apply: (patch: SettingsPatch) => Promise<void>;
} {
  const [pending, setPending] = useState<SettingsPatch>({});
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  const status = useConnectionStore((state) => state.status);

  useEffect(() => {
    if (!open || status === 'ready') setFailed(false);
  }, [open, status]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const apply = useCallback(
    async (patch: SettingsPatch) => {
      if (!handle) return;
      setFailed(false);
      setPending((previous) => ({ ...previous, ...patch }));
      try {
        if (useConnectionStore.getState().status !== 'ready') throw new Error('offline');
        await withTimeout(handle.applySettings(patch), APPLY_TIMEOUT_MS);
      } catch {
        if (mounted.current) setFailed(true);
      } finally {
        if (mounted.current) {
          setPending((previous) => {
            const rest = { ...previous };
            for (const key of Object.keys(patch) as SettingsField[]) delete rest[key];
            return rest;
          });
          refresh();
        }
      }
    },
    [handle, refresh],
  );

  return { pending, failed, apply };
}
