import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FogOperation, InitiativeEntry, TextElement } from '@atlas-vtt/api-types';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { LiveLighting } from '../../../src/app/online/scene/LiveLighting';
import { SCENE_TICK_MS } from '../../../src/app/online/scene/SceneBroadcaster';
import { LIT_SCENE_NEEDS_UPDATE_NOTICE } from '../../../src/app/online/scene/sceneLighting';
import { character, fakeLighting, hostLit, litTavern, MAP, PENDING, projectLit, ready, scene, testLighting } from './lightingFixtures';

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
    host.store.setState({ isMapLoading: true });
    // Atlas answers pending from the start of the load until the new map's sight is worked out.
    host.atlas.lighting.setVisibility(host.view, PENDING);
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
