// online-client/diceToastView.mts
/**
 * Roll result cards as Atlas's toast draws them (`DiceToast.tsx`, `dice-toast.scss`): a card with knotwork in its
 * corners, the roller's initial on a disc, their name, the ability in small caps, an advantage tag and the formula, a
 * "Details" toggle for the dice, and the total as a large number in the accent that lands after a beat. A critical
 * success turns the accent yellow, a failure red. Cards stack, newest on top, slide in, stay `DICE_TOAST_MS` and leave,
 * or leave at once when clicked. Text only, never markup: everything comes from the GM. Shared with the Obsidian tab.
 */
import { dieLabel } from '@atlas-vtt/shared/rules';
import { DICE_TOAST_MS, dieExtreme, entryRolls, rollerLabel } from '../src/app/online/page/diceLogModel';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import { DICE_TOAST_KNOT_PATHS } from '../src/app/online/page/diceToastOrnament';
import { dieTagOf, dieTagText } from '../src/app/online/tools/diceTags';
import type { DiceLogEntry } from '../src/app/online/tools/toolMessages';
import { iconElement } from './icons.mts';

/** Atlas's card timings (`useDiceToasts`): entering, and leaving. */
export const DICE_CARD_MS = { enter: 350, exit: 300 } as const;
/** Cards shown at once; an older one leaves for a new one. */
const MAX_CARDS = 3;
const SVG = 'http://www.w3.org/2000/svg';
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

let knots = 0;

interface Card {
  id: string;
  element: HTMLElement;
  timers: number[];
  leaving: boolean;
}

function span(doc: Document, className: string, text: string): HTMLSpanElement {
  const element = doc.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

/**
 * A tagged die's tag as Atlas's log writes it: " · ● Fire", the colour dot (decorative) and the name as text, or the
 * colour code when it has no name, so colour is never the only signal. Checked again here; null for an untagged die.
 */
export function tagElement(die: DiceLogEntry['dice'][number], doc: Document = document): HTMLSpanElement | null {
  const tag = dieTagOf(die);
  const label = dieTagText(tag);
  if (label === null) return null;
  const element = span(doc, 'die-tag', ' · ');
  if (tag.color) {
    const dot = span(doc, 'die-tag-dot', '●');
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--die-tag-colour', tag.color);
    element.append(dot, ' ');
  }
  element.append(label);
  return element;
}

/** The roller as the card names them: the log's name without the ability, which the card shows on its own. */
export function cardName(entry: DiceLogEntry): string {
  const name = rollerLabel(entry);
  const suffix = entry.ability ? `: ${entry.ability}` : '';
  return suffix && entry.name.endsWith(suffix) ? rollerLabel({ ...entry, name: entry.name.slice(0, -suffix.length) }) : name;
}

export class DiceToastView {
  private readonly cards: Card[] = [];
  private readonly knotId = `atlas-connect-knot-${++knots}`;

  constructor(private readonly container: HTMLElement) {
    const doc = container.ownerDocument;
    // The knotwork once, referenced by every corner of every card.
    const defs = doc.createElementNS(SVG, 'svg');
    defs.setAttribute('class', 'dice-card-defs');
    defs.setAttribute('aria-hidden', 'true');
    const group = doc.createElementNS(SVG, 'g');
    group.setAttribute('id', this.knotId);
    group.setAttribute('fill', 'none');
    group.setAttribute('stroke', 'currentColor');
    group.setAttribute('stroke-width', '10');
    for (const d of DICE_TOAST_KNOT_PATHS) {
      const path = doc.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      group.append(path);
    }
    defs.append(group);
    container.replaceChildren(defs);
    container.hidden = true;
  }

  /** Shows a card for `entry`, on top of the others. */
  show(entry: DiceLogEntry): void {
    if (this.cards.some((card) => card.id === entry.id)) return;
    const element = this.cardElement(entry);
    const card: Card = { id: entry.id, element, timers: [], leaving: false };
    this.container.hidden = false;
    this.container.insertBefore(element, this.container.children[1] ?? null);
    this.cards.unshift(card);
    card.timers.push(
      window.setTimeout(() => element.classList.remove('is-entering'), DICE_CARD_MS.enter),
      window.setTimeout(() => this.dismiss(card), DICE_TOAST_MS),
    );
    for (const old of this.cards.filter((each) => !each.leaving).slice(MAX_CARDS)) this.dismiss(old);
  }

  /** Every card leaves (the log opened, the session ended). */
  clear(): void {
    for (const card of [...this.cards]) this.dismiss(card);
  }

  dispose(): void {
    for (const card of this.cards) card.timers.forEach((timer) => window.clearTimeout(timer));
    this.cards.length = 0;
  }

  private dismiss(card: Card): void {
    if (card.leaving) return;
    card.leaving = true;
    card.timers.forEach((timer) => window.clearTimeout(timer));
    card.element.classList.remove('is-entering');
    card.element.classList.add('is-exiting');
    card.timers = [window.setTimeout(() => {
      card.element.remove();
      const at = this.cards.indexOf(card);
      if (at >= 0) this.cards.splice(at, 1);
      if (this.cards.length === 0) this.container.hidden = true;
    }, DICE_CARD_MS.exit)];
  }

  private cardElement(entry: DiceLogEntry): HTMLElement {
    const doc = this.container.ownerDocument;
    const card = doc.createElement('div');
    card.className = 'dice-card is-entering';
    if (entry.crit) card.classList.add(entry.crit === 'high' ? 'is-crit-success' : 'is-crit-fail');
    card.setAttribute('role', 'status');
    for (const corner of CORNERS) {
      const svg = doc.createElementNS(SVG, 'svg');
      svg.setAttribute('class', `dice-card-corner dice-card-corner--${corner}`);
      svg.setAttribute('viewBox', '188 0 260 260');
      svg.setAttribute('aria-hidden', 'true');
      const use = doc.createElementNS(SVG, 'use');
      use.setAttribute('href', `#${this.knotId}`);
      svg.append(use);
      card.append(svg);
    }
    const name = cardName(entry);
    const body = doc.createElement('div');
    body.className = 'dice-card-body';
    const main = doc.createElement('div');
    main.className = 'dice-card-main';
    const avatar = span(doc, 'dice-card-avatar', Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?');
    avatar.setAttribute('aria-hidden', 'true');
    const content = doc.createElement('div');
    content.className = 'dice-card-content';
    content.append(span(doc, 'dice-card-name', name));
    if (entry.ability) content.append(span(doc, 'dice-card-ability', entry.ability));
    if (entry.advantage) content.append(span(doc, 'dice-card-advantage', entry.advantage === 'advantage' ? 'Advantage' : 'Disadvantage'));
    content.append(span(doc, 'dice-card-formula', entry.formula));
    main.append(avatar, content);
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'dice-card-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.append(iconElement(toolIconUrl('chevron-down')), span(doc, 'dice-card-toggle-label', 'Details'));
    const details = doc.createElement('div');
    details.className = 'dice-card-details';
    details.hidden = true;
    const rolls = entryRolls(entry);
    const dropping = entry.dice.some((die) => die.dropped === true);
    entry.dice.forEach((die, index) => {
      const badge = span(doc, 'dice-card-die', dieLabel(rolls, index));
      if (die.dropped) badge.classList.add('is-dropped');
      else {
        const extreme = dieExtreme(die);
        if (extreme) badge.classList.add(`is-${extreme}`);
        if (dropping) badge.classList.add('is-kept');
      }
      const tag = tagElement(die, doc);
      if (tag) badge.append(tag);
      details.append(badge);
    });
    if (entry.unlisted) details.append(span(doc, 'dice-card-die is-more', `+${entry.unlisted} more`));
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      details.hidden = !details.hidden;
      toggle.setAttribute('aria-expanded', String(!details.hidden));
      toggle.classList.toggle('is-open', !details.hidden);
    });
    body.append(main, toggle, details);
    const result = doc.createElement('div');
    result.className = 'dice-card-result';
    result.append(span(doc, 'dice-card-total', String(entry.total)));
    card.append(body, result);
    card.addEventListener('click', () => {
      const shown = this.cards.find((each) => each.element === card);
      if (shown) this.dismiss(shown);
    });
    return card;
  }
}
