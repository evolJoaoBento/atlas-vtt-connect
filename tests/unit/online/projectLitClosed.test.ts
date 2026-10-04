import { describe, expect, it } from 'vitest';
import type { Character, DrawingStroke, SceneSnapshot, TextElement } from '@atlas-vtt/api-types';
import { DARKNESS_FOG_ID, darknessOf } from '../../../src/app/online/scene/darknessFog';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { closedFrame, type LightingFrame } from '../../../src/app/online/scene/lightingFrame';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { createDefaultInitiativeState, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';

/**
 * A scene saved lit fails closed in the projection itself, whatever the caller passes: without a lighting
 * frame, or with a closed one, players get the dark map and nothing else; with an open frame, what lies in
 * the dark or reaches past the map's edge is left out.
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

/** The left half of the map is dark; every token is seen. */
function halfDark(): LightingFrame {
  const darkness = darknessOf({ cols: 2, rows: 1, cellSize: 500, map: MAP, dark: Uint8Array.of(1, 0) });
  return { seen: () => true, darkness };
}

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

  it('sends only the dark map for a closed frame, with or without a darkness coverage from the caller', () => {
    const frame = closedFrame(MAP);
    expectClosed(projectForPlayers(snapshot(true), context(frame)));
    expectClosed(projectForPlayers(snapshot(true), { ...context(frame), darkCoverage: FogCoverage.EMPTY }));
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

  it('leaves out a text or drawing that crosses the map edge, which the darkness does not cover', () => {
    const scene = projectForPlayers(snapshot(true), context(halfDark()));
    expect(Object.keys(scene.texts)).not.toContain('edge');
    expect(Object.keys(scene.texts)).not.toContain('far');
    expect(Object.keys(scene.drawings)).not.toContain('edge');
  });

  it('leaves out the same with a coverage the caller built from the darkness', () => {
    const frame = halfDark();
    const darkCoverage = FogCoverage.EMPTY.covering(frame.darkness.covered);
    const scene = projectForPlayers(snapshot(true), { ...context(frame), darkCoverage });
    expect(Object.keys(scene.texts)).toEqual(['lit']);
    expect(Object.keys(scene.drawings)).toEqual(['lit']);
  });
});
