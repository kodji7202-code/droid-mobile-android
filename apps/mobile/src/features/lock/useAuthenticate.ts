import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { BiometricOutcome } from '../../platform/biometrics';
import { useLockStore } from '../../stores/lock';

export type AuthReason = 'unlock' | 'enable' | 'disable' | 'reveal';

/** Shows the system prompt with a localized title for the given purpose. */
export function useAuthenticate(): (reason: AuthReason) => Promise<BiometricOutcome> {
  const { t } = useTranslation();
  const authenticate = useLockStore((state) => state.authenticate);
  return useCallback(
    (reason) => authenticate(t(`lock.reason.${reason}`), t('common.cancel'), t('lock.promptTitle')),
    [authenticate, t],
  );
}
