// online-client/hoverCardView.mts
/**
 * The card beside a hovered token, as Atlas's `ConditionHoverPanel` draws it: one row per condition with the same badge
 * as on the token (without its number) and its name, "Frightened 2", on Atlas's elevated surface, a constant size on
 * screen, 8 px right of the token's ring and centred on it; it fades in over 100 ms while it slides 4 px out of the
 * token and grows from 0.97. A readable pin's title shows by the pointer instead. Placed in the window's coordinates
 * (`position: fixed`) and kept inside it; it never takes input. Text only, never markup: names come from the GM's
 * scene. Shared with the Obsidian scene tab.
 */
import type { ConditionRow } from '../src/app/online/view/tokenHover';
import { drawConditionBadge } from '../src/app/online/view/layers/tokenUiDrawing';
import { createCanvasSurface } from '../src/app/online/view/canvasSurface';

/** Atlas's card metrics in screen pixels (`ConditionHoverPanel`): the gap to the ring, and a badge's radius. */
export const HOVER_CARD = { offset: 8, badgeRadius: 8 } as const;
/** A pin's title keeps this far from the pointer, so the card never sits under it. */
const POINTER_OFFSET = 14;

export class HoverCardView {
  /** What is shown now, so a hover that moves within a token does not rebuild the card. */
  private shown = '';

  constructor(private readonly element: HTMLElement) {
    element.hidden = true;
    element.setAttribute('role', 'tooltip');
  }

  /** The conditions card of a token whose ring's right edge is at window point (`ringX`, `centerY`). */
  showConditions(rows: readonly ConditionRow[], ringX: number, centerY: number): void {
    if (rows.length === 0) {
      this.hide();
      return;
    }
    const key = JSON.stringify(rows);
    const opening = this.element.hidden;
    if (key !== this.shown || opening) {
      this.shown = key;
      this.element.replaceChildren(...rows.map((row) => this.row(row)));
      this.element.classList.add('is-conditions');
    }
    this.open(opening);
    this.place(ringX + HOVER_CARD.offset, centerY - this.element.offsetHeight / 2);
  }

  /** A readable pin's title by the pointer at window point (`clientX`, `clientY`). */
  showText(title: string, clientX: number, clientY: number): void {
    const key = `text:${title}`;
    const opening = this.element.hidden;
    if (key !== this.shown || opening) {
      this.shown = key;
      const line = this.element.ownerDocument.createElement('div');
      line.className = 'hover-card-title';
      line.textContent = title;
      this.element.replaceChildren(line);
      this.element.classList.remove('is-conditions');
    }
    this.open(opening);
    const win = this.element.ownerDocument.defaultView;
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const maxX = (win?.innerWidth ?? Infinity) - 8;
    const maxY = (win?.innerHeight ?? Infinity) - 8;
    const x = clientX + POINTER_OFFSET + width > maxX ? Math.max(8, clientX - POINTER_OFFSET - width) : clientX + POINTER_OFFSET;
    const y = clientY + POINTER_OFFSET + height > maxY ? Math.max(8, clientY - POINTER_OFFSET - height) : clientY + POINTER_OFFSET;
    this.place(x, y);
  }

  hide(): void {
    this.element.hidden = true;
    this.element.classList.remove('is-open');
    this.shown = '';
  }

  private open(opening: boolean): void {
    const { element } = this;
    element.hidden = false;
    if (!opening) return;
    // Shown at its entrance's start, then let go to the open state, so the transition plays.
    element.classList.remove('is-open');
    void element.offsetWidth;
    element.classList.add('is-open');
  }

  /** Places the card's top left at window point (`x`, `y`). */
  private place(x: number, y: number): void {
    const { element } = this;
    // A fixed element is placed in its containing block, which is the window only where no ancestor contains it:
    // an Obsidian pane does (`contain: strict`). Placed at 0, 0 first, it tells where that block begins.
    element.style.removeProperty('--hover-x');
    element.style.removeProperty('--hover-y');
    const origin = element.getBoundingClientRect();
    element.style.setProperty('--hover-x', `${Math.round(x - origin.left)}px`);
    element.style.setProperty('--hover-y', `${Math.round(y - origin.top)}px`);
  }

  private row(row: ConditionRow): HTMLElement {
    const doc = this.element.ownerDocument;
    const element = doc.createElement('div');
    element.className = 'hover-card-row';
    const size = HOVER_CARD.badgeRadius * 2 + 4;
    const pixels = Math.ceil(size * Math.max(2, doc.defaultView?.devicePixelRatio ?? 1));
    const canvas = doc.createElement('canvas');
    canvas.className = 'hover-card-badge';
    canvas.setAttribute('aria-hidden', 'true');
    const surface = createCanvasSurface(canvas);
    if (surface) {
      surface.begin(pixels, pixels, null);
      surface.setCamera(pixels / size, pixels / 2, pixels / 2);
      drawConditionBadge(surface, row.look, 1, HOVER_CARD.badgeRadius);
    }
    const label = doc.createElement('span');
    label.className = 'hover-card-label';
    label.textContent = row.label;
    element.append(canvas, label);
    return element;
  }
}
