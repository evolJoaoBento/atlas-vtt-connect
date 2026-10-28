/**
 * Atlas 0.10's levels (floors) as the stock shim reads them. A scene with several levels keeps every object in one
 * record with a level tag, and a view shows one level; players must be sent that level only, never the tokens, walls
 * and lights of the floors above and below. Atlas's own rule (`levels/sceneLevels.ts`): an object with no level, or one
 * the scene does not have, stands on the first level, and walls and lights may stand on several (`levels`, or `'all'`).
 */
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
  return typeof viewed === 'string' && levels.some((level) => level.id === viewed) ? viewed : (levels[0]?.id ?? null);
}

function onLevel(entry: unknown, levelId: string, levels: readonly StockLevel[]): boolean {
  const first = levels[0]?.id;
  if (!isObj(entry)) return levelId === first;
  const known = (id: unknown): id is string => typeof id === 'string' && levels.some((level) => level.id === id);
  const { levels: set, level } = entry;
  if (set === 'all') return true;
  if (Array.isArray(set)) {
    const ids = set.filter(known);
    if (ids.length > 0) return ids.includes(levelId);
  } else if (known(level)) {
    return level === levelId;
  }
  return levelId === first;
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
