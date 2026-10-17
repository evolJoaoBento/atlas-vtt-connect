// online-client/diceLogView.mts
/**
 * The dice log on the join page: a side panel, and a bottom sheet on narrow screens. It opens
 * from the top bar's Dice log button, and closes with its close button or Escape. A new roll
 * shows as Atlas's result card while the log is closed (`DiceToastView`). It shows every roll's name, formula, dice and total, newest first, as text only, the
 * dice written as Atlas's log writes them (`6!` exploded, `−d10: 7` subtracted by an explosion),
 * a critical roll marked, and "+N more" for dice a large roll does not list. The log's rules live
 * in `PlayerDiceLog` (`src/app/online/page/diceLogModel.ts`).
 */
import { dieExtreme, entryRolls, PlayerDiceLog, rollerLabel, type PlayerDiceLogOptions } from '../src/app/online/page/diceLogModel';
import { dieLabel } from '@atlas-vtt/shared/rules';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import type { DiceLogEntry } from '../src/app/online/tools/toolMessages';
import { iconElement } from './icons.mts';
import { DiceToastView, tagElement } from './diceToastView.mts';

export interface DiceLogViewOptions {
  panel: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  closeButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  /** Where new rolls show as result cards (`DiceToastView`). */
  toast: HTMLElement;
  /** The player's own new roll: true when it is thrown as dice instead of toasted. */
  onOwnRoll?: PlayerDiceLogOptions['onOwnRoll'];
  /** Whether this log's surface has the keyboard: inside Obsidian other panes' Escape must not close it. The page always does. */
  active?: () => boolean;
  /** The document whose keys the log takes; the page's by default. */
  doc?: Document;
}

function text(className: string, content: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = content;
  return element;
}


function entryElement(entry: DiceLogEntry, tag: 'li' | 'div'): HTMLElement {
  const item = document.createElement(tag);
  item.className = 'dice-entry';
  if (entry.crit) item.classList.add(entry.crit === 'high' ? 'is-crit-success' : 'is-crit-fail');
  const summary = document.createElement('div');
  summary.className = 'dice-entry-summary';
  summary.append(text('dice-entry-formula', entry.formula), text('dice-entry-eq', '='), text('dice-entry-total', String(entry.total)));
  const dice = document.createElement('div');
  dice.className = 'dice-entry-dice';
  const rolls = entryRolls(entry);
  entry.dice.forEach((die, index) => {
    const badge = text('die-badge', dieLabel(rolls, index));
    const extreme = dieExtreme(die);
    if (extreme) badge.classList.add(`is-${extreme}`);
    const tag = tagElement(die);
    if (tag) badge.append(tag);
    dice.append(badge);
  });
  if (entry.unlisted) dice.append(text('die-badge is-more', `+${entry.unlisted} more`));
  item.append(text('dice-entry-name', rollerLabel(entry)), summary, dice);
  return item;
}

export class DiceLogView {
  readonly log: PlayerDiceLog;
  private shown: readonly DiceLogEntry[] | null = null;
  private readonly listeners = new AbortController();
  private readonly cards: DiceToastView;
  /** The roll whose card was shown last, so a redraw does not show it again. */
  private carded: string | null = null;

  constructor(private readonly options: DiceLogViewOptions) {
    this.cards = new DiceToastView(options.toast);
    this.log = new PlayerDiceLog({ onChange: () => this.render(), ...(options.onOwnRoll ? { onOwnRoll: options.onOwnRoll } : {}) });
    const { signal } = this.listeners;
    options.toggleButton.replaceChildren(iconElement(toolIconUrl('dices')));
    options.toggleButton.addEventListener('click', () => this.setOpen(!this.log.isOpen), { signal });
    options.closeButton.addEventListener('click', () => this.close(), { signal });
    // An open log takes Escape first: closing it is all Escape does then.
    (options.doc ?? document).addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.log.isOpen || this.options.active?.() === false) return;
      event.stopImmediatePropagation();
      this.close();
    }, { capture: true, signal });
    this.render();
  }

  receive(entries: readonly DiceLogEntry[], replay: boolean): void {
    this.log.receive(entries, replay);
  }

  setOpen(open: boolean): void {
    this.options.panel.hidden = !open;
    this.options.toggleButton.setAttribute('aria-expanded', String(open));
    this.log.setOpen(open);
    // Never scrolling: a drawer still off to the side would otherwise pull the whole table sideways to show its button.
    if (open) this.options.closeButton.focus({ preventScroll: true });
  }

  dispose(): void {
    this.listeners.abort();
    this.log.dispose();
    this.cards.dispose();
  }

  private close(): void {
    this.setOpen(false);
    this.options.toggleButton.focus({ preventScroll: true });
  }

  private render(): void {
    const { list, empty } = this.options;
    const entries = this.log.entries;
    if (entries !== this.shown) {
      this.shown = entries;
      list.replaceChildren(...entries.map((entry) => entryElement(entry, 'li')));
    }
    empty.hidden = entries.length > 0;
    // An open log shows every roll: no card stays over it.
    if (this.log.isOpen) this.cards.clear();
    const latest = this.log.toast;
    if (latest && latest.id !== this.carded) this.cards.show(latest);
    this.carded = latest?.id ?? this.carded;
  }
}
