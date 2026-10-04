import type { NormalizedEvent, SessionHandle } from '@droidmobile/daemon-client';

export type TurnOutcome = 'done' | 'lost';

/**
 * Drives one stream turn. A dropped socket can leave the underlying iterator
 * pending forever, so every step races against `lost`; when it wins the
 * iterator is abandoned and the caller reloads from the daemon instead.
 */
export async function runTurn(
  handle: Pick<SessionHandle, 'stream'>,
  prompt: string,
  onEvent: (event: NormalizedEvent) => void,
  lost: Promise<'lost'>,
): Promise<TurnOutcome> {
  const stream = handle.stream(prompt);
  try {
    for (;;) {
      const step = await Promise.race([stream.next(), lost]);
      if (step === 'lost') {
        void stream.return(undefined).catch(() => undefined);
        return 'lost';
      }
      if (step.done) return 'done';
      onEvent(step.value);
    }
  } catch (err) {
    void stream.return(undefined).catch(() => undefined);
    throw err;
  }
}
