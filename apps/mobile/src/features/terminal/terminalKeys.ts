export type ExtraKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right';

const ARROW_FINAL: Record<'up' | 'down' | 'right' | 'left', string> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
};

/** Byte sequence an extra-keys button sends; arrows follow the shell's cursor-key mode. */
export function keySequence(key: ExtraKey, applicationCursor: boolean): string {
  switch (key) {
    case 'esc':
      return '\x1b';
    case 'tab':
      return '\t';
    default:
      return `\x1b${applicationCursor ? 'O' : '['}${ARROW_FINAL[key]}`;
  }
}

/** Turns one typed character into its control code (Ctrl+C is 0x03); anything else passes through. */
export function applyCtrl(data: string): string {
  if (data.length !== 1) return data;
  const code = data.charCodeAt(0);
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 96);
  if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  if (code === 32) return '\x00';
  if (code === 63) return '\x7f';
  return data;
}

/** Start and end (inclusive) columns of the non-blank run around `col`, or null on whitespace. */
export function wordBounds(line: string, col: number): { start: number; end: number } | null {
  if (col < 0 || col >= line.length || /\s/.test(line[col]!)) return null;
  let start = col;
  let end = col;
  while (start > 0 && !/\s/.test(line[start - 1]!)) start -= 1;
  while (end < line.length - 1 && !/\s/.test(line[end + 1]!)) end += 1;
  return { start, end };
}
