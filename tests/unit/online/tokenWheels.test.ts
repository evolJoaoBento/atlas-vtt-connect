import { describe, expect, it } from 'vitest';
import type { PlayerWheel } from '../../../src/app/online/scene/sceneTypes';
import { drawWheels, WHEEL, WHEEL_NUMBER, wheelCentre, wheelGauge } from '../../../src/app/online/view/layers/tokenWheels';
import { RecordingSurface } from './recordingSurface';

const wheel = (patch: Partial<PlayerWheel> = {}): PlayerWheel => ({ slot: 2, color: '#3b82f6', current: 2, max: 5, fixed: false, ...patch });

describe("a token's wheels", () => {
  it("sit as Atlas's do: sockets 2 and 3 on the right, 4 and 5 mirrored on the left, the first of a side the upper one", () => {
    const [two, three, four, five] = [2, 3, 4, 5].map((slot) => wheelCentre(slot));
    expect(two!.left).toBe(false);
    expect(three!.left).toBe(false);
    expect(four!.left).toBe(true);
    expect(five!.left).toBe(true);
    expect(two!.y).toBeLessThan(three!.y);
    expect(four!.x).toBe(-two!.x);
    expect(three!.y - two!.y).toBeCloseTo(WHEEL.size + WHEEL.gap);
    // The lower wheel stands on the nameplate's top line (14 high, plus 1).
    expect(three!.y + WHEEL.size / 2).toBeCloseTo(-15);
  });

  it('divide a whole maximum from 2 to 8 into one segment per point, and nothing else', () => {
    expect(wheelGauge(wheel({ current: 2, max: 5 }))).toMatchObject({ share: 0.4 });
    expect(wheelGauge(wheel({ max: 5 }))!.ticks).toHaveLength(5);
    expect(wheelGauge(wheel({ max: 9 }))!.ticks).toHaveLength(0);
    expect(wheelGauge(wheel({ max: 2.5 }))!.ticks).toHaveLength(0);
    expect(wheelGauge(wheel({ max: 0 }))).toBeNull();
    expect(wheelGauge(wheel({ fixed: true, current: 0, max: 16 }))).toEqual({ share: 1, ticks: [] });
  });

  it("show the current number in the middle, a static resource's maximum, in Atlas's outlined white", () => {
    const surface = new RecordingSurface();
    drawWheels(surface, { x: 0, y: 0 }, [wheel({ current: 3 }), wheel({ slot: 3, fixed: true, current: 0, max: 16 })], 62, 33, 70);
    const texts = surface.calls.filter((call) => call.op === 'text');
    expect(texts.map((call) => call.op === 'text' && call.text)).toEqual(['3', '16']);
    for (const call of texts) if (call.op === 'text') expect(call.style.outline).toEqual(WHEEL_NUMBER.outline);
  });

  it('draw a full ring as one circle, without a seam, and a part as an arc from the top', () => {
    const full = new RecordingSurface();
    drawWheels(full, { x: 0, y: 0 }, [wheel({ current: 5, max: 5 })], 62, 33, 70);
    expect(full.calls.some((call) => call.op === 'circle' && call.style.stroke === '#3b82f6')).toBe(true);

    const part = new RecordingSurface();
    drawWheels(part, { x: 0, y: 0 }, [wheel({ current: 1, max: 4 })], 62, 33, 70);
    const arc = part.calls.find((call) => call.op === 'paths' && call.style.stroke === '#3b82f6');
    expect(arc && arc.op === 'paths' && arc.paths[0]![0]!.y).toBeLessThan(0);
  });

  it('draw nothing for a token without wheels', () => {
    const surface = new RecordingSurface();
    drawWheels(surface, { x: 0, y: 0 }, [], 62, 33, 70);
    expect(surface.calls).toEqual([]);
  });
});
