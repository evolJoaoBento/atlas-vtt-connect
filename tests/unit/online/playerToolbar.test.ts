import { describe, expect, it } from 'vitest';
import {
  hiddenControls, isControlActive, isControlPinned, measureIcon, moveIcon, TOOLBAR_CONTROLS, type ToolbarControlId, type ToolbarState,
} from '../../../src/app/online/page/playerToolbar';
import type { ToolbarFitLayout } from '../../../src/app/packages/components/toolbar/toolbarFit';

const layout = (available: number): ToolbarFitLayout => ({ available, chrome: 19, gap: 8, overflowButtonWidth: 36 });
// The Move and Measure groups are split buttons, wider than the others.
const widths = new Map<ToolbarControlId, number>(TOOLBAR_CONTROLS.map((control) => [control.id, control.id === 'measure' || control.id === 'move' ? 56 : 36]));
const state = (overrides: Partial<ToolbarState> = {}): ToolbarState => ({ tool: 'move', shape: 'line', templateShape: 'circle', ownTemplates: false, diceOpen: false, measureMenuOpen: false, templateMenuOpen: false, laserMenuOpen: false, laserColor: '#ff9f2e', ...overrides });

describe('the join page toolbar', () => {
  it("holds Move (Laser and Ping in its group, as Atlas's Move group), Measure, Template and Dice, ranked like Atlas's toolbar", () => {
    expect(TOOLBAR_CONTROLS.map(({ id, label, priority }) => [id, label, priority])).toEqual([
      ['move', 'Move', 100], ['measure', 'Measure', 90], ['template', 'Template', 85], ['dice', 'Dice', 75],
    ]);
  });

  it('hides nothing while everything fits', () => {
    // 19 + 56 + 56 + 36 + 36 + 3 × 8 = 227.
    expect(hiddenControls(widths, state(), layout(227)).size).toBe(0);
  });

  it('moves the lowest priorities into More tools first', () => {
    // 19 + More 36 + Move 64 + Measure 64 = 183; Template would need 227.
    expect([...hiddenControls(widths, state(), layout(190))]).toEqual(['template', 'dice']);
  });

  it('never moves the tool in use, or a control whose menu or tray is open', () => {
    expect([...hiddenControls(widths, state({ tool: 'laser', diceOpen: true }), layout(120))]).toEqual(['measure', 'template']);
    expect(isControlActive('move', state({ tool: 'laser' }))).toBe(true);
    expect(isControlActive('move', state({ tool: 'ping' }))).toBe(true);
    expect(isControlPinned('move', state({ laserMenuOpen: true }))).toBe(true);
    expect(isControlPinned('measure', state({ measureMenuOpen: true }))).toBe(true);
    expect(isControlActive('dice', state({ diceOpen: true }))).toBe(true);
    expect(isControlActive('move', state({ tool: 'measure' }))).toBe(false);
  });

  it('shows the tool in use of the Move group on its button, as Atlas does', () => {
    expect([moveIcon('move'), moveIcon('laser'), moveIcon('ping')]).toEqual(['hand', 'flashlight', 'radar']);
  });

  it('shows the measure shape in use on the Measure button, as Atlas does', () => {
    expect([measureIcon('line'), measureIcon('circle'), measureIcon('cone')]).toEqual(['ruler', 'circle', 'triangle']);
  });
});
