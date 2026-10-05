import type { Terminal as XtermTerminal } from '@xterm/xterm';
import type { Emulator, TerminalCell } from './TerminalManager';
import { wordBounds } from './terminalKeys';
import { installTextInputGuard } from './textInputGuard';

declare global {
  interface HTMLElement {
    /** Debug handle to the xterm instance that renders into this element. */
    xterm?: XtermTerminal;
  }
}

const DARK_ANSI = {
  black: '#1e2023',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#7aa2f7',
  magenta: '#c792ea',
  cyan: '#67e8f9',
  white: '#e7e8ea',
  brightBlack: '#6b7280',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#e0b3ff',
  brightCyan: '#a5f3fc',
  brightWhite: '#ffffff',
};

const LIGHT_ANSI = {
  black: '#1b1d21',
  red: '#b3261e',
  green: '#1b7f3b',
  yellow: '#8a5a00',
  blue: '#1d4ed8',
  magenta: '#8e24aa',
  cyan: '#0e7490',
  white: '#6b7280',
  brightBlack: '#4b5563',
  brightRed: '#d32f2f',
  brightGreen: '#15803d',
  brightYellow: '#a16207',
  brightBlue: '#2563eb',
  brightMagenta: '#a21caf',
  brightCyan: '#0891b2',
  brightWhite: '#111827',
};

function currentTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const dark = root.getAttribute('data-theme') !== 'light';
  const background = style.getPropertyValue('--color-bg').trim() || (dark ? '#141518' : '#f7f7f8');
  const foreground = style.getPropertyValue('--color-fg').trim() || (dark ? '#e7e8ea' : '#1b1d21');
  return {
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: dark ? 'rgba(129, 140, 248, 0.45)' : 'rgba(79, 70, 229, 0.3)',
  };
}

/**
 * Loads xterm and its fit addon on first use (kept out of the main chunk) and
 * returns a factory. Each emulator owns a detached element; the terminal is
 * opened lazily the first time it is attached to the document, so output that
 * arrives while it is hidden is still captured by the buffer.
 */
export async function loadXtermEmulatorFactory(): Promise<() => Emulator> {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/xterm/css/xterm.css'),
  ]);

  return () => {
    const element = document.createElement('div');
    element.className = 'terminal-emulator';
    const term = new Terminal({
      scrollback: 5000,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: currentTheme(),
      allowProposedApi: false,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    element.xterm = term;
    let opened = false;
    let removeGuard: (() => void) | null = null;
    const scrollListeners = new Set<(atBottom: boolean) => void>();
    const isAtBottom = () => term.buffer.active.viewportY >= term.buffer.active.baseY;
    let lastAtBottom = true;
    const publishScroll = () => {
      const now = isAtBottom();
      if (now === lastAtBottom) return;
      lastAtBottom = now;
      for (const l of [...scrollListeners]) l(now);
    };
    // New output does not fire onScroll while the view is held above the bottom.
    term.onScroll(publishScroll);
    term.onWriteParsed(publishScroll);

    const observer = new MutationObserver(() => {
      term.options.theme = currentTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const open = (): void => {
      if (opened) return;
      opened = true;
      term.open(element);
      const textarea = term.textarea;
      if (textarea) {
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('spellcheck', 'false');
        removeGuard = installTextInputGuard(element, textarea, (data) => term.input(data, true));
      }
    };

    return {
      element,
      get cols() {
        return term.cols;
      },
      get rows() {
        return term.rows;
      },
      write: (data) => term.write(data),
      reset: () => term.reset(),
      resize: (cols, rows) => term.resize(Math.max(2, cols), Math.max(1, rows)),
      fit() {
        if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) {
          return null;
        }
        open();
        const dims = fitAddon.proposeDimensions();
        if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return null;
        const cols = Math.max(2, dims.cols);
        const rows = Math.max(1, dims.rows);
        if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);
        term.refresh(0, term.rows - 1);
        return { cols: term.cols, rows: term.rows };
      },
      focus: () => term.focus(),
      get applicationCursor() {
        return term.modes.applicationCursorKeysMode;
      },
      paste: (text) => term.paste(text),
      get atBottom() {
        return isAtBottom();
      },
      scrollToBottom: () => term.scrollToBottom(),
      onScrollState(listener) {
        scrollListeners.add(listener);
        return () => scrollListeners.delete(listener);
      },
      getSelection: () => term.getSelection(),
      hasSelection: () => term.hasSelection(),
      clearSelection: () => term.clearSelection(),
      cellAt(clientX, clientY): TerminalCell | null {
        const screen = element.querySelector('.xterm-screen');
        if (!screen || term.cols === 0 || term.rows === 0) return null;
        const rect = screen.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const col = Math.floor(((clientX - rect.left) / rect.width) * term.cols);
        const rowInView = Math.floor(((clientY - rect.top) / rect.height) * term.rows);
        if (col < 0 || col >= term.cols || rowInView < 0 || rowInView >= term.rows) return null;
        return { col, row: term.buffer.active.viewportY + rowInView };
      },
      selectBetween(from, to) {
        const [a, b] =
          from.row < to.row || (from.row === to.row && from.col <= to.col)
            ? [from, to]
            : [to, from];
        term.select(a.col, a.row, (b.row - a.row) * term.cols + (b.col - a.col) + 1);
      },
      selectWordAt(cell) {
        const line = term.buffer.active.getLine(cell.row)?.translateToString(true) ?? '';
        const bounds = wordBounds(line, cell.col);
        if (!bounds) {
          term.clearSelection();
          return;
        }
        term.select(bounds.start, cell.row, bounds.end - bounds.start + 1);
      },
      onData(listener) {
        const disposable = term.onData(listener);
        return () => disposable.dispose();
      },
      dispose() {
        removeGuard?.();
        observer.disconnect();
        term.dispose();
        element.remove();
      },
    };
  };
}
