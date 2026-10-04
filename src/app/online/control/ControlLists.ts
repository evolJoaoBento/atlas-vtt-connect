/**
 * Sends each admitted player the tokens they control (`token-control`): on admission
 * (a reconnect and a replacing tab included), with every resync they ask for, and
 * whenever their assignments change. A `GmSession` handler registered after the
 * broadcaster and the camera sender, so the list follows the snapshot it goes with.
 * A resync is throttled by its own `ResyncThrottle` at the broadcaster's interval, so
 * when the broadcaster defers the snapshot the list waits for it too (both timers are
 * set in the same dispatch, the broadcaster's first). Control is per player and never
 * part of the shared projection.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../scene/PlayerSceneMirror';
import { ResyncThrottle } from '../scene/ResyncThrottle';
import type { SceneSession } from '../scene/sceneContracts';
import type { TokenControl } from './TokenControl';

export interface ControlListsOptions {
  session: SceneSession;
  control: TokenControl;
}

export class ControlLists implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  private readonly resyncs = new ResyncThrottle(RESYNC_MIN_INTERVAL_MS);

  constructor(private readonly options: ControlListsOptions) {}

  start(): void {
    this.stops.push(
      this.options.session.use(this),
      this.options.control.onChange((playerIds) => playerIds.forEach((playerId) => this.send(playerId))),
    );
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.resyncs.clear();
  }

  onAdmitted(player: SessionPlayer): void {
    this.send(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'scene-resync') this.resyncs.request(player.playerId, () => this.send(player.playerId));
  }

  /** The session sends to admitted players only, so a gone or removed player gets nothing. */
  private send(playerId: string): void {
    this.options.session.send(playerId, { v: 1, type: 'token-control', tokenIds: this.options.control.tokensOf(playerId) });
  }
}
