import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '@atlas-vtt/api-types';
import type { DockToken, DockView } from '../../../src/connect/stockUi/floatingDock';
import { watchTokenContextMenu } from '../../../src/connect/stockUi/tokenContextMenu';

const CLERIC: DockToken = { id: 't1', kind: 'character', label: 'Cleric' };

/** Atlas's token menu as the Radix menu draws it: items, the last of them Delete. */
function atlasMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'atlas-ctx-menu';
  menu.innerHTML = '<div role="menuitem" class="atlas-ctx-item">Hide</div><div role="menuitem" class="atlas-ctx-item">Delete</div>';
  document.body.appendChild(menu);
  return menu;
}

function setup(options: { token?: DockToken | null; items?: () => MenuItem[] } = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const view: DockView = {
    viewId: 'v1', doc: document, root,
    selectedTokens: () => [],
    tokenAt: () => (options.token === undefined ? CLERIC : options.token),
    tabs: () => [],
  };
  const players = new Set<string>();
  const items = options.items ?? ((): MenuItem[] => [{
    label: 'Controlled by', icon: 'users',
    submenu: ['Ana', 'Bea'].map((name): MenuItem => ({ label: name, checked: players.has(name), keepOpen: true, onClick: () => { if (!players.delete(name)) players.add(name); } })),
  }]);
  const stop = watchTokenContextMenu(view, { items, setIcon: (element, name) => { element.dataset.icon = name; } });
  const rightPress = (button = 2): void => { root.dispatchEvent(new MouseEvent('pointerdown', { button, bubbles: true })); };
  const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.atlas-connect-ctx-item')];
  return { root, stop, players, rightPress, rows };
}

describe("Connect in Atlas's right-click menu of a token", () => {
  beforeEach(() => { document.body.replaceChildren(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('adds "Controlled by" before Delete when the menu opens over a token', async () => {
    const t = setup();
    t.rightPress();
    const menu = atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    expect(menu.lastElementChild?.textContent).toBe('Delete');
    const row = t.rows()[0]!;
    expect(row.textContent).toBe('Controlled by');
    expect(row.nextElementSibling?.previousElementSibling).toBe(row);
    expect(menu.children[1]?.classList.contains('atlas-connect-ctx')).toBe(true);
  });

  it('opens the players on a press, ticks one on a press and keeps the menu open', async () => {
    const t = setup();
    t.rightPress();
    const menu = atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    const escapes: string[] = [];
    menu.addEventListener('keydown', (event) => escapes.push(event.key));
    const sub = (): HTMLElement => document.querySelector<HTMLElement>('.atlas-connect-ctx-sub')!;
    expect(sub().hidden).toBe(true);
    t.rows()[0]!.click();
    expect(sub().hidden).toBe(false);
    const ana = t.rows().find((row) => row.textContent === 'Ana')!;
    ana.click();
    expect(t.players.has('Ana')).toBe(true);
    // Redrawn: the list is still open and Ana is ticked.
    expect(sub().hidden).toBe(false);
    expect(t.rows().find((row) => row.textContent === 'Ana')?.getAttribute('aria-checked')).toBe('true');
    expect(t.rows().find((row) => row.textContent === 'Bea')?.getAttribute('aria-checked')).toBe('false');
    expect(escapes).toEqual([]);
    t.rows().find((row) => row.textContent === 'Ana')!.click();
    expect(t.players.has('Ana')).toBe(false);
  });

  it('keeps one list open at a time, so the menu stays short', async () => {
    const list = (label: string): MenuItem => ({ label, submenu: [{ label: `${label} choice`, keepOpen: true, onClick: () => undefined }] });
    const t = setup({ items: () => [list('HP for players'), list('Ki for players')] });
    t.rightPress();
    atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    const subs = (): boolean[] => [...document.querySelectorAll<HTMLElement>('.atlas-connect-ctx-sub')].map((sub) => sub.hidden);
    t.rows().find((row) => row.textContent === 'HP for players')!.click();
    expect(subs()).toEqual([false, true]);
    t.rows().find((row) => row.textContent === 'Ki for players')!.click();
    expect(subs()).toEqual([true, false]);
    // A choice redraws the menu: the list chosen in stays the open one.
    t.rows().find((row) => row.textContent === 'Ki for players choice')!.click();
    expect(subs()).toEqual([true, false]);
  });

  it('puts the entries back when React draws the menu anew', async () => {
    const t = setup();
    t.rightPress();
    const menu = atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    document.querySelector('.atlas-connect-ctx')!.remove();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.rows().length).toBeGreaterThan(0);
    expect(menu.lastElementChild?.textContent).toBe('Delete');
  });

  it('does nothing for the left button, for no token, for a menu that never opens, or for no entries', async () => {
    const left = setup();
    left.rightPress(0);
    atlasMenu();
    await vi.advanceTimersByTimeAsync(2000);
    expect(left.rows()).toEqual([]);
    document.body.replaceChildren();
    const none = setup({ token: null });
    none.rightPress();
    atlasMenu();
    await vi.advanceTimersByTimeAsync(2000);
    expect(none.rows()).toEqual([]);
    document.body.replaceChildren();
    const late = setup();
    late.rightPress();
    await vi.advanceTimersByTimeAsync(2000);
    atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    expect(late.rows()).toEqual([]);
    document.body.replaceChildren();
    const empty = setup({ items: () => [] });
    empty.rightPress();
    atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    expect(empty.rows()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops watching, and leaves no timer, when stopped', async () => {
    const t = setup();
    t.rightPress();
    t.stop();
    atlasMenu();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.rows()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
