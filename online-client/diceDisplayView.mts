// online-client/diceDisplayView.mts
/**
 * Atlas's "Roll display" setting in the join page's menu: Result card, Fast dice or Dice, with
 * Atlas's hint for the one chosen, as a row of three toggle buttons. It decides how the player's
 * own rolls show; everyone's rolls stay in the dice log either way.
 */
import { DICE_DISPLAY_HINTS, DICE_DISPLAY_OPTIONS, type DiceDisplay } from '@atlas-vtt/shared/diceDisplay';

export const ROLL_DISPLAY_LABEL = 'Roll display';

export class DiceDisplayView {
  private readonly buttons = new Map<DiceDisplay, HTMLButtonElement>();
  private readonly hint: HTMLElement;

  constructor(root: HTMLElement, private display: DiceDisplay, private readonly onChange: (display: DiceDisplay) => void) {
    const label = document.createElement('span');
    label.className = 'dice-display-label';
    label.id = 'dice-display-label';
    label.textContent = ROLL_DISPLAY_LABEL;
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', label.id);
    for (const option of DICE_DISPLAY_OPTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segmented-option';
      button.textContent = option.label;
      button.addEventListener('click', () => this.choose(option.value));
      this.buttons.set(option.value, button);
      group.append(button);
    }
    this.hint = document.createElement('p');
    this.hint.className = 'menu-hint';
    root.replaceChildren(label, group, this.hint);
    this.render();
  }

  get value(): DiceDisplay {
    return this.display;
  }

  private choose(display: DiceDisplay): void {
    if (display === this.display) return;
    this.display = display;
    this.render();
    this.onChange(display);
  }

  private render(): void {
    for (const [value, button] of this.buttons) button.setAttribute('aria-pressed', String(value === this.display));
    this.hint.textContent = DICE_DISPLAY_HINTS[this.display];
  }
}
