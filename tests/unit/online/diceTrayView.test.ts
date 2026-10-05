import { describe, expect, it } from 'vitest';
import { DiceTrayView } from '../../../online-client/diceTrayView.mts';
import type { DiceSelection } from '@atlas-vtt/shared/rules';

function setup(sends = true) {
  document.body.innerHTML = '<div id="dice-tray" hidden></div>';
  const root = document.getElementById('dice-tray')!;
  const rolls: Array<{ dice: DiceSelection; modifier: number }> = [];
  let closed = 0;
  const view = new DiceTrayView({
    root,
    roll: (dice, modifier) => {
      rolls.push({ dice, modifier });
      return sends;
    },
    onClose: () => { closed++; },
  });
  view.setOpen(true);
  const die = (name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[data-die="${name}"]`)!;
  const named = (label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const text = (): string => root.querySelector('.tray-formula')!.textContent ?? '';
  return { root, view, rolls, closed: () => closed, die, named, text };
}

describe('the join page dice tray', () => {
  it("draws Atlas's dice: seven faces, d100 as two d10 drawings", () => {
    const t = setup();
    expect(t.root.querySelectorAll('.tray-face')).toHaveLength(7);
    expect(t.die('d100').querySelectorAll('img')).toHaveLength(2);
    expect(t.die('d6').querySelector('img')?.getAttribute('src')).toContain('d6.webp');
    expect(t.text()).toBe('The tray is empty.');
  });

  it("adds a die on a tap and takes one back with its −, showing Atlas's formula and count", () => {
    const t = setup();
    t.die('d6').click();
    t.die('d6').click();
    t.die('d20').click();
    expect(t.die('d6').getAttribute('aria-label')).toBe('Add a d6, 2 in the tray');
    t.named('Take one d6 back').click();
    expect(t.text()).toBe('1d6 + 1d20');
    expect(t.die('d6').querySelector<HTMLElement>('.tray-count')?.textContent).toBe('1');
    expect(t.die('d4').querySelector<HTMLElement>('.tray-count')?.hidden).toBe(true);
    expect(t.named('Take one d4 back').disabled).toBe(true);
  });

  it('rolls the dice with the modifier, then empties and asks to close; Roll needs dice', () => {
    const t = setup();
    const roll = t.root.querySelector<HTMLButtonElement>('.tray-roll')!;
    expect(roll.disabled).toBe(true);
    t.die('d20').click();
    for (let i = 0; i < 3; i++) t.named('Increase modifier').click();
    t.named('Decrease modifier').click();
    expect(t.text()).toBe('1d20 + 2');
    roll.click();
    expect(t.rolls).toEqual([{ dice: { d20: 1 }, modifier: 2 }]);
    expect(t.view.tray.isEmpty()).toBe(true);
    expect(t.root.querySelector('.tray-modifier-value')?.textContent).toBe('0');
    expect(t.closed()).toBe(1);
  });

  it('keeps the tray open with its dice and says so when the roll was not sent', () => {
    const t = setup(false);
    t.die('d20').click();
    t.root.querySelector<HTMLButtonElement>('.tray-roll')!.click();
    expect(t.closed()).toBe(0);
    expect(t.view.isOpen).toBe(true);
    expect(t.view.tray.total()).toBe(1);
    expect(t.root.querySelector('.dice-note')?.textContent).toContain("Couldn't send the roll");
    t.die('d20').click();
    expect(t.root.querySelector('.dice-note')?.textContent).toBe('');
  });

  it('takes no more dice at 20, and Clear empties dice and modifier', () => {
    const t = setup();
    for (let i = 0; i < 25; i++) t.die('d6').click();
    expect(t.view.tray.total()).toBe(20);
    expect(t.die('d4').disabled).toBe(true);
    const clear = t.root.querySelector<HTMLButtonElement>('.tray-clear')!;
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(t.view.tray.isEmpty()).toBe(true);
    expect(clear.hidden).toBe(true);
  });
});
