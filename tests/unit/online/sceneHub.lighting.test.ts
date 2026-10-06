import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { SPLIT_LIMITS } from '../../../src/app/online/split/splitLimits';
import { ready } from './lightingFixtures';
import { character, lastSceneId, MAP, splitWorld, tab, tabScene, TOKEN, typesOf, VIEW, type SplitWorld } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const ALL_SEEN = (): ReturnType<typeof ready> => ready({ [TOKEN.a]: 'seen', ambushguard: 'seen' }, () => true, MAP);

/** Anna on the presented Ambush, lit, which she has seen with both tokens; then the GM went to Bridge (Ambush parked) and back. */
async function backOnAmbush(): Promise<{ w: SplitWorld; anna: Awaited<ReturnType<SplitWorld['join']>>; from: number }> {
  const w = await splitWorld({ lighting: true });
  w.atlas.views.setSnapshot(VIEW, tabScene('a', { ambushguard: character('ambushguard', 600) }, true));
  w.atlas.lighting.setVisibility(VIEW, ALL_SEEN());
  await w.present('a');
  const anna = await w.join('anna');
  expect(Object.keys(lastSnapshot(anna.received)?.tokens ?? {}).sort()).toEqual(['ambushguard', TOKEN.a]);
  await w.switchTo('b');
  const from = anna.received.length;
  await w.switchTo('a');
  return { w, anna, from };
}

function lastSnapshot(messages: readonly ControlMessage[]): { tokens: Record<string, unknown> } | null {
  const snapshot = [...messages].reverse().find((message) => message.type === 'scene-snapshot');
  return snapshot?.type === 'scene-snapshot' ? snapshot.scene : null;
}

describe('SceneHub going live on a lit scene (P8)', () => {
  it('going live on a lit scene keeps the parked projection until sight is ready, then patches', async () => {
    const { w, anna, from } = await backOnAmbush();
    // The tab loaded and sight is pending: nothing new is sent, no darkness flash.
    await vi.advanceTimersByTimeAsync(500);
    expect(anna.received.slice(from)).toEqual([]);
    // Sight is ready: the guard has walked out of sight meanwhile.
    w.atlas.lighting.setVisibility(VIEW, ready({ [TOKEN.a]: 'seen' }, () => true, MAP));
    await vi.advanceTimersByTimeAsync(0);
    expect(typesOf(anna, from)).toEqual(['scene-patch', 'scene-state']);
    const patch = anna.received[from];
    expect(patch?.type === 'scene-patch' ? patch.remove.tokens : null).toEqual(['ambushguard']);
    expect(anna.received.at(-1)).toEqual({ v: 1, type: 'scene-state', sceneId: lastSceneId(anna), paused: false });
  });

  it('still pending after 2 s projects closed (P8)', async () => {
    const { anna, from } = await backOnAmbush();
    await vi.advanceTimersByTimeAsync(SPLIT_LIMITS.goLiveWaitMs - 10);
    expect(anna.received.slice(from)).toEqual([]);
    await vi.advanceTimersByTimeAsync(20);
    expect(typesOf(anna, from)).toEqual(['scene-patch', 'scene-state']);
    const patch = anna.received[from];
    // Fail closed: every token gone and the darkness over the map.
    expect(patch?.type === 'scene-patch' ? [...(patch.remove.tokens ?? [])].sort() : null).toEqual(['ambushguard', TOKEN.a]);
    expect(patch?.type === 'scene-patch' ? Object.keys(patch.upsert.fog ?? {}) : null).toContain(DARKNESS_FOG_ID);
  });

  it('an unlit scene goes live at once', async () => {
    const w = await splitWorld();
    await w.present('a');
    const anna = await w.join('anna');
    await w.switchTo('b');
    const from = anna.received.length;
    // The GM left a token on Ambush's file: back on it, it shows at once.
    w.atlas.views.setTabScene(VIEW, 'a', tabScene('a', { ambushguard: character('ambushguard', 600) }));
    await w.switchTo('a');
    expect(typesOf(anna, from)).toEqual(['scene-patch', 'scene-state']);
  });

  it('a first presentation of a lit scene is sent at once, closed while sight is pending, as before', async () => {
    const w = await splitWorld({ lighting: true });
    w.atlas.views.setSnapshot(VIEW, tabScene('a', {}, true));
    const anna = await w.join('anna');
    await w.present('a');
    expect(typesOf(anna)).toEqual(['scene-clear', 'scene-snapshot', 'scene-fog']);
    expect(lastSnapshot(anna.received)?.tokens).toEqual({});
    // A never-live tab of a lit scene: no parked projection to keep, so closed at once too.
    expect(w.tabs.tab(tab('a'))).not.toBeNull();
  });
});
