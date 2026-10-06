/**
 * Lasers in an online session, per scene (ruling P6). A player's `laser` is accepted only for the scene the sender
 * has, goes to the other players of that scene with `from`, the sender's session id (anything the player put there is
 * ignored), and shows in the GM's view while the GM's view shows that scene. The GM's own laser in that view goes to
 * the shown scene's players only, from `gm`, batched like the page's; a laser drawn on a scene the GM leaves is let go
 * there, and nothing drawn while a tab loads reaches anyone. More than 60 a second from one player are ignored (a lift
 * of a laser being held still goes on, without points), and nothing is stored. A player who leaves or is removed
 * mid-stroke is let go for their scene. A `GmSession` handler.
 */
import type { Disposer, LasersApi, ViewId } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import type { SlotProjection } from '../scene/slotViews';
import { LaserBatcher } from './LaserBatcher';
import { GM_LASER_ID, laserColor, swatchLaserColor } from './laserColors';
import { isLaserColor, LASER_LIMITS } from './toolMessages';

export interface LaserRelayOptions {
  session: SceneSession;
  /** Each player's scene, and the one the GM's view shows: lasers of any other are dropped. */
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'shownSlot' | 'shownSnapshot' | 'onSlotChange'>;
  /** The GM's laser in a view, and other people's lasers shown in it (`lasers.onLocal`, `lasers.show`). */
  laser: Pick<LasersApi, 'onLocal' | 'show'>;
  /** The GM's laser colour in Atlas, read for every message so a change applies from the next one. */
  gmColor?: () => string;
}

/** The GM's laser on one scene: heard in its view, batched for its players only. */
interface GmLaser {
  sceneId: string;
  batcher: LaserBatcher;
  stop: Disposer;
}

interface Stroke {
  from: string;
  sceneId: string;
  points: ScenePoint[];
  lifted: boolean;
  dt?: number[];
  picked?: string | null;
}

export class LaserRelay implements SessionHandler {
  private readonly limit = new RateLimit(LASER_LIMITS.perSecond * 2);
  private readonly stops: Array<() => void> = [];
  /** The GM's laser on the scene the GM's view shows. */
  private gm: GmLaser | null = null;
  /** The GM's laser on the scene the GM just left: its lift may still be waiting for its batch interval. */
  private leaving: LaserBatcher | null = null;
  /** Players with a stroke in progress, and its scene and view, so leaving lets it go there. */
  private readonly drawing = new Map<string, { sceneId: string; viewId: ViewId }>();
  /** The swatch each drawing player last sent, so a stroke that is let go for them keeps its color. */
  private readonly picks = new Map<string, string>();

  constructor(private readonly options: LaserRelayOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.projection.onSlotChange(() => this.follow()));
    this.follow();
  }

  stop(): void {
    this.unfollow();
    this.leaving?.dispose();
    this.leaving = null;
    this.stops.splice(0).forEach((stop) => stop());
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'laser') return;
    const { playerId } = player;
    // Over the limit (60 a second, twice the sender's rate) only a lift of a laser being held goes on, with no points.
    const allowed = this.limit.allow(playerId, Date.now());
    if (!allowed && !(message.lifted && this.drawing.has(playerId))) return;
    const slot = this.options.projection.slotOf(playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId) return;
    if (message.lifted) this.drawing.delete(playerId);
    else this.drawing.set(playerId, { sceneId: slot.sceneId, viewId: slot.tab.viewId });
    // A player's color is one of the swatches; anything else is theirs by join order.
    const picked = swatchLaserColor(message.color);
    if (picked && !message.lifted) this.picks.set(playerId, picked);
    else if (!picked) this.picks.delete(playerId);
    // Field by field: a page may add keys to its points.
    const points = allowed ? message.points.map(({ x, y }) => ({ x, y })) : [];
    const dt = allowed && message.dt ? [...message.dt] : undefined;
    this.relay({ from: playerId, sceneId: slot.sceneId, points, lifted: message.lifted, ...(dt ? { dt } : {}), picked: picked ?? null }, slot.tab.viewId);
    if (message.lifted) this.picks.delete(playerId);
  }

  onGone(player: SessionPlayer): void {
    this.letGo(player.playerId);
  }

  /** The session's players changed: a removed player's laser goes, and so does their rate window. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const playerId of [...this.drawing.keys()]) if (!known.has(playerId)) this.letGo(playerId);
  }

  /** Hears the GM's laser in the view of the scene it shows, once its players have it; nothing while none is shown. */
  private follow(): void {
    const shown = this.options.projection.shownSlot();
    const target = shown?.lastSent ? shown : null;
    if (target && target.sceneId === this.gm?.sceneId) return;
    this.unfollow();
    if (target) this.gm = this.listen(target.sceneId, target.tab.viewId);
  }

  private listen(sceneId: string, viewId: ViewId): GmLaser {
    const batcher = new LaserBatcher((points, lifted, dt) => this.gmBatch(sceneId, points, lifted, dt));
    const stop = this.options.laser.onLocal(viewId, (event) => {
      if (event.kind === 'point') batcher.point(event);
      else batcher.lift();
    });
    return { sceneId, batcher, stop };
  }

  /** The GM's laser on the scene the GM leaves is let go there (its lift may wait for the batch interval). */
  private unfollow(): void {
    const gm = this.gm;
    if (!gm) return;
    this.gm = null;
    gm.stop();
    this.leaving?.dispose();
    gm.batcher.lift();
    this.leaving = gm.batcher;
  }

  /** A batch of the GM's laser on `sceneId`: its points only while the GM's view still shows it (P2), its lift always. */
  private gmBatch(sceneId: string, points: ScenePoint[], lifted: boolean, dt: number[]): void {
    const shown = this.options.projection.shownSnapshot(sceneId) !== null;
    if (!shown && !lifted) return;
    this.relay({ from: GM_LASER_ID, sceneId, points: shown ? points : [], lifted, ...(shown ? { dt } : {}) }, null);
  }

  /** The GM's from Atlas's settings, a player's from their pick or else their place in the session. */
  private colorOf(from: string, order: readonly string[], picked: string | null): string {
    if (from === GM_LASER_ID) {
      const own = this.options.gmColor?.();
      return isLaserColor(own) ? own : laserColor(from, order);
    }
    return picked ?? laserColor(from, order);
  }

  private letGo(playerId: string): void {
    const stroke = this.drawing.get(playerId);
    if (stroke) {
      this.drawing.delete(playerId);
      this.relay({ from: playerId, sceneId: stroke.sceneId, points: [], lifted: true, picked: this.picks.get(playerId) ?? null }, stroke.viewId);
    }
    this.picks.delete(playerId);
  }

  /**
   * To the players of the stroke's scene but its sender (P1, P6); a player's laser also into the GM's view (`viewId`)
   * while that view shows the scene.
   */
  private relay(stroke: Stroke, viewId: ViewId | null): void {
    const { from, sceneId, points, lifted, dt } = stroke;
    const { session, projection } = this.options;
    // Colors by join order across the session, so a player's color is the same on every scene.
    const order = session.getPlayers().filter((player) => player.status !== 'pending').map((player) => player.playerId);
    const color = this.colorOf(from, order, stroke.picked ?? null);
    for (const playerId of projection.audience(sceneId)) {
      if (playerId === from) continue;
      session.send(playerId, { v: 1, type: 'laser', from, sceneId, points, lifted, color, ...(dt ? { dt } : {}) });
    }
    if (from === GM_LASER_ID || viewId === null || projection.shownSnapshot(sceneId) === null) return;
    this.options.laser.show(viewId, { from, color, points, lifted, ...(dt ? { dt } : {}) });
  }
}
