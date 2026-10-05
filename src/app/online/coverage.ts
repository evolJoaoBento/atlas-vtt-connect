/**
 * What online players receive of every Atlas map object and field. The tables are
 * records over the vendored API types (`@atlas-vtt/api-types`), so a new object kind or field
 * fails the build until it is recorded here. An object kind or store field the API does not
 * carry (pins, walls, lights, audio, token display settings) cannot reach this code at all.
 *
 * - `sent`: changes what players receive: the value itself, or what it decides
 *   (a hidden token never reaches players).
 * - `used`: never sent itself; it decides what is sent (a resource definition's socket decides which bar
 *   players see). Changing it changes what players receive.
 * - `lighting`: never sent, in any message; with dynamic lighting on and the scene lit it
 *   decides what players receive, through the lighting the GM's player window is drawn by
 *   (`PlayerLighting`): which tokens they see and the darkness over the map. Off, it changes nothing.
 * - `gm-only`: never changes what players receive; `reason` says why.
 * - `not-yet`: not sent yet; `piece` names the work expected to add it.
 *
 * `tests/unit/online/coverage.test.ts` checks every entry against the projection.
 */
import type { CollectionGridDefaults, DrawingStroke, FogOperation, GridState, InitiativeEntry, InitiativeRules, InitiativeState, ResourceDefinition, SceneLighting, SceneSnapshot, TextElement, TokenEntity } from '@atlas-vtt/api-types';

export type Coverage =
  | { readonly status: 'sent' }
  | { readonly status: 'lighting' }
  | { readonly status: 'used'; readonly reason: string }
  | { readonly status: 'gm-only'; readonly reason: string }
  | { readonly status: 'not-yet'; readonly piece: string };

export type CoverageTable<K extends PropertyKey> = Readonly<Record<K, Coverage>>;

/** Every key of every member of a union; `keyof` of a union keeps only the shared ones. */
export type KeysOfUnion<T> = T extends unknown ? keyof T : never;

const SENT: Coverage = { status: 'sent' };
const LIGHTING: Coverage = { status: 'lighting' };
const used = (reason: string): Coverage => ({ status: 'used', reason });
const gmOnly = (reason: string): Coverage => ({ status: 'gm-only', reason });
const notYet = (piece: string): Coverage => ({ status: 'not-yet', piece });

const KIND = gmOnly('the record kind; players get each kind in its own list');
const LOCAL_PLAYER_LINK = gmOnly('links the token to a local player character, not to an online player');
/** Only how the player window draws what it shows (tints, looks): never what it shows or hides. */
const LIGHTING_LOOK = gmOnly('the look of the lit picture; players get what it shows, not how it is tinted');

export const OBJECT_COVERAGE: CoverageTable<keyof SceneSnapshot['objects']> = {
  tokens: SENT,
  fog: SENT,
  texts: SENT,
  drawings: SENT,
};

export const TOKEN_FIELD_COVERAGE: CoverageTable<KeysOfUnion<TokenEntity>> = {
  id: SENT,
  kind: SENT,
  x: SENT,
  y: SENT,
  imagePath: SENT,
  size: SENT,
  rotation: SENT,
  layer: SENT,
  showRing: SENT,
  ringColor: SENT,
  conditions: SENT,
  conditionValues: SENT,
  isHidden: SENT,
  name: SENT,
  statblockPath: SENT,
  statblockName: SENT,
  // The bars the window draws (`projectBars`), and whether the token is downed; the collection's definitions decide which (`RESOURCE_DEFINITION_COVERAGE`).
  resources: SENT,
  overriddenMax: gmOnly('records which maximums the GM set by hand; the values it protects are what players see'),
  showNameplate: gmOnly('players see nameplates by the Show nameplates player view setting, as in the player window'),
  tags: gmOnly('tags organise the GM\'s tokens'),
  notePath: gmOnly('note links stay on the GM\'s machine'),
  difficulty: gmOnly('the statblock rating is shown to the GM only'),
  playerLinked: LOCAL_PLAYER_LINK,
  playerId: LOCAL_PLAYER_LINK,
  playerCharacterId: LOCAL_PLAYER_LINK,
  vision: LIGHTING,
  light: LIGHTING,
  // Sent as `PlayerToken.side` only for a combatant while the player window lists by sides (`withCombatantSides`); the window files it by `sideOf`.
  side: SENT,
  instanceNumber: notYet('instance badges, with the scene\'s Show instance badges setting (a later piece)'),
};

export const TEXT_FIELD_COVERAGE: CoverageTable<keyof TextElement> = {
  id: SENT,
  kind: KIND,
  x: SENT,
  y: SENT,
  text: SENT,
  fontSize: SENT,
  fontFamily: SENT,
  color: SENT,
  backgroundColor: SENT,
  padding: SENT,
  borderRadius: SENT,
  opacity: SENT,
  width: SENT,
  height: SENT,
  align: SENT,
  bold: SENT,
  italic: SENT,
  rotation: SENT,
  scale: SENT,
};

export const DRAWING_FIELD_COVERAGE: CoverageTable<keyof DrawingStroke> = {
  id: SENT,
  kind: KIND,
  timestamp: SENT,
  type: SENT,
  points: SENT,
  color: SENT,
  width: SENT,
  opacity: SENT,
  icon: SENT,
};

export const FOG_FIELD_COVERAGE: CoverageTable<KeysOfUnion<FogOperation>> = {
  id: SENT,
  kind: KIND,
  timestamp: SENT,
  type: SENT,
  isErasing: SENT,
  offsetX: SENT,
  offsetY: SENT,
  points: SENT,
  brushRadius: SENT,
  x: SENT,
  y: SENT,
  width: SENT,
  height: SENT,
};

export const GRID_FIELD_COVERAGE: CoverageTable<keyof GridState> = {
  enabled: SENT,
  visible: SENT,
  // In the grid players see, and in `measurement.snapGrid` also while they see none: the GM's drop snaps to it.
  type: SENT,
  size: SENT,
  offsetX: SENT,
  offsetY: SENT,
  color: SENT,
  opacity: SENT,
  lineType: SENT,
  lineWidth: SENT,
  // As `cellNumbers`, and as `hexNumbers` on hex grids for players before Atlas 0.5.1.
  cellNumbers: SENT,
  cellNumberOpacity: SENT,
  // Sent in the measurement, so the page's drag ruler snaps as the GM's tokens do.
  snapToGrid: SENT,
  scale: gmOnly('used while aligning the grid to the map'),
  mapScale: gmOnly('used while aligning the grid to the map'),
  autoDetect: gmOnly('a one-time request to align the grid on the first load'),
  // Without a collection, these decide the measurement players get.
  unitType: SENT,
  unitDistance: SENT,
  measurementType: SENT,
  // A scene's own distance per cell, with or without a collection: it is the measurement's `unitDistance` (metric only).
  unitDistanceOverride: SENT,
};

/** Every field of a `SceneSnapshot`, the one view of a scene the API gives. */
export const SCENE_FIELD_COVERAGE: CoverageTable<keyof SceneSnapshot> = {
  background: SENT,
  grid: SENT,
  objects: SENT,
  widgets: SENT,
  initiative: SENT,
  initiativeTrackerOpen: SENT,
  // Passed by the caller as `ProjectionContext.mapSize`; decides the map's width and height.
  mapSize: SENT,
  // The scene's lighting decides, with `lighting.playerVisibility`, which tokens and areas players see; it is never sent.
  lighting: LIGHTING,
  viewId: gmOnly("names the GM's view; players get a scene id of their own"),
  loaded: gmOnly('whether the view has finished loading; nothing is sent about it'),
  mapPath: gmOnly("the vault path of the GM's map file; players get the map's image by its fingerprint"),
};

/** The collection's measurement settings, which decide how the page labels distances (ruler, measure tool). */
export const MEASUREMENT_FIELD_COVERAGE: CoverageTable<keyof CollectionGridDefaults> = {
  unitType: SENT,
  unitDistance: SENT,
  measurementMode: SENT,
  abstractRangeBands: SENT,
  diagonalRule: SENT,
  coneAngle: SENT,
};

/** A scene's lighting options (`SceneLighting`). */
export const SCENE_LIGHTING_COVERAGE: CoverageTable<keyof SceneLighting> = {
  enabled: LIGHTING,
  ambient: LIGHTING,
  ambientColor: LIGHTING_LOOK,
  tokenVision: LIGHTING,
  exploredMemory: LIGHTING,
  exploredColor: LIGHTING_LOOK,
  unexploredColor: LIGHTING_LOOK,
  litThreshold: LIGHTING,
  sightOnDrop: LIGHTING,
  brightThreshold: LIGHTING,
  darkSightLook: LIGHTING_LOOK,
  darkSightTint: LIGHTING_LOOK,
};

/**
 * The resources of the map's collection (`ProjectionContext.resources`, which the broadcaster re-reads when
 * the collection's settings change), which decide the bars and the downed state players see. The window
 * draws no label and no numbers, so what a resource is called and where its maximum comes from stay with the GM.
 */
export const RESOURCE_DEFINITION_COVERAGE: CoverageTable<keyof ResourceDefinition> = {
  key: used('tokens keep their values by key; the key picks which value a bar shows, and `hp` the initiative bar'),
  name: gmOnly('players see a bar, never what it is called'),
  field: gmOnly('the statblock field that supplies the maximum; players see only the share'),
  direction: used('a static value fills its bar, and the direction decides the warning tint and when it is spent'),
  color: SENT,
  defeatedWhenSpent: used('warning tints, the darkened bar and the downed mark'),
  visibleToPlayers: used('decides which resources have a bar'),
  slot: used('decides bar or wheel, and the order of the bars'),
};

export const INITIATIVE_COVERAGE: CoverageTable<keyof InitiativeState> = {
  entries: SENT,
  currentIndex: gmOnly('the cursor of the tracker; players see whose turn it is by isActive on each entry'),
  round: SENT,
  isActive: SENT,
  config: gmOnly('how the tracker of the GM sorts'),
  // Sent only while the window groups the list by sides (`projectSides`); the fight's own mode wins over the collection's rules.
  sides: SENT,
};

export const INITIATIVE_ENTRY_COVERAGE: CoverageTable<keyof InitiativeEntry> = {
  id: SENT,
  tokenId: SENT,
  name: SENT,
  initiative: SENT,
  initiativeModifier: gmOnly('the statblock modifier the GM rolls with'),
  imagePath: gmOnly('players see the image of the token itself, by its id'),
  statblockPath: gmOnly('note links stay on the GM\'s machine'),
  isActive: SENT,
  isNPC: gmOnly('players see every entry alike'),
  order: SENT,
  sitsOut: SENT,
};

/** The collection's initiative rules (`InitiativeRules`), read for the grouping of a list that has not started a fight yet. */
export const INITIATIVE_RULES_COVERAGE: CoverageTable<keyof InitiativeRules> = {
  mode: used('decides whether a list before a fight is grouped by sides; a running fight keeps the mode it started in'),
  firstSide: used('the side listed first before a fight; the first side of the running fight once there is one'),
  roll: gmOnly('the dice the GM rolls initiative with; by sides nothing is rolled, and in turn order players see the numbers'),
};
