/**
 * The board extras of a scene (`boardTypes.ts`): what a player on Tabletop's 3D board gets besides the scene. Only what
 * players may see goes, by the rules of the scene's own projection (`visible`: the GM's fog and the lighting's
 * darkness), as the GM's player window shows it: a wall or door by its middle, a prop or a light by where it stands. A
 * closed secret door is plain wall. A light a token carries goes only with that token. Vault paths never leave: materials, door props and props go as asset ids,
 * and one whose file is not hashed yet is left out until it is (the registry asks for another projection). The raised
 * shapes of the level shown go where players see any of them; the ground round the map always (it shows nothing of it).
 */
import type { Shows } from './FogCoverage';
import { BOARD_LAYER_LIMITS, BOARD_LIGHT_AREA_CORNERS, BOARD_SHAPE_LIMITS, BOARD_WATER_LIMITS, BOARD_PAINTED_LIMITS, type BoardPainted, type BoardPaintedPattern, type BoardExtras, type BoardGround, type BoardShapeRecord, type BoardWater, type BoardLayerRecord, type BoardLightRecord, type BoardMaterialRecord, type BoardPropRecord, type BoardWallRecord } from './boardTypes';
import type { AssetIds, BoardGroundLook, BoardLayerLook, BoardLook, BoardShapeLook } from './sceneContracts';
import { isArTable, type ArTable } from '../tools/arTable';
import { isSceneId } from './sceneValidation';

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
    lighting: { enabled: lighting.enabled === true, ambient: Math.min(1, Math.max(0, num(lighting.ambient, 0.1))), ambientColor: str(lighting.ambientColor) },
    fogHeight: look?.fogHeight ?? null,
    wallThickness: look?.wallThickness ?? null,
    ...(look?.layerLook === 'solid' || look?.layerLook === 'faded' || look?.layerLook === 'transparent' ? { layerLook: look.layerLook } : {}),
    // Only where the players' table is: nothing of the map.
    ...(isArTable(look?.arTable) ? { arTable: copyTable(look.arTable) } : {}),
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
    if (!record) continue;
    let kept: BoardLayerRecord = record;
    let weight = JSON.stringify(kept).length + 1;
    // Its shapes give way first: the level's floor and walls matter more than its roofs.
    if (kept.shapes && layerBytes + weight > BOARD_LAYER_LIMITS.bytes) {
      const { shapes: _shapes, ...bare } = kept;
      kept = bare;
      weight = JSON.stringify(kept).length + 1;
    }
    if (layerBytes + weight > BOARD_LAYER_LIMITS.bytes) continue;
    layerBytes += weight;
    layers.push(kept);
  }
  if (layers.length > 0) extras.layers = layers;
  const water = waterOf(look?.water, BOARD_WATER_LIMITS.scene);
  if (water) extras.water = water;
  // The raised shapes of the level shown: one goes where players see any corner of it, or its middle.
  const seen = (look?.shapes ?? []).filter((shape) => shapeSeen(shape, visible));
  const shapes = shapesOf(seen, material, BOARD_SHAPE_LIMITS.bytes);
  if (shapes.length > 0) extras.shapes = shapes;
  const ground = groundOf(look?.ground, material, assets);
  if (ground) extras.ground = ground;
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

/** Whether players see any of a shape: a corner of its outline, or the middle of its corners. */
function shapeSeen(shape: BoardShapeLook, visible: Shows): boolean {
  if (shape.outline.some((corner) => visible.shows(at(corner.x, corner.y)))) return true;
  const n = shape.outline.length;
  if (n === 0) return false;
  const middle = shape.outline.reduce((sum, corner) => ({ x: sum.x + corner.x / n, y: sum.y + corner.y / n }), { x: 0, y: 0 });
  return visible.shows(at(middle.x, middle.y));
}

/** Corners as the wire carries them (x, y, h to the hundredth); null for any that is not a place. */
function cornersOf(corners: BoardShapeLook['outline']): number[] | null {
  const out: number[] = [];
  for (const corner of corners) {
    if (![corner.x, corner.y, corner.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    // Rounded first, then held to what the players' check takes (a height a hair under the limit may round onto it).
    const [x, y, h] = [corner.x, corner.y, corner.h].map((n) => Math.round(n * 100) / 100) as [number, number, number];
    if (Math.abs(x) >= 1e7 || Math.abs(y) >= 1e7 || Math.abs(h) >= BOARD_SHAPE_LIMITS.height) return null;
    out.push(x, y, h);
  }
  return out;
}

/**
 * Shapes as the wire carries them, in order while they fit in `longest` as text: materials by their asset id (one not
 * hashed yet is left off: the top wears the map image, the sides stay plain until it is).
 */
function shapesOf(shapes: ReadonlyArray<BoardShapeLook>, material: (id: string | null) => string | null, longest: number): BoardShapeRecord[] {
  const out: BoardShapeRecord[] = [];
  let length = 2;
  for (const shape of shapes) {
    if (out.length >= BOARD_SHAPE_LIMITS.shapes) break;
    // An id the players' check refuses would cost them the whole part it rides in.
    if (!isSceneId(shape.id) || shape.outline.length < 3 || shape.outline.length + shape.inner.length > BOARD_SHAPE_LIMITS.corners) continue;
    const outline = cornersOf(shape.outline);
    const inner = cornersOf(shape.inner);
    if (!outline || !inner) continue;
    const top = shape.material ? material(shape.material) : null;
    const sides = shape.sides === true ? true : typeof shape.sides === 'string' ? (material(shape.sides) ?? true) : null;
    const record: BoardShapeRecord = { id: shape.id, outline, ...(inner.length > 0 ? { inner } : {}), ...(top ? { material: top } : {}), ...(sides !== null ? { sides } : {}) };
    const size = JSON.stringify(record).length + 1;
    if (length + size > longest) continue;
    length += size;
    out.push(record);
  }
  return out;
}

const NOISES = new Set(['flat', 'gentle', 'rolling', 'rough', 'dunes']);
const within = (value: unknown, low: number, high: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback);

/** The ground as the wire carries it, its values held to their ranges and its material by asset id; none for the plain map board. */
function groundOf(ground: BoardGroundLook | undefined, material: (id: string | null) => string | null, assets: Pick<AssetIds, 'idFor'>): BoardGround | null {
  if (!ground || !GROUND_MODES.has(ground.mode)) return null;
  const margin = Math.round(within(ground.margin, 0, 100, 0));
  // The map on its table with no extra board is what a board without ground does: nothing to send.
  if (ground.mode === 'board' && margin === 0) return null;
  const tiled = ground.material ? material(ground.material) : null;
  // A painted background whose pictures are not hashed yet shows as the plain horizon until they are.
  const painted = ground.mode === 'painted' ? paintedOf(ground.painted, material, assets) : null;
  return {
    mode: ground.mode === 'painted' && !painted ? 'horizon' : ground.mode,
    ...(painted ? { painted } : {}),
    ...(tiled ? { material: tiled } : {}),
    noise: NOISES.has(ground.noise) ? ground.noise : 'rolling',
    strength: within(ground.strength, 0, 1, 0.5),
    fog: Math.round(within(ground.fog, 0, 100, 40)),
    margin,
    tile: Math.round(within(ground.tile, 1, 8, 2)),
    water: motionOf(ground.water, WATER_MOTION),
    ...(ground.lava ? { lava: motionOf(ground.lava, LAVA_MOTION) } : {}),
    ...(ground.acid ? { acid: motionOf(ground.acid, ACID_MOTION) } : {}),
  };
}

/**
 * A painted background for the wire: its three pictures by asset id (none if any is not hashed yet), its material
 * folders by id ('' keeps the place of a slot with none), its settings copied field by field and held to their ranges.
 */
function paintedOf(painted: BoardGroundLook['painted'], material: (id: string | null) => string | null, assets: Pick<AssetIds, 'idFor'>): BoardPainted | null {
  if (!painted) return null;
  const terrain = assets.idFor(painted.terrain);
  const layer = assets.idFor(painted.material);
  const height = assets.idFor(painted.height);
  if (!terrain || !layer || !height) return null;
  const settings: Raw = isObj(painted.settings) ? painted.settings : {};
  const range: Raw = isObj(settings.height) ? settings.height : {};
  const a = within(range.low, -100, 100, -2);
  const b = within(range.high, -100, 100, 6);
  const liquids: Raw = isObj(settings.liquids) ? settings.liquids : {};
  const slots = Array.isArray(painted.materials) ? painted.materials.slice(0, BOARD_PAINTED_LIMITS.materials) : [];
  return {
    terrain, material: layer, height,
    materials: slots.map((folder) => (typeof folder === 'string' && folder !== '' ? material(folder) ?? '' : '')),
    settings: {
      patterns: (Array.isArray(settings.patterns) ? settings.patterns : []).slice(0, BOARD_PAINTED_LIMITS.patterns).map(patternOf),
      height: { low: Math.min(a, b), high: Math.max(a, b) },
      liquids: {
        water: motionOf(liquids.water as Partial<Motion>, WATER_MOTION),
        lava: motionOf(liquids.lava as Partial<Motion>, LAVA_MOTION),
        acid: motionOf(liquids.acid as Partial<Motion>, ACID_MOTION),
      },
    },
  };
}

const PATTERN_SHAPES = new Set<string>(['smooth', 'ridged', 'terraced', 'craters']);

/** A custom pattern copied field by field, each held to its range (a name to 60 letters, an unknown shape smooth). */
function patternOf(raw: unknown): BoardPaintedPattern {
  const value: Raw = isObj(raw) ? raw : {};
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 60) : '';
  return {
    name: name || 'Background',
    scale: within(value.scale, 4, 200, 40),
    height: within(value.height, 0, 40, 6),
    roughness: Math.round(within(value.roughness, 1, 6, 3)),
    shape: (PATTERN_SHAPES.has(value.shape as string) ? value.shape : 'smooth') as BoardPaintedPattern['shape'],
  };
}

const GROUND_MODES = new Set<string>(['board', 'horizon', 'water', 'lava', 'acid', 'painted']);
type Motion = NonNullable<BoardGround['lava']>;
/** How each liquid starts, Tabletop's own: what a broken field of its motion falls back to. */
const WATER_MOTION: Motion = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };
const LAVA_MOTION: Motion = { kind: 'flow', amount: 0.35, direction: 90, tint: '#ff5a1f', clarity: 0, style: 'crust' };
/** The kinds of lava Tabletop draws. */
const LAVA_STYLES = new Set(['crust', 'ropey', 'rubble', 'lake', 'magma']);
const ACID_MOTION: Motion = { kind: 'ripples', amount: 0.45, direction: 90, tint: '#8bd630', clarity: 0.35 };

/** A liquid's motion copied field by field, each held to its range (`fallback`'s where it is broken). */
function motionOf(motion: Partial<Motion> | null | undefined, fallback: Motion): Motion {
  const tint = typeof motion?.tint === 'string' && /^#[0-9a-f]{6}$/i.test(motion.tint) ? motion.tint.toLowerCase() : fallback.tint;
  return {
    kind: typeof motion?.kind === 'string' ? motion.kind.slice(0, 20) : fallback.kind,
    amount: within(motion?.amount, 0, 1, fallback.amount), direction: within(motion?.direction, 0, 360, fallback.direction), tint,
    clarity: within(motion?.clarity, 0, 1, fallback.clarity),
    // The kind of lava, where the motion is lava's.
    ...(fallback.style ? { style: typeof motion?.style === 'string' && LAVA_STYLES.has(motion.style) ? motion.style : fallback.style } : {}),
  };
}

/** A surface light's outline for the wire: at most `BOARD_LIGHT_AREA_CORNERS` of its corners, evenly taken, to the hundredth; null for none. */
function lightArea(area: unknown): number[] | null {
  if (!Array.isArray(area) || area.length < 3) return null;
  const corners = area.filter((p): p is { x: number; y: number } => isObj(p) && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e7 && Math.abs(p.y) < 1e7);
  if (corners.length < 3) return null;
  const step = corners.length / Math.min(corners.length, BOARD_LIGHT_AREA_CORNERS);
  const out: number[] = [];
  for (let k = 0; k < corners.length && out.length < BOARD_LIGHT_AREA_CORNERS * 2; k += step) {
    const p = corners[Math.floor(k)]!;
    out.push(Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100);
  }
  return out.length >= 6 ? out : null;
}

/** The AR table, copied field by field (nothing else the look carries goes). */
function copyTable(table: ArTable): ArTable {
  return { squareMm: table.squareMm, groups: table.groups.map(({ group, x, y, heading, w, h }) => ({ group, x, y, heading, w, h })) };
}

/** A ring of an outline as the wire carries it (to the hundredth); null for what is no ring Atlas would keep. */
function waterRing(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 6 || value.length % 2 !== 0 || value.length > BOARD_WATER_LIMITS.corners * 2) return null;
  const ring: number[] = [];
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) >= 1e7) return null;
    ring.push(Math.round(n * 100) / 100);
  }
  return ring;
}

/** An old water mask as the wire carries it; null when it is broken or longer than `longest`. */
function waterMask(mask: BoardWater['mask'], longest: number): NonNullable<BoardWater['mask']> | null {
  if (!mask || typeof mask.data !== 'string' || mask.data.length > longest) return null;
  const { width, height, data } = mask;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > BOARD_WATER_LIMITS.side || height > BOARD_WATER_LIMITS.side) return null;
  return { width, height, data };
}

/**
 * Water as the wire carries it: its outlines (those that are rings, in order, while they fit in `longest` as text) and
 * the old mask of a map not moved yet; none when neither is left.
 */
function waterOf(water: BoardWater | undefined, longest: number): BoardWater | null {
  if (!water) return null;
  const areas: NonNullable<BoardWater['areas']> = [];
  let length = 2;
  for (const area of Array.isArray(water.areas) ? water.areas : []) {
    if (areas.length >= BOARD_WATER_LIMITS.areas) break;
    const polygon = typeof area === 'object' && area !== null ? waterRing(area.polygon) : null;
    if (!polygon) continue;
    const holes = (Array.isArray(area.holes) ? area.holes : []).map(waterRing).filter((ring): ring is number[] => ring !== null).slice(0, BOARD_WATER_LIMITS.holes);
    const liquid = area.liquid === 'lava' || area.liquid === 'acid' ? area.liquid : null;
    const kept = { polygon, ...(holes.length > 0 ? { holes } : {}), ...(liquid ? { liquid } : {}) };
    const size = JSON.stringify(kept).length + 1;
    if (length + size > longest) continue;
    length += size;
    areas.push(kept);
  }
  const mask = waterMask(water.mask, longest);
  if (areas.length === 0 && !mask) return null;
  const motion = water.motion;
  return {
    ...(areas.length > 0 ? { areas } : {}), ...(mask ? { mask } : {}), ...(motion ? { motion: { kind: motion.kind, amount: motion.amount, direction: motion.direction, tint: motion.tint, clarity: motion.clarity } } : {}),
    ...(water.lava ? { lava: motionOf(water.lava, LAVA_MOTION) } : {}), ...(water.acid ? { acid: motionOf(water.acid, ACID_MOTION) } : {}),
  };
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
    ...withArea(lightArea(light.area)),
  }));
  const props: BoardPropRecord[] = [];
  for (const prop of layer.props.slice(0, BOARD_LAYER_LIMITS.props)) {
    const asset = assets.idFor(prop.path);
    if (asset) props.push({ id: prop.id, asset, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.turn, ...(prop.solid ? { solid: true as const } : {}), ...(prop.lift ? { lift: prop.lift } : {}) });
  }
  const water = waterOf(layer.water, BOARD_WATER_LIMITS.layer);
  // A layer's shapes go whole, as its walls do: it shows only its form.
  const shapes = shapesOf(layer.shapes ?? [], material, BOARD_SHAPE_LIMITS.layerBytes);
  return {
    id, elevation: layer.elevation, stands: { ...layer.stands }, image, grid: { ...layer.grid }, walls, lights, props,
    fogHeight: layer.fogHeight, wallThickness: layer.wallThickness,
    ...(water ? { water } : {}),
    ...(shapes.length > 0 ? { shapes } : {}),
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
    ...withArea(lightArea(raw.area)),
  };
}

/** A surface light's area field, where it has one (a light over an area has no beam). */
const withArea = (area: number[] | null): { area?: number[]; angle?: null } => (area ? { area, angle: null } : {});
