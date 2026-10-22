/**
 * `dice` on a stock Atlas VTT, which has no extension API: a player's roll is rolled by the dice tool of a map view
 * (`serviceManager.getToolController().getDiceTool().rollDice`), which rolls by the rules of the view's map and its
 * collection, throws it on the GM's screen and logs it, as Atlas's own online play rolls for its players. Every roll
 * the views announce on their event bus (`dice-rolled`) reaches `onRolled`, once, whichever view made it.
 *
 * Differences from the API Atlas VTT's extension branch offers, all of what stock Atlas keeps out of reach:
 * - A roll for a player is named after them in the log through the roll's source (`tokenName`), not through `rolledBy`;
 *   the roll `onRolled` hears carries `rolledBy`, so Connect's players' log attributes it.
 * - `publish` announces on the views' buses, which throw the roll in 3D; `throw: false` cannot ask for a card instead.
 *   A die's tag also goes under the names stock Atlas reads (`colour`, `name`), beside the API's.
 * - `throw`, `registerLook` and the look choices do not exist: only `roll`, `onRolled` and `publish` do.
 *
 * More than the API: a roll from a player's sheet names its ability in Atlas's toast and log (the source's
 * `abilityName`, as Atlas's own stat block rolls do) and is rolled with advantage or disadvantage by the dice set's own
 * rule (`rollDice`'s options), so `roll` takes `SheetRollExtras` (`SHEET_AWARE_DICE`).
 */
import type { DiceApi, DicePublishOptions, DiceRollResult, Disposer } from '@atlas-vtt/api-types';
import { SHEET_AWARE_DICE, type PlayerRollRequest } from '../../app/online/tools/DiceHost';
import { dieTagOf } from '../../app/online/tools/diceTags';
import { ADVANTAGE_SIDES, type AdvantageSide } from '../../app/online/tools/sheets';

/** Most dice a roll may list, as the API's `publish` holds it to. */
const MAX_DICE = 1000;
/** Longest name a roll may carry for who rolled it. */
const MAX_ROLLED_BY = 40;
/** Longest ability a roll may be named after. */
const MAX_ABILITY = 120;
/** How many roll ids are remembered so a roll heard on two views is passed on once. */
const REMEMBERED = 200;

interface DiceBus {
  on(event: 'dice-rolled', listener: (result: DiceRollResult) => void): unknown;
  off(event: 'dice-rolled', listener: (result: DiceRollResult) => void): unknown;
  emit(event: 'dice-rolled', result: DiceRollResult): unknown;
}
interface DiceTool {
  rollDice(formula: string, source?: DiceRollResult['source'], origin?: undefined, options?: { advantage?: AdvantageSide }): DiceRollResult | null;
}

/** A map view as the dice read it. */
export interface DiceView {
  readonly viewId: string;
  /** The map the view shows now. */
  mapPath(): string | null;
  /** `view.serviceManager`, unchecked. */
  readonly serviceManager?: unknown;
}

export interface StockDiceDeps {
  /** The open map views, the one the GM works in first. */
  views(): DiceView[];
  /** Calls `listener` when views open or close. */
  onViewsChanged(listener: () => void): Disposer;
  /** Registers a disposer to run when the extension unloads; returns a function that runs and forgets it. */
  add(dispose: Disposer): Disposer;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isString = (value: unknown): value is string => typeof value === 'string';

/** Calls a method of an object by name when it has one. */
function call(target: unknown, method: string): unknown {
  if (!isObject(target)) return undefined;
  const fn = target[method];
  return typeof fn === 'function' ? (fn as () => unknown).call(target) : undefined;
}

/** The dice tool and the event bus of a view, or null when this Atlas keeps them elsewhere. */
function diceOf(view: DiceView): { tool: DiceTool; bus: DiceBus } | null {
  const tool = call(call(view.serviceManager, 'getToolController'), 'getDiceTool');
  const bus = call(view.serviceManager, 'getEventBus');
  if (!isObject(tool) || typeof tool.rollDice !== 'function') return null;
  if (!isObject(bus) || typeof bus.on !== 'function' || typeof bus.off !== 'function' || typeof bus.emit !== 'function') return null;
  return { tool: tool as unknown as DiceTool, bus: bus as unknown as DiceBus };
}

function deepFreeze<T>(value: T): T {
  if (isObject(value) && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A copy of plain data, or null for anything that is not (functions, cycles, class instances). */
function plainCopy(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}

/** The roll with each die's well-formed tag also under stock Atlas's names (`colour`, `name`); the API's names stay for Connect's log. */
function withStockTags(roll: DiceRollResult): DiceRollResult {
  const rolls = roll.rolls.map((die) => {
    const { color, colorName } = dieTagOf(die);
    return { ...die, ...(color !== undefined ? { colour: color } : {}), ...(colorName !== undefined ? { name: colorName } : {}) };
  });
  return { ...roll, rolls };
}

function isRoll(value: unknown): value is DiceRollResult {
  if (!isObject(value)) return false;
  const { id, timestamp, formula, rolls, modifiers, total } = value;
  if (!isString(id) || id === '' || typeof timestamp !== 'number' || !isString(formula) || !Array.isArray(rolls) || typeof modifiers !== 'number' || typeof total !== 'number') return false;
  return rolls.length <= MAX_DICE && rolls.every((die) => isObject(die) && typeof die.value === 'number' && typeof die.max === 'number');
}

/** A roll's source naming the player who rolled it and the ability of their sheet it was rolled from. */
function sourceOf(request: PlayerRollRequest): DiceRollResult['source'] | undefined {
  if (!request.rolledBy) return undefined;
  return { type: 'toolbar', tokenName: request.rolledBy, ...(request.abilityName ? { abilityName: request.abilityName } : {}) };
}

export function stockDiceApi(deps: StockDiceDeps): DiceApi {
  /** Who the roll being made now is for: the roll Atlas announces meanwhile carries their name. */
  let rolling: string | null = null;
  const listeners = new Set<(result: DiceRollResult) => void>();
  const subscribed = new Map<string, { bus: DiceBus; hear: (result: DiceRollResult) => void }>();
  const remembered: string[] = [];
  let stopWatching: Disposer | null = null;

  const hear = (result: DiceRollResult): void => {
    if (!isRoll(result) || remembered.includes(result.id)) return;
    remembered.push(result.id);
    if (remembered.length > REMEMBERED) remembered.shift();
    const stamped = rolling !== null && !result.rolledBy ? { ...result, rolledBy: rolling } : result;
    const copy = deepFreeze(structuredClone(stamped));
    for (const listener of [...listeners]) {
      try {
        listener(copy);
      } catch (error) {
        console.error('[Atlas VTT Connect] A dice listener failed:', error);
      }
    }
  };

  /** Follows the bus of every open map view: views that came are heard, views that went are let go. */
  const sync = (): void => {
    const open = deps.views();
    for (const view of open) {
      if (subscribed.has(view.viewId)) continue;
      const found = diceOf(view);
      if (!found) continue;
      found.bus.on('dice-rolled', hear);
      subscribed.set(view.viewId, { bus: found.bus, hear });
    }
    for (const [id, entry] of [...subscribed]) {
      if (open.some((view) => view.viewId === id)) continue;
      entry.bus.off('dice-rolled', entry.hear);
      subscribed.delete(id);
    }
  };

  const follow = (): void => {
    if (stopWatching) return;
    sync();
    const stopViews = deps.onViewsChanged(sync);
    const remove = deps.add(() => {
      stopViews();
      for (const entry of subscribed.values()) entry.bus.off('dice-rolled', entry.hear);
      subscribed.clear();
      listeners.clear();
      stopWatching = null;
    });
    stopWatching = remove;
  };

  /** The view a roll for `mapPath` is rolled in: the one showing that map, else the one the GM works in. */
  const viewFor = (mapPath: string | null | undefined): DiceView | null => {
    const open = deps.views().filter((view) => diceOf(view) !== null);
    return (mapPath ? open.find((view) => view.mapPath() === mapPath) : undefined) ?? open[0] ?? null;
  };

  const api: DiceApi = Object.freeze({
    roll: (request: PlayerRollRequest): DiceRollResult => {
      const given = request as Partial<PlayerRollRequest> | null;
      const valid = isObject(given) && isString(given.formula)
        && (given.mapPath === undefined || given.mapPath === null || isString(given.mapPath))
        && (given.rolledBy === undefined || (isString(given.rolledBy) && given.rolledBy.length <= MAX_ROLLED_BY))
        && (given.abilityName === undefined || (isString(given.abilityName) && given.abilityName.length <= MAX_ABILITY))
        && (given.advantage === undefined || (ADVANTAGE_SIDES as readonly unknown[]).includes(given.advantage));
      if (!valid) throw new Error(`[Atlas VTT Connect] dice.roll: the request must be { formula: string, mapPath?: string | null, rolledBy?: string of at most ${MAX_ROLLED_BY} characters, abilityName?: string, advantage?: 'advantage' | 'disadvantage' }.`);
      const view = viewFor(request.mapPath);
      const found = view ? diceOf(view) : null;
      if (!view || !found) throw new Error('[Atlas VTT Connect] dice.roll: no open map can roll dice.');
      follow();
      rolling = request.rolledBy ?? null;
      let rolled: DiceRollResult | null;
      try {
        // Named after the player in Atlas's log and toasts through the roll's source, as a token's roll is named.
        const source = sourceOf(request);
        rolled = request.advantage
          ? found.tool.rollDice(request.formula, source, undefined, { advantage: request.advantage })
          : found.tool.rollDice(request.formula, source);
      } finally {
        rolling = null;
      }
      if (!rolled) throw new Error(`[Atlas VTT Connect] dice.roll: Atlas does not roll "${request.formula}".`);
      return deepFreeze(structuredClone(request.rolledBy ? { ...rolled, rolledBy: request.rolledBy } : rolled));
    },

    onRolled: (listener: (result: DiceRollResult) => void): Disposer => {
      if (typeof listener !== 'function') return () => undefined;
      follow();
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    publish: (result: DiceRollResult, options?: DicePublishOptions): void => {
      if (options !== undefined) {
        const flag: unknown = isObject(options) ? options.throw : null;
        if (!isObject(options) || (flag !== undefined && typeof flag !== 'boolean')) throw new Error('[Atlas VTT Connect] dice.publish: the options must be { throw?: boolean }.');
      }
      const copy = plainCopy(result);
      if (copy === null) throw new Error('[Atlas VTT Connect] dice.publish: the roll must be plain data.');
      if (!isRoll(copy)) throw new Error('[Atlas VTT Connect] dice.publish: the roll must be { id, timestamp, formula, rolls, modifiers, total }.');
      const tagged = withStockTags(copy);
      follow();
      // Every open map view announces it, so each one's log, toasts and 3D dice show it; listeners hear it once (by its id).
      for (const view of deps.views()) {
        const found = diceOf(view);
        if (!found) continue;
        try {
          found.bus.emit('dice-rolled', structuredClone(tagged));
        } catch (error) {
          console.error('[Atlas VTT Connect] A map view could not show a roll:', error);
        }
      }
    },
  });
  SHEET_AWARE_DICE.add(api);
  return api;
}
