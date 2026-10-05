import { useTranslation } from 'react-i18next';
import { exitSpecPlan, permissionOptionValues } from '@droidmobile/daemon-client';
import { MarkdownView } from '../../components/MarkdownView';
import type { PendingInteraction } from '../../stores/interactions';

type PermissionEntry = Extract<PendingInteraction, { kind: 'permission' }>;

const CANCEL = 'cancel';
const KNOWN_OPTIONS = new Set([
  'proceed_once',
  'proceed_auto_run_low',
  'proceed_auto_run_medium',
  'proceed_auto_run_high',
  'proceed_auto_run',
  'proceed_new_session',
  'proceed_new_session_low',
  'proceed_new_session_medium',
  'proceed_new_session_high',
  CANCEL,
]);

/**
 * The end of a Spec mode turn: the daemon is blocked until one of its own
 * options is chosen, so there is no backdrop dismiss and every button maps to
 * an option value it sent.
 */
export function ExitSpecDialog({
  entry,
  onChoose,
  onStop,
}: {
  entry: PermissionEntry;
  onChoose(value: string): void;
  onStop(): void;
}) {
  const { t } = useTranslation();
  const spec = exitSpecPlan(entry.request);
  const labels = new Map(
    entry.request.options.map((option) => [String(option.value), option.label]),
  );
  const values = permissionOptionValues(entry.request);
  const choices = values.filter((value) => value !== CANCEL);

  return (
    <div className="dialog-backdrop" data-testid="permission-backdrop">
      <div
        className="dialog interaction-dialog interaction-dialog--spec"
        data-testid="permission-dialog"
        data-permission-type="exit_spec_mode"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.exitSpec.title')}
      >
        <h2 className="dialog__title">{spec?.title || t('chat.exitSpec.title')}</h2>
        <div className="interaction-dialog__scroll">
          <div data-testid="permission-plan">
            {spec?.plan ? (
              <MarkdownView text={spec.plan} />
            ) : (
              <p className="tool-card__label">{t('chat.exitSpec.noPlan')}</p>
            )}
          </div>
        </div>
        <div className="dialog__actions interaction-dialog__actions interaction-dialog__actions--stack">
          {choices.map((value) => (
            <button
              key={value}
              type="button"
              className={value === 'proceed_once' ? 'btn btn--primary' : 'btn btn--secondary'}
              data-testid={`exit-spec-option-${value}`}
              onClick={() => onChoose(value)}
            >
              {KNOWN_OPTIONS.has(value)
                ? t(`chat.exitSpec.option.${value}`)
                : (labels.get(value) ?? value)}
            </button>
          ))}
          <button
            type="button"
            className="btn btn--secondary"
            data-testid="chat-interrupt"
            onClick={onStop}
          >
            {t('chat.interrupt')}
          </button>
          {values.includes(CANCEL) ? (
            <button
              type="button"
              className="btn btn--secondary"
              data-testid="permission-deny"
              onClick={() => onChoose(CANCEL)}
            >
              {t('chat.exitSpec.option.cancel')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
