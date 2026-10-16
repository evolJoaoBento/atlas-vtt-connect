import { describe, expect, it, vi } from 'vitest';
import { SheetView } from '../../../online-client/sheetView.mts';
import { buildSheet, type TokenSheet } from '../../../src/app/online/tools/sheets';

let last: SheetView | null = null;

function setup() {
  last?.dispose();
  document.body.replaceChildren();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => document.body.appendChild(document.createElement(tag));
  const parts = { panel: make('aside'), body: make('div'), tabs: make('div'), closeButton: make('button'), toggleButton: make('button') };
  const onRoll = vi.fn(() => true);
  const view = new SheetView({ ...parts, onRoll });
  last = view;
  return { view, onRoll, ...parts };
}

const sheet = buildSheet({ name: 'Anna', stats: [10, 16, 10, 10, 10, 10], actions: [{ name: 'Dagger', desc: '<b>x</b> +6 to hit. Hit: 1d4 + 4.' }] });
const entry = (tokenId: string, name: string): TokenSheet => ({ tokenId, name, resources: [{ name: 'HP', current: 7, max: 12 }], sheet });

describe('the sheet drawer', () => {
  it('shows its button only while the player has sheets', () => {
    const t = setup();
    expect(t.toggleButton.hidden).toBe(true);
    t.view.receive([entry('a', 'Anna')]);
    expect(t.toggleButton.hidden).toBe(false);
    t.view.receive([]);
    expect(t.toggleButton.hidden).toBe(true);
  });

  it('writes the sheet as text, and asks the GM to roll what is clicked', () => {
    const t = setup();
    t.view.receive([entry('a', 'Anna')]);
    t.toggleButton.click();
    expect(t.panel.hidden).toBe(false);
    expect(t.body.textContent).toContain('HP7 / 12');
    expect(t.body.querySelector('b')).toBeNull();
    expect(t.body.textContent).toContain('<b>x</b>');
    const rolls = [...t.body.querySelectorAll<HTMLButtonElement>('.sheet-roll')];
    rolls.find((button) => button.textContent === '+3')!.click();
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'check', index: 1 });
    rolls.find((button) => button.textContent === '1d4 + 4')!.click();
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 1 });
  });

  it('switches between tokens with tabs, and closes on Escape', () => {
    const t = setup();
    t.view.receive([entry('a', 'Anna'), entry('b', 'Bram')]);
    t.toggleButton.click();
    expect(t.tabs.hidden).toBe(false);
    t.tabs.querySelectorAll<HTMLButtonElement>('.sheet-tab')[1]!.click();
    expect(t.body.querySelector('.sheet-name')?.textContent).toBe('Bram');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(t.panel.hidden).toBe(true);
  });
});
