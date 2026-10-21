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
    onTemplateShape: (shape) => calls.push(`template ${shape}`),
    onClearTemplates: () => calls.push('clear templates'),
    onLaserColor: (color) => calls.push(`color ${color}`),
    onLaserSize: (size) => calls.push(`size ${size}`),
    onDice: () => calls.push('dice'),
    measure: (element) => (element.dataset.control === 'measure' || element.dataset.control === 'move' ? 56 : 36),
    layout: () => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
  });
  const button = (label: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
  const entries = (selector: string): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>(`${selector} .menu-entry`)];
  return { root, toolbar, calls, button, entries };
}

describe('the join page toolbar', () => {
  it('shows Move, Measure and Dice with tooltips and icons, Move pressed, and no native tooltip', () => {
    const { root, button } = setup();
    for (const label of ['Move', 'Measure', 'Dice']) expect(button(label).dataset.label).toBe(label);
    expect(button('Move').getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-control="laser"], [data-control="ping"]')).toBeNull();
    expect(button('Move').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('hand'));
    expect(root.querySelector('[title]')).toBeNull();
  });

  it('keeps Laser and Ping in the Move group, as Atlas does: its menu, its colours, and its face showing the tool in use', () => {
    const { root, toolbar, calls, button } = setup();
    button('Move options').click();
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-control="move"] .menu-entry')];
    expect(items.map((entry) => entry.textContent)).toEqual(['Move/Select', 'Laser Pointer', 'Ping']);
    expect(root.querySelectorAll('[data-control="move"] .swatch').length).toBeGreaterThan(0);
    items[1]!.click();
    button('Move options').click();
    root.querySelector<HTMLButtonElement>('[data-control="move"] .swatch')!.click();
    expect(calls).toEqual(['tool laser', 'color #ff0059']);
    toolbar.update({ tool: 'laser' });
    const face = root.querySelector<HTMLButtonElement>('[data-control="move"] .tool-button')!;
    expect(face.getAttribute('aria-label')).toBe('Laser');
    expect(face.getAttribute('aria-pressed')).toBe('true');
    expect(face.querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('flashlight'));
    // As in Atlas, the face keeps the tool in use; from another tool it goes back to the group's last.
    face.click();
    expect(calls).toEqual(['tool laser', 'color #ff0059']);
    toolbar.update({ tool: 'measure' });
    expect(face.getAttribute('aria-label')).toBe('Laser');
    face.click();
    expect(calls.at(-1)).toBe('tool laser');
  });

  it("lays the Move menu out as Atlas's: ticked tools, Laser colour with ticked swatches and its hint, and Laser size", () => {
    const { root, toolbar, calls, button } = setup();
    toolbar.update({ tool: 'laser', laserColor: '#00a9ff', laserSize: 24 });
    button('Move options').click();
    const menu = root.querySelector<HTMLElement>('[data-control="move"] .toolbar-menu')!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('.menu-entry')];
    expect(items.map((entry) => entry.textContent)).toEqual(['Move/Select', 'Laser Pointer', 'Ping']);
    expect(items.map((entry) => entry.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(menu.querySelector('.menu-label')?.textContent).toBe('Laser colour');
    const picked = menu.querySelector<HTMLButtonElement>('.swatch.is-selected')!;
    expect(picked.getAttribute('aria-label')).toBe('Sky blue');
    expect(picked.querySelector('.swatch-check')).not.toBeNull();
    expect(menu.querySelector('.menu-hint')?.textContent).toMatch(/colour-blind/);
    const size = menu.querySelector<HTMLInputElement>('input[type="range"][aria-label="Laser size"]')!;
    expect([size.min, size.max, size.value]).toEqual(['8', '100', '24']);
    expect(menu.querySelector('.menu-slider-value')?.textContent).toBe('24px');
    size.value = '40';
    size.dispatchEvent(new Event('input'));
    expect(calls).toEqual(['size 40']);
    toolbar.closeMenus();
  });

  it('hands clicks to the page and shows the state the page gives it', () => {
    const { toolbar, calls, button } = setup();
    button('Dice').click();
    expect(calls).toEqual(['dice']);
    toolbar.update({ tool: 'ping', diceOpen: true });
    expect(button('Ping').getAttribute('aria-pressed')).toBe('true');
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

  it("offers the Template tool's own shapes and Clear my templates, only while the player has some", () => {
    const { toolbar, calls, button, entries } = setup();
    button('Template options').click();
    const items = entries('[data-control="template"]');
    expect(items.map((entry) => entry.textContent)).toEqual(['Line', 'Circle/Sphere', 'Square/Cube', 'Cone', 'Clear my templates']);
    expect(items[4]!.disabled).toBe(true);
    items[2]!.click();
    toolbar.update({ tool: 'template', templateShape: 'square', ownTemplates: true });
    expect(button('Template').querySelector<HTMLElement>('.tool-icon')?.style.getPropertyValue('--icon')).toBe(toolIconUrl('square'));
    expect(items[4]!.disabled).toBe(false);
    button('Template options').click();
    items[4]!.click();
    expect(calls).toEqual(['template square', 'clear templates']);
  });

  it('moves what does not fit into More tools, and keeps the tool in use in the bar', () => {
    const { root, toolbar, calls, button, entries } = setup(190);
    toolbar.fit();
    const shown = (control: string): boolean => !root.querySelector<HTMLElement>(`[data-control="${control}"]`)!.hidden;
    expect(['move', 'measure', 'template', 'dice'].map(shown)).toEqual([true, true, false, false]);
    expect(button('More tools').closest<HTMLElement>('.toolbar-more')!.hidden).toBe(false);
    const more = entries('.toolbar-more').filter((entry) => !entry.hidden);
    expect(more.map((entry) => entry.textContent)).toEqual(['Template', 'Dice']);
    button('More tools').click();
    more[1]!.click();
    expect(calls).toEqual(['dice']);
    toolbar.update({ tool: 'template' });
    expect(shown('template')).toBe(true);
  });

  it('does not fit while the table is hidden, and fits once it has a width', () => {
    let available = 0;
    document.body.innerHTML = '<section><nav id="toolbar"></nav></section>';
    const root = document.getElementById('toolbar')!;
    const toolbar = new PageToolbar({
      root, onTool: () => {}, onShape: () => {}, onLaserColor: () => {}, onDice: () => {},
      measure: (element) => (element.dataset.control === 'measure' || element.dataset.control === 'move' ? 56 : 36),
      layout: () => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 }),
    });
    toolbar.fit();
    expect(root.querySelectorAll('.toolbar-item[hidden]:not(.toolbar-more)').length).toBe(0);
    available = 190;
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
