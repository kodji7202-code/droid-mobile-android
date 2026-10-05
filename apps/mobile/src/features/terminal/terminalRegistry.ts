import type { DaemonConnection } from '@droidmobile/daemon-client';
import { useConnectionStore } from '../../stores/connection';
import { TerminalManager } from './TerminalManager';
import type { EmulatorFactory } from './TerminalManager';

let current: { connection: DaemonConnection; manager: TerminalManager } | null = null;
let factoryOverride: EmulatorFactory | null = null;

const lazyXtermFactory: EmulatorFactory = async () => {
  const { loadXtermEmulatorFactory } = await import('./xtermEmulator');
  return loadXtermEmulatorFactory();
};

/** Test seam: replaces the xterm-backed emulator loader. */
export function setEmulatorFactoryForTests(factory: EmulatorFactory | null): void {
  factoryOverride = factory;
}

/**
 * One manager per daemon connection. Replacing or dropping the connection
 * disposes the manager: its sidecar socket closes, the shells keep running on
 * the daemon and are re-listed by the next manager.
 */
export function getTerminalManager(connection: DaemonConnection): TerminalManager {
  if (current?.connection === connection) return current.manager;
  current?.manager.dispose();
  const manager = new TerminalManager({
    client: connection.openTerminalClient(),
    loadEmulatorFactory: factoryOverride ?? lazyXtermFactory,
  });
  current = { connection, manager };
  return manager;
}

export function disposeTerminalManager(): void {
  current?.manager.dispose();
  current = null;
}

useConnectionStore.subscribe((state) => {
  if (current && state.connection !== current.connection) disposeTerminalManager();
});

if (import.meta.hot) {
  // A replaced module would otherwise orphan a live sidecar that still owns the shells.
  import.meta.hot.dispose(disposeTerminalManager);
}
