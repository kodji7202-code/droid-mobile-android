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

const C_ESCAPES: Record<string, number> = {
  a: 7,
  b: 8,
  f: 12,
  n: 10,
  r: 13,
  t: 9,
  v: 11,
  '"': 34,
  '\\': 92,
};

/**
 * Decodes a path Git wrapped in double quotes (core.quotePath): octal escapes
 * are raw UTF-8 bytes. Unquoted paths are returned unchanged.
 */
export function unquoteGitPath(raw: string): string {
  if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const body = raw.slice(1, -1);
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 0; i < body.length;) {
    if (body[i] !== '\\') {
      const codePoint = String.fromCodePoint(body.codePointAt(i) ?? 0);
      bytes.push(...encoder.encode(codePoint));
      i += codePoint.length;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
    } else {
      const escaped = C_ESCAPES[body[i + 1]];
      bytes.push(escaped ?? (body.charCodeAt(i + 1) || 92));
      i += 2;
    }
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

const QUOTED = '"(?:[^"\\\\]|\\\\.)*"';
const GIT_HEADER = new RegExp(
  `^diff --git (${QUOTED}|a/.*?)\\s+(${QUOTED}|b/.*?)(?:\\r?\\n|$)`,
  'm',
);

function stripPrefix(path: string, prefix: 'a/' | 'b/'): string {
  return path.startsWith(prefix) ? path.slice(2) : path;
}

function pathFromHeader(text: string): string {
  const match = GIT_HEADER.exec(text);
  if (!match) return '';
  const oldPath = stripPrefix(unquoteGitPath(match[1]), 'a/');
  const newPath = stripPrefix(unquoteGitPath(match[2]), 'b/');
  return newPath !== '/dev/null' ? newPath : oldPath;
}

function pathFromFileMarker(chunk: string, marker: '+++' | '---', prefix: 'a/' | 'b/'): string {
  const match = new RegExp(
    `^${marker === '+++' ? '\\+\\+\\+' : '---'}\\s+(${QUOTED}|.*?)(?:\\r?\\n|$)`,
    'm',
  ).exec(chunk);
  const path = match ? stripPrefix(unquoteGitPath(match[1]), prefix) : '';
  return path === '/dev/null' ? '' : path;
}

/**
 * Splits a full multi-file unified diff into a map of filePath -> fileDiffText.
 * Keys are decoded paths (see unquoteGitPath).
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
    // Rename or b/path: the new path wins unless the file was deleted.
    const filePath =
      pathFromHeader(chunk) ||
      pathFromFileMarker(chunk, '+++', 'b/') ||
      pathFromFileMarker(chunk, '---', 'a/');

    if (filePath) {
      result.set(filePath, chunk);
    }
  }

  return result;
}

/** Looks up a file's diff chunk by a raw (possibly C-quoted) or decoded path. */
export function findFileDiff(diffByFile: Map<string, string>, path: string): string {
  return diffByFile.get(unquoteGitPath(path)) ?? '';
}

/**
 * Parses a single file's unified diff text into hunks and formatted lines.
 */
export function parseFileDiff(fileDiffText: string = '', fallbackPath = ''): DiffParsedFile {
  const lines = (fileDiffText ?? '').split(/\r?\n/);
  const hunks: DiffParsedHunk[] = [];
  const rows: DiffParsedLine[] = [];

  const extractedPath = pathFromHeader(fileDiffText) || fallbackPath;

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
