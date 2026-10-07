import type { DaemonServiceApi, ServiceTexts } from './daemonService';

/** How long the service outlives the last running turn, so back-to-back turns do not flap it. */
export const STOP_DELAY_MS = 3000;

export interface ServiceDemand {
  stayConnected: boolean;
  /** A turn is pending or running in any session. */
  turnActive: boolean;
  /** A permission or question request waits for the user. */
  requestPending: boolean;
}

export const serviceWanted = (demand: ServiceDemand): boolean =>
  demand.stayConnected || demand.turnActive || demand.requestPending;

/**
 * Drives the native service from the demand. It starts at once, stops
 * STOP_DELAY_MS after the demand ends, and never restarts a service the user
 * stopped from the notification until the demand has ended and returned. A service
 * that Android ended at its time limit comes back as soon as starting one is legal
 * again, which is when the app is in the foreground.
 */
export class ServiceSync {
  private wanted = false;
  private running = false;
  private suppressed = false;
  private awaitingForeground = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private texts: ServiceTexts | undefined;

  constructor(private readonly service: DaemonServiceApi) {}

  update(demand: ServiceDemand, texts: ServiceTexts): void {
    const wanted = serviceWanted(demand);
    const textsChanged = this.texts?.title !== texts.title || this.texts?.text !== texts.text;
    this.texts = texts;
    if (wanted) {
      this.cancelStop();
      if (!this.wanted) {
        this.suppressed = false;
        this.awaitingForeground = false;
      }
      this.wanted = true;
      const blocked = this.suppressed || this.awaitingForeground;
      if (!blocked && (!this.running || textsChanged)) this.start(texts);
      return;
    }
    this.wanted = false;
    this.suppressed = false;
    this.awaitingForeground = false;
    if (this.running && this.stopTimer === undefined) {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = undefined;
        this.running = false;
        void this.service.stop();
      }, STOP_DELAY_MS);
    }
  }

  /** The user pressed Stop in the notification while the service was wanted. */
  ended(): void {
    this.running = false;
    this.cancelStop();
    this.suppressed = this.wanted;
  }

  /**
   * Android ended the service at its time limit. The demand is unchanged, so the service
   * restarts now if the app is in the foreground, otherwise on the next [resumed].
   */
  timedOut(appActive: boolean): void {
    this.running = false;
    this.cancelStop();
    if (!this.wanted || this.suppressed || !this.texts) return;
    if (appActive) this.start(this.texts);
    else this.awaitingForeground = true;
  }

  /** The app came to the foreground: a service that had to wait for it may start now. */
  resumed(): void {
    if (!this.awaitingForeground) return;
    this.awaitingForeground = false;
    if (this.wanted && !this.suppressed && !this.running && this.texts) this.start(this.texts);
  }

  dispose(): void {
    this.cancelStop();
  }

  private start(texts: ServiceTexts): void {
    this.running = true;
    void this.service.start(texts).then((started) => {
      if (!started) this.running = false;
    });
  }

  private cancelStop(): void {
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
  }
}
