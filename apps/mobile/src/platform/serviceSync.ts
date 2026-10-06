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
 * stopped from the notification until the demand has ended and returned.
 */
export class ServiceSync {
  private wanted = false;
  private running = false;
  private suppressed = false;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;
  private texts: ServiceTexts | undefined;

  constructor(private readonly service: DaemonServiceApi) {}

  update(demand: ServiceDemand, texts: ServiceTexts): void {
    const wanted = serviceWanted(demand);
    const textsChanged = this.texts?.title !== texts.title || this.texts?.text !== texts.text;
    this.texts = texts;
    if (wanted) {
      this.cancelStop();
      if (!this.wanted) this.suppressed = false;
      this.wanted = true;
      if (!this.suppressed && (!this.running || textsChanged)) this.start(texts);
      return;
    }
    this.wanted = false;
    this.suppressed = false;
    if (this.running && this.stopTimer === undefined) {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = undefined;
        this.running = false;
        void this.service.stop();
      }, STOP_DELAY_MS);
    }
  }

  /** The service ended on its own (Stop action or Android timeout) while it was wanted. */
  ended(): void {
    this.running = false;
    this.cancelStop();
    this.suppressed = this.wanted;
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
