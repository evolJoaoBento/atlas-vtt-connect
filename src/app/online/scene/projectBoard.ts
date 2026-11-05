/**
 * The board extras of a scene (`boardTypes.ts`): what a player on Tabletop's 3D board gets besides the scene. Only what
 * players may see goes, by the rules of the scene's own projection (`visible`: the GM's fog and the lighting's
 * darkness), as the GM's player window shows it: a wall or door by its middle, a prop or a light by where it stands. A
 * closed secret door is plain wall. A light a token carries goes only with that token. Vault paths never leave: materials, door props and props go as asset ids,
 * and one whose file is not hashed yet is left out until it is (the registry asks for another projection).
 */
import type { Shows } from './FogCoverage';
import { BOARD_LAYER_LIMITS, BOARD_WATER_LIMITS, type BoardExtras, type BoardWater, type BoardLayerRecord, type BoardLightRecord, type BoardMaterialRecord, type BoardPropRecord, type BoardWallRecord } from './boardTypes';
import type { AssetIds, BoardLayerLook, BoardLook } from './sceneContracts';

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
    ...(look?.tint ? { tint: look.tint } : {}),
    lighting: { enabled: lighting.enabled === true, ambient: Math.min(1, Math.max(0, num(lighting.ambient, 0.1))), ambientColor: str(lighting.ambientColor) },
    fogHeight: look?.fogHeight ?? null,
    wallThickness: look?.wallThickness ?? null,
    ...(look?.layerLook === 'solid' || look?.layerLook === 'faded' || look?.layerLook === 'transparent' ? { layerLook: look.layerLook } : {}),
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
  // The scenes stacked with this one: their form, never what is on them. A layer whose floor is not hashed yet waits for it.
  const layers: BoardLayerRecord[] = [];
  let layerBytes = 0;
  for (const [index, layer] of (look?.layers ?? []).slice(0, BOARD_LAYER_LIMITS.layers).entries()) {
    const record = projectLayer(layer, `layer-${index + 1}`, assets, (id) => {
      if (!id) return null;
      if (!materialIds.has(id)) materialIds.set(id, materialOf(layer.materials.find((entry) => entry.id === id), assets));
      return materialIds.get(id)?.id ?? null;
    });
    const weight = record ? JSON.stringify(record).length + 1 : 0;
    if (!record || layerBytes + weight > BOARD_LAYER_LIMITS.bytes) continue;
    layerBytes += weight;
    layers.push(record);
  }
  if (layers.length > 0) extras.layers = layers;
  const water = waterOf(look?.water, BOARD_WATER_LIMITS.scene);
  if (water) extras.water = water;
  extras.materials = [...new Map([...materialIds.values()].filter((entry): entry is BoardMaterialRecord => entry !== null).map((entry) => [entry.id, entry])).values()];
  for (const raw of items(objects.lights)) {
    // Only a light players could find: switched on, and standing where they see.
    const where = point(raw);
    if (raw.hidden === true || !where || !visible.shows(at(where.x, where.y))) continue;
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
    if (asset) extras.props.push({ id: prop.id, asset, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.turn, ...(prop.solid ? { solid: true as const } : {}), ...(prop.lift ? { lift: prop.lift } : {}) } satisfies BoardPropRecord);
  }
  return extras;
}

/** Painted water as the wire carries it; none when there is none, or when its mask is longer than `longest`. */
function waterOf(water: BoardWater | undefined, longest: number): BoardWater | null {
  if (!water?.mask || typeof water.mask.data !== 'string' || water.mask.data.length > longest) return null;
  const { width, height, data } = water.mask;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > BOARD_WATER_LIMITS.side || height > BOARD_WATER_LIMITS.side) return null;
  const motion = water.motion;
  return { mask: { width, height, data }, ...(motion ? { motion: { kind: motion.kind, amount: motion.amount, direction: motion.direction, tint: motion.tint, clarity: motion.clarity } } : {}) };
}

function projectLayer(layer: BoardLayerLook, id: string, assets: Pick<AssetIds, 'idFor'>, material: (id: string | null) => string | null): BoardLayerRecord | null {
  const image = assets.idFor(layer.image);
  if (!image) return null;
  const walls: BoardWallRecord[] = [];
  for (const wall of layer.walls.slice(0, BOARD_LAYER_LIMITS.walls)) {
    if ((wall.p1.x === wall.p2.x && wall.p1.y === wall.p2.y) || !wall.id) continue;
    const open = !wall.closed;
    // As on the presented scene: a closed secret door is plain wall.
    const door = wall.type === 'door' || (wall.type === 'secret-door' && open);
    const record: BoardWallRecord = { id: wall.id, type: door ? 'door' : 'solid', p1: { ...wall.p1 }, p2: { ...wall.p2 }, height: wall.height, material: material(wall.material) };
    if (door) {
      const prop = wall.doorProp ? assets.idFor(wall.doorProp) : null;
      record.door = { open, swing: wall.direction === 'right' ? 'right' : 'left', prop, ...(wall.chain ? { chainId: wall.chain } : {}), ...(wall.flip.hinge ? { hinge: true as const } : {}), ...(wall.flip.side ? { side: true as const } : {}) };
    }
    const secret = wall.type === 'secret-door' && !door;
    if (!secret && wall.direction) record.direction = wall.direction;
    if (wall.blocks) record.blocks = wall.blocks;
    if (typeof wall.width === 'number' && wall.width > 0) record.width = wall.width;
    if (wall.blocks === 'movement' && !door && !secret && wall.window) record.window = { bottom: wall.window.bottom, top: wall.window.top };
    if (!secret && wall.limited) record.limited = true;
    walls.push(record);
  }
  const lights: BoardLightRecord[] = layer.lights.slice(0, BOARD_LAYER_LIMITS.lights).map((light) => ({
    id: light.id, x: light.x, y: light.y, height: light.height, color: light.color, bright: Math.min(light.dim, Math.max(0, light.bright)), dim: Math.max(0, light.dim),
    intensity: Math.max(0, light.intensity), animation: light.animation, angle: light.angle !== null && light.angle > 0 && light.angle < 360 ? light.angle : null,
    rotation: light.rotation, darkness: light.darkness, activeBelowAmbient: light.activeBelowAmbient !== null && light.activeBelowAmbient < 1 ? light.activeBelowAmbient : null,
  }));
  const props: BoardPropRecord[] = [];
  for (const prop of layer.props.slice(0, BOARD_LAYER_LIMITS.props)) {
    const asset = assets.idFor(prop.path);
    if (asset) props.push({ id: prop.id, asset, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.turn, ...(prop.solid ? { solid: true as const } : {}), ...(prop.lift ? { lift: prop.lift } : {}) });
  }
  const water = waterOf(layer.water, BOARD_WATER_LIMITS.layer);
  return {
    id, elevation: layer.elevation, stands: { ...layer.stands }, image, grid: { ...layer.grid }, walls, lights, props,
    fogHeight: layer.fogHeight, wallThickness: layer.wallThickness,
    ...(water ? { water } : {}),
  };
}

function materialOf(entry: BoardLook['materials'][number] | undefined, assets: Pick<AssetIds, 'idFor'>): BoardMaterialRecord | null {
  if (!entry) return null;
  const maps: Record<string, string> = {};
  for (const [role, path] of Object.entries(entry.maps)) {
    const id = assets.idFor(path);
    if (id) maps[role] = id;
  }
  const color = maps.color;
  return color ? { id: color, scale: entry.scale, maps, ...(entry.tuning ? { tuning: { ...entry.tuning } } : {}) } : null;
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
    const flip = look?.doorFlip?.(id);
    wall.door = { open, swing: raw.direction === 'right' ? 'right' : 'left', prop: prop ? assets.idFor(prop) : null, ...(chain ? { chainId: chain } : {}), ...(flip?.hinge ? { hinge: true as const } : {}), ...(flip?.side ? { side: true as const } : {}) };
  }
  // A closed secret door keeps nothing that would set it apart from the wall around it.
  const secret = raw.type === 'secret-door' && !door;
  if (!secret && (raw.direction === 'left' || raw.direction === 'right')) wall.direction = raw.direction;
  if (raw.blocks === 'sight' || raw.blocks === 'light' || (raw.blocks === 'movement' && raw.type === 'solid')) wall.blocks = raw.blocks;
  // A window: its opening on Tabletop's board, where the GM set one.
  const span = wall.blocks === 'movement' ? look?.windowOf?.(id) ?? null : null;
  if (span) wall.window = { bottom: span.bottom, top: span.top };
  const width = look?.wallWidth?.(id) ?? null;
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) wall.width = width;
  if (!secret && raw.limited === true) wall.limited = true;
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
