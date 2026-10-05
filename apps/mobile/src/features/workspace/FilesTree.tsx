import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
} from '../../components/icons';
import type { FlatTreeItem } from './treeBuilder';

export const TREE_ROW_HEIGHT = 48;
const OVERSCAN = 15;

interface FilesTreeProps {
  items: readonly FlatTreeItem[];
  expandedPaths: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  initialScrollTop?: number;
  onScroll?: (scrollTop: number) => void;
  emptyLabel?: string;
}

export function FilesTree({
  items,
  expandedPaths,
  onToggleFolder,
  onOpenFile,
  initialScrollTop = 0,
  onScroll,
  emptyLabel = 'Empty folder',
}: FilesTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportHeight, setViewportHeight] = useState(600);

  // Restore initial scroll on mount
  useEffect(() => {
    if (containerRef.current && initialScrollTop > 0) {
      containerRef.current.scrollTop = initialScrollTop;
    }
  }, [initialScrollTop]);

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
    const currentScrollTop = containerRef.current.scrollTop;
    setScrollTop(currentScrollTop);
    onScroll?.(currentScrollTop);
  }, [onScroll]);

  if (items.length === 0) {
    return (
      <div className="files-tree files-tree--empty" data-testid="files-tree">
        <p className="files-tree__empty-message" data-testid="workspace-tree-empty">
          {emptyLabel}
        </p>
      </div>
    );
  }

  const totalHeight = items.length * TREE_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / TREE_ROW_HEIGHT) + OVERSCAN,
  );
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      className="files-tree"
      data-testid="files-tree"
      onScroll={handleScroll}
      role="tree"
      style={{
        position: 'relative',
        overflowY: 'auto',
        overflowX: 'hidden',
        height: '100%',
        width: '100%',
      }}
    >
      <div
        className="files-tree__spacer"
        style={{
          height: `${totalHeight}px`,
          position: 'relative',
          width: '100%',
        }}
      >
        {visibleItems.map((item, offset) => {
          const absoluteIndex = startIndex + offset;
          const { node, depth } = item;
          const isExpanded = expandedPaths.has(node.path);
          const top = absoluteIndex * TREE_ROW_HEIGHT;

          if (node.isFolder) {
            return (
              <button
                key={node.path}
                type="button"
                className="files-tree__row files-tree__row--folder"
                data-testid={`tree-folder-${node.path}`}
                role="treeitem"
                aria-expanded={isExpanded}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: 0,
                  right: 0,
                  height: `${TREE_ROW_HEIGHT}px`,
                  paddingLeft: `${depth * 18 + 8}px`,
                  display: 'flex',
                  alignItems: 'center',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  width: '100%',
                }}
                onClick={() => onToggleFolder(node.path)}
              >
                <span
                  className="files-tree__chevron"
                  style={{ display: 'inline-flex', marginRight: '6px', width: '18px', height: '18px' }}
                >
                  {isExpanded ? (
                    <ChevronDownIcon width={18} height={18} />
                  ) : (
                    <ChevronRightIcon width={18} height={18} />
                  )}
                </span>
                <span
                  className="files-tree__icon"
                  style={{ display: 'inline-flex', marginRight: '8px', opacity: 0.85 }}
                >
                  <FolderIcon width={18} height={18} />
                </span>
                <span className="files-tree__name">{node.name}</span>
              </button>
            );
          }

          return (
            <button
              key={node.path}
              type="button"
              className="files-tree__row files-tree__row--file"
              data-testid={`tree-file-${node.path}`}
              role="treeitem"
              style={{
                position: 'absolute',
                top: `${top}px`,
                left: 0,
                right: 0,
                height: `${TREE_ROW_HEIGHT}px`,
                paddingLeft: `${depth * 18 + 8 + 24}px`,
                display: 'flex',
                alignItems: 'center',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                width: '100%',
              }}
              onClick={() => onOpenFile(node.path)}
            >
              <span
                className="files-tree__icon"
                style={{ display: 'inline-flex', marginRight: '8px', opacity: 0.7 }}
              >
                <FileIcon width={18} height={18} />
              </span>
              <span className="files-tree__name">{node.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
