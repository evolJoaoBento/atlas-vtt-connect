/**
 * Atlas 0.10's levels (floors) as the stock shim reads them. A scene with several levels keeps every object in one
 * record with a level tag, and a view shows one level; players must be sent that level only, never the tokens, walls
 * and lights of the floors above and below. Atlas's own rule (`levels/sceneLevels.ts`): an object with no level, or one
 * the scene does not have, stands on the first level, and walls and lights may stand on several (`levels`, or `'all'`).
 *
 * The rules are Atlas's own code (`packages/atlas-shared`: `resolveLevel`, `onLevel`). What is here checks what a
 * store of unknown shape holds before handing it over, and cuts a scene's records to one level.
 */
import { onLevel as atlasOnLevel, resolveLevel, type SceneLevels } from '../../packages/atlas-shared/src/index';

export interface StockLevel {
  readonly id: string;
  readonly background?: string | null;
}

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether the scene has more than one level: only then does anything stand on one level and not another. */
export function hasLevels(levels: unknown): levels is readonly StockLevel[] {
  return Array.isArray(levels) && levels.length > 1 && levels.every((level) => isObj(level) && typeof level.id === 'string');
}

/** The level a view shows: its own when the scene has it, else the first; null for a scene without levels. */
export function shownLevel(levels: unknown, viewed: unknown): string | null {
  if (!hasLevels(levels)) return null;
  return resolveLevel(levels as unknown as SceneLevels, viewed);
}

function onLevel(entry: unknown, levelId: string, levels: readonly StockLevel[]): boolean {
  // An entry that is no object stands where unset objects do: on the first level.
  if (!isObj(entry)) return levelId === levels[0]?.id;
  return atlasOnLevel(entry, levelId, levels as unknown as SceneLevels);
}

/** `objects` with every record cut to the entries on the shown level; `objects` itself for a scene without levels. */
export function objectsOnLevel<T extends object>(objects: T, levels: unknown, viewed: unknown): T {
  const levelId = shownLevel(levels, viewed);
  if (levelId === null || !hasLevels(levels)) return objects;
  const shown: Raw = {};
  for (const [kind, record] of Object.entries(objects)) {
    shown[kind] = isObj(record)
      ? Object.fromEntries(Object.entries(record).filter(([, entry]) => onLevel(entry, levelId, levels)))
      : record;
  }
  return shown as T;
}

/** The map image of the shown level: the first level's is the scene's own `background`. */
export function backgroundOfLevel(background: string | null, levels: unknown, viewed: unknown): string | null {
  const levelId = shownLevel(levels, viewed);
  if (levelId === null || !hasLevels(levels) || levelId === levels[0]?.id) return background;
  return levels.find((level) => level.id === levelId)?.background ?? null;
}

/**
 * Whether the GM looks at another level than the one the player view shows (Atlas's `N4e`): the player view shows the
 * level its presented scene names, the first level where it names none (a level the scene lacks counts as none), and
 * not the one the GM browses. A scene without levels has nothing to hold.
 */
export function levelHeld(levels: unknown, viewed: unknown, presented: unknown): boolean {
  const shown = shownLevel(levels, viewed);
  return shown !== null && shown !== shownLevel(levels, presented);
}
