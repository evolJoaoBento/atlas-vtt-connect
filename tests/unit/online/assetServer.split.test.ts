import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { character, splitWorld, tab, TOKEN, type RawPlayer, type SplitWorld } from './splitFixtures';
import { assetClient, assetPart, idOf, type AssetClient } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const shared = (id: string): ReturnType<typeof character> => character(id, 300, 140, { imagePath: 'art/shared.png' });

/**
 * Anna follows the presented Ambush; Ben is on Bridge, live. Both scenes show `art/shared.png`, and each player's
 * scene holds every fingerprint before the test asks for anything.
 */
async function split(): Promise<{ w: SplitWorld; anna: RawPlayer; ben: RawPlayer; annaAssets: AssetClient; benAssets: AssetClient }> {
  const w = await splitWorld({ images: true });
  assetPart(w);
  await w.present('a');
  w.editTokens({ ambushshared: shared('ambushshared') });
  await w.tick();
  await w.tick();
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  void w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  w.editTokens({ bridgeshared: shared('bridgeshared') });
  await w.tick();
  await w.tick();
  expect(w.hub.slotOf(anna.playerId)?.lastSent?.map.asset).toBe(idOf('maps/a.png'));
  expect(w.hub.slotOf(ben.playerId)?.lastSent?.tokens.bridgeshared?.image).toBe(idOf('art/shared.png'));
  return { w, anna, ben, annaAssets: assetClient(anna), benAssets: assetClient(ben) };
}

describe('AssetServer with a split party', () => {
  it('a player on A is denied an image only B uses', async () => {
    const { annaAssets, benAssets } = await split();
    annaAssets.request(['maps/b.png', `art/${TOKEN.b}.png`]);
    benAssets.request(['maps/b.png']);
    await vi.advanceTimersByTimeAsync(0);
    expect(annaAssets.log()).toEqual(['asset-denied:maps/b.png', `asset-denied:art/${TOKEN.b}.png`]);
    expect(benAssets.log()).toEqual(['asset-start:maps/b.png', 'end:maps/b.png']);
  });

  it('the presented scene\'s images are denied to a player on another scene', async () => {
    const { annaAssets, benAssets } = await split();
    benAssets.request(['maps/a.png', `art/${TOKEN.a}.png`]);
    annaAssets.request(['maps/a.png']);
    await vi.advanceTimersByTimeAsync(0);
    expect(benAssets.log()).toEqual(['asset-denied:maps/a.png', `asset-denied:art/${TOKEN.a}.png`]);
    expect(annaAssets.log()).toEqual(['asset-start:maps/a.png', 'end:maps/a.png']);
  });

  it('moving a player cancels their in-flight transfer of an image the new scene lacks', async () => {
    const { w, ben, benAssets } = await split();
    // Two of Bridge's images: the first is being read, the second waits behind it.
    benAssets.request(['maps/b.png', `art/${TOKEN.b}.png`]);
    w.hub.unassign(ben.playerId);
    await vi.advanceTimersByTimeAsync(0);
    expect(benAssets.log()).toEqual(['asset-denied:maps/b.png']);
    // Asked again on Ambush: denied at once.
    benAssets.request(['maps/b.png']);
    await vi.advanceTimersByTimeAsync(0);
    expect(benAssets.log().at(-1)).toBe('asset-denied:maps/b.png');
  });

  it('an image both scenes use keeps streaming across the move', async () => {
    const { w, ben, benAssets } = await split();
    benAssets.request(['art/shared.png']);
    w.hub.unassign(ben.playerId);
    await vi.advanceTimersByTimeAsync(0);
    expect(benAssets.log()).toEqual(['asset-start:art/shared.png', 'end:art/shared.png']);
  });

  it('a request that arrived before a move is checked again when its image starts', async () => {
    const { w, anna, annaAssets } = await split();
    // Ambush's map is being read; its token art waits. Anna moves to Bridge, which has neither.
    annaAssets.request(['art/shared.png', `art/${TOKEN.a}.png`]);
    void w.hub.assign(anna.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(annaAssets.log()).toEqual(['asset-start:art/shared.png', 'end:art/shared.png']);
    expect(annaAssets.log()).not.toContain(`asset-start:art/${TOKEN.a}.png`);
  });
});
