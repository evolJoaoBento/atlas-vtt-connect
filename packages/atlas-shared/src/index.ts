/**
 * Atlas VTT's own rules, for Connect and Tabletop alike: what this package exports of the stock Atlas files copied
 * verbatim under `app/` (see ../README.md). Browser-safe: nothing here imports Obsidian, Node or the DOM.
 */
export { cellsByRule, flatCells, pathLengthInCells, type FlatCells, type GridGeometry } from './app/grid/gridDistance';
export type { Point } from './app/grid/hexGeometry';
export {
  collectionUnitName,
  formatDistance,
  formatGameUnits,
  MAX_UNIT_NAME,
  readUnitName,
  resolveMeasurementSettings,
  sceneUnitName,
  unitLabelFor,
  type MeasurementSettings,
} from './app/grid/measurementFormat';
export type { CollectionGridDefaults, DiagonalRule, GridUnitType } from './app/types/collectionSettingsTypes';
export type { GridState } from './app/types/gridTypes';
