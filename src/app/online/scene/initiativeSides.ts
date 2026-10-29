/**
 * The sides of a fight by sides, as Atlas 0.10 holds them: any number of sides (the two built-in ones, `players` and
 * `opponents`, and named ones), the order they act in, and, where the collection rolls for the order every round, each
 * side's roll, sides with equal rolls acting together. Ported from Atlas's own functions (`pAn`, `T1t`, `Ly`, `C1t`,
 * `gG`, `uk`, `Y2e`), and checked against copies of them in `initiativeSides.test.ts`. Pure.
 *
 * Atlas's data is read as untrusted: a side id may be any text up to 64 characters, `__proto__` included, so sides are
 * held in arrays and rolls in maps, never in records keyed by id.
 */
import { PLAYER_SIDES, type PlayerInitiative, type PlayerInitiativeEntry, type PlayerSide, type PlayerToken } from './sceneTypes';

/** Atlas's limits: at most eight sides, an id up to 64 characters, a name up to 40. */
export const SIDE_LIMITS = { sides: 8, idLength: 64, nameLength: 40 } as const;

/** A side as a collection's rules or a fight's order name it: a named side has a name; a built-in one is named by Atlas. */
export interface RuleSide {
  id: string;
  name?: string;
}

/** One side of the list players see, in the order the sides act. */
export interface SideRow {
  id: string;
  name: string;
  /** This round's roll; null where the collection rolls for no order, or the side has none. */
  roll: number | null;
  /** The side acts now. */
  turn: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const isBuiltInSide = (id: unknown): id is PlayerSide => (PLAYER_SIDES as readonly unknown[]).includes(id);

const otherSide = (side: PlayerSide): PlayerSide => (side === 'players' ? 'opponents' : 'players');

/** `Gbe`: the two built-in sides, `first` first. */
export const defaultSides = (first: PlayerSide): RuleSide[] => [{ id: first }, { id: otherSide(first) }];

/** What the player window calls a side (`gG`). */
export function sideName(side: RuleSide): string {
  if (side.id === 'players') return 'Players';
  if (side.id === 'opponents') return 'Opponents';
  return side.name ?? side.id;
}

/**
 * The sides a collection's rules name (`pAn`): well-formed unique ids, a named side only with a name (cut to 40
 * characters), both built-in sides always present, at most eight in all. Undefined for anything but a list.
 */
export function readRuleSides(value: unknown): RuleSide[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sides: RuleSide[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { id, name } = item;
    if (typeof id !== 'string' || id.trim() === '' || id.length > SIDE_LIMITS.idLength || sides.some((side) => side.id === id)) continue;
    if (isBuiltInSide(id)) {
      sides.push({ id });
      continue;
    }
    const label = typeof name === 'string' ? name.trim().slice(0, SIDE_LIMITS.nameLength) : '';
    if (label !== '') sides.push({ id, name: label });
  }
  for (const id of PLAYER_SIDES) if (!sides.some((side) => side.id === id)) sides.push({ id });
  const named = sides.filter((side) => !isBuiltInSide(side.id)).slice(0, SIDE_LIMITS.sides - PLAYER_SIDES.length);
  return sides.filter((side) => isBuiltInSide(side.id) || named.includes(side));
}

/** The order a running fight lists its sides in (`order`), as far as it is well-formed; null where it names none. */
function readOrder(value: unknown): RuleSide[] | null {
  if (!Array.isArray(value)) return null;
  const order: RuleSide[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== 'string' || item.id === '' || item.id.length > SIDE_LIMITS.idLength || order.some((side) => side.id === item.id)) continue;
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, SIDE_LIMITS.nameLength) : '';
    order.push(name !== '' && !isBuiltInSide(item.id) ? { id: item.id, name } : { id: item.id });
  }
  return order.length > 0 ? order : null;
}

/** This round's rolls (`rolls[round]`), finite ones only; undefined where none are in. */
function readRolls(fight: Record<string, unknown>, round: number): Map<string, number> | undefined {
  if (!isRecord(fight.rolls)) return undefined;
  const key = String(round);
  const rolled = Object.hasOwn(fight.rolls, key) ? fight.rolls[key] : undefined;
  if (!isRecord(rolled)) return undefined;
  const rolls = new Map<string, number>();
  for (const [id, roll] of Object.entries(rolled)) if (typeof roll === 'number' && Number.isFinite(roll)) rolls.set(id, roll);
  return rolls;
}

/**
 * The sides in the order they act, grouped (`Ly`): without rolls each side is a group of its own; with them the highest
 * roll acts first, a side with no roll last, and sides with an equal roll act together.
 */
export function actingGroups(order: readonly string[], rolls: ReadonlyMap<string, number> | undefined): string[][] {
  if (!rolls) return order.map((id) => [id]);
  const rolled = (id: string): number => rolls.get(id) ?? -Infinity;
  const groups: string[][] = [];
  for (const id of [...order].sort((a, b) => rolled(b) - rolled(a))) {
    const last = groups[groups.length - 1];
    if (last && rolled(last[0]!) === rolled(id) && Number.isFinite(rolled(id))) last.push(id);
    else groups.push([id]);
  }
  return groups;
}

export interface SideRowsInput {
  /** Whether the fight runs: before it, the collection's rules say what is listed; in it, the fight does. */
  active: boolean;
  round: number;
  /** The fight's `sides` as Atlas stores them, when one runs by sides. */
  fight: unknown;
  /** The collection's sides, when it names any besides the two built-in ones. */
  rulesSides: readonly RuleSide[] | undefined;
  firstSide: PlayerSide;
}

/**
 * The list the player window shows (`Y2e`): the collection's sides before a fight; in one, the fight's sides in the order
 * they act this round, each with its roll, those whose turn it is marked. At most eight.
 */
export function sideRows({ active, round, fight, rulesSides, firstSide }: SideRowsInput): SideRow[] {
  if (!active || !isRecord(fight)) {
    return (rulesSides ?? defaultSides(firstSide)).slice(0, SIDE_LIMITS.sides).map((side) => ({ id: side.id, name: sideName(side), roll: null, turn: false }));
  }
  const first = isBuiltInSide(fight.first) ? fight.first : firstSide;
  const order = readOrder(fight.order) ?? defaultSides(first);
  const named = new Map(order.map((side) => [side.id, side]));
  const rolls = readRolls(fight, round);
  // The rolls order the sides only where the collection rolls for the order (`roll`); they are shown whenever they are in.
  const groups = actingGroups(order.map((side) => side.id), fight.roll ? rolls : undefined);
  const acting = typeof fight.active === 'string' ? fight.active : '';
  const now = groups.find((group) => group.includes(acting)) ?? [acting];
  return groups.flat().slice(0, SIDE_LIMITS.sides).map((id) => ({
    id,
    name: sideName(named.get(id) ?? { id }),
    roll: rolls?.get(id) ?? null,
    turn: now.includes(id),
  }));
}

/** The side a token fights on (`uk`): the one the GM gave it if the list has it, else the players' for a token that sees, else the opponents'. */
export function tokenSideId(token: unknown, ids: readonly string[]): string {
  if (!isRecord(token)) return 'opponents';
  if (typeof token.side === 'string' && ids.includes(token.side)) return token.side;
  return isRecord(token.vision) && token.vision.enabled === true ? 'players' : 'opponents';
}

/** The side a combatant is listed under on a player's scene: its named side, else its token's, else the opponents' (as the window files it). */
export function listedSide(tokens: Readonly<Record<string, Pick<PlayerToken, 'side'>>>, entry: Pick<PlayerInitiativeEntry, 'tokenId' | 'sideId'>): string {
  return entry.sideId ?? (Object.hasOwn(tokens, entry.tokenId) ? tokens[entry.tokenId]?.side : undefined) ?? 'opponents';
}

/** The named side (not `players` or `opponents`) each combatant of the list is filed under, by token. */
export function namedSidesOf(initiative: Pick<PlayerInitiative, 'entries'> | null): ReadonlyMap<string, string> {
  return new Map((initiative?.entries ?? []).flatMap((entry): Array<[string, string]> => (entry.sideId !== undefined ? [[entry.tokenId, entry.sideId]] : [])));
}

/** The sides whose turn it is: those of the side list marked, else the one an older GM names. */
export function sidesActing(initiative: Pick<PlayerInitiative, 'sides' | 'sideList'>): ReadonlySet<string> {
  if (initiative.sideList) return new Set(initiative.sideList.filter((row) => row.turn === true).map((row) => row.id));
  return new Set(initiative.sides?.active ? [initiative.sides.active] : []);
}

/**
 * The sides that act after those acting now, as players can tell it: the next group in this round's order (sides with an
 * equal roll act together). After the last, the next round: its order is rolled anew where the sides roll, so unknown
 * (null); else the first. Null too where no side acts. An older GM's list has two sides: the other one.
 */
export function sidesNext(initiative: Pick<PlayerInitiative, 'sides' | 'sideList'>): ReadonlySet<string> | null {
  const rows = initiative.sideList;
  if (!rows) {
    const active = initiative.sides?.active;
    return active ? new Set([otherSide(active)]) : null;
  }
  const last = rows.map((row) => row.turn === true).lastIndexOf(true);
  if (last === -1) return null;
  const from = last + 1 < rows.length ? last + 1 : rows.some((row) => row.roll !== undefined) ? -1 : 0;
  if (from === -1) return null;
  const head = rows[from]!;
  return new Set(rows.slice(from).filter((row) => row === head || (head.roll !== undefined && row.roll === head.roll)).map((row) => row.id));
}

/** What the old wire fields hold for a side: a named side counts as the opponents', as Atlas Online sends it. */
export const legacySide = (id: string): PlayerSide => (isBuiltInSide(id) ? id : 'opponents');

/** The built-in side an old page is told has the turn: the first built-in side acting now; none where only named sides act. */
export const legacyActive = (rows: readonly SideRow[]): PlayerSide | undefined => rows.find((row) => row.turn && isBuiltInSide(row.id))?.id as PlayerSide | undefined;
