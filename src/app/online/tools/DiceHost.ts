/**
 * Dice in an online session. A player's roll (`dice-roll`) is rolled through Atlas (`dice.roll`) with the dice rules
 * of the collection holding their own scene's map (exploding dice, the critical rule), so it cannot be faked, and joins
 * Atlas's dice log, toasts and sounds under the player's name. The log stays one, shared: every roll the dice log gets,
 * the GM's and players', goes to every admitted player as `dice-log`, marked `mine` for the player who rolled it; each
 * admission replays the latest 50, newest first. Every entry is worked out per recipient (P5): a roll named after a
 * token keeps that name only for the players of the scene the GM's view showed it on; everyone else reads "GM". While
 * more than one scene is in use a player's roll carries the roller's scene name (D7, P9). A player's physical roll
 * (`dice-result`, thrown on Tabletop's board) is judged by the same rules (`physicalRolls.ts`) and published into that
 * log; a roll of their sheet is named from the GM's own copy of it, never by the player. More than 2 rolls a second
 * from one player, of either kind, are ignored. A `GmSession` handler, started after the token control host.
 */
import type { DiceRollRequest, DiceRollResult, Disposer } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import { admitted } from '../scene/slotAudience';
import type { SlotProjection } from '../scene/slotViews';
import { cleanSceneLabel, DICE_LIMITS, diceLogEntry, entryFor, GM_ROLLER_NAME, playerRollFormula, type DiceLogEntry, type OfferedDiceRules, type PhysicalRoll } from './toolMessages';
import { physicalRollResult, rerollExpectation, type RerollExpectation } from './physicalRolls';
import type { AdvantageSide, SheetRollRef } from './sheets';

/** What a roll from a player's sheet adds: the ability Atlas's toast names it after, and the side it is rolled with. */
export interface SheetRollExtras {
  abilityName?: string;
  advantage?: AdvantageSide;
}

/** A player's roll as `DiceHostOptions.roll` gets it: Atlas's request and what a roll from a sheet adds. */
export type PlayerRollRequest = DiceRollRequest & SheetRollExtras;

/**
 * Dice APIs that roll `SheetRollExtras` themselves (Connect's stand-in for a stock Atlas, whose dice tool takes the
 * ability and the side). Any other is asked with Atlas's own request, the extras folded in (`foldedRequest`).
 */
export const SHEET_AWARE_DICE = new WeakSet<object>();

/** Longest roll label Atlas's API takes (`rolledBy`). */
const MAX_API_ROLLED_BY = 40;

/**
 * A sheet roll as an Atlas API without the extras takes it: the ability in the roller's name ("Anna: Dagger"), and the
 * side as a d20 kept high or low, the dice of a d20 system's stat block (a bare bonus is added to `2d20kh1`).
 */
export function foldedRequest(request: PlayerRollRequest): DiceRollRequest {
  const { abilityName, advantage, ...base } = request;
  const rolledBy = base.rolledBy && abilityName ? `${base.rolledBy}: ${abilityName}`.slice(0, MAX_API_ROLLED_BY) : base.rolledBy;
  let { formula } = base;
  if (advantage) {
    const keep = advantage === 'advantage' ? '2d20kh1' : '2d20kl1';
    if (/^[+-]\d+$/.test(formula)) formula = `${keep}${formula}`;
    else formula = formula.replace(/^1?d20(?![\d!k])/i, keep);
  }
  return { ...base, formula, ...(rolledBy !== undefined ? { rolledBy } : {}) };
}

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
  roll(request: PlayerRollRequest): DiceRollResult;
  feed: DiceFeed;
  /** The dice rules of the collection holding `mapPath`, as the GM offers them; without it players' physical rolls are ignored. */
  rules?: (mapPath: string | null) => OfferedDiceRules;
  /**
   * Whether the GM's own rolls reach players (Atlas's "Show my rolls to players", the `showDiceRolls` rule of its player
   * view): asked at each roll. Without it they do, as before Atlas 0.7 made them private unless shared.
   */
  gmRollsShared?: () => boolean;
}

/** Names a roll of a player's sheet from the GM's own copy of it; null when the player has no such roll there. */
export interface SheetRollLabels {
  rollLabel(player: SessionPlayer, tokenId: string, roll: SheetRollRef): string | null;
  /** The formula of that roll on the GM's copy; without it a thrown sheet roll expects no reroll, so a rerolled die in it is refused. */
  rollFormula?(player: SessionPlayer, tokenId: string, roll: SheetRollRef): string | null;
}

/** Longest name Atlas takes for who rolled (`DiceRollRequest.rolledBy`). */
const MAX_ROLLED_BY = 40;

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
  private sheets: SheetRollLabels | null = null;

  constructor(private readonly options: DiceHostOptions) {}

  /** The sheets players' physical sheet rolls are named from; without them such a roll is ignored. */
  useSheets(sheets: SheetRollLabels | null): void {
    this.sheets = sheets;
  }

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
    if (message.type === 'dice-result') {
      this.takeThrown(player, message);
      return;
    }
    if (message.type !== 'dice-roll') return;
    const formula = playerRollFormula(message.dice, message.modifier);
    if (formula === null) {
      console.warn('[Atlas VTT Connect] A player roll was ignored: Atlas does not roll that formula.');
      return;
    }
    // A side the player chose in the tray goes with the roll, as one from a sheet does.
    this.rollFor(player, formula, message.advantage ? { advantage: message.advantage } : {});
  }

  /**
   * Rolls `formula` for `player` through Atlas, logged under their name and marked theirs, named after the ability of
   * their sheet it was rolled from and with its side (`extras`); false when it went over their rolls a second or Atlas
   * refused it.
   */
  rollFor(player: SessionPlayer, formula: string, extras: SheetRollExtras = {}): boolean {
    if (!this.limit.allow(player.playerId, Date.now())) return false;
    const label = player.name.slice(0, MAX_ROLLED_BY);
    this.rolling = { playerId: player.playerId, name: label };
    try {
      // The map of the player's own scene: what they see, live or parked; none while they have no scene.
      this.options.roll({ formula, mapPath: this.options.projection.slotOf(player.playerId)?.mapPath || null, rolledBy: label, ...extras });
      return true;
    } catch (error) {
      // Atlas refuses a formula it cannot roll by throwing; one player's roll must not stop the session's other messages.
      console.warn('[Atlas VTT Connect] A player roll was ignored:', error);
      return false;
    } finally {
      this.rolling = null;
    }
  }

  /**
   * Publishes a player's physical roll into Atlas's log, judged by the rules of the collection holding their scene's
   * map and named after them (and after the ability of their sheet it was thrown for, read from the GM's copy).
   */
  private takeThrown(player: SessionPlayer, message: PhysicalRoll): void {
    const { rules } = this.options;
    if (!rules || !this.limit.allow(player.playerId, Date.now())) return;
    const label = player.name.slice(0, MAX_ROLLED_BY);
    this.rolling = { playerId: player.playerId, name: label };
    try {
      let ability: string | undefined;
      // The rerolls the roll may hold are those of the sheet roll on the GM's copy; a free roll from the tray holds none.
      let rerolls: RerollExpectation = {};
      if (message.sheet) {
        const found = this.sheets?.rollLabel(player, message.sheet.tokenId, message.sheet.roll) ?? null;
        if (!found) throw new Error('it is for a sheet roll the player does not have');
        ability = found;
        rerolls = rerollExpectation(this.sheets?.rollFormula?.(player, message.sheet.tokenId, message.sheet.roll) ?? undefined);
      }
      const result = physicalRollResult(message, rules(this.options.projection.slotOf(player.playerId)?.mapPath || null), label, ability, rerolls);
      this.options.feed.publish(result);
    } catch (error) {
      // A roll the rules refuse, or Atlas does not take, must not stop the session's other messages.
      console.warn("[Atlas VTT Connect] A player's thrown dice were ignored:", error);
    } finally {
      this.rolling = null;
    }
  }

  /** Drops the windows of players who left the session: a reconnect must not reset one. */
  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private rolled(result: DiceRollResult): void {
    // The GM's own rolls are private unless the GM shares them; a roll made for a player is always the table's.
    if (!result.rolledBy && !(this.options.gmRollsShared?.() ?? true)) return;
    // A roll from a player's sheet reads "Anna: Dagger" in the players' log, as Atlas's toast names its ability.
    const ability = result.rolledBy ? result.source?.abilityName?.trim() : undefined;
    const roller = result.rolledBy ? playerName(result.rolledBy) : GM_ROLLER_NAME;
    const base = diceLogEntry(result, ability ? `${roller}: ${ability}` : roller);
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
