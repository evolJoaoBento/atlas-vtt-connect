import { describe, expect, it } from 'vitest';
import { glideStep, TokenGlides } from '../../../src/app/online/view/layers/tokenGlides';

/** One frame of one token at `now`. */
function frame(glides: TokenGlides, x: number, options: { held?: boolean; mayGlide?: boolean; scene?: string } = {}): number {
  glides.begin(options.scene ?? 's');
  const point = glides.position('t', { x, y: 0 }, options.held ?? false, options.mayGlide ?? true);
  glides.end();
  return point.x;
}

describe('token glides', () => {
  it("follow Atlas's glideStep: about a third of the way is left after 50 ms, and it arrives within 0.05 px", () => {
    expect(glideStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 50).x).toBeCloseTo(100 - 100 * Math.exp(-1));
    expect(glideStep({ x: 0, y: 0 }, { x: 100, y: 0 }, 0).x).toBe(0);
    const to = { x: 100, y: 0 };
    expect(glideStep({ x: 99.99, y: 0 }, to, 16)).toBe(to);
  });

  it('snap into place within a few frames, and turn towards a new target mid-way from where the token is drawn', () => {
    let now = 0;
    const glides = new TokenGlides(() => now);
    frame(glides, 0);
    // The frame the new place arrives draws the token where it was; the glide steps from the next.
    expect(frame(glides, 200)).toBe(0);
    expect(glides.animating()).toBe(true);
    now = 50;
    const halfway = frame(glides, 200);
    expect(halfway).toBeCloseTo(200 - 200 * Math.exp(-1));
    now = 100;
    // Back again: from where it is drawn, not from where it started.
    const turned = frame(glides, 0);
    expect(turned).toBeLessThan(halfway);
    expect(turned).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) {
      now += 16;
      frame(glides, 0);
    }
    expect(frame(glides, 0)).toBe(0);
    expect(glides.animating()).toBe(false);
  });

  it('never steps further than 100 ms at once, so a tab hidden for a while does not jump a token there', () => {
    let now = 0;
    const glides = new TokenGlides(() => now);
    frame(glides, 0);
    frame(glides, 1000);
    now = 5000;
    expect(frame(glides, 1000)).toBeCloseTo(1000 - 1000 * Math.exp(-2));
  });

  it('put a dragged token, one that may not glide (another\'s on a lit scene) and every token for less motion in place at once', () => {
    const glides = new TokenGlides(() => 0);
    frame(glides, 0);
    expect(frame(glides, 300, { held: true })).toBe(300);
    expect(frame(glides, 0, { mayGlide: false })).toBe(0);
    expect(glides.animating()).toBe(false);

    const still = new TokenGlides(() => 0, () => true);
    frame(still, 0);
    expect(frame(still, 300)).toBe(300);
  });

  it('place a new token, a token back in the scene and every token of a new scene without a glide', () => {
    const glides = new TokenGlides(() => 0);
    frame(glides, 0);
    expect(frame(glides, 500, { scene: 'other' })).toBe(500);
    glides.begin('other');
    glides.end();
    expect(frame(glides, 0, { scene: 'other' })).toBe(0);
    expect(glides.animating()).toBe(false);
  });
});
