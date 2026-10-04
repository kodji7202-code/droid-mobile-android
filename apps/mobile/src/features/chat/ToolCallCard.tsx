import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolItem } from '@droidmobile/daemon-client';

const SUMMARY_LIMIT = 80;

/** First string argument of the call, flattened to one line, as the collapsed summary. */
export function summarizeInput(input: Record<string, unknown>): string {
  const first = Object.values(input).find((value) => typeof value === 'string') as
    string | undefined;
  const line = (first ?? JSON.stringify(input)).replace(/\s+/g, ' ').trim();
  if (line === '{}') return '';
  return line.length > SUMMARY_LIMIT ? `${line.slice(0, SUMMARY_LIMIT)}�` : line;
}

export function ToolCallCard({ tool }: { tool: ToolItem }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const bodyId = `tool-call-body-${tool.id}`;
  const statusLabel = t(`chat.tool.${tool.status}`);
  return (
    <li
      className={`tool-card tool-card--${tool.status}`}
      data-testid={`tool-call-${tool.id}`}
      data-state={tool.status}
    >
      <button
        type="button"
        className="tool-card__header"
        data-testid={`tool-call-toggle-${tool.id}`}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tool-card__name">{tool.name}</span>
        <span className="tool-card__summary">{summarizeInput(tool.input)}</span>
        <span className="tool-card__status" data-testid={`tool-call-status-${tool.id}`}>
          {statusLabel}
        </span>
      </button>
      {expanded ? (
        <div className="tool-card__body" id={bodyId} data-testid={bodyId}>
          <p className="tool-card__label">{t('chat.tool.input')}</p>
          <pre className="tool-card__pre">{JSON.stringify(tool.input, null, 2)}</pre>
          <p className="tool-card__label">
            {tool.status === 'error' ? t('chat.tool.errorOutput') : t('chat.tool.result')}
          </p>
          <pre className="tool-card__pre" data-testid={`tool-call-result-${tool.id}`}>
            {tool.result ?? t('chat.tool.noResult')}
          </pre>
        </div>
      ) : null}
    </li>
  );
}
