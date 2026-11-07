/**
 * Each player's own colour, as they pick it (the toolbar's Your colour: one of Atlas's laser swatches), for everything
 * of theirs the session draws: their laser, pings, templates, spells and AR eye. A player who picked none has the one
 * their place in the session gives (`laserColor`). The player sends theirs on each admission and whenever they pick
 * another (`player-color`); the GM keeps it while they are in the session. A `GmSession` handler.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import { laserColor, swatchLaserColor } from './laserColors';

export class PlayerColors implements SessionHandler {
  private readonly picked = new Map<string, string>();
  private readonly listeners = new Set<(playerId: string) => void>();
  private readonly limit = new RateLimit(4);
  private stopUse: (() => void) | null = null;

  constructor(private readonly session: Pick<SceneSession, 'use' | 'getPlayers'>) {}

  start(): void {
    this.stopUse ??= this.session.use(this);
  }

  stop(): void {
    this.stopUse?.();
    this.stopUse = null;
    this.picked.clear();
  }

  /** `playerId`'s colour: their pick, else their place's among `order` (the session's players). */
  colorOf(playerId: string, order: readonly string[] = this.session.getPlayers().map((player) => player.playerId)): string {
    return this.picked.get(playerId) ?? laserColor(playerId, order);
  }

  /** Hears of a player picking another colour; returns the stop. */
  onChange(listener: (playerId: string) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'player-color' || !this.limit.allow(player.playerId, Date.now())) return;
    const color = swatchLaserColor(message.color);
    if (!color || this.picked.get(player.playerId) === color) return;
    this.picked.set(player.playerId, color);
    for (const listener of this.listeners) listener(player.playerId);
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const id of [...this.picked.keys()]) if (!known.has(id)) this.picked.delete(id);
  }
}
