import type { DiceRules } from '@atlas-vtt/api-types';
import { persistableDiceLog, rollFormula } from '@atlas-vtt/shared/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DICE_LIMITS } from '../../../src/app/online/tools/toolMessages';
import { TAVERN_MAP } from './presentedFixtures';
import { toolsWorld } from './toolsFixtures';

type World = ReturnType<typeof toolsWorld>;

/** The collection holding the Tavern map saves these dice rules. */
function setDiceRules(w: World, dice: DiceRules): void {
  w.atlas.rules.saveCollection('c1', { maps: [TAVERN_MAP], dice });
}

describe('DiceHost', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('replays the latest 50 rolls on admission, newest first, even when there are none', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(w.logs(a)).toEqual([{ v: 1, type: 'dice-log', entries: [], replay: true }]);
    for (let i = 0; i < 55; i++) w.publish(rollFormula(`${i + 1}d4`));
    expect(w.logs(a).filter((log) => !log.replay)).toHaveLength(55);
    const b = await w.join('B');
    const [replay] = w.logs(b);
    expect(replay?.replay).toBe(true);
    expect(replay?.entries).toHaveLength(DICE_LIMITS.logEntries);
    expect(replay?.entries[0]?.formula).toBe('55d4');
    expect(replay?.entries.at(-1)?.formula).toBe('6d4');
    w.finish();
  });

  it("rolls a player's roll with Atlas's dice code, named after them", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(a.session.sendDiceRoll({ d20: 1 }, 2)).toBe(true);
    expect(w.logged).toHaveLength(1);
    expect(w.logged[0]).toMatchObject({ formula: 'd20+2', rolledBy: 'A', total: 13 });
    // Nothing is stored: a player's roll stays in the live log, out of the map file's.
    expect(persistableDiceLog(w.logged)).toEqual([]);
    w.finish();
  });

  it('ignores more than two rolls a second from one player', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    for (let i = 0; i < 3; i++) a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logged).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logged).toHaveLength(3);
    w.finish();
  });

  it('names a roll for a hidden token GM, and a roll for a visible one by its token', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'orc', tokenName: 'Orc', abilityName: 'Axe' } });
    w.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'hero', tokenName: 'Hero' } });
    w.publish(rollFormula('d20'));
    expect(w.logs(a).slice(-3).map((log) => log.entries[0]?.name)).toEqual(['GM', 'Hero', 'GM']);
    expect(JSON.stringify(a.received)).not.toContain('Orc');
    w.finish();
  });

  it('names a roll only from what players see: a fogged token or nameplates off make it "GM"', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const roll = (tokenId: string, tokenName: string): void => w.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId, tokenName } });
    roll('goblin', 'Goblin');
    roll('hero', 'Hero');
    expect(w.logs(a).slice(-2).map((log) => log.entries[0]?.name)).toEqual(['GM', 'Hero']);
    const b = await w.join('B');
    expect(w.logs(b)[0]?.entries.map((entry) => entry.name)).toEqual(['Hero', 'GM']);
    expect(JSON.stringify(b.received)).not.toContain('Goblin');
    w.finish();
    const quiet = toolsWorld({ rules: { showTokenNameplates: false } });
    quiet.present();
    const c = await quiet.join('C');
    quiet.publish({ ...rollFormula('d20'), source: { type: 'statblock', tokenId: 'hero', tokenName: 'Hero' } });
    expect(quiet.logs(c).slice(-1).map((log) => log.entries[0]?.name)).toEqual(['GM']);
    quiet.finish();
  });

  it('never names a token without a live presented token id, in the log or the replay', async () => {
    const w = toolsWorld();
    const a = await w.join('A');
    const statblock = (tokenId?: string): ReturnType<typeof rollFormula> => ({
      ...rollFormula('d20'), source: { type: 'statblock', ...(tokenId ? { tokenId } : {}), tokenName: 'Hero', abilityName: 'Axe' },
    });
    // Nothing presented yet: even a token that exists later is not named.
    w.publish(statblock('hero'));
    w.present();
    // A statblock note roll has no token id; an unknown id names nothing either.
    w.publish(statblock());
    w.publish(statblock('nobody'));
    // Held: the store shows another map than the one players have.
    w.tabs.getState().setActiveTab(w.dungeon);
    w.publish(statblock('hero'));
    w.tabs.getState().setActiveTab(w.tavern);
    await vi.advanceTimersByTimeAsync(100);
    w.publish(statblock('hero'));
    const live = w.logs(a).slice(1).map((log) => log.entries[0]?.name);
    expect(live).toEqual(['GM', 'GM', 'GM', 'GM', 'Hero']);
    const b = await w.join('B');
    expect(w.logs(b)[0]?.entries.map((entry) => entry.name)).toEqual(['Hero', 'GM', 'GM', 'GM', 'GM']);
    w.finish();
  });

  it('shows a player called GM as "GM (player)"', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join(' gM ');
    const b = await w.join('Bea');
    a.session.sendDiceRoll({ d6: 1 }, 0);
    b.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logs(b).slice(1).map((log) => log.entries[0]?.name)).toEqual(['GM (player)', 'Bea']);
    w.finish();
  });

  it('shows a player called GM with a zero-width space as "GM (player)"', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('G\u200BM');
    const b = await w.join('Bea');
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logs(b).slice(1).map((log) => log.entries[0]?.name)).toEqual(['GM (player)']);
    w.finish();
  });

  it("rolls a player's roll by the dice rules of the presented scene's collection", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    // `default` explosions and crits look only at the default roll's dice: the d20, never the d6.
    setDiceRules(w, { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 0 } });
    w.atlas.dice.setRandom(() => 0.999);
    a.session.sendDiceRoll({ d6: 1, d20: 1 }, 0);
    expect(w.atlas.dice.rolledFor).toEqual([TAVERN_MAP]);
    const [rolled] = w.logged;
    expect(rolled?.rolls).toEqual([
      { die: 'd6', value: 6, max: 6 }, { die: 'd20', value: 20, max: 20 }, { die: 'd20', value: 20, max: 20, exploded: true },
    ]);
    expect(rolled?.crit).toBe('high');
    expect(w.logs(a).at(-1)?.entries[0]).toMatchObject({
      dice: [{ die: 'd6', value: 6 }, { die: 'd20', value: 20 }, { die: 'd20', value: 20, exploded: true }], total: 46, crit: 'high',
    });
    w.finish();
  });

  it("follows a doubles rule, and a player's roll without the rule's default dice never crits", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    setDiceRules(w, { defaultRoll: '2d12', crit: 'doubles' });
    a.session.sendDiceRoll({ d12: 2 }, 0);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d20: 1 }, 0);
    expect(w.logged.map((roll) => roll.crit)).toEqual(['high', null]);
    expect(w.logs(a).slice(-2).map((log) => log.entries[0]?.crit)).toEqual(['high', undefined]);
    w.finish();
  });

  it('takes the rules of the map players have while the GM holds the scene on another tab', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    a.session.sendDiceRoll({ d6: 1 }, 0);
    w.tabs.getState().setActiveTab(w.dungeon);
    vi.advanceTimersByTime(1000);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.atlas.dice.rolledFor).toEqual([TAVERN_MAP, TAVERN_MAP]);
    w.finish();
  });

  it('marks a roll mine only for the player who rolled it, live and in the replay', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.session.sendDiceRoll({ d6: 1 }, 0);
    w.publish(rollFormula('d8'));
    expect(w.logs(a).slice(-2).map((log) => log.entries[0]?.mine)).toEqual([true, undefined]);
    expect(w.logs(b).slice(-2).map((log) => log.entries[0]?.mine)).toEqual([undefined, undefined]);
    const c = await w.join('C');
    expect(w.logs(c)[0]?.entries.map((entry) => entry.mine)).toEqual([undefined, undefined]);
    expect(JSON.stringify(c.received)).not.toContain('"mine"');
    w.finish();
  });

  it("logs subtracted dice as negative, and keeps the GM's crit", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.publish({ ...rollFormula('2d6-1d4', () => 0.5), crit: 'low' });
    expect(w.logs(a).at(-1)?.entries[0]).toMatchObject({
      dice: [{ die: 'd6', value: 4 }, { die: 'd6', value: 4 }, { die: 'd4', value: 3, negative: true }], total: 5, crit: 'low',
    });
    w.finish();
  });

  it("rolls a player's roll once, through Atlas, so every player's log gets one entry for it", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const before = [w.logs(a).length, w.logs(b).length];
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logged).toHaveLength(1);
    expect(w.atlas.dice.rolledFor).toEqual([TAVERN_MAP]);
    expect([w.logs(a).length, w.logs(b).length]).toEqual([before[0]! + 1, before[1]! + 1]);
    expect(w.logs(a).at(-1)?.entries).toHaveLength(1);
    w.finish();
  });

  it('lists the first 100 dice of a roll and counts the rest as more, with the total of them all', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    // Atlas rolls at most 100 dice, so a roll of more comes from elsewhere (physical dice) and is published as it is.
    const rolled = rollFormula('100d4', () => 0.5, 1);
    w.publish({ ...rolled, rolls: [...rolled.rolls, ...rolled.rolls.slice(0, 20)], total: 360 });
    const [entry] = w.logs(a).at(-1)?.entries ?? [];
    expect(entry).toMatchObject({ unlisted: 20, total: 360 });
    expect(entry?.dice).toHaveLength(DICE_LIMITS.entryDice);
    w.finish();
  });

  it('keeps the exploded flag on a die the explosion rolled, and the crit of the rules, in the log', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    setDiceRules(w, { defaultRoll: '1d6', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } });
    w.atlas.dice.setRandom(() => 0.999);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.logs(a).at(-1)?.entries[0]).toMatchObject({ dice: [{ die: 'd6', value: 6 }, { die: 'd6', value: 6, exploded: true }], crit: 'high' });
    w.finish();
  });

  it('stops listening to the dice log, and rolls nothing, once the host stops', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    expect(w.atlas.dice.listening()).toBe(2);
    w.dice.stop();
    expect(w.atlas.dice.listening()).toBe(1);
    const count = w.logs(a).length;
    a.session.sendDiceRoll({ d6: 1 }, 0);
    w.publish(rollFormula('d6'));
    expect(w.logs(a)).toHaveLength(count);
    expect(w.logged).toHaveLength(1);
    w.finish();
  });

  it("takes the rules of the presented map when the GM holds the scene before anyone has rolled", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    // Only the Tavern's collection explodes sixes; the Dungeon has none.
    setDiceRules(w, { defaultRoll: '1d6', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } });
    w.tabs.getState().setActiveTab(w.dungeon);
    await vi.advanceTimersByTimeAsync(100);
    w.atlas.dice.setRandom(() => 0.999);
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.atlas.dice.rolledFor).toEqual([TAVERN_MAP]);
    expect(w.logged[0]?.rolls.map((die) => die.exploded === true)).toEqual([false, true]);
    w.finish();
  });

  it("takes the presented tab's rules when the live scene has no snapshot to read", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const scene = w.presented.current()!;
    vi.spyOn(w.presented, 'current').mockReturnValue({ ...scene, snapshot: () => null });
    a.session.sendDiceRoll({ d6: 1 }, 0);
    expect(w.atlas.dice.rolledFor).toEqual([TAVERN_MAP]);
    w.finish();
  });
});
