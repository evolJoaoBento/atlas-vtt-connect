/**
 * The board extras of a scene (`boardTypes.ts`): what a player on Tabletop's 3D board gets besides the scene. Only what
 * players may see goes, by the rules of the scene's own projection (`visible`: the GM's fog and the lighting's
 * darkness), as the GM's player window shows it: a wall or door by its middle, a prop by where it stands. A closed
 * secret door is plain wall. A light placed on the map goes unless hidden (its glow can reach ground players see); one a
 * token carries goes only with that token. Vault paths never leave: materials, door props and props go as asset ids,
 * and one whose file is not hashed yet is left out until it is (the registry asks for another projection).
 */
import type { Shows } from './FogCoverage';
import type { BoardExtras, BoardLightRecord, BoardMaterialRecord, BoardPropRecord, BoardWallRecord } from './boardTypes';
import type { AssetIds, BoardLook } from './sceneContracts';

type Raw = Record<string, unknown>;

export interface BoardInput {
  objects?: { walls?: unknown; lights?: unknown; tokens?: unknown } | null;
  lighting?: unknown;
}

const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const items = (value: unknown): Raw[] => (isObj(value) ? Object.values(value).filter(isObj) : Array.isArray(value) ? value.filter(isObj) : []);
const point = (raw: unknown): { x: number; y: number } | null =>
  (isObj(raw) && typeof raw.x === 'number' && typeof raw.y === 'number' && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null);
const at = (x: number, y: number) => ({ x, y, width: 0, height: 0 });

/** `visible` null: the lighting cannot be read (a closed frame), and players get nothing of the board. */
export function projectBoard(state: BoardInput, sceneId: string, visible: Shows | null, sentTokens: Readonly<Record<string, unknown>>, look: BoardLook | null, assets: Pick<AssetIds, 'idFor'>): BoardExtras {
  const lighting = isObj(state.lighting) ? state.lighting : {};
  const extras: BoardExtras = {
    sceneId,
    walls: [],
    lights: [],
    props: [],
    materials: [],
    ambient: look?.ambient ?? null,
    lighting: { enabled: lighting.enabled === true, ambient: Math.min(1, Math.max(0, num(lighting.ambient, 0.1))), ambientColor: str(lighting.ambientColor) },
    fogHeight: look?.fogHeight ?? null,
  };
  if (!visible) return extras;
  const objects = state.objects ?? {};
  // A material goes by its colour map's asset id: its own id is a vault folder.
  const materialIds = new Map<string, BoardMaterialRecord | null>();
  const material = (id: string | null): string | null => {
    if (!id || !look) return null;
    if (!materialIds.has(id)) materialIds.set(id, materialOf(look.materials.find((entry) => entry.id === id), assets));
    return materialIds.get(id)?.id ?? null;
  };
  for (const raw of items(objects.walls)) {
    const wall = projectWall(raw, visible, look, assets, material);
    if (wall) extras.walls.push(wall);
  }
  extras.materials = [...new Map([...materialIds.values()].filter((entry): entry is BoardMaterialRecord => entry !== null).map((entry) => [entry.id, entry])).values()];
  for (const raw of items(objects.lights)) {
    if (raw.hidden === true) continue;
    const light = projectLight(raw, raw.emission, point(raw), look);
    if (light) extras.lights.push(light);
  }
  for (const raw of items(objects.tokens)) {
    const id = str(raw.id);
    if (!id || !Object.hasOwn(sentTokens, id) || raw.offMap === true) continue;
    const light = projectLight(raw, raw.light, point(raw), look);
    if (light) extras.lights.push(light);
  }
  for (const prop of look?.props ?? []) {
    if (!visible.shows(at(prop.x, prop.y))) continue;
    const asset = assets.idFor(prop.path);
    if (asset) extras.props.push({ id: prop.id, asset, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.turn } satisfies BoardPropRecord);
  }
  return extras;
}

function materialOf(entry: BoardLook['materials'][number] | undefined, assets: Pick<AssetIds, 'idFor'>): BoardMaterialRecord | null {
  if (!entry) return null;
  const maps: Record<string, string> = {};
  for (const [role, path] of Object.entries(entry.maps)) {
    const id = assets.idFor(path);
    if (id) maps[role] = id;
  }
  const color = maps.color;
  return color ? { id: color, scale: entry.scale, maps } : null;
}

function projectWall(raw: Raw, visible: Shows, look: BoardLook | null, assets: Pick<AssetIds, 'idFor'>, material: (id: string | null) => string | null): BoardWallRecord | null {
  const id = str(raw.id);
  const p1 = point(raw.p1);
  const p2 = point(raw.p2);
  if (!id || !p1 || !p2 || (p1.x === p2.x && p1.y === p2.y)) return null;
  if (!visible.shows(at((p1.x + p2.x) / 2, (p1.y + p2.y) / 2))) return null;
  const open = raw.closed === false;
  // A secret door shows as a door only while it is open; closed, it is wall like any other.
  const door = raw.type === 'door' || (raw.type === 'secret-door' && open);
  const wall: BoardWallRecord = { id, type: door ? 'door' : 'solid', p1, p2, height: look?.wallHeight(id) ?? null, material: material(look?.wallMaterial(id) ?? null) };
  if (door) {
    const chain = str(raw.chainId);
    const prop = look?.doorProp(id) ?? null;
    wall.door = { open, swing: raw.direction === 'right' ? 'right' : 'left', prop: prop ? assets.idFor(prop) : null, ...(chain ? { chainId: chain } : {}) };
  }
  if (raw.direction === 'left' || raw.direction === 'right') wall.direction = raw.direction;
  if (raw.blocks === 'sight' || raw.blocks === 'light') wall.blocks = raw.blocks;
  if (raw.limited === true) wall.limited = true;
  return wall;
}

function projectLight(raw: Raw, emission: unknown, where: { x: number; y: number } | null, look: BoardLook | null): BoardLightRecord | null {
  const id = str(raw.id);
  if (!id || !where || !isObj(emission)) return null;
  const dim = Math.max(0, num(emission.dim, 0));
  const angle = num(emission.angle, 360);
  const gate = typeof raw.activeBelowAmbient === 'number' && Number.isFinite(raw.activeBelowAmbient) && raw.activeBelowAmbient < 1 ? raw.activeBelowAmbient : null;
  return {
    id, x: where.x, y: where.y,
    height: look?.lightHeight(id) ?? null,
    color: str(emission.color) ?? '#ffffff',
    bright: Math.min(dim, Math.max(0, num(emission.bright, 0))),
    dim,
    intensity: Math.max(0, num(emission.intensity, 1)),
    animation: str(emission.animation),
    angle: angle > 0 && angle < 360 ? angle : null,
    rotation: num(raw.rotation, 0),
    darkness: emission.darkness === true,
    activeBelowAmbient: gate,
  };
}
