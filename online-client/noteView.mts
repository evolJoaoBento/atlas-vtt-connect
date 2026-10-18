// online-client/noteView.mts
/**
 * The note of a readable pin the player opened: the drawer the player's sheets use, with the note's title and its text
 * (`noteMarkdown.mts`). "Loading…" while the GM reads it; a line saying it could not be opened when the GM answers
 * with none, or never answers (an older Connect). The close button or Escape closes it. Shared with the Obsidian scene tab.
 */
import type { PinNote } from '../src/app/online/tools/pinNotes';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import { iconElement } from './icons.mts';
import { renderNoteMarkdown } from './noteMarkdown.mts';

export interface NoteViewOptions {
  panel: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  closeButton: HTMLButtonElement;
  /** Whether this surface has the keyboard: inside Obsidian other panes' Escape must not close it. The page always does. */
  active?: () => boolean;
  doc?: Document;
}

export const NOTE_LOADING_TEXT = 'Loading…';
export const NOTE_UNAVAILABLE_TEXT = "This note couldn't be opened.";
export const NOTE_CUT_TEXT = 'The rest of this note is too long to show here.';

export class NoteView {
  private readonly listeners = new AbortController();
  private open = false;

  constructor(private readonly options: NoteViewOptions) {
    const { signal } = this.listeners;
    options.panel.hidden = true;
    options.closeButton.replaceChildren(iconElement(toolIconUrl('x')));
    options.closeButton.addEventListener('click', () => this.close(), { signal });
    (options.doc ?? document).addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open || this.options.active?.() === false) return;
      event.stopImmediatePropagation();
      this.close();
    }, { capture: true, signal });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens it for a pin whose note is on its way. */
  loading(title: string): void {
    this.options.title.textContent = title;
    this.line(NOTE_LOADING_TEXT, 'note-status');
    this.setOpen(true);
  }

  /** The GM's answer: the note, or null when it could not be read. */
  show(note: PinNote | null): void {
    if (!note) {
      this.line(NOTE_UNAVAILABLE_TEXT, 'note-status');
      return;
    }
    this.options.title.textContent = note.title;
    renderNoteMarkdown(note.body, this.options.body);
    if (note.body.trim() === '') this.line('This note is empty.', 'note-status');
    if (note.cut) {
      const more = this.options.body.ownerDocument.createElement('p');
      more.className = 'note-status';
      more.textContent = NOTE_CUT_TEXT;
      this.options.body.append(more);
    }
    this.options.body.scrollTop = 0;
  }

  close(): void {
    this.setOpen(false);
  }

  dispose(): void {
    this.listeners.abort();
  }

  private line(text: string, className: string): void {
    const p = this.options.body.ownerDocument.createElement('p');
    p.className = className;
    p.textContent = text;
    this.options.body.replaceChildren(p);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.options.panel.hidden = !open;
    if (open) this.options.closeButton.focus({ preventScroll: true });
  }
}
