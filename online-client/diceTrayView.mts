// online-client/diceTrayView.mts
/**
 * The dice tray on the join page, in Atlas's tray look (`DiceTray.tsx`): seven drawn dice, each a
 * surface a click or tap adds one to, a "−" under every die that holds any (always there, since a
 * control that shows only under the pointer is none on a phone), a modifier with steppers, the
 * formula, Roll and Clear. The tray's rules live in `DiceTray` (`src/app/online/page/diceTray.ts`).
 */
import {
  addDieLabel, CLEAR_LABEL, DiceTray, EMPTY_TRAY_TEXT, MODIFIER_LABEL, removeDieLabel, ROLL_LABEL,
} from '../src/app/online/page/diceTray';
import { DIE_ART } from '../src/app/online/page/dieArt';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import { MAX_MODIFIER, TRAY_DICE, type TrayDie } from '@atlas-vtt/shared/rules';
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import { iconElement } from './icons.mts';

export interface DiceTrayViewOptions {
  root: HTMLElement;
  /** Sends the roll to the GM; false when it could not go. */
  roll(dice: DiceSelection, modifier: number): boolean;
  /** The tray rolled and wants to close. */
  onClose(): void;
}

const ROLL_WAIT_NOTE = "Couldn't send the roll. Wait a moment, or check your connection.";

function button(className: string, label: string): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.setAttribute('aria-label', label);
  return element;
}

function dieFace(sides: TrayDie): HTMLElement {
  const face = document.createElement('span');
  face.className = sides === 100 ? 'die-face die-face--percentile' : 'die-face';
  face.setAttribute('aria-hidden', 'true');
  for (const src of DIE_ART[sides]) {
    const art = document.createElement('img');
    art.className = 'die-face__art';
    art.src = src;
    art.alt = '';
    art.draggable = false;
    face.append(art);
  }
  return face;
}

export class DiceTrayView {
  readonly tray = new DiceTray();
  private readonly dice = new Map<TrayDie, { face: HTMLButtonElement; count: HTMLElement; grip: HTMLButtonElement }>();
  private readonly formula: HTMLElement;
  private readonly modifierValue: HTMLElement;
  private readonly decrease: HTMLButtonElement;
  private readonly increase: HTMLButtonElement;
  private readonly rollButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly note: HTMLElement;

  constructor(private readonly options: DiceTrayViewOptions) {
    const row = document.createElement('div');
    row.className = 'tray-dice';
    for (const sides of TRAY_DICE) row.append(this.die(sides));

    const modifier = document.createElement('div');
    modifier.className = 'tray-modifier';
    const label = document.createElement('span');
    label.className = 'tray-modifier-label';
    label.textContent = MODIFIER_LABEL;
    this.decrease = this.stepper('Decrease modifier', 'minus', -1);
    this.increase = this.stepper('Increase modifier', 'plus', 1);
    this.modifierValue = document.createElement('span');
    this.modifierValue.className = 'tray-modifier-value';
    modifier.append(label, this.decrease, this.modifierValue, this.increase);

    // Always there, even empty: a region that appears with its content goes unheard by screen readers.
    this.formula = document.createElement('p');
    this.formula.className = 'tray-formula';
    this.formula.setAttribute('role', 'status');
    this.formula.setAttribute('aria-live', 'polite');

    const actions = document.createElement('div');
    actions.className = 'tray-actions';
    this.rollButton = button('tray-roll', ROLL_LABEL);
    this.rollButton.textContent = ROLL_LABEL;
    this.rollButton.addEventListener('click', () => this.roll());
    this.clearButton = button('secondary tray-clear', CLEAR_LABEL);
    this.clearButton.textContent = CLEAR_LABEL;
    this.clearButton.addEventListener('click', () => this.empty());
    actions.append(this.rollButton, this.clearButton);

    this.note = document.createElement('p');
    this.note.className = 'dice-note';
    this.note.setAttribute('role', 'status');
    options.root.replaceChildren(row, modifier, this.formula, actions, this.note);
    this.render();
  }

  get isOpen(): boolean {
    return !this.options.root.hidden;
  }

  /** Opens or closes the tray; like Atlas's, it opens empty. */
  setOpen(open: boolean): void {
    this.options.root.hidden = !open;
    if (!open) this.empty();
  }

  private die(sides: TrayDie): HTMLElement {
    const face = button('tray-face', addDieLabel(sides, 0));
    face.dataset.die = `d${sides}`;
    face.dataset.label = `d${sides}`;
    const count = document.createElement('span');
    count.className = 'tray-count';
    count.setAttribute('aria-hidden', 'true');
    face.append(dieFace(sides), count);
    face.addEventListener('click', () => {
      if (this.tray.add(sides)) this.render();
    });
    const grip = button('tray-grip', removeDieLabel(sides));
    grip.append(iconElement(toolIconUrl('minus')));
    grip.addEventListener('click', () => {
      if (this.tray.remove(sides)) this.render();
    });
    const cell = document.createElement('div');
    cell.className = 'tray-die';
    cell.append(face, grip);
    this.dice.set(sides, { face, count, grip });
    return cell;
  }

  private stepper(label: string, icon: 'minus' | 'plus', delta: number): HTMLButtonElement {
    const step = button('tray-grip tray-step', label);
    step.append(iconElement(toolIconUrl(icon)));
    step.addEventListener('click', () => {
      this.tray.step(delta);
      this.render();
    });
    return step;
  }

  private roll(): void {
    const roll = this.tray.roll();
    if (!roll) return;
    if (!this.options.roll(roll.dice, roll.modifier)) {
      // Not sent (too fast, or not connected): the tray keeps its dice for another try.
      this.note.textContent = ROLL_WAIT_NOTE;
      return;
    }
    this.empty();
    this.options.onClose();
  }

  private empty(): void {
    this.tray.clear();
    this.render();
  }

  private render(): void {
    this.note.textContent = '';
    for (const [sides, { face, count, grip }] of this.dice) {
      const held = this.tray.count(sides);
      face.disabled = !this.tray.canAdd(sides);
      face.setAttribute('aria-label', addDieLabel(sides, held));
      count.hidden = held === 0;
      count.textContent = String(held);
      // The place under the die stays even when empty, so the dice never shift under a finger.
      grip.classList.toggle('is-empty', held === 0);
      grip.disabled = held === 0;
    }
    const modifier = this.tray.modifier;
    this.modifierValue.textContent = modifier > 0 ? `+${modifier}` : String(modifier);
    this.decrease.disabled = modifier <= -MAX_MODIFIER;
    this.increase.disabled = modifier >= MAX_MODIFIER;
    const formula = this.tray.formula();
    this.formula.textContent = formula === '' ? EMPTY_TRAY_TEXT : formula;
    this.formula.classList.toggle('is-empty', formula === '');
    this.rollButton.disabled = formula === '';
    this.clearButton.hidden = this.tray.isEmpty();
  }
}
