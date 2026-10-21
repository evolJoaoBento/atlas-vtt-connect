// online-client/toolbar.mts
/**
 * The join page's toolbar, like Atlas's main toolbar: Move, Measure with its shape flyout, Laser
 * and Dice, and More tools for what does not fit (`playerToolbar.ts` decides which). It shows
 * the state the page gives it and hands clicks back; the tools themselves live in the map view.
 */
import {
  CLEAR_OWN_TEMPLATES_LABEL, hiddenControls, isControlActive, isMoveGroupTool, LASER_COLOR_HINT, laserSwatches, MEASURE_OPTIONS_LABEL,
  MEASURE_SHAPE_OPTIONS, measureIcon, MORE_TOOLS_LABEL, MOVE_OPTIONS_LABEL, MOVE_TOOL_OPTIONS, moveIcon, TEMPLATE_OPTIONS_LABEL, TEMPLATE_SHAPE_OPTIONS, templateIcon, TOOLBAR_CONTROLS,
  type ToolbarControlId, type ToolbarState,
} from '../src/app/online/page/playerToolbar';
import { toolIconUrl, type ToolIconName } from '../src/app/online/page/toolIcons';
import type { MeasureChoice } from '../src/app/online/view/tools/MeasureTool';
import type { PlayerTool } from '../src/app/online/view/tools/PlayerTools';
import type { TemplateShape } from '../src/app/online/tools/templates';
import type { ToolbarFitLayout } from '../src/app/packages/components/toolbar/toolbarFit';
import { iconElement, setIcon } from './icons.mts';

export interface PageToolbarOptions {
  root: HTMLElement;
  onTool(tool: PlayerTool): void;
  onShape(shape: MeasureChoice): void;
  /** A shape from the Template tool's menu; without it the menu does not show. */
  onTemplateShape?(shape: TemplateShape): void;
  /** Clear my templates, from the same menu. */
  onClearTemplates?(): void;
  onLaserColor(color: string): void;
  onDice(): void;
  /** Whether this toolbar's surface has the keyboard: inside Obsidian other panes' Escape must not close its menus. The page always does. */
  active?: () => boolean;
  /** The document whose keys and clicks the toolbar watches; the page's by default. */
  doc?: Document;
  /** Tests pass their own; the page measures rendered widths and reads the bar's style. */
  measure?: (element: HTMLElement) => number;
  layout?: () => ToolbarFitLayout;
}

/** The page's side gutter, on each side of the bar. */
const GUTTER = 16;

interface Control {
  item: HTMLElement;
  button: HTMLButtonElement;
  /** Its entry in More tools, shown while the control is in there. */
  entry: HTMLButtonElement;
}

function toolButton(label: string, icon: ToolIconName): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tool-button';
  button.setAttribute('aria-label', label);
  // The tooltip in style.css reads it; a `title` would show the browser's own instead.
  button.dataset.label = label;
  button.append(iconElement(toolIconUrl(icon)));
  return button;
}

function menu(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'toolbar-menu';
  element.setAttribute('role', 'menu');
  element.hidden = true;
  return element;
}

function menuEntry(label: string, icon: ToolIconName, onSelect: () => void): HTMLButtonElement {
  const entry = document.createElement('button');
  entry.type = 'button';
  entry.className = 'menu-entry';
  entry.setAttribute('role', 'menuitem');
  const text = document.createElement('span');
  text.textContent = label;
  entry.append(iconElement(toolIconUrl(icon)), text);
  entry.addEventListener('click', onSelect);
  return entry;
}

/** The chevron of a split button, as in Atlas: it opens the flyout next to the tool. */
function chevronButton(label: string, onClick: () => void): HTMLButtonElement {
  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'tool-chevron';
  chevron.setAttribute('aria-label', label);
  chevron.setAttribute('aria-haspopup', 'menu');
  chevron.setAttribute('aria-expanded', 'false');
  chevron.append(iconElement(toolIconUrl('chevron-down')));
  chevron.addEventListener('click', onClick);
  return chevron;
}

type OpenMenu = 'measure' | 'template' | 'laser' | 'more';

export class PageToolbar {
  private state: ToolbarState = {
    tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false,
    diceOpen: false, measureMenuOpen: false, templateMenuOpen: false, laserMenuOpen: false, laserColor: '',
  };
  private readonly controls = new Map<ToolbarControlId, Control>();
  private readonly widths = new Map<ToolbarControlId, number>();
  private readonly chevron: HTMLButtonElement;
  private readonly flyout: HTMLElement;
  private readonly templateChevron: HTMLButtonElement | null = null;
  private readonly templateFlyout: HTMLElement | null = null;
  private readonly clearTemplatesEntry: HTMLButtonElement | null = null;
  private readonly laserChevron: HTMLButtonElement;
  private readonly laserFlyout: HTMLElement;
  private readonly swatchButtons = new Map<string, HTMLButtonElement>();
  /** The Move group's tool its button shows: the one in use, else the last one used. */
  private moveTool: 'move' | 'laser' | 'ping' = 'move';
  private readonly more: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu: HTMLElement;
  private moreWidth = 0;
  private readonly listeners = new AbortController();
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly options: PageToolbarOptions) {
    const { root } = options;
    root.replaceChildren();
    this.moreMenu = menu();
    for (const control of TOOLBAR_CONTROLS) {
      const item = document.createElement('div');
      item.className = 'toolbar-item';
      item.dataset.control = control.id;
      const button = toolButton(control.label, control.icon);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => (control.id === 'move' ? this.activateMove() : this.activate(control.id)));
      item.append(button);
      root.append(item);
      const entry = menuEntry(control.label, control.icon, () => {
        this.closeMenus();
        if (control.id === 'move') this.activateMove();
        else this.activate(control.id);
      });
      this.moreMenu.append(entry);
      this.controls.set(control.id, { item, button, entry });
    }
    // Measure is a split button, as in Atlas: the tool, and a chevron that opens the shapes.
    const measure = this.controls.get('measure')!.item;
    measure.classList.add('tool-group');
    this.chevron = chevronButton(MEASURE_OPTIONS_LABEL, () => this.setMenu(this.state.measureMenuOpen ? null : 'measure'));
    this.flyout = menu();
    for (const option of MEASURE_SHAPE_OPTIONS) {
      this.flyout.append(menuEntry(option.label, option.icon, () => {
        this.closeMenus();
        options.onShape(option.shape);
      }));
    }
    measure.append(this.chevron, this.flyout);
    // Template too: its shapes, and clearing the player's own templates.
    if (options.onTemplateShape) {
      const template = this.controls.get('template')!.item;
      template.classList.add('tool-group');
      this.templateChevron = chevronButton(TEMPLATE_OPTIONS_LABEL, () => this.setMenu(this.state.templateMenuOpen ? null : 'template'));
      this.templateFlyout = menu();
      for (const option of TEMPLATE_SHAPE_OPTIONS) {
        this.templateFlyout.append(menuEntry(option.label, option.icon, () => {
          this.closeMenus();
          options.onTemplateShape?.(option.shape);
        }));
      }
      this.clearTemplatesEntry = menuEntry(CLEAR_OWN_TEMPLATES_LABEL, 'eraser', () => {
        this.closeMenus();
        options.onClearTemplates?.();
      });
      this.clearTemplatesEntry.classList.add('menu-entry--separated');
      this.templateFlyout.append(this.clearTemplatesEntry);
      template.append(this.templateChevron, this.templateFlyout);
    }
    // Move is Atlas's Move group: the tool in use on its button, and a chevron to Move, Laser and Ping and the laser's colours.
    const move = this.controls.get('move')!.item;
    move.classList.add('tool-group');
    this.laserChevron = chevronButton(MOVE_OPTIONS_LABEL, () => this.setMenu(this.state.laserMenuOpen ? null : 'laser'));
    this.laserFlyout = this.laserMenu();
    const tools = document.createElement('div');
    tools.className = 'menu-section';
    for (const option of MOVE_TOOL_OPTIONS) {
      tools.append(menuEntry(option.label, option.icon, () => {
        this.closeMenus();
        this.moveTool = option.tool;
        if (this.state.tool !== option.tool) options.onTool(option.tool);
      }));
    }
    this.laserFlyout.prepend(tools);
    move.append(this.laserChevron, this.laserFlyout);
    // More tools comes last and shows only while something is in it.
    this.more = document.createElement('div');
    this.more.className = 'toolbar-item toolbar-more';
    this.more.hidden = true;
    this.moreButton = toolButton(MORE_TOOLS_LABEL, 'ellipsis');
    this.moreButton.setAttribute('aria-haspopup', 'menu');
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.addEventListener('click', () => this.setMenu(this.moreMenu.hidden ? 'more' : null));
    this.more.append(this.moreButton, this.moreMenu);
    root.append(this.more);
    this.bind();
    this.render();
  }

  /** The page's tool, shape or tray changed. */
  update(state: Partial<Pick<ToolbarState, 'tool' | 'shape' | 'templateShape' | 'ownTemplates' | 'diceOpen' | 'laserColor'>>): void {
    this.state = { ...this.state, ...state };
    this.render();
  }

  /** Moves controls into More tools until the rest fit; run once the bar is shown and on every resize. */
  fit(): void {
    // A hidden table has no width: fit once it is shown and has a real size.
    if (this.layout().available <= 0) return;
    for (const [id, control] of this.controls) if (!control.item.hidden) this.widths.set(id, this.measureOf(control.item));
    if (!this.more.hidden) this.moreWidth = this.measureOf(this.more);
    const hidden = hiddenControls(this.widths, this.state, this.layout());
    for (const [id, control] of this.controls) {
      control.item.hidden = hidden.has(id);
      control.entry.hidden = !hidden.has(id);
    }
    this.more.hidden = hidden.size === 0;
    if (this.more.hidden && !this.moreMenu.hidden) {
      this.setMenu(this.state.measureMenuOpen ? 'measure' : this.state.templateMenuOpen ? 'template' : this.state.laserMenuOpen ? 'laser' : null);
    }
  }

  closeMenus(): void {
    this.setMenu(null);
  }

  dispose(): void {
    this.listeners.abort();
    this.resizeObserver?.disconnect();
  }

  /** The Move group's button: as in Atlas it keeps its tool in use, and from another tool goes back to the group's. */
  private activateMove(): void {
    if (this.state.tool !== this.moveTool) this.options.onTool(this.moveTool);
  }

  private activate(id: ToolbarControlId): void {
    if (id === 'dice') this.options.onDice();
    else this.options.onTool(id);
  }

  /** The laser flyout: a round swatch per color and the hint for colour-blind players. */
  private laserMenu(): HTMLElement {
    const flyout = menu();
    flyout.classList.add('swatch-menu');
    const grid = document.createElement('div');
    grid.className = 'swatch-grid';
    for (const swatch of laserSwatches('')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'swatch';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-label', swatch.ariaLabel);
      button.style.setProperty('--swatch', swatch.value);
      button.addEventListener('click', () => {
        this.closeMenus();
        this.options.onLaserColor(swatch.value);
      });
      this.swatchButtons.set(swatch.value, button);
      grid.append(button);
    }
    const hint = document.createElement('p');
    hint.className = 'menu-hint';
    hint.textContent = LASER_COLOR_HINT;
    flyout.append(grid, hint);
    return flyout;
  }

  /** Opens one menu and closes the others; an open flyout keeps its tool in the bar. */
  private setMenu(open: OpenMenu | null): void {
    this.state = { ...this.state, measureMenuOpen: open === 'measure', templateMenuOpen: open === 'template', laserMenuOpen: open === 'laser' };
    this.flyout.hidden = open !== 'measure';
    this.chevron.setAttribute('aria-expanded', String(open === 'measure'));
    if (this.templateFlyout) this.templateFlyout.hidden = open !== 'template';
    this.templateChevron?.setAttribute('aria-expanded', String(open === 'template'));
    this.laserFlyout.hidden = open !== 'laser';
    this.laserChevron.setAttribute('aria-expanded', String(open === 'laser'));
    this.moreMenu.hidden = open !== 'more';
    this.moreButton.setAttribute('aria-expanded', String(open === 'more'));
    this.fit();
  }

  private anyMenuOpen(): boolean {
    return !this.flyout.hidden || this.templateFlyout?.hidden === false || !this.laserFlyout.hidden || !this.moreMenu.hidden;
  }

  private render(): void {
    for (const [id, control] of this.controls) {
      const active = isControlActive(id, this.state);
      control.button.setAttribute('aria-pressed', String(active));
      control.button.classList.toggle('is-active', active);
      control.entry.classList.toggle('is-active', active);
    }
    if (isMoveGroupTool(this.state.tool)) this.moveTool = this.state.tool;
    const move = this.controls.get('move')!;
    const moveLabel = MOVE_TOOL_OPTIONS.find((option) => option.tool === this.moveTool)?.label ?? 'Move';
    const moveUrl = toolIconUrl(moveIcon(this.moveTool));
    setIcon(move.button, moveUrl);
    move.button.setAttribute('aria-label', moveLabel);
    move.button.dataset.label = moveLabel;
    setIcon(move.entry, moveUrl);
    for (const entry of this.laserFlyout.querySelectorAll<HTMLButtonElement>('.menu-section .menu-entry')) {
      entry.classList.toggle('is-active', entry.textContent === MOVE_TOOL_OPTIONS.find((option) => option.tool === this.state.tool)?.label);
    }
    const measure = this.controls.get('measure')!;
    const icon = toolIconUrl(measureIcon(this.state.shape));
    setIcon(measure.button, icon);
    setIcon(measure.entry, icon);
    if (this.templateFlyout) {
      const template = this.controls.get('template')!;
      const shapeIcon = toolIconUrl(templateIcon(this.state.templateShape));
      setIcon(template.button, shapeIcon);
      setIcon(template.entry, shapeIcon);
    }
    if (this.clearTemplatesEntry) this.clearTemplatesEntry.disabled = !this.state.ownTemplates;
    const current = this.state.laserColor.toLowerCase();
    for (const [value, button] of this.swatchButtons) {
      button.setAttribute('aria-checked', String(value === current));
      button.classList.toggle('is-selected', value === current);
    }
    this.fit();
  }

  private bind(): void {
    const { signal } = this.listeners;
    const { root } = this.options;
    // An open menu takes Escape first: closing it is all Escape does then.
    const doc = this.options.doc ?? document;
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.anyMenuOpen() || this.options.active?.() === false) return;
      event.stopImmediatePropagation();
      this.closeMenus();
    }, { capture: true, signal });
    doc.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Node && root.contains(event.target)) return;
      if (this.anyMenuOpen()) this.closeMenus();
    }, { signal });
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', () => this.fit(), { signal });
      return;
    }
    this.resizeObserver = new ResizeObserver(() => this.fit());
    this.resizeObserver.observe(root.parentElement ?? root);
  }

  private measureOf(element: HTMLElement): number {
    return this.options.measure?.(element) ?? element.getBoundingClientRect().width;
  }

  private layout(): ToolbarFitLayout {
    if (this.options.layout) return this.options.layout();
    const { root } = this.options;
    const style = getComputedStyle(root);
    const px = (value: string): number => Number.parseFloat(value) || 0;
    return {
      available: (root.parentElement?.clientWidth ?? window.innerWidth) - 2 * GUTTER,
      chrome: px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth),
      gap: px(style.columnGap),
      overflowButtonWidth: this.moreWidth || this.measureOf(this.moreButton),
    };
  }
}
