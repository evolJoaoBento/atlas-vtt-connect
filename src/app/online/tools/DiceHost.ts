/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled through Atlas (`dice.roll`) with the
 * dice rules of the presented scene's collection (exploding dice, the critical rule), so it cannot be
 * faked, and joins Atlas's dice log, toasts and sounds under the player's name. Every roll the dice log
 * gets, the GM's and players', goes to every admitted player as `dice-log`, marked `mine` for the player
 * who rolled it; each admission replays the latest 50, newest first. More than 2 rolls a second from one
 * player are ignored. A `GmSession` handler, started after the token control host.
 */
import type { DiceRollRequest, DiceRollResult, Disposer } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { CameraProjection } from '../scene/CameraSender';
import type { PresentedSceneSource, SceneSession } from '../scene/sceneSources';
import { DICE_LIMITS, diceLogEntry, entryFor, GM_ROLLER_NAME, playerRollFormula, type DiceLogEntry } from './toolMessages';

/** Every roll Atlas's dice log gets (`dice.onRolled`), and a way to add one made elsewhere (`dice.publish`). */
export interface DiceFeed {
  subscribe(listener: (result: DiceRollResult) => void): Disposer;
  publish(result: DiceRollResult): void;
}

export interface DiceHostOptions {
  session: SceneSession;
  /** Tells whether the GM looks at another scene than the one players have: ids of another map name nothing. */
  presented: PresentedSceneSource;
  /** The scene players have: a roll names a token only when players see it there, by name. */
  projection: Pick<CameraProjection, 'currentProjection'>;
  /** Rolls and logs by the rules of the collection holding `mapPath` (`dice.roll`); the feed hears the roll before this returns. */
  roll(request: DiceRollRequest): DiceRollResult;
  feed: DiceFeed;
}

/** Room left in a message for its envelope. */
const ENVELOPE_BYTES = 1024;

/**
 * The newest entries (the list is newest first) that fit one message. Tagged dice make an entry larger, and the log
 * holds up to 50 of up to 100 dice each: the oldest are left out, as a log a page cannot take at all would show none.
 */
export function fitDiceLog(entries: readonly DiceLogEntry[]): DiceLogEntry[] {
  const encoder = new TextEncoder();
  let bytes = ENVELOPE_BYTES;
  const fitting: DiceLogEntry[] = [];
  for (const entry of entries) {
    bytes += encoder.encode(JSON.stringify(entry)).length + 1;
    if (bytes > MAX_CONTROL_MESSAGE_BYTES) break;
    fitting.push(entry);
  }
  return fitting;
}

export class DiceHost implements SessionHandler {
  private readonly limit = new RateLimit(DICE_LIMITS.rollsPerSecond);
  /** The latest rolls, newest first, each with the id of the player who rolled it (null: the GM's). */
  private readonly history: Array<{ entry: DiceLogEntry; rolledBy: string | null }> = [];
  /** The player whose roll Atlas is rolling now: the feed hears it before `roll` returns, so before its id is known. */
  private rolling: { playerId: string; name: string } | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: DiceHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.feed.subscribe((result) => this.rolled(result)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** Every admission, a reconnect or a new tab included, replaces the player's log. */
  onAdmitted(player: SessionPlayer): void {
    const entries = fitDiceLog(this.history.map(({ entry, rolledBy }) => entryFor(entry, rolledBy, player.playerId)));
    this.options.session.send(player.playerId, { v: 1, type: 'dice-log', entries, replay: true });
  }

  /**
   * The tray always sends dice, so the default roll never fills in a bare modifier here; it still
   * decides which dice are the default dice a crit or a `default` explosion looks at.
   */
  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'dice-roll' || !this.limit.allow(player.playerId, Date.now())) return;
    const formula = playerRollFormula(message.dice, message.modifier);
    if (formula === null) {
      console.warn('[Atlas VTT Connect] A player roll was ignored: Atlas does not roll that formula.');
      return;
    }
    this.rolling = { playerId: player.playerId, name: player.name };
    try {
      this.options.roll({ formula, mapPath: this.playersMapPath(), rolledBy: player.name });
    } catch (error) {
      // Atlas refuses a formula it cannot roll by throwing; one player's roll must not stop the session's other messages.
      console.warn('[Atlas VTT Connect] A player roll was ignored:', error);
    } finally {
      this.rolling = null;
    }
  }

  /**
   * The map players have: the live scene's, or the presented tab's when the GM holds the scene (looks at another tab of the
   * view, whose store then holds that tab's map) or the store has no snapshot: what players still see.
   */
  private playersMapPath(): string | null {
    const { presented } = this.options;
    const scene = presented.current();
    if (!scene) return null;
    const live = presented.isHeld() ? null : scene.snapshot()?.mapPath;
    return live || scene.info.mapPath || null;
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private rolled(result: DiceRollResult): void {
    const entry = diceLogEntry(result, this.nameOf(result));
    if (!entry) return;
    const { rolling } = this;
    const rolledBy = rolling && result.rolledBy === rolling.name ? rolling.playerId : null;
    this.history.unshift({ entry, rolledBy });
    if (this.history.length > DICE_LIMITS.logEntries) this.history.length = DICE_LIMITS.logEntries;
    const { session } = this.options;
    for (const player of session.getPlayers()) {
      if (player.status !== 'admitted') continue;
      session.send(player.playerId, { v: 1, type: 'dice-log', entries: [entryFor(entry, rolledBy, player.playerId)], replay: false });
    }
  }

  /**
   * An online player's roll carries their name ("GM (player)" for a player called GM). A statblock
   * roll carries its token's name only when `tokenId` is a token players have in their scene, with
   * a name, and the GM looks at that scene (hidden, fogged and unnamed tokens, a held scene and nothing presented are not); else "GM".
   */
  private nameOf(result: DiceRollResult): string {
    if (result.rolledBy) return result.rolledBy.trim().toLowerCase() === GM_ROLLER_NAME.toLowerCase() ? `${GM_ROLLER_NAME} (player)` : result.rolledBy;
    const { source } = result;
    if (source?.type !== 'statblock' || !source.tokenId || this.options.presented.isHeld()) return GM_ROLLER_NAME;
    const tokens = this.options.projection.currentProjection()?.tokens ?? {};
    const name = Object.hasOwn(tokens, source.tokenId) ? tokens[source.tokenId]?.name : null;
    return name || GM_ROLLER_NAME;
  }
}
