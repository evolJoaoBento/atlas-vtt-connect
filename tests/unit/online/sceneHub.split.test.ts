import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projections } = vi.hoisted(() => ({ projections: { count: 0 } }));
vi.mock('../../../src/app/online/scene/projectForPlayers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/app/online/scene/projectForPlayers')>();
  return {
    ...actual,
    projectForPlayers: (...args: Parameters<typeof actual.projectForPlayers>): ReturnType<typeof actual.projectForPlayers> => {
      projections.count++;
      return actual.projectForPlayers(...args);
    },
  };
});

import { closedNotice, couldntOpen } from '../../../src/app/online/split/splitCopy';
import type { SceneSlot } from '../../../src/app/online/scene/SceneSlot';
import { character, lastSceneId, splitWorld, tab, TOKEN, typesOf, VIEW, wireOf, type SplitWorld } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna follows the presented Ambush; Ben is assigned to Bridge, which the GM's view switched to and loaded. */
async function annaOnAmbushBenOnBridge(): Promise<{ w: SplitWorld; anna: Awaited<ReturnType<SplitWorld['join']>>; ben: Awaited<ReturnType<SplitWorld['join']>> }> {
  const w = await splitWorld();
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  const assigned = w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  await expect(assigned).resolves.toBe('ok');
  return { w, anna, ben };
}

const slotsOf = (w: SplitWorld): SceneSlot[] => [...(w.hub as unknown as { slots: Map<string, SceneSlot> }).slots.values()];

describe('SceneHub with a split party', () => {
  it('a player assigned to B gets a clear, then B\'s snapshot, and nothing of A after it', async () => {
    const { w, anna, ben } = await annaOnAmbushBenOnBridge();
    const clear = ben.received.findIndex((message) => message.type === 'scene-clear' && ben.received.indexOf(message) > 0);
    expect(typesOf(ben)).toEqual(['scene-snapshot', 'scene-clear', 'scene-snapshot']);
    expect(wireOf(ben, clear)).toContain(TOKEN.b);
    expect(wireOf(ben, clear)).not.toContain(TOKEN.a);
    w.editTokens({ bridgeogre: character('bridgeogre', 400) });
    await w.tick();
    expect(typesOf(ben).at(-1)).toBe('scene-patch');
    expect(wireOf(ben, clear)).not.toContain(TOKEN.a);
    // Anna's Ambush is parked meanwhile: she was told, and got nothing of Bridge.
    expect(typesOf(anna)).toEqual(['scene-snapshot', 'scene-state']);
    expect(wireOf(anna)).not.toContain(TOKEN.b);
    expect(wireOf(anna)).not.toContain('bridgeogre');
  });

  it('only the live slot is projected per tick, whatever the number of parked slots', async () => {
    const w = await splitWorld();
    await w.present('a');
    const players = await Promise.all(['b', 'c', 'd'].map((name) => w.join(`p-${name}`)));
    for (const [index, tabId] of (['b', 'c', 'd'] as const).entries()) {
      void w.hub.assign(players[index]!.playerId, tab(tabId));
      await vi.advanceTimersByTimeAsync(0);
    }
    // Four scenes in use: Ambush, Bridge and Cave parked, Den live.
    expect(slotsOf(w).map((slot) => [slot.tab.tabId, slot.state])).toEqual([['a', 'parked'], ['b', 'parked'], ['c', 'parked'], ['d', 'live']]);
    projections.count = 0;
    w.editTokens({ denbear: character('denbear', 500) });
    await w.tick();
    expect(projections.count).toBe(1);
  });

  it('a parked slot\'s players get scene-state paused and no patches', async () => {
    const { w, ben } = await annaOnAmbushBenOnBridge();
    await w.switchTo('a');
    const before = ben.received.length;
    w.editTokens({ ambushgoblin: character('ambushgoblin', 300) });
    await w.tick();
    await w.tick();
    expect(ben.received.slice(before).map((message) => message.type)).toEqual([]);
    expect(ben.received.at(-1)).toEqual({ v: 1, type: 'scene-state', sceneId: lastSceneId(ben), paused: true });
    expect(wireOf(ben)).not.toContain('ambushgoblin');
  });

  it('a returning player gets their slot\'s cached snapshot, not the presented scene', async () => {
    const { w, ben } = await annaOnAmbushBenOnBridge();
    await w.switchTo('a');
    const bridgeId = lastSceneId(ben);
    ben.link.close();
    await vi.advanceTimersByTimeAsync(10);
    const again = await w.join('ben');
    await vi.advanceTimersByTimeAsync(0);
    expect(again.playerId).toBe(ben.playerId);
    expect(typesOf(again)).toEqual(['scene-snapshot', 'scene-state']);
    expect(lastSceneId(again)).toBe(bridgeId);
    expect(wireOf(again)).toContain(TOKEN.b);
    expect(wireOf(again)).not.toContain(TOKEN.a);
  });

  it('presenting B turns players assigned to B into followers of the new presentation', async () => {
    const { w, anna, ben } = await annaOnAmbushBenOnBridge();
    const bridgeId = lastSceneId(ben);
    const before = ben.received.length;
    await w.present('b');
    expect(w.assignments.assignedCount()).toBe(0);
    expect(typesOf(ben, before)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(lastSceneId(ben)).not.toBe(bridgeId);
    // Anna follows the new presentation too, with the same scene as Ben.
    expect(lastSceneId(anna)).toBe(lastSceneId(ben));
    expect(w.hub.currentProjection()?.sceneId).toBe(lastSceneId(ben));
  });

  it('a tab closed under its players sends them to the presented scene and tells the GM', async () => {
    const { w, anna, ben } = await annaOnAmbushBenOnBridge();
    await w.switchTo('a');
    const before = ben.received.length;
    w.atlas.views.closeTab(VIEW, 'b');
    await vi.advanceTimersByTimeAsync(0);
    expect(typesOf(ben, before)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(lastSceneId(ben)).toBe(lastSceneId(anna));
    expect(w.notices).toContain(closedNotice(['ben'], 'Bridge'));
    expect(w.hub.scenes().map((scene) => scene.tab.tabId)).toEqual(['a']);
  });

  it('a never-live tab switches the GM view and its players wait until it loads', async () => {
    const w = await splitWorld();
    await w.present('a');
    const ben = await w.join('ben');
    w.atlas.views.setLoadDelay(100);
    const assigned = w.hub.assign(ben.playerId, tab('c'));
    await vi.advanceTimersByTimeAsync(50);
    expect(w.atlas.views.tabsOf(VIEW)?.activeTabId).toBe('c');
    expect(typesOf(ben)).toEqual(['scene-snapshot', 'scene-clear']);
    await vi.advanceTimersByTimeAsync(60);
    await expect(assigned).resolves.toBe('ok');
    expect(typesOf(ben)).toEqual(['scene-snapshot', 'scene-clear', 'scene-snapshot']);
    expect(wireOf(ben, 2)).toContain(TOKEN.c);
  });

  it('showTab false undoes the assignment and reports couldnt-open', async () => {
    const w = await splitWorld();
    await w.present('a');
    const ben = await w.join('ben');
    w.atlas.views.setLoadDelay(100);
    const assigned = w.hub.assign(ben.playerId, tab('c'));
    await vi.advanceTimersByTimeAsync(20);
    // The GM clicks another tab before Cave loaded: Atlas answers false.
    void w.atlas.views.switchTab(VIEW, 'd', { loadDelayMs: 10 });
    await vi.advanceTimersByTimeAsync(200);
    await expect(assigned).resolves.toBe('couldnt-open');
    expect(w.assignments.tabOf(ben.playerId)).toBeNull();
    expect(w.notices).toContain(couldntOpen('Cave'));
    // Back on the presented Ambush, parked: its snapshot and paused; nothing of Cave or Den ever reached him.
    expect(typesOf(ben)).toEqual(['scene-snapshot', 'scene-clear', 'scene-snapshot', 'scene-state']);
    expect(wireOf(ben)).not.toContain(TOKEN.c);
    expect(wireOf(ben)).not.toContain(TOKEN.d);
  });

  it('a rules change re-projects parked slots and patches only their players (D8)', async () => {
    const { w, anna, ben } = await annaOnAmbushBenOnBridge();
    await w.switchTo('a');
    const [annaBefore, benBefore] = [anna.received.length, ben.received.length];
    w.setRules({ showTokenNameplates: true });
    await w.tick();
    const benPatch = ben.received.slice(benBefore);
    expect(benPatch.map((message) => message.type)).toEqual(['scene-patch']);
    expect(JSON.stringify(benPatch)).toContain(TOKEN.b);
    expect(JSON.stringify(benPatch)).not.toContain(TOKEN.a);
    const annaPatch = anna.received.slice(annaBefore);
    expect(annaPatch.map((message) => message.type)).toEqual(['scene-patch']);
    expect(JSON.stringify(annaPatch)).not.toContain(TOKEN.b);
  });

  it('drops the fog coverage of a parked slot', async () => {
    const { w } = await annaOnAmbushBenOnBridge();
    expect(slotsOf(w).map((slot) => [slot.tab.tabId, slot.state, slot.hasFogCoverage()])).toEqual([['a', 'parked', false], ['b', 'live', true]]);
    await w.switchTo('a');
    expect(slotsOf(w).map((slot) => [slot.tab.tabId, slot.state, slot.hasFogCoverage()])).toEqual([['a', 'live', true], ['b', 'parked', false]]);
  });

  it('refuses a fifth scene in use, and everyone back sends every player the presented scene', async () => {
    const w = await splitWorld();
    await w.present('a');
    const players = await Promise.all(['b', 'c', 'd', 'e'].map((name) => w.join(`p-${name}`)));
    for (const [index, tabId] of (['b', 'c', 'd'] as const).entries()) {
      void w.hub.assign(players[index]!.playerId, tab(tabId));
      await vi.advanceTimersByTimeAsync(0);
    }
    w.atlas.views.addTab(VIEW, { tabId: 'e', mapPath: 'maps/east.atlasmap', name: 'East' });
    await expect(w.hub.assign(players[3]!.playerId, { viewId: VIEW, tabId: 'e' })).resolves.toBe('cap');
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.assignments.assignedCount()).toBe(0);
    // The GM is on Den: Ambush is parked, so its snapshot comes with paused.
    for (const player of players.slice(0, 3)) {
      expect(typesOf(player).slice(-3), player.key).toEqual(['scene-clear', 'scene-snapshot', 'scene-state']);
      expect(lastSceneId(player)).toBe(w.hub.currentProjection()?.sceneId);
    }
  });

  it('assigning needs Atlas scene tabs', async () => {
    const w = await splitWorld();
    const older = new (w.hub.constructor as typeof import('../../../src/app/online/scene/SceneHub').SceneHub)({
      ...(w.hub as unknown as { options: ConstructorParameters<typeof import('../../../src/app/online/scene/SceneHub').SceneHub>[0] }).options, tabs: null,
    });
    await expect(older.assign('p1', tab('b'))).rejects.toThrow('scene tabs');
  });
});
