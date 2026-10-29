import { describe, expect, it } from 'vitest';
import { DiceTrayView } from '../../../online-client/diceTrayView.mts';
import type { DiceSelection } from '@atlas-vtt/shared/rules';

function setup(sends = true) {
  document.body.innerHTML = '<div id="dice-tray" hidden></div>';
  const root = document.getElementById('dice-tray')!;
  const rolls: Array<{ dice: DiceSelection; modifier: number; advantage?: string }> = [];
  let closed = 0;
  const view = new DiceTrayView({
    root,
    roll: (dice, modifier, advantage) => {
      rolls.push({ dice, modifier, ...(advantage ? { advantage } : {}) });
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

describe('rolling with advantage or disadvantage from the tray', () => {
  const sideButton = (root: HTMLElement, name: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`.tray-side[aria-label="${name}"]`)!;

  it('offers Normal, Advantage and Disadvantage for a roll of one d20, and for no other', () => {
    const { root, die } = setup();
    const choices = [...root.querySelectorAll<HTMLButtonElement>('.tray-side')];
    expect(choices.map((choice) => choice.textContent)).toEqual(['Normal', 'Advantage', 'Disadvantage']);
    // Off with an empty tray, with a d6, with two d20 and with a d20 beside another die.
    expect(choices.every((choice) => choice.disabled)).toBe(true);
    die('d6').click();
    expect(choices.every((choice) => choice.disabled)).toBe(true);
    root.querySelector<HTMLButtonElement>('.tray-clear')!.click();
    die('d20').click();
    expect(choices.every((choice) => !choice.disabled)).toBe(true);
    expect(sideButton(root, 'Normal').getAttribute('aria-pressed')).toBe('true');
    die('d20').click();
    expect(choices.every((choice) => choice.disabled)).toBe(true);
    root.querySelector<HTMLButtonElement>('.tray-clear')!.click();
    die('d20').click();
    die('d4').click();
    expect(choices.every((choice) => choice.disabled)).toBe(true);
  });

  it('sends the side the player chose with a roll of one d20, and nothing for Normal', () => {
    const { root, die, named, rolls } = setup();
    die('d20').click();
    sideButton(root, 'Advantage').click();
    expect(sideButton(root, 'Advantage').getAttribute('aria-pressed')).toBe('true');
    expect(sideButton(root, 'Normal').getAttribute('aria-pressed')).toBe('false');
    named('Roll').click();
    expect(rolls).toEqual([{ dice: { d20: 1 }, modifier: 0, advantage: 'advantage' }]);
    // The tray opens empty and normal again.
    die('d20').click();
    sideButton(root, 'Disadvantage').click();
    sideButton(root, 'Normal').click();
    named('Roll').click();
    expect(rolls[1]).toEqual({ dice: { d20: 1 }, modifier: 0 });
  });

  it('forgets a side the roll no longer takes: with a second die the roll goes without it, and back to one d20 it is normal', () => {
    const { root, die, named, rolls } = setup();
    die('d20').click();
    sideButton(root, 'Advantage').click();
    die('d6').click();
    named('Roll').click();
    expect(rolls[0]).toEqual({ dice: { d20: 1, d6: 1 }, modifier: 0 });
  });
});
