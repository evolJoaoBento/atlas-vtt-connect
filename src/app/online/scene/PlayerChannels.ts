/**
 * Per-player delivery for the scene hub: a `seq` that grows by one per message to each player, whatever scene it is
 * of (a move between scenes keeps the player's run), and resync throttling. Who gets what is `slotAudience`'s.
 */
import type { SessionPlayer } from '../GmSession';
import { RESYNC_MIN_INTERVAL_MS } from './PlayerSceneMirror';
import { ResyncThrottle } from './ResyncThrottle';
import type { SceneOutgoing } from './sceneMessages';
import type { SceneSession } from './sceneContracts';

export class PlayerChannels {
  private readonly seqs = new Map<string, number>();
  private readonly resyncs = new ResyncThrottle(RESYNC_MIN_INTERVAL_MS);

  constructor(private readonly session: SceneSession) {}

  /** Sends `message` with the player's next `seq`. */
  sendSequenced(playerId: string, message: SceneOutgoing): void {
    const seq = (this.seqs.get(playerId) ?? 0) + 1;
    this.seqs.set(playerId, seq);
    this.session.send(playerId, { ...message, seq });
  }

  /** Forgets everyone the session no longer knows: a kicked player never reports as gone. */
  retain(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    for (const playerId of [...this.seqs.keys()]) if (!known.has(playerId)) this.seqs.delete(playerId);
    this.resyncs.retain(known);
  }

  /** Runs `run` for the player's resync, at most once per interval. */
  requestResync(playerId: string, run: () => void): void {
    this.resyncs.request(playerId, run);
  }

  forget(playerId: string): void {
    this.seqs.delete(playerId);
    this.resyncs.forget(playerId);
  }

  clear(): void {
    this.resyncs.clear();
  }
}
