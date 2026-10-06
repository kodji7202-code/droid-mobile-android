import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '@droidmobile/daemon-client';
import type { SlashState } from './useSlashAutocomplete';

interface SlashPopupProps {
  state: SlashState;
  matches: readonly SlashCommand[];
  active: number;
  onPick(command: SlashCommand): void;
}

export function SlashPopup({ state, matches, active, onPick }: SlashPopupProps) {
  const { t } = useTranslation();
  if (state.status === 'loading') {
    return (
      <p
        className="slash-popup__note"
        role="status"
        aria-label={t('chat.slash.loading')}
        data-testid="chat-slash-loading"
      >
        {t('chat.slash.loading')}
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <p className="slash-popup__note" role="alert" data-testid="chat-slash-error">
        {t('chat.slash.loadFailed')}
      </p>
    );
  }
  if (matches.length === 0) {
    return (
      <p className="slash-popup__note" role="status" data-testid="chat-slash-empty">
        {t('chat.slash.noMatch')}
      </p>
    );
  }
  return (
    <ul
      className="slash-popup"
      role="listbox"
      aria-label={t('chat.slash.label')}
      data-testid="chat-slash-popup"
    >
      {matches.map((command, index) => (
        <li key={command.name} role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            className={`slash-popup__item${index === active ? ' slash-popup__item--active' : ''}`}
            data-testid={`chat-slash-item-${command.name}`}
            // Keeps focus (and the soft keyboard) in the textarea while choosing.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(command)}
          >
            <span className="slash-popup__name">
              /{command.name}
              {command.argumentHint ? (
                <span className="slash-popup__hint">{command.argumentHint}</span>
              ) : null}
            </span>
            <span className="slash-popup__description">{command.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
