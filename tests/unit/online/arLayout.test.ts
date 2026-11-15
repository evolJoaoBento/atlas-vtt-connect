import { describe, expect, it } from 'vitest';
import { MarkerLayout } from '../../../online-client/ar/markerLayout.mts';
import { CARD_MM, FIRST_CARD, markerCardsSvg, markerGroup } from '../../../online-client/ar/markerSheet.mts';
import { intrinsicsFor, project, sheetPose, type Point } from '../../../online-client/ar/sheetPose.mts';
import type { Detected } from '../../../online-client/ar/sheetTracker.mts';

const camera = intrinsicsFor(640, 480, 65);
const mul = (a: number[], b: number[]): number[] => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
};
const tilt = (a: number): number[] => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const spin = (a: number): number[] => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

/** Where the cards really lie, in the first card's frame: card 2 off to the right and turned. */
const TRUTH: Record<number, { x: number; y: number; heading: number }> = {
  [FIRST_CARD]: { x: 0, y: 0, heading: 0 },
  [FIRST_CARD + 1]: { x: 180, y: 40, heading: 0.6 },
  [FIRST_CARD + 2]: { x: 330, y: -60, heading: -1.1 },
};

function cornersOf(id: number): Point[] {
  const truth = TRUTH[id]!;
  const c = Math.cos(truth.heading);
  const s = Math.sin(truth.heading);
  return markerGroup(id)!.corners.map((p) => ({ x: truth.x + c * p.x - s * p.y, y: truth.y + s * p.x + c * p.y }));
}

/** What a camera at this pose over the first card's frame finds: the ids in sight, with a little corner noise. */
function picture(rotation: number[], translation: number[], ids: number[], noise: number, seed: number): Detected[] {
  return ids.map((id) => {
    const seen = cornersOf(id).map((point, k) => {
      const p = project({ rotation, translation }, camera, point)!;
      return { x: p.x + Math.sin(seed * 3.1 + k * 1.7 + id) * noise, y: p.y + Math.cos(seed * 2.3 + k * 2.9 + id) * noise };
    });
    return { id, seen, pose: sheetPose(markerGroup(id)!.corners, seen, camera) };
  });
}

describe('marker cards laid round the map', () => {
  it('prints twelve cards a page, each its own marker', () => {
    const svg = markerCardsSvg(0);
    expect(svg).toContain('width="210mm" height="297mm"');
    expect(svg).toContain(`${CARD_MM} mm`);
    expect(markerGroup(FIRST_CARD)?.group).toBe(`card-${FIRST_CARD}`);
    expect(markerGroup(0)?.group).toBe('sheet');
    expect(markerGroup(5)).toBeNull();
  });

  it('learns where a card lies from pictures with a placed one, then places the camera from it alone', () => {
    const layout = new MarkerLayout();
    // The first card alone first: the map's middle stands on it.
    layout.observe(picture(tilt(-0.5), [0, 0, 500], [FIRST_CARD], 0.2, 0), camera, 640);
    // Pictures with the first and second cards, from a camera moving a little over them.
    for (let i = 0; i < 30; i++) {
      const rotation = mul(spin(0.1 + i * 0.01), tilt(-0.6));
      const translation = [-90 + i, -20, 520];
      layout.observe(picture(rotation, translation, [FIRST_CARD, FIRST_CARD + 1], 0.4, i), camera, 640);
    }
    // Then with the second and third: the third is placed through the second.
    for (let i = 0; i < 30; i++) {
      const rotation = mul(spin(-0.2 + i * 0.01), tilt(-0.5));
      const translation = [-250 + i, 0, 520];
      layout.observe(picture(rotation, translation, [FIRST_CARD + 1, FIRST_CARD + 2], 0.4, i + 50), camera, 640);
    }
    for (const id of [FIRST_CARD + 1, FIRST_CARD + 2]) {
      const learnt = layout.corners(id)!;
      cornersOf(id).forEach((point, k) => {
        expect(Math.abs(learnt[k]!.x - point.x)).toBeLessThan(4);
        expect(Math.abs(learnt[k]!.y - point.y)).toBeLessThan(4);
      });
    }
    // Leaning in over the third card alone: the camera is placed in the first card's frame.
    const rotation = mul(spin(0.3), tilt(-0.4));
    const translation = [-330, 60, 220];
    const tracked = layout.observe(picture(rotation, translation, [FIRST_CARD + 2], 0.3, 99), camera, 640)!;
    expect(tracked).not.toBeNull();
    tracked.pose.translation.forEach((value, k) => expect(Math.abs(value - translation[k]!)).toBeLessThan(8));
  });

  it('with the gyroscope turn, learns cards on the table to a couple of millimetres, even from shaky corners', () => {
    const layout = new MarkerLayout();
    layout.observe(picture(tilt(-0.5), [0, 0, 500], [FIRST_CARD], 0.2, 0), camera, 640, tilt(-0.5));
    for (let i = 0; i < 30; i++) {
      const rotation = mul(spin(0.1 + i * 0.01), tilt(-0.6));
      layout.observe(picture(rotation, [-90 + i, -20, 520], [FIRST_CARD, FIRST_CARD + 1], 0.6, i), camera, 640, rotation);
    }
    for (let i = 0; i < 30; i++) {
      const rotation = mul(spin(-0.2 + i * 0.01), tilt(-0.5));
      layout.observe(picture(rotation, [-250 + i, 0, 520], [FIRST_CARD + 1, FIRST_CARD + 2], 0.6, i + 50), camera, 640, rotation);
    }
    for (const id of [FIRST_CARD + 1, FIRST_CARD + 2]) {
      const learnt = layout.corners(id)!;
      cornersOf(id).forEach((point, k) => {
        expect(Math.abs(learnt[k]!.x - point.x)).toBeLessThan(2.5);
        expect(Math.abs(learnt[k]!.y - point.y)).toBeLessThan(2.5);
      });
    }
  });

  it('makes the first card seen the origin, and starts over when asked', () => {
    const layout = new MarkerLayout();
    const rotation = tilt(-0.5);
    layout.observe(picture(rotation, [100, 0, 500], [FIRST_CARD + 1], 0.2, 1), camera, 640);
    expect(layout.size).toBe(1);
    expect(layout.corners(FIRST_CARD + 1)![0]).toEqual({ x: -CARD_MM / 2, y: -CARD_MM / 2 });
    layout.reset();
    expect(layout.size).toBe(0);
  });
});
