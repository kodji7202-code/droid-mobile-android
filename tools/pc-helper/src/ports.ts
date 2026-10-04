/**
 * The mission only ever uses ports 3100-3199 (AGENTS.md port boundaries). Helper
 * scripts validate every port argument against this boundary before use.
 */
export const MISSION_PORT_MIN = 3100;
export const MISSION_PORT_MAX = 3199;

export function isMissionPort(port: number): boolean {
  return Number.isInteger(port) && port >= MISSION_PORT_MIN && port <= MISSION_PORT_MAX;
}

/** Parses a CLI port argument; returns null when absent, empty or out of range. */
export function parsePort(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') {
    return null;
  }
  const port = Number(value);
  return isMissionPort(port) ? port : null;
}
