import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('styles/online-scene-canvas.scss', 'utf8');

describe("the player tab's dice log", () => {
  it('is a panel on the right that slides in as it appears', () => {
    expect(css).toMatch(/\.dice-log \{[^}]*top: 0; right: 0; bottom: 0;/);
    expect(css).toMatch(/\.dice-log:not\(\[hidden\]\) \{ animation: atlas-connect-log-in /);
    expect(css).toMatch(/@keyframes atlas-connect-log-in \{ from \{ transform: translateX\(100%\)/);
  });

  it('is opened by a bare, see-through icon rather than a pill', () => {
    expect(css).toMatch(/\.top-actions \{[^}]*background: none; border: 0; box-shadow: none;/);
  });
});
