import { describe, expect, it } from 'vitest';
import {
  DRAWING_FIELD_COVERAGE, FOG_FIELD_COVERAGE, GRID_FIELD_COVERAGE, INITIATIVE_COVERAGE, INITIATIVE_ENTRY_COVERAGE, INITIATIVE_RULES_COVERAGE, MEASUREMENT_FIELD_COVERAGE,
  OBJECT_COVERAGE, RESOURCE_DEFINITION_COVERAGE, SCENE_FIELD_COVERAGE, TEXT_FIELD_COVERAGE, TOKEN_FIELD_COVERAGE, type CoverageTable, type KeysOfUnion,
} from '../../../src/app/online/coverage';
import { createProjectionMemo, projectDrawings, projectFog, projectTexts } from '../../../src/app/online/scene/projectRecords';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import type { AnyWidget, Character, CollectionGridDefaults, DrawingStroke, FogBrushStroke, FogOperation, FogRectangleFill, GridState, InitiativeEntry, InitiativeRules, InitiativeState, ResourceDefinition, SceneSnapshot, TextElement } from '@atlas-vtt/api-types';
import { coverageOfFog, createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

type Variants<K extends PropertyKey, T> = Record<K, (base: T) => T>;

/** A `sent` or `used` field changes the projection; a `lighting`, `gm-only` or `not-yet` field never does without lighting (`lightingCoverage.test.ts`). */
function expectCoverage<K extends string, T>(table: CoverageTable<K>, variants: Variants<K, T>, base: T, project: (value: T) => unknown): void {
  expect(Object.keys(variants).sort()).toEqual(Object.keys(table).sort());
  const before = project(base);
  for (const key of Object.keys(table) as K[]) {
    const after = project(variants[key](base));
    if (table[key].status === 'sent' || table[key].status === 'used') expect(after, `${key} is marked sent`).not.toEqual(before);
    else expect(after, `${key} is marked ${table[key].status}`).toEqual(before);
  }
}

const RULES: PlayerViewRules = {
  showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true,
};
// One id per path for the whole file, so a changed image path always gets a different id.
const assets = fakeAssetIds();
/** The collection's resources: HP defeats the token and shows in the first socket, stress fills in the second; players see both. */
const DEFINITIONS: readonly ResourceDefinition[] = [
  { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true, slot: 0 },
  { key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', color: '#a855f7', visibleToPlayers: true, slot: 1 },
];
const project = (state: SceneSnapshot, resources: readonly ResourceDefinition[] = DEFINITIONS, initiativeRules?: InitiativeRules): unknown => projectForPlayers(state, {
  sceneId: 'scene-1', rules: RULES, coverage: coverageOfFog({}), assets, mapSize: state.mapSize,
  resources, ...(initiativeRules && { initiativeRules }),
});

const TOKEN: Character = {
  id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: '', size: 1, rotation: 0, layer: 0,
  showRing: true, ringColor: '#ff0000', conditions: ['frightened'], conditionValues: { frightened: 2 }, isHidden: false,
  resources: { hp: { current: 2, max: 10 }, stress: { current: 2, max: 6 } }, overriddenMax: ['hp'],
  difficulty: '3', notePath: 'notes/hero.md', statblockPath: 'statblocks/hero.md', statblockName: 'Hero',
  playerLinked: false, playerId: 'p1', playerCharacterId: 'c1', side: 'players',
  tags: ['party'], vision: { enabled: true, range: 200 }, showNameplate: false, instanceNumber: 1,
  light: { bright: 20, dim: 40, color: '#ffcc88', intensity: 1, animation: 'none' },
};
const TEXT: TextElement = {
  id: 'tx', kind: 'text', x: 50, y: 50, text: 'Tavern', fontSize: 24, fontFamily: 'serif', color: '#000000',
  backgroundColor: '#ffffff', padding: 4, borderRadius: 2, opacity: 0.8, width: 120, height: 40, align: 'left',
  bold: false, italic: false, rotation: 0, scale: 1,
};
const DRAWING: DrawingStroke = {
  id: 'd1', kind: 'drawing', timestamp: 2, type: 'icon', points: [{ x: 10, y: 10 }], color: '#ff0000', width: 70, opacity: 1, icon: 'flame',
};
const GRID: GridState = {
  enabled: true, visible: true, type: 'hex-vertical', size: 70, offsetX: 0, offsetY: 0, color: '#000000', opacity: 0.5,
  lineType: 'solid', lineWidth: 1, cellNumbers: 'column-row', cellNumberOpacity: 0.8, snapToGrid: true, scale: 1, mapScale: 1,
  unitType: 'feet', unitDistance: 5, measurementType: 'units', autoDetect: false,
};
const COUNTER = { id: 'w1', type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0 } as AnyWidget;
const ENTRY: InitiativeEntry = {
  id: 'e1', tokenId: 'hero', name: 'Hero', initiative: 15, initiativeModifier: 1, imagePath: 'art/hero.png', statblockPath: 'statblocks/hero.md',
  isActive: true, isNPC: false, order: 0,
};

function sceneState(overrides: Partial<SceneSnapshot> = {}): SceneSnapshot {
  return snapshotOf({
    background: 'maps/tavern.png',
    grid: GRID,
    objects: { tokens: { hero: TOKEN }, fog: {}, texts: { tx: TEXT }, drawings: { d1: DRAWING } },
    widgets: { settings: { widgets: { w1: COUNTER }, globalVisible: true, position: 'top', scale: 1 }, values: { w1: 3 } },
    initiative: { ...createDefaultInitiativeState(), isActive: true, round: 2, entries: [ENTRY] },
    initiativeTrackerOpen: true,
    ...overrides,
  });
}

/** The token in a fight by sides, since only then does the window file a combatant under a side. */
const withToken = (token: Character): SceneSnapshot => {
  const base = sceneState();
  return {
    ...base, objects: { ...base.objects, tokens: { [token.id]: token } },
    initiative: { ...base.initiative, sides: { first: 'players', active: 'players' } },
  };
};

describe('coverage of map objects', () => {
  type Objects = SceneSnapshot['objects'];
  const add = (kind: keyof Objects, record: unknown) => (state: SceneSnapshot): SceneSnapshot => ({
    ...state, objects: { ...state.objects, [kind]: { ...state.objects[kind], extra: record } },
  });
  it('sends every kind marked sent and nothing of the others', () => {
    const variants: Variants<keyof Objects, SceneSnapshot> = {
      tokens: add('tokens', { ...TOKEN, id: 'extra', x: 400 }),
      fog: add('fog', { id: 'extra', kind: 'fog', type: 'rectangle', timestamp: 9, isErasing: false, x: 0, y: 0, width: 5, height: 5 }),
      texts: add('texts', { ...TEXT, id: 'extra' }),
      drawings: add('drawings', { ...DRAWING, id: 'extra' }),
    };
    expectCoverage(OBJECT_COVERAGE, variants, sceneState(), project);
  });
});

describe('coverage of token fields', () => {
  it('sends every field marked sent and nothing of the others', () => {
    const set = (patch: Partial<Character>) => (token: Character): Character => ({ ...token, ...patch });
    const variants: Variants<keyof Character, Character> = {
      id: set({ id: 'hero-2' }), kind: (token) => ({ ...token, kind: 'token' }) as unknown as Character,
      x: set({ x: 300 }), y: set({ y: 300 }), imagePath: set({ imagePath: 'art/other.png' }), size: set({ size: 2 }),
      rotation: set({ rotation: 45 }), layer: set({ layer: 3 }), showRing: set({ showRing: false }), ringColor: set({ ringColor: '#00ff00' }),
      conditions: set({ conditions: ['prone'] }), conditionValues: set({ conditionValues: { frightened: 3 } }),
      isHidden: set({ isHidden: true }), name: set({ name: 'Bob' }),
      statblockPath: ({ statblockPath: _path, ...token }) => token, statblockName: set({ statblockName: 'Orc' }),
      resources: set({ resources: { hp: { current: 3, max: 10 } } }), overriddenMax: set({ overriddenMax: [] }),
      showNameplate: set({ showNameplate: true }), tags: set({ tags: ['secret'] }), notePath: set({ notePath: 'notes/other.md' }),
      difficulty: set({ difficulty: '5' }), side: set({ side: 'opponents' }),
      playerLinked: set({ playerLinked: true }), playerId: set({ playerId: 'p2' }), playerCharacterId: set({ playerCharacterId: 'c2' }),
      vision: set({ vision: { enabled: false } }), light: ({ light: _light, ...token }) => token,
      instanceNumber: set({ instanceNumber: 2 }),
    };
    expectCoverage(TOKEN_FIELD_COVERAGE, variants, TOKEN, (token) => project(withToken(token)));
  });
});

describe('coverage of the collection resources', () => {
  it('sends every definition field marked sent and nothing of the others', () => {
    // HP is nearly spent (red, whatever its colour, as it defeats the token); stress shows its own colour
    const set = (index: number, patch: Partial<ResourceDefinition>) => (defs: readonly ResourceDefinition[]): readonly ResourceDefinition[] =>
      defs.map((definition, at) => (at === index ? { ...definition, ...patch } : definition));
    const variants: Variants<keyof ResourceDefinition, readonly ResourceDefinition[]> = {
      key: set(0, { key: 'health' }), name: set(0, { name: 'Hit points' }), field: set(0, { field: 'stats.0' }),
      direction: set(0, { direction: 'static' }), color: set(1, { color: '#3b82f6' }),
      defeatedWhenSpent: set(0, { defeatedWhenSpent: false }), visibleToPlayers: set(0, { visibleToPlayers: false }), slot: set(0, { slot: 3 }),
    };
    expectCoverage(RESOURCE_DEFINITION_COVERAGE, variants, DEFINITIONS, (defs) => project(sceneState(), defs));
  });
});

describe('coverage of text, drawing and fog fields', () => {
  it('sends every text field marked sent', () => {
    const set = (patch: Partial<TextElement>) => (text: TextElement): TextElement => ({ ...text, ...patch });
    const variants: Variants<keyof TextElement, TextElement> = {
      id: set({ id: 'tx-2' }), kind: (text) => ({ ...text, kind: 'other' }) as unknown as TextElement,
      x: set({ x: 60 }), y: set({ y: 60 }), rotation: set({ rotation: 30 }), text: set({ text: 'Inn' }), fontSize: set({ fontSize: 30 }),
      fontFamily: set({ fontFamily: 'sans-serif' }), color: set({ color: '#ff0000' }), backgroundColor: set({ backgroundColor: '#000000' }),
      padding: set({ padding: 6 }), borderRadius: set({ borderRadius: 4 }), opacity: set({ opacity: 0.5 }), width: set({ width: 200 }),
      height: set({ height: 60 }), align: set({ align: 'right' }), bold: set({ bold: true }), italic: set({ italic: true }), scale: set({ scale: 2 }),
    };
    expectCoverage(TEXT_FIELD_COVERAGE, variants, TEXT, (text) => projectTexts({ [text.id]: text }, coverageOfFog({}).within({ width: 1000, height: 1000 })));
  });

  it('sends every drawing field marked sent', () => {
    const set = (patch: Partial<DrawingStroke>) => (drawing: DrawingStroke): DrawingStroke => ({ ...drawing, ...patch });
    const variants: Variants<keyof DrawingStroke, DrawingStroke> = {
      id: set({ id: 'd2' }), kind: (drawing) => ({ ...drawing, kind: 'other' }) as unknown as DrawingStroke,
      color: set({ color: '#00ff00' }), opacity: set({ opacity: 0.5 }), width: set({ width: 80 }), timestamp: set({ timestamp: 3 }),
      type: set({ type: 'pen' }), points: set({ points: [{ x: 20, y: 20 }] }), icon: set({ icon: 'skull' }),
    };
    expectCoverage(DRAWING_FIELD_COVERAGE, variants, DRAWING, (drawing) =>
      projectDrawings({ [drawing.id]: drawing }, coverageOfFog({}).within({ width: 1000, height: 1000 }), createProjectionMemo()));
  });

  it('sends every fog field marked sent', () => {
    interface FogPair { brush: FogBrushStroke; rect: FogRectangleFill }
    const base: FogPair = {
      brush: {
        id: 'b', kind: 'fog', type: 'brush', timestamp: 1, isErasing: false, brushRadius: 20,
        points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], offsetX: 0, offsetY: 0,
      },
      rect: { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 100, y: 100, width: 50, height: 50, offsetX: 0, offsetY: 0 },
    };
    const brush = (patch: object) => (pair: FogPair): FogPair => ({ ...pair, brush: { ...pair.brush, ...patch } as FogBrushStroke });
    const rect = (patch: Partial<FogRectangleFill>) => (pair: FogPair): FogPair => ({ ...pair, rect: { ...pair.rect, ...patch } });
    const variants: Variants<KeysOfUnion<FogOperation>, FogPair> = {
      id: brush({ id: 'b2' }), kind: brush({ kind: 'other' }), timestamp: brush({ timestamp: 5 }), type: brush({ type: 'lasso' }),
      isErasing: brush({ isErasing: true }), offsetX: brush({ offsetX: 5 }), offsetY: brush({ offsetY: 5 }),
      points: brush({ points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }] }), brushRadius: brush({ brushRadius: 30 }),
      x: rect({ x: 110 }), y: rect({ y: 110 }), width: rect({ width: 60 }), height: rect({ height: 60 }),
    };
    expectCoverage(FOG_FIELD_COVERAGE, variants, base, (pair) =>
      projectFog({ [pair.brush.id]: pair.brush, [pair.rect.id]: pair.rect }, createProjectionMemo()));
  });
});

describe('coverage of grid and scene fields', () => {
  it('sends every grid field marked sent', () => {
    const set = (patch: Partial<GridState>) => (grid: GridState): GridState => ({ ...grid, ...patch });
    const variants: Variants<keyof GridState, GridState> = {
      enabled: set({ enabled: false }), visible: set({ visible: false }), type: set({ type: 'square' }), size: set({ size: 80 }),
      offsetX: set({ offsetX: 5 }), offsetY: set({ offsetY: 5 }), color: set({ color: '#ff0000' }), opacity: set({ opacity: 0.3 }),
      lineType: set({ lineType: 'dashed' }), lineWidth: set({ lineWidth: 3 }), cellNumbers: set({ cellNumbers: 'letter-number' }),
      cellNumberOpacity: set({ cellNumberOpacity: 0.2 }), snapToGrid: set({ snapToGrid: false }), scale: set({ scale: 2 }),
      mapScale: set({ mapScale: 2 }), unitType: set({ unitType: 'meters' }), unitDistance: set({ unitDistance: 10 }),
      measurementType: set({ measurementType: 'abstract' }), autoDetect: set({ autoDetect: true }),
      unitDistanceOverride: set({ unitDistanceOverride: 10 }),
    };
    expectCoverage(GRID_FIELD_COVERAGE, variants, GRID, (grid) => project(sceneState({ grid })));
  });

  it('sends every field of the snapshot marked sent', () => {
    const variants: Variants<keyof SceneSnapshot, SceneSnapshot> = {
      background: (state) => ({ ...state, background: 'maps/other.png' }),
      grid: (state) => ({ ...state, grid: { ...GRID, size: 80 } }),
      objects: (state) => ({ ...state, objects: { ...state.objects, tokens: {} } }),
      widgets: (state) => ({ ...state, widgets: { settings: { ...state.widgets.settings, globalVisible: false }, values: { w1: 7 } } }),
      initiative: (state) => ({ ...state, initiative: { ...state.initiative, round: 3 } }),
      initiativeTrackerOpen: (state) => ({ ...state, initiativeTrackerOpen: false }),
      mapSize: (state) => ({ ...state, mapSize: { width: 1200, height: 900 } }),
      // A scene saved lit fails closed on its own (`projectLitClosed.test.ts`); with lighting off its look changes nothing.
      lighting: (state) => ({ ...state, lighting: { ...state.lighting, ambient: 0.1 } }),
      viewId: (state) => ({ ...state, viewId: 'view-2' }),
      loaded: (state) => ({ ...state, loaded: false }),
      mapPath: (state) => ({ ...state, mapPath: 'maps/other.atlasmap' }),
    };
    expectCoverage(SCENE_FIELD_COVERAGE, variants, sceneState(), project);
  });
});

describe('coverage of the measurement', () => {
  it("sends every grid default of the map's collection", () => {
    const base: CollectionGridDefaults = {
      unitType: 'feet', unitDistance: 5, measurementMode: 'abstract',
      abstractRangeBands: [{ name: 'Close', maxSquares: 1 }], diagonalRule: 'equidistant',
    };
    const set = (patch: Partial<CollectionGridDefaults>) => (defaults: CollectionGridDefaults): CollectionGridDefaults => ({ ...defaults, ...patch });
    const variants: Variants<keyof CollectionGridDefaults, CollectionGridDefaults> = {
      unitType: set({ unitType: 'meters' }), unitDistance: set({ unitDistance: 10 }), measurementMode: set({ measurementMode: 'metric' }),
      abstractRangeBands: set({ abstractRangeBands: [{ name: 'Far', maxSquares: 6 }] }), diagonalRule: set({ diagonalRule: 'alternating' }),
      coneAngle: set({ coneAngle: 60 }),
    };
    expectCoverage(MEASUREMENT_FIELD_COVERAGE, variants, base, (collectionGrid) => projectForPlayers(sceneState(), {
      sceneId: 'scene-1', rules: RULES, coverage: coverageOfFog({}), assets, mapSize: { width: 1000, height: 800 },
      collectionGrid,
    }).measurement);
  });
});

describe('coverage of the initiative', () => {
  const withInitiative = (initiative: InitiativeState): SceneSnapshot => sceneState({ initiative });
  const base = sceneState().initiative;

  it('sends every field of the tracker marked sent', () => {
    const set = (patch: Partial<InitiativeState>) => (state: InitiativeState): InitiativeState => ({ ...state, ...patch });
    const variants: Variants<keyof InitiativeState, InitiativeState> = {
      entries: set({ entries: [] }), currentIndex: set({ currentIndex: 3 }), round: set({ round: 5 }), isActive: set({ isActive: false }),
      config: set({ config: { autoSort: false } }), sides: set({ sides: { first: 'opponents', active: 'players' } }),
    };
    expectCoverage(INITIATIVE_COVERAGE, variants, base, (initiative) => project(withInitiative(initiative)));
  });

  it('sends every field of an entry marked sent', () => {
    const second: InitiativeEntry = { ...ENTRY, id: 'e2', initiative: 9, isActive: false, order: 1 };
    const set = (patch: Partial<InitiativeEntry>) => (entry: InitiativeEntry): InitiativeEntry => ({ ...entry, ...patch });
    const variants: Variants<keyof InitiativeEntry, InitiativeEntry> = {
      id: set({ id: 'e9' }), tokenId: set({ tokenId: 'gone' }), name: set({ name: 'Bob' }), initiative: set({ initiative: 3 }),
      initiativeModifier: set({ initiativeModifier: 4 }), imagePath: set({ imagePath: 'art/other.png' }),
      statblockPath: set({ statblockPath: 'statblocks/other.md' }), isActive: set({ isActive: false }), isNPC: set({ isNPC: true }),
      order: set({ order: 2 }), sitsOut: set({ sitsOut: true }),
    };
    expectCoverage(INITIATIVE_ENTRY_COVERAGE, variants, ENTRY, (entry) => project(withInitiative({ ...base, entries: [entry, second] })));
  });
});

describe('coverage of the initiative rules', () => {
  it("sends what the collection's rules decide before a fight, and nothing of the roll", () => {
    const base: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players' };
    const set = (patch: Partial<InitiativeRules>) => (rules: InitiativeRules): InitiativeRules => ({ ...rules, ...patch });
    const variants: Variants<keyof InitiativeRules, InitiativeRules> = {
      mode: set({ mode: 'turn-order' }), firstSide: set({ firstSide: 'opponents' }), roll: set({ roll: '2d6' }),
    };
    // No fight is running, so the collection's rules decide the list
    const idle = sceneState({ initiative: { ...createDefaultInitiativeState(), entries: [ENTRY] } });
    expectCoverage(INITIATIVE_RULES_COVERAGE, variants, base, (rules) => project(idle, DEFINITIONS, rules));
  });
});
