export interface DiffParsedLine {
  type: 'hunk-header' | 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  marker: '+' | '-' | ' ';
}

export interface DiffParsedHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffParsedLine[];
}

export interface DiffParsedFile {
  filePath: string;
  hunks: DiffParsedHunk[];
  rows: DiffParsedLine[];
  additions: number;
  deletions: number;
}

/**
 * Splits a full multi-file unified diff into a map of filePath -> fileDiffText.
 */
export function splitUnifiedDiffByFile(unifiedDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!unifiedDiff || !unifiedDiff.trim()) {
    return result;
  }

  // Split by "diff --git " boundaries
  const chunks = unifiedDiff.split(/(?=^diff --git )/m);

  for (const chunk of chunks) {
    if (!chunk.trim() || !chunk.startsWith('diff --git ')) continue;

    // Try extracting path from "diff --git a/PATH b/PATH"
    let filePath = '';
    const headerMatch = chunk.match(/^diff --git a\/(.*?)\s+b\/(.*?)(?:\r?\n|$)/m);
    if (headerMatch) {
      // In case of rename or b/path, usually b/ path is the new path unless deleted
      filePath = headerMatch[2] !== '/dev/null' ? headerMatch[2] : headerMatch[1];
    } else {
      // Fallback: check +++ b/PATH or --- a/PATH
      const plusMatch = chunk.match(/^\+\+\+\s+(?:b\/)?(.*?)(?:\r?\n|$)/m);
      const minusMatch = chunk.match(/^---\s+(?:a\/)?(.*?)(?:\r?\n|$)/m);
      if (plusMatch && plusMatch[1] !== '/dev/null') {
        filePath = plusMatch[1];
      } else if (minusMatch && minusMatch[1] !== '/dev/null') {
        filePath = minusMatch[1];
      }
    }

    if (filePath) {
      result.set(filePath, chunk);
    }
  }

  return result;
}

/**
 * Parses a single file's unified diff text into hunks and formatted lines.
 */
export function parseFileDiff(fileDiffText: string = '', fallbackPath = ''): DiffParsedFile {
  const lines = (fileDiffText ?? '').split(/\r?\n/);
  const hunks: DiffParsedHunk[] = [];
  const rows: DiffParsedLine[] = [];

  let extractedPath = fallbackPath;
  const headerMatch = fileDiffText.match(/^diff --git a\/(.*?)\s+b\/(.*?)(?:\r?\n|$)/m);
  if (headerMatch) {
    extractedPath = headerMatch[2] !== '/dev/null' ? headerMatch[2] : headerMatch[1];
  }

  let currentHunk: DiffParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    // Hunk header: @@ -oldStart,oldLen +newStart,newLen @@ header
    if (rawLine.startsWith('@@ ')) {
      const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkMatch) {
        const oldStart = parseInt(hunkMatch[1], 10);
        const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3], 10);
        const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

        oldLine = oldStart;
        newLine = newStart;

        currentHunk = {
          header: rawLine,
          oldStart,
          oldLines,
          newStart,
          newLines,
          lines: [],
        };
        hunks.push(currentHunk);

        const hunkRow: DiffParsedLine = {
          type: 'hunk-header',
          content: rawLine,
          marker: ' ',
        };
        rows.push(hunkRow);
      }
      continue;
    }

    // Lines inside hunks
    if (!currentHunk) {
      // Header lines (diff --git, index, ---, +++) before first hunk
      continue;
    }

    // Skip trailing blank line at end of diff
    if (rawLine === '' && i === lines.length - 1) {
      continue;
    }

    // Skip git newline notice
    if (rawLine.startsWith('\\ No newline at end of file')) {
      continue;
    }

    const isHunkComplete =
      oldLine - currentHunk.oldStart >= currentHunk.oldLines &&
      newLine - currentHunk.newStart >= currentHunk.newLines;
    if (isHunkComplete && rawLine === '') {
      continue;
    }

    if (rawLine.startsWith('+')) {
      const lineRow: DiffParsedLine = {
        type: 'add',
        content: rawLine.slice(1),
        newLineNumber: newLine,
        marker: '+',
      };
      newLine++;
      additions++;
      currentHunk.lines.push(lineRow);
      rows.push(lineRow);
    } else if (rawLine.startsWith('-')) {
      const lineRow: DiffParsedLine = {
        type: 'delete',
        content: rawLine.slice(1),
        oldLineNumber: oldLine,
        marker: '-',
      };
      oldLine++;
      deletions++;
      currentHunk.lines.push(lineRow);
      rows.push(lineRow);
    } else {
      // Context line (starts with space or empty)
      const content = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine;
      const lineRow: DiffParsedLine = {
        type: 'context',
        content,
        oldLineNumber: oldLine,
        newLineNumber: newLine,
        marker: ' ',
      };
      oldLine++;
      newLine++;
      currentHunk.lines.push(lineRow);
      rows.push(lineRow);
    }
  }

  return {
    filePath: extractedPath,
    hunks,
    rows,
    additions,
    deletions,
  };
}
