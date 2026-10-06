import { useTranslation } from 'react-i18next';
import type { McpServer } from '@droidmobile/daemon-client';
import { statusBadge } from './mcpStatus';

/** Status of one server as text (never colour alone), with the daemon's raw value as data. */
export function McpStatusBadge({ server }: { server: McpServer }) {
  const { t } = useTranslation();
  const badge = statusBadge(server);
  return (
    <span
      className={`badge badge--${badge.tone}`}
      data-testid={`mcp-status-${server.name}`}
      data-status={server.status}
    >
      {badge.labelKey === null ? badge.label : t(badge.labelKey)}
    </span>
  );
}
