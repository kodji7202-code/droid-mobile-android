import { useTranslation } from 'react-i18next';
import type { QueuedMessage } from '../../stores/sessionView';

interface QueuedMessagesProps {
  messages: readonly QueuedMessage[];
  onCancel(requestId: string): void;
}

export function QueuedMessages({ messages, onCancel }: QueuedMessagesProps) {
  const { t } = useTranslation();
  if (messages.length === 0) return null;
  return (
    <ul className="chat-queue" aria-label={t('chat.queue.label')} data-testid="chat-queue">
      {messages.map((message, index) => (
        <li
          key={message.requestId}
          className="chat-queue__item"
          data-testid={`chat-queued-${index}`}
          data-request-id={message.requestId}
        >
          <span className="chat-queue__badge">{t('chat.queue.badge')}</span>
          <span className="chat-queue__text" data-testid={`chat-queued-text-${index}`}>
            {message.text}
          </span>
          <button
            type="button"
            className="btn btn--ghost chat-queue__cancel"
            data-testid={`chat-queued-cancel-${index}`}
            aria-label={t('chat.queue.cancel', { text: message.text })}
            onClick={() => onCancel(message.requestId)}
          >
            {t('chat.queue.cancelShort')}
          </button>
        </li>
      ))}
    </ul>
  );
}
