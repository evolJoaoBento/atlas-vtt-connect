/**
 * The joined session in Atlas's remote view (`RemoteView`, API 1.12): the session's sink. It feeds the view the
 * scene and the player's part as Atlas records (`toRemoteScene.ts`), the status bar in the join page's words, the
 * shared dice log and the player's own rolls (thrown with their Atlas dice look), follows the GM's camera, sends
 * the player's token drops, laser and rolls, and draws other people's lasers. Only what the GM's projection sent
 * players reaches the view. Closing the view leaves the session; the session ending elsewhere closes the view.
 */
import type { Disposer, LasersApi, RemotePlayerState, RemoteSceneInput, RemoteView, UiApi } from '@atlas-vtt/api-types';
import type { PlayerSessionState } from '../../PlayerSession';
import type { SceneCamera } from '../../scene/sceneCamera';
import type { PlayerScene } from '../../scene/sceneTypes';
import { DICE_LIMITS, type DiceLogEntry, type PlayerLaser } from '../../tools/toolMessages';
import type { OnlineJoinService } from '../OnlineJoinService';
import type { OnlineSceneSink } from '../onlineJoinTypes';
import { diceLogResult, diceLogResults, traySelection } from '../onlineDice';
import { rollRefusal } from '../onlineRollRefusal';
import { onlineSceneStatus } from '../onlineSceneStatus';
import { SHARED_WITH_ME_BUTTON } from '../../ui/onlineCopy';
import { shownUrls } from '../objectUrlImages';
import { RemoteFollower } from './remoteFollower';
import { RemoteLaserLink } from './RemoteLaserLink';
import { remoteToolbarItems } from './remoteToolbar';
import { RemoteTokenMoves } from './remoteTokenMoves';
import { sameValue } from '../../scene/sceneDiff';
import { RemoteSceneMemo, remotePlayerState } from './toRemoteScene';

export type RemoteSceneService = Pick<OnlineJoinService, 'attach' | 'images' | 'reconnect' | 'sendDiceRoll' | 'sendTokenMove' | 'sendLaser' | 'leave'>;

export const RECONNECT_LABEL = 'Reconnect';
/** The status bar's second button (API 1.15 `actions`): opens Shared with me, as the fork's bar did. */
export const SHARED_ACTION_ID = 'shared-with-me';
/** Why a pick of the wrong size is not sent; Atlas's tray already offers at most `maxDice` (the wire limit). */
export const ROLL_DICE_COUNT_TEXT = `Roll 1 to ${DICE_LIMITS.dicePerRoll} dice.`;

export interface Frames {
  request(draw: () => void): number;
  cancel(handle: number): void;
}

const ANIMATION_FRAMES: Frames = {
  request: (draw) => window.requestAnimationFrame(() => draw()),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export interface RemoteSceneClientOptions {
  view: RemoteView;
  service: RemoteSceneService;
  /** Atlas's lasers, when this Atlas has them: the player's laser is sent and others' drawn. */
  lasers?: Pick<LasersApi, 'onLocal' | 'show'> | null;
  /** Atlas's toolbar, when this Atlas has it: Follow GM and Fit map. */
  ui?: Pick<UiApi, 'addToolbarItem' | 'invalidate'> | null;
  /** Opens the Shared with me dialog; without it the status bar offers no such button. */
  openShared?(): void;
  /** The player's Atlas laser colour, read for every batch sent. */
  laserColor(): string;
  /** Tests pass their own frames. */
  frames?: Frames;
}

/** Runs a call into Atlas that throws on input it refuses: logged, so the session's other messages still go; false when it threw. */
function guarded(what: string, call: () => void): boolean {
  try {
    call();
    return true;
  } catch (error) {
    console.error(`[Atlas VTT Connect] The online scene could not show ${what}:`, error);
    return false;
  }
}

function urlsOf(input: RemoteSceneInput | null): string[] {
  if (!input) return [];
  const urls = Object.values(input.tokenImages).filter((url): url is string => url !== null);
  return input.background.url !== null ? [...urls, input.background.url] : urls;
}

export class RemoteSceneClient implements OnlineSceneSink {
  private readonly view: RemoteView;
  private readonly memo = new RemoteSceneMemo();
  private readonly moves: RemoteTokenMoves;
  private readonly follower: RemoteFollower;
  private readonly laserLink: RemoteLaserLink | null;
  private readonly frames: Frames;
  private readonly stops: Disposer[] = [];
  private state: PlayerSessionState | null = null;
  private shown: PlayerScene | null = null;
  private controlled: readonly string[] = [];
  /** The player state Atlas has: the same again is not sent, so Atlas's initiative list keeps its element and scroll. */
  private sentPlayer: RemotePlayerState | null = null;
  private detachSession: (() => void) | null = null;
  private imagesFrame: number | null = null;
  private disposed = false;

  constructor(private readonly options: RemoteSceneClientOptions) {
    const { view, service } = options;
    this.view = view;
    this.frames = options.frames ?? ANIMATION_FRAMES;
    this.moves = new RemoteTokenMoves({
      mayMove: (tokenId) => this.movable().includes(tokenId),
      send: (tokenId, x, y) => service.sendTokenMove(tokenId, x, y),
      cancelDrag: () => view.cancelDrag(),
      onChange: () => this.feedScene(),
      onNotice: () => this.showStatus(),
    });
    this.follower = new RemoteFollower(view, () => options.ui?.invalidate());
    this.laserLink = options.lasers ? new RemoteLaserLink({
      lasers: options.lasers, viewId: view.viewId,
      send: (points, lifted, dt, color) => service.sendLaser(points, lifted, dt, color),
      color: () => options.laserColor(),
    }) : null;
    this.stops.push(
      view.onTokenDrop((move) => { if (!this.disposed) this.moves.drop(move.tokenId, move.x, move.y); }),
      view.onRoll((dice, modifier) => this.roll(dice, modifier)),
      // API 1.15; an older Atlas has no `onStatusAction` and the bar shows only Reconnect.
      ...(view.onStatusAction ? [view.onStatusAction((id) => { if (!this.disposed && id === SHARED_ACTION_ID) options.openShared?.(); })] : []),
      // Closing the view (the tab, Atlas or Connect unloading) leaves the session.
      view.onClose(() => {
        this.dispose();
        service.leave();
      }),
    );
    for (const item of remoteToolbarItems(view.viewId, {
      isFollowing: () => this.follower.isFollowing, followGm: () => this.follower.followGm(), fitMap: () => this.follower.fitMap(),
    })) {
      if (options.ui) this.stops.push(options.ui.addToolbarItem(item));
    }
    this.showStatus();
  }

  /** Attaches to the joined session; false when there is none. */
  attach(): boolean {
    this.detachSession = this.options.service.attach(this);
    return this.detachSession !== null;
  }

  session(state: PlayerSessionState): void {
    this.state = state;
    // Only an admitted player drags tokens: Atlas ends a drag whose token may no longer move.
    this.feedPlayer();
    this.showStatus();
  }

  scene(scene: PlayerScene | null): void {
    if (this.disposed) return;
    this.moves.setScene(scene);
    this.shown = scene;
    this.feedScene();
    this.feedPlayer();
    this.follower.setScene(scene);
    this.showStatus();
  }

  camera(camera: SceneCamera): void {
    if (!this.disposed) guarded('the GM camera', () => this.follower.setGmCamera(camera));
  }

  control(tokenIds: readonly string[]): void {
    this.controlled = [...tokenIds];
    this.feedPlayer();
  }

  moveRefused(tokenId: string): void {
    if (!this.disposed) this.moves.refused(tokenId);
  }

  diceLog(entries: readonly DiceLogEntry[]): void {
    if (!this.disposed) guarded('the dice log', () => this.view.setDiceLog(diceLogResults(entries)));
  }

  /** The player's own live roll: thrown with their Atlas dice look, a result card where WebGL is missing. */
  ownRoll(entry: DiceLogEntry): void {
    if (!this.disposed) guarded('a roll', () => this.view.throwRoll(diceLogResult(entry)));
  }

  /** Someone else's laser: drawn when it is on the scene this view shows. */
  laser(laser: PlayerLaser): void {
    if (this.disposed || laser.sceneId !== this.shown?.sceneId) return;
    this.laserLink?.show(laser, this.state?.players.map((player) => player.playerId) ?? []);
  }

  /** Images arrive chunk by chunk: the view follows at most once a frame. */
  images(): void {
    if (this.disposed || this.imagesFrame !== null) return;
    this.imagesFrame = this.frames.request(() => {
      this.imagesFrame = null;
      this.feedScene();
    });
  }

  close(): void {
    this.view.close();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachSession?.();
    this.detachSession = null;
    if (this.imagesFrame !== null) this.frames.cancel(this.imagesFrame);
    this.imagesFrame = null;
    for (const stop of this.stops.splice(0)) stop();
    this.laserLink?.dispose();
    this.moves.dispose();
    this.follower.dispose();
    shownUrls.drop(this);
  }

  /** The tokens the player may drag: the GM's list, while they are in the session. */
  private movable(): readonly string[] {
    return this.state?.status === 'admitted' ? this.controlled : [];
  }

  private roll(dice: Readonly<Record<string, number>>, modifier: number): string | null {
    const picked = traySelection(dice);
    if (!picked) return ROLL_DICE_COUNT_TEXT;
    return this.options.service.sendDiceRoll(picked, modifier) ? null : rollRefusal(this.state);
  }

  private feedScene(): void {
    if (this.disposed) return;
    const scene = this.shown;
    const input = scene ? this.memo.input(scene, this.options.service.images, (tokenId) => this.moves.positionOf(tokenId)) : null;
    // The images the previous scene showed may go now (`shownUrls`); a scene Atlas refused leaves them shown.
    if (guarded('the scene', () => this.view.setScene(input))) shownUrls.show(this, urlsOf(input));
  }

  private feedPlayer(): void {
    if (this.disposed) return;
    const player = remotePlayerState(this.shown, this.movable());
    if (this.sentPlayer && sameValue(player, this.sentPlayer)) return;
    if (guarded('the player state', () => this.view.setPlayer(player))) this.sentPlayer = player;
  }

  private showStatus(): void {
    if (this.disposed) return;
    const status = onlineSceneStatus(this.state, this.shown !== null);
    const { service } = this.options;
    // Sent only where the view tells of a choice (`onStatusAction`): an older Atlas knows no `actions`.
    const actions = this.options.openShared && this.view.onStatusAction ? [{ id: SHARED_ACTION_ID, label: SHARED_WITH_ME_BUTTON, icon: 'inbox' }] : [];
    guarded('the status', () => this.view.setStatus({
      title: status.title,
      connection: status.connection,
      tone: status.tone,
      // A refused move says so for a while, as the fork's bar did beside the message.
      message: this.moves.notice ?? status.message,
      ...(status.reconnect ? { action: { label: RECONNECT_LABEL, run: (): void => { service.reconnect(); } } } : {}),
      ...(actions.length > 0 ? { actions } : {}),
    }));
  }
}
