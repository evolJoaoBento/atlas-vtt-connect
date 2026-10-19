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
  it("shows Atlas's card where the GM sent one, its dice links asking the GM to roll, without the numbers the token's bars show", () => {
    const t = setup();
    t.view.receive([{
      ...entry('a', 'Anna'),
      card: {
        html: '<div class="atlas-statblock"><h1>Anna</h1><span class="atlas-dice-link" data-connect-roll="0" role="button" tabindex="0">Claws</span></div>',
        css: '', variables: {}, rolls: [{ formula: '+4', text: 'Claws', label: 'Attack' }],
      },
    }]);
    t.toggleButton.click();
    const host = t.body.querySelector<HTMLElement>('.sheet-card')!;
    expect(t.body.firstElementChild).toBe(host);
    // The card in place of the text sheet: no second name, no text sheet's rolls.
    expect(t.body.querySelector('.sheet-name')).toBeNull();
    expect(t.body.querySelectorAll('.sheet-roll')).toHaveLength(0);
    expect(t.body.textContent).not.toContain('HP7 / 12');
    const link = host.shadowRoot!.querySelector<HTMLElement>('.atlas-dice-link')!;
    expect(link.getAttribute('aria-label')).toBe('Roll Attack: +4');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'card', index: 0, text: 'Claws', side: 'advantage' });
  });

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
    // The clicked text goes with it: the GM rolls only what its own copy has there.
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 1, text: '1d4 + 4' });
  });

  it('rolls with advantage on Shift-click and disadvantage on Alt-click, as Atlas, and both at once cancel', () => {
    const t = setup();
    t.view.receive([entry('a', 'Anna')]);
    t.toggleButton.click();
    const bonus = [...t.body.querySelectorAll<HTMLButtonElement>('.sheet-roll')].find((button) => button.textContent === '+6')!;
    bonus.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 0, text: '+6', side: 'advantage' });
    bonus.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 0, text: '+6', side: 'disadvantage' });
    bonus.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, altKey: true }));
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 0, text: '+6' });
    // Damage dice hold no d20: no side changes them.
    const damage = [...t.body.querySelectorAll<HTMLButtonElement>('.sheet-roll')].find((button) => button.textContent === '1d4 + 4')!;
    damage.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'text', section: 0, item: 0, index: 1, text: '1d4 + 4' });
  });

  it('offers the roll and its sides on a right-click, and Escape closes that menu before the drawer', () => {
    const t = setup();
    t.view.receive([entry('a', 'Anna')]);
    t.toggleButton.click();
    const check = [...t.body.querySelectorAll<HTMLButtonElement>('.sheet-roll')].find((button) => button.textContent === '+3')!;
    check.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 }));
    const entries = () => [...t.panel.querySelectorAll<HTMLButtonElement>('.sheet-roll-menu .menu-entry')];
    expect(entries().map((entry) => entry.textContent)).toEqual(['Roll', 'Roll with advantage', 'Roll with disadvantage']);
    entries()[2]!.click();
    expect(t.onRoll).toHaveBeenLastCalledWith('a', { kind: 'check', index: 1, side: 'disadvantage' });
    expect(entries()).toHaveLength(0);

    check.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(entries()).toHaveLength(0);
    expect(t.panel.hidden).toBe(false);

    const damage = [...t.body.querySelectorAll<HTMLButtonElement>('.sheet-roll')].find((button) => button.textContent === '1d4 + 4')!;
    damage.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    expect(entries().map((entry) => entry.textContent)).toEqual(['Roll']);
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
