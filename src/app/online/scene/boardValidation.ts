/**
 * Checks for the board messages (`boardTypes.ts`). Shared with the web player page, so it imports only wire files.
 * Ids that assignment treats specially are refused, as for the scene.
 */
import { BOARD_LAYER_LIMITS, BOARD_LIGHT_AREA_CORNERS, BOARD_SHAPE_LIMITS, BOARD_WATER_LIMITS, BOARD_PAINTED_LIMITS, BOARD_PART_LIMITS, CUTSCENE_LIMITS, type BoardCamera, type BoardCutscene, type BoardExtras } from './boardTypes';
import { isSceneId } from './sceneValidation';
import { isArTable } from '../tools/arTable';

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length <= BOARD_PART_LIMITS.text;
const isNullable = (check: (value: unknown) => boolean) => (value: unknown): boolean => value === null || check(value);
const isPoint = (value: unknown): boolean => isFields(value) && isNumber(value.x) && isNumber(value.y);
const isPoint3 = (value: unknown): boolean => isPoint(value) && isNumber((value as Fields).z);
const isList = (value: unknown, max: number, item: (entry: unknown) => boolean): boolean =>
  Array.isArray(value) && value.length <= max && value.every(item);

function isDoor(value: unknown): boolean {
  return isFields(value) && typeof value.open === 'boolean' && (value.swing === 'left' || value.swing === 'right')
    && isNullable(isSceneId)(value.prop) && (value.chainId === undefined || isText(value.chainId))
    && (value.hinge === undefined || value.hinge === true) && (value.side === undefined || value.side === true);
}

function isWindowSpan(value: unknown): boolean {
  return isFields(value) && isNumber(value.bottom) && isNumber(value.top) && value.bottom >= 0 && value.top > value.bottom;
}

function isWall(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || (value.type !== 'solid' && value.type !== 'door')) return false;
  if (!isPoint(value.p1) || !isPoint(value.p2) || !isNullable(isNumber)(value.height) || !isNullable(isSceneId)(value.material)) return false;
  if (value.direction !== undefined && value.direction !== 'left' && value.direction !== 'right') return false;
  if (value.blocks !== undefined && value.blocks !== 'sight' && value.blocks !== 'light' && value.blocks !== 'movement') return false;
  if (value.window !== undefined && !isWindowSpan(value.window)) return false;
  if (value.width !== undefined && !(isNumber(value.width) && value.width > 0)) return false;
  if (value.limited !== undefined && typeof value.limited !== 'boolean') return false;
  return value.type === 'door' ? isDoor(value.door) : value.door === undefined;
}

function isLight(value: unknown): boolean {
  return isFields(value) && isSceneId(value.id) && isNumber(value.x) && isNumber(value.y) && isNullable(isNumber)(value.height)
    && isText(value.color) && isNumber(value.bright) && isNumber(value.dim) && isNumber(value.intensity)
    && isNullable(isText)(value.animation) && isNullable(isNumber)(value.angle) && isNumber(value.rotation)
    && typeof value.darkness === 'boolean' && isNullable(isNumber)(value.activeBelowAmbient)
    && (value.area === undefined || isLightArea(value.area));
}

/** A surface light's outline: a flat list of x, y, three to `BOARD_LIGHT_AREA_CORNERS` corners within the world. */
const isLightArea = (value: unknown): boolean => Array.isArray(value) && value.length >= 6 && value.length % 2 === 0 && value.length <= BOARD_LIGHT_AREA_CORNERS * 2
  && value.every((n) => isNumber(n) && Math.abs(n) < 1e7);

/** How a liquid moves: plain values. */
const isMotion = (motion: unknown): boolean => isFields(motion) && typeof motion.kind === 'string' && motion.kind.length <= 20
  && isNumber(motion.amount) && isNumber(motion.direction) && typeof motion.tint === 'string' && /^#[0-9a-f]{6}$/i.test(motion.tint) && isNumber(motion.clarity)
  && (motion.style === undefined || (typeof motion.style === 'string' && motion.style.length <= 20));

function isProp(value: unknown): boolean {
  return isFields(value) && isSceneId(value.id) && isSceneId(value.asset) && isNumber(value.x) && isNumber(value.y)
    && isNumber(value.scale) && isNumber(value.turn) && (value.solid === undefined || value.solid === true) && (value.lift === undefined || (isNumber(value.lift) && value.lift >= 0));
}

const TUNING_KEYS = ['relief', 'occlusion', 'shine', 'depth', 'displace', 'outward'] as const;

function isTuning(value: unknown): boolean {
  return isFields(value) && TUNING_KEYS.every((key) => isNumber(value[key]));
}

function isMaterial(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || !isNumber(value.scale) || !isFields(value.maps)) return false;
  const maps = Object.entries(value.maps);
  return maps.length <= BOARD_PART_LIMITS.maps && maps.every(([role, id]) => isSceneId(role) && isSceneId(id)) && (value.tuning === undefined || isTuning(value.tuning));
}

/** A ring of water's outline: a flat list of x, y, at least three places and no more than Atlas keeps. */
const isWaterRing = (value: unknown): boolean => Array.isArray(value) && value.length >= 6 && value.length % 2 === 0 && value.length <= BOARD_WATER_LIMITS.corners * 2
  && value.every((n) => isNumber(n) && Math.abs(n) < 1e7);

/**
 * Water: outlines within the limits, or an old mask no larger than the board draws with its text within the limit (at
 * least one of the two, all of it within `longest` as text), and a motion of plain values.
 */
function isWater(value: unknown, longest: number): boolean {
  if (!isFields(value)) return false;
  const { areas, mask } = value;
  if (areas === undefined && mask === undefined) return false;
  if (areas !== undefined) {
    if (!Array.isArray(areas) || areas.length === 0 || areas.length > BOARD_WATER_LIMITS.areas || JSON.stringify(areas).length > longest) return false;
    for (const area of areas) {
      if (!isFields(area) || !isWaterRing(area.polygon)) return false;
      if (area.liquid !== undefined && area.liquid !== 'lava' && area.liquid !== 'acid') return false;
      if (area.holes !== undefined && (!Array.isArray(area.holes) || area.holes.length === 0 || area.holes.length > BOARD_WATER_LIMITS.holes || !area.holes.every(isWaterRing))) return false;
    }
  }
  if (mask !== undefined) {
    if (!isFields(mask)) return false;
    const { width, height, data } = mask;
    const side = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= BOARD_WATER_LIMITS.side;
    if (!side(width) || !side(height) || typeof data !== 'string' || data.length > longest || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
  }
  const motion = value.motion;
  return (motion === undefined || motion === null || isMotion(motion)) && (value.lava === undefined || isMotion(value.lava)) && (value.acid === undefined || isMotion(value.acid));
}

/** Corners as the wire carries them: x, y, h triples, places within the world and heights within reach. */
function isCorners(value: unknown, least: number): boolean {
  if (!Array.isArray(value) || value.length < least * 3 || value.length % 3 !== 0 || value.length > BOARD_SHAPE_LIMITS.corners * 3) return false;
  return value.every((n, index) => isNumber(n) && Math.abs(n) < (index % 3 === 2 ? BOARD_SHAPE_LIMITS.height : 1e7));
}

function isShape(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || !isCorners(value.outline, 3)) return false;
  if (value.inner !== undefined && !isCorners(value.inner, 1)) return false;
  if ((Array.isArray(value.inner) ? value.inner.length : 0) + (value.outline as unknown[]).length > BOARD_SHAPE_LIMITS.corners * 3) return false;
  if (value.material !== undefined && !isSceneId(value.material)) return false;
  return value.sides === undefined || value.sides === true || isSceneId(value.sides);
}

/** A scene's (or a layer's) shapes: a list within the limits, all of it within `longest` as text. */
const isShapes = (value: unknown, longest: number): boolean => isList(value, BOARD_SHAPE_LIMITS.shapes, isShape) && JSON.stringify(value).length <= longest;

const NOISES = new Set(['flat', 'gentle', 'rolling', 'rough', 'dunes']);

function isGround(value: unknown): boolean {
  if (!isFields(value) || !GROUND_MODES.has(value.mode as string)) return false;
  if (value.material !== undefined && !isSceneId(value.material)) return false;
  if (typeof value.noise !== 'string' || !NOISES.has(value.noise)) return false;
  const within = (n: unknown, low: number, high: number): boolean => isNumber(n) && n >= low && n <= high;
  if (!within(value.strength, 0, 1) || !within(value.fog, 0, 100) || !within(value.margin, 0, 100) || !within(value.tile, 1, 8)) return false;
  if (value.painted === undefined ? value.mode === 'painted' : value.mode !== 'painted' || !isPainted(value.painted)) return false;
  return isMotion(value.water) && (value.lava === undefined || isMotion(value.lava)) && (value.acid === undefined || isMotion(value.acid));
}

const PATTERN_SHAPES = new Set(['smooth', 'ridged', 'terraced', 'craters']);

function isPattern(value: unknown): boolean {
  return isFields(value) && typeof value.name === 'string' && value.name.length <= 60 && isNumber(value.scale) && value.scale >= 4 && value.scale <= 200
    && isNumber(value.height) && value.height >= 0 && value.height <= 40 && Number.isInteger(value.roughness) && (value.roughness as number) >= 1 && (value.roughness as number) <= 6
    && typeof value.shape === 'string' && PATTERN_SHAPES.has(value.shape);
}

/** A prop brush: a name, up to four model ids (none is fine), a density and a scale within their ranges. */
function isBrush(value: unknown): boolean {
  return isFields(value) && typeof value.name === 'string' && value.name.length <= 60 && isList(value.props, BOARD_PAINTED_LIMITS.brushProps, isSceneId)
    && isNumber(value.density) && value.density >= 0.1 && value.density <= 200 && isNumber(value.scale) && value.scale >= 0.1 && value.scale <= 20;
}

/** A painted background: three picture ids, material ids by slot ('' for none) and settings within their ranges. */
function isPainted(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.terrain) || !isSceneId(value.material) || !isSceneId(value.height)) return false;
  if (!isList(value.materials, BOARD_PAINTED_LIMITS.materials, (id) => id === '' || isSceneId(id))) return false;
  if (value.props !== undefined && !isSceneId(value.props)) return false;
  const settings = value.settings;
  if (!isFields(settings) || !isList(settings.patterns, BOARD_PAINTED_LIMITS.patterns, isPattern)) return false;
  if (settings.props !== undefined && !isList(settings.props, BOARD_PAINTED_LIMITS.brushes, isBrush)) return false;
  const range = settings.height;
  if (!isFields(range) || !isNumber(range.low) || !isNumber(range.high) || Math.abs(range.low) > 100 || Math.abs(range.high) > 100 || range.low > range.high) return false;
  const liquids = settings.liquids;
  return isFields(liquids) && isMotion(liquids.water) && isMotion(liquids.lava) && isMotion(liquids.acid);
}

const GROUND_MODES = new Set(['board', 'horizon', 'water', 'lava', 'acid', 'painted']);

/** A level's fit as Atlas keeps it: positive factors (a scale may be under one), a turn of at most five degrees, an offset of the corner never left of or above it. */
function isFit(value: unknown): boolean {
  if (!isFields(value) || !isNumber(value.x) || !isNumber(value.y) || !(value.x > 0 && value.x <= 40) || !(value.y > 0 && value.y <= 40)) return false;
  if (value.rotation !== undefined && !(isNumber(value.rotation) && Math.abs(value.rotation) <= 5)) return false;
  const { offset } = value;
  return offset === undefined || (isFields(offset) && isNumber(offset.x) && isNumber(offset.y) && offset.x >= 0 && offset.y >= 0 && offset.x <= 1e7 && offset.y <= 1e7);
}

function isLayer(value: unknown): boolean {
  if (!isFields(value) || !isSceneId(value.id) || !isNumber(value.elevation) || !isSceneId(value.image)) return false;
  const { stands, grid } = value;
  return isFields(stands) && isNumber(stands.x) && isNumber(stands.y) && isNumber(stands.turn)
    && isFields(grid) && isNumber(grid.size) && grid.size > 0 && isNumber(grid.offsetX) && isNumber(grid.offsetY) && (grid.mapStretch === undefined || isFit(grid.mapStretch))
    && isList(value.walls, BOARD_LAYER_LIMITS.walls, isWall) && isList(value.lights, BOARD_LAYER_LIMITS.lights, isLight) && isList(value.props, BOARD_LAYER_LIMITS.props, isProp)
    && isNullable(isNumber)(value.fogHeight) && isNullable(isNumber)(value.wallThickness)
    && (value.water === undefined || isWater(value.water, BOARD_WATER_LIMITS.layer))
    && (value.shapes === undefined || isShapes(value.shapes, BOARD_SHAPE_LIMITS.layerBytes));
}

/** One part of a scene's board extras. */
export function isBoardExtras(value: unknown): value is BoardExtras {
  if (!isFields(value) || !isSceneId(value.sceneId)) return false;
  const lighting = value.lighting;
  return isList(value.walls, BOARD_PART_LIMITS.walls, isWall) && isList(value.lights, BOARD_PART_LIMITS.lights, isLight)
    && isList(value.props, BOARD_PART_LIMITS.props, isProp) && isList(value.materials, BOARD_PART_LIMITS.materials, isMaterial)
    && isNullable(isNumber)(value.fogHeight) && isNullable(isNumber)(value.wallThickness)
    && (value.layers === undefined || isList(value.layers, BOARD_LAYER_LIMITS.layers, isLayer))
    && (value.water === undefined || isWater(value.water, BOARD_WATER_LIMITS.scene))
    && (value.layerLook === undefined || value.layerLook === 'solid' || value.layerLook === 'faded' || value.layerLook === 'transparent')
    && (value.arTable === undefined || isArTable(value.arTable))
    && (value.shapes === undefined || isShapes(value.shapes, BOARD_SHAPE_LIMITS.bytes))
    && (value.ground === undefined || isGround(value.ground))
    && isFields(lighting) && typeof lighting.enabled === 'boolean' && isNumber(lighting.ambient) && isNullable(isText)(lighting.ambientColor);
}

export function isBoardCamera(value: unknown): value is BoardCamera {
  return isFields(value) && isSceneId(value.sceneId) && isPoint3(value.eye) && isPoint3(value.target);
}

/** A `board-extras` message's numbering: part `part` of `parts`, all of one `seq`. */
export function isBoardPart(message: Fields): boolean {
  return Number.isSafeInteger(message.seq) && (message.seq as number) >= 1
    && Number.isSafeInteger(message.parts) && (message.parts as number) >= 1 && (message.parts as number) <= BOARD_PART_LIMITS.parts
    && Number.isSafeInteger(message.part) && (message.part as number) >= 0 && (message.part as number) < (message.parts as number);
}

const isRunId = (value: unknown): value is string => typeof value === 'string' && CUTSCENE_LIMITS.runId.test(value);
const isCutsceneKey = (value: unknown): value is string => typeof value === 'string' && CUTSCENE_LIMITS.key.test(value);
const isFar = (value: unknown): boolean => isNumber(value) && Math.abs(value) <= CUTSCENE_LIMITS.coordinate;
const isPose3 = (value: unknown): boolean => isFields(value) && isFar(value.x) && isFar(value.y) && isFar(value.z);

/** The run's id, for the cutscene messages. */
export const isCutsceneRunId = isRunId;
/** A run-local map key (`k1`, `k2`, …). */
export const isCutsceneKeyName = isCutsceneKey;
/** The pose of a live cutscene camera. */
export const isCutscenePose = isPose3;

function isShot(value: unknown): boolean {
  return isFields(value) && isCutsceneKey(value.key) && isPose3(value.eye) && isPose3(value.target)
    && isNumber(value.at) && value.at >= 0 && value.at <= CUTSCENE_LIMITS.at && typeof value.keyframe === 'boolean'
    && (value.transition === 'fade' || value.transition === 'cut' || value.transition === 'move');
}

/** A running cutscene as Tabletop's `readBoardCutscene` reads it. */
export function isBoardCutscene(value: unknown): value is BoardCutscene {
  if (!isFields(value) || !isRunId(value.runId) || !isCutsceneKey(value.key)) return false;
  if (value.mode !== 'prepared' && value.mode !== 'live') return false;
  const { look, step, shots } = value;
  if (!isFields(look) || !isNumber(look.fadeMs) || look.fadeMs < CUTSCENE_LIMITS.fadeMs[0] || look.fadeMs > CUTSCENE_LIMITS.fadeMs[1]) return false;
  if (look.bars !== null && !(isNumber(look.bars) && CUTSCENE_LIMITS.bars.includes(look.bars))) return false;
  if (look.transition !== undefined && look.transition !== 'fade' && look.transition !== 'cut' && look.transition !== 'move') return false;
  if (!isFields(step) || !Number.isSafeInteger(step.seq) || (step.seq as number) < 1 || !Number.isSafeInteger(step.shot)) return false;
  if (!Array.isArray(shots) || shots.length > CUTSCENE_LIMITS.shots || !shots.every(isShot)) return false;
  if (value.mode === 'live') return shots.length === 0 && step.shot === 0;
  if (shots.length === 0 || (step.shot as number) < 0 || (step.shot as number) >= shots.length) return false;
  const rest = shots[step.shot as number] as { keyframe: boolean };
  return !rest.keyframe || step.shot === 0 || step.shot === shots.length - 1;
}
