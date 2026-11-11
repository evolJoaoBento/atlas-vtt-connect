import { afterEach, describe, expect, it, vi } from 'vitest';
import { inPageSelect, type InPageOption } from '../../src/app/ui/primitives/inPageSelect';

const OPTIONS: InPageOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma', group: 'Later' },
  { value: 'd', label: 'Delta', group: 'Later' },
];

function make(value = '') {
  const parent = document.body.createDiv();
  const changes: string[] = [];
  const select = inPageSelect(parent, { options: OPTIONS, value, placeholder: 'Pick one', ariaLabel: 'Letter' }, (next) => changes.push(next));
  const key = (name: string): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    select.button.dispatchEvent(event);
    return event;
  };
  const list = (): HTMLElement | null => select.el.querySelector('[role="listbox"]');
  const active = (): string | null => {
    const id = select.button.getAttribute('aria-activedescendant');
    return id ? document.getElementById(id)?.textContent ?? null : null;
  };
  return { parent, select, changes, key, list, active };
}

describe('the in-page dropdown', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('is a button in Obsidian\'s dropdown look, naming the choice or the placeholder, and no native select', () => {
    const { parent, select } = make();
    expect(parent.querySelector('select')).toBeNull();
    expect(select.button.classList.contains('dropdown')).toBe(true);
    expect(select.button.getAttribute('aria-label')).toBe('Letter');
    expect(select.button.getAttribute('aria-haspopup')).toBe('listbox');
    expect(select.button.textContent).toBe('Pick one');
    select.update({ options: OPTIONS, value: 'c', ariaLabel: 'Letter' });
    expect(select.button.textContent).toBe('Gamma');
  });

  it('opens on a click with its list in the page, groups under their heading, and chooses on a click', () => {
    const { select, changes, list } = make('a');
    select.button.click();
    expect(select.button.getAttribute('aria-expanded')).toBe('true');
    expect(select.el.contains(list())).toBe(true);
    expect([...list()!.children].map((child) => child.textContent)).toEqual(['Alpha', 'Beta', 'Later', 'Gamma', 'Delta']);
    // A disabled option is not chosen.
    list()!.querySelector<HTMLElement>('[aria-disabled="true"]')!.click();
    expect(changes).toEqual([]);
    [...list()!.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === 'Delta')!.click();
    expect(changes).toEqual(['d']);
    expect(select.value).toBe('d');
    expect(list()).toBeNull();
    expect(select.button.textContent).toBe('Delta');
  });

  it('works from the keyboard: arrows past disabled options, Home and End, Enter chooses', () => {
    const { select, changes, key, active } = make('a');
    key('ArrowDown');
    expect(select.isOpen).toBe(true);
    expect(active()).toBe('Alpha');
    key('ArrowDown');
    expect(active()).toBe('Gamma');
    key('End');
    expect(active()).toBe('Delta');
    key('Home');
    expect(active()).toBe('Alpha');
    key('ArrowDown');
    key('Enter');
    expect(changes).toEqual(['c']);
    expect(select.isOpen).toBe(false);
  });

  it('closes on Escape without letting it reach the dialog around it, on Tab, and on a press outside', () => {
    const { select, key, changes } = make('a');
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    select.open();
    const escape = key('Escape');
    expect(select.isOpen).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    // Closed, Escape is the dialog's.
    key('Escape');
    expect(heard).toHaveBeenCalledTimes(1);
    select.open();
    key('Tab');
    expect(select.isOpen).toBe(false);
    select.open();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(select.isOpen).toBe(false);
    expect(changes).toEqual([]);
    document.removeEventListener('keydown', heard);
  });

  it('opens on Enter or Space, and does nothing while disabled', () => {
    const { select, key } = make();
    key('Enter');
    expect(select.isOpen).toBe(true);
    select.close();
    key(' ');
    expect(select.isOpen).toBe(true);
    select.close();
    select.update({ options: OPTIONS, value: '', ariaLabel: 'Letter', disabled: true });
    select.button.click();
    expect(select.isOpen).toBe(false);
  });
});
