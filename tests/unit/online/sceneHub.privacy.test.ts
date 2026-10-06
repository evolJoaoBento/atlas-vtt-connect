import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { character, lastSceneId, splitWorld, tab, tabScene, TOKEN, typesOf, VIEW, wireOf } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('SceneHub privacy across tab switches (P2)', () => {
  it('during a switch from A to B nothing derived from A reaches B\'s players', async () => {
    const w = await splitWorld();
    await w.present('a');
    const anna = await w.join('anna');
    const ben = await w.join('ben');
    // Ben on Bridge (switched to and loaded once), then the GM back on Ambush: Ambush live, Bridge parked.
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    await w.switchTo('a');
    const [annaFrom, benFrom] = [anna.received.length, ben.received.length];

    const switched = w.atlas.views.switchTab(VIEW, 'b', { loadDelayMs: 50 });
    // Bridge is already the active tab while the store still holds Ambush, loaded: the GM edits it there.
    w.editTokens({ ambushspy: character('ambushspy', 600) });
    await vi.advanceTimersByTimeAsync(0);
    // Now loading: the store's writes are Ambush's, never Bridge's.
    w.editTokens({ ambushsapper: character('ambushsapper', 700) });
    await vi.advanceTimersByTimeAsync(20);
    w.atlas.views.update(VIEW, { background: 'maps/ambush-secret.png' });
    await vi.advanceTimersByTimeAsync(40);
    await switched;
    await vi.advanceTimersByTimeAsync(100);

    const benWire = wireOf(ben, benFrom);
    for (const secret of [TOKEN.a, 'ambushspy', 'ambushsapper', 'ambush-secret', lastSceneId(anna)!]) expect(benWire, secret).not.toContain(secret);
    // Bridge live again: Ben's parked scene resumes (nothing changed in it) and says so.
    expect(typesOf(ben, benFrom)).toEqual(['scene-state']);
    // Ambush's players were told it is paused, and got nothing of Bridge, nor of the edits made while it switched away.
    expect(anna.received.slice(annaFrom)).toEqual([{ v: 1, type: 'scene-state', sceneId: lastSceneId(anna), paused: true }]);
    expect(wireOf(anna)).not.toContain(TOKEN.b);
  });

  it('a never-live tab gets nothing of the tab the store held before it loaded', async () => {
    const w = await splitWorld();
    await w.present('a');
    const ben = await w.join('ben');
    w.atlas.views.setLoadDelay(50);
    const assigned = w.hub.assign(ben.playerId, tab('c'));
    await vi.advanceTimersByTimeAsync(0);
    w.editTokens({ ambushspy: character('ambushspy', 600) });
    await vi.advanceTimersByTimeAsync(100);
    await assigned;
    const after = ben.received.findIndex((message, index) => index > 0 && message.type === 'scene-clear');
    expect(typesOf(ben, after)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(wireOf(ben, after)).toContain(TOKEN.c);
    for (const secret of [TOKEN.a, 'ambushspy']) expect(wireOf(ben, after)).not.toContain(secret);
  });

  it('a snapshot without tabId is attributed to no slot', async () => {
    const w = await splitWorld();
    await w.present('a');
    const anna = await w.join('anna');
    const from = anna.received.length;
    // The store holds a map that is no tab's (its path is not the active tab's): it names no tab.
    w.atlas.views.setSnapshot(VIEW, { ...tabScene('a', { strayghost: character('strayghost', 500) }), mapPath: 'maps/stray.atlasmap' });
    await w.tick();
    expect(w.tabs.liveTab()).toBeNull();
    expect(wireOf(anna, from)).not.toContain('strayghost');
    expect(anna.received.slice(from)).toEqual([]);
    // The tab's own map back: a full snapshot of it, as after a reload in place.
    w.atlas.views.setSnapshot(VIEW, tabScene('a'));
    await w.tick();
    expect(typesOf(anna, from)).toEqual(['scene-snapshot']);
    expect(wireOf(anna, from)).not.toContain('strayghost');
  });
});
