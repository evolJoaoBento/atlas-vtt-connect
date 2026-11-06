/**
 * What a player with the Tabletop extension gets besides the scene, to draw it on Tabletop's 3D board: the walls,
 * doors, lights and props players may see, the materials and heights the GM gave them, and the GM's 3D camera.
 * Sent only to players who asked (`board-request`). Shared with the web player page, so this file imports nothing.
 * Heights are in grid squares, as Tabletop keeps them; null is the board's default (the fog's height).
 */
import type { ArTable } from '../tools/arTable';

export interface BoardPoint { x: number; y: number }

export interface BoardDoor {
  open: boolean;
  swing: 'left' | 'right';
  /** The asset id of the GLB standing in the doorway, or null for Tabletop's own leaf. */
  prop: string | null;
  chainId?: string;
  /** The door was turned by the GM: its hinge is at the segment's second end, and/or it opens to the other side of the wall. Absent as Atlas draws it. */
  hinge?: true;
  side?: true;
}

export interface BoardWallRecord {
  id: string;
  /** A closed secret door is sent as `solid`, with no `door`. */
  type: 'solid' | 'door';
  p1: BoardPoint;
  p2: BoardPoint;
  height: number | null;
  /** A material of `BoardExtras.materials`, or null for the plain wall. */
  material: string | null;
  door?: BoardDoor;
  /** Atlas's one-way side, a wall that stops only sight (a curtain), only light (glass) or only tokens (a window), and a limited one. */
  direction?: 'left' | 'right';
  blocks?: 'sight' | 'light' | 'movement';
  limited?: boolean;
  /** A window's opening on Tabletop's board (grid squares from the floor), where the GM set it. */
  window?: { bottom: number; top: number };
  /** The wall's own width (thickness) on Tabletop's board, in grid squares, where the GM set one. */
  width?: number;
}

export interface BoardLightRecord {
  id: string;
  x: number;
  y: number;
  height: number | null;
  color: string;
  bright: number;
  dim: number;
  intensity: number;
  animation: string | null;
  angle: number | null;
  rotation: number;
  /** A light that darkens, and the ambient level below which it shines (Atlas's `activeBelowAmbient`). */
  darkness: boolean;
  activeBelowAmbient: number | null;
}

/** How strongly a material shows its texture on Tabletop's board (the GM's sliders); players' boards draw it the same way. */
export interface BoardMaterialTuning {
  relief: number;
  occlusion: number;
  shine: number;
  depth: number;
  displace: number;
  outward: number;
}

export interface BoardMaterialRecord {
  id: string;
  scale: number;
  /** Texture role (`color`, `normal`, `roughness`…) to asset id. */
  maps: Record<string, string>;
  /** Absent when the material is as made. */
  tuning?: BoardMaterialTuning;
}

/** `solid`: tokens set on it stand on its top. `lift`: how high it stands, in grid squares. */
export interface BoardPropRecord { id: string; asset: string; x: number; y: number; scale: number; turn: number; solid?: true; lift?: number }

export interface BoardLighting { enabled: boolean; ambient: number; ambientColor: string | null }

/**
 * A scene stacked with the one shown (an elevation layer): its floor and the walls, doors, lights and props standing in it,
 * at its height and place. Never what is on it (tokens, pins, notes, fog). Materials are those of `BoardExtras.materials`.
 */
export interface BoardLayerRecord {
  id: string;
  /** Grid squares above the shown scene (negative: below it). */
  elevation: number;
  /** Where it stands on the plane beyond its height, seen from the shown scene: a shift in map pixels after a turn in degrees. */
  stands: { x: number; y: number; turn: number };
  /** The asset id of its floor image. */
  image: string;
  grid: { size: number; offsetX: number; offsetY: number };
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  fogHeight: number | null;
  wallThickness: number | null;
  /** The layer's painted water; absent for none. */
  water?: BoardWater;
}

/**
 * Painted water as Tabletop keeps it: the mask's size in texels, its run lengths (base64 varints) and how it moves.
 * Under the fog it still shows only as the board draws it there (black): the mask is the GM's whole drawing.
 */
export interface BoardWater {
  mask: { width: number; height: number; data: string };
  motion?: { kind: string; amount: number; direction: number; tint: string; clarity: number } | null;
}

export interface BoardExtras {
  sceneId: string;
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  materials: BoardMaterialRecord[];
  /** The GM's ambient light on the board, or null for the scene's own. */
  ambient: number | null;
  /** The colour the GM tinted the board's daylight, '#rrggbb'; absent or null for none. */
  tint?: string | null;
  lighting: BoardLighting;
  fogHeight: number | null;
  /** How thick walls stand, as a share of a grid square; null is the board's default. */
  wallThickness: number | null;
  /** The scenes stacked with this one, lowest first; absent when it stands alone. Sent with the first part only. */
  layers?: BoardLayerRecord[];
  /** The water painted on the scene; absent for none. Sent with the first part only. */
  water?: BoardWater;
  /** How the GM draws the scenes stacked above (Tabletop's Upper layers), so players see them the same; absent from an older Tabletop. */
  layerLook?: 'solid' | 'faded' | 'transparent';
  /** Where the marker sheets lie on the players' table, as the GM placed them on this map; absent for none. Sent with the first part only. */
  arTable?: ArTable;
}

export interface BoardCamera {
  sceneId: string;
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * The most of each kind one `board-extras` part carries, so a part stays well under the control message size; the
 * GM splits larger scenes into parts (materials ride on the first).
 */
/** The most the layers of one scene may carry: each layer's records, and all the layers together as JSON (a layer that would pass it is left out). */
export const BOARD_LAYER_LIMITS = Object.freeze({ layers: 8, walls: 400, lights: 60, props: 100, bytes: 110 * 1024 });

/** The longest painted water mask sent (its base64 text): the scene's own, and a layer's (which counts towards the layers' bytes). */
export const BOARD_WATER_LIMITS = Object.freeze({ scene: 60 * 1024, layer: 40 * 1024, side: 2048 });

export const BOARD_PART_LIMITS = Object.freeze({ walls: 1500, lights: 1000, props: 1000, materials: 200, maps: 8, parts: 64, text: 200 });
