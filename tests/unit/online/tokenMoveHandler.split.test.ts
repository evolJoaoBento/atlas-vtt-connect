import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastSceneId, splitWorld, tab, TOKEN, VIEW, type RawPlayer, type SplitWorld } from './splitFixtures';
import { dropToken, tokenPart } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna follows the presented Ambush and controls its token; Ben is on Bridge, live, and controls its token. */
async function party(): Promise<{ w: SplitWorld; anna: RawPlayer; ben: RawPlayer }> {
  const w = await splitWorld();
  const host = tokenPart(w);
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  host.control.set(TOKEN.a, anna.playerId, true);
  host.control.set(TOKEN.b, ben.playerId, true);
  void w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  return { w, anna, ben };
}

const refusals = (player: RawPlayer): string[] => player.received.flatMap((message) => (message.type === 'token-move-refused' ? [message.tokenId] : []));
const xOf = (w: SplitWorld, tokenId: string): number | undefined => w.atlas.views.sceneOf(VIEW)?.objects.tokens[tokenId]?.x;

describe('TokenMoveHandler with a split party', () => {
  it('refuses a move on a parked scene and writes nothing', async () => {
    const { w, anna } = await party();
    const undo = w.atlas.tokens.undoSteps(VIEW);
    dropToken(anna, lastSceneId(anna)!, TOKEN.a, 600);
    expect(refusals(anna)).toEqual([TOKEN.a]);
    expect(xOf(w, TOKEN.a)).toBeUndefined();
    expect(w.atlas.tokens.undoSteps(VIEW)).toBe(undo);
  });

  it('refuses a move whose sceneId is another slot\'s', async () => {
    const { w, anna, ben } = await party();
    dropToken(ben, lastSceneId(anna)!, TOKEN.b, 600);
    expect(refusals(ben)).toEqual([TOKEN.b]);
    expect(xOf(w, TOKEN.b)).toBe(140);
  });

  it('a move on the live slot lands through tokens.move on that slot\'s view', async () => {
    const { w, ben } = await party();
    dropToken(ben, lastSceneId(ben)!, TOKEN.b, 600);
    expect(refusals(ben)).toEqual([]);
    expect(xOf(w, TOKEN.b)).not.toBe(140);
  });

  it('a move does not land once the GM started switching away', async () => {
    const { w, ben } = await party();
    const undo = w.atlas.tokens.undoSteps(VIEW);
    const switched = w.atlas.views.switchTab(VIEW, 'a', { loadDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(10);
    dropToken(ben, lastSceneId(ben)!, TOKEN.b, 600);
    expect(refusals(ben)).toEqual([TOKEN.b]);
    expect(w.atlas.tokens.undoSteps(VIEW)).toBe(undo);
    await vi.advanceTimersByTimeAsync(50);
    await switched;
  });
});
