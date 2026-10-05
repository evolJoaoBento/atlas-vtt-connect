/**
 * What online players receive of the presented scene. Shared with the web
 * player page, so this file imports nothing. Every field is `T | null`, never
 * optional: JSON drops `undefined`, and both sides compare by value.
 */
export interface ScenePoint {
  x: number;
  y: number;
}

export interface MapSize {
  width: number;
  height: number;
}

export interface PlayerMap {
  /** The background as an asset id; null without one. */
  asset: string | null;
  /** The loaded background's size in world pixels; 0 × 0 without one. */
  width: number;
  height: number;
  /** Grid cell size in world pixels, sent even when the grid is hidden so tokens keep their size. */
  cellSize: number;
}

export const PLAYER_GRID_TYPES = ['square', 'hex-horizontal', 'hex-vertical'] as const;
export type PlayerGridType = typeof PLAYER_GRID_TYPES[number];
export const PLAYER_GRID_LINES = ['solid', 'dashed', 'dotted'] as const;
export type PlayerGridLine = typeof PLAYER_GRID_LINES[number];
/** The formats a player before Atlas 0.5.1 reads, and only on hex grids (`PlayerGrid.hexNumbers`). */
export const PLAYER_HEX_NUMBERS = ['column-row', 'sequential'] as const;
export type PlayerHexNumbers = typeof PLAYER_HEX_NUMBERS[number];
/** Every format Atlas numbers cells in, as `CellNumberFormat`: the projection and `playerCellNumbers` assign one to the other, so the compiler keeps them equal. */
export const PLAYER_CELL_NUMBERS = ['column-row', 'sequential', 'letter-number'] as const;
export type PlayerCellNumbers = typeof PLAYER_CELL_NUMBERS[number];

export interface PlayerGrid {
  type: PlayerGridType;
  size: number;
  offsetX: number;
  offsetY: number;
  color: string | null;
  opacity: number;
  lineType: PlayerGridLine;
  lineWidth: number;
  /**
   * The cell numbers as a player before Atlas 0.5.1 reads them: on a hex grid in a format it
   * knows, else null. Newer players read `cellNumbers`.
   */
  hexNumbers: PlayerHexNumbers | null;
  hexNumberOpacity: number | null;
  /** How the player window numbers the cells, on any grid; absent from a GM before Atlas 0.5.1, which sent `hexNumbers` only. */
  cellNumbers?: PlayerCellNumbers | null;
  cellNumberOpacity?: number | null;
}

/** The HP and stress bars of a GM before Atlas 0.5, still validated and never read: bars are `PlayerResource` now. */
export interface PlayerLegacyBar {
  current: number;
  max: number;
}

/**
 * One resource bar as the player window draws it, and no more: no name, no numbers (the window
 * shows none to players) and the share in hundredths. The colour is the one the window shows,
 * warning tints included. Bars come in the order the window stacks them, from the token's bottom edge.
 */
export interface PlayerResource {
  /** `#rrggbb`. */
  color: string;
  /** How much of the bar is filled, from 0 to 1. */
  share: number;
  /** The window darkens this bar: a resource that defeats the token is spent. At most one bar per token. */
  spent: boolean;
}

export interface PlayerCondition {
  id: string;
  /** The number of a valued condition; null when the token stores none. */
  value: number | null;
}

/** The two sides of a fight by sides, as `InitiativeSide` (a parity test keeps them equal). */
export const PLAYER_SIDES = ['players', 'opponents'] as const;
export type PlayerSide = typeof PLAYER_SIDES[number];

export interface PlayerToken {
  x: number;
  y: number;
  /** Size in cells, as `BaseToken.size`. */
  size: number;
  rotation: number;
  layer: number;
  image: string | null;
  /** Ring colour; null when the token shows no ring. */
  ring: string | null;
  conditions: PlayerCondition[];
  name: string | null;
  /** Always null since Atlas 0.5; older players still require the field. */
  hp: PlayerLegacyBar | null;
  /** Always null since Atlas 0.5; older players still require the field. */
  stress: PlayerLegacyBar | null;
  /** The bars the window draws on the token; absent from a GM of an older version, which sent none. */
  resources?: PlayerResource[];
  /** The window greys the token out and marks it with a skull: a resource that defeats it is spent, whether players see that resource or not. */
  downed?: boolean;
  /** The side the list by sides puts this combatant under; sent only for a token with an initiative entry while the list is by sides. */
  side?: PlayerSide;
}

/** A fog operation with its drag offset applied and its points simplified. */
export type PlayerFogOp =
  | { type: 'brush'; erase: boolean; order: number; radius: number; points: ScenePoint[] }
  | { type: 'lasso'; erase: boolean; order: number; points: ScenePoint[] }
  | { type: 'rectangle'; erase: boolean; order: number; x: number; y: number; width: number; height: number };

export const PLAYER_TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type PlayerTextAlign = typeof PLAYER_TEXT_ALIGNS[number];

export interface PlayerText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  backgroundColor: string | null;
  padding: number;
  borderRadius: number;
  opacity: number;
  width: number | null;
  height: number | null;
  align: PlayerTextAlign;
  bold: boolean;
  italic: boolean;
  rotation: number;
  scale: number;
}

export const PLAYER_DRAWING_TYPES = ['pen', 'eraser', 'line', 'rectangle', 'circle', 'icon'] as const;
export type PlayerDrawingType = typeof PLAYER_DRAWING_TYPES[number];

export interface PlayerDrawing {
  type: PlayerDrawingType;
  order: number;
  points: ScenePoint[];
  color: string;
  width: number;
  opacity: number;
  icon: string | null;
}

export const PLAYER_WIDGET_TYPES = ['counter', 'clock', 'timer'] as const;
export type PlayerWidgetType = typeof PLAYER_WIDGET_TYPES[number];

export interface PlayerWidget {
  id: string;
  type: PlayerWidgetType;
  label: string;
  icon: string;
  /** Counters and clocks: the count; timers: the remaining seconds. */
  value: number;
}

export interface PlayerInitiativeEntry {
  id: string;
  tokenId: string;
  initiative: number;
  name: string | null;
  /** Always null since Atlas 0.5; older players still require the field. */
  hp: PlayerLegacyBar | null;
  /** How full the bar after the name is (the token's `hp` resource, where players see it); null without one. Absent from an older GM. */
  hpShare?: number | null;
  /** By sides the turn belongs to a side, so this is always false there. */
  isActive: boolean;
  /** The combatant does not act in the running round; the window fades it. Absent from an older GM. */
  sitsOut?: true;
}

/** How the list is grouped while it is by sides; the combatants' sides are on their tokens. */
export interface PlayerInitiativeSides {
  /** The side that acts first in a round, and so is listed first. */
  first: PlayerSide;
  /** The side whose turn it is; absent between fights. */
  active?: PlayerSide;
}

export interface PlayerInitiative {
  round: number;
  /** Whether combat is running. */
  active: boolean;
  entries: PlayerInitiativeEntry[];
  /**
   * Present exactly when the player window groups the combatants by side. Then no initiative
   * numbers are sent (every `initiative` is 0, since older pages require one) and no entry is
   * the active one. Absent for a list in turn order, and from an older GM.
   */
  sides?: PlayerInitiativeSides;
}

export const PLAYER_MEASUREMENT_MODES = ['metric', 'abstract'] as const;
export const PLAYER_UNIT_TYPES = ['feet', 'yards', 'meters', 'units', 'custom'] as const;
export const PLAYER_DIAGONAL_RULES = ['equidistant', 'alternating', 'euclidean'] as const;

export interface PlayerRangeBand {
  name: string;
  /** The band covers distances up to this many squares. */
  maxSquares: number;
}

/** Where the GM's drop snaps tokens: the grid's geometry only, nothing it draws. */
export interface PlayerSnapGrid {
  type: PlayerGridType;
  size: number;
  offsetX: number;
  offsetY: number;
}

/** The GM's measurement settings (Atlas's `MeasurementSettings`), so the page labels distances as Atlas does. */
export interface PlayerMeasurement {
  mode: typeof PLAYER_MEASUREMENT_MODES[number];
  unitType: typeof PLAYER_UNIT_TYPES[number];
  /** Units per cell of this map: the scene's own distance per cell where it sets one (`GridState.unitDistanceOverride`). */
  unitDistance: number;
  /**
   * Units per rules square: the collection's distance per cell, whatever the scene sets (`MeasurementSettings.ruleDistance`).
   * Absent from a GM before Atlas extension API 1.14.0; the mirror fills in `unitDistance`.
   */
  ruleDistance: number;
  diagonalRule: typeof PLAYER_DIAGONAL_RULES[number];
  rangeBands: PlayerRangeBand[];
  /** The GM's snap-to-grid: the drag ruler snaps to cell centres only when it is on. */
  snapToGrid: boolean;
  /** The full opening of a cone measurement in degrees, as the GM's measure tool opens it (the game system's). */
  coneAngle: number;
  /**
   * The grid the GM snaps a dropped token to, also while players see no grid (hidden, switched off, or
   * kept from players), so drags snap where the GM's check puts them; null where the GM's map has no
   * grid, so nothing snaps. Absent from a GM before Atlas 0.5.1-beta.5.
   */
  snapGrid?: PlayerSnapGrid | null;
}

export interface PlayerScene {
  /** Random per presentation: a new presentation or scene gets a new id. */
  sceneId: string;
  map: PlayerMap;
  grid: PlayerGrid | null;
  tokens: Record<string, PlayerToken>;
  fog: Record<string, PlayerFogOp>;
  texts: Record<string, PlayerText>;
  drawings: Record<string, PlayerDrawing>;
  widgets: PlayerWidget[];
  initiative: PlayerInitiative | null;
  measurement: PlayerMeasurement;
}

/** A snapshot's scene: everything but the fog and the drawings, which follow in parts. */
export type PlayerSceneBody = Omit<PlayerScene, 'fog' | 'drawings'>;

/** Fields diffed per record, by id. */
export const SCENE_RECORD_KEYS = ['tokens', 'fog', 'texts', 'drawings'] as const;
export type SceneRecordKey = typeof SCENE_RECORD_KEYS[number];
/** Fields replaced as a whole when they differ. */
export const SCENE_FIELD_KEYS = ['map', 'grid', 'widgets', 'initiative', 'measurement'] as const;
export type SceneFieldKey = typeof SCENE_FIELD_KEYS[number];

export interface ScenePatchBody {
  set: Partial<Pick<PlayerScene, SceneFieldKey>>;
  upsert: Partial<Pick<PlayerScene, SceneRecordKey>>;
  remove: Partial<Record<SceneRecordKey, string[]>>;
}

/** Records in replay order: by `orderOf`, then by id, so both sides agree on ties. */
export function sortedByOrder<T>(records: Readonly<Record<string, T>>, orderOf: (record: T) => number): Array<[string, T]> {
  return Object.entries(records).sort(([idA, a], [idB, b]) => {
    const byOrder = orderOf(a) - orderOf(b);
    if (byOrder !== 0) return byOrder;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}
