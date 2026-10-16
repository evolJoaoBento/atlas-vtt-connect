import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('styles/online-scene-canvas.scss', 'utf8');

describe("the player tab's dice log", () => {
  it('is a drawer over the table from the right edge that slides in and out, taking no room from the map', () => {
    expect(css).toMatch(/\.dice-log \{[^}]*position: absolute; top: 0; right: 0; bottom: 0;/);
    // Hidden would remove it from the page and leave nothing to animate: closed, it waits off to the side.
    expect(css).toMatch(/\.dice-log\[hidden\] \{ display: grid !important; transform: translateX\(105%\); visibility: hidden;/);
    expect(css).toMatch(/\.dice-log \{[^}]*transition: transform 280ms/);
    expect(css).not.toMatch(/animation: atlas-connect-log/);
  });

  it('is opened from a vertical bar in the middle of the right edge, in the toolbar\'s surface', () => {
    expect(css).toMatch(/\.top-actions \{[^}]*top: 50%; transform: translateY\(-50%\); flex-direction: column;/);
    // No glow of its own: the pill's surface, border and shadow are the toolbar's.
    expect(css).not.toMatch(/\.top-actions[^{]*\{[^}]*(filter|background: none|box-shadow: none)/);
    // The bar is no containing block, so 50% is the table's middle, not the bar's.
    expect(css).toMatch(/\.top-bar \{ position: static; \}/);
  });
});

describe('opening the drawer does not move the table', () => {
  it('keeps the table from being scrolled, by focus or otherwise', () => {
    // A drawer still off to the side, focused, would scroll an overflow:hidden table sideways to show it.
    expect(css).toMatch(/&\.table \{[^}]*overflow: hidden; overflow: clip;/);
    const view = readFileSync('online-client/diceLogView.mts', 'utf8');
    expect(view).toContain('closeButton.focus({ preventScroll: true })');
    expect(view).toContain('toggleButton.focus({ preventScroll: true })');
  });
});
