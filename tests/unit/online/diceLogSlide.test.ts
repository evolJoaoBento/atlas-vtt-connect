import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('styles/online-scene-canvas.scss', 'utf8');

describe("the player tab's dice log", () => {
  it('is a panel on the right that slides in as it appears', () => {
    expect(css).toMatch(/\.dice-log \{[^}]*top: 0; right: 0; bottom: 0;/);
    expect(css).toMatch(/\.dice-log:not\(\[hidden\]\) \{ animation: atlas-connect-log-in /);
    expect(css).toMatch(/@keyframes atlas-connect-log-in \{ from \{ transform: translateX\(100%\)/);
  });

  it('slides in whatever the system says of motion: it is the panel arriving, not decoration', () => {
    expect(css).not.toMatch(/prefers-reduced-motion.*dice-log/);
  });

  it('is opened by a bare, glowing icon in the middle of the right edge rather than a pill', () => {
    expect(css).toMatch(/\.top-actions \{[^}]*top: 50%; transform: translateY\(-50%\);[^}]*background: none; border: 0; box-shadow: none;/);
    expect(css).toMatch(/\.top-actions \.icon-button \{[^}]*filter: drop-shadow\(0 0 5px/);
    // The bar is no containing block, so 50% is the table's middle, not the bar's.
    expect(css).toMatch(/\.top-bar \{ position: static; \}/);
  });
});
