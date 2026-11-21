/**
 * Atlas VTT's own rules, for Connect and Tabletop alike: what this package exports of the stock Atlas files copied
 * verbatim under `app/` (see ../README.md). Browser-safe: nothing here imports Obsidian, Node or the DOM.
 *
 * Atlas's texts are not copied (`app/i18n` is a stand-in whose `t` gives the key back), so nothing exported here is a
 * label made with `t`: `TOKEN_SIZE_OPTIONS`, the pin labels, a side's name and the laser's colour hint are left out.
 */

// ── Distances and units ───────────────────────────────────────────────────────
export { cellsByRule, flatCells, pathLengthInCells, type FlatCells, type GridGeometry } from './app/grid/gridDistance';
export {
  collectionUnitName,
  DEFAULT_CONE_ANGLE,
  formatDistance,
  formatGameUnits,
  isValidConeAngle,
  MAX_UNIT_NAME,
  readUnitName,
  resolveMeasurementSettings,
  sceneUnitName,
  unitLabelFor,
  type MeasurementSettings,
} from './app/grid/measurementFormat';
export { movementCostInCells, type DifficultCells } from './app/grid/movementCost';
export type { CollectionGridDefaults, DiagonalRule, DifficultTerrainRule, GridUnitType } from './app/types/collectionSettingsTypes';
export type { GridState } from './app/types/gridTypes';

// ── The grid: cells, lattices, where a token stands ───────────────────────────
export {
  axialDistance,
  axialRound,
  axialToPixel,
  createHexLayout,
  hexCellExtent,
  hexCircumradius,
  hexOrientationForGridType,
  hexVertices,
  isHexGridType,
  nearestHexCenter,
  pixelToAxial,
  type AxialCoord,
  type HexGridType,
  type HexLayout,
  type Point,
} from './app/grid/hexGeometry';
export { gridOffsetCenteredAt, resizedTokenCenter, snapTokenCenter, tokenCenterShift } from './app/grid/gridPlacement';
export { normaliseGridOffset, type GridOffset } from './app/grid/gridOffset';
export {
  cellLabelsByKey,
  cellNumberAnchor,
  cellNumberFontSize,
  cellNumberStyleOfGrid,
  columnRowLabel,
  DEFAULT_CELL_NUMBER_OPACITY,
  isCellNumberFormat,
  letterNumberLabel,
  numberCells,
  type CellLattice,
  type CellNumberFormat,
  type CellNumberStyle,
  type MapRect,
  type NumberedCell,
  type PlacedCell,
} from './app/grid/cellNumbering';
export { axialKey, hexLattice } from './app/grid/hexLattice';
export { squareCellCentre, squareGridOf, squareLattice, type SquareGrid } from './app/grid/squareLattice';
export { cellCentreAt, cellKeyAt, cellOutline, hexLayoutOf, lengthInCells } from './app/measure/measureGrid';
export {
  computeTokenPixelSize,
  computeTokenStrokeWidth,
  NAMEPLATE_HEIGHT,
  RESIZE_HANDLE_SIZE,
  restingTokenUIScale,
  selectedTokenUIScale,
  tokenDiameterInCells,
  tokenUIScale,
} from './app/pixi/token-renderer/tokenSizing';

// ── A token's height, and how far it moves ────────────────────────────────────
export {
  countsHeight,
  heightField,
  MAX_TOKEN_HEIGHT,
  riseBetweenEnds,
  riseInCells,
  signedHeight,
  steppedHeight,
  tokenHeight,
  type HasHeight,
  type HeightSettings,
} from './app/measure/tokenHeight';
export {
  hasMovementRules,
  isMovementSpeed,
  isValidMovementRules,
  MAX_MOVEMENT_SPEED,
  MAX_MOVEMENT_STEPS,
  movementStepFor,
  NO_MOVEMENT_RULES,
  parseMovementRules,
  stepReach,
  type MovementRules,
  type MovementStep,
} from './app/measure/movementRules';
export { BEYOND_SPEED, dragMove, movedGameUnits, type DragMove, type DragMoveInput, type MoveColor, type MoveSettings } from './app/measure/dragMovement';
export { DEFAULT_DRAG_DISTANCE, DRAG_DISTANCES, readDragDistance, showsDragDistance, type DragDistance } from './app/measure/dragDistance';
export { movedInTurn, turnMoveAfter, withTurnMoves, type TurnMove, type TurnMoves } from './app/measure/turnMoves';

// ── Levels (floors) ───────────────────────────────────────────────────────────
export {
  firstLevelId,
  hasLevels,
  isLevelOf,
  levelById,
  onLevel,
  onlyOnLevel,
  resolveLevel,
  viewedLevelId,
  type LevelView,
  type SceneLevels,
} from './app/levels/sceneLevels';
export { everyLevelObjects, levelObjects, levelObjectsOn, type LevelObjectsState, type SceneObjects } from './app/levels/levelObjects';
export type { OnLevels, OnOneLevel, SceneLevel } from './app/types/sceneLevelTypes';

// ── Resources (hit points, stress, slots) ─────────────────────────────────────
export {
  clampValue,
  defeatedResources,
  defeatTest,
  holdsValue,
  isDefeated,
  isKillable,
  isSpent,
  restedResources,
  resourceUpdate,
  startingValue,
  withCurrent,
} from './app/resources/resourceValues';
export { isSocket, slottedResources, type SlottedResource } from './app/resources/resourceSlots';
export { shapeOf, visibleResources } from './app/resources/visibleResources';
export { remainingShare, RESOURCE_COLORS, resourceColor } from './app/resources/resourceColors';
export * from './app/resources/resourceTypes';

// ── Initiative: sides and the defeated ────────────────────────────────────────
export { fightSides, listedBySides, listedSides, sideOf, type ListedSide } from './app/initiative/sides';
export { activeSides, enterSideRound, fightSideIds, rollSides, roundTurns } from './app/initiative/sideOrder';
export { combatantDefeated, defeatedCombatants } from './app/initiative/defeated';
export { collectionParty, entrySide, entryToken } from './app/initiative/party';
export { currentTurn, inFight, turnEntries } from './app/initiative/turnHolders';
export * as initiativeSideRules from './app/gameSystems/initiativeSideRules';
export * as diceRules from './app/gameSystems/diceRules';

// ── Dice: critical results and exploding faces ───────────────────────────────
export { defaultDiceOf, getDiceCrit, type DiceCrit } from './app/tools/diceCrit';
export { explodingFaces, MAX_EXPLOSIONS } from './app/tools/diceExplosion';
export { DICE_SET_COLOURS, isDieColour, rollingRules } from './app/gameSystems/diceSets';
// The dice look (Atlas's global `diceColour` / `diceFont`, read with `getDiceLook`): its values and how they are checked.
export { DEFAULT_DICE_LOOK, isDiceColour, isDiceFont, parseHex, readableInk, type DiceColour, type DiceFont, type DiceLook } from './app/dice3d/diceLook';
export type { RollingDice } from './app/types/diceSetTypes';
export type * from './app/types/initiativeRulesTypes';
export type * from './app/types/initiativeTypes';

// ── Settings and constants ────────────────────────────────────────────────────
import { LASER_COLOR_SWATCHES } from './app/tools/laserPointerSettings';

/** Atlas's laser colours, in its order. Their names are Atlas's texts, which this package does not carry. */
export const LASER_COLORS: readonly string[] = LASER_COLOR_SWATCHES.map((swatch) => swatch.value);
export {
  DEFAULT_LASER_POINTER_SETTINGS,
  LASER_FADE_TIME,
  LASER_SIZE_MAX,
  LASER_SIZE_MIN,
  resolveLaserPointerSettings,
  type LaserPointerSettings,
} from './app/tools/laserPointerSettings';
export * as lightingConstants from './app/lighting/lightingConstants';
export * as pinIcons from './app/types/pinIcons';

// ── Measures: areas as Atlas shapes them, and their looks ────────────────────
export { shapedArea, circleCorners, type AreaShapeRules, type MeasureArea, type ShapedArea } from './app/measure/measureGeometry';
export { MEASURE_EFFECTS, readMeasureEffect, type MeasureEffect } from './app/measure/measureEffects';
export { snapAreaEnd, snapAreaOrigin, snapRulerPoint } from './app/measure/measureSnap';
export { MAX_MEASURES, MAX_MEASURE_AUTHOR, MEASURE_SHAPES, type KeptMeasure, type Measurement, type MeasureShapeKind } from './app/measure/measureTypes';
export { DEFAULT_AREA_CELL_RULE, DEFAULT_CONE_END, type AreaCellRule, type ConeEnd } from './app/measure/areaRules';

// ── Drawings and texts (Atlas 0.16's reader): what is drawn, how, and what is kept from players ──────────────
export { annotationList, annotationOrder, readDrawing, readText, type AnnotationRecords } from './app/annotations/annotationList';
export type { Annotation, DrawingAnnotation, DrawDash, DrawEnds, DrawFill, DrawLayer, DrawShape, TextAnnotation, TextLook } from './app/annotations/annotationTypes';
