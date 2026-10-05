import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DragRulerTool, WAYPOINT_HOLD_MS } from '../../../src/app/online/view/tools/DragRulerTool';
import { toolGridOf } from '../../../src/app/online/view/tools/toolGrid';
import { playerScene } from './sceneFixtures';

describe('DragRulerTool', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const grid = toolGridOf(playerScene());

  it('adds one waypoint per hold on a touch screen, however the finger jitters', () => {
    let changes = 0;
    const ruler = new DragRulerTool(() => { changes++; });
    ruler.begin({ x: 100, y: 100 }, grid, 'touch', 1);
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS - 1);
    expect(ruler.overlay()?.points).toHaveLength(2);
    // Within the tap slop: still holding.
    ruler.update({ x: 243, y: 102 }, { x: 243, y: 102 });
    vi.advanceTimersByTime(1);
    expect(ruler.overlay()?.points).toEqual([{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 105 }]);
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 3);
    expect(ruler.overlay()?.points).toHaveLength(3);
    ruler.update({ x: 240, y: 240 }, { x: 240, y: 240 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS);
    expect(ruler.overlay()).toEqual({ points: [{ x: 105, y: 105 }, { x: 245, y: 105 }, { x: 245, y: 245 }, { x: 245, y: 245 }], label: '20ft' });
    expect(changes).toBe(2);
  });

  it('never adds a waypoint by holding with a mouse; the key adds one instead', () => {
    const ruler = new DragRulerTool(() => {});
    ruler.begin({ x: 100, y: 100 }, grid, 'mouse', 1);
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 4);
    expect(ruler.overlay()?.points).toHaveLength(2);
    expect(ruler.addWaypoint()).toBe(true);
    expect(ruler.overlay()?.points).toHaveLength(3);
  });

  it('stops holding and shows nothing once the drag ends', () => {
    let changes = 0;
    const ruler = new DragRulerTool(() => { changes++; });
    ruler.begin({ x: 100, y: 100 }, grid, 'touch', 1);
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    ruler.end();
    vi.advanceTimersByTime(WAYPOINT_HOLD_MS * 2);
    expect(ruler.overlay()).toBeNull();
    expect(changes).toBe(0);
  });

  it("snaps only when the GM's snap-to-grid is on, even with the grid hidden from players", () => {
    const scene = playerScene();
    const trace = (snapToGrid: boolean, hidden: boolean): ReturnType<DragRulerTool['overlay']> => {
      const ruler = new DragRulerTool(() => {});
      ruler.begin({ x: 100, y: 100 }, toolGridOf({ ...scene, grid: hidden ? null : scene.grid, measurement: { ...scene.measurement, snapToGrid } }), 'mouse', 1);
      ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
      return ruler.overlay();
    };
    expect(trace(true, false)?.points).toEqual([{ x: 105, y: 105 }, { x: 245, y: 105 }]);
    expect(trace(false, false)?.points).toEqual([{ x: 100, y: 100 }, { x: 240, y: 100 }]);
    expect(trace(true, true)?.points.length).toBe(2);
    expect(trace(false, true)?.points).toEqual([{ x: 100, y: 100 }, { x: 240, y: 100 }]);
  });

  it("ends a Large token's ruler where four cells meet, where the GM's drop puts it", () => {
    const ruler = new DragRulerTool(() => {});
    ruler.begin({ x: 140, y: 140 }, toolGridOf(playerScene()), 'mouse', 1.5);
    ruler.update({ x: 240, y: 100 }, { x: 240, y: 100 });
    expect(ruler.overlay()?.points).toEqual([{ x: 140, y: 140 }, { x: 210, y: 70 }]);
  });

  it("labels distances with a scene's own distance per cell, not the collection's rules square", () => {
    const scene = playerScene();
    const label = (measurement: Partial<typeof scene.measurement>): string | undefined => {
      const ruler = new DragRulerTool(() => {});
      ruler.begin({ x: 105, y: 105 }, toolGridOf({ ...scene, measurement: { ...scene.measurement, ...measurement } }), 'mouse', 1);
      ruler.update({ x: 245, y: 105 }, { x: 245, y: 105 });
      return ruler.overlay()?.label;
    };
    expect(label({})).toBe('10ft');
    expect(label({ unitDistance: 10, ruleDistance: 5 })).toBe('20ft');
  });
});
