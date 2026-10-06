/**
 * Sends each admitted player the tokens they control (`token-control`): on admission (a reconnect and a replacing tab
 * included), with every resync they ask for, and whenever their assignments change. While a split exists (ruling P5,
 * D18) a list holds only the player's tokens in their own scene's projection, and is sent again when they move to
 * another scene and when that scene gains or loses one of their tokens; without one it is the full list on those
 * triggers only, as before split party, and when the last assignment goes everyone gets it once. A `GmSession` handler
 * registered after the scene hub and the camera sender, so the list follows the snapshot it goes with. A resync is
 * throttled by its own `ResyncThrottle` at the hub's interval, so when the hub defers the snapshot the list waits for
 * it too. Control is per player and never part of a scene's projection.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../scene/PlayerSceneMirror';
import { ResyncThrottle } from '../scene/ResyncThrottle';
import type { SceneSession } from '../scene/sceneContracts';
import { admitted } from '../scene/slotAudience';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import type { TokenControl } from './TokenControl';

export interface ControlListsOptions {
  session: SceneSession;
  control: TokenControl;
  /** Each player's scene, and whether a split exists. */
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'splitActive' | 'onSlotChange'>;
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean => a?.length === b.length && a.every((id, index) => id === b[index]);

export class ControlLists implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  private readonly resyncs = new ResyncThrottle(RESYNC_MIN_INTERVAL_MS);
  /** The list each player was sent last, so a projection that changes nothing for them sends nothing. */
  private readonly sent = new Map<string, readonly string[]>();
  private split = false;

  constructor(private readonly options: ControlListsOptions) {}

  start(): void {
    const { session, control, projection } = this.options;
    this.split = projection.splitActive();
    this.stops.push(
      session.use(this),
      control.onChange((playerIds) => playerIds.forEach((playerId) => this.send(playerId))),
      projection.onSlotChange((change) => this.scenesChanged(change)),
    );
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.resyncs.clear();
    this.sent.clear();
  }

  onAdmitted(player: SessionPlayer): void {
    this.send(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.resyncs.request(player.playerId, () => this.send(player.playerId));
  }

  onGone(player: SessionPlayer): void {
    this.sent.delete(player.playerId);
  }

  /** The player's tokens; while split, only those their own scene's projection shows (P5). */
  private listOf(playerId: string): string[] {
    const tokenIds = this.options.control.tokensOf(playerId);
    if (!this.options.projection.splitActive()) return tokenIds;
    const tokens = this.options.projection.slotOf(playerId)?.lastSent?.tokens ?? {};
    return tokenIds.filter((tokenId) => Object.hasOwn(tokens, tokenId));
  }

  private scenesChanged(change: SlotChange): void {
    const split = this.options.projection.splitActive();
    if (split !== this.split) {
      // A split begins (lists narrow to each scene) or the last assignment went (everyone gets the full list once).
      this.split = split;
      for (const playerId of admitted(this.options.session.getPlayers())) this.send(playerId);
      return;
    }
    if (!split) return;
    if (change.kind === 'moved') this.send(change.playerId);
    else if (change.kind === 'projected') this.projected(change.slot.sceneId);
  }

  /** The hub tells its listeners just before it sends the projection: the lists go right after it. */
  private projected(sceneId: string): void {
    void Promise.resolve().then(() => {
      if (!this.options.projection.splitActive()) return;
      for (const playerId of this.options.projection.audience(sceneId)) this.sendIfChanged(playerId);
    });
  }

  private sendIfChanged(playerId: string): void {
    if (!sameList(this.sent.get(playerId), this.listOf(playerId))) this.send(playerId);
  }

  /** The session sends to admitted players only, so a gone or removed player gets nothing. */
  private send(playerId: string): void {
    const tokenIds = this.listOf(playerId);
    this.sent.set(playerId, tokenIds);
    this.options.session.send(playerId, { v: 1, type: 'token-control', tokenIds });
  }
}
