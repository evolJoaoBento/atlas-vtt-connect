/**
 * What happens inside one join: the state it keeps, the player session it runs against the GM, and
 * what a scene tab gets when it attaches. `OnlineJoinService` owns the join and calls these.
 */
import type { AssetLoader } from '../assets/AssetLoader';
import type { JoinTarget } from '../joinLink';
import { mergeDiceLog, ownRolls } from '../page/diceLogModel';
import type { PlayerSession, PlayerSessionState, PlayerShareHandler } from '../PlayerSession';
import { createJoinSession } from '../preview/joinSession';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import type { JoinIdentity } from '../sharing/identity/JoinIdentity';
import type { DiceLogEntry } from '../tools/toolMessages';
import type { ClientTransport } from '../transport/types';
import type { OnlineSceneSink } from './onlineJoinTypes';

export interface Joined {
  target: JoinTarget;
  name: string;
  playerKey: string;
  loader: AssetLoader;
  session: PlayerSession | null;
  /** The tab was opened for this join: a re-admission after Reconnect opens no second one. */
  opened: boolean;
  scene: PlayerScene | null;
  camera: SceneCamera | null;
  control: readonly string[];
  dice: readonly DiceLogEntry[];
  /** The scene shown is paused: the GM is on another scene. */
  paused: boolean;
  /** The GM's dice look for the scene shown (`scene-look`); null for none. */
  diceLook: string | null;
  ids: JoinIdentity;
}

/** What a running join needs from the service that owns it. */
export interface FlowHost {
  /** Whether `joined` is still the join the service holds (a left or replaced join goes quiet). */
  isCurrent(joined: Joined): boolean;
  sink(): OnlineSceneSink | null;
  changed(joined: Joined, state: PlayerSessionState): void;
  createClient(server: JoinTarget['server']): ClientTransport;
  clientVersion: string;
  shareHandler(): PlayerShareHandler | null;
}

/** Starts the player session of `joined`; what it hears goes to the tab through `host.sink()`. */
export function startJoinedSession(joined: Joined, host: FlowHost): PlayerSession {
  const current = (): boolean => host.isCurrent(joined) && joined.session === session;
  const share = host.shareHandler();
  const session: PlayerSession = createJoinSession({
    loader: joined.loader,
    hostId: joined.target.hostId,
    name: joined.name,
    playerKey: joined.playerKey,
    clientVersion: host.clientVersion,
    clientKind: 'obsidian',
    ...(share ? { share } : {}),
    ...(joined.ids.device ? { device: joined.ids.device } : {}),
    transport: host.createClient(joined.target.server),
    onChange: (state) => { if (current()) host.changed(joined, state); },
    onScene: (scene) => {
      if (!current()) return;
      joined.scene = scene;
      host.sink()?.scene(scene);
    },
    onCamera: (camera) => {
      if (!current()) return;
      joined.camera = camera;
      host.sink()?.camera(camera);
    },
    onControl: (tokenIds) => {
      if (!current()) return;
      joined.control = tokenIds;
      host.sink()?.control(tokenIds);
    },
    onMoveRefused: (tokenId) => { if (current()) host.sink()?.moveRefused(tokenId); },
    onSceneState: (paused) => {
      if (!current()) return;
      joined.paused = paused;
      host.sink()?.paused?.(paused);
    },
    onDiceLook: (look) => {
      if (!current()) return;
      joined.diceLook = look;
      host.sink()?.diceLook?.(look);
    },
    onDiceLog: (entries, replay) => {
      if (!current()) return;
      const { list, fresh } = mergeDiceLog(joined.dice, entries, replay);
      if (list === joined.dice) return;
      joined.dice = list;
      host.sink()?.diceLog(list);
      // Only live rolls are thrown: a replay, or what `catchUp` hands a tab, repeats old ones.
      for (const entry of ownRolls(fresh)) host.sink()?.ownRoll(entry);
    },
    onLaser: (laser) => { if (current()) host.sink()?.laser(laser); },
  });
  return session;
}

/**
 * Gives a tab that attaches what is known so far. Once the sink is set the tab is attached, whatever
 * the catch-up does: a step that throws is logged and the others still run; a throw here would leave
 * the tab showing the session without its controls.
 */
export function catchUp(sink: OnlineSceneSink, joined: Joined, session: PlayerSession): void {
  const steps: Array<() => void> = [
    () => sink.session(session.state),
    () => sink.control(joined.control),
    () => sink.diceLog(joined.dice),
    () => sink.scene(joined.scene),
    () => sink.paused?.(joined.paused),
    () => sink.diceLook?.(joined.diceLook),
    () => { if (joined.camera) sink.camera(joined.camera); },
    () => sink.images(),
  ];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      console.error('[Atlas VTT Connect] The scene tab could not show part of the session:', error);
    }
  }
}
