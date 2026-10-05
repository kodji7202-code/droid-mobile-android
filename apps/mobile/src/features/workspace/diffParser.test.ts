import { describe, expect, it } from 'vitest';
import { parseFileDiff, splitUnifiedDiffByFile } from './diffParser';

const SAMPLE_MULTI_DIFF = `
diff --git a/del.txt b/del.txt
deleted file mode 100644
index 2d030d7..0000000
--- a/del.txt
+++ /dev/null
@@ -1 +0,0 @@
-delete me
diff --git a/mod.txt b/mod.txt
index a92d664..b38f00e 100644
--- a/mod.txt
+++ b/mod.txt
@@ -1,3 +1,5 @@
 line 1
-line 2
+line 2 mod
+new line 1
+new line 2
 line 3
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..ae5eb9b
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+added 1
+added 2
`.trim();

describe('diffParser', () => {
  it('splits unified diff into per-file chunks', () => {
    const fileDiffMap = splitUnifiedDiffByFile(SAMPLE_MULTI_DIFF);
    expect(fileDiffMap.size).toBe(3);
    expect(fileDiffMap.has('del.txt')).toBe(true);
    expect(fileDiffMap.has('mod.txt')).toBe(true);
    expect(fileDiffMap.has('new.txt')).toBe(true);
  });

  it('parses a modified file with additions, deletions, context lines and line numbers', () => {
    const fileDiffMap = splitUnifiedDiffByFile(SAMPLE_MULTI_DIFF);
    const modDiff = fileDiffMap.get('mod.txt')!;
    const parsed = parseFileDiff(modDiff, 'mod.txt');

    expect(parsed.filePath).toBe('mod.txt');
    expect(parsed.additions).toBe(3);
    expect(parsed.deletions).toBe(1);
    expect(parsed.hunks).toHaveLength(1);

    const hunk = parsed.hunks[0];
    expect(hunk.header).toBe('@@ -1,3 +1,5 @@');
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);

    // Rows include 1 hunk header + 6 lines = 7 rows
    expect(parsed.rows).toHaveLength(7);
    expect(parsed.rows[0].type).toBe('hunk-header');
    expect(parsed.rows[0].content).toBe('@@ -1,3 +1,5 @@');

    // Context line 1
    expect(parsed.rows[1]).toEqual({
      type: 'context',
      content: 'line 1',
      oldLineNumber: 1,
      newLineNumber: 1,
      marker: ' ',
    });

    // Deleted line
    expect(parsed.rows[2]).toEqual({
      type: 'delete',
      content: 'line 2',
      oldLineNumber: 2,
      newLineNumber: undefined,
      marker: '-',
    });

    // Added lines
    expect(parsed.rows[3]).toEqual({
      type: 'add',
      content: 'line 2 mod',
      oldLineNumber: undefined,
      newLineNumber: 2,
      marker: '+',
    });
    expect(parsed.rows[4]).toEqual({
      type: 'add',
      content: 'new line 1',
      oldLineNumber: undefined,
      newLineNumber: 3,
      marker: '+',
    });
    expect(parsed.rows[5]).toEqual({
      type: 'add',
      content: 'new line 2',
      oldLineNumber: undefined,
      newLineNumber: 4,
      marker: '+',
    });

    // Context line 3
    expect(parsed.rows[6]).toEqual({
      type: 'context',
      content: 'line 3',
      oldLineNumber: 3,
      newLineNumber: 5,
      marker: ' ',
    });
  });

  it('parses a deleted file correctly', () => {
    const fileDiffMap = splitUnifiedDiffByFile(SAMPLE_MULTI_DIFF);
    const delDiff = fileDiffMap.get('del.txt')!;
    const parsed = parseFileDiff(delDiff, 'del.txt');

    expect(parsed.filePath).toBe('del.txt');
    expect(parsed.additions).toBe(0);
    expect(parsed.deletions).toBe(1);
    expect(parsed.rows).toHaveLength(2); // 1 header + 1 delete line
    expect(parsed.rows[1]).toEqual({
      type: 'delete',
      content: 'delete me',
      oldLineNumber: 1,
      newLineNumber: undefined,
      marker: '-',
    });
  });

  it('parses a newly added file correctly', () => {
    const fileDiffMap = splitUnifiedDiffByFile(SAMPLE_MULTI_DIFF);
    const newDiff = fileDiffMap.get('new.txt')!;
    const parsed = parseFileDiff(newDiff, 'new.txt');

    expect(parsed.filePath).toBe('new.txt');
    expect(parsed.additions).toBe(2);
    expect(parsed.deletions).toBe(0);
    expect(parsed.rows).toHaveLength(3); // 1 header + 2 add lines
    expect(parsed.rows[1]).toEqual({
      type: 'add',
      content: 'added 1',
      oldLineNumber: undefined,
      newLineNumber: 1,
      marker: '+',
    });
    expect(parsed.rows[2]).toEqual({
      type: 'add',
      content: 'added 2',
      oldLineNumber: undefined,
      newLineNumber: 2,
      marker: '+',
    });
  });

  it('handles very large diffs of 5000 lines cleanly and efficiently', () => {
    const lines = [
      'diff --git a/large.txt b/large.txt',
      '--- a/large.txt',
      '+++ b/large.txt',
      '@@ -1,5000 +1,5000 @@',
    ];
    for (let i = 1; i <= 5000; i++) {
      lines.push(`+generated line ${i}`);
    }
    const largeDiff = lines.join('\n');

    const start = performance.now();
    const parsed = parseFileDiff(largeDiff, 'large.txt');
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(150); // fast parse well under 200ms
    expect(parsed.additions).toBe(5000);
    expect(parsed.deletions).toBe(0);
    expect(parsed.rows).toHaveLength(5001); // 1 header + 5000 add lines
    expect(parsed.rows[5000].content).toBe('generated line 5000');
    expect(parsed.rows[5000].newLineNumber).toBe(5000);
  });
});
