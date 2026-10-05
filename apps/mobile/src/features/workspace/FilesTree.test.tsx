import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilesTree, TREE_ROW_HEIGHT } from './FilesTree';
import type { FlatTreeItem } from './treeBuilder';

describe('FilesTree', () => {
  it('renders folders and files with proper attributes and handles clicks', () => {
    const items: FlatTreeItem[] = [
      {
        node: { name: 'src', path: 'src', isFolder: true, children: [] },
        depth: 0,
      },
      {
        node: { name: 'index.ts', path: 'src/index.ts', isFolder: false, children: [] },
        depth: 1,
      },
    ];

    const onToggleFolder = vi.fn();
    const onOpenFile = vi.fn();

    render(
      <FilesTree
        items={items}
        expandedPaths={new Set(['src'])}
        onToggleFolder={onToggleFolder}
        onOpenFile={onOpenFile}
      />,
    );

    const folder = screen.getByTestId('tree-folder-src');
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(folder);
    expect(onToggleFolder).toHaveBeenCalledWith('src');

    const file = screen.getByTestId('tree-file-src/index.ts');
    expect(file).not.toHaveAttribute('aria-expanded');
    fireEvent.click(file);
    expect(onOpenFile).toHaveBeenCalledWith('src/index.ts');
  });

  it('virtualizes large lists rendering at most 150 DOM rows', () => {
    const items: FlatTreeItem[] = [];
    for (let i = 1; i <= 3000; i++) {
      items.push({
        node: {
          name: `f${String(i).padStart(4, '0')}.txt`,
          path: `f${String(i).padStart(4, '0')}.txt`,
          isFolder: false,
          children: [],
        },
        depth: 0,
      });
    }

    const { container } = render(
      <FilesTree
        items={items}
        expandedPaths={new Set()}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    const renderedRows = container.querySelectorAll('.files-tree__row');
    expect(renderedRows.length).toBeLessThan(150);
    expect(renderedRows.length).toBeGreaterThan(0);

    const spacer = container.querySelector('.files-tree__spacer') as HTMLElement;
    expect(spacer.style.height).toBe(`${3000 * TREE_ROW_HEIGHT}px`);
  });

  it('uses rows of at least 48 dp for folders and files (WS-SCR-003)', () => {
    const items: FlatTreeItem[] = [
      { node: { name: 'src', path: 'src', isFolder: true, children: [] }, depth: 0 },
      { node: { name: 'a.ts', path: 'src/a.ts', isFolder: false, children: [] }, depth: 1 },
    ];
    render(
      <FilesTree
        items={items}
        expandedPaths={new Set(['src'])}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(TREE_ROW_HEIGHT).toBeGreaterThanOrEqual(48);
    for (const id of ['tree-folder-src', 'tree-file-src/a.ts']) {
      expect(screen.getByTestId(id).style.height).toBe(`${TREE_ROW_HEIGHT}px`);
    }
  });

  it('renders empty label when items is empty', () => {
    render(
      <FilesTree
        items={[]}
        expandedPaths={new Set()}
        onToggleFolder={vi.fn()}
        onOpenFile={vi.fn()}
        emptyLabel="Nothing here"
      />,
    );

    expect(screen.getByTestId('workspace-tree-empty')).toHaveTextContent('Nothing here');
  });
});
