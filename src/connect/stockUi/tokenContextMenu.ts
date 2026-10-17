/**
 * Connect's entries in Atlas's own right-click menu of a token (the Radix menu, `.atlas-ctx-menu`), so "Controlled by" is
 * where a GM looks for it: right-click a character, choose "Controlled by", tick the players. Atlas draws that menu
 * with React and opens it when the right button is released, so this notes the token under the pointer when the button
 * goes down and adds the entries to the menu when it appears. Inside the menu the entries are plain rows in Atlas's
 * `atlas-ctx-item` markup: Radix knows nothing of them, so a press on one never closes the menu.
 */
import type { MenuItem } from '@atlas-vtt/api-types';
import type { EditTokenSectionSpec } from '../../app/online/gm-ui/editTokenSection';
import { awaitEditTokenDialog } from './editTokenDialog';
import type { DockToken, DockView } from './floatingDock';

const MENU = '.atlas-ctx-menu';
/** How long after a right press Atlas's menu is waited for. */
const WAIT_MS = 1500;
/** The submenus the GM has open, by label: kept across a redraw. */
const open = new Set<string>();
const ROW = 'atlas-ctx-item atlas-connect-ctx-item';

function make<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  return createEl(tag, { cls, ...(text !== undefined && { text }) });
}

export interface TokenContextMenuDeps {
  /** The entries to add to a token's menu: what the registered token menu providers give for it. */
  items(view: DockView, token: DockToken): MenuItem[];
  setIcon(element: HTMLElement, name: string): void;
  /** The sections for the token's Edit Token dialog, should the GM open it from this menu (`editTokenDialog.ts`). */
  editTokenSections?(view: DockView, token: DockToken): EditTokenSectionSpec[];
}

/** Starts watching `view`'s root for right presses on tokens. Returns what stops it. */
export function watchTokenContextMenu(view: DockView, deps: TokenContextMenuDeps): () => void {
  const { root, doc } = view;
  const win = doc.defaultView;
  if (!root || !win || !view.tokenAt) return () => undefined;
  let waiting: MutationObserver | null = null;
  let timer: number | null = null;
  let stopDialog: (() => void) | null = null;
  const stopWaiting = (): void => {
    waiting?.disconnect();
    waiting = null;
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  };

  const press = (event: PointerEvent): void => {
    stopWaiting();
    if (event.button !== 2) return;
    const token = view.tokenAt?.(event.clientX, event.clientY) ?? null;
    if (!token) return;
    // Atlas puts its dialogs in the main window's document, whatever window the view is in.
    stopDialog?.();
    stopDialog = deps.editTokenSections ? awaitEditTokenDialog(document, () => deps.editTokenSections?.(view, token) ?? []) : null;
    const attach = (): boolean => {
      const menu = doc.querySelector<HTMLElement>(MENU);
      if (!menu) return false;
      if (!menu.querySelector('.atlas-connect-ctx-item')) addTo(menu, view, token, deps);
      return true;
    };
    if (attach()) return;
    waiting = new win.MutationObserver(() => {
      if (attach()) stopWaiting();
    });
    waiting.observe(doc.body, { childList: true, subtree: true });
    timer = win.setTimeout(stopWaiting, WAIT_MS);
  };
  root.addEventListener('pointerdown', press, true);
  return () => {
    stopWaiting();
    stopDialog?.();
    root.removeEventListener('pointerdown', press, true);
  };
}

function addTo(menu: HTMLElement, view: DockView, token: DockToken, deps: TokenContextMenuDeps): void {
  const holder = make('div', 'atlas-connect-ctx');
  const close = (): void => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };
  const draw = (): void => {
    holder.replaceChildren();
    const items = deps.items(view, token);
    if (items.length === 0) {
      holder.hidden = true;
      return;
    }
    holder.hidden = false;
    fill(holder, items, deps, close, draw);
  };
  draw();
  if (holder.hidden) return;
  // Before the menu's last entry (Delete), so the destructive one stays at the end.
  menu.insertBefore(holder, menu.lastElementChild);
  // React may draw the menu anew (a choice made in it): the entries go back in.
  const win = menu.ownerDocument.defaultView;
  if (!win) return;
  const again = new win.MutationObserver(() => {
    if (!menu.isConnected) {
      again.disconnect();
      return;
    }
    if (!holder.isConnected) menu.insertBefore(holder, menu.lastElementChild);
  });
  again.observe(menu, { childList: true });
}

function fill(into: HTMLElement, items: MenuItem[], deps: TokenContextMenuDeps, close: () => void, redraw: () => void): void {
  for (const entry of items) {
    if (entry.label === '-') continue;
    const row = make('div', ROW);
    row.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (entry.checked !== undefined) row.setAttribute('aria-checked', String(entry.checked));
    if (entry.disabled === true) row.setAttribute('aria-disabled', 'true');
    if (entry.submenu) {
      const lead = make('span', 'atlas-ctx-item__leading');
      const icon = make('span', 'atlas-ctx-icon');
      if (entry.icon) deps.setIcon(icon, entry.icon);
      lead.append(icon, make('span', 'atlas-ctx-item__label', entry.label));
      const trail = make('span', 'atlas-ctx-item__trailing');
      const chevron = make('span', 'atlas-ctx-icon atlas-connect-ctx-chevron');
      deps.setIcon(chevron, 'chevron-right');
      trail.appendChild(chevron);
      row.append(lead, trail);
      const sub = make('div', 'atlas-connect-ctx-sub');
      sub.dataset.label = entry.label;
      fill(sub, entry.submenu, deps, close, redraw);
      // An open list stays open while it is redrawn after a choice.
      sub.hidden = !open.has(entry.label);
      chevron.classList.toggle('is-open', !sub.hidden);
      row.addEventListener('click', () => {
        sub.hidden = !sub.hidden;
        chevron.classList.toggle('is-open', !sub.hidden);
        if (sub.hidden) {
          open.delete(entry.label);
          return;
        }
        open.add(entry.label);
        // One list open at a time beside it, so Atlas's menu stays short enough to fit the window.
        for (const other of Array.from(into.children)) {
          if (other === sub || !other.classList.contains('atlas-connect-ctx-sub') || other.hasAttribute('hidden')) continue;
          other.setAttribute('hidden', '');
          open.delete(other.getAttribute('data-label') ?? '');
          other.previousElementSibling?.querySelector('.atlas-connect-ctx-chevron')?.classList.remove('is-open');
        }
      });
      into.append(row, sub);
      continue;
    }
    row.appendChild(make('span', 'atlas-connect-ctx-label', entry.label));
    if (entry.checked === true) {
      const trail = make('span', 'atlas-ctx-item__trailing');
      const check = make('span', 'atlas-ctx-icon');
      deps.setIcon(check, 'check');
      trail.appendChild(check);
      row.appendChild(trail);
    }
    if (entry.disabled !== true) {
      row.addEventListener('click', () => {
        try {
          entry.onClick?.();
        } catch (error) {
          console.error(`[Atlas VTT Connect] Menu item ${entry.label} failed:`, error);
        }
        if (entry.keepOpen === true) redraw();
        else close();
      });
    }
    into.appendChild(row);
  }
}
