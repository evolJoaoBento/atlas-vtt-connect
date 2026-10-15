import { describe, expect, it, vi } from 'vitest';
import { fileMemory, libraryTokenOf, PartyLinks, playerCharacterTokens, type LibraryToken, type PartyControl, type PartyPlayer, type Remembered } from '../../../src/connect/stockParty/partyLinks';
import { TokenControl } from '../../../src/app/online/control/TokenControl';

const LIBRARY: LibraryToken[] = [
  { id: 'cleric', imagePath: 'art/cleric.webp', playerCharacter: true },
  { id: 'rogue', imagePath: 'art/rogue.webp', playerCharacter: true },
  { id: 'orc', imagePath: 'art/orc.webp' },
];

const ana: PartyPlayer = { playerId: 'p-ana', name: 'Ana', status: 'admitted' };
const bea: PartyPlayer = { playerId: 'p-bea', name: 'Bea', status: 'admitted' };

/** A table with a session store, token control, a scene, and a library, as the stand-in wires them. */
function table(options: { library?: LibraryToken[]; remembered?: Remembered; players?: PartyPlayer[]; hosting?: boolean } = {}) {
  const listeners = new Set<() => void>();
  let players = options.players ?? [ana];
  let control: TokenControl | null = options.hosting === false ? null : new TokenControl();
  let tokens: Record<string, { assetId?: string; imagePath?: string }> | null = { t1: { assetId: 'cleric', imagePath: 'art/cleric.webp' }, t2: { assetId: 'orc', imagePath: 'art/orc.webp' } };
  const sceneListeners = new Set<() => void>();
  const saved: Remembered[] = [];
  let reads = 0;
  const links = new PartyLinks({
    session: { state: () => ({ players, tokenControl: control as PartyControl | null }), subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    tokens: () => tokens,
    watchScene: (listener) => { sceneListeners.add(listener); return () => { sceneListeners.delete(listener); }; },
    library: () => { reads++; return Promise.resolve(options.library ?? LIBRARY); },
    memory: { load: () => Promise.resolve(options.remembered ?? {}), save: (remembered) => { saved.push({ ...remembered }); return Promise.resolve(); } },
  }, () => 0);
  links.start();
  const settle = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0); };
  return {
    links, saved, settle, reads: () => reads,
    control: () => control!,
    setControl: (next: TokenControl | null) => { control = next; for (const l of [...listeners]) l(); },
    setPlayers: (next: PartyPlayer[]) => { players = next; for (const l of [...listeners]) l(); },
    setTokens: (next: typeof tokens) => { tokens = next; for (const l of [...sceneListeners]) l(); },
  };
}

describe('player characters and online players', () => {
  describe('telling a player character', () => {
    it('finds the library token by its id, then by its art, and none for what is not in the library', () => {
      expect(libraryTokenOf({ assetId: 'orc', imagePath: 'art/cleric.webp' }, LIBRARY)?.id).toBe('orc');
      expect(libraryTokenOf({ assetId: 'gone', imagePath: 'art/rogue.webp' }, LIBRARY)?.id).toBe('rogue');
      expect(libraryTokenOf({ imagePath: 'art/cleric.webp' }, LIBRARY)?.id).toBe('cleric');
      expect(libraryTokenOf({ imagePath: 'art/none.webp' }, LIBRARY)).toBeNull();
      expect(libraryTokenOf({}, LIBRARY)).toBeNull();
    });

    it('lists the placed tokens that are player characters, with the character each is', () => {
      const found = playerCharacterTokens({ a: { assetId: 'cleric' }, b: { imagePath: 'art/rogue.webp' }, c: { assetId: 'orc' }, d: undefined, e: { assetId: 'cleric' } }, LIBRARY);
      expect([...found]).toEqual([['a', 'cleric'], ['b', 'rogue'], ['e', 'cleric']]);
    });
  });

  describe('remembering and giving back', () => {
    it('learns who a character was given to, and gives each placed token of it to them on any scene', async () => {
      vi.useFakeTimers();
      const t = table();
      await t.settle();
      t.control().set('t1', 'p-ana', true);
      await t.settle();
      expect(t.links.links).toEqual({ cleric: 'Ana' });
      expect(t.saved).toEqual([{ cleric: 'Ana' }]);
      // Another scene: the same character placed under other ids, and a second copy of it.
      t.setTokens({ x1: { assetId: 'cleric' }, x2: { imagePath: 'art/cleric.webp' }, x3: { assetId: 'orc' } });
      await t.settle();
      expect(t.control().controls('p-ana', 'x1')).toBe(true);
      expect(t.control().controls('p-ana', 'x2')).toBe(true);
      // A token that is no player character is nobody's.
      expect(t.control().controls('p-ana', 'x3')).toBe(false);
      vi.useRealTimers();
    });

    it('gives characters to the players they were given to in an earlier session, by name', async () => {
      vi.useFakeTimers();
      const t = table({ remembered: { cleric: 'Ana', rogue: 'Bea' }, players: [bea, ana] });
      await t.settle();
      expect(t.control().controls('p-ana', 't1')).toBe(true);
      expect(t.control().controls('p-bea', 't1')).toBe(false);
      t.setTokens({ r: { assetId: 'rogue' } });
      await t.settle();
      expect(t.control().controls('p-bea', 'r')).toBe(true);
      vi.useRealTimers();
    });

    it('waits for the player: not at the table, still waiting to be admitted, or in the room twice', async () => {
      vi.useFakeTimers();
      const t = table({ remembered: { cleric: 'Ana' }, players: [] });
      await t.settle();
      expect(t.control().assignedTokens()).toEqual([]);
      t.setPlayers([{ ...ana, status: 'pending' }]);
      await t.settle();
      expect(t.control().assignedTokens()).toEqual([]);
      t.setPlayers([ana, { ...ana, playerId: 'p-ana-2' }]);
      await t.settle();
      expect(t.control().assignedTokens()).toEqual([]);
      t.setPlayers([ana]);
      await t.settle();
      expect(t.control().controls('p-ana', 't1')).toBe(true);
      vi.useRealTimers();
    });

    it('forgets a character the GM takes from its player, and does not give it back', async () => {
      vi.useFakeTimers();
      const t = table({ remembered: { cleric: 'Ana' } });
      await t.settle();
      expect(t.control().controls('p-ana', 't1')).toBe(true);
      t.control().set('t1', 'p-ana', false);
      await t.settle();
      expect(t.control().controls('p-ana', 't1')).toBe(false);
      expect(t.links.links).toEqual({});
      expect(t.saved.at(-1)).toEqual({});
      t.setTokens({ x: { assetId: 'cleric' } });
      await t.settle();
      expect(t.control().assignedTokens()).toEqual([]);
      vi.useRealTimers();
    });

    it('keeps a character when its player leaves, and gives it back when they return', async () => {
      vi.useFakeTimers();
      const t = table({ remembered: { cleric: 'Ana' } });
      await t.settle();
      t.setPlayers([]);
      await t.settle();
      expect(t.links.links).toEqual({ cleric: 'Ana' });
      t.setControl(new TokenControl());
      t.setPlayers([{ ...ana, playerId: 'p-ana-new' }]);
      await t.settle();
      expect(t.control().controls('p-ana-new', 't1')).toBe(true);
      vi.useRealTimers();
    });

    it('does not give one character to two players when the GM gave it to both', async () => {
      vi.useFakeTimers();
      const t = table({ players: [ana, bea] });
      await t.settle();
      t.control().set('t1', 'p-ana', true);
      t.control().set('t1', 'p-bea', true);
      await t.settle();
      // Two controllers: nobody's alone, so nothing is learned or changed.
      expect(t.links.links).toEqual({});
      expect(t.control().controls('p-ana', 't1')).toBe(true);
      expect(t.control().controls('p-bea', 't1')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('where there is nothing to do', () => {
    it('does nothing without a hosted session, a scene, or a library that can be read', async () => {
      vi.useFakeTimers();
      const idle = table({ remembered: { cleric: 'Ana' }, hosting: false });
      await idle.settle();
      expect(idle.links.links).toEqual({ cleric: 'Ana' });
      idle.setControl(new TokenControl());
      idle.setTokens(null);
      await idle.settle();
      expect(idle.control().assignedTokens()).toEqual([]);
      const empty = table({ remembered: { cleric: 'Ana' }, library: [] });
      await empty.settle();
      expect(empty.control().assignedTokens()).toEqual([]);
      vi.useRealTimers();
    });

    it('does not read the library again for every change, and stops when stopped', async () => {
      vi.useFakeTimers();
      const t = table({ remembered: { cleric: 'Ana' } });
      await t.settle();
      for (let i = 0; i < 5; i++) t.setPlayers([ana]);
      await t.settle();
      expect(t.reads()).toBe(1);
      t.links.stop();
      t.setControl(new TokenControl());
      await t.settle();
      expect(t.control().assignedTokens()).toEqual([]);
      vi.useRealTimers();
    });
  });

  describe('the memory file', () => {
    function adapter(files: Record<string, string>) {
      return {
        exists: (path: string) => Promise.resolve(path in files),
        read: (path: string) => Promise.resolve(files[path] ?? ''),
        write: (path: string, data: string) => { files[path] = data; return Promise.resolve(); },
      };
    }

    it('writes and reads the links, and takes only names against ids from a file it finds', async () => {
      const files: Record<string, string> = {};
      const memory = fileMemory(() => Promise.resolve('f.json'), adapter(files));
      await expect(memory.load()).resolves.toEqual({});
      await memory.save({ cleric: 'Ana' });
      await expect(memory.load()).resolves.toEqual({ cleric: 'Ana' });
      files['f.json'] = JSON.stringify({ links: { cleric: 'Ana', rogue: 5, orc: '' } });
      await expect(memory.load()).resolves.toEqual({ cleric: 'Ana' });
      files['f.json'] = JSON.stringify({ links: 'x' });
      await expect(memory.load()).resolves.toEqual({});
      files['f.json'] = 'not json';
      await expect(memory.load()).rejects.toThrow();
    });
  });
});
