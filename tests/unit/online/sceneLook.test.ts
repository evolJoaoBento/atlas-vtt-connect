/**
 * The dice look of a scene's collection (`dice.lookFor`, API 1.18) reaches players as `scene-look`: unsequenced and
 * scoped by `sceneId`, like `scene-state`. The presented scene's followers and each assigned scene's players get their
 * own scene's; a change reaches them at once; an Atlas without `dice-look-choice` sends nothing; an older page or
 * player that does not know the message ignores it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { lastSceneId, splitWorld, tab, TABS, type RawPlayer, type SplitWorld } from './splitFixtures';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const lookMessages = (player: RawPlayer): ControlMessage[] => player.received.filter((message) => message.type === 'scene-look');
const lookIds = (player: RawPlayer): Array<string | null | false> => lookMessages(player).map((message) => message.type === 'scene-look' && message.look);
const mapOf = (tabId: 'a' | 'b'): string => TABS.find((entry) => entry.tabId === tabId)!.mapPath;
const relisten = new Set<() => void>();
const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); };

async function world(): Promise<SplitWorld> {
  const w = await splitWorld({ diceLook: true });
  w.atlas.rules.saveCollection('camp', { maps: [mapOf('a')] });
  w.atlas.rules.saveCollection('road', { maps: [mapOf('b')] });
  return w;
}

describe('the dice look sent with a scene', () => {
  it('sends the presented scene\'s collection look to a follower, scoped to the scene', async () => {
    const w = await world();
    await w.extension.dice.useLook?.('bones', { collectionId: 'camp' });
    await w.present('a');
    await settle();
    const anna = await w.join('anna');
    expect(lookMessages(anna)).toEqual([{ v: 1, type: 'scene-look', sceneId: lastSceneId(anna), look: 'atlas-vtt-connect:bones' }]);
  });

  it('sends nothing while the collection follows a default of Atlas\'s own dice', async () => {
    const w = await world();
    await w.present('a');
    await settle();
    const anna = await w.join('anna');
    expect(lookMessages(anna)).toEqual([]);
  });

  it('tells followers when the collection\'s choice changes, and when it is cleared, but not twice for one value', async () => {
    const w = await world();
    await w.present('a');
    const anna = await w.join('anna');
    const { dice } = w.extension;
    await dice.useLook?.('bones', { collectionId: 'camp' });
    await settle();
    await dice.useLook?.('bones', { collectionId: 'camp' });
    await settle();
    expect(lookIds(anna)).toEqual(['atlas-vtt-connect:bones']);
    await dice.useLook?.(null, { collectionId: 'camp' });
    await settle();
    expect(lookIds(anna)).toEqual(['atlas-vtt-connect:bones', null]);
  });

  it('follows the GM\'s default for a collection without a choice', async () => {
    const w = await world();
    await w.present('a');
    const anna = await w.join('anna');
    await w.extension.dice.useLook?.('runes');
    await settle();
    expect(lookIds(anna)).toEqual(['atlas-vtt-connect:runes']);
  });

  it('gives each assigned scene its own collection\'s look, a parked scene\'s too', async () => {
    const w = await world();
    const { dice } = w.extension;
    await dice.useLook?.('bones', { collectionId: 'camp' });
    await dice.useLook?.('coins', { collectionId: 'road' });
    await w.present('a');
    const anna = await w.join('anna');
    const ben = await w.join('ben');
    const assigned = w.hub.assign(ben.playerId, tab('b'));
    await settle();
    await assigned;
    expect(lookIds(anna)).toEqual(['atlas-vtt-connect:bones']);
    expect(lookMessages(ben).at(-1)).toEqual({ v: 1, type: 'scene-look', sceneId: lastSceneId(ben), look: 'atlas-vtt-connect:coins' });
    // Anna's scene is parked now (the GM is on Bridge); a change of its choice still reaches her, and not Ben.
    await dice.useLook?.('claws', { collectionId: 'camp' });
    await settle();
    expect(lookIds(anna).at(-1)).toBe('atlas-vtt-connect:claws');
    expect(lookIds(ben).at(-1)).toBe('atlas-vtt-connect:coins');
  });

  it('gives a player admitted later the current look', async () => {
    const w = await world();
    await w.extension.dice.useLook?.('bones', { collectionId: 'camp' });
    await w.present('a');
    await settle();
    const late = await w.join('late');
    expect(lookIds(late)).toEqual(['atlas-vtt-connect:bones']);
  });

  it('sends no look that is not a short plain id, and none for Atlas\'s own dice', async () => {
    const asked = { answer: '' as string | null };
    const w = await splitWorld({ diceLook: { lookFor: () => Promise.resolve(asked.answer), watch: (listener) => { relisten.add(listener); return () => { relisten.delete(listener); }; } } });
    await w.present('a');
    const anna = await w.join('anna');
    for (const answer of ['<img src=x onerror=1>', 'a'.repeat(101), 'two words', '']) {
      asked.answer = answer;
      for (const listener of relisten) listener();
      await settle();
    }
    expect(lookMessages(anna)).toEqual([]);
  });

  it('keeps the look it had when Atlas cannot answer, and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const w = await splitWorld({ diceLook: { lookFor: () => Promise.reject(new Error('index not loaded')), watch: () => () => undefined } });
    await w.present('a');
    const anna = await w.join('anna');
    await settle();
    expect(lookMessages(anna)).toEqual([]);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('dice look'), expect.any(Error));
  });

  it('sends nothing on an Atlas without dice-look-choice', async () => {
    const w = await splitWorld();
    await w.present('a');
    const anna = await w.join('anna');
    expect(lookMessages(anna)).toEqual([]);
  });
});

describe('scene-look on the wire', () => {
  const frame = (fields: object): string => JSON.stringify({ v: 1, type: 'scene-look', sceneId: 's', look: 'ext:look', ...fields });

  it('decodes a look id or null', () => {
    for (const look of ['ext:look', 'a', 'my-ext:Bones_2.1', null]) {
      const message = { v: 1, type: 'scene-look', sceneId: 's', look } as const;
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses markup, an empty or oversized id, a bad scene id and a missing look', () => {
    for (const fields of [{ look: '<b>x</b>' }, { look: '' }, { look: 'x'.repeat(101) }, { look: 'a b' }, { look: 3 }, { look: undefined }, { sceneId: '' }, { sceneId: '__proto__' }]) {
      expect(decodeControl(frame(fields))).toEqual({ kind: 'invalid', reason: 'bad-scene-look' });
    }
  });

  it('is ignored by a decoder from before it', () => {
    const before = new Set(['scene-snapshot', 'scene-state', 'scene-patch', 'scene-clear']);
    expect(decodeControl(frame({}), before)).toEqual({ kind: 'ignored' });
  });
});
