import { describe, expect, it, vi } from 'vitest';
import type { DiceRollResult } from '@atlas-vtt/api-types';
import { stockDiceApi, type DiceView } from '../../../src/connect/stockDice/stockDice';
import { SHEET_AWARE_DICE } from '../../../src/app/online/tools/DiceHost';

let counter = 0;
const rollOf = (formula: string, extra: Partial<DiceRollResult> = {}): DiceRollResult => ({
  id: `roll-${++counter}`, timestamp: 1, formula, rolls: [{ type: 'd20', value: 14, max: 20 }], modifiers: 0, total: 14, ...extra,
} as DiceRollResult);

type Fake = ReturnType<typeof fakeView>;

/** An Atlas view's event bus and dice tool, as `serviceManager` hands them out. */
function fakeView(viewId: string, mapPath: string, options: { noTool?: boolean; refuses?: boolean } = {}) {
  const listeners = new Set<(result: DiceRollResult) => void>();
  const bus = {
    on: (_event: string, listener: (result: DiceRollResult) => void) => { listeners.add(listener); },
    off: (_event: string, listener: (result: DiceRollResult) => void) => { listeners.delete(listener); },
    emit: (_event: string, result: DiceRollResult) => { for (const listener of [...listeners]) listener(result); },
  };
  const rolled: Array<{ formula: string; source: unknown; options?: unknown }> = [];
  const tool = {
    rollDice: (formula: string, source?: unknown, _origin?: unknown, rollOptions?: unknown) => {
      if (options.refuses) return null;
      rolled.push({ formula, source, options: rollOptions });
      const result = rollOf(formula, source ? ({ source } as Partial<DiceRollResult>) : {});
      bus.emit('dice-rolled', result);
      return result;
    },
  };
  const serviceManager = options.noTool ? {} : { getToolController: () => ({ getDiceTool: () => tool }), getEventBus: () => bus };
  const view: DiceView = { viewId, mapPath: () => mapPath, serviceManager };
  return { view, listeners, rolled, bus };
}

function setup(...views: Fake[]) {
  let open = views;
  let changed: () => void = () => undefined;
  const added: Array<() => void> = [];
  const api = stockDiceApi({
    views: () => open.map((entry) => entry.view),
    onViewsChanged: (listener) => { changed = listener; return () => { changed = () => undefined; }; },
    add: (dispose) => { added.push(dispose); return () => { const at = added.indexOf(dispose); if (at >= 0) added.splice(at, 1); dispose(); }; },
  });
  return { api, setViews: (next: Fake[]) => { open = next; changed(); }, unload: () => { for (const dispose of added.splice(0)) dispose(); } };
}

describe('dice on a stock Atlas', () => {
  describe('roll', () => {
    it("rolls in the view that shows the map, else the one the GM works in, and names the player in Atlas's log", () => {
      const a = fakeView('a', 'maps/one.atlasmap');
      const b = fakeView('b', 'maps/two.atlasmap');
      const { api } = setup(a, b);
      const result = api.roll({ formula: '1d20+2', mapPath: 'maps/two.atlasmap', rolledBy: 'Ana' });
      expect(b.rolled).toEqual([{ formula: '1d20+2', source: { type: 'toolbar', tokenName: 'Ana' } }]);
      expect(a.rolled).toEqual([]);
      expect(result.rolledBy).toBe('Ana');
      expect(Object.isFrozen(result)).toBe(true);
      api.roll({ formula: '1d6' });
      expect(a.rolled).toEqual([{ formula: '1d6', source: undefined }]);
      api.roll({ formula: '1d4', mapPath: 'maps/none.atlasmap', rolledBy: 'Bea' });
      expect(a.rolled).toHaveLength(2);
    });

    it("names the ability of a player's sheet in Atlas's toast, and hands the side to Atlas's dice tool", () => {
      const a = fakeView('a', 'm');
      const { api } = setup(a);
      api.roll({ formula: '+4', rolledBy: 'Ana', abilityName: 'Scimitar', advantage: 'advantage' } as never);
      api.roll({ formula: '1d6+2', rolledBy: 'Ana', abilityName: 'Scimitar' } as never);
      expect(a.rolled).toEqual([
        { formula: '+4', source: { type: 'toolbar', tokenName: 'Ana', abilityName: 'Scimitar' }, options: { advantage: 'advantage' } },
        { formula: '1d6+2', source: { type: 'toolbar', tokenName: 'Ana', abilityName: 'Scimitar' } },
      ]);
      expect(SHEET_AWARE_DICE.has(api)).toBe(true);
      expect(() => api.roll({ formula: '+4', advantage: 'twice' } as never)).toThrow(/request/);
      expect(() => api.roll({ formula: '+4', abilityName: 'x'.repeat(121) } as never)).toThrow(/request/);
    });

    it("lets onRolled hear it as the player's, and a roll made after as nobody's", () => {
      const a = fakeView('a', 'm');
      const { api } = setup(a);
      const heard: Array<[string, string | undefined]> = [];
      api.onRolled((result) => heard.push([result.formula, result.rolledBy]));
      api.roll({ formula: '1d20', rolledBy: 'Ana' });
      a.bus.emit('dice-rolled', rollOf('1d8'));
      expect(heard).toEqual([['1d20', 'Ana'], ['1d8', undefined]]);
    });

    it('refuses what the API refuses, a formula Atlas does not roll, and a map that cannot roll', () => {
      const { api } = setup(fakeView('a', 'm'));
      expect(() => api.roll(null as never)).toThrow(/request/);
      expect(() => api.roll({ formula: 1 } as never)).toThrow(/request/);
      expect(() => api.roll({ formula: '1d20', rolledBy: 'x'.repeat(41) })).toThrow(/request/);
      expect(() => setup(fakeView('a', 'm', { refuses: true })).api.roll({ formula: 'banana' })).toThrow(/does not roll "banana"/);
      expect(() => setup().api.roll({ formula: '1d20' })).toThrow(/no open map/);
      expect(() => setup(fakeView('a', 'm', { noTool: true })).api.roll({ formula: '1d20' })).toThrow(/no open map/);
    });

    it('forgets whose roll it is even when Atlas refuses it', () => {
      const refusing = fakeView('r', 'm', { refuses: true });
      const { api } = setup(refusing);
      const heard: Array<string | undefined> = [];
      api.onRolled((result) => heard.push(result.rolledBy));
      expect(() => api.roll({ formula: 'x', rolledBy: 'Ana' })).toThrow();
      refusing.bus.emit('dice-rolled', rollOf('1d6'));
      expect(heard).toEqual([undefined]);
    });
  });

  describe('onRolled', () => {
    it('hears every roll the views announce, once, from any view', () => {
      const a = fakeView('a', 'm1');
      const b = fakeView('b', 'm2');
      const { api } = setup(a, b);
      const heard: string[] = [];
      api.onRolled((result) => heard.push(result.formula));
      a.bus.emit('dice-rolled', rollOf('1d6'));
      b.bus.emit('dice-rolled', rollOf('2d8'));
      const same = rollOf('1d10');
      a.bus.emit('dice-rolled', same);
      b.bus.emit('dice-rolled', same);
      expect(heard).toEqual(['1d6', '2d8', '1d10']);
    });

    it('gives frozen copies, ignores what is no roll, and one failing listener harms nobody', () => {
      const a = fakeView('a', 'm');
      const { api } = setup(a);
      const seen: DiceRollResult[] = [];
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      api.onRolled(() => { throw new Error('listener'); });
      api.onRolled((result) => seen.push(result));
      const roll = rollOf('1d6');
      a.bus.emit('dice-rolled', roll);
      a.bus.emit('dice-rolled', { not: 'a roll' } as never);
      expect(seen).toHaveLength(1);
      expect(Object.isFrozen(seen[0])).toBe(true);
      expect(seen[0]).not.toBe(roll);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
      expect(api.onRolled('x' as never)()).toBeUndefined();
    });

    it('stops hearing on its disposer, follows views that open and close, and lets go of every bus when Atlas unloads', () => {
      const a = fakeView('a', 'm1');
      const b = fakeView('b', 'm2');
      const t = setup(a);
      const heard: string[] = [];
      const stop = t.api.onRolled((result) => heard.push(result.formula));
      expect(a.listeners.size).toBe(1);
      t.setViews([a, b]);
      b.bus.emit('dice-rolled', rollOf('1d4'));
      expect(heard).toEqual(['1d4']);
      t.setViews([b]);
      expect(a.listeners.size).toBe(0);
      stop();
      b.bus.emit('dice-rolled', rollOf('1d12'));
      expect(heard).toEqual(['1d4']);
      t.api.onRolled(() => undefined);
      t.unload();
      expect(a.listeners.size + b.listeners.size).toBe(0);
    });
  });

  describe('publish', () => {
    it('shows a roll made elsewhere in every open map view, and listeners hear it once', () => {
      const a = fakeView('a', 'm1');
      const b = fakeView('b', 'm2');
      const { api } = setup(a, b);
      const heard: string[] = [];
      api.onRolled((result) => heard.push(result.id));
      const emitted: string[] = [];
      a.listeners.add((result) => emitted.push(`a:${result.id}`));
      b.listeners.add((result) => emitted.push(`b:${result.id}`));
      const roll = rollOf('1d20');
      api.publish(roll);
      expect(emitted).toEqual([`a:${roll.id}`, `b:${roll.id}`]);
      expect(heard).toEqual([roll.id]);
    });

    it('refuses what is not a roll of plain data, and options that are not { throw?: boolean }', () => {
      const { api } = setup(fakeView('a', 'm'));
      expect(() => api.publish({ id: 'x' } as never)).toThrow(/roll must be/);
      const cyclic: Record<string, unknown> = { ...rollOf('1d6') };
      cyclic.self = cyclic;
      expect(() => api.publish(cyclic as never)).toThrow(/plain data/);
      expect(() => api.publish(rollOf('1d6'), 'x' as never)).toThrow(/options/);
      expect(() => api.publish(rollOf('1d6'), { throw: 'no' } as never)).toThrow(/options/);
      expect(() => api.publish(rollOf('1d6'), { throw: false })).not.toThrow();
      const many = rollOf('1001d6', { rolls: Array.from({ length: 1001 }, () => ({ type: 'd6', value: 1, max: 6 })) as never });
      expect(() => api.publish(many)).toThrow(/roll must be/);
    });
  });
});
