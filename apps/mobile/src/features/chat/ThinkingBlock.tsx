import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The model's reasoning for one assistant message; collapsed until the user opens it. */
export function ThinkingBlock({ index, text }: { index: number; text: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const bodyId = `msg-thinking-body-${index}`;
  return (
    <div className="thinking" data-testid={`msg-thinking-${index}`} data-expanded={expanded}>
      <button
        type="button"
        className="thinking__toggle"
        data-testid={`msg-thinking-toggle-${index}`}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((value) => !value)}
      >
        {t('chat.thinking.label')}
      </button>
      {expanded ? (
        <p className="thinking__body" id={bodyId} data-testid={bodyId}>
          {text}
        </p>
      ) : null}
    </div>
  );
}
