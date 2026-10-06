/**
 * Ruling P8: a parked scene going live on a lit map keeps its parked projection, and sends nothing new, until Atlas can
 * tell what players see (`playerVisibility` ready or unlit). Past `SPLIT_LIMITS.goLiveWaitMs` it goes live anyway, and
 * the projection fails closed (`closedFrame`) as it does whenever sight is pending. One wait per going live.
 */
import { SPLIT_LIMITS } from '../split/splitLimits';

export class SightWait {
  private timer: number | null;
  private done = false;

  /** `ready` runs once: when `check` finds sight known, or when the wait is over. */
  constructor(private readonly ready: () => void, waitMs: number = SPLIT_LIMITS.goLiveWaitMs) {
    this.timer = window.setTimeout(() => this.finish(), waitMs);
  }

  /** Atlas said what players see changed: done once it is no longer pending. */
  check(pending: boolean): void {
    if (!pending) this.finish();
  }

  /** Stops waiting without going live (the scene parked again, or went). */
  cancel(): void {
    this.done = true;
    this.clearTimer();
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.clearTimer();
    this.ready();
  }

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
