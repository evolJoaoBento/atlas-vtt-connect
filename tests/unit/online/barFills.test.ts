import { describe, expect, it } from 'vitest';
import { BAR_MOTION, BarFills } from '../../../src/app/online/view/layers/barFills';
import { cubicBezier, easeOut } from '../../../src/app/online/view/motion';
import { colorNumber, drawBarFill, lightenColor } from '../../../src/app/online/view/layers/tokenUiDrawing';
import type { ViewSurface } from '../../../src/app/online/view/ViewSurface';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let time = 1000;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

/** One frame of one bar. */
function frame(fills: BarFills, share: number, key = 't1:0'): { fill: number; trail: number } {
  fills.begin('scene');
  const shown = fills.frame(key, share);
  fills.end();
  return shown;
}

describe('the motion curves', () => {
  it('follow CSS cubic-bezier: linear stays linear, the ends are fixed, ease-out runs ahead', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    // cubic-bezier(0.23, 1, 0.32, 1) is most of the way there by a quarter of the time.
    expect(easeOut(0.25)).toBeGreaterThan(0.7);
  });
});

describe("a token's bar", () => {
  it('shows its first value at once', () => {
    const { now } = clock();
    const fills = new BarFills(now);
    expect(frame(fills, 0.5)).toEqual({ fill: 0.5, trail: 0.5 });
    expect(fills.animating()).toBe(false);
  });

  it('eases a loss down over 400 ms and drains the trail of the loss after a beat', () => {
    const { now, advance } = clock();
    const fills = new BarFills(now);
    frame(fills, 1);

    frame(fills, 0.25);
    advance(160);
    const early = frame(fills, 0.25);
    expect(early.fill).toBeLessThan(1);
    expect(early.fill).toBeGreaterThan(0.25);
    // The trail holds for 350 ms before it drains.
    expect(early.trail).toBe(1);
    expect(fills.animating()).toBe(true);

    advance(BAR_MOTION.fillMs);
    const filled = frame(fills, 0.25);
    expect(filled.fill).toBe(0.25);
    expect(filled.trail).toBeGreaterThan(0.25);

    advance(BAR_MOTION.trailDelayMs + BAR_MOTION.trailMs);
    expect(frame(fills, 0.25)).toEqual({ fill: 0.25, trail: 0.25 });
    expect(fills.animating()).toBe(false);
  });

  it('shows a gain as the trail at once and grows the fill into it', () => {
    const { now, advance } = clock();
    const fills = new BarFills(now);
    frame(fills, 0.2);

    const start = frame(fills, 0.8);
    expect(start.trail).toBe(0.8);
    expect(start.fill).toBeCloseTo(0.2);
    advance(BAR_MOTION.fillMs);
    expect(frame(fills, 0.8)).toEqual({ fill: 0.8, trail: 0.8 });
  });

  it('heads for a new value from where it is drawn, mid-way', () => {
    const { now, advance } = clock();
    const fills = new BarFills(now);
    frame(fills, 1);
    frame(fills, 0);
    advance(100);
    const mid = frame(fills, 0).fill;
    const turned = frame(fills, 1);
    expect(turned.fill).toBeCloseTo(mid);
  });

  it('jumps when the viewer asks for less motion, on a new scene, and after the bar went', () => {
    const { now } = clock();
    const reduced = new BarFills(now, () => true);
    frame(reduced, 1);
    expect(frame(reduced, 0.3)).toEqual({ fill: 0.3, trail: 0.3 });

    const fills = new BarFills(now);
    frame(fills, 1);
    fills.begin('another scene');
    expect(fills.frame('t1:0', 0.3)).toEqual({ fill: 0.3, trail: 0.3 });
    fills.end();

    fills.begin('another scene');
    fills.end();
    expect(frame(fills, 0.9, 't1:0')).toEqual({ fill: 0.9, trail: 0.9 });
  });
});

describe('a bar fill', () => {
  const recorder = (): { surface: ViewSurface; calls: Array<[string, unknown[]]> } => {
    const calls: Array<[string, unknown[]]> = [];
    const surface = new Proxy({}, { get: (_target, name: string) => (...args: unknown[]) => { calls.push([name, args]); } }) as ViewSurface;
    return { surface, calls };
  };

  it('is a rounded rectangle when at least as wide as the bar is tall', () => {
    const { surface, calls } = recorder();
    drawBarFill(surface, 0, 0, 30, 8, { fill: '#ff0000' });
    expect(calls.map(([name]) => name)).toEqual(['roundRect']);
  });

  it('narrower than that, is only the filled part of the round cap, never a thin strip', () => {
    const { surface, calls } = recorder();
    drawBarFill(surface, 0, 0, 2, 8, { fill: '#ff0000' });
    const [name, args] = calls[0]!;
    expect(name).toBe('paths');
    const points = (args[0] as Array<Array<{ x: number; y: number }>>)[0]!;
    // Every point lies on the cap's circle, at or left of where the fill ends.
    for (const point of points) {
      expect(Math.hypot(point.x - 4, point.y - 4)).toBeCloseTo(4);
      expect(point.x).toBeLessThanOrEqual(2 + 1e-9);
    }
    expect(Math.min(...points.map((point) => point.x))).toBeCloseTo(0);
  });

  it('draws nothing when empty', () => {
    const { surface, calls } = recorder();
    drawBarFill(surface, 0, 0, 0, 8, { fill: '#ff0000' });
    expect(calls).toEqual([]);
  });

  it("lightens a trail as Atlas's lightenColor does", () => {
    expect(colorNumber('#22c55e')).toBe(0x22c55e);
    expect(colorNumber('red')).toBeNull();
    expect(lightenColor(0x22c55e, 0.55)).toBe(0xaeffea);
  });
});
