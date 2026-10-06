/**
 * A tab of one of the GM's map views: the unit a split party assigns players to. Tab ids are unique per view
 * and survive renames. Pure: this file imports nothing.
 */
export interface TabKey { viewId: string; tabId: string }

/** One string per tab, for maps and sets; the NUL separator keeps `a`+`bc` and `ab`+`c` apart. */
export function tabKeyOf(tab: TabKey): string {
  return `${tab.viewId}\u0000${tab.tabId}`;
}

/** Whether two tabs are the same one; two nulls (no scene) are the same too. */
export function sameTab(a: TabKey | null, b: TabKey | null): boolean {
  if (a === null || b === null) return a === b;
  return a.viewId === b.viewId && a.tabId === b.tabId;
}
