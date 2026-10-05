import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BackIcon } from '../../components/icons';
import { parseFileDiff } from './diffParser';
import type { DiffParsedLine } from './diffParser';

export const DIFF_ROW_HEIGHT = 24;
const OVERSCAN = 20;
const MAX_DOM_ROWS = 550;

export interface GitDiffViewerProps {
  filePath: string;
  diffText?: string;
  rawDiff?: string;
  onBack: () => void;
  fileAdditions?: number;
  fileDeletions?: number;
  additions?: number;
  deletions?: number;
}

export function GitDiffViewer({
  filePath,
  diffText,
  rawDiff,
  onBack,
  fileAdditions,
  fileDeletions,
  additions: propAdditions,
  deletions: propDeletions,
}: GitDiffViewerProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  const content = diffText ?? rawDiff ?? '';

  // Parse diff lazily for this specific file
  const parsed = useMemo(() => {
    return parseFileDiff(content, filePath);
  }, [content, filePath]);

  const rows = parsed.rows;
  const isLarge = rows.length > 250;

  // Track viewport height using ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    setViewportHeight(el.clientHeight || 600);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.height > 0) {
          setViewportHeight(entry.contentRect.height);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    setScrollTop(containerRef.current.scrollTop);
  }, []);

  const totalHeight = rows.length * DIFF_ROW_HEIGHT;

  // Compute visible rows with strict bounding <= MAX_DOM_ROWS (< 600)
  const { visibleRows, startIndex } = useMemo(() => {
    if (!isLarge) {
      return { visibleRows: rows, startIndex: 0 };
    }

    const rawStart = Math.max(0, Math.floor(scrollTop / DIFF_ROW_HEIGHT) - OVERSCAN);
    const rawEnd = Math.min(
      rows.length,
      Math.ceil((scrollTop + viewportHeight) / DIFF_ROW_HEIGHT) + OVERSCAN,
    );

    const count = Math.min(MAX_DOM_ROWS, rawEnd - rawStart);
    const start = Math.max(0, Math.min(rawStart, rows.length - count));
    const end = Math.min(rows.length, start + count);

    return {
      visibleRows: rows.slice(start, end),
      startIndex: start,
    };
  }, [rows, isLarge, scrollTop, viewportHeight]);

  const additions = fileAdditions ?? propAdditions ?? parsed.additions;
  const deletions = fileDeletions ?? propDeletions ?? parsed.deletions;

  return (
    <div
      className="git-diff-viewer"
      data-testid="git-diff-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--color-bg, #ffffff)',
        overflow: 'hidden',
      }}
    >
      {/* Diff Header */}
      <header
        className="git-diff-header"
        data-testid="git-diff-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-border, #eee)',
          backgroundColor: 'var(--color-surface, #fafafa)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          className="btn btn--icon btn--sm"
          data-testid="git-diff-back"
          onClick={onBack}
          aria-label={t('git.diff.back')}
          title={t('git.diff.back')}
        >
          <BackIcon width={20} height={20} />
        </button>

        <span
          className="git-diff-header__path"
          data-testid="git-diff-file-path"
          style={{
            fontWeight: 600,
            fontSize: '0.9rem',
            fontFamily: 'monospace',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={filePath}
        >
          {filePath}
        </span>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span
            className="chip chip--success"
            data-testid="git-diff-file-additions"
            style={{ fontWeight: 600, fontSize: '0.8rem' }}
          >
            +{additions}
          </span>
          <span
            className="chip chip--danger"
            data-testid="git-diff-file-deletions"
            style={{ fontWeight: 600, fontSize: '0.8rem' }}
          >
            -{deletions}
          </span>
        </div>
      </header>

      {/* Diff Content */}
      {rows.length === 0 ? (
        <div
          className="git-diff-empty"
          data-testid="git-diff-empty"
          style={{ padding: '32px', textAlign: 'center', opacity: 0.6 }}
        >
          <p>{t('git.diff.empty')}</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="git-diff-scroll"
          data-testid="git-diff-scroll"
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'auto',
            position: 'relative',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '12px',
            lineHeight: `${DIFF_ROW_HEIGHT}px`,
          }}
        >
          <div
            className="git-diff-spacer"
            style={{
              height: isLarge ? `${totalHeight}px` : 'auto',
              position: 'relative',
              width: '100%',
              minWidth: 'max-content',
            }}
          >
            {visibleRows.map((row: DiffParsedLine, idx: number) => {
              const rowIndex = startIndex + idx;
              const top = rowIndex * DIFF_ROW_HEIGHT;

              if (row.type === 'hunk-header') {
                return (
                  <div
                    key={`hunk-${rowIndex}`}
                    className="diff-line diff-line--hunk-header"
                    data-testid="diff-hunk-header"
                    style={{
                      position: isLarge ? 'absolute' : 'relative',
                      top: isLarge ? `${top}px` : undefined,
                      left: 0,
                      right: 0,
                      height: `${DIFF_ROW_HEIGHT}px`,
                      display: 'flex',
                      backgroundColor: 'var(--diff-hunk-bg, rgba(79, 70, 229, 0.08))',
                      color: 'var(--diff-hunk-fg, var(--color-accent, #4f46e5))',
                      fontWeight: 600,
                      padding: '0 8px',
                      userSelect: 'none',
                    }}
                  >
                    <span className="diff-line__content" data-testid="diff-line-content">
                      {row.content}
                    </span>
                  </div>
                );
              }

              const isAdd = row.type === 'add';
              const isDelete = row.type === 'delete';

              const rowBg = isAdd
                ? 'var(--diff-add-bg, rgba(27, 127, 59, 0.12))'
                : isDelete
                  ? 'var(--diff-del-bg, rgba(179, 38, 30, 0.12))'
                  : 'transparent';

              const rowColor = isAdd
                ? 'var(--diff-add-fg, var(--color-success, #1b7f3b))'
                : isDelete
                  ? 'var(--diff-del-fg, var(--color-danger, #b3261e))'
                  : 'inherit';

              const testId = isAdd
                ? 'diff-line-add'
                : isDelete
                  ? 'diff-line-delete'
                  : 'diff-line-context';

              return (
                <div
                  key={`line-${rowIndex}`}
                  className={`diff-line diff-line--${row.type}`}
                  data-testid={testId}
                  data-type={row.type}
                  style={{
                    position: isLarge ? 'absolute' : 'relative',
                    top: isLarge ? `${top}px` : undefined,
                    left: 0,
                    right: 0,
                    height: `${DIFF_ROW_HEIGHT}px`,
                    display: 'flex',
                    alignItems: 'center',
                    backgroundColor: rowBg,
                    color: rowColor,
                    paddingRight: '8px',
                    whiteSpace: 'pre',
                  }}
                >
                  {/* Old line number */}
                  <span
                    className="diff-line__old-num"
                    data-testid="diff-line-old-num"
                    style={{
                      width: '45px',
                      textAlign: 'right',
                      paddingRight: '8px',
                      color: 'var(--color-fg-muted, #888)',
                      userSelect: 'none',
                      flexShrink: 0,
                    }}
                  >
                    {row.oldLineNumber ?? ''}
                  </span>

                  {/* New line number */}
                  <span
                    className="diff-line__new-num"
                    data-testid="diff-line-new-num"
                    style={{
                      width: '45px',
                      textAlign: 'right',
                      paddingRight: '8px',
                      color: 'var(--color-fg-muted, #888)',
                      userSelect: 'none',
                      flexShrink: 0,
                    }}
                  >
                    {row.newLineNumber ?? ''}
                  </span>

                  {/* Marker: + / - / ' ' */}
                  <span
                    className="diff-line__marker"
                    data-testid="diff-line-marker"
                    style={{
                      width: '18px',
                      textAlign: 'center',
                      fontWeight: 700,
                      userSelect: 'none',
                      flexShrink: 0,
                    }}
                  >
                    {row.marker}
                  </span>

                  {/* Line content */}
                  <span
                    className="diff-line__content"
                    data-testid="diff-line-content"
                    style={{ flex: 1 }}
                  >
                    {row.content}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
