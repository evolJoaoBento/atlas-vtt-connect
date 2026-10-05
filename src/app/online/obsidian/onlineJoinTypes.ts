/** What the scene tab takes from a joined session, what it asks of it, and why a join may not start. */
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import type { PlayerSessionState } from '../PlayerSession';
import { INCOMPLETE_LINK_TEXT, NAME_PROBLEM_TEXT } from '../page/pageScreen';
import type { SceneCamera } from '../scene/sceneCamera';
import type { PlayerScene } from '../scene/sceneTypes';
import type { DiceLogEntry, PlayerLaser } from '../tools/toolMessages';

/** What the scene tab takes from the joined session. */
export interface OnlineSceneSink {
  session(state: PlayerSessionState): void;
  scene(scene: PlayerScene | null): void;
  camera(camera: SceneCamera): void;
  control(tokenIds: readonly string[]): void;
  moveRefused(tokenId: string): void;
  /** The shared dice log, newest first, whole. */
  diceLog(entries: readonly DiceLogEntry[]): void;
  /** A roll this player made just now (`mine`), after the log that lists it: shown as the player's own result. */
  ownRoll(entry: DiceLogEntry): void;
  laser(laser: PlayerLaser): void;
  /** Images arrived, failed or went. */
  images(): void;
  /** The session was left from elsewhere (a new join, the plugin unloading): close the tab. */
  close(): void;
}

/** The scene tab's status bar: the GM's session title, the connection and why it waits or ended. */
export interface OnlineSceneStatus {
  /** The GM's session title. */
  title: string;
  /** `Connected`, `Connecting…`, `Reconnecting…`, `Waiting for the GM` or `Disconnected`. */
  connection: string;
  /** The status dot. */
  tone: 'connected' | 'pending' | 'ended';
  /** A line after the connection: waiting, no scene, or why the session ended; null for none. */
  message: string | null;
  /** Shows the Reconnect button. */
  reconnect: boolean;
}

/** What the scene tab's UI asks of its view. */
export interface OnlineSceneControls {
  followGm(): void;
  fitMap(): void;
  reconnect(): void;
  /** Sends a roll from the dice tray; null once it went, else why it could not (`rollRefusal`). */
  rollDice(dice: DiceSelection, modifier: number): string | null;
}

/** The object URLs the scene's images show by (the remote view); null while an image is not ready. */
export interface RemoteImages {
  background(assetId: string | null): string | null;
  token(assetId: string | null): string | null;
}

/** The session title until the GM's arrives, as on the join page. */
export const DEFAULT_TABLE_TITLE = 'the table';

export type JoinProblem = 'link' | 'name' | 'hosting' | 'joined';

export const JOIN_PROBLEM_TEXT: Record<JoinProblem, string> = {
  link: INCOMPLETE_LINK_TEXT,
  name: NAME_PROBLEM_TEXT,
  hosting: 'Stop hosting your online session before joining another.',
  joined: 'You are already in an online session. Close its tab to leave it first.',
};
