import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConnectionStore } from '../../stores/connection';
import { useLockStore } from '../../stores/lock';
import { useAuthenticate } from './useAuthenticate';

type Problem = 'cancelled' | 'failed' | 'unavailable';

/**
 * Full-screen lock shown instead of the app until authentication succeeds.
 * The saved connection is restored (and the WebSocket opened) only after the
 * prompt succeeded, so nothing is fetched or rendered while locked.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const authenticate = useAuthenticate();
  const unlock = useLockStore((state) => state.unlock);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    const outcome = await authenticate('unlock');
    if (outcome === 'success') {
      if (useConnectionStore.getState().connection === null) {
        try {
          await useConnectionStore.getState().restore();
        } catch {
          // A failed restore falls through to the connect screen after unlocking.
        }
      }
      unlock();
      return;
    }
    busyRef.current = false;
    setBusy(false);
    setProblem(outcome);
  }, [authenticate, unlock]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <main
      className="screen screen--standalone lock-screen"
      data-testid="lock-screen"
      aria-labelledby="lock-title"
    >
      <h1 className="screen__title" id="lock-title">
        {t('lock.title')}
      </h1>
      <p className="screen__description">{t('lock.description')}</p>
      {problem ? (
        <p className="field__error" role="alert" data-testid="lock-error" data-problem={problem}>
          {t(`lock.${problem}`)}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn--primary"
        data-testid="lock-unlock"
        disabled={busy}
        onClick={() => void run()}
      >
        {problem ? t('lock.retry') : t('lock.unlock')}
      </button>
    </main>
  );
}
