import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diceThrows } from '../../../online-client/dice3d/diceThrows.mts';
import { LEAVE_MS, LINGER_MS, ThrowPanel, TICK_DELAY_MS, type PageThrow } from '../../../online-client/dice3d/throwPanel.mts';
import { throwStyle } from '@atlas-vtt/shared/dice3d';
import { sceneFromRolls } from '@atlas-vtt/shared/dice3d';
import { borrowStage, releaseStagePools } from '@atlas-vtt/shared/dice3d';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';

const result: DiceRollResult = {
  id: 'roll_1', timestamp: 0, formula: '1d20 + 2', rolls: [{ die: 'd20', value: 20, max: 20 }], modifiers: 2, total: 22, crit: 'high',
};
const roll = (reduced: boolean): PageThrow => ({ result, scene: sceneFromRolls(result.rolls)!, style: throwStyle('full'), reduced });

describe("the join page's thrown roll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    releaseStagePools();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('throws nothing without WebGL, so the page shows the result card', () => {
    expect(diceThrows.throwRoll(document.body, roll(false))).toBe(false);
    expect(document.querySelector('.dice-throw')).toBeNull();
  });

  it('shows the formula, then the dice, then the total with its breakdown, marks the crit, and leaves', () => {
    const gone = vi.fn();
    const lease = { canvas: document.createElement('canvas'), renderer: null };
    new ThrowPanel(document.body, lease, roll(true), gone);
    const panel = document.querySelector('.dice-throw')!;
    expect(panel.contains(lease.canvas)).toBe(true);
    // Reduced motion: the dice lie at once and the whole number shows.
    expect(panel.className).toContain('is-crit-success');
    expect(panel.querySelector('.dice-throw-total')?.textContent).toBe('22');
    expect(panel.querySelector('.dice-throw-breakdown')?.textContent).toBe('20 + 2');
    vi.advanceTimersByTime(LINGER_MS);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dice-throw')).toBeNull();
  });

  it('counts the modifier in a beat after the dice, and a tap on the landed roll hides it', () => {
    const gone = vi.fn();
    const panel = new ThrowPanel(document.body, { canvas: document.createElement('canvas'), renderer: null }, roll(false), gone);
    const root = document.querySelector<HTMLElement>('.dice-throw')!;
    expect(root.querySelector('.dice-throw-formula')?.textContent).toBe('1d20 + 2');
    // The first tap skips the flight; the dice land on the next frame.
    root.click();
    vi.advanceTimersByTime(50);
    expect(root.querySelector('.dice-throw-total')?.textContent).toBe('20');
    vi.advanceTimersByTime(TICK_DELAY_MS);
    expect(root.querySelector('.dice-throw-total')?.textContent).toBe('22');
    root.click();
    expect(gone).toHaveBeenCalledTimes(1);
    expect(root.className).toContain('is-leaving');
    vi.advanceTimersByTime(LEAVE_MS);
    expect(document.querySelector('.dice-throw')).toBeNull();
    panel.dismiss();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it("sets the stage's bodies, measures it, draws the dice, and returns the canvas to the pool", () => {
    const renderer = {
      stage: vi.fn(() => [4, 3] as const), setView: vi.fn(), setPlan: vi.fn(), render: vi.fn(), isStill: vi.fn(() => true), reset: vi.fn(),
    };
    // A stage of the page's pool, with a stand-in renderer: jsdom has no WebGL.
    const lease = { ...borrowStage(document), renderer: renderer as never };
    const panel = new ThrowPanel(document.body, lease, roll(true), () => {});
    expect(renderer.setPlan).toHaveBeenCalledWith([20]);
    expect(renderer.setView).toHaveBeenCalled();
    expect(renderer.render).toHaveBeenCalledWith(expect.any(Array), 0, 'high');
    panel.dismiss();
    expect(renderer.reset).toHaveBeenCalled();
    expect(lease.canvas.isConnected).toBe(false);
  });

  // The page shows a refused move, another player's roll and your own throw at the top of the map:
  // one column, so none covers another (`.top-stack` in style.css).
  it("stacks the move notice, the roll toast and your throw under one another at the top of the map", () => {
    const page = new DOMParser().parseFromString(readFileSync(join(process.cwd(), 'online-client/index.html'), 'utf8'), 'text/html');
    const stack = page.querySelector('.top-stack');
    expect([...stack!.querySelectorAll('[id]')].map((child) => child.id)).toEqual(['move-notice', 'dice-toast', 'dice-throws']);
    const css = readFileSync(join(process.cwd(), 'online-client/style.css'), 'utf8');
    expect(css).toMatch(/\.top-stack \{[^}]*flex-direction: column/);
    expect(css).not.toMatch(/\.(move-notice|dice-toast|dice-throws) \{[^}]*grid-row/);
  });
});
