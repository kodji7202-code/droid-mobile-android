import type {
  CreateTerminalParams,
  TerminalClient,
  TerminalEvent,
  TerminalInfo,
  TerminalLinkStatus,
} from '@droidmobile/daemon-client';
import type { Emulator, TerminalCell } from './TerminalManager';

/** In-memory stand-ins for the sidecar socket and xterm, used by unit tests only. */
export class FakeEmulator implements Emulator {
  readonly element = document.createElement('div');
  cols = 80;
  rows = 24;
  text = '';
  resets = 0;
  disposed = false;
  fitSize: { cols: number; rows: number } | null = { cols: 100, rows: 30 };
  private listeners = new Set<(data: string) => void>();

  write(data: string): void {
    this.text += data;
  }
  reset(): void {
    this.text = '';
    this.resets += 1;
  }
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }
  fit() {
    if (this.fitSize) {
      this.cols = this.fitSize.cols;
      this.rows = this.fitSize.rows;
    }
    return this.fitSize;
  }
  focus(): void {}
  onData(listener: (data: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  type(data: string): void {
    for (const l of [...this.listeners]) l(data);
  }
  applicationCursor = false;
  atBottom = true;
  selection = '';
  pasted: string[] = [];
  scrolledToBottom = 0;
  private scrollListeners = new Set<(atBottom: boolean) => void>();

  paste(text: string): void {
    this.pasted.push(text);
    this.type(text);
  }
  scrollToBottom(): void {
    this.scrolledToBottom += 1;
    this.setAtBottom(true);
  }
  setAtBottom(value: boolean): void {
    this.atBottom = value;
    for (const l of [...this.scrollListeners]) l(value);
  }
  onScrollState(listener: (atBottom: boolean) => void): () => void {
    this.scrollListeners.add(listener);
    return () => this.scrollListeners.delete(listener);
  }
  getSelection(): string {
    return this.selection;
  }
  hasSelection(): boolean {
    return this.selection !== '';
  }
  clearSelection(): void {
    this.selection = '';
  }
  cellAt(): TerminalCell | null {
    return null;
  }
  selectBetween(): void {}
  selectWordAt(): void {}
  dispose(): void {
    this.disposed = true;
  }
}

export class FakeTerminalClient implements TerminalClient {
  status: TerminalLinkStatus = 'idle';
  frames: Array<{ op: string; sessionId: string; terminalId?: string; [k: string]: unknown }> = [];
  /** What the "daemon" holds per session. */
  daemon = new Map<string, TerminalInfo[]>();
  createError: string | null = null;
  /** "reject" throws, "fail" resolves false; the shell stays alive on the daemon either way. */
  closeMode: 'ok' | 'reject' | 'fail' = 'ok';
  listGate: Promise<void> | null = null;
  disposed = false;
  private statusListeners = new Set<(s: TerminalLinkStatus) => void>();
  private eventListeners = new Set<(e: TerminalEvent) => void>();

  async connect(): Promise<void> {
    this.setStatus('ready');
  }
  setStatus(status: TerminalLinkStatus): void {
    this.status = status;
    for (const l of [...this.statusListeners]) l(status);
  }
  onStatus(listener: (s: TerminalLinkStatus) => void) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  onEvent(listener: (e: TerminalEvent) => void) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  emit(event: TerminalEvent): void {
    for (const l of [...this.eventListeners]) l(event);
  }
  async create(sessionId: string, params: CreateTerminalParams): Promise<void> {
    this.frames.push({ op: 'create', sessionId, ...params });
    if (this.createError) throw new Error(this.createError);
    const list = this.daemon.get(sessionId) ?? [];
    list.push({ id: params.terminalId, pid: 1, cols: params.cols, rows: params.rows });
    this.daemon.set(sessionId, list);
  }
  async write(sessionId: string, terminalId: string, data: string): Promise<boolean> {
    this.frames.push({ op: 'write', sessionId, terminalId, data });
    return true;
  }
  async resize(sessionId: string, terminalId: string, cols: number, rows: number) {
    this.frames.push({ op: 'resize', sessionId, terminalId, cols, rows });
    return true;
  }
  async close(sessionId: string, terminalId: string): Promise<boolean> {
    this.frames.push({ op: 'close', sessionId, terminalId });
    if (this.closeMode === 'reject') throw new Error('The terminal connection is not ready.');
    if (this.closeMode === 'fail') return false;
    this.daemon.set(
      sessionId,
      (this.daemon.get(sessionId) ?? []).filter((t) => t.id !== terminalId),
    );
    return true;
  }
  async list(sessionId: string): Promise<TerminalInfo[]> {
    this.frames.push({ op: 'list', sessionId });
    const snapshot = [...(this.daemon.get(sessionId) ?? [])];
    if (this.listGate) await this.listGate;
    return snapshot;
  }
  dispose(): void {
    this.disposed = true;
    this.status = 'closed';
  }
  count(op: string): number {
    return this.frames.filter((f) => f.op === op).length;
  }
}
