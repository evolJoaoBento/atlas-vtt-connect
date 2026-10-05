import { describe, expect, it } from 'vitest';
import { PageToolbar } from '../../../online-client/toolbar.mts';
import { toolIconUrl } from '../../../src/app/online/page/toolIcons';

function setup(available = 1000) {
  document.body.innerHTML = '<section><nav id="toolbar"></nav></section>';
  const root = document.getElementById('toolbar')!;
  const calls: string[] = [];
  const toolbar = new PageToolbar({
    root,
    onTool: (tool) => calls.push(`tool ${tool}`),
    onShape: (shape) => calls.push(`shape ${shape}`),
    onLaserColor: (color) => calls.push(`color ${color}`),
    onDice: () => calls.push('dice'),
    measure: (element) => (element.dataset.control === 'measure' ? 56 : 36),
    layout: () => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
  });
  const button = (label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const entries = (selector: string): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(`${selector} .menu-entry`)];
  return { root, toolbar, calls, button, entries };
}

describe('the join page toolbar', () => {
  it('shows Move, Measure, Laser and Dice with tooltips and icons, Move pressed, and no native tooltip', () => {
    const { root, button } = setup();
    for (const label of ['Move', 'Measure', 'Laser', 'Dice']) expect(button(label).dataset.label).toBe(label);
    expect(button('Move').getAttribute('aria-pressed')).toBe('true');
    expect(button('Laser').getAttribute('aria-pressed')).toBe('false');
    expect(button('Move').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('hand'));
    expect(root.querySelector('[title]')).toBeNull();
  });

  it('hands clicks to the page and shows the state the page gives it', () => {
    const { toolbar, calls, button } = setup();
    button('Laser').click();
    button('Dice').click();
    expect(calls).toEqual(['tool laser', 'dice']);
    toolbar.update({ tool: 'laser', diceOpen: true });
    expect(button('Laser').getAttribute('aria-pressed')).toBe('true');
    expect(button('Move').getAttribute('aria-pressed')).toBe('false');
    expect(button('Dice').classList.contains('is-active')).toBe(true);
  });

  it('offers the measure shapes in a flyout and shows the shape in use', () => {
    const { toolbar, calls, button, entries } = setup();
    button('Measure options').click();
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('true');
    const shapes = entries('[data-control="measure"]');
    expect(shapes.map((entry) => entry.textContent)).toEqual(['Line', 'Circle/Sphere', 'Cone']);
    shapes[2]!.click();
    expect(calls).toEqual(['shape cone']);
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('false');
    toolbar.update({ tool: 'measure', shape: 'cone' });
    expect(button('Measure').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('triangle'));
  });

  it('moves what does not fit into More tools, and keeps the tool in use in the bar', () => {
    const { root, toolbar, calls, button, entries } = setup(170);
    toolbar.fit();
    const shown = (control: string): boolean => !root.querySelector<HTMLElement>(`[data-control="${control}"]`)!.hidden;
    expect(['move', 'measure', 'laser', 'dice'].map(shown)).toEqual([true, true, false, false]);
    expect(button('More tools').closest<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
    const more = entries('.toolbar-more').filter((entry) => !entry.hidden);
    expect(more.map((entry) => entry.textContent)).toEqual(['Laser', 'Dice']);
    button('More tools').click();
    more[1]!.click();
    expect(calls).toEqual(['dice']);
    toolbar.update({ tool: 'laser' });
    expect(shown('laser')).toBe(true);
  });

  it('does not fit while the table is hidden, and fits once it has a width', () => {
    let available = 0;
    document.body.innerHTML = '<section><nav id="toolbar"></nav></section>';
    const root = document.getElementById('toolbar')!;
    const toolbar = new PageToolbar({
      root, onTool: () => {}, onShape: () => {}, onLaserColor: () => {}, onDice: () => {},
      measure: (element) => (element.dataset.control === 'measure' ? 56 : 36),
      layout: () => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
    });
    toolbar.fit();
    expect(root.querySelectorAll('.toolbar-item[hidden]:not(.toolbar-more)').length).toBe(0);
    available = 170;
    toolbar.fit();
    expect(root.querySelectorAll('.toolbar-item[hidden]:not(.toolbar-more)').length).toBe(2);
  });

  it('closes an open menu on Escape before the rest of the page hears it', () => {
    const { root, button } = setup();
    const heard: string[] = [];
    document.addEventListener('keydown', () => heard.push('page'));
    button('Measure options').click();
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button('Measure options').getAttribute('aria-expanded')).toBe('false');
    expect(heard).toEqual([]);
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(heard).toEqual(['page']);
  });
});
