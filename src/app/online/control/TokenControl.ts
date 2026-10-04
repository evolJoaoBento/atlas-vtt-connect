/**
 * Which players control which tokens, for the running online session only: kept here,
 * never in token data, and gone when the session ends. A token may have several
 * controllers and a player several tokens, at most `MAX_CONTROLLED_TOKENS`, the most
 * one `token-control` list carries. Listeners hear which players' lists changed.
 */
import { MAX_CONTROLLED_TOKENS } from '../protocol';
import { isSceneId } from '../scene/sceneValidation';

export type ControlListener = (playerIds: readonly string[]) => void;

export class TokenControl {
  /** Token id → its controllers; a token with none has no entry. Insertion order is assignment order. */
  private readonly byToken = new Map<string, Set<string>>();
  private readonly listeners = new Set<ControlListener>();

  controls(playerId: string, tokenId: string): boolean {
    return this.byToken.get(tokenId)?.has(playerId) ?? false;
  }

  /** The player's tokens, in the order they were first assigned. */
  tokensOf(playerId: string): string[] {
    const tokenIds: string[] = [];
    for (const [tokenId, players] of this.byToken) if (players.has(playerId)) tokenIds.push(tokenId);
    return tokenIds;
  }

  /** Every token someone controls. */
  assignedTokens(): string[] {
    return [...this.byToken.keys()];
  }

  /**
   * Gives `tokenId` to the player or takes it away; a player who has the most tokens gets
   * no more. An id the protocol would not accept is skipped: one bad id in a list would
   * make the player discard the whole `token-control` message.
   */
  set(tokenId: string, playerId: string, controlled: boolean): void {
    if (controlled && !isSceneId(tokenId)) return;
    if (this.controls(playerId, tokenId) === controlled) return;
    if (controlled) {
      if (this.tokensOf(playerId).length >= MAX_CONTROLLED_TOKENS) return;
      const players = this.byToken.get(tokenId) ?? new Set<string>();
      players.add(playerId);
      this.byToken.set(tokenId, players);
    } else {
      const players = this.byToken.get(tokenId);
      players?.delete(playerId);
      if (players?.size === 0) this.byToken.delete(tokenId);
    }
    this.emit([playerId]);
  }

  /** Tokens deleted from the scene lose their controllers. */
  dropTokens(tokenIds: readonly string[]): void {
    const affected = new Set<string>();
    for (const tokenId of tokenIds) {
      const players = this.byToken.get(tokenId);
      if (!players) continue;
      players.forEach((playerId) => affected.add(playerId));
      this.byToken.delete(tokenId);
    }
    if (affected.size > 0) this.emit([...affected]);
  }

  /** Forgets every player not in `known`: a removed (kicked) player loses their tokens; one who is only gone keeps them. */
  retainPlayers(known: ReadonlySet<string>): void {
    const affected = new Set<string>();
    for (const [tokenId, players] of this.byToken) {
      for (const playerId of players) {
        if (known.has(playerId)) continue;
        players.delete(playerId);
        affected.add(playerId);
      }
      if (players.size === 0) this.byToken.delete(tokenId);
    }
    if (affected.size > 0) this.emit([...affected]);
  }

  onChange(listener: ControlListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(playerIds: readonly string[]): void {
    for (const listener of [...this.listeners]) listener(playerIds);
  }
}
