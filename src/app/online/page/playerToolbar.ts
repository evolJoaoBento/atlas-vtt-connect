/**
 * The join page's toolbar, like Atlas's main toolbar: Move, Measure (with the Line, Circle/Sphere
 * and Cone flyout), Laser and Dice. Controls that do not fit move into More tools by priority,
 * through Atlas's own fit (`overflowingToolbarItems`). The active tool, and a control whose menu
 * or tray hangs from it, never move. Shared with the web page; the DOM is
 * `online-client/toolbar.mts`.
 */
import { LASER_COLOR_HINT, LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';
import { overflowingToolbarItems, type ToolbarFitLayout } from '../../packages/components/toolbar/toolbarFit';
import type { MeasureChoice } from '../view/tools/MeasureTool';
import type { PlayerTool } from '../view/tools/PlayerTools';
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
export { LASER_COLOR_HINT };

/** Atlas's priorities (`MainToolbar.tsx`). The laser lives in Atlas's Move group, so it ranks between Measure and Dice. */
export const TOOLBAR_CONTROLS: readonly ToolbarControl[] = [
  { id: 'move', label: 'Move', icon: 'hand', priority: 100 },
  { id: 'measure', label: 'Measure', icon: 'ruler', priority: 90 },
  { id: 'laser', label: 'Laser', icon: 'flashlight', priority: 80 },
  { id: 'dice', label: 'Dice', icon: 'dices', priority: 75 },
];

/** Atlas's measure flyout. */
export const MEASURE_SHAPE_OPTIONS: ReadonlyArray<{ shape: MeasureChoice; label: string; icon: ToolIconName }> = [
  { shape: 'line', label: 'Line', icon: 'ruler' },
  { shape: 'circle', label: 'Circle/Sphere', icon: 'circle' },
  { shape: 'cone', label: 'Cone', icon: 'triangle' },
];

export interface ToolbarState {
  tool: PlayerTool;
  shape: MeasureChoice;
  diceOpen: boolean;
  measureMenuOpen: boolean;
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

export function isControlActive(id: ToolbarControlId, state: ToolbarState): boolean {
  return id === 'dice' ? state.diceOpen : state.tool === id;
}

/** The tool in use, and a control whose menu or tray hangs from it, stay in the bar. */
export function isControlPinned(id: ToolbarControlId, state: ToolbarState): boolean {
  return isControlActive(id, state) || (id === 'measure' && state.measureMenuOpen)
    || (id === 'laser' && state.laserMenuOpen);
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
