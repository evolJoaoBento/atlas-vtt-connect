import type { DiceApi, DiceRollRequest, DiceRollResult, Disposer } from '@atlas-vtt/api-types';
import { rollByRules } from '@atlas-vtt/shared/rules';
import type { FakeRules } from './fakeRules';
import type { Own } from './fakeViews';

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
};

const isText = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function isRoll(value: unknown): value is DiceRollResult {
  if (typeof value !== 'object' || value === null) return false;
  const roll = value as Record<string, unknown>;
  return isText(roll.id) && isText(roll.formula) && isNumber(roll.timestamp) && isNumber(roll.total) && isNumber(roll.modifiers) && Array.isArray(roll.rolls);
}

/** A small seeded generator (mulberry32), so a roll is the same every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Atlas's dice log as the test drives it. `roll` rolls by the rules of the map's collection and logs the roll;
 * every extension's `onRolled` listeners hear a roll, `publish` included, before the call returns. Results are deep-frozen copies.
 */
export class FakeDice {
  private readonly listeners = new Set<(result: DiceRollResult) => void>();
  private random = seeded(1);
  /** The `mapPath` of each `roll` request, in order: what the rules were asked for. */
  readonly rolledFor: Array<string | null> = [];

  constructor(private readonly rules: FakeRules) {}

  /** The dice faces from now on, as `Math.random` would give them; the default is seeded. */
  setRandom(random: () => number): void {
    this.random = random;
  }

  /** How many `onRolled` listeners the dice log has. */
  listening(): number {
    return this.listeners.size;
  }

  api(own: Own): DiceApi {
    return Object.freeze({
      roll: (request: DiceRollRequest): DiceRollResult => {
        const given = request as Partial<DiceRollRequest> | null;
        const valid = typeof given === 'object' && given !== null && isText(given.formula)
          && (given.mapPath == null || isText(given.mapPath)) && (given.rolledBy === undefined || isText(given.rolledBy));
        if (!valid) throw new Error('[Atlas API] roll needs { formula: string, mapPath?: string | null, rolledBy?: string }.');
        const mapPath = request.mapPath ?? null;
        this.rolledFor.push(mapPath);
        const rolled = rollByRules(request.formula, this.rules.api().forMap(mapPath).dice, this.random, Date.now());
        const result = request.rolledBy ? { ...rolled, rolledBy: request.rolledBy } : rolled;
        this.emit(result);
        return deepFreeze(structuredClone(result));
      },
      onRolled: (listener: (result: DiceRollResult) => void): Disposer => {
        this.listeners.add(listener);
        return own(() => { this.listeners.delete(listener); });
      },
      publish: (result: DiceRollResult): void => {
        if (!isRoll(result)) throw new Error('[Atlas API] publish needs a roll: { id, timestamp, formula, rolls, modifiers, total }.');
        this.emit(structuredClone(result));
      },
    });
  }

  private emit(result: DiceRollResult): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(deepFreeze(structuredClone(result)));
      } catch (error) {
        console.error('[Atlas API] A dice listener failed:', error);
      }
    }
  }
}
