/** The GM session's limits, and what its handlers and its owner see. */
import type { ControlMessage, DeviceProof, TableProof } from './protocol';

export const SESSION_LIMITS = {
  joinTimeoutMs: 10_000,
  requestTimeoutMs: 120_000,
  pingIntervalMs: 5_000,
  pingTimeoutMs: 15_000,
  maxPlayers: 12,
  maxPendingRequests: 12,
  maxInvalidMessages: 3,
  /** How long a returning person's identity check may take before the join is denied. */
  reissueTimeoutMs: 10_000,
} as const;

export type PlayerStatus = 'pending' | 'admitted' | 'gone';

export interface SessionPlayer {
  playerId: string;
  name: string;
  status: PlayerStatus;
  /** Set for a player who joined from Atlas in Obsidian; absent for the web page. */
  client?: 'obsidian';
  /** The person the GM admitted them as (Obsidian players with a verified device); absent otherwise. */
  personId?: string;
}

/** Who the GM admits a player as: the person id, and the table proof that tells the player. */
export interface Admission {
  personId: string;
  table: TableProof;
}

export interface SessionHandler {
  onAdmitted?(player: SessionPlayer): void;
  onMessage?(player: SessionPlayer, message: ControlMessage): void;
  /** Anything an admitted player sends on the assets channel, undecoded. */
  onAssetData?(player: SessionPlayer, data: unknown): void;
  onGone?(player: SessionPlayer): void;
}

export interface GmSessionOptions {
  title: string;
  /** A new player is waiting; answer with `allow` or `deny`. `device` is the Obsidian player's device proof, unchecked. */
  onJoinRequest(player: SessionPlayer, device: DeviceProof | null): void;
  /**
   * A player the GM admitted with a person id joins again with a device proof for a new join (new nonce):
   * the admission to give them (the device checked, the table proof signed for the new nonce), or null to deny.
   */
  reissue?(player: SessionPlayer, device: DeviceProof): Promise<Admission | null>;
  /** A request is no longer open: answered, expired, withdrawn or the session stopped. */
  onRequestClosed(playerId: string): void;
  onPlayersChanged(players: SessionPlayer[]): void;
}
