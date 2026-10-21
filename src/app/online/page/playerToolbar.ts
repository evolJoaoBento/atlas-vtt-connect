/**
 * The join page's toolbar, like Atlas's main toolbar: Move (with Laser and Ping in its group, as Atlas's Move group
 * holds its laser), Measure (with the Line, Circle/Sphere and Cone flyout), Template and Dice. Controls that do not fit move into More tools by priority,
 * through Atlas's own fit (`overflowingToolbarItems`). The active tool, and a control whose menu
 * or tray hangs from it, never move. Shared with the web page; the DOM is
 * `online-client/toolbar.mts`.
 */
import { LASER_COLOR_HINT, LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';
import { overflowingToolbarItems, type ToolbarFitLayout } from '../../packages/components/toolbar/toolbarFit';
import type { MeasureChoice } from '../view/tools/MeasureTool';
import type { PlayerTool } from '../view/tools/PlayerTools';
import type { TemplateShape } from '../tools/templates';
import type { ToolIconName } from './toolIcons';

export type ToolbarControlId = PlayerTool | 'dice';

export interface ToolbarControl {
  id: ToolbarControlId;
  label: string;
  icon: ToolIconName;
  /** Lower priorities move into More tools first. */
  priority: number;
}

export const MORE_TOOLS_LABEL = 'More tools';
export const MEASURE_OPTIONS_LABEL = 'Measure options';
export const LASER_OPTIONS_LABEL = 'Laser color options';
export const MOVE_OPTIONS_LABEL = 'Move options';
export const TEMPLATE_OPTIONS_LABEL = 'Template options';
export const CLEAR_OWN_TEMPLATES_LABEL = 'Clear my templates';
export { LASER_COLOR_HINT };

/** Atlas's priorities (`MainToolbar.tsx`). The laser lives in Atlas's Move group, so it ranks between Measure and Dice. */
export const TOOLBAR_CONTROLS: readonly ToolbarControl[] = [
  { id: 'move', label: 'Move', icon: 'hand', priority: 100 },
  { id: 'measure', label: 'Measure', icon: 'ruler', priority: 90 },
  { id: 'template', label: 'Template', icon: 'shapes', priority: 85 },
  { id: 'dice', label: 'Dice', icon: 'dices', priority: 75 },
];

/** The tools of the Move group, as Atlas's Move group holds Move/Select and its laser: its menu lists them. */
export const MOVE_TOOL_OPTIONS: ReadonlyArray<{ tool: 'move' | 'laser' | 'ping'; label: string; icon: ToolIconName }> = [
  { tool: 'move', label: 'Move', icon: 'hand' },
  { tool: 'laser', label: 'Laser', icon: 'flashlight' },
  { tool: 'ping', label: 'Ping', icon: 'radar' },
];

/** Whether `tool` is one of the Move group's. */
export function isMoveGroupTool(tool: PlayerTool): tool is 'move' | 'laser' | 'ping' {
  return tool === 'move' || tool === 'laser' || tool === 'ping';
}

/** The Move group's button shows its tool in use, as Atlas's does. */
export function moveIcon(tool: PlayerTool): ToolIconName {
  return MOVE_TOOL_OPTIONS.find((option) => option.tool === tool)?.icon ?? 'hand';
}

/** Atlas's measure flyout. */
export const MEASURE_SHAPE_OPTIONS: ReadonlyArray<{ shape: MeasureChoice; label: string; icon: ToolIconName }> = [
  { shape: 'line', label: 'Line', icon: 'ruler' },
  { shape: 'circle', label: 'Circle/Sphere', icon: 'circle' },
  { shape: 'cone', label: 'Cone', icon: 'triangle' },
];

/** The Template tool's shapes, in its own flyout. */
export const TEMPLATE_SHAPE_OPTIONS: ReadonlyArray<{ shape: TemplateShape; label: string; icon: ToolIconName }> = [
  { shape: 'line', label: 'Line', icon: 'ruler' },
  { shape: 'circle', label: 'Circle/Sphere', icon: 'circle' },
  { shape: 'square', label: 'Square/Cube', icon: 'square' },
  { shape: 'cone', label: 'Cone', icon: 'triangle' },
];

export interface ToolbarState {
  tool: PlayerTool;
  shape: MeasureChoice;
  /** The Template tool's shape. */
  templateShape: TemplateShape;
  /** Whether this player has a template on the scene: Clear my templates is offered only then. */
  ownTemplates: boolean;
  diceOpen: boolean;
  measureMenuOpen: boolean;
  templateMenuOpen: boolean;
  laserMenuOpen: boolean;
  /** The laser's colour now, marked in the flyout. */
  laserColor: string;
}

export interface LaserSwatch {
  value: string;
  label: string;
  /** The name a screen reader reads. */
  ariaLabel: string;
  selected: boolean;
}

/** The laser flyout's swatches, `selected` marking the one in use. */
export function laserSwatches(selected: string): LaserSwatch[] {
  const current = selected.toLowerCase();
  return LASER_COLOR_SWATCHES.map(({ value, label }) => ({ value, label, ariaLabel: label, selected: value === current }));
}

/** The Measure button shows the shape in use, as Atlas's does. */
export function measureIcon(shape: MeasureChoice): ToolIconName {
  return MEASURE_SHAPE_OPTIONS.find((option) => option.shape === shape)?.icon ?? 'ruler';
}

/** The Template button shows its shape. */
export function templateIcon(shape: TemplateShape): ToolIconName {
  return TEMPLATE_SHAPE_OPTIONS.find((option) => option.shape === shape)?.icon ?? 'shapes';
}

export function isControlActive(id: ToolbarControlId, state: ToolbarState): boolean {
  if (id === 'dice') return state.diceOpen;
  if (id === 'move') return isMoveGroupTool(state.tool);
  return state.tool === id;
}

/** The tool in use, and a control whose menu or tray hangs from it, stay in the bar. */
export function isControlPinned(id: ToolbarControlId, state: ToolbarState): boolean {
  return isControlActive(id, state) || (id === 'measure' && state.measureMenuOpen)
    || (id === 'template' && state.templateMenuOpen) || (id === 'move' && state.laserMenuOpen);
}

/** The controls that go into More tools; `widths` holds each control's last measured width. */
export function hiddenControls(
  widths: ReadonlyMap<ToolbarControlId, number>,
  state: ToolbarState,
  layout: ToolbarFitLayout,
): ReadonlySet<string> {
  return overflowingToolbarItems(TOOLBAR_CONTROLS.map((control) => ({
    id: control.id, width: widths.get(control.id), priority: control.priority, pinned: isControlPinned(control.id, state),
  })), layout);
}
