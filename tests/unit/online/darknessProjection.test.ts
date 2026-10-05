import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawingStroke, FogOperation, InitiativeEntry, PlayerVisibility, TextElement } from '@atlas-vtt/api-types';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { LiveLighting } from '../../../src/app/online/scene/LiveLighting';
import { drawingBounds, textBounds } from '../../../src/app/online/scene/objectBounds';
import type { WorldBounds } from '../../../src/app/online/scene/FogCoverage';
import { SCENE_TICK_MS } from '../../../src/app/online/scene/SceneBroadcaster';
import { LIT_SCENE_NEEDS_UPDATE_NOTICE } from '../../../src/app/online/scene/sceneLighting';
import { atlasCellSize, character, fakeLighting, hostLit, litTavern, MAP, PENDING, projectLit, ready, scene, testLighting } from './lightingFixtures';

const text = (id: string, x: number, y: number): TextElement => ({
  id, kind: 'text', x, y, text: 'SECRET', fontSize: 16, fontFamily: 'serif', color: '#000000',
} as TextElement);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("players' darkness from Atlas's player visibility", () => {
  it('pending sends no tokens and full darkness', () => {
    const frame = new LiveLighting(fakeLighting({ status: 'pending' }), 'v1', () => undefined).frame({ width: 700, height: 700 });
    expect(frame!.seen('a')).toBe(false);
    expect(frame!.darkness.covered.length).toBeGreaterThan(0);
    expect(frame!.darkness.covered).toEqual([{ x: 0, y: 0, width: 700, height: 700 }]);
  });

  it('unlit projects as without lighting', () => {
    expect(new LiveLighting(fakeLighting({ status: 'unlit' }), 'v1', () => undefined).frame({ width: 700, height: 700 })).toBeNull();
  });

  it('ready shows the tokens players see and hides the cells the window hides', () => {
    const shown = new Uint8Array([1, 0, 0, 1]);
    const frame = new LiveLighting(fakeLighting({ status: 'ready', tokens: { a: 'seen', b: 'sensed' }, darkness: { cellSize: 350, cols: 2, rows: 2, shown }, showsExplored: false }), 'v1', () => undefined).frame({ width: 700, height: 700 })!;
    expect(frame.seen('a')).toBe(true);
    expect(frame.seen('b')).toBe(false);
    expect(frame.darkness.covered).toHaveLength(2);
  });

  it('without the lighting capability a lit scene is dark for players', async () => {
    const host = hostLit(litTavern({ tokens: { hero: character('hero', 140, 140) }, texts: { tx: text('tx', 300, 300) } }), { lighting: false });
    expect(host.players().tokens).toEqual({});
    expect(host.players().texts).toEqual({});
    host.store.setState((state) => ({ objects: { ...state.objects, tokens: { hero: character('hero', 300, 140) } } }));
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(host.players().tokens).toEqual({});
    expect(JSON.stringify(host.sent)).not.toContain('SECRET');
    expect(host.notices).toEqual([LIT_SCENE_NEEDS_UPDATE_NOTICE]);
    host.broadcaster.stop();
  });

  it('with the lighting capability a lit scene shows what Atlas says the window shows, and no notice', () => {
    const visibility = ready({ hero: 'seen' }, (x) => x < 500);
    const host = hostLit(litTavern({ tokens: { hero: character('hero', 140, 140), goblin: character('goblin', 800, 140) } }), { lighting: true, visibility });
    expect(Object.keys(host.players().tokens)).toEqual(['hero']);
    expect(host.notices).toEqual([]);
    host.broadcaster.stop();
  });
});

/** Each leak found in the fork or the API, as a case that would show it again (progress.md). */
describe('leak repros', () => {
  it("applies lighting to tokens only: a token the GM hid, or under the GM's fog, is not sent though Atlas reads it seen", () => {
    const fog: Record<string, FogOperation> = { f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 5, isErasing: false, x: 700, y: 300, width: 200, height: 200 } };
    const entry = (tokenId: string, order: number): InitiativeEntry => ({ id: tokenId, tokenId, name: tokenId, initiative: 10, initiativeModifier: 0, imagePath: '', isActive: order === 0, isNPC: true, order });
    const base = scene({ ambient: 1 }, {
      tokens: { hero: character('hero', 140, 400), spy: character('spy', 300, 400, { isHidden: true }), lurker: character('lurker', 800, 400), orc: character('orc', 200, 200) },
      fog,
    });
    const state = { ...base, initiativeTrackerOpen: true, initiative: { ...base.initiative, isActive: true, entries: [entry('hero', 0), entry('orc', 1), entry('spy', 2)] } };
    const projected = projectLit(state, ready({ hero: 'seen', spy: 'seen', lurker: 'seen', orc: 'unseen' }, () => true));
    expect(Object.keys(projected.tokens)).toEqual(['hero']);
    expect(projected.initiative?.entries.map(({ tokenId }) => tokenId)).toEqual(['hero']);
  });

  it('C1: a map load is dark until Atlas knows the new map, also where the snapshot reads unlit', async () => {
    const host = hostLit(litTavern({ tokens: { hero: character('hero', 140, 140) } }), { lighting: true, visibility: ready({ hero: 'seen' }, () => true) });
    expect(Object.keys(host.players().tokens)).toEqual(['hero']);
    // Atlas answers pending from the start of the load until the new map's sight is worked out.
    host.store.setState({ isMapLoading: true });
    host.store.setState((state) => ({ isMapLoading: false, lighting: { enabled: false, ambient: 1 }, objects: { ...state.objects, tokens: { hero: character('hero', 210, 140) } } }));
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(host.players().tokens).toEqual({});
    expect(host.players().fog[DARKNESS_FOG_ID]).toBeDefined();
    host.atlas.lighting.setVisibility(host.view, { status: 'unlit' });
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(host.players().tokens.hero?.x).toBe(210);
    host.broadcaster.stop();
  });

  it('C2: a forget, clear or undo of explored memory never shows the area removed, while it decodes or after', async () => {
    const explored = (x: number): boolean => x < 300 || x > 700;
    const host = hostLit(litTavern({ texts: { map: text('map', 800, 300) } }), { lighting: true, visibility: ready({}, explored) });
    expect(Object.keys(host.players().texts)).toEqual(['map']);
    for (const removed of [(x: number) => x < 300, () => false]) {
      host.atlas.lighting.setVisibility(host.view, ready({}, explored));
      await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
      // The forget: Atlas answers pending until the mask without the area is decoded, then the darker window.
      host.atlas.lighting.setVisibility(host.view, PENDING);
      await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
      expect(host.players().texts).toEqual({});
      host.atlas.lighting.setVisibility(host.view, ready({}, removed));
      await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
      expect(host.players().texts).toEqual({});
    }
    host.broadcaster.stop();
  });

  it('the ordering leak: a darkness worked out before never stands in once Atlas answers pending', () => {
    const answer = ready({ hero: 'seen' }, () => true);
    const lighting = testLighting(answer);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    const open = live.frame(MAP)!;
    expect(open.darkness.covered).toEqual([]);
    lighting.current = PENDING;
    const closed = live.frame(MAP)!;
    expect(closed.closed).toBe(true);
    expect(closed.darkness).not.toBe(open.darkness);
    lighting.current = answer;
    expect(live.frame(MAP)!.seen('hero')).toBe(true);
  });

  it('without the capability tells the GM once per scene, however often it projects, and stays dark', async () => {
    const host = hostLit(litTavern({ tokens: { hero: character('hero', 140, 140) } }), { lighting: false });
    for (let tick = 0; tick < 3; tick++) {
      host.store.setState((state) => ({ objects: { ...state.objects, tokens: { hero: character('hero', 140 + 10 * tick, 140) } } }));
      await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    }
    expect(host.players().tokens).toEqual({});
    expect(host.notices).toEqual([LIT_SCENE_NEEDS_UPDATE_NOTICE]);
    host.broadcaster.stop();
  });
});

/** A seeded generator, so a failing case can be replayed. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/** The pixels `bounds` covers inside `map`; a zero-area item covers the pixel under it. */
function pixelsOf(bounds: WorldBounds, map: { width: number; height: number }): Array<[number, number]> {
  const x0 = Math.max(bounds.x, 0);
  const y0 = Math.max(bounds.y, 0);
  const x1 = Math.min(bounds.x + bounds.width, map.width);
  const y1 = Math.min(bounds.y + bounds.height, map.height);
  const pixels: Array<[number, number]> = [];
  for (let y = Math.floor(y0); y <= Math.max(Math.floor(y0), Math.ceil(y1) - 1); y++) {
    for (let x = Math.floor(x0); x <= Math.max(Math.floor(x0), Math.ceil(x1) - 1); x++) pixels.push([x, y]);
  }
  return pixels;
}

describe('positive visibility of texts and drawings (ruling L-POS)', () => {
  it('sends nothing of an all-dark map that is not 8-aligned', () => {
    const map = { width: 1003, height: 797 };
    const state = { ...scene({}, {
      texts: { r: text('r', 1003, 400), b: text('b', 500, 797), rin: text('rin', 990, 400), mid: text('mid', 500, 400), corner: text('corner', 1000, 795) },
      drawings: { r: { id: 'r', kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x: 995, y: 300 }, { x: 1010, y: 310 }], color: '#f00', width: 2, opacity: 1 } },
    }), mapSize: map };
    const projected = projectLit(state, ready({ hero: 'seen' }, () => false, map));
    expect(projected.texts).toEqual({});
    expect(projected.drawings).toEqual({});
  });

  it('never sends a text or drawing unless every pixel of it inside the map is shown, on random maps and rasters', () => {
    const next = random(9);
    let sent = 0;
    let hidden = 0;
    for (let round = 0; round < 300; round++) {
      // Map sizes that are not multiples of 8, and Atlas's cell sizes 8·2^k (at least the one it picks for the map).
      const map = { width: 8 * Math.floor(20 + next() * 150) + 1 + Math.floor(next() * 7), height: 8 * Math.floor(20 + next() * 120) + 1 + Math.floor(next() * 7) };
      const cellSize = atlasCellSize(map) * 2 ** Math.floor(next() * 3);
      const cols = Math.ceil(map.width / cellSize);
      const rows = Math.ceil(map.height / cellSize);
      const shown = Uint8Array.from({ length: cols * rows }, () => (next() < 0.8 ? 1 : 0));
      const visibility: PlayerVisibility = { status: 'ready', tokens: {}, darkness: { cellSize, cols, rows, shown }, showsExplored: false };
      const shownAt = (x: number, y: number): boolean => shown[Math.floor(y / cellSize) * cols + Math.floor(x / cellSize)] === 1;
      // Half the items near the far edges, where the partial cells lie.
      const at = (size: number): number => (next() < 0.5 ? size - cellSize + next() * (cellSize + 40) : -40 + next() * (size + 80));
      const texts: Record<string, TextElement> = {};
      const drawings: Record<string, DrawingStroke> = {};
      for (let item = 0; item < 12; item++) {
        texts[`t${item}`] = { ...text(`t${item}`, at(map.width), at(map.height)), text: 'x', width: 1 + next() * 60, height: 1 + next() * 30 };
        const x = at(map.width);
        const y = at(map.height);
        drawings[`d${item}`] = { id: `d${item}`, kind: 'drawing', timestamp: item, type: 'pen', points: [{ x, y }, { x: x + next() * 40, y: y + next() * 40 }], color: '#f00', width: next() * 6, opacity: 1 };
      }
      const projected = projectLit({ ...scene({}, { texts, drawings }), mapSize: map }, visibility);
      const checks: Array<[string, WorldBounds | null]> = [
        ...Object.keys(projected.texts).map((id): [string, WorldBounds] => [id, textBounds(texts[id]!)]),
        ...Object.entries(projected.drawings).map(([id, drawing]): [string, WorldBounds] => [id, drawingBounds(drawing)]),
      ];
      for (const [id, bounds] of checks) {
        const pixels = pixelsOf(bounds!, map);
        const inside = bounds!.x < map.width && bounds!.y < map.height && bounds!.x + bounds!.width > 0 && bounds!.y + bounds!.height > 0;
        expect(inside && pixels.every(([x, y]) => shownAt(x, y)), `round ${round}: ${id} at ${JSON.stringify(bounds)}`).toBe(true);
      }
      sent += checks.length;
      hidden += 24 - checks.length;
    }
    // Neither vacuous way round: items are sent and items are hidden.
    expect(sent).toBeGreaterThan(200);
    expect(hidden).toBeGreaterThan(200);
  });
});
