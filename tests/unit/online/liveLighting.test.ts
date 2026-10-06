/**
 * The fork's live lighting cases that stay in Connect: Atlas now works the darkness out, throttles it and
 * decodes explored memory (A20 took those timing and decoding cases), so what is left is how its answer
 * becomes a frame, when the projection runs again, and what the broadcaster sends players from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { LiveLighting } from '../../../src/app/online/scene/LiveLighting';
import { SCENE_TICK_MS } from '../../../src/app/online/scene/SceneHub';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { character, hostLit, litTavern, MAP, PENDING, ready, testLighting, UNLIT } from './lightingFixtures';
import { insideByNonzero } from './sceneFixtures';
import { HUB_PATHS, onHubPath } from './hubPath';

const WHOLE_MAP = [{ x: 0, y: 0, width: MAP.width, height: MAP.height }];
/** The hero sees the left half: a wall at x = 500. */
const walled = ready({ hero: 'seen' }, (x) => x < 500);

const ring = (frame: ReturnType<LiveLighting['frame']>): ScenePoint[] => {
  const op = frame?.darkness.fog[DARKNESS_FOG_ID];
  return op?.type === 'lasso' ? op.points : [];
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe.each(HUB_PATHS)('live lighting of a presentation, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  it('is nothing while the scene is unlit or dynamic lighting is off', () => {
    expect(new LiveLighting(testLighting(UNLIT).api, 'v1', () => undefined).frame(MAP)).toBeNull();
  });

  it('darkens at once, without waiting, when the view\'s sight stops being the scene\'s', () => {
    const lighting = testLighting(walled);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    expect(live.frame(MAP)!.seen('hero')).toBe(true);
    lighting.current = PENDING;
    const frame = live.frame(MAP)!;
    expect(frame.seen('hero')).toBe(false);
    expect(frame.darkness.covered).toEqual(WHOLE_MAP);
  });

  it('fails closed when the view cannot tell: pending, an unknown status or an answer that throws shows nothing', () => {
    const lighting = testLighting(PENDING);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    expect(live.frame(MAP)!.darkness.covered).toEqual(WHOLE_MAP);
    lighting.current = { status: 'later' } as never;
    expect(live.frame(MAP)!.seen('hero')).toBe(false);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const throwing = new LiveLighting({ playerVisibility: () => { throw new Error('boom'); }, watch: () => () => undefined }, 'v1', () => undefined);
    expect(throwing.frame(MAP)!.darkness.covered).toEqual(WHOLE_MAP);
    error.mockRestore();
  });

  it('fails closed on an answer that does not fit: cells missing, no cell size, a map without size', () => {
    const live = (answer: unknown) => new LiveLighting(testLighting(answer as never).api, 'v1', () => undefined);
    const base = walled.status === 'ready' ? walled : null;
    expect(live({ ...base, darkness: { ...base!.darkness, shown: new Uint8Array(3) } }).frame(MAP)!.darkness.covered).toEqual(WHOLE_MAP);
    expect(live({ ...base, darkness: { ...base!.darkness, cellSize: 0 } }).frame(MAP)!.seen('hero')).toBe(false);
    const sizeless = live(walled).frame({ width: 0, height: 0 })!;
    expect(sizeless.seen('hero')).toBe(false);
    expect(sizeless.closed).toBe(true);
  });

  it('counts only a cell marked 1 as shown, and darkens what lies past the grid Atlas measured', () => {
    const shown = Uint8Array.of(1, 2, 255, 1);
    const frame = new LiveLighting(testLighting({ status: 'ready', tokens: {}, darkness: { cellSize: 512, cols: 2, rows: 2, shown }, showsExplored: false }).api, 'v1', () => undefined)
      .frame({ width: 1200, height: 1000 })!;
    expect(insideByNonzero(ring(frame), { x: 200, y: 200 })).toBe(false);
    expect(insideByNonzero(ring(frame), { x: 600, y: 200 })).toBe(true);
    expect(insideByNonzero(ring(frame), { x: 200, y: 600 })).toBe(true);
    expect(insideByNonzero(ring(frame), { x: 600, y: 600 })).toBe(false);
    // The map is wider than the grid: the third column is dark, and so is what lies there.
    expect(insideByNonzero(ring(frame), { x: 1100, y: 200 })).toBe(true);
    expect(frame.shows({ x: 100, y: 100, width: 20, height: 20 })).toBe(true);
    expect(frame.shows({ x: 1050, y: 100, width: 20, height: 20 })).toBe(false);
    expect(frame.shows({ x: 500, y: 100, width: 20, height: 20 })).toBe(false);
  });

  it('stays closed while sight is pending, opens once it is ready, and closes again when it goes', () => {
    const lighting = testLighting(PENDING);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    expect(live.frame(MAP)!.darkness.covered).toEqual(WHOLE_MAP);
    lighting.current = walled;
    const open = live.frame(MAP)!;
    expect(open.seen('hero')).toBe(true);
    expect(open.seen('goblin')).toBe(false);
    expect(open.darkness.covered).not.toEqual(WHOLE_MAP);
    lighting.current = PENDING;
    expect(live.frame(MAP)!.seen('hero')).toBe(false);
    expect(live.frame(MAP)!.darkness.covered).toEqual(WHOLE_MAP);
  });

  it('keeps one darkness while the answer stays the same, a fresh one when it changes or the scene reloads', () => {
    const lighting = testLighting(walled);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    const first = live.frame(MAP)!.darkness;
    lighting.current = ready({ hero: 'seen', goblin: 'seen' }, (x) => x < 500);
    expect(live.frame(MAP)!.darkness).toBe(first);
    expect(live.frame(MAP)!.seen('goblin')).toBe(true);
    lighting.current = ready({ hero: 'seen' }, (x) => x < 300);
    expect(live.frame(MAP)!.darkness).not.toBe(first);
    const second = live.frame(MAP)!.darkness;
    live.restart();
    expect(live.frame(MAP)!.darkness).not.toBe(second);
  });

  it('shows explored memory as Atlas does, and hides at once what it forgot', () => {
    const lighting = testLighting(PENDING);
    const live = new LiveLighting(lighting.api, 'v1', () => undefined);
    // Atlas answers pending while the saved memory decodes, then the window with it.
    expect(insideByNonzero(ring(live.frame(MAP)), { x: 900, y: 400 })).toBe(true);
    lighting.current = ready({ hero: 'seen' }, (x) => x < 300 || x > 700);
    expect(insideByNonzero(ring(live.frame(MAP)), { x: 900, y: 400 })).toBe(false);
    lighting.current = ready({ hero: 'seen' }, (x) => x < 300);
    expect(insideByNonzero(ring(live.frame(MAP)), { x: 900, y: 400 })).toBe(true);
  });

  it('a token only sensed, or absent from the answer, is not seen; nor is a name the prototype holds', () => {
    const frame = new LiveLighting(testLighting(ready({ hero: 'seen', ghost: 'sensed', orc: 'unseen' }, () => true)).api, 'v1', () => undefined).frame(MAP)!;
    expect(['hero', 'ghost', 'orc', 'nobody', 'constructor', '__proto__'].filter((id) => frame.seen(id))).toEqual(['hero']);
  });

  it('calls back when the view says what players see changed, until disposed', () => {
    const lighting = testLighting(walled);
    const due = vi.fn();
    const live = new LiveLighting(lighting.api, 'v1', due);
    lighting.changed();
    expect(due).toHaveBeenCalledTimes(1);
    live.dispose();
    lighting.changed();
    expect(due).toHaveBeenCalledTimes(1);
    expect(lighting.watchers()).toBe(0);
  });
});

describe.each(HUB_PATHS)('the broadcaster with dynamic lighting, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  const heroAndGoblin = () => litTavern({ tokens: { hero: character('hero', 140, 400), goblin: character('goblin', 800, 400) } }, { ambient: 1 });

  it('sends what the player window shows, follows the view\'s sight, and never a wall', async () => {
    const host = hostLit(heroAndGoblin(), { lighting: true, visibility: walled });
    expect(Object.keys(host.players().tokens)).toEqual(['hero']);
    expect(host.players().fog[DARKNESS_FOG_ID]).toBeDefined();
    // The view's sight changes without a store change: players get it at the next tick.
    host.atlas.lighting.setVisibility(host.view, ready({ hero: 'seen', goblin: 'seen' }, () => true));
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(Object.keys(host.players().tokens).sort()).toEqual(['goblin', 'hero']);
    expect(host.players().fog).toEqual({});
    host.atlas.lighting.setVisibility(host.view, UNLIT);
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(Object.keys(host.players().tokens).sort()).toEqual(['goblin', 'hero']);
    expect(host.sent.map((message) => message.type)).toEqual(['scene-snapshot', 'scene-fog', 'scene-patch']);
    expect(JSON.stringify(host.sent)).not.toMatch(/"(walls|p1|vision|lights|shown|perception)"/);
    host.broadcaster.stop();
  });

  it('keeps a seen token while its darkness lags: the hero dragged through the dark never drops out', async () => {
    const host = hostLit(heroAndGoblin(), { lighting: true, visibility: ready({ hero: 'seen' }, (x) => x < 200) });
    for (const x of [280, 420]) {
      // Atlas's darkness waits up to 200 ms; its tokens follow at once.
      host.atlas.lighting.setVisibility(host.view, ready({ hero: 'seen' }, (cellX) => cellX < 200));
      host.store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, hero: character('hero', x, 400) } } }));
      await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
      expect(host.players().tokens.hero?.x).toBe(x);
    }
    host.broadcaster.stop();
  });

  it('sends no token and full darkness for a lit scene whose sight is pending', () => {
    const host = hostLit(heroAndGoblin(), { lighting: true, visibility: PENDING });
    expect(host.players().tokens).toEqual({});
    expect(host.players().fog[DARKNESS_FOG_ID]).toBeDefined();
    host.broadcaster.stop();
  });

  it('projects again when the scene\'s lighting changes in the store', async () => {
    const host = hostLit(heroAndGoblin(), { lighting: true, visibility: walled });
    const before = host.players();
    // Daylight: Atlas shows everything, and the store's lighting change reaches the broadcaster as a snapshot.
    host.atlas.lighting.setVisibility(host.view, ready({ hero: 'seen', goblin: 'seen' }, () => true));
    host.store.setState((state) => ({ lighting: { ...state.lighting!, ambient: 1 } }));
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    expect(host.players()).not.toEqual(before);
    host.broadcaster.stop();
  });
});
