/**
 * Saved maps for sharing tests. The fork built them with Atlas's `migrateMapFile`, which Connect does not have: this
 * gives the same shape (every object list present, the default camera), and `sourceOf` the source the catalogue reads.
 */
import type { SharedMapSource } from '../../../../src/app/online/sharing/model/buildMapPayload';
import type { SharedMapFile } from '../../../../src/app/online/sharing/model/sharedMapFile';

interface MapState {
  background?: string | null;
  grid?: unknown;
  objects?: Record<string, Record<string, unknown>>;
}

/** A map file as `migrateMapFile` gives it for `state`: the default lists and camera, what `state` holds over them. */
export function mapFile(state: MapState): SharedMapFile {
  return {
    background: state.background ?? null,
    grid: (state.grid ?? null) as SharedMapFile['grid'],
    objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, ...state.objects } as SharedMapFile['objects'],
    camera: { x: 0, y: 0, scale: 1 },
  };
}

const WIDGETS = { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} } as const;

/** The source the catalogue reads for `map`: the projection's input (no initiative list shown), its extra fields, and whether it is lit. */
export function sourceOf(map: SharedMapFile, extra: Record<string, unknown> = {}, lit = false): SharedMapSource {
  return {
    map,
    state: {
      background: map.background, grid: map.grid, objects: map.objects, widgets: WIDGETS as never,
      initiative: null as never, initiativeTrackerOpen: false, mapPath: null, lighting: { enabled: lit, ambient: 1 },
    },
    extra,
    lit,
  };
}
