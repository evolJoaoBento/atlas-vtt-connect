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

  it('is opened by a bare, glowing icon in the middle of the right edge rather than a pill', () => {
    expect(css).toMatch(/\.top-actions \{[^}]*top: 50%; transform: translateY\(-50%\);[^}]*background: none; border: 0; box-shadow: none;/);
    expect(css).toMatch(/\.top-actions \.icon-button \{[^}]*filter: drop-shadow\(0 0 4px/);
    // The bar is no containing block, so 50% is the table's middle, not the bar's.
    expect(css).toMatch(/\.top-bar \{ position: static; \}/);
  });
});
