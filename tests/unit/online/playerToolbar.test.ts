import { describe, expect, it } from 'vitest';
import {
  hiddenControls, isControlActive, isControlPinned, measureIcon, TOOLBAR_CONTROLS, type ToolbarControlId, type ToolbarState,
} from '../../../src/app/online/page/playerToolbar';
import type { ToolbarFitLayout } from '../../../src/app/packages/components/toolbar/toolbarFit';

const layout = (available: number): ToolbarFitLayout => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 });
// The measure group is a split button, wider than the others.
const widths = new Map<ToolbarControlId, number>(TOOLBAR_CONTROLS.map((control) => [control.id, control.id === 'measure' ? 56 : 36]));
const state = (overrides: Partial<ToolbarState> = {}): ToolbarState => ({ tool: 'move', shape: 'line', diceOpen: false, measureMenuOpen: false, laserMenuOpen: false, laserColor: '#ff9f2e', ...overrides });

describe('the join page toolbar', () => {
  it("holds Move, Measure, Laser and Dice, ranked like Atlas's toolbar", () => {
    expect(TOOLBAR_CONTROLS.map(({ id, label, priority }) => [id, label, priority])).toEqual([
      ['move', 'Move', 100], ['measure', 'Measure', 90], ['laser', 'Laser', 80], ['dice', 'Dice', 75],
    ]);
  });

  it('hides nothing while everything fits', () => {
    // 19 + 36 + 56 + 36 + 36 + 3 × 8 = 207.
    expect(hiddenControls(widths, state(), layout(207)).size).toBe(0);
  });

  it('moves the lowest priorities into More tools first', () => {
    // 19 + More 36 + Move 44 + Measure 64 = 163; Laser would need 207.
    expect([...hiddenControls(widths, state(), layout(170))]).toEqual(['laser', 'dice']);
  });

  it('never moves the tool in use, or a control whose menu or tray is open', () => {
    expect([...hiddenControls(widths, state({ tool: 'laser', diceOpen: true }), layout(120))]).toEqual(['move', 'measure']);
    expect(isControlPinned('measure', state({ measureMenuOpen: true }))).toBe(true);
    expect(isControlActive('dice', state({ diceOpen: true }))).toBe(true);
    expect(isControlActive('move', state({ tool: 'measure' }))).toBe(false);
  });

  it('shows the measure shape in use on the Measure button, as Atlas does', () => {
    expect([measureIcon('line'), measureIcon('circle'), measureIcon('cone')]).toEqual(['ruler', 'circle', 'triangle']);
  });
});
