/**
 * Connect's sections in Atlas's Edit Token dialog (`EditTokenModal`, `.atlas-edit-token-modal`), on a stock Atlas. Atlas
 * opens the dialog only from a token's right-click menu, so the token is the one pressed there: after a right press on
 * a token, the dialog that appears next gets the sections for that token, in its left column, in Atlas's own markup.
 *
 * The sections' choices apply only when the dialog saves, as its own fields do. The dialog says nothing when it closes,
 * so what closed it decides: its Save button, or Enter outside a button and a colour cell (as Atlas's own Enter rule
 * reads it), saved; Escape, Cancel, the close button or a click beside it did not.
 */
import type { EditTokenSectionSpec } from '../../app/online/gm-ui/editTokenSection';

const MODAL = '.atlas-edit-token-modal';
/** How long after a right press the dialog is waited for: the GM reads the menu first. */
const WAIT_MS = 30_000;
/** A save just before the dialog went is what closed it. */
const SAVE_WINDOW_MS = 1_000;

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  // Atlas's dialogs are in the main window's document, where `createEl` makes them.
  return createEl(tag, { cls, ...(text !== undefined && { text }) });
}

/** One section in Atlas's markup, with its choices read into `values` as they change. */
function sectionElement(spec: EditTokenSectionSpec, values: Map<string, string>): HTMLElement {
  const section = make('section', 'atlas-edit-token__section atlas-connect-edit-section');
  section.appendChild(make('h4', 'atlas-edit-token__section-label', spec.title));
  const table = make('div', 'atlas-connect-edit-table');
  table.style.setProperty('--atlas-connect-edit-columns', String(spec.columns.length));
  table.appendChild(make('span', 'atlas-connect-edit-table__corner'));
  for (const column of spec.columns) table.appendChild(make('span', 'atlas-edit-token__hint atlas-connect-edit-table__heading', column));
  for (const row of spec.rows) {
    table.appendChild(make('span', 'atlas-edit-token__label atlas-connect-edit-table__label', row.label));
    for (const choice of row.choices) {
      values.set(choice.id, choice.value);
      const select = make('select', 'dropdown atlas-connect-edit-table__choice');
      select.setAttribute('aria-label', choice.label);
      for (const option of choice.options) {
        const element = make('option', '', option.label);
        element.value = option.value;
        select.appendChild(element);
      }
      select.value = choice.value;
      select.addEventListener('change', () => values.set(choice.id, select.value));
      table.appendChild(select);
    }
  }
  section.appendChild(table);
  return section;
}

/** Adds `specs` to the open dialog `modal`; returns what stops watching it. Saves them if the dialog closes by saving. */
export function fillEditTokenDialog(modal: HTMLElement, specs: readonly EditTokenSectionSpec[]): () => void {
  const doc = modal.ownerDocument;
  const win = doc.defaultView;
  const column = modal.querySelector<HTMLElement>('.atlas-edit-token__column') ?? modal.querySelector<HTMLElement>('.atlas-modal-body');
  if (!win || !column || specs.length === 0) return () => undefined;
  const values = specs.map(() => new Map<string, string>());
  const sections = specs.map((spec, index) => sectionElement(spec, values[index]!));
  column.append(...sections);
  let savedAt = -Infinity;
  const saving = (): void => { savedAt = Date.now(); };
  const click = (event: MouseEvent): void => {
    const button = (event.target as Element | null)?.closest?.('.atlas-modal-footer button');
    if (button && button === button.parentElement?.lastElementChild) saving();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.target as Element | null)?.closest?.('button, input[type="color"]') == null) saving();
  };
  modal.addEventListener('click', click, true);
  win.addEventListener('keydown', key, true);
  const observer = new win.MutationObserver(() => {
    if (!modal.isConnected) {
      stop();
      if (Date.now() - savedAt <= SAVE_WINDOW_MS) specs.forEach((spec, index) => spec.save(values[index]!));
      return;
    }
    // React drew the column anew: the sections go back in.
    for (const section of sections) if (!section.isConnected && column.isConnected) column.appendChild(section);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const stop = (): void => {
    observer.disconnect();
    modal.removeEventListener('click', click, true);
    win.removeEventListener('keydown', key, true);
  };
  return stop;
}

/**
 * Waits up to 30 s for the Edit Token dialog to appear in `doc` and fills it with what `specs` gives then; returns what
 * stops waiting (a new right press, or the view going). A dialog filled keeps its own watch until it closes.
 */
export function awaitEditTokenDialog(doc: Document, specs: () => readonly EditTokenSectionSpec[]): () => void {
  const win = doc.defaultView;
  if (!win) return () => undefined;
  const fill = (): boolean => {
    const modal = doc.querySelector<HTMLElement>(MODAL);
    if (!modal || modal.querySelector('.atlas-connect-edit-section')) return false;
    fillEditTokenDialog(modal, specs());
    return true;
  };
  const observer = new win.MutationObserver(() => {
    if (fill()) stop();
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  const timer = win.setTimeout(() => stop(), WAIT_MS);
  const stop = (): void => {
    observer.disconnect();
    win.clearTimeout(timer);
  };
  return stop;
}
