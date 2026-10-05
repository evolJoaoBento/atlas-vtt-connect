/**
 * Lasers in an online session. A player's `laser` goes to every other admitted player with
 * `from`, the sender's session id (anything the player put there is ignored), and shows in the
 * GM's view while the presented scene is live. The GM's own laser in that view goes to every
 * player from `gm`, batched like the page's. Lasers for another scene than the one players have
 * are dropped, more than 60 a second from one player are ignored (a lift of a laser being held still goes on, without points), and nothing is stored. A
 * player who leaves or is removed mid-stroke is let go everywhere. A `GmSession` handler.
 */
import type { Disposer, LasersApi } from '@atlas-vtt/api-types';
import type { LiveScene } from '../atlas/presentedSource';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import type { ScenePoint } from '../scene/sceneTypes';
import { LaserBatcher } from './LaserBatcher';
import { GM_LASER_ID, laserColor, swatchLaserColor } from './laserColors';
import { isLaserColor, LASER_LIMITS } from './toolMessages';

export interface LaserRelayOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  /** The scene players have: lasers for any other are dropped. */
  projection: Pick<CameraProjection, 'currentProjection'>;
  /** The GM's laser in a view, and other people's lasers shown in it (`lasers.onLocal`, `lasers.show`). */
  laser: Pick<LasersApi, 'onLocal' | 'show'>;
  /** The GM's laser colour in Atlas, read for every message so a change applies from the next one. */
  gmColor?: () => string;
}

export class LaserRelay implements SessionHandler {
  private readonly limit = new RateLimit(LASER_LIMITS.perSecond * 2);
  private readonly batcher = new LaserBatcher((points, lifted, dt) => this.relay(GM_LASER_ID, points, lifted, null, dt));
  private readonly stops: Array<() => void> = [];
  /** The presented scene while it is live; the GM's laser is read from its view. */
  private live: LiveScene | null = null;
  private stopLocal: Disposer | null = null;
  /** Players with a stroke in progress, so leaving lets it go. */
  private readonly drawing = new Set<string>();
  /** The swatch each drawing player last sent, so a stroke that is let go for them keeps its color. */
  private readonly picks = new Map<string, string>();

  constructor(private readonly options: LaserRelayOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    const { session, presented } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => this.attach(scene),
        held: () => this.detach(),
        cleared: () => this.detach(),
      }),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.attach(current);
  }

  stop(): void {
    this.detach();
    this.batcher.dispose();
    this.stops.splice(0).forEach((stop) => stop());
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'laser') return;
    // Over the limit (60 a second, twice the sender's rate) only a lift of a laser being held goes on, with no points.
    const allowed = this.limit.allow(player.playerId, Date.now());
    if (!allowed && !(message.lifted && this.drawing.has(player.playerId))) return;
    const points = allowed ? message.points : [];
    const dt = allowed ? message.dt : undefined;
    if (message.sceneId !== this.options.projection.currentProjection()?.sceneId) return;
    if (message.lifted) this.drawing.delete(player.playerId);
    else this.drawing.add(player.playerId);
    // Field by field: a page may add keys to its points.
    // A player's color is one of the swatches; anything else is theirs by join order.
    const picked = swatchLaserColor(message.color);
    if (picked && !message.lifted) this.picks.set(player.playerId, picked);
    else if (!picked) this.picks.delete(player.playerId);
    this.relay(player.playerId, points.map(({ x, y }) => ({ x, y })), message.lifted, player.playerId, dt ? [...dt] : undefined, picked ?? null);
    if (message.lifted) this.picks.delete(player.playerId);
  }

  onGone(player: SessionPlayer): void {
    this.letGo(player.playerId);
  }

  /** The session's players changed: a removed player's laser goes, and so does their rate window. */
  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const playerId of [...this.drawing]) if (!known.has(playerId)) this.letGo(playerId);
  }

  private attach(scene: LiveScene): void {
    this.detach();
    this.live = scene;
    this.stopLocal = this.options.laser.onLocal(scene.info.viewId, (event) => {
      if (event.kind === 'point') this.batcher.point(event);
      else this.batcher.lift();
    });
  }

  /** The GM's laser was on the view that stops being shown: it is let go. */
  private detach(): void {
    this.batcher.lift();
    this.stopLocal?.();
    this.stopLocal = null;
    this.live = null;
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
    if (this.drawing.delete(playerId)) this.relay(playerId, [], true, playerId, undefined, this.picks.get(playerId) ?? null);
    this.picks.delete(playerId);
  }

  /** To every admitted player but the sender; a player's laser also into the GM's view while the scene is live. */
  private relay(from: string, points: ScenePoint[], lifted: boolean, sender: string | null, dt?: number[], picked: string | null = null): void {
    const scene = this.options.projection.currentProjection();
    if (!scene) return;
    const { session, presented } = this.options;
    const players = session.getPlayers();
    const order = players.filter((player) => player.status !== 'pending').map((player) => player.playerId);
    const color = this.colorOf(from, order, picked);
    for (const player of players) {
      if (player.status !== 'admitted' || player.playerId === sender) continue;
      session.send(player.playerId, { v: 1, type: 'laser', from, sceneId: scene.sceneId, points, lifted, color, ...(dt ? { dt } : {}) });
    }
    if (sender === null || !this.live || presented.isHeld()) return;
    this.options.laser.show(this.live.info.viewId, { from, color, points, lifted, ...(dt ? { dt } : {}) });
  }
}
