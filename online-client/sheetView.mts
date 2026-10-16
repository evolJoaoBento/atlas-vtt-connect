// online-client/sheetView.mts
/**
 * The player's sheets: a drawer with the tokens they control, each with its exact numbers and its stat block, where
 * an ability, a save, a skill or a roll in an action's text ("+5", "1d8 + 3", as Atlas's stat block links them) asks
 * the GM to roll it. As in Atlas, a click rolls, Shift-click rolls with advantage and Alt-click (Option) with
 * disadvantage, both at once cancel, and a right-click offers the three. Its button shows only while the player has
 * sheets. Text only, never markup: everything comes from the GM. Shared with the Obsidian scene tab.
 */
import { ABILITY_NAMES, modifierOf, textParts, type AdvantageSide, type PlayerSheet, type SheetRollRef, type TokenSheet } from '../src/app/online/tools/sheets';
import { toolIconUrl, type ToolIconName } from '../src/app/online/page/toolIcons';
import { iconElement } from './icons.mts';

export interface SheetViewOptions {
  panel: HTMLElement;
  /** Holds the sheet of the token picked. */
  body: HTMLElement;
  /** One button per token, shown with more than one. */
  tabs: HTMLElement;
  closeButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  /** Asks the GM to roll on the sheet of `tokenId`; false when it could not be sent. */
  onRoll(tokenId: string, roll: SheetRollRef): boolean;
  /** Whether this drawer's surface has the keyboard: inside Obsidian other panes' Escape must not close it. */
  active?: () => boolean;
  doc?: Document;
}

const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value));

/** The side Shift (advantage) and Alt (disadvantage) ask for; both at once cancel (Atlas's `advantageSide`). */
export function advantageSide(shift: boolean, alt: boolean): AdvantageSide | null {
  if (shift === alt) return null;
  return shift ? 'advantage' : 'disadvantage';
}

/**
 * Whether advantage can change a roll: a bare bonus (added to the set's default roll) or a roll with a d20. The GM's
 * Atlas decides by the dice set's own rule, and rolls a roll it does not change as it is.
 */
export function mayHaveAdvantage(formula: string): boolean {
  return /^[+-]\d+$/.test(formula) || /(^|[^\d])d20(?!\d)/i.test(formula);
}

const MENU_CHOICES: ReadonlyArray<{ label: string; icon: ToolIconName; side: AdvantageSide | null }> = [
  { label: 'Roll', icon: 'dices', side: null },
  { label: 'Roll with advantage', icon: 'chevrons-up', side: 'advantage' },
  { label: 'Roll with disadvantage', icon: 'chevrons-down', side: 'disadvantage' },
];
const formatNumber = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

export class SheetView {
  private entries: readonly TokenSheet[] = [];
  private picked: string | null = null;
  private open = false;
  private readonly listeners = new AbortController();
  /** The right-click menu of a roll, while it is open. */
  private menu: { element: HTMLElement; from: HTMLElement } | null = null;

  constructor(private readonly options: SheetViewOptions) {
    const { signal } = this.listeners;
    options.toggleButton.replaceChildren(iconElement(toolIconUrl('scroll-text')));
    options.toggleButton.hidden = true;
    options.panel.hidden = true;
    options.toggleButton.addEventListener('click', () => this.setOpen(!this.open), { signal });
    options.closeButton.addEventListener('click', () => this.close(), { signal });
    (options.doc ?? document).addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open || this.options.active?.() === false) return;
      event.stopImmediatePropagation();
      // Escape closes the roll menu first, as any menu.
      if (this.menu) this.closeMenu(true);
      else this.close();
    }, { capture: true, signal });
    (options.doc ?? document).addEventListener('pointerdown', (event) => {
      if (this.menu && !this.menu.element.contains(event.target as Node)) this.closeMenu(false);
    }, { capture: true, signal });
    options.panel.addEventListener('scroll', () => this.closeMenu(false), { capture: true, passive: true, signal });
  }

  /** The player's sheets now (`token-sheets`); none hides the button and closes the drawer. */
  receive(entries: readonly TokenSheet[]): void {
    this.entries = entries;
    if (!entries.some((entry) => entry.tokenId === this.picked)) this.picked = entries[0]?.tokenId ?? null;
    this.options.toggleButton.hidden = entries.length === 0;
    if (entries.length === 0 && this.open) this.setOpen(false);
    this.render();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.options.panel.hidden = !open;
    this.options.toggleButton.setAttribute('aria-expanded', String(open));
    if (open) {
      this.render();
      this.options.closeButton.focus({ preventScroll: true });
    }
  }

  dispose(): void {
    this.listeners.abort();
  }

  private close(): void {
    this.setOpen(false);
    this.options.toggleButton.focus({ preventScroll: true });
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const element = this.options.body.ownerDocument.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  private rollButton(tokenId: string, roll: SheetRollRef, label: string, title: string, advantage: boolean): HTMLButtonElement {
    const button = this.el('button', 'sheet-roll', label);
    button.type = 'button';
    button.setAttribute('aria-label', `Roll ${title}`);
    const send = (side: AdvantageSide | null): void => {
      this.options.onRoll(tokenId, side && advantage ? { ...roll, side } : roll);
    };
    button.addEventListener('click', (event) => send(advantageSide(event.shiftKey, event.altKey)));
    // Enter and Space roll with the side their modifiers ask for, which a button's own click would drop.
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      send(advantageSide(event.shiftKey, event.altKey));
    });
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      // A menu key or Shift+F10 is no right button: the menu hangs from the roll.
      const box = button.getBoundingClientRect();
      const at = event.button === 2 ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom };
      this.openMenu(button, at, advantage ? MENU_CHOICES : MENU_CHOICES.slice(0, 1), send);
    });
    return button;
  }

  /** Opens a roll's menu at a point of the page, inside the drawer. */
  private openMenu(from: HTMLElement, at: { x: number; y: number }, choices: typeof MENU_CHOICES, send: (side: AdvantageSide | null) => void): void {
    this.closeMenu(false);
    const { panel } = this.options;
    const doc = panel.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'toolbar-menu sheet-roll-menu';
    element.setAttribute('role', 'menu');
    for (const choice of choices) {
      const entry = doc.createElement('button');
      entry.type = 'button';
      entry.className = 'menu-entry';
      entry.setAttribute('role', 'menuitem');
      const text = doc.createElement('span');
      text.textContent = choice.label;
      entry.append(iconElement(toolIconUrl(choice.icon)), text);
      entry.addEventListener('click', () => {
        this.closeMenu(true);
        send(choice.side);
      });
      element.append(entry);
    }
    panel.append(element);
    // In the drawer's own frame (an Obsidian pane is a containing block for fixed elements), kept inside it.
    const frame = panel.getBoundingClientRect();
    const left = Math.max(4, Math.min(at.x - frame.left, panel.clientWidth - element.offsetWidth - 4));
    const top = Math.max(4, Math.min(at.y - frame.top + panel.scrollTop, panel.scrollTop + panel.clientHeight - element.offsetHeight - 4));
    element.style.setProperty('--menu-x', `${left}px`);
    element.style.setProperty('--menu-y', `${top}px`);
    this.menu = { element, from };
    element.querySelector<HTMLButtonElement>('.menu-entry')?.focus({ preventScroll: true });
  }

  private closeMenu(refocus: boolean): void {
    const menu = this.menu;
    if (!menu) return;
    this.menu = null;
    menu.element.remove();
    if (refocus) menu.from.focus({ preventScroll: true });
  }

  private render(): void {
    this.closeMenu(false);
    const { tabs, body } = this.options;
    tabs.replaceChildren();
    tabs.hidden = this.entries.length < 2;
    for (const entry of this.entries) {
      const tab = this.el('button', 'sheet-tab', entry.name ?? entry.sheet?.name ?? 'Token');
      tab.type = 'button';
      tab.setAttribute('aria-pressed', String(entry.tokenId === this.picked));
      tab.addEventListener('click', () => {
        this.picked = entry.tokenId;
        this.render();
      });
      tabs.append(tab);
    }
    const entry = this.entries.find((candidate) => candidate.tokenId === this.picked);
    body.replaceChildren(...(entry ? this.sheetElements(entry) : []));
  }

  private sheetElements(entry: TokenSheet): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const sheet = entry.sheet;
    parts.push(this.el('h3', 'sheet-name', entry.name ?? sheet?.name ?? 'Token'));
    if (sheet?.subtitle) parts.push(this.el('p', 'sheet-subtitle', sheet.subtitle));
    if (entry.resources.length > 0) {
      const numbers = this.el('div', 'sheet-numbers');
      for (const resource of entry.resources) {
        const row = this.el('div', 'sheet-number');
        if (resource.color) {
          const dot = this.el('span', 'sheet-dot');
          dot.setAttribute('aria-hidden', 'true');
          dot.style.setProperty('--sheet-dot', resource.color);
          row.append(dot);
        }
        row.append(this.el('span', 'sheet-number-name', resource.name), this.el('span', 'sheet-number-value', `${formatNumber(resource.current)} / ${formatNumber(resource.max)}`));
        numbers.append(row);
      }
      parts.push(numbers);
    }
    if (!sheet) {
      parts.push(this.el('p', 'sheet-empty', 'No stat block is linked to this token.'));
      return parts;
    }
    parts.push(...this.blockElements(entry.tokenId, sheet));
    return parts;
  }

  private blockElements(tokenId: string, sheet: PlayerSheet): HTMLElement[] {
    const parts: HTMLElement[] = [];
    const basics = [['Armor class', sheet.ac], ['Hit points', sheet.hp], ['Speed', sheet.speed]] as const;
    for (const [label, value] of basics) if (value) parts.push(this.line(label, value));
    if (sheet.stats) {
      const stats = this.el('div', 'sheet-stats');
      sheet.stats.forEach((score, index) => {
        const name = ABILITY_NAMES[index] ?? '';
        const cell = this.el('div', 'sheet-stat');
        cell.append(this.el('span', 'sheet-stat-name', name), this.el('span', 'sheet-stat-score', String(score)));
        cell.append(this.rollButton(tokenId, { kind: 'check', index }, signed(modifierOf(score)), `${name} check`, true));
        stats.append(cell);
      });
      parts.push(stats);
    }
    const bonusRow = (title: string, kind: 'save' | 'skill', list: PlayerSheet['saves']): void => {
      if (list.length === 0) return;
      const row = this.el('div', 'sheet-bonuses');
      row.append(this.el('span', 'sheet-label', title));
      list.forEach((bonus, index) => row.append(this.rollButton(tokenId, { kind, index }, `${bonus.label} ${signed(bonus.bonus)}`, `${bonus.label}${kind === 'save' ? ' save' : ''}`, true)));
      parts.push(row);
    };
    bonusRow('Saves', 'save', sheet.saves);
    bonusRow('Skills', 'skill', sheet.skills);
    for (const line of sheet.lines) parts.push(this.line(line.label, line.text));
    sheet.sections.forEach((section, sectionIndex) => {
      parts.push(this.el('h4', 'sheet-section', section.title));
      section.items.forEach((item, itemIndex) => {
        const paragraph = this.el('p', 'sheet-item');
        if (item.name) paragraph.append(this.el('strong', '', `${item.name}. `));
        for (const part of textParts(item.desc)) {
          if ('roll' in part) {
            const ref: SheetRollRef = { kind: 'text', section: sectionIndex, item: itemIndex, index: part.roll, text: part.text };
            paragraph.append(this.rollButton(tokenId, ref, part.text, `${item.name || section.title}: ${part.formula}`, mayHaveAdvantage(part.formula)));
          }
          else paragraph.append(this.options.body.ownerDocument.createTextNode(part.text));
        }
        parts.push(paragraph);
      });
    });
    return parts;
  }

  private line(label: string, value: string): HTMLElement {
    const row = this.el('p', 'sheet-line');
    row.append(this.el('span', 'sheet-label', `${label} `), this.options.body.ownerDocument.createTextNode(value));
    return row;
  }
}
