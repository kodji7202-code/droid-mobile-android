import type { Terminal as XtermTerminal } from '@xterm/xterm';
import type { Emulator } from './TerminalManager';

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
      onData(listener) {
        const disposable = term.onData(listener);
        return () => disposable.dispose();
      },
      dispose() {
        observer.disconnect();
        term.dispose();
        element.remove();
      },
    };
  };
}
