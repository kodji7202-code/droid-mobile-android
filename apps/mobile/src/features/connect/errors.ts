import { TransportPolicyError } from '../../stores/connection';

export type ConnectErrorKey =
  | 'connect.errorUrlFormat'
  | 'connect.errorInsecure'
  | 'connect.errorKeyFormat'
  | 'connect.errorKeyRejected'
  | 'connect.errorUnreachable'
  | 'connect.error';

/** Maps a rejected connect to a message; only the typed `kind` is trusted. */
export function messageKeyFor(error: unknown): ConnectErrorKey {
  if (error instanceof TransportPolicyError) {
    return error.reason === 'insecure' ? 'connect.errorInsecure' : 'connect.errorUrlFormat';
  }
  const kind = (error as { kind?: unknown } | null)?.kind;
  if (kind === 'auth') return 'connect.errorKeyRejected';
  if (kind === 'connection') return 'connect.errorUnreachable';
  return 'connect.error';
}
