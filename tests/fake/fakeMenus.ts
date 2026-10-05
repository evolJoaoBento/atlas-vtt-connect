import type { MenuItem } from '@atlas-vtt/api-types';

/**
 * Atlas's menus as the fake draws them (`menuEntriesOf` and `AtlasContextMenu` at api-pr-13-end). A menu's own items
 * are built once, when it opens; an open submenu reads its provider again each time it is shown (after `ui.invalidate()`
 * in Atlas), finding itself by its label path, the first item with each label. A plain item with `keepOpen: true`
 * leaves the menu open when chosen; any other choice closes it.
 */

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** Menu entries as Atlas draws them: items without a label go, submenus keep their drawable children and go when none is left, `checked`, `disabled` and `keepOpen` belong to plain items. */
export function drawableMenu(items: unknown): MenuItem[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown): MenuItem[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { label, icon, onClick, submenu, checked, disabled, keepOpen } = item as MenuItem;
    if (!isText(label)) return [];
    if (submenu !== undefined) {
      const children = drawableMenu(submenu);
      return children.length > 0 ? [{ label, ...(icon ? { icon } : {}), submenu: children }] : [];
    }
    return [{
      label, ...(icon ? { icon } : {}), ...(onClick ? { onClick } : {}), ...(checked !== undefined ? { checked: checked === true } : {}),
      ...(disabled !== undefined ? { disabled: disabled === true } : {}), ...(keepOpen === true ? { keepOpen: true } : {}),
    }];
  });
}

/** The first item with each label along `path`, in `items`; undefined when one is missing. */
function itemAt(items: readonly MenuItem[], path: readonly string[]): MenuItem | undefined {
  let level: readonly MenuItem[] = items;
  let found: MenuItem | undefined;
  for (const label of path) {
    found = level.find((item) => item.label === label);
    if (!found) return undefined;
    level = found.submenu ?? [];
  }
  return found;
}

/** A menu the user has open. */
export interface OpenMenu {
  /** The menu's own items, as they were when it opened. */
  readonly items: readonly MenuItem[];
  /** Whether it is still open. */
  readonly isOpen: boolean;
  /** The submenu at `path` (labels), read anew from its provider; empty once the menu closed or the submenu is gone. */
  submenu(path: readonly string[]): MenuItem[];
  /** Chooses the plain item at `path`, as a click: runs `onClick` and closes the menu unless the item has `keepOpen`. False when there is no such item. */
  choose(path: readonly string[]): boolean;
}

/** Opens a menu whose items `read` gives (each call reads the providers again). */
export function openMenu(read: () => MenuItem[]): OpenMenu {
  const items = read();
  let open = items.length > 0;
  return {
    items,
    get isOpen() { return open; },
    submenu: (path) => (open ? itemAt(read(), path)?.submenu ?? [] : []),
    choose: (path) => {
      if (!open || path.length === 0) return false;
      // A submenu's items are the live ones; the menu's own are those it opened with.
      const item = path.length === 1 ? itemAt(items, path) : itemAt(read(), path);
      if (!item || item.submenu || item.disabled) return false;
      try {
        item.onClick?.();
      } catch (error) {
        console.error('[Atlas API] A menu item threw:', error);
      }
      if (item.keepOpen !== true) open = false;
      return true;
    },
  };
}
