import { useTranslation } from 'react-i18next';
import type { TranscriptItem } from '@droidmobile/daemon-client';
import { MarkdownView } from '../../components/MarkdownView';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';

interface TranscriptProps {
  items: readonly TranscriptItem[];
  onRetry(itemId: string): void;
  retryDisabled?: boolean;
}

/** Renders the conversation; `msg-*-<n>` numbers user and assistant bubbles in order. */
export function Transcript({ items, onRetry, retryDisabled = false }: TranscriptProps) {
  const { t } = useTranslation();
  let bubble = 0;
  let errors = 0;
  return (
    <ol className="session-messages" data-testid="session-messages">
      {items.map((item) => {
        switch (item.kind) {
          case 'tool':
            return <ToolCallCard key={`tool:${item.id}`} tool={item} />;
          case 'error': {
            const n = errors;
            errors += 1;
            return (
              <li
                key={`error:${item.id}`}
                className="session-message session-message--error"
                role="alert"
                data-testid={`chat-error-${n}`}
              >
                <p className="session-message__text">{item.text}</p>
              </li>
            );
          }
          case 'user': {
            const n = bubble;
            bubble += 1;
            return (
              <li
                key={`user:${item.id}`}
                className={`session-message session-message--user session-message--${item.delivery}`}
                aria-label={t('session.roleUser')}
                data-testid={`msg-user-${n}`}
                data-delivery={item.delivery}
              >
                <p className="session-message__text">{item.text}</p>
                {item.delivery === 'failed' ? (
                  <div className="session-message__failed" role="alert">
                    <span data-testid={`msg-failed-${n}`}>{t('chat.notSent')}</span>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      data-testid={`msg-retry-${n}`}
                      disabled={retryDisabled}
                      onClick={() => onRetry(item.id)}
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                ) : null}
              </li>
            );
          }
          case 'assistant': {
            const n = bubble;
            bubble += 1;
            return (
              <li
                key={`assistant:${item.id}`}
                className={`session-message session-message--assistant${item.streaming ? ' session-message--streaming' : ''}`}
                aria-label={t('session.roleAssistant')}
                data-testid={`msg-assistant-${n}`}
                data-streaming={item.streaming}
                data-stopped={item.stopped === true}
              >
                {item.thinking ? <ThinkingBlock index={n} text={item.thinking} /> : null}
                {item.text === '' ? null : (
                  <div className="session-message__text session-message__text--markdown">
                    <MarkdownView text={item.text} />
                  </div>
                )}
                {item.stopped ? (
                  <span className="session-message__stopped" data-testid={`msg-stopped-${n}`}>
                    {t('chat.stopped')}
                  </span>
                ) : null}
              </li>
            );
          }
        }
      })}
    </ol>
  );
}
