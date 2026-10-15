// online-client/hoverCardView.mts
/**
 * The token card under the mouse: a small panel by the pointer with the token's name and lines (`hoverCardFor`).
 * Placed in the window's coordinates (`position: fixed`) and kept inside it; it never takes input. Text only, never
 * markup: names and conditions come from the GM's scene. Shared with the Obsidian scene tab.
 */
import type { HoverCard } from '../src/app/online/view/tokenHover';

/** Distance from the pointer, so the card never sits under it. */
const OFFSET = 14;

export class HoverCardView {
  constructor(private readonly element: HTMLElement) {
    element.hidden = true;
    element.setAttribute('role', 'tooltip');
  }

  /** Shows `card` by the pointer at window point (`clientX`, `clientY`); null hides it. */
  show(card: HoverCard | null, clientX: number, clientY: number): void {
    const { element } = this;
    if (!card) {
      this.hide();
      return;
    }
    const doc = element.ownerDocument;
    element.replaceChildren();
    if (card.title) {
      const title = doc.createElement('div');
      title.className = 'hover-card-title';
      title.textContent = card.title;
      element.append(title);
    }
    for (const line of card.lines) {
      const row = doc.createElement('div');
      row.className = 'hover-card-line';
      if (line.color) {
        const dot = doc.createElement('span');
        dot.className = 'hover-card-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.style.setProperty('--hover-dot', line.color);
        row.append(dot);
      }
      row.append(doc.createTextNode(line.text));
      element.append(row);
    }
    element.hidden = false;
    // Measured once shown, then kept inside the window: to the pointer's left or above it near an edge.
    const win = doc.defaultView;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const maxX = (win?.innerWidth ?? Infinity) - 8;
    const maxY = (win?.innerHeight ?? Infinity) - 8;
    const x = clientX + OFFSET + width > maxX ? Math.max(8, clientX - OFFSET - width) : clientX + OFFSET;
    const y = clientY + OFFSET + height > maxY ? Math.max(8, clientY - OFFSET - height) : clientY + OFFSET;
    element.style.setProperty('--hover-x', `${Math.round(x)}px`);
    element.style.setProperty('--hover-y', `${Math.round(y)}px`);
  }

  hide(): void {
    this.element.hidden = true;
  }
}
