/**
 * The fork's lighting projection cases, fed Atlas's answers (`playerVisibility`) instead of walls and lights
 * worked out here. Dropped to B15: "is an Atlas fog lasso in the Obsidian online scene" (needs
 * `obsidian/playerSceneToAtlasState`, which lands with the remote view tab).
 */
import { describe, expect, it } from 'vitest';
import type { DrawingStroke, FogOperation, InitiativeEntry, TextElement } from '@atlas-vtt/api-types';
import { DARKNESS_FOG_ID, DARKNESS_ORDER } from '../../../src/app/online/scene/darknessFog';
import { closedFrame } from '../../../src/app/online/scene/lightingFrame';
import { diffScenes } from '../../../src/app/online/scene/sceneDiff';
import { patchMessage, snapshotMessages } from '../../../src/app/online/scene/sceneMessages';
import type { PlayerScene, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { FogLayer } from '../../../src/app/online/view/layers/fogLayer';
import { character, MAP, PENDING, project, projectLit, ready, scene, UNLIT } from './lightingFixtures';
import { frame, RecordingSurface } from './recordingSurface';
import { insideByNonzero } from './sceneFixtures';

function text(id: string, x: number, y: number): TextElement {
  return { id, kind: 'text', x, y, text: id, fontSize: 16, fontFamily: 'serif', color: '#000000' } as TextElement;
}

function drawing(id: string, x: number, y: number): DrawingStroke {
  return { id, kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x, y }, { x: x + 10, y }], color: '#ff0000', width: 2, opacity: 1 };
}

function darknessRing(projected: PlayerScene): ScenePoint[] {
  const op = projected.fog[DARKNESS_FOG_ID];
  if (op?.type !== 'lasso') throw new Error('no darkness');
  return op.points;
}

const isDark = (projected: PlayerScene, point: ScenePoint): boolean => insideByNonzero(darknessRing(projected), point);

const heroAndGoblin = { hero: character('hero', 140, 400), goblin: character('goblin', 800, 400) };
/** A wall at x = 500: the hero sees the left half only. */
const walled = (extra: Parameters<typeof scene>[1] = {}) => scene({ ambient: 1 }, { tokens: heroAndGoblin, ...extra });
const WALLED = ready({ hero: 'seen' }, (x) => x < 500);
/** Night, a torch at `torchX`: the hero sees what it lights (140 px round) and itself. */
const torchlit = (torchX = 400, goblinSeen = true) => ready(
  { hero: 'seen', ...(goblinSeen ? { goblin: 'seen' as const } : {}) },
  (x, y) => Math.hypot(x - torchX, y - 400) < 140 || Math.hypot(x - 140, y - 400) < 35,
);
const night = (goblinX = 420) => scene({ ambient: 0 }, { tokens: { hero: character('hero', 140, 400), goblin: character('goblin', goblinX, 400) } });

describe('dynamic lighting for online players', () => {
  it('leaves out a token outside every vision, with its nameplate, and darkens what no vision reaches', () => {
    const projected = projectLit(walled(), WALLED);
    expect(Object.keys(projected.tokens)).toEqual(['hero']);
    expect(projected.tokens.hero?.name).toBe('hero');
    expect(isDark(projected, { x: 300, y: 400 })).toBe(false);
    expect(isDark(projected, { x: 800, y: 400 })).toBe(true);
  });

  it('leaves out texts and drawings the darkness covers whole, as it does under fog', () => {
    const projected = projectLit(walled({
      texts: { seen: text('seen', 200, 200), dark: text('dark', 800, 200) },
      drawings: { seen: drawing('seen', 200, 600), dark: drawing('dark', 800, 600) },
    }), WALLED);
    expect(Object.keys(projected.texts)).toEqual(['seen']);
    expect(Object.keys(projected.drawings)).toEqual(['seen']);
  });

  it('sends a text or drawing at the edge of a lit map, though its size pokes past it', () => {
    const state = scene({ ambient: 1 }, {
      texts: { edge: text('edge', 990, 200) },
      drawings: { edge: { ...drawing('edge', 995, 600), points: [{ x: 995, y: 600 }, { x: 1010, y: 600 }] } },
    });
    const projected = projectLit(state, ready({ hero: 'seen' }, () => true));
    expect(Object.keys(projected.texts)).toEqual(['edge']);
    expect(Object.keys(projected.drawings)).toEqual(['edge']);
  });

  it('leaves out a dark text or drawing crossing the map edge, and every one under a closed frame', () => {
    const objects = {
      texts: { lit: text('lit', 200, 200), edge: text('edge', 990, 200) },
      drawings: { lit: drawing('lit', 200, 600), edge: { ...drawing('edge', 995, 600), points: [{ x: 995, y: 600 }, { x: 1010, y: 600 }] } },
    };
    const projected = projectLit(walled(objects), WALLED);
    expect(Object.keys(projected.texts)).toEqual(['lit']);
    expect(Object.keys(projected.drawings)).toEqual(['lit']);
    const closed = project(walled(objects), closedFrame(MAP));
    expect(closed.texts).toEqual({});
    expect(closed.drawings).toEqual({});
    // Without lighting nothing is darkened, so the edge is no reason to hide them.
    const unlit = scene({ enabled: false }, objects);
    expect(Object.keys(project(unlit, null).texts).sort()).toEqual(['edge', 'lit']);
  });

  it('leaves out a text or drawing wholly outside the map', () => {
    const state = scene({ ambient: 1 }, {
      texts: { in: text('in', 200, 200), out: text('out', 1200, 200) },
      drawings: { in: drawing('in', 200, 600), out: drawing('out', 1200, 600) },
    });
    const projected = projectLit(state, ready({ hero: 'seen' }, () => true));
    expect(Object.keys(projected.texts)).toEqual(['in']);
    expect(Object.keys(projected.drawings)).toEqual(['in']);
  });

  it('covers what no light reaches at night, shows what the torch lights and the hero standing in the dark', () => {
    const projected = projectLit(night(), torchlit());
    expect(isDark(projected, { x: 400, y: 400 })).toBe(false);
    expect(isDark(projected, { x: 900, y: 100 })).toBe(true);
    expect(isDark(projected, { x: 700, y: 400 })).toBe(true);
    expect(isDark(projected, { x: 140, y: 400 })).toBe(false);
    expect(Object.keys(projected.tokens).sort()).toEqual(['goblin', 'hero']);
  });

  it('follows a light that moves and a token that leaves the light', () => {
    const before = projectLit(night(), torchlit());
    const moved = projectLit(night(), torchlit(700, false));
    expect(isDark(moved, { x: 400, y: 400 })).toBe(true);
    expect(isDark(moved, { x: 700, y: 400 })).toBe(false);
    expect(Object.keys(moved.tokens)).toEqual(['hero']);
    expect(diffScenes(before, moved)?.upsert.fog?.[DARKNESS_FOG_ID]).toBeDefined();
    expect(Object.keys(projectLit(night(690), torchlit(700)).tokens).sort()).toEqual(['goblin', 'hero']);
  });

  it('projects exactly as before without lighting: feature off, or the scene unlit', () => {
    const state = walled({ texts: { edge: text('edge', 990, 200) } });
    const unlit = { ...state, lighting: { ...state.lighting, enabled: false } };
    expect(projectLit(unlit, UNLIT)).toEqual(project(unlit, null));
    // Saved lit, but Atlas says lighting hides nothing (dynamic lighting off): open, exactly the unlit projection.
    expect(projectLit(state, UNLIT)).toEqual(project(unlit, null));
    expect(projectLit(state, UNLIT).tokens.goblin).toBeDefined();
    expect(projectLit(state, UNLIT).texts.edge).toBeDefined();
    expect(projectLit(state, UNLIT).fog).toEqual({});
  });

  it('keeps the GM fog under the darkness, which goes last', () => {
    const fog: Record<string, FogOperation> = { f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 5, isErasing: false, x: 0, y: 0, width: 50, height: 50 } };
    const projected = projectLit(walled({ fog }), WALLED);
    expect(Object.keys(projected.fog)).toEqual(['f', DARKNESS_FOG_ID]);
    expect(projected.fog[DARKNESS_FOG_ID]?.order).toBe(DARKNESS_ORDER);
  });

  it('shows nothing until the view has worked out the scene\'s sight', () => {
    const entry: InitiativeEntry = { id: 'e1', tokenId: 'hero', name: 'hero', initiative: 12, initiativeModifier: 0, imagePath: '', isActive: true, isNPC: false, order: 0 };
    const base = walled();
    const state = { ...base, initiativeTrackerOpen: true, initiative: { ...base.initiative, isActive: true, entries: [entry] } };
    expect(projectLit(state, WALLED).initiative?.entries.map(({ tokenId }) => tokenId)).toEqual(['hero']);
    const projected = projectLit(state, PENDING);
    expect(projected.tokens).toEqual({});
    expect(projected.initiative?.entries).toEqual([]);
  });

  it('leaves out a token the players only sense, which the window outlines', () => {
    const projected = projectLit(walled(), ready({ hero: 'seen', goblin: 'sensed' }, (x) => x < 500));
    expect(Object.keys(projected.tokens)).toEqual(['hero']);
  });

  it('never sends walls, lights or how tokens see, in any message', () => {
    const before = projectLit(walled(), WALLED);
    const after = projectLit(walled(), ready({ hero: 'seen' }, (x) => x < 600));
    const messages = [...(snapshotMessages(before) ?? []), patchMessage(diffScenes(before, after) ?? { set: {}, upsert: {}, remove: {} })];
    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(messages);
    for (const key of ['walls', 'lights', 'lightZones', 'vision', 'light', 'emission', 'p1', 'p2', 'senses', 'lighting', 'ambient', 'exploredMask', 'heldTokens', 'polygon', 'shown', 'showsExplored', 'perception']) {
      expect(keys.has(key), key).toBe(false);
    }
  });
});

describe('the darkness on both players\' clients', () => {
  it('is painted on the web page as one closed path over the map', () => {
    const projected = projectLit(walled(), WALLED);
    const surface = new RecordingSurface();
    new FogLayer().draw(surface, frame(projected));
    const paths = surface.layers[0]?.ops('paths') ?? [];
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatchObject({ closed: true, style: { erase: false } });
    const [ring] = paths[0]!.paths;
    expect(insideByNonzero(ring!, { x: 800, y: 400 })).toBe(true);
    expect(insideByNonzero(ring!, { x: 300, y: 400 })).toBe(false);
  });
});
