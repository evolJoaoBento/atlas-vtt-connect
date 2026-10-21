/**
 * What a player with the Tabletop extension gets besides the scene, to draw it on Tabletop's 3D board: the walls,
 * doors, lights and props players may see, the materials and heights the GM gave them, and the GM's 3D camera.
 * Sent only to players who asked (`board-request`). Shared with the web player page, so this file imports nothing.
 * Heights are in grid squares, as Tabletop keeps them; null is the board's default (the fog's height).
 */
export interface BoardPoint { x: number; y: number }

export interface BoardDoor {
  open: boolean;
  swing: 'left' | 'right';
  /** The asset id of the GLB standing in the doorway, or null for Tabletop's own leaf. */
  prop: string | null;
  chainId?: string;
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
}

export interface BoardMaterialRecord {
  id: string;
  scale: number;
  /** Texture role (`color`, `normal`, `roughness`…) to asset id. */
  maps: Record<string, string>;
}

export interface BoardPropRecord { id: string; asset: string; x: number; y: number; scale: number; turn: number }

export interface BoardLighting { enabled: boolean; ambient: number; ambientColor: string | null }

export interface BoardExtras {
  sceneId: string;
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  materials: BoardMaterialRecord[];
  /** The GM's ambient light on the board, or null for the scene's own. */
  ambient: number | null;
  lighting: BoardLighting;
  fogHeight: number | null;
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
export const BOARD_PART_LIMITS = Object.freeze({ walls: 1500, lights: 1000, props: 1000, materials: 200, maps: 8, parts: 64, text: 200 });
