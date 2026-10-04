import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { LASER_INTERVAL_MS, LASER_KEEPALIVE_MS, LaserBatcher } from '../../../src/app/online/tools/LaserBatcher';
import { GM_LASER_ID, laserColor } from '../../../src/app/online/tools/laserColors';
import { LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';

interface Sent { points: ScenePoint[]; lifted: boolean; at: number; dt: number[] }

function batcher(): { batcher: LaserBatcher; sent: Sent[] } {
  const sent: Sent[] = [];
  return { batcher: new LaserBatcher((points, lifted, dt) => sent.push({ points, lifted, at: Date.now(), dt }), () => Date.now()), sent };
}
const at = (x: number): ScenePoint => ({ x, y: 0 });

describe('LaserBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('sends the first point at once and the next ones together after the interval', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    laser.point(at(1));
    laser.point(at(2));
    expect(sent).toEqual([{ points: [at(0)], lifted: false, at: 0, dt: [0] }]);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent[1]).toMatchObject({ points: [at(1), at(2)], lifted: false, at: Math.round(LASER_INTERVAL_MS) });
  });

  it('keeps the newest 64 points of a batch', () => {
    const { batcher: laser, sent } = batcher();
    for (let x = 0; x < 100; x++) laser.point(at(x));
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent[1]!.points).toHaveLength(64);
    expect(sent[1]!.points[0]).toEqual(at(36));
  });

  it('sends the lift in order after the last points, and a new stroke after it', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    laser.point(at(1));
    laser.lift();
    laser.point(at(2));
    vi.advanceTimersByTime(LASER_INTERVAL_MS * 2);
    expect(sent.map(({ points, lifted }) => ({ points, lifted }))).toEqual([
      { points: [at(0)], lifted: false }, { points: [at(1)], lifted: true }, { points: [at(2)], lifted: false },
    ]);
  });

  it('sends at most 30 messages a second however fast the points come', () => {
    const { batcher: laser, sent } = batcher();
    for (let time = 0; time < 1000; time += 5) {
      laser.point(at(time));
      vi.advanceTimersByTime(5);
    }
    const times = sent.map((message) => message.at);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(Math.floor(LASER_INTERVAL_MS));
    expect(sent.length).toBeLessThanOrEqual(31);
  });

  it('keeps a laser held still alive every 500 ms, and stops once it is let go', () => {
    const { batcher: laser, sent } = batcher();
    laser.point(at(0));
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 2);
    expect(sent.map(({ points, at: time }) => [points.length, time])).toEqual([[1, 0], [0, 500], [0, 1000]]);
    laser.lift();
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 4);
    expect(sent.slice(3).map(({ points, lifted }) => ({ points, lifted }))).toEqual([{ points: [], lifted: true }]);
  });

  it('times each point against the one before it, not against the send', () => {
    const sent: Array<{ points: ScenePoint[]; dt: number[] }> = [];
    const laser = new LaserBatcher((points, _lifted, dt) => sent.push({ points, dt }), () => 0);
    laser.point(at(0), 1000);
    laser.point(at(1), 1010);
    laser.point(at(2), 1010);
    laser.point(at(3), 1042);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent.map(({ dt }) => dt)).toEqual([[0], [10, 0, 32]]);
    // A new stroke starts on its own: its first point has no gap, however long the pause was.
    laser.lift();
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    laser.point(at(4), 9000);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent.at(-1)!.dt).toEqual([0]);
  });

  it('keeps the times with the newest 64 points, and caps a long pause', () => {
    const sent: Array<{ points: ScenePoint[]; dt: number[] }> = [];
    const laser = new LaserBatcher((points, _lifted, dt) => sent.push({ points, dt }), () => 0);
    laser.point(at(0), 0);
    for (let x = 1; x <= 70; x++) laser.point(at(x), x * 10);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent[1]!.points).toHaveLength(64);
    expect(sent[1]!.dt).toHaveLength(64);
    laser.point(at(99), 70 * 10 + 60_000);
    vi.advanceTimersByTime(LASER_INTERVAL_MS);
    expect(sent.at(-1)!.dt).toEqual([2000]);
  });

  it('sends no lift without a stroke, and nothing after dispose', () => {
    const { batcher: laser, sent } = batcher();
    laser.lift();
    expect(sent).toEqual([]);
    laser.point(at(0));
    laser.point(at(1));
    laser.dispose();
    vi.advanceTimersByTime(LASER_KEEPALIVE_MS * 2);
    expect(sent).toHaveLength(1);
  });
});

describe('laserColor', () => {
  it('gives the GM the first colour and each player the next by their place in the session', () => {
    const order = ['p1', 'p2'];
    expect(laserColor(GM_LASER_ID, order)).toBe(LASER_COLOR_SWATCHES[0].value);
    expect(laserColor('p1', order)).toBe(LASER_COLOR_SWATCHES[1].value);
    expect(laserColor('p2', order)).toBe(LASER_COLOR_SWATCHES[2].value);
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(laserColor('p7', twelve)).toBe(LASER_COLOR_SWATCHES[0].value);
    expect(laserColor('stranger', order)).toBe(LASER_COLOR_SWATCHES[7].value);
  });
});
