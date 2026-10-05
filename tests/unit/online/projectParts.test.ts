import { describe, expect, it } from 'vitest';
import type { AnyWidget, Character, DrawingStroke, FogOperation, InitiativeEntry, ResourceDefinition, TextElement } from '@atlas-vtt/api-types';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { drawingBounds, textBounds, tokenBounds } from '../../../src/app/online/scene/objectBounds';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { pickPlayerViewRules, samePlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { createProjectionMemo, projectDrawings, projectFog, projectFogOp, projectRecord, projectTexts } from '../../../src/app/online/scene/projectRecords';
import { isDrawingRecords, isFogRecords, isPlayerSceneBody } from '../../../src/app/online/scene/sceneValidation';
import { coverageOfFog, createDefaultInitiativeState } from './sceneFixtures';
import { projectInitiative, projectWidgets } from '../../../src/app/online/scene/projectPanels';

const ALL_ON: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
const ALL_OFF: PlayerViewRules = { showGrid: false, showTokenNameplates: false, showWidgets: false, showInitiative: false };

/** The map the fog is checked within (ruling F-POS: parts outside the map prove nothing). */
const MAP = { width: 2000, height: 2000 };
const fogBlock = (x: number, y: number, width: number, height: number): FogCoverage => coverageOfFog({
  f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x, y, width, height },
});

function text(overrides: Partial<TextElement> = {}): TextElement {
  return { id: 'x', kind: 'text', x: 500, y: 500, text: 'Hello', fontSize: 20, fontFamily: 'serif', color: '#111111', ...overrides };
}
function stroke(overrides: Partial<DrawingStroke> = {}): DrawingStroke {
  return {
    id: 'd', kind: 'drawing', timestamp: 3, type: 'pen', color: '#ff0000', width: 4, opacity: 1,
    points: [{ x: 500, y: 500 }, { x: 510, y: 500 }, { x: 520, y: 500 }], ...overrides,
  };
}
function widget(overrides: Partial<AnyWidget> & { id: string }): AnyWidget {
  return { type: 'counter', label: 'Torches', icon: 'flame', visible: true, visibleToPlayers: true, value: 1, order: 0, ...overrides } as AnyWidget;
}
function entry(overrides: Partial<InitiativeEntry> & { id: string; tokenId: string }): InitiativeEntry {
  return {
    name: 'Goblin', initiative: 12, initiativeModifier: 1,
    imagePath: 'atlas-vtt/assets/goblin.png', statblockPath: 'Bestiary/Goblin.md',
    isActive: false, isNPC: true, order: 0, ...overrides,
  };
}

describe('object bounds', () => {
  it('measures token footprints, estimated text boxes and drawings', () => {
    expect(tokenBounds({ x: 100, y: 100, size: 1 }, 70)).toEqual({ x: 65, y: 65, width: 70, height: 70 });
    expect(tokenBounds({ x: 0, y: 0, size: 2 }, 70)).toEqual({ x: -105, y: -105, width: 210, height: 210 });
    expect(textBounds(text({ x: 0, y: 0, padding: 5 }))).toEqual({ x: -55, y: -17.5, width: 110, height: 35 });
    const rotated = textBounds(text({ x: 0, y: 0, rotation: 45 }));
    expect(rotated.width).toBeCloseTo(Math.hypot(100, 25));
    expect(textBounds(text({ x: 0, y: 0, width: 300, backgroundColor: '#fff' })).width).toBe(300 + 16);
    expect(textBounds(text({ x: 0, y: 0, width: 10 })).width).toBe(100);
    expect(drawingBounds({ points: [{ x: 10, y: 10 }, { x: 30, y: 20 }], width: 4 })).toEqual({ x: 6, y: 6, width: 28, height: 18 });
  });
});

describe('player view rules', () => {
  it('keeps the four settings the projection follows (resources follow the collection, not the settings)', () => {
    const settings = { ...ALL_ON, showToolbar: true, showDiceRolls: true, showTokenHP: true } as PlayerViewRules;
    expect(pickPlayerViewRules(settings)).toEqual(ALL_ON);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON })).toBe(true);
    expect(samePlayerViewRules(ALL_ON, { ...ALL_ON, showTokenNameplates: false })).toBe(false);
  });
});

describe('fog projection', () => {
  it('bakes offsets in, simplifies points and keeps erase and order', () => {
    const op: FogOperation = {
      id: 'b', kind: 'fog', type: 'brush', timestamp: 7, isErasing: true, brushRadius: 25, offsetX: 10, offsetY: -5,
      points: Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 })),
    };
    expect(projectFogOp(op)).toEqual({ type: 'brush', erase: true, order: 7, radius: 25, points: [{ x: 10, y: -5 }, { x: 59, y: -5 }] });
    const rect: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 0, y: 0, width: 5, height: 5, offsetX: 3 };
    expect(projectFogOp(rect)).toEqual({ type: 'rectangle', erase: false, order: 1, x: 3, y: 0, width: 5, height: 5 });
  });

  it('drops operations it cannot send and reuses projections of unchanged records', () => {
    const lasso: FogOperation = { id: 'l', kind: 'fog', type: 'lasso', timestamp: 1, isErasing: false, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    const broken: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: Number.NaN, y: 0, width: 5, height: 5 };
    expect(projectFogOp(lasso)).toBeNull();
    expect(projectFogOp(broken)).toBeNull();
    const kept: FogOperation = { id: 'k', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 0, y: 0, width: 5, height: 5 };
    const memo = createProjectionMemo();
    const first = projectFog({ l: lasso, k: kept }, memo);
    expect(Object.keys(first)).toEqual(['k']);
    expect(projectFog({ l: lasso, k: kept }, memo).k).toBe(first.k);
  });
});

describe('text and drawing projection', () => {
  it('drops texts any part of which may be under fog, also those peeking out of it, and keeps those wholly revealed (F-POS)', () => {
    const coverage = fogBlock(0, 0, 1000, 1000).within(MAP);
    const texts = projectTexts({ hidden: text(), peeking: text({ x: 990 }), clear: text({ x: 1500 }) }, coverage);
    expect(Object.keys(texts)).toEqual(['clear']);
  });

  it('fills in values older map files lack', () => {
    const messy = { ...text(), fontSize: undefined, align: 'justify', opacity: '0.5', text: 42 } as unknown as TextElement;
    expect(projectTexts({ messy }, FogCoverage.EMPTY.within(MAP)).messy).toMatchObject({ fontSize: 16, align: 'center', opacity: 0.5, text: '' });
  });

  it('simplifies drawings and drops those completely under fog', () => {
    const memo = createProjectionMemo();
    const clear = projectDrawings({ d: stroke() }, FogCoverage.EMPTY.within(MAP), memo);
    expect(clear.d).toEqual({ type: 'pen', order: 3, points: [{ x: 500, y: 500 }, { x: 520, y: 500 }], color: '#ff0000', width: 4, opacity: 1, icon: null });
    expect(projectDrawings({ d: stroke() }, fogBlock(0, 0, 1000, 1000).within(MAP), memo)).toEqual({});
    const icon = projectDrawings({ i: stroke({ type: 'icon', icon: 'skull', points: [{ x: 5, y: 5 }] }) }, FogCoverage.EMPTY.within(MAP), memo);
    expect(icon.i?.icon).toBe('skull');
  });
});

describe('widget projection', () => {
  const settings = {
    widgets: {
      torches: widget({ id: 'torches', order: 2 }),
      clock: widget({ id: 'clock', type: 'clock', label: 'Doom', segments: 6, order: 1 } as Partial<AnyWidget> & { id: string }),
      timer: widget({ id: 'timer', type: 'timer', label: 'Torch', value: 300, duration: 3600, direction: 'down', order: 3 } as Partial<AnyWidget> & { id: string }),
      secret: widget({ id: 'secret', label: 'Ambush', visibleToPlayers: false }),
      off: widget({ id: 'off', label: 'Off here' }),
    },
    offWidgets: ['off'],
    globalVisible: true,
    position: 'top' as const,
    scale: 1,
  };

  it('lists the visible widgets in order with their current values', () => {
    const widgets = projectWidgets({ widgets: { settings, values: { torches: 4, clock: 2 } } }, ALL_ON);
    expect(widgets).toEqual([
      { id: 'clock', type: 'clock', label: 'Doom', icon: 'flame', value: 2 },
      { id: 'torches', type: 'counter', label: 'Torches', icon: 'flame', value: 4 },
      { id: 'timer', type: 'timer', label: 'Torch', icon: 'flame', value: 300 },
    ]);
  });

  it('sends none when widgets are hidden from players', () => {
    expect(projectWidgets({ widgets: { settings, values: {} } }, ALL_OFF)).toEqual([]);
    expect(projectWidgets({ widgets: { settings: { ...settings, globalVisible: false }, values: {} } }, ALL_ON)).toEqual([]);
  });
});

describe('initiative projection', () => {
  const initiative = {
    ...createDefaultInitiativeState(),
    isActive: true,
    round: 3,
    entries: [
      entry({ id: 'e2', tokenId: 'orc', name: 'Orc', order: 1, isActive: true }),
      entry({ id: 'e1', tokenId: 'goblin', order: 0 }),
      entry({ id: 'e3', tokenId: 'hidden-lich', name: 'Lich', order: 2 }),
    ],
  };
  const visible = new Set(['goblin', 'orc']);

  const goblin = { id: 'goblin', kind: 'character', x: 0, y: 0, imagePath: '', resources: { hp: { current: 5, max: 7 } } } as unknown as Character;
  const orc = { ...goblin, id: 'orc', resources: { hp: { current: 7, max: 7 } } } as Character;
  const objects = { tokens: { goblin, orc }, fog: {}, texts: {}, drawings: {} };
  const hp = (visibleToPlayers: boolean): ResourceDefinition[] => [
    { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers },
  ];

  it('lists entries of visible tokens with names, and the HP bar as the collection shows it', () => {
    const state = { initiative, initiativeTrackerOpen: true, objects };
    const projected = projectInitiative(state, visible, ALL_ON, hp(true));
    expect(projected).toEqual({
      round: 3, active: true,
      entries: [
        { id: 'e1', tokenId: 'goblin', initiative: 12, name: 'Goblin', hp: null, hpShare: 0.71, isActive: false },
        { id: 'e2', tokenId: 'orc', initiative: 12, name: 'Orc', hp: null, hpShare: 1, isActive: true },
      ],
    });
    expect(JSON.stringify(projected)).not.toMatch(/stress|statblock|imagePath|Lich/);
    const plain = projectInitiative(state, visible, { ...ALL_ON, showTokenNameplates: false }, hp(true));
    expect(plain?.entries[0]).toMatchObject({ name: null, hpShare: 0.71 });
  });

  it('draws no bar where players do not see HP: hidden, not defined, or a token without it', () => {
    const state = { initiative, initiativeTrackerOpen: true, objects };
    for (const definitions of [hp(false), [], hp(true).map((definition) => ({ ...definition, key: 'health' }))]) {
      expect(projectInitiative(state, visible, ALL_ON, definitions)?.entries.map((line) => line.hpShare)).toEqual([null, null]);
    }
    const bare = { ...state, objects: { ...objects, tokens: { goblin: { ...goblin, resources: { hp: { current: 5, max: 0 } } }, orc: { ...orc, resources: undefined } } } };
    expect(projectInitiative(bare as never, visible, ALL_ON, hp(true))?.entries.map((line) => line.hpShare)).toEqual([null, null]);
  });

  it('sends no tracker when it is closed or hidden, and no turn outside combat', () => {
    expect(projectInitiative({ initiative, initiativeTrackerOpen: false }, visible, ALL_ON)).toBeNull();
    expect(projectInitiative({ initiative, initiativeTrackerOpen: true }, visible, ALL_OFF)).toBeNull();
    const idle = projectInitiative({ initiative: { ...initiative, isActive: false }, initiativeTrackerOpen: true }, visible, ALL_ON);
    expect(idle?.entries.every((line) => !line.isActive)).toBe(true);
  });
});

describe('wire ranges', () => {
  it('projects out-of-range values to ones the player validator accepts', () => {
    const wild = text({ x: 1e12, y: -1e12, fontSize: 5000, width: 1e9, height: 1e9, padding: 1e9, borderRadius: 1e9, scale: 1e6 });
    const texts = projectTexts({ wild }, FogCoverage.EMPTY.within(MAP));
    const drawings = projectDrawings(
      { d: stroke({ width: 1e9, points: [{ x: 1e12, y: 0 }, { x: 5, y: -1e12 }] }) }, FogCoverage.EMPTY.within(MAP), createProjectionMemo(),
    );
    const big: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 1e12, y: 0, width: 1e9 * 1e9, height: 5, offsetX: 1e12 };
    const brush: FogOperation = {
      id: 'b', kind: 'fog', type: 'brush', timestamp: 2, isErasing: false, brushRadius: 1e9, points: [{ x: 1e12, y: 0 }],
    };
    const fog = projectFog({ r: big, b: brush }, createProjectionMemo());
    expect(Object.keys(fog)).toEqual(['r', 'b']);
    expect(isPlayerSceneBody({
      sceneId: 's', map: { asset: null, width: 10, height: 10, cellSize: 70 }, grid: null, widgets: [], initiative: null, measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true }, tokens: {}, texts,
    })).toBe(true);
    expect(isDrawingRecords(drawings)).toBe(true);
    expect(isFogRecords(fog)).toBe(true);
  });
});

describe('fog rectangle clamping', () => {
  it('clamps edges, so the sent area keeps what lies inside the coordinate range', () => {
    const op: FogOperation = { id: 'r', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: -2e7, y: 0, width: 3e7, height: 10 };
    const sent = projectFogOp(op);
    expect(sent).toMatchObject({ x: -1e7, width: 1e7 });
    const flipped = projectFogOp({ ...op, x: 100, y: 50, width: -40, height: -10 });
    expect(flipped).toMatchObject({ x: 60, y: 40, width: 40, height: 10 });
    expect(projectFogOp({ ...op, x: 1e308, width: 1e308 })).toBeNull();
  });
});

describe('projectRecord keys', () => {
  it('skips prototype-polluting ids from parsed JSON', () => {
    const parsed = JSON.parse('{"__proto__":{"a":1},"constructor":{"a":2},"ok":{"a":3}}') as Record<string, { a: number }>;
    const result = projectRecord(parsed, (record) => record.a);
    expect(Object.keys(result)).toEqual(['ok']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('coverage from the fog players receive', () => {
  it('matches the projected set even when projection clamps or drops operations', () => {
    const huge: FogOperation = { id: 'a', kind: 'fog', type: 'brush', timestamp: 1, isErasing: false, brushRadius: 50000, points: [{ x: 0, y: 0 }] };
    const fog = { a: huge, ['long-id-'.repeat(40)]: huge };
    const sent = projectFog(fog, createProjectionMemo());
    expect(Object.keys(sent)).toEqual(['a']);
    expect(sent.a).toMatchObject({ radius: 10000 });
    const coverage = FogCoverage.fromPlayerFog(sent);
    const at = (x: number): boolean => coverage.isCovered({ x, y: 0, width: 10, height: 10 });
    expect(at(0)).toBe(true);
    expect(at(9000)).toBe(true);
    expect(at(20000)).toBe(false);
  });
});
