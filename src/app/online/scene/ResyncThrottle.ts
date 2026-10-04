/**
 * Lets each player's resync requests through at most once per interval. A
 * request inside the window waits for the window to end (one pending run per
 * player), so a player that keeps asking cannot make the GM project and send
 * snapshots without limit.
 */
export class ResyncThrottle {
  private readonly lastRun = new Map<string, number>();
  private readonly timers = new Map<string, number>();

  constructor(private readonly intervalMs: number) {}

  request(playerId: string, run: () => void): void {
    if (this.timers.has(playerId)) return;
    const wait = (this.lastRun.get(playerId) ?? -Infinity) + this.intervalMs - Date.now();
    if (wait <= 0) {
      this.lastRun.set(playerId, Date.now());
      run();
      return;
    }
    this.timers.set(playerId, window.setTimeout(() => {
      this.timers.delete(playerId);
      this.lastRun.set(playerId, Date.now());
      run();
    }, wait));
  }

  forget(playerId: string): void {
    const timer = this.timers.get(playerId);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(playerId);
    this.lastRun.delete(playerId);
  }

  /** Forgets every player that is not in `keep`. */
  retain(keep: ReadonlySet<string>): void {
    for (const playerId of new Set([...this.lastRun.keys(), ...this.timers.keys()])) {
      if (!keep.has(playerId)) this.forget(playerId);
    }
  }

  clear(): void {
    for (const playerId of [...this.lastRun.keys(), ...this.timers.keys()]) this.forget(playerId);
  }
}
