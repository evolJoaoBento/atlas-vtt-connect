import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_INTERVAL_MS } from '../../../src/app/online/scene/sceneCamera';
import { lastSceneId, splitWorld, tab, typesOf, type RawPlayer, type SplitWorld } from './splitFixtures';
import { cameraPart, camerasOf, moveCamera } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna follows the presented Ambush; Ben is assigned to Bridge, which the GM's view switched to and loaded. */
async function split(): Promise<{ w: SplitWorld; anna: RawPlayer; ben: RawPlayer }> {
  const w = await splitWorld();
  cameraPart(w);
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  void w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  return { w, anna, ben };
}

/** Lets the camera's interval pass, so the next frame is sent at once. */
const pause = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(CAMERA_INTERVAL_MS + 1); };

describe('CameraSender with a split party', () => {
  it('sends the GM camera to the live slot\'s players only', async () => {
    const { w, anna, ben } = await split();
    await pause();
    const [annaBefore, benBefore] = [anna.received.length, ben.received.length];
    moveCamera(w, 700);
    await pause();
    expect(camerasOf(ben, benBefore).map((camera) => [camera.sceneId, camera.centerX])).toEqual([[lastSceneId(ben), 700]]);
    expect(camerasOf(anna, annaBefore)).toEqual([]);
  });

  it('the presented scene\'s camera never reaches a player on another scene', async () => {
    const { w, anna, ben } = await split();
    await w.switchTo('a');
    await pause();
    const benBefore = ben.received.length;
    moveCamera(w, 900);
    await pause();
    moveCamera(w, 950);
    await pause();
    expect(camerasOf(anna).at(-1)?.centerX).toBe(950);
    expect(camerasOf(anna).at(-1)?.sceneId).toBe(lastSceneId(anna));
    expect(camerasOf(ben, benBefore)).toEqual([]);
  });

  it('a camera from the loading tab is sent to nobody', async () => {
    const { w, anna, ben } = await split();
    await pause();
    const [annaBefore, benBefore] = [anna.received.length, ben.received.length];
    const switched = w.atlas.views.switchTab('gm', 'a', { loadDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(10);
    moveCamera(w, 111);
    await vi.advanceTimersByTimeAsync(40);
    moveCamera(w, 222);
    await vi.advanceTimersByTimeAsync(40);
    expect(camerasOf(anna, annaBefore)).toEqual([]);
    expect(camerasOf(ben, benBefore)).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    await switched;
    await vi.advanceTimersByTimeAsync(0);
    // Ambush is live again: its players get the view's camera, Ben none.
    expect(camerasOf(anna, annaBefore).map((camera) => camera.sceneId)).toEqual([lastSceneId(anna)]);
    expect(camerasOf(ben, benBefore)).toEqual([]);
  });

  it('a moved player gets the target scene\'s last camera after its snapshot', async () => {
    const { w, ben } = await split();
    await pause();
    moveCamera(w, 640);
    await pause();
    await w.switchTo('a');
    const cy = await w.join('cy');
    const before = cy.received.length;
    void w.hub.assign(cy.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(typesOf(cy, before)).toEqual(['scene-clear', 'scene-snapshot', 'scene-camera', 'scene-state']);
    expect(camerasOf(cy, before).map((camera) => [camera.sceneId, camera.centerX])).toEqual([[lastSceneId(ben), 640]]);
  });

  it('a parked slot sends no camera', async () => {
    const { w, ben } = await split();
    await w.switchTo('a');
    await pause();
    const before = ben.received.length;
    for (const x of [10, 20, 30]) {
      moveCamera(w, x);
      await pause();
    }
    expect(camerasOf(ben, before)).toEqual([]);
  });

  it('resumes with the patch and scene-state first, then the camera', async () => {
    const { w, anna } = await split();
    moveCamera(w, 300);
    await pause();
    const before = anna.received.length;
    w.atlas.views.setCamera('gm', { centerX: 410, centerY: 500, width: 800, height: 600 });
    await w.switchTo('a');
    expect(typesOf(anna, before)).toEqual(['scene-state', 'scene-camera']);
    expect(camerasOf(anna, before).map((camera) => camera.centerX)).toEqual([410]);
  });
});
