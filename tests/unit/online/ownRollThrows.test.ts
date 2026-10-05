import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiceDisplayView } from '../../../online-client/diceDisplayView.mts';
import type { DiceDisplay } from '@atlas-vtt/shared/dice3d';
import { DICE_DISPLAY_KEY, loadDiceDisplay, saveDiceDisplay } from '../../../src/app/online/page/diceDisplayStore';
import { OwnRollThrows, type DiceThrowModule } from '../../../src/app/online/page/ownRollThrows';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';

const own = (id: string, overrides: Partial<DiceLogEntry> = {}): DiceLogEntry => ({
  id, name: 'Anna', formula: '1d20+2', dice: [{ die: 'd20', value: 17 }], modifier: 2, total: 19, mine: true, at: 0, ...overrides,
});
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(display: DiceDisplay = 'full', module: Partial<DiceThrowModule> = {}) {
  const throwRoll = vi.fn<DiceThrowModule['throwRoll']>(() => true);
  const chunk: DiceThrowModule = { throwRoll, ...module };
  const load = vi.fn(() => Promise.resolve(chunk));
  const fallback = vi.fn();
  let shown = display;
  const throws = new OwnRollThrows({
    container: document.body, display: () => shown, reducedMotion: () => false, load, fallback,
  });
  return { throws, load, fallback, throwRoll: chunk.throwRoll as typeof throwRoll, setDisplay: (next: DiceDisplay): void => { shown = next; } };
}

describe("the join page's own rolls", () => {
  it('loads the 3D dice only with the first roll it throws, once', async () => {
    const t = setup();
    expect(t.load).not.toHaveBeenCalled();
    expect(t.throws.handle(own('a'))).toBe(true);
    expect(t.throws.handle(own('b'))).toBe(true);
    await flush();
    expect(t.load).toHaveBeenCalledTimes(1);
    expect(t.throwRoll.mock.calls.map(([, roll]) => roll.result.id)).toEqual(['a', 'b']);
    const [, roll] = t.throwRoll.mock.calls[0]!;
    expect(roll).toMatchObject({ style: { speed: 1 }, reduced: false, scene: { faces: [17] }, result: { total: 19, modifiers: 2 } });
    expect(t.fallback).not.toHaveBeenCalled();
  });

  it('throws fast dice at double speed', async () => {
    const t = setup('fast');
    t.throws.handle(own('a'));
    await flush();
    expect(t.throwRoll.mock.calls[0]![1].style).toEqual({ speed: 2, maxWallHits: 3 });
  });

  it('leaves result cards, rolls too large to throw and partly listed rolls to the toast, and loads nothing', () => {
    const t = setup('card');
    expect(t.throws.handle(own('a'))).toBe(false);
    t.setDisplay('full');
    expect(t.throws.handle(own('b', { dice: Array.from({ length: 21 }, () => ({ die: 'd6', value: 1 })) }))).toBe(false);
    expect(t.throws.handle(own('c', { unlisted: 5 }))).toBe(false);
    expect(t.load).not.toHaveBeenCalled();
  });

  it('shows the card when the browser has no WebGL, and from then on goes straight to the card', async () => {
    const t = setup('full', { throwRoll: vi.fn(() => false) });
    expect(t.throws.handle(own('a'))).toBe(true);
    await flush();
    expect(t.fallback).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(t.throws.handle(own('b'))).toBe(false);
  });

  it('shows the card when the dice fail to load, and tries again with the next roll', async () => {
    const t = setup();
    t.load.mockRejectedValueOnce(new Error('offline'));
    t.throws.handle(own('a'));
    await flush();
    expect(t.fallback).toHaveBeenCalledTimes(1);
    expect(t.throws.handle(own('b'))).toBe(true);
    await flush();
    expect(t.load).toHaveBeenCalledTimes(2);
    expect(t.throwRoll).toHaveBeenCalledTimes(1);
  });
});

describe("the join page's roll display setting", () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('keeps the choice per browser, Dice by default, and works without storage', () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
    expect(loadDiceDisplay(() => storage)).toBe('full');
    saveDiceDisplay('card', () => storage);
    expect(kept.get(DICE_DISPLAY_KEY)).toBe('card');
    expect(loadDiceDisplay(() => storage)).toBe('card');
    kept.set(DICE_DISPLAY_KEY, 'confetti');
    expect(loadDiceDisplay(() => storage)).toBe('full');
    const blocked = (): Storage => { throw new Error('SecurityError'); };
    expect(loadDiceDisplay(blocked)).toBe('full');
    expect(() => saveDiceDisplay('fast', blocked)).not.toThrow();
  });

  it("offers Atlas's three options with Atlas's hint for the chosen one", () => {
    const root = document.createElement('div');
    const changes: DiceDisplay[] = [];
    const view = new DiceDisplayView(root, 'full', (display) => changes.push(display));
    const buttons = [...root.querySelectorAll('button')];
    expect(buttons.map((button) => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([
      ['Result card', 'false'], ['Fast dice', 'false'], ['Dice', 'true'],
    ]);
    buttons[0]!.click();
    expect(view.value).toBe('card');
    expect(changes).toEqual(['card']);
    expect(root.querySelector('.menu-hint')?.textContent).toBe('Every roll shows its result on a card, without dice.');
  });
});
