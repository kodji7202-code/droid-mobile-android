import { useTranslation } from 'react-i18next';
import type { TokenUsage } from '@droidmobile/daemon-client';

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** Compact input/output token totals for the session, shown once a turn has reported them. */
export function UsageChip({ usage }: { usage: TokenUsage | undefined }) {
  const { t } = useTranslation();
  if (!usage) return null;
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  return (
    <p
      className="session-screen__usage"
      role="status"
      aria-label={t('chat.usage.label')}
      data-testid="session-usage"
      data-input-tokens={input}
      data-output-tokens={output}
    >
      {t('chat.usage.summary', {
        input: input.toLocaleString(),
        output: output.toLocaleString(),
      })}
    </p>
  );
}
