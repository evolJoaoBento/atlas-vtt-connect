import { describe, expect, it } from 'vitest';
import { easeInOutQuad, glideDuration, TokenGlides } from '../../../src/app/online/view/layers/tokenGlides';

describe('token glides', () => {
  it("takes Atlas's time: 400 px a second, between 150 and 600 ms, eased in and out", () => {
    expect(glideDuration(10)).toBe(150);
    expect(glideDuration(200)).toBe(500);
    expect(glideDuration(5000)).toBe(600);
    expect([0, 0.25, 0.5, 0.75, 1].map(easeInOutQuad)).toEqual([0, 0.125, 0.5, 0.875, 1]);
  });

  it('turns towards a new target mid-glide from where the token is drawn', () => {
    let now = 0;
    const glides = new TokenGlides(() => now);
    const step = (x: number, held = false): number => {
      glides.begin('s');
      const point = glides.position('t', { x, y: 0 }, held);
      glides.end();
      return point.x;
    };
    step(0);
    step(200);
    now = 250;
    expect(step(200)).toBe(100);
    // Back to the start: from 100, 100 px, so 250 ms.
    expect(step(0)).toBe(100);
    now = 375;
    expect(step(0)).toBe(50);
    now = 500;
    expect(step(0)).toBe(0);
  });

  it('places a new token, a token back in the scene and every token of a new scene without a glide', () => {
    const glides = new TokenGlides(() => 0);
    glides.begin('s');
    glides.position('t', { x: 0, y: 0 }, false);
    glides.end();
    glides.begin('other');
    expect(glides.position('t', { x: 500, y: 0 }, false)).toEqual({ x: 500, y: 0 });
    glides.end();
    glides.begin('other');
    glides.end();
    glides.begin('other');
    expect(glides.position('t', { x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0 });
    expect(glides.animating()).toBe(false);
  });
});
