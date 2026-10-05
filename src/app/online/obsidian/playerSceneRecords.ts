/**
 * A scene as players receive it (`PlayerScene`), rebuilt as Atlas's own records: the background,
 * grid, tokens, fog, texts, drawings, widgets and initiative. Pure, in the API's types, so a received
 * map (`sharing/receive/receivedMap.ts`) is saved through `scenes.addToCollection` and the remote view
 * (`remote/toRemoteScene.ts`) shows the same records. Only fields players are sent are read; nothing else can reach Atlas.
 */
import type { GridState, InitiativeState, SavedMapInput } from '@atlas-vtt/api-types';
import { playerCellNumbers } from '../scene/playerCellNumbers';
import { setOwn } from '../scene/sceneDiff';
import type { PlayerMeasurement, PlayerScene } from '../scene/sceneTypes';
import { GRID_DRAW_LIMITS, isDrawableGeometry } from '../scene/drawableGrid';
import { snapGridOf } from '../scene/snapGrid';
import { atlasInitiative, atlasWidgets } from './convertPanels';
import { atlasDrawing, atlasFog, atlasText } from './convertShapes';
import { atlasToken } from './convertTokens';

/** Where players' images are: the vault path or URL of an image by its asset id; null when there is none. */
export interface PlayerImages {
  background(assetId: string | null): string | null;
  token(assetId: string | null): string | null;
}

export interface PlayerSceneRecords {
  background: string | null;
  grid: GridState;
  objects: SavedMapInput['objects'];
  widgets: SavedMapInput['widgets'];
  initiative: InitiativeState;
  /** The GM showed the initiative list. */
  initiativeTrackerOpen: boolean;
}

/** Converts every record of a kind, keeping ids as own properties. */
export function mapRecords<S, A>(records: Readonly<Record<string, S>>, convert: (id: string, record: S) => A): Record<string, A> {
  const result: Record<string, A> = {};
  for (const [id, record] of Object.entries(records)) setOwn(result, id, convert(id, record));
  return result;
}

/** The grid's measurement fields; Atlas's ruler reads the full settings from the measurement players get. */
export function gridUnits(measurement: PlayerMeasurement): Pick<GridState, 'snapToGrid' | 'measurementType' | 'unitType' | 'unitDistance'> {
  return {
    snapToGrid: measurement.snapToGrid,
    measurementType: measurement.mode === 'metric' ? 'units' : 'abstract',
    ...(measurement.unitType !== 'custom' ? { unitType: measurement.unitType } : {}),
    unitDistance: measurement.unitDistance,
  };
}

/**
 * A grid players do not see stays hidden here but lies where the GM's drop snaps (`snapGridOf`), so
 * Atlas's drag and its resnap after a grid change put tokens where the GM does. On a map without a grid
 * it keeps the map's cell size, so tokens keep their size, and nothing snaps.
 */
/** A cell size within the limits for `map`, for a grid that is off: Atlas still reads its size. */
const fallbackSize = (map: Pick<PlayerScene['map'], 'width' | 'height'>): number =>
  Math.max(GRID_DRAW_LIMITS.minSize, Math.ceil(Math.max(map.width, map.height) / GRID_DRAW_LIMITS.cellsPerSide));

export function atlasGrid(scene: Pick<PlayerScene, 'grid' | 'map' | 'measurement'>): GridState {
  const units = gridUnits(scene.measurement);
  const grid = scene.grid;
  if (!grid) {
    const snap = snapGridOf(scene);
    const geometry = snap ?? { type: 'square' as const, size: scene.map.cellSize, offsetX: 0, offsetY: 0 };
    // A hidden lattice Atlas would lay out past the limits (`isDrawableGeometry`): no grid at all, no snapping.
    if (!isDrawableGeometry(geometry, scene.map)) return { enabled: false, visible: false, ...geometry, size: fallbackSize(scene.map), offsetX: 0, offsetY: 0, opacity: 0, ...units, snapToGrid: false };
    return { enabled: true, visible: false, ...geometry, opacity: 0, ...units, ...(snap ? {} : { snapToGrid: false }) };
  }
  const numbers = playerCellNumbers(grid);
  return {
    enabled: true,
    visible: true,
    type: grid.type,
    size: grid.size,
    offsetX: grid.offsetX,
    offsetY: grid.offsetY,
    ...(grid.color !== null ? { color: grid.color } : {}),
    opacity: grid.opacity,
    lineType: grid.lineType,
    lineWidth: grid.lineWidth,
    ...(numbers ? { cellNumbers: numbers.format, cellNumberOpacity: numbers.opacity } : {}),
    ...units,
  };
}

export function playerSceneRecords(scene: PlayerScene, images: PlayerImages): PlayerSceneRecords {
  const tokens = mapRecords(scene.tokens, (id, token) => atlasToken(id, token, images.token(token.image) ?? ''));
  const { widgetSettings, widgetValues } = atlasWidgets(scene.widgets);
  const { initiative, initiativeTrackerOpen } = atlasInitiative(scene.initiative, tokens);
  return {
    background: images.background(scene.map.asset),
    grid: atlasGrid(scene),
    objects: { tokens, fog: mapRecords(scene.fog, atlasFog), texts: mapRecords(scene.texts, atlasText), drawings: mapRecords(scene.drawings, atlasDrawing) },
    widgets: { settings: widgetSettings, values: widgetValues },
    initiative,
    initiativeTrackerOpen,
  };
}
