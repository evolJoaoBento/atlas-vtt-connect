/**
 * At most `perWindow` messages per player in any window of `windowMs`; messages over the limit
 * do not count. The GM's handlers for player messages each keep one.
 */
export class RateLimit {
  private readonly recent = new Map<string, number[]>();

  constructor(private readonly perWindow: number, private readonly windowMs = 1000) {}

  allow(playerId: string, now: number): boolean {
    const times = (this.recent.get(playerId) ?? []).filter((time) => now - time < this.windowMs);
    const allowed = times.length < this.perWindow;
    if (allowed) times.push(now);
    this.recent.set(playerId, times);
    return allowed;
  }

  /** Forgets every player not in `known`; a player who is only gone keeps their window. */
  retain(known: ReadonlySet<string>): void {
    for (const playerId of [...this.recent.keys()]) if (!known.has(playerId)) this.recent.delete(playerId);
  }
}
