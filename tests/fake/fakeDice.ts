import type { DiceApi, DiceLookInEffect, DiceRollRequest, DiceRollResult, Disposer, ViewId } from '@atlas-vtt/api-types';
import { rollByRules } from '@atlas-vtt/shared/rules';
import type { FakeRules } from './fakeRules';
import type { FakeViews, Own } from './fakeViews';

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

/** Atlas's `landsOnAFace`: `max` a whole number of 1 or more, `value` a whole number from 1 to `max`. */
function landsOnAFace(die: unknown): boolean {
  if (typeof die !== 'object' || die === null) return false;
  const { value, max } = die as Record<string, unknown>;
  return Number.isInteger(max) && (max as number) >= 1 && Number.isInteger(value) && (value as number) >= 1 && (value as number) <= (max as number);
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
 * `useLook` and `lookFor` (1.18.0, `dice-look-choice`) keep the choice per collection and the GM's default by full id
 * (`<extension id>:<look id>`), as Atlas does: a look is `loaded` once `registerLookId` made it so; `''` is Atlas's own dice.
 * `throw` (1.13.0) throws a given roll in a loaded view once per roll id (`thrownIn`), and answers false with the
 * user's dice shown as result cards, for a view not open or not loaded, or for a roll whose dice do not land on a face.
 */
export class FakeDice {
  private readonly listeners = new Set<(result: DiceRollResult) => void>();
  private random = seeded(1);
  /** The `mapPath` of each `roll` request, in order: what the rules were asked for. */
  readonly rolledFor: Array<string | null> = [];
  private readonly thrown = new Map<ViewId, DiceRollResult[]>();
  /** The look each collection chose, and the GM's default, as full ids; `''` is Atlas's own dice. */
  private readonly chosen = new Map<string, string>();
  private defaultLook = '';
  private readonly registered = new Set<string>();

  /**
   * `display`: the user's dice display setting (Atlas's `diceDisplay`). `lookChanged`: a collection's choice changed
   * (`collections-changed`) or the default's (`settings-changed` for `diceLook`).
   */
  constructor(
    private readonly rules: FakeRules, private readonly views?: FakeViews, private readonly display: () => string = () => 'full',
    private readonly lookChanged: (scope: 'collection' | 'default') => void = () => undefined,
  ) {}

  /** The look `id` (a full id) is registered by some extension now, so a choice of it is `loaded`. */
  registerLookId(id: string, registered = true): void {
    if (registered) this.registered.add(id);
    else this.registered.delete(id);
  }

  /** The collections' choices by id, and the default: what the asset index and the settings hold. */
  choices(): { collections: Readonly<Record<string, string>>; default: string } {
    return { collections: Object.fromEntries(this.chosen), default: this.defaultLook };
  }

  /** The rolls `throw` threw in the view, in order. */
  thrownIn(viewId: ViewId): readonly DiceRollResult[] {
    return this.thrown.get(viewId) ?? [];
  }

  /** The dice faces from now on, as `Math.random` would give them; the default is seeded. */
  setRandom(random: () => number): void {
    this.random = random;
  }

  /** How many `onRolled` listeners the dice log has. */
  listening(): number {
    return this.listeners.size;
  }

  /** `extensionId`: whose looks `useLook` chooses; `lookChoice`: this Atlas has `dice-look-choice` (1.18.0). */
  api(own: Own, extensionId = 'atlas-vtt-connect', lookChoice = false): DiceApi {
    return Object.freeze({
      ...(lookChoice ? this.lookApi(extensionId) : {}),
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
      throw: (viewId: ViewId, roll: DiceRollResult): boolean => {
        if (!isRoll(roll) || !roll.rolls.every(landsOnAFace)) return false;
        if (typeof viewId !== 'string' || !this.views?.isLoaded(viewId) || this.display() === 'card') return false;
        const thrown = this.thrown.get(viewId) ?? [];
        if (!thrown.some((each) => each.id === roll.id)) this.thrown.set(viewId, [...thrown, deepFreeze(structuredClone(roll))]);
        return true;
      },
    });
  }

  private lookApi(extensionId: string): Pick<DiceApi, 'useLook' | 'lookFor'> {
    return {
      useLook: (lookId: unknown, options?: unknown): Promise<void> => {
        const given = options as { collectionId?: unknown } | undefined;
        const optionsOk = options === undefined || (typeof options === 'object' && options !== null && (given?.collectionId === undefined || isText(given.collectionId)));
        if (!(lookId === null || isText(lookId)) || !optionsOk) return Promise.reject(new Error('[Atlas API] dice.useLook: a look id or null, and { collectionId? }.'));
        const full = lookId === null || lookId === '' ? lookId : `${extensionId}:${lookId}`;
        const collectionId = given?.collectionId;
        if (collectionId === undefined) {
          this.defaultLook = full ?? '';
          this.lookChanged('default');
          return Promise.resolve();
        }
        if (!this.rules.hasCollection(collectionId as string)) return Promise.reject(new Error(`[Atlas API] dice.useLook: there is no collection "${String(collectionId)}".`));
        if (full === null) this.chosen.delete(collectionId as string);
        else this.chosen.set(collectionId as string, full);
        this.lookChanged('collection');
        return Promise.resolve();
      },
      lookFor: (collectionId?: string | null): Promise<DiceLookInEffect> => {
        const own = collectionId == null ? undefined : this.chosen.get(collectionId);
        const lookId = own ?? this.defaultLook;
        return Promise.resolve(Object.freeze({ lookId, from: own === undefined ? 'default' : 'collection', loaded: lookId === '' || this.registered.has(lookId) }));
      },
    };
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
