import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface ChatComposerProps {
  turnActive: boolean;
  workingState: string;
  disabled: boolean;
  /** Stop lives in the open request dialog, which covers the composer. */
  stopInDialog?: boolean;
  onSend(text: string): void;
  onInterrupt(): void;
}

export const WAITING_STATE = 'waiting_for_tool_confirmation';
const KNOWN_STATES = ['thinking', 'streaming_assistant_message', 'executing_tool', WAITING_STATE];

export function ChatComposer({
  turnActive,
  workingState,
  disabled,
  stopInDialog = false,
  onSend,
  onInterrupt,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const canSend = !disabled && !turnActive && text.trim() !== '';
  const indicator = KNOWN_STATES.includes(workingState) ? workingState : 'thinking';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <form className="chat-composer" onSubmit={submit}>
      {turnActive || workingState === WAITING_STATE ? (
        <p
          className="chat-composer__working"
          role="status"
          data-testid="chat-working"
          data-state={indicator}
        >
          {t(`chat.working.${indicator}`)}
        </p>
      ) : null}
      <div className="chat-composer__row">
        <textarea
          className="field__control chat-composer__input"
          data-testid="chat-input"
          aria-label={t('chat.inputLabel')}
          placeholder={t('chat.inputPlaceholder')}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
        />
        {turnActive && !stopInDialog ? (
          <button
            type="button"
            className="btn btn--secondary chat-composer__button"
            data-testid="chat-interrupt"
            onClick={onInterrupt}
          >
            {t('chat.interrupt')}
          </button>
        ) : null}
        <button
          type="submit"
          className="btn btn--primary chat-composer__button"
          data-testid="chat-send"
          disabled={!canSend}
        >
          {t('chat.send')}
        </button>
      </div>
    </form>
  );
}
