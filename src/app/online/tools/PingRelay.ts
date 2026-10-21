/**
 * Pings in an online session, per scene like lasers (ruling P6). A player's `map-ping` is accepted only for the scene
 * the sender has, at most `PING_LIMITS.perSecond` a second; it goes to the other players of that scene with `from`
 * (the sender's session id, whatever the player put there) and their colour, and shows in the GM's view while that
 * view shows the scene. Nothing is stored. A `GmSession` handler.
 */
import type { ViewId } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotProjection } from '../scene/slotViews';
import { laserColor } from './laserColors';
import { isPingPoint, PING_LIMITS } from './pings';
import type { BoardSessionSink } from './BoardSessionHub';

export interface PingRelayOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'shownSnapshot'>;
  /** Shows a ping in the GM's view of a scene; without it the GM sees none (an Atlas whose map Connect cannot draw on). */
  show?(viewId: ViewId, ping: { x: number; y: number; color: string }): void;
  /** Tabletop's 3D board on the GM's side, wherever it shows the map. */
  board?: Pick<BoardSessionSink, 'ping'>;
}

export class PingRelay implements SessionHandler {
  private readonly limit = new RateLimit(PING_LIMITS.perSecond);
  private unuse: (() => void) | null = null;

  constructor(private readonly options: PingRelayOptions) {}

  start(): void {
    this.unuse ??= this.options.session.use(this);
  }

  stop(): void {
    this.unuse?.();
    this.unuse = null;
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'map-ping' || !isPingPoint(message)) return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || !this.limit.allow(player.playerId, Date.now())) return;
    const players = this.options.session.getPlayers();
    const color = laserColor(player.playerId, players.map((each) => each.playerId));
    const ping = { v: 1 as const, type: 'map-ping' as const, sceneId: slot.sceneId, x: message.x, y: message.y, from: player.playerId, color };
    for (const playerId of this.options.projection.audience(slot.sceneId)) {
      if (playerId !== player.playerId) this.options.session.send(playerId, ping);
    }
    this.options.board?.ping(slot.mapPath, message.x, message.y, color);
    if (this.options.projection.shownSnapshot(slot.sceneId) !== null) {
      try {
        this.options.show?.(slot.tab.viewId, { x: message.x, y: message.y, color });
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not show a ping:', error);
      }
    }
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }
}
