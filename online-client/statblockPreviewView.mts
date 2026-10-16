// online-client/statblockPreviewView.mts
/**
 * Atlas's Ctrl/Cmd+hover stat block preview (`StatblockPreviewWindow`): while the player holds Ctrl (Cmd on a Mac) over
 * one of their tokens, its sheet floats 15 px from the pointer, kept inside the window, as a card on the elevated shadow;
 * it eases in as Atlas's preview does and never takes input, so its rolls show as text. Placed in the window's
 * coordinates (`position: fixed`). Text only, never markup: everything comes from the GM. Shared with the Obsidian tab.
 */
import type { TokenSheet } from '../src/app/online/tools/sheets';
import { sheetContent } from './sheetView.mts';

/** Atlas's distance from the pointer, and the margin kept inside the window. */
const OFFSET = 15;
const MARGIN = 8;

export class StatblockPreviewView {
  private shown: TokenSheet | null = null;

  constructor(private readonly element: HTMLElement) {
    element.hidden = true;
    element.setAttribute('role', 'tooltip');
  }

  /** Shows `entry`'s sheet by the pointer at window point (`clientX`, `clientY`). */
  show(entry: TokenSheet, clientX: number, clientY: number): void {
    const { element } = this;
    const doc = element.ownerDocument;
    if (entry !== this.shown || element.hidden) {
      this.shown = entry;
      const body = doc.createElement('div');
      body.className = 'sheet-body';
      // A preview takes no input: its rolls are text.
      body.append(...sheetContent(entry, doc, (_roll, label) => {
        const text = doc.createElement('span');
        text.className = 'sheet-roll is-static';
        text.textContent = label;
        return text;
      }));
      element.replaceChildren(body);
      element.hidden = false;
      element.classList.remove('is-open');
      void element.offsetWidth;
      element.classList.add('is-open');
    }
    const win = doc.defaultView;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const maxX = (win?.innerWidth ?? Infinity) - MARGIN;
    const maxY = (win?.innerHeight ?? Infinity) - MARGIN;
    const x = clientX + OFFSET + width > maxX ? Math.max(MARGIN, clientX - OFFSET - width) : clientX + OFFSET;
    const y = Math.max(MARGIN, Math.min(clientY + OFFSET, maxY - height));
    // A fixed element is placed in its containing block, which is the window only where no ancestor contains it:
    // an Obsidian pane does (`contain: strict`). Placed at 0, 0 first, it tells where that block begins.
    element.style.removeProperty('--preview-x');
    element.style.removeProperty('--preview-y');
    const origin = element.getBoundingClientRect();
    element.style.setProperty('--preview-x', `${Math.round(x - origin.left)}px`);
    element.style.setProperty('--preview-y', `${Math.round(y - origin.top)}px`);
  }

  hide(): void {
    this.element.hidden = true;
    this.element.classList.remove('is-open');
    this.shown = null;
  }
}
