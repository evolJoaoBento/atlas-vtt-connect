/** The scene wire format's bounds and defaults, held by both sides. Imports only the record types beside it. */
import type { PlayerMeasurement } from './sceneTypes';

/** Atlas's cone of a collection without a cone angle (`DEFAULT_CONE_ANGLE`; a test keeps them equal), here since the wire format imports nothing. */
export const PLAYER_DEFAULT_CONE_ANGLE = 90;

/**
 * A GM from before the page's tools sent no measurement, no snap flag or no cone angle: Atlas's defaults. One from
 * before `ruleDistance` measured squares like cells, so it is the distance per cell (as Atlas's remote view fills it).
 */
export function withMeasurementDefaults(measurement: Partial<PlayerMeasurement> | undefined): PlayerMeasurement {
  const filled: Omit<PlayerMeasurement, 'ruleDistance'> & Partial<Pick<PlayerMeasurement, 'ruleDistance'>> = {
    mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true,
    coneAngle: PLAYER_DEFAULT_CONE_ANGLE, ...measurement,
  };
  return { ...filled, ruleDistance: measurement?.ruleDistance ?? filled.unitDistance };
}

/** Bounds both sides hold scene data to; the projection clips to them so its output always validates. */
export const SCENE_LIMITS = {
  idLength: 128,
  stringLength: 512,
  textLength: 10_000,
  /** Keeps one fog operation well under a fog part's budget. */
  points: 5_000,
  records: 10_000,
  conditions: 64,
  /** A token has this many resource sockets; the window draws the first two. */
  resources: 6,
  widgets: 64,
  initiativeEntries: 200,
  rangeBands: 32,
} as const;

type Range = readonly [min: number, max: number];

/** Inclusive numeric bounds both sides hold scene values to, so no value can stall a renderer. */
export const SCENE_RANGES = {
  gridSize: [1, 10_000],
  cellSize: [1, 10_000],
  mapSize: [0, 200_000],
  coordinate: [-10_000_000, 10_000_000],
  stroke: [0, 10_000],
  fontSize: [1, 1_000],
  textScale: [0.01, 100],
  tokenSize: [0.05, 100],
  textBox: [0, 200_000],
  opacity: [0, 1],
  unitDistance: [0, 1_000_000],
  rangeBand: [1, 1_000_000],
} as const satisfies Record<string, Range>;
