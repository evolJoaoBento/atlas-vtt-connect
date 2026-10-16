import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { SheetHost } from '../../../src/app/online/tools/SheetHost';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const HP = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains' as const, color: '#22c55e', visibleToPlayers: false };

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  const tokens: Record<string, unknown> = {
    hero: { id: 'hero', kind: 'character', x: 0, y: 0, imagePath: 'a.png', name: 'Anna', statblockPath: 'Anna.md', resources: { hp: { current: 7, max: 12 } } },
    ogre: { id: 'ogre', kind: 'character', x: 0, y: 0, imagePath: 'b.png', name: 'Ogre', statblockPath: 'Ogre.md', resources: { hp: { current: 50, max: 59 } } },
  };
  const shown: Record<string, unknown> = { hero: {}, ogre: {} };
  const slotListeners: Array<(change: never) => void> = [];
  const control = new TokenControl();
  const rollFor = vi.fn(() => true);
  const host = new SheetHost({
    session: {
      use: (h: SessionHandler) => { handler = h; return () => { handler = null; }; },
      send: (playerId: string, message: ControlMessage) => { sent.push([playerId, message]); },
      getPlayers: () => [ANA, BEN],
    } as never,
    control,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: { tokens: shown }, mapPath: 'm.atlasmap' }),
      shownSnapshot: () => ({ objects: { tokens } }),
      audience: () => ['p1', 'p2'],
      onSlotChange: (listener: (change: never) => void) => { slotListeners.push(listener); return () => undefined; },
    } as never,
    resources: () => [HP],
    readStatblock: (token) => ({ name: token.name, ac: 16, stats: [10, 14, 10, 10, 10, 10], actions: [{ name: 'Sword', desc: '+5 to hit. Hit: 1d8 + 3.' }] }),
    rollFor,
  });
  host.start();
  const sheetsFor = (playerId: string) => sent.filter(([to, message]) => to === playerId && message.type === 'token-sheets')
    .map(([, message]) => (message as Extract<ControlMessage, { type: 'token-sheets' }>).entries);
  const project = async (): Promise<void> => {
    for (const listener of slotListeners) listener({ kind: 'projected', slot: { sceneId: 's1' } } as never);
    await Promise.resolve();
  };
  return { host, control, sent, tokens, shown, sheetsFor, project, rollFor, handler: () => handler! };
}

describe('players\' own sheets', () => {
  it('sends a player only the sheets of the tokens they control, with exact numbers', () => {
    const w = world();
    w.control.set('hero', 'p1', true);
    const [ana] = w.sheetsFor('p1');
    expect(ana).toEqual([expect.objectContaining({ tokenId: 'hero', name: 'Anna', resources: [{ name: 'HP', current: 7, max: 12, color: '#22c55e' }] })]);
    expect(ana?.[0]?.sheet).toMatchObject({ name: 'Anna', ac: '16' });
    expect(w.sheetsFor('p2')).toEqual([]);
    expect(JSON.stringify(w.sent)).not.toContain('Ogre');
  });

  it('sends again only when something on them changed, and an empty list once control is taken', async () => {
    const w = world();
    w.control.set('hero', 'p1', true);
    await w.project();
    expect(w.sheetsFor('p1')).toHaveLength(1);
    (w.tokens.hero as { resources: unknown }).resources = { hp: { current: 3, max: 12 } };
    await w.project();
    expect(w.sheetsFor('p1').at(-1)?.[0]?.resources[0]?.current).toBe(3);
    w.control.set('hero', 'p1', false);
    expect(w.sheetsFor('p1').at(-1)).toEqual([]);
  });

  it('leaves out a controlled token the player\'s scene does not show', () => {
    const w = world();
    delete w.shown.hero;
    w.control.set('hero', 'p1', true);
    expect(w.sheetsFor('p1')).toEqual([[]]);
  });

  it('rolls what the sheet offers, as the player, and nothing for a token they do not control or a roll not there', () => {
    const w = world();
    w.control.set('hero', 'p1', true);
    w.handler().onMessage?.(ANA, { v: 1, type: 'sheet-roll', tokenId: 'hero', roll: { kind: 'text', section: 0, item: 0, index: 1, text: '1d8 + 3' } });
    expect(w.rollFor).toHaveBeenCalledWith(ANA, '1d8+3', { abilityName: 'Sword' });
    // A bare bonus, which Atlas adds to the dice set's default roll, with the side asked for.
    w.handler().onMessage?.(ANA, { v: 1, type: 'sheet-roll', tokenId: 'hero', roll: { kind: 'check', index: 1, side: 'advantage' } });
    expect(w.rollFor).toHaveBeenLastCalledWith(ANA, '+2', { abilityName: 'DEX check', advantage: 'advantage' });
    w.rollFor.mockClear();
    // Other text at that place (an older page cuts the text another way) rolls nothing.
    w.handler().onMessage?.(ANA, { v: 1, type: 'sheet-roll', tokenId: 'hero', roll: { kind: 'text', section: 0, item: 0, index: 1 } });
    expect(w.rollFor).not.toHaveBeenCalled();
    w.rollFor.mockClear();
    w.handler().onMessage?.(BEN, { v: 1, type: 'sheet-roll', tokenId: 'hero', roll: { kind: 'check', index: 0 } });
    w.handler().onMessage?.(ANA, { v: 1, type: 'sheet-roll', tokenId: 'ogre', roll: { kind: 'check', index: 0 } });
    w.handler().onMessage?.(ANA, { v: 1, type: 'sheet-roll', tokenId: 'hero', roll: { kind: 'save', index: 0 } });
    expect(w.rollFor).not.toHaveBeenCalled();
  });
});
