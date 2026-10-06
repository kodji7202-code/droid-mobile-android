import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '@droidmobile/daemon-client';

export function CommandRow({ command }: { command: SlashCommand }) {
  const { t } = useTranslation();
  const { name } = command;
  return (
    <li className="mcp-row" data-testid={`command-row-${name}`}>
      <div className="mcp-row__text">
        <span className="mcp-row__name">/{name}</span>
        <span
          className={command.description ? 'skill-row__description' : 'field__description'}
          data-testid={`command-description-${name}`}
        >
          {command.description || t('skills.noDescription')}
        </span>
        {command.argumentHint ? (
          <span className="mcp-row__meta">
            <span className="chip" data-testid={`command-hint-${name}`}>
              {command.argumentHint}
            </span>
          </span>
        ) : null}
      </div>
    </li>
  );
}
