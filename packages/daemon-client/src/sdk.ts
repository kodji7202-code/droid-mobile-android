/**
 * Lazy access to the SDK's runtime exports. The SDK is about 1 MB of JavaScript, so
 * the app must not pay for it before the user connects: every value import goes
 * through this module (type imports are free), and bundlers split it into its own chunk.
 */
type Sdk = typeof import('@factory/droid-sdk');

let loaded: Sdk | undefined;
let pending: Promise<Sdk> | undefined;

export function loadSdk(): Promise<Sdk> {
  pending ??= import('@factory/droid-sdk').then(
    (module) => (loaded = module),
    (error: unknown) => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}

/** The SDK once `loadSdk` has resolved, otherwise undefined. */
export function loadedSdk(): Sdk | undefined {
  return loaded;
}
