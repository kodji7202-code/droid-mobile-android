/**
 * App-level owner of the terminals of one daemon connection. It lives outside
 * React so that navigating away neither closes shells nor loses their output:
 * every terminal keeps a detached emulator that captures data in the
 * background, and only the visible one is attached to the DOM.
 *
 * Shells are created, listed, written, resized and closed through the sidecar
 * `TerminalClient` (its own socket). A terminal belongs to the connection that
 * created it, so after the sidecar reconnects every known session is re-listed
 * and each surviving terminal is rebuilt from the daemon's serialized state.
 */
import type { TerminalClient, TerminalEvent, TerminalInfo } from '@droidmobile/daemon-client';
import { applyCtrl } from './terminalKeys';

export interface TerminalCell {
  col: number;
  /** Absolute buffer row (scrollback included). */
  row: number;
}

export interface Emulator {
  readonly element: HTMLElement;
  readonly cols: number;
  readonly rows: number;
  write(data: string): void;
  reset(): void;
  resize(cols: number, rows: number): void;
  /** Fits to the parent element; null when it cannot be measured yet. */
  fit(): { cols: number; rows: number } | null;
  focus(): void;
  onData(listener: (data: string) => void): () => void;
  /** True while the shell wants SS3 (application) cursor sequences. */
  readonly applicationCursor: boolean;
  /** Feeds text through the terminal's own paste path so the shell sees it as typed input. */
  paste(text: string): void;
  readonly atBottom: boolean;
  scrollToBottom(): void;
  onScrollState(listener: (atBottom: boolean) => void): () => void;
  getSelection(): string;
  hasSelection(): boolean;
  clearSelection(): void;
  /** Maps a viewport point to a buffer cell; null when outside the screen. */
  cellAt(clientX: number, clientY: number): TerminalCell | null;
  /** Selects the characters between two cells (inclusive), in reading order. */
  selectBetween(from: TerminalCell, to: TerminalCell): void;
  selectWordAt(cell: TerminalCell): void;
  dispose(): void;
}

export type EmulatorFactory = () => Promise<() => Emulator>;

export type TerminalStatus = 'starting' | 'running' | 'exited';

export interface TerminalEntry {
  readonly id: string;
  readonly sessionId: string;
  /** 1-based creation number within the session, for the tab label. */
  readonly label: number;
  readonly status: TerminalStatus;
  readonly exitCode: number | null;
  readonly emulator: Emulator;
}

export interface SessionTerminals {
  readonly entries: readonly TerminalEntry[];
  readonly activeId: string | null;
  readonly loading: boolean;
  /** Sticky failure of the last attach/create, shown with a retry action. */
  readonly error: string | null;
}

export type LinkStatus = TerminalClient['status'];

const EMPTY: SessionTerminals = { entries: [], activeId: null, loading: false, error: null };
const DEFAULT_SIZE = { cols: 80, rows: 24 };

interface SessionState {
  entries: TerminalEntry[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  nextLabel: number;
  cwd: string;
  snapshot: SessionTerminals;
}

interface Internal {
  dataOff: () => void;
  sentCols: number;
  sentRows: number;
  /** Frames are dropped while a re-list is in flight; the snapshot already contains them. */
  syncing: boolean;
  /** One-shot Ctrl modifier armed from the extra-keys bar. */
  ctrl: boolean;
}

export interface TerminalManagerOptions {
  client: TerminalClient;
  loadEmulatorFactory: EmulatorFactory;
  newId?: () => string;
}

export class TerminalManager {
  private readonly client: TerminalClient;
  private readonly loadEmulatorFactory: EmulatorFactory;
  private readonly newId: () => string;
  private readonly sessions = new Map<string, SessionState>();
  private readonly internals = new Map<string, Internal>();
  private readonly attaching = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void> = [];
  private factory: (() => Emulator) | null = null;
  private link: LinkStatus;
  private version = 0;
  private disposed = false;

  constructor(options: TerminalManagerOptions) {
    this.client = options.client;
    this.loadEmulatorFactory = options.loadEmulatorFactory;
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.link = this.client.status;
    this.offs.push(
      this.client.onEvent((event) => this.handleEvent(event)),
      this.client.onStatus((status) => {
        const wasReady = this.link === 'ready';
        this.link = status;
        this.emit();
        if (status === 'ready' && !wasReady) void this.resyncAll();
      }),
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  linkStatus(): LinkStatus {
    return this.link;
  }

  getSession(sessionId: string): SessionTerminals {
    return this.sessions.get(sessionId)?.snapshot ?? EMPTY;
  }

  /**
   * Loads the session's terminals the first time the Terminal view opens (and
   * creates one when the daemon has none). Later calls only re-select.
   */
  attach(sessionId: string, cwd: string, host: HTMLElement | null): Promise<void> {
    const state = this.state(sessionId);
    state.cwd = cwd;
    if (state.loaded) return Promise.resolve();
    const running = this.attaching.get(sessionId);
    if (running) return running;
    const task = this.runAttach(sessionId, cwd, host).finally(() => {
      this.attaching.delete(sessionId);
    });
    this.attaching.set(sessionId, task);
    return task;
  }

  /** Forgets a failed attach so the view can retry it. */
  retry(sessionId: string, cwd: string, host: HTMLElement | null): Promise<void> {
    const state = this.state(sessionId);
    state.loaded = false;
    return this.attach(sessionId, cwd, host);
  }

  async create(sessionId: string, cwd: string, host: HTMLElement | null): Promise<void> {
    const state = this.state(sessionId);
    state.cwd = cwd;
    await this.ensureFactory();
    const emulator = this.factory!();
    const id = this.newId();
    const entry = this.addEntry(state, id, sessionId, emulator, 'starting', null);
    this.internals.set(id, {
      dataOff: () => undefined,
      sentCols: 0,
      sentRows: 0,
      syncing: false,
      ctrl: false,
    });
    this.wireInput(entry);
    host?.replaceChildren(emulator.element);
    const size = emulator.fit() ?? {
      cols: emulator.cols || DEFAULT_SIZE.cols,
      rows: emulator.rows || DEFAULT_SIZE.rows,
    };
    const internal = this.internals.get(id)!;
    internal.sentCols = size.cols;
    internal.sentRows = size.rows;
    try {
      await this.client.create(sessionId, {
        terminalId: id,
        cols: size.cols,
        rows: size.rows,
        cwd,
      });
      if (this.disposed) return;
      if (this.find(id)?.status === 'starting') this.setStatus(entry, 'running', null);
    } catch (err) {
      if (this.disposed) return;
      this.removeEntry(sessionId, id);
      this.patch(state, { error: messageOf(err) });
    }
  }

  select(sessionId: string, terminalId: string): void {
    const state = this.sessions.get(sessionId);
    if (
      !state ||
      state.activeId === terminalId ||
      !state.entries.some((e) => e.id === terminalId)
    ) {
      return;
    }
    this.patch(state, { activeId: terminalId });
  }

  async close(sessionId: string, terminalId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    const entry = state?.entries.find((e) => e.id === terminalId);
    if (!state || !entry) return;
    this.removeEntry(sessionId, terminalId);
    await this.client.close(sessionId, terminalId).catch(() => undefined);
  }

  /** Replaces an exited terminal with a fresh shell in the same folder. */
  async restart(sessionId: string, terminalId: string, host: HTMLElement | null): Promise<void> {
    const state = this.state(sessionId);
    this.removeEntry(sessionId, terminalId);
    await this.create(sessionId, state.cwd, host);
  }

  /**
   * Fits the terminal to its container and tells the shell when the size changed.
   * Returns false while the container cannot be measured yet.
   */
  fitAndSync(sessionId: string, terminalId: string): boolean {
    const entry = this.sessions.get(sessionId)?.entries.find((e) => e.id === terminalId);
    const internal = this.internals.get(terminalId);
    if (!entry || !internal) return true;
    const size = entry.emulator.fit();
    if (!size) return false;
    if (size.cols === internal.sentCols && size.rows === internal.sentRows) return true;
    internal.sentCols = size.cols;
    internal.sentRows = size.rows;
    if (entry.status === 'running') {
      void this.client.resize(sessionId, terminalId, size.cols, size.rows).catch(() => undefined);
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.client.dispose();
    for (const state of this.sessions.values()) {
      for (const entry of state.entries) {
        this.internals.get(entry.id)?.dataOff();
        entry.emulator.dispose();
      }
    }
    this.sessions.clear();
    this.internals.clear();
    this.listeners.clear();
  }

  private async runAttach(sessionId: string, cwd: string, host: HTMLElement | null): Promise<void> {
    const state = this.state(sessionId);
    this.patch(state, { loading: true, error: null });
    try {
      await this.ensureFactory();
      await this.client.connect();
      await this.reconcile(sessionId);
      if (this.disposed) return;
      state.loaded = true;
      this.patch(state, { loading: false });
      if (state.entries.length === 0) await this.create(sessionId, cwd, host);
    } catch (err) {
      if (this.disposed) return;
      this.patch(state, { loading: false, error: messageOf(err) });
    }
  }

  private async resyncAll(): Promise<void> {
    for (const [sessionId, state] of [...this.sessions]) {
      if (!state.loaded) continue;
      try {
        await this.reconcile(sessionId);
      } catch {
        // The next ready transition retries.
      }
    }
  }

  private async reconcile(sessionId: string): Promise<void> {
    const state = this.state(sessionId);
    const existing = [...state.entries];
    for (const entry of existing) {
      const internal = this.internals.get(entry.id);
      if (internal && entry.status === 'running') internal.syncing = true;
    }
    let listed: TerminalInfo[];
    try {
      listed = await this.client.list(sessionId);
    } catch (err) {
      for (const entry of existing) {
        const internal = this.internals.get(entry.id);
        if (internal) internal.syncing = false;
      }
      throw err;
    }
    if (this.disposed) return;
    const ids = new Set(listed.map((t) => t.id));
    for (const entry of existing) {
      if (entry.status === 'exited') continue;
      if (!ids.has(entry.id)) this.removeEntry(sessionId, entry.id);
    }
    for (const info of listed) {
      const entry = state.entries.find((e) => e.id === info.id);
      if (entry) {
        this.restoreState(entry, info);
        const internal = this.internals.get(info.id);
        if (internal) internal.syncing = false;
        if (entry.status !== 'running') this.setStatus(entry, 'running', null);
      } else {
        const emulator = this.factory!();
        const fresh = this.addEntry(state, info.id, sessionId, emulator, 'running', null);
        this.internals.set(info.id, {
          dataOff: () => undefined,
          sentCols: info.cols,
          sentRows: info.rows,
          syncing: false,
          ctrl: false,
        });
        this.wireInput(fresh);
        this.restoreState(fresh, info);
      }
    }
    this.emit();
  }

  private restoreState(entry: TerminalEntry, info: TerminalInfo): void {
    const { emulator } = entry;
    emulator.reset();
    const cols = info.state?.cols ?? info.cols;
    const rows = info.state?.rows ?? info.rows;
    emulator.resize(cols, rows);
    const internal = this.internals.get(entry.id);
    if (internal) {
      internal.sentCols = info.cols;
      internal.sentRows = info.rows;
    }
    if (info.state?.serialized) emulator.write(info.state.serialized);
  }

  private wireInput(entry: TerminalEntry): void {
    const internal = this.internals.get(entry.id)!;
    internal.dataOff = entry.emulator.onData((data) =>
      this.sendInput(entry.sessionId, entry.id, data),
    );
  }

  /** Sends typed or extra-keys input; an armed Ctrl turns the next character into a control code. */
  sendInput(sessionId: string, terminalId: string, data: string): void {
    const current = this.sessions.get(sessionId)?.entries.find((e) => e.id === terminalId);
    const internal = this.internals.get(terminalId);
    if (!current || !internal || current.status !== 'running') return;
    let out = data;
    if (internal.ctrl) {
      internal.ctrl = false;
      out = applyCtrl(data);
      this.emit();
    }
    void this.client.write(sessionId, terminalId, out).catch(() => undefined);
  }

  isCtrlArmed(terminalId: string): boolean {
    return this.internals.get(terminalId)?.ctrl ?? false;
  }

  toggleCtrl(terminalId: string): void {
    const internal = this.internals.get(terminalId);
    if (!internal) return;
    internal.ctrl = !internal.ctrl;
    this.emit();
  }

  private handleEvent(event: TerminalEvent): void {
    const internal = this.internals.get(event.terminalId);
    if (!internal) return;
    const entry = this.find(event.terminalId);
    if (!entry) return;
    if (event.type === 'data') {
      if (internal.syncing) return;
      entry.emulator.write(event.data);
      return;
    }
    this.setStatus(entry, 'exited', event.exitCode);
  }

  private find(terminalId: string): TerminalEntry | undefined {
    for (const state of this.sessions.values()) {
      const entry = state.entries.find((e) => e.id === terminalId);
      if (entry) return entry;
    }
    return undefined;
  }

  private async ensureFactory(): Promise<void> {
    if (this.factory) return;
    this.factory = await this.loadEmulatorFactory();
  }

  private state(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        entries: [],
        activeId: null,
        loading: false,
        error: null,
        loaded: false,
        nextLabel: 1,
        cwd: '',
        snapshot: EMPTY,
      };
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private addEntry(
    state: SessionState,
    id: string,
    sessionId: string,
    emulator: Emulator,
    status: TerminalStatus,
    exitCode: number | null,
  ): TerminalEntry {
    const entry: TerminalEntry = {
      id,
      sessionId,
      label: state.nextLabel++,
      status,
      exitCode,
      emulator,
    };
    state.entries = [...state.entries, entry];
    this.patch(state, { activeId: id });
    return entry;
  }

  private removeEntry(sessionId: string, terminalId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    const index = state.entries.findIndex((e) => e.id === terminalId);
    if (index < 0) return;
    const [entry] = state.entries.splice(index, 1);
    state.entries = [...state.entries];
    this.internals.get(terminalId)?.dataOff();
    this.internals.delete(terminalId);
    entry!.emulator.dispose();
    const next =
      state.activeId === terminalId
        ? (state.entries[Math.min(index, state.entries.length - 1)]?.id ?? null)
        : state.activeId;
    this.patch(state, { activeId: next });
  }

  private setStatus(entry: TerminalEntry, status: TerminalStatus, exitCode: number | null): void {
    const state = this.sessions.get(entry.sessionId);
    if (!state) return;
    state.entries = state.entries.map((e) => (e.id === entry.id ? { ...e, status, exitCode } : e));
    this.patch(state, {});
  }

  private patch(
    state: SessionState,
    changes: Partial<Pick<SessionState, 'activeId' | 'loading' | 'error'>>,
  ): void {
    Object.assign(state, changes);
    state.snapshot = {
      entries: state.entries,
      activeId: state.activeId,
      loading: state.loading,
      error: state.error,
    };
    this.emit();
  }

  private emit(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
