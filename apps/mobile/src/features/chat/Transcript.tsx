import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type Ref,
} from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { TranscriptItem } from '@droidmobile/daemon-client';
import { MarkdownView } from '../../components/MarkdownView';
import { AttachmentThumb } from './AttachmentThumb';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallCard } from './ToolCallCard';
import { buildRows, estimateRowHeight } from './transcriptRows';
import type { TranscriptRow } from './transcriptRows';

/** Must equal the flex gap of `.session-messages` in index.css. */
const ROW_GAP_PX = 12;
const OVERSCAN_ROWS = 6;

export interface TranscriptHandle {
  /**
   * Scrolls so the row with `key` sits `top` px below the viewport top, also when it is
   * not mounted. False when the row is unknown.
   */
  scrollToKey(key: string, top: number): boolean;
}

interface TranscriptProps {
  items: readonly TranscriptItem[];
  onRetry(itemId: string): void;
  retryDisabled?: boolean;
  ref?: Ref<TranscriptHandle>;
}

export type RowProps = ComponentProps<'li'> & { 'data-index'?: number; 'data-row-key'?: string };

/**
 * Renders the conversation; `msg-*-<n>` numbers user and assistant bubbles in order.
 * The window scrolls, so only the rows near the viewport are mounted: the rows around
 * them are replaced by padding of their measured (or estimated) height.
 */
export function Transcript({ items, onRetry, retryDisabled = false, ref }: TranscriptProps) {
  const rows = useMemo(() => buildRows(items), [items]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const listRef = useRef<HTMLOListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // The list starts below the header, which changes height without touching the list.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const measure = () => {
      const top = Math.round(list.getBoundingClientRect().top + window.scrollY);
      setScrollMargin((previous) => (Math.abs(previous - top) >= 1 ? top : previous));
    };
    measure();
    window.addEventListener('resize', measure);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: useCallback((index: number) => estimateRowHeight(rowsRef.current[index]!), []),
    getItemKey: useCallback((index: number) => rowsRef.current[index]!.key, []),
    overscan: OVERSCAN_ROWS,
    gap: ROW_GAP_PX,
    scrollMargin,
  });

  useImperativeHandle(
    ref,
    () => ({
      scrollToKey(key, top) {
        const index = rowsRef.current.findIndex((row) => row.key === key);
        const start = index < 0 ? undefined : virtualizer.measurementsCache[index]?.start;
        if (start === undefined) return false;
        window.scrollTo?.(0, start - top);
        return true;
      },
    }),
    [virtualizer],
  );

  const mounted = virtualizer.getVirtualItems();
  const first = mounted[0];
  const last = mounted[mounted.length - 1];
  const paddingTop = first ? first.start - scrollMargin : 0;
  const paddingBottom = last ? virtualizer.getTotalSize() - (last.end - scrollMargin) : 0;

  return (
    <ol
      ref={listRef}
      className="session-messages"
      data-testid="session-messages"
      style={{ paddingTop, paddingBottom }}
    >
      {mounted.map(({ index }) => {
        const row = rows[index]!;
        return (
          <TranscriptRowView
            key={row.key}
            row={row}
            rowProps={{
              ref: virtualizer.measureElement,
              'data-index': index,
              'data-row-key': row.key,
              'aria-posinset': index + 1,
              'aria-setsize': rows.length,
            }}
            onRetry={onRetry}
            retryDisabled={retryDisabled}
          />
        );
      })}
    </ol>
  );
}

interface TranscriptRowViewProps {
  row: TranscriptRow;
  rowProps: RowProps;
  onRetry(itemId: string): void;
  retryDisabled: boolean;
}

function TranscriptRowView({ row, rowProps, onRetry, retryDisabled }: TranscriptRowViewProps) {
  const { t } = useTranslation();
  const { item, n } = row;
  switch (item.kind) {
    case 'tool':
      return <ToolCallCard tool={item} rowProps={rowProps} />;
    case 'error':
      return (
        <li
          {...rowProps}
          className="session-message session-message--error"
          role="alert"
          data-testid={`chat-error-${n}`}
        >
          <p className="session-message__text">{item.text}</p>
        </li>
      );
    case 'user':
      if (item.notice) {
        return (
          <li
            {...rowProps}
            className="session-message session-message--notice"
            data-testid={`msg-notice-${n}`}
          >
            <span className="session-message__role">{t('chat.commandPrompt')}</span>
            <p className="session-message__text">{item.text}</p>
          </li>
        );
      }
      return (
        <li
          {...rowProps}
          className={`session-message session-message--user session-message--${item.delivery}`}
          aria-label={t('session.roleUser')}
          data-testid={`msg-user-${n}`}
          data-delivery={item.delivery}
        >
          {item.attachments ? (
            <ul className="session-message__attachments">
              {item.attachments.map((attachment, k) => (
                <li
                  key={k}
                  className="attachment"
                  data-testid={`msg-attachment-${n}-${k}`}
                  data-kind={attachment.kind}
                >
                  <AttachmentThumb attachment={attachment} />
                </li>
              ))}
            </ul>
          ) : null}
          {item.text === '' ? null : <p className="session-message__text">{item.text}</p>}
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
    case 'assistant':
      return (
        <li
          {...rowProps}
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
