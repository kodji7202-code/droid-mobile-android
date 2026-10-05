import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree } from './treeBuilder';

describe('treeBuilder', () => {
  it('builds a nested tree sorting folders before files and alphabetically', () => {
    const files = [
      'z-file.txt',
      'a-file.txt',
      'src/sub/deep.ts',
      'src/index.ts',
      'docs/guide.md',
      'assets/logo.png',
    ];

    const tree = buildTree(files);

    // Root items: assets, docs, src (folders first), then a-file.txt, z-file.txt (files)
    expect(tree.map((n) => n.name)).toEqual([
      'assets',
      'docs',
      'src',
      'a-file.txt',
      'z-file.txt',
    ]);
    expect(tree.map((n) => n.isFolder)).toEqual([true, true, true, false, false]);

    // Check src children: sub (folder) first, then index.ts (file)
    const srcNode = tree.find((n) => n.name === 'src')!;
    expect(srcNode.children.map((n) => n.name)).toEqual(['sub', 'index.ts']);
    expect(srcNode.children[0].isFolder).toBe(true);
    expect(srcNode.children[1].isFolder).toBe(false);

    // Check src/sub children: deep.ts
    const subNode = srcNode.children[0];
    expect(subNode.children.map((n) => n.name)).toEqual(['deep.ts']);
    expect(subNode.children[0].path).toBe('src/sub/deep.ts');
  });

  it('normalises Windows backslashes and skips empty segments', () => {
    const files = ['dir\\a.ts', '\\dir\\sub\\b.ts\\', 'root.txt'];
    const tree = buildTree(files);

    expect(tree.map((n) => n.name)).toEqual(['dir', 'root.txt']);
    const dir = tree[0];
    expect(dir.children.map((n) => n.name)).toEqual(['sub', 'a.ts']);
  });

  it('flattens tree only including children of expanded folders', () => {
    const files = ['src/utils/math.ts', 'src/main.ts', 'readme.md'];
    const tree = buildTree(files);

    // With nothing expanded
    const flat0 = flattenTree(tree, new Set());
    expect(flat0.map((item) => item.node.path)).toEqual(['src', 'readme.md']);
    expect(flat0.map((item) => item.depth)).toEqual([0, 0]);

    // With "src" expanded
    const flat1 = flattenTree(tree, new Set(['src']));
    expect(flat1.map((item) => item.node.path)).toEqual([
      'src',
      'src/utils',
      'src/main.ts',
      'readme.md',
    ]);
    expect(flat1.map((item) => item.depth)).toEqual([0, 1, 1, 0]);

    // With "src" and "src/utils" expanded
    const flat2 = flattenTree(tree, new Set(['src', 'src/utils']));
    expect(flat2.map((item) => item.node.path)).toEqual([
      'src',
      'src/utils',
      'src/utils/math.ts',
      'src/main.ts',
      'readme.md',
    ]);
    expect(flat2.map((item) => item.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('handles 12,000 files efficiently', () => {
    const largeList: string[] = [];
    for (let i = 1; i <= 12000; i++) {
      const folderIndex = Math.floor(i / 100);
      largeList.push(`dir_${folderIndex}/file_${i}.txt`);
    }

    const start = performance.now();
    const tree = buildTree(largeList);
    const duration = performance.now() - start;

    expect(tree.length).toBe(121);
    expect(duration).toBeLessThan(500); // 12k files in < 500ms
  });
});
