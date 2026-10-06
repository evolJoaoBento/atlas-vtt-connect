import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollRequest, DiceRollResult } from '@atlas-vtt/api-types';
import { rollFormula } from '@atlas-vtt/shared/rules';
import { character, splitWorld, tab, TABS, TOKEN, type RawPlayer, type SplitWorld } from './splitFixtures';
import { logsOf, rollD6, toolParts } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Anna follows the presented Ambush; Ben is on Bridge, which the GM's view shows. Token names are shown. */
async function party(): Promise<{ w: SplitWorld; anna: RawPlayer; ben: RawPlayer; rolls: DiceRollRequest[] }> {
  const w = await splitWorld();
  w.setRules({ showTokenNameplates: true });
  const rolls: DiceRollRequest[] = [];
  toolParts(w, rolls);
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  void w.hub.assign(ben.playerId, tab('b'));
  await vi.advanceTimersByTimeAsync(0);
  return { w, anna, ben, rolls };
}

const statblock = (tokenId: string): DiceRollResult => ({
  ...rollFormula('d20'), source: { type: 'statblock', tokenId, tokenName: 'Secret name', abilityName: 'Axe' },
});
const lastEntry = (player: RawPlayer): { name: string; scene?: string } | undefined => logsOf(player).at(-1)?.entries[0];

describe('DiceHost with a split party', () => {
  it('a player roll uses their own scene\'s rules', async () => {
    const { anna, ben, rolls } = await party();
    rollD6(ben);
    rollD6(anna);
    expect(rolls.map((request) => request.mapPath)).toEqual([TABS[1].mapPath, TABS[0].mapPath]);
  });

  it('a roll named after a token on B reads GM for players on A', async () => {
    const { w, anna, ben } = await party();
    w.extension.dice.publish(statblock(TOKEN.b));
    expect(lastEntry(ben)?.name).toBe(TOKEN.b);
    expect(lastEntry(anna)?.name).toBe('GM');
  });

  it('a roll named after a token of the presented scene reads GM for a player on another scene', async () => {
    const { w, anna, ben } = await party();
    await w.switchTo('a');
    w.extension.dice.publish(statblock(TOKEN.a));
    expect(lastEntry(anna)?.name).toBe(TOKEN.a);
    expect(lastEntry(ben)?.name).toBe('GM');
    expect(JSON.stringify(logsOf(ben))).not.toContain(TOKEN.a);
  });

  it('a token id on both scenes is named only for the scene the GM rolled it on', async () => {
    const { w, anna, ben } = await party();
    await w.switchTo('a');
    w.editTokens({ twin: character('twin', 600, 140, { name: 'Ambush twin' }) });
    await w.tick();
    await w.switchTo('b');
    w.editTokens({ twin: character('twin', 600, 140, { name: 'Bridge twin' }) });
    await w.tick();
    w.extension.dice.publish(statblock('twin'));
    expect(lastEntry(ben)?.name).toBe('Bridge twin');
    expect(lastEntry(anna)?.name).toBe('GM');
  });

  it('labels player rolls with the roller\'s scene only while more than one scene is in use (D7)', async () => {
    const { w, anna, ben } = await party();
    rollD6(ben);
    expect([lastEntry(anna)?.scene, lastEntry(ben)?.scene]).toEqual(['Bridge', 'Bridge']);
    await vi.advanceTimersByTimeAsync(1000);
    rollD6(anna);
    expect([lastEntry(anna)?.scene, lastEntry(ben)?.scene]).toEqual(['Ambush', 'Ambush']);
    w.extension.dice.publish(rollFormula('d20'));
    expect(lastEntry(anna)).not.toHaveProperty('scene');
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(1000);
    rollD6(ben);
    expect(lastEntry(anna)?.name).toBe('ben');
    expect(lastEntry(anna)).not.toHaveProperty('scene');
  });

  it('replays the shared log to a returning player with names worked out for their scene', async () => {
    const { w, anna, ben } = await party();
    w.extension.dice.publish(statblock(TOKEN.b));
    anna.link.close();
    ben.link.close();
    await vi.advanceTimersByTimeAsync(10);
    const annaAgain = await w.join('anna');
    const benAgain = await w.join('ben');
    expect(logsOf(annaAgain).at(-1)?.entries.map((entry) => entry.name)).toEqual(['GM']);
    expect(logsOf(benAgain).at(-1)?.entries.map((entry) => entry.name)).toEqual([TOKEN.b]);
  });
});
