/** The remote view converter's round trips for `convertCoverage.test.ts`: the GM's snapshot, projected, then converted. */
import type {
  AnyWidget, Character, CollectionGridDefaults, DrawingStroke, FogOperation, GridState, InitiativeEntry, InitiativeRules,
  RemotePlayerState, RemoteSceneInput, ResourceDefinition, SceneSnapshot, TextElement, Token,
} from '@atlas-vtt/api-types';
import type { RemoteImages } from '../../../../src/app/online/obsidian/onlineJoinTypes';
import { RemoteSceneMemo, remotePlayerState } from '../../../../src/app/online/obsidian/remote/toRemoteScene';
import type { PlayerScene } from '../../../../src/app/online/scene/sceneTypes';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from '../sceneFixtures';

export const IMAGES: RemoteImages = {
  background: (id) => (id ? `blob:map/${id}` : null),
  token: (id) => (id ? `blob:token/${id}` : null),
};

const hero: Character = {
  id: 'hero', kind: 'character', x: 140, y: 210, imagePath: 'art/hero.png', size: 2, rotation: 45, layer: 3,
  showRing: true, ringColor: '#3366ff', conditions: ['prone', 'frightened'], conditionValues: { frightened: 2 },
  name: 'Anna', resources: { hp: { current: 7, max: 10 }, stress: { current: 2, max: 6 }, mana: { current: 1, max: 2 } }, side: 'players',
  statblockPath: 'Bestiary/Anna.md', statblockName: 'Anna (statblock)', notePath: 'GM/anna.md', tags: ['pc'],
  overriddenMax: ['hp'], difficulty: '3', playerLinked: true, playerId: 'p1', playerCharacterId: 'c1', showNameplate: false, instanceNumber: 2,
  vision: { enabled: true, range: 200 }, light: { bright: 20, dim: 40, color: '#ffcc88', intensity: 1, animation: 'none' },
};
const goblin: Character = { id: 'goblin', kind: 'character', x: 350, y: 70, imagePath: 'art/goblin.png', name: '', statblockPath: 'Bestiary/Goblin.md', statblockName: 'Goblin' };
const imp: Character = { id: 'imp', kind: 'character', x: 560, y: 70, imagePath: 'art/imp.png', name: '', statblockPath: 'Bestiary/Imp.md' };
const crate: Token = { id: 'crate', kind: 'token', x: 420, y: 70, imagePath: 'art/crate.png', showRing: false };
const fallen: Character = { id: 'fallen', kind: 'character', x: 630, y: 70, imagePath: 'art/fallen.png', name: 'Fallen', resources: { hp: { current: 0, max: 10 } } };
const ghoul: Character = { id: 'ghoul', kind: 'character', x: 700, y: 70, imagePath: 'art/ghoul.png', name: 'Ghoul', resources: { doom: { current: 0, max: 5 } } };
const spy: Character = { id: 'spy', kind: 'character', x: 490, y: 70, imagePath: 'art/spy.png', name: 'Spy', isHidden: true };

export const sign: TextElement = {
  id: 'sign', kind: 'text', x: 50, y: 60, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#112233',
  backgroundColor: '#ffffff', padding: 4, borderRadius: 2, opacity: 0.9, width: 120, height: 40, align: 'left',
  bold: true, italic: true, rotation: 10, scale: 1.5,
};
export const line: DrawingStroke = { id: 'line', kind: 'drawing', timestamp: 5, type: 'line', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 30, y: 90 }], color: '#ff0000', width: 4, opacity: 0.8 };
const stamp: DrawingStroke = { id: 'stamp', kind: 'drawing', timestamp: 6, type: 'icon', points: [{ x: 200, y: 200 }], color: '#00ff00', width: 40, opacity: 1, icon: 'skull' };
const brush: FogOperation = {
  id: 'brush', kind: 'fog', type: 'brush', timestamp: 1, isErasing: true, offsetX: 10, offsetY: 20, brushRadius: 30,
  points: [{ x: 100, y: 100 }, { x: 200, y: 150 }, { x: 120, y: 260 }],
};
const lasso: FogOperation = { id: 'lasso', kind: 'fog', type: 'lasso', timestamp: 2, isErasing: true, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }] };
// Painted far from everything, so it hides nothing the checks look at.
const rect: FogOperation = { id: 'rect', kind: 'fog', type: 'rectangle', timestamp: 3, isErasing: false, x: 2000, y: 2000, width: 100, height: 50 };

const DEFINITIONS: readonly ResourceDefinition[] = [
  { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true, slot: 0 },
  { key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', color: '#a855f7', visibleToPlayers: true, slot: 1 },
  { key: 'mana', name: 'Mana', field: 'mana', direction: 'drains', color: '#3b82f6', visibleToPlayers: true, slot: 2 },
  { key: 'doom', name: 'Doom', field: 'doom', direction: 'drains', color: '#111111', defeatedWhenSpent: true, visibleToPlayers: false, slot: 3 },
];
const GM_GRID: GridState = {
  enabled: true, visible: true, snapToGrid: false, type: 'hex-vertical', size: 70, offsetX: 5, offsetY: 7, color: '#222222',
  opacity: 0.4, lineType: 'dashed', lineWidth: 2, cellNumbers: 'letter-number', cellNumberOpacity: 0.6,
  unitType: 'meters', unitDistance: 1.5, measurementType: 'units', scale: 1, mapScale: 1, autoDetect: false,
};
const COLLECTION: CollectionGridDefaults = {
  unitType: 'yards', unitDistance: 2, measurementMode: 'abstract', abstractRangeBands: [{ name: 'Close', maxSquares: 2 }], diagonalRule: 'alternating', coneAngle: 53.13,
};
const WIDGETS: Record<string, AnyWidget> = {
  torches: { id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 0, order: 0 },
  doom: { id: 'doom', type: 'clock', label: 'Doom', icon: 'skull', visible: true, visibleToPlayers: true, value: 0, order: 1, segments: 6 },
  fuse: { id: 'fuse', type: 'timer', label: 'Fuse', icon: 'hourglass', visible: true, visibleToPlayers: true, value: 90, order: 2, duration: 120, direction: 'down' },
  secret: { id: 'secret', type: 'counter', label: 'Secret', icon: 'star', visible: true, visibleToPlayers: false, value: 1, order: 3 },
};
const ENTRY: InitiativeEntry = {
  id: 'e1', tokenId: 'hero', name: 'Anna', initiative: 17, initiativeModifier: 2, imagePath: 'art/hero.png', isActive: true, isNPC: false, order: 0,
  statblockPath: 'Bestiary/Anna.md',
};
const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'opponents' };

interface Variant {
  collection?: CollectionGridDefaults | null; grid?: GridState; trackerOpen?: boolean; definitions?: readonly ResourceDefinition[];
  /** A fight by sides: the side whose turn it is. */
  sides?: 'players' | 'opponents';
  rules?: InitiativeRules; active?: boolean; sitsOut?: boolean;
}
export interface Trip { input: RemoteSceneInput; player: RemotePlayerState; sent: PlayerScene }
export type TripName = 'full' | 'noCollection' | 'disabledGrid' | 'hiddenGrid' | 'closedTracker' | 'renamedHp' | 'staticHp' | 'sidesFight' | 'sidesBefore' | 'sitsOut' | 'ownDistance';
export type Trips = Record<TripName, Trip>;

function trip({ collection = COLLECTION, grid = GM_GRID, trackerOpen = true, definitions = DEFINITIONS, sides, rules, active = true, sitsOut }: Variant = {}): Trip {
  const fog = { brush, lasso, rect };
  const snapshot: SceneSnapshot = snapshotOf({
    background: 'atlas-vtt/assets/tavern.png',
    grid,
    objects: { tokens: { hero, goblin, imp, crate, fallen, ghoul, spy }, fog, texts: { sign }, drawings: { line, stamp } },
    widgets: { settings: { widgets: WIDGETS, globalVisible: true, position: 'top', scale: 1 }, values: { torches: 3, doom: 2 } },
    initiative: {
      ...createDefaultInitiativeState(), isActive: active, round: 2, ...(sides && { sides: { first: 'opponents' as const, active: sides } }),
      entries: [{ ...ENTRY, ...(sitsOut && { sitsOut: true }) }],
    },
    initiativeTrackerOpen: trackerOpen,
  });
  const sent = projectForPlayers(snapshot, {
    sceneId: 'scene-1', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
    coverage: coverageOfFog(fog), assets: fakeAssetIds(), mapSize: { width: 1000, height: 800 },
    collectionGrid: collection, resources: definitions, ...(rules && { initiativeRules: rules }),
  });
  return { input: new RemoteSceneMemo().input(sent, IMAGES), player: remotePlayerState(sent, []), sent };
}

export const TRIPS: Trips = {
  full: trip(),
  noCollection: trip({ collection: null }),
  disabledGrid: trip({ grid: { ...GM_GRID, enabled: false } }),
  hiddenGrid: trip({ grid: { ...GM_GRID, visible: false } }),
  closedTracker: trip({ trackerOpen: false }),
  renamedHp: trip({ definitions: DEFINITIONS.map((definition) => (definition.key === 'hp' ? { ...definition, key: 'health' } : definition)) }),
  staticHp: trip({ definitions: DEFINITIONS.map((definition) => (definition.key === 'hp' ? { ...definition, direction: 'static' as const } : definition)) }),
  sidesFight: trip({ sides: 'players' }),
  sidesBefore: trip({ rules: SIDES, active: false }),
  sitsOut: trip({ sitsOut: true }),
  // A scene measured at its own distance per cell, in a metric collection (range bands ignore it).
  ownDistance: trip({ collection: { ...COLLECTION, measurementMode: 'metric' }, grid: { ...GM_GRID, unitDistanceOverride: 3 } }),
};
