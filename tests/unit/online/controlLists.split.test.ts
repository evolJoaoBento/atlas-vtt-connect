import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { character, splitWorld, tab, TOKEN, type RawPlayer, type SplitWorld } from './splitFixtures';
import { listsOf, tokenPart } from './splitParts';
import type { TokenControlHost } from '../../../src/app/online/control/TokenControlHost';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna and Ben each control Ambush's and Bridge's token; Anna follows the presented Ambush, Ben is not assigned yet. */
async function party(): Promise<{ w: SplitWorld; host: TokenControlHost; anna: RawPlayer; ben: RawPlayer }> {
  const w = await splitWorld();
  const host = tokenPart(w);
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  for (const player of [anna, ben]) for (const id of [TOKEN.a, TOKEN.b]) host.control.set(id, player.playerId, true);
  return { w, host, anna, ben };
}

describe('ControlLists with a split party', () => {
  it('lists only the player\'s tokens in their own scene while split', async () => {
    const { w, anna, ben } = await party();
    expect(listsOf(ben).at(-1)).toEqual([TOKEN.a, TOKEN.b]);
    const [annaBefore, benBefore] = [anna.received.length, ben.received.length];
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(listsOf(ben, benBefore).at(-1)).toEqual([TOKEN.b]);
    expect(listsOf(anna, annaBefore)).toEqual([[TOKEN.a]]);
    // Not one id of Ambush reached Ben in a list since he moved, nor of Bridge reached Anna.
    expect(listsOf(ben, benBefore).flat()).not.toContain(TOKEN.a);
    expect(listsOf(anna, annaBefore).flat()).not.toContain(TOKEN.b);
  });

  it('without a split sends today\'s list and nothing on a fog reveal', async () => {
    const { w, host, anna } = await party();
    w.editTokens({ ambushspy: character('ambushspy', 500, 140, { isHidden: true }) });
    await w.tick();
    host.control.set('ambushspy', anna.playerId, true);
    expect(listsOf(anna).at(-1)).toEqual([TOKEN.a, TOKEN.b, 'ambushspy']);
    const before = anna.received.length;
    w.editTokens({ ambushspy: character('ambushspy', 500) });
    await w.tick();
    expect(anna.received.slice(before).map((message) => message.type)).toEqual(['scene-patch']);
  });

  it('a move resends the list for the new scene', async () => {
    const { w, anna, ben } = await party();
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    const benBefore = ben.received.length;
    void w.hub.assign(ben.playerId, tab('c'));
    await vi.advanceTimersByTimeAsync(0);
    // Cave shows neither of his tokens.
    expect(listsOf(ben, benBefore)).toEqual([[]]);
    // Back to Bridge, out of use since he left: the view switches to it, and its list follows its snapshot.
    const back = ben.received.length;
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ben.received.slice(back).map((message) => message.type)).toEqual(['scene-clear', 'token-control', 'scene-snapshot', 'token-control']);
    expect(listsOf(ben, back)).toEqual([[], [TOKEN.b]]);
    // The last assignment goes: everyone gets today's list once.
    const [annaBefore, benAgain] = [anna.received.length, ben.received.length];
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(0);
    expect(listsOf(anna, annaBefore)).toEqual([[TOKEN.a, TOKEN.b]]);
    expect(listsOf(ben, benAgain)).toEqual([[TOKEN.a, TOKEN.b]]);
  });

  it('a token revealed in the player\'s scene while split is sent to them', async () => {
    const { w, host, ben } = await party();
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    w.editTokens({ bridgespy: character('bridgespy', 500, 140, { isHidden: true }) });
    await w.tick();
    host.control.set('bridgespy', ben.playerId, true);
    expect(listsOf(ben).at(-1)).toEqual([TOKEN.b]);
    const before = ben.received.length;
    w.editTokens({ bridgespy: character('bridgespy', 500) });
    await w.tick();
    await w.tick();
    expect(listsOf(ben, before)).toEqual([[TOKEN.b, 'bridgespy']]);
  });

  it('a tab switch deletes nothing; a token deleted from the shown scene loses its controllers', async () => {
    const { w, host, ben } = await party();
    void w.hub.assign(ben.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    await w.switchTo('a');
    await w.switchTo('b', 30);
    expect(host.control.tokensOf(ben.playerId)).toEqual([TOKEN.a, TOKEN.b]);
    const scene = w.atlas.views.sceneOf('gm')!;
    const { [TOKEN.b]: _gone, ...rest } = scene.objects.tokens;
    w.atlas.views.update('gm', { objects: { ...scene.objects, tokens: rest } });
    expect(host.control.tokensOf(ben.playerId)).toEqual([TOKEN.a]);
  });
});
