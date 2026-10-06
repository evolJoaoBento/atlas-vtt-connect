/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled through Atlas (`dice.roll`) with the dice rules
 * of the collection holding their own scene's map (exploding dice, the critical rule), so it cannot be faked, and joins
 * Atlas's dice log, toasts and sounds under the player's name. The log stays one, shared: every roll the dice log gets,
 * the GM's and players', goes to every admitted player as `dice-log`, marked `mine` for the player who rolled it; each
 * admission replays the latest 50, newest first. Every entry is worked out per recipient (P5): a roll named after a
 * token keeps that name only for the players of the scene the GM's view showed it on; everyone else reads "GM". While
 * more than one scene is in use a player's roll carries the roller's scene name (D7, P9). More than 2 rolls a second
 * from one player are ignored. A `GmSession` handler, started after the token control host.
 */
import type { DiceRollRequest, DiceRollResult, Disposer } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import { admitted } from '../scene/slotAudience';
import type { SlotProjection } from '../scene/slotViews';
import { cleanSceneLabel, DICE_LIMITS, diceLogEntry, entryFor, GM_ROLLER_NAME, playerRollFormula, type DiceLogEntry } from './toolMessages';

/** Every roll Atlas's dice log gets (`dice.onRolled`), and a way to add one made elsewhere (`dice.publish`). */
export interface DiceFeed {
  subscribe(listener: (result: DiceRollResult) => void): Disposer;
  publish(result: DiceRollResult): void;
}

export interface DiceHostOptions {
  session: SceneSession;
  /** Each player's scene, the one the GM's view shows, and how many are in use: names and labels come from them. */
  projection: Pick<SlotProjection, 'slotOf' | 'shownSlot' | 'scenesInUse'>;
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

/** One logged roll: its entry as anyone gets it, who rolled it, and the token it is named after on one scene. */
interface LoggedRoll {
  entry: DiceLogEntry;
  /** The id of the player who rolled it; null for the GM's. */
  rolledBy: string | null;
  /** The token's name, for the players of the scene (`sceneId`) the GM's view showed it on; null when named after none. */
  token: { sceneId: string; name: string } | null;
}

/** An online player's roll carries their name ("GM (player)" for a player called GM). */
function playerName(rolledBy: string): string {
  return rolledBy.trim().toLowerCase() === GM_ROLLER_NAME.toLowerCase() ? `${GM_ROLLER_NAME} (player)` : rolledBy;
}

export class DiceHost implements SessionHandler {
  private readonly limit = new RateLimit(DICE_LIMITS.rollsPerSecond);
  /** The latest rolls, newest first. */
  private readonly history: LoggedRoll[] = [];
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

  /** Every admission, a reconnect or a new tab included, replaces the player's log, worked out for their scene. */
  onAdmitted(player: SessionPlayer): void {
    const entries = fitDiceLog(this.history.map((roll) => this.entryOf(roll, player.playerId)));
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
      // The map of the player's own scene: what they see, live or parked; none while they have no scene.
      this.options.roll({ formula, mapPath: this.options.projection.slotOf(player.playerId)?.mapPath || null, rolledBy: player.name });
    } catch (error) {
      // Atlas refuses a formula it cannot roll by throwing; one player's roll must not stop the session's other messages.
      console.warn('[Atlas VTT Connect] A player roll was ignored:', error);
    } finally {
      this.rolling = null;
    }
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private rolled(result: DiceRollResult): void {
    const base = diceLogEntry(result, result.rolledBy ? playerName(result.rolledBy) : GM_ROLLER_NAME);
    if (!base) return;
    const { rolling } = this;
    const rolledBy = rolling && result.rolledBy === rolling.name ? rolling.playerId : null;
    const { projection } = this.options;
    // D7: a player's roll names the roller's scene while more than one is in use; a GM roll never does.
    const scene = rolledBy !== null && projection.scenesInUse() > 1 ? cleanSceneLabel(projection.slotOf(rolledBy)?.name) : undefined;
    const roll: LoggedRoll = { entry: scene ? { ...base, scene } : base, rolledBy, token: result.rolledBy ? null : this.tokenOf(result) };
    this.history.unshift(roll);
    if (this.history.length > DICE_LIMITS.logEntries) this.history.length = DICE_LIMITS.logEntries;
    const { session } = this.options;
    for (const playerId of admitted(session.getPlayers())) {
      session.send(playerId, { v: 1, type: 'dice-log', entries: [this.entryOf(roll, playerId)], replay: false });
    }
  }

  /**
   * A statblock roll is named after its token only when `tokenId` is a token, with a name, in what the players of the
   * scene the GM's view shows have (hidden, fogged and unnamed tokens, a parked or loading scene and nothing shown are
   * not), worked out when it is rolled. The name is for that scene's players only: an id of one scene names nothing on another.
   */
  private tokenOf(result: DiceRollResult): LoggedRoll['token'] {
    const { source } = result;
    if (source?.type !== 'statblock' || !source.tokenId) return null;
    const shown = this.options.projection.shownSlot();
    const tokens = shown?.lastSent?.tokens ?? {};
    const name = Object.hasOwn(tokens, source.tokenId) ? tokens[source.tokenId]?.name : null;
    return shown && name ? { sceneId: shown.sceneId, name: name.slice(0, DICE_LIMITS.nameLength) } : null;
  }

  /** The roll as `playerId` gets it now (P5): the token's name only on its own scene, "GM" elsewhere; `mine` for its roller. */
  private entryOf(roll: LoggedRoll, playerId: string): DiceLogEntry {
    const { token } = roll;
    const named = token && this.options.projection.slotOf(playerId)?.sceneId === token.sceneId ? { ...roll.entry, name: token.name } : roll.entry;
    return entryFor(named, roll.rolledBy, playerId);
  }
}
