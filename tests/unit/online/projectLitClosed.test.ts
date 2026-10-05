import { describe, expect, it } from 'vitest';
import type { Character, DrawingStroke, SceneSnapshot, TextElement } from '@atlas-vtt/api-types';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { closedFrame, rasterFrame, type LightingFrame } from '../../../src/app/online/scene/lightingFrame';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * A scene saved lit fails closed in the projection itself, whatever the caller passes: without a lighting
 * frame, or with a closed one, players get the dark map and nothing else; with an open frame, what lies in
 * the dark, or wholly past the map's edge, is left out, and an item crossing the edge is checked by its part inside.
 */
const MAP = { width: 1000, height: 800 };
const RULES = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };

const hero = { id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: 'Hero', size: 1 } as Character;
const text = (id: string, x: number, y: number): TextElement => ({
  id, kind: 'text', x, y, text: 'SECRET', fontSize: 16, fontFamily: 'serif', color: '#000000', width: 40, height: 20,
} as TextElement);
const stroke = (id: string, points: Array<{ x: number; y: number }>): DrawingStroke => ({
  id, kind: 'drawing', timestamp: 1, type: 'line', points, color: '#ff0000', width: 4, opacity: 1,
} as DrawingStroke);

function snapshot(lit: boolean): SceneSnapshot {
  return snapshotOf({
    background: 'maps/lair.png',
    lighting: { enabled: lit, ambient: 0 },
    objects: {
      tokens: { hero },
      fog: {},
      texts: { lit: text('lit', 800, 400), dark: text('dark', 100, 400), edge: text('edge', -16, 400), far: text('far', 980, 400) },
      drawings: {
        lit: stroke('lit', [{ x: 800, y: 100 }, { x: 850, y: 120 }]),
        dark: stroke('dark', [{ x: 100, y: 100 }, { x: 150, y: 120 }]),
        edge: stroke('edge', [{ x: -30, y: 300 }, { x: 40, y: 320 }]),
      },
    },
    initiative: {
      ...createDefaultInitiativeState(), isActive: true,
      entries: [{ id: 'e1', tokenId: 'hero', name: 'Hero', initiative: 10, initiativeModifier: 0, imagePath: '', isActive: true, isNPC: false, order: 0 }],
    },
    initiativeTrackerOpen: true,
  });
}

function context(lighting?: LightingFrame): ProjectionContext {
  return { sceneId: 's', rules: RULES, coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: MAP, ...(lighting && { lighting }) };
}

/** A frame of Atlas's raster `dark` (1 = not shown) on `cellSize` cells over `map`; every token is seen. */
function rasterOf(map: { width: number; height: number }, cellSize: number, dark: (col: number, row: number) => boolean): LightingFrame {
  const cols = Math.ceil(map.width / cellSize);
  const rows = Math.ceil(map.height / cellSize);
  const cells = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) cells[row * cols + col] = dark(col, row) ? 1 : 0;
  return { seen: () => true, ...rasterFrame({ cols, rows, cellSize, map, dark: cells }) };
}

/** The left half of the map (x < 512) is dark, on Atlas's 8·2^k cells. */
const halfDark = (): LightingFrame => rasterOf(MAP, 512, (col) => col === 0);

function expectClosed(scene: ReturnType<typeof projectForPlayers>): void {
  expect(scene.tokens).toEqual({});
  expect(scene.texts).toEqual({});
  expect(scene.drawings).toEqual({});
  expect(scene.initiative?.entries ?? []).toEqual([]);
  expect(scene.fog).toHaveProperty(DARKNESS_FOG_ID);
  expect(scene.map.asset).not.toBeNull();
  expect(JSON.stringify(scene)).not.toContain('SECRET');
}

describe('a lit scene fails closed', () => {
  it('sends only the dark map when no lighting frame is given', () => {
    expectClosed(projectForPlayers(snapshot(true), context()));
  });

  it('sends only the dark map for a closed frame', () => {
    expectClosed(projectForPlayers(snapshot(true), context(closedFrame(MAP))));
  });

  it('treats a frame flagged closed as closed even where the scene is not saved lit', () => {
    expectClosed(projectForPlayers(snapshot(false), context(closedFrame(MAP))));
  });

  it('sends everything of a scene that is not lit, as before', () => {
    const scene = projectForPlayers(snapshot(false), context());
    expect(Object.keys(scene.tokens)).toEqual(['hero']);
    expect(Object.keys(scene.texts).sort()).toEqual(['dark', 'edge', 'far', 'lit']);
    expect(Object.keys(scene.drawings).sort()).toEqual(['dark', 'edge', 'lit']);
    expect(scene.fog).not.toHaveProperty(DARKNESS_FOG_ID);
  });
});

describe('texts and drawings of a lit scene with an open frame', () => {
  it('leaves out what lies in the dark, without a coverage from the caller', () => {
    const scene = projectForPlayers(snapshot(true), context(halfDark()));
    expect(Object.keys(scene.texts)).toContain('lit');
    expect(Object.keys(scene.texts)).not.toContain('dark');
    expect(Object.keys(scene.drawings)).toContain('lit');
    expect(Object.keys(scene.drawings)).not.toContain('dark');
    expect(Object.keys(scene.tokens)).toEqual(['hero']);
  });

  // The fork's hotfix (a04e19b): an item crossing the edge is checked by the part of it inside the map.
  it('leaves out a text or drawing crossing the map edge whose part inside the map is dark, and sends one whose part is lit', () => {
    const scene = projectForPlayers(snapshot(true), context(halfDark()));
    expect(Object.keys(scene.texts)).not.toContain('edge');
    expect(Object.keys(scene.texts)).toContain('far');
    expect(Object.keys(scene.drawings)).not.toContain('edge');
  });

  it('on a map not 8-aligned, leaves out every dark text and drawing at or across the right and bottom edges', () => {
    const map = { width: 1003, height: 797 };
    const state = snapshot(true);
    const edges = {
      ...state, mapSize: map,
      objects: {
        ...state.objects,
        texts: { r: text('r', 1003, 400), b: text('b', 500, 797), rin: text('rin', 990, 400), last: { ...text('last', 1001.5, 400), width: 1, height: 1 } },
        drawings: { r: stroke('r', [{ x: 995, y: 300 }, { x: 1010, y: 310 }]), b: stroke('b', [{ x: 400, y: 790 }, { x: 420, y: 805 }]) },
      },
    };
    const allDark = rasterOf(map, 8, () => true);
    const scene = projectForPlayers(edges, { ...context(allDark), mapSize: map });
    expect(scene.texts).toEqual({});
    expect(scene.drawings).toEqual({});
    // Every cell shown but the partial last column and row: what touches them stays hidden too.
    const lastDark = rasterOf(map, 8, (col, row) => col === Math.ceil(1003 / 8) - 1 || row === Math.ceil(797 / 8) - 1);
    const partly = projectForPlayers(edges, { ...context(lastDark), mapSize: map });
    expect(partly.texts).toEqual({});
    expect(partly.drawings).toEqual({});
  });

  it('leaves out a text or drawing wholly outside the map, though nothing is dark', () => {
    const lit = rasterOf(MAP, 8, () => false);
    const state = snapshot(true);
    const outside = { ...state, objects: { ...state.objects, texts: { out: text('out', 1200, 200) }, drawings: { out: stroke('out', [{ x: 1200, y: 600 }, { x: 1250, y: 610 }]) } } };
    const scene = projectForPlayers(outside, context(lit));
    expect(scene.texts).toEqual({});
    expect(scene.drawings).toEqual({});
  });
});
