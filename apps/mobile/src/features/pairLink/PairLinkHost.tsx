import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../components/Toast';
import { applyPairLink } from './applyPairLink';
import type { PairLinkOutcome } from './applyPairLink';
import { PairLinkDialog } from './PairLinkDialog';
import { usePairLinkStore } from './pairLinkStore';

interface PairLinkHostProps {
  navigate(to: string): void;
}

/**
 * Renders the confirmation dialog and the invalid-link message. Mounted inside the lock
 * gate, so a link that arrives while the app is locked waits in the store until unlock.
 */
export function PairLinkHost({ navigate }: PairLinkHostProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const pending = usePairLinkStore((state) => state.pending);
  const notice = usePairLinkStore((state) => state.notice);

  useEffect(() => {
    if (notice === null) return;
    usePairLinkStore.getState().clearNotice();
    showToast(
      t(notice.error === 'insecure' ? 'pairLink.errorInsecure' : 'pairLink.errorInvalid'),
      'error',
    );
  }, [notice, showToast, t]);

  if (pending === null) return null;

  const report = (outcome: PairLinkOutcome) => {
    switch (outcome.kind) {
      case 'connect-screen':
        return;
      case 'add-form':
        navigate('/settings/connection');
        return;
      case 'error':
        showToast(t(outcome.messageKey), 'error');
        return;
      default:
        navigate('/sessions');
        showToast(t(`pairLink.${outcome.kind}`, { host: outcome.host }), 'success');
    }
  };

  const onConfirm = () => {
    const { payload } = pending;
    usePairLinkStore.getState().dismiss();
    void applyPairLink(payload).then(report);
  };

  return (
    <PairLinkDialog
      summary={pending.summary}
      onConfirm={onConfirm}
      onCancel={() => usePairLinkStore.getState().dismiss()}
    />
  );
}
