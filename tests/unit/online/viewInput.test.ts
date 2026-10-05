import { describe, expect, it } from 'vitest';
import type { ScreenPoint } from '../../../src/app/online/view/camera';
import { DOUBLE_ZOOM, ViewInput, WHEEL_ZOOM_PER_PIXEL, type PointerInput, type TokenGrab } from '../../../src/app/online/view/ViewInput';

type Move = { pan: [number, number] } | { zoom: [ScreenPoint, number] };

function setup(): { input: ViewInput; moves: Move[] } {
  const moves: Move[] = [];
  const input = new ViewInput({
    pan: (dx, dy) => { moves.push({ pan: [dx, dy] }); },
    zoomAt: (point, factor) => { moves.push({ zoom: [point, factor] }); },
  });
  return { input, moves };
}

const mouse = (x: number, y: number, button = 0): PointerInput => ({ id: 1, x, y, kind: 'mouse', button, time: 0 });
const touch = (id: number, x: number, y: number, time = 0): PointerInput => ({ id, x, y, kind: 'touch', button: 0, time });

/** The player's token covers everything left of x = 50; `grabs` records what the hook heard. */
function tokenSetup(): { input: ViewInput; moves: Move[]; grabs: string[] } {
  const moves: Move[] = [];
  const grabs: string[] = [];
  const tokens: TokenGrab = {
    grab: (point) => {
      if (point.x >= 50) return false;
      grabs.push(`grab ${point.x},${point.y}`);
      return true;
    },
    move: (point) => { grabs.push(`move ${point.x},${point.y}`); },
    drop: (point) => { grabs.push(`drop ${point.x},${point.y}`); },
    cancel: () => { grabs.push('cancel'); },
  };
  const input = new ViewInput({
    pan: (dx, dy) => { moves.push({ pan: [dx, dy] }); },
    zoomAt: (point, factor) => { moves.push({ zoom: [point, factor] }); },
  }, tokens);
  return { input, moves, grabs };
}

describe('ViewInput', () => {
  it('zooms around the cursor on the wheel, by pixels, lines or pages', () => {
    const { input, moves } = setup();
    input.wheel({ x: 100, y: 50 }, 100, 0);
    input.wheel({ x: 100, y: 50 }, 3, 1);
    input.wheel({ x: 100, y: 50 }, 0, 0);
    expect(moves).toEqual([
      { zoom: [{ x: 100, y: 50 }, Math.exp(-100 * WHEEL_ZOOM_PER_PIXEL)] },
      { zoom: [{ x: 100, y: 50 }, Math.exp(-48 * WHEEL_ZOOM_PER_PIXEL)] },
    ]);
  });

  it('pans with a drag once it moves past the slop, the whole way from where it started', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0));
    input.move(mouse(3, 0));
    input.move(mouse(10, 0));
    input.move(mouse(15, 5));
    input.up(mouse(15, 5));
    input.move(mouse(40, 40));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [5, 5] }]);
  });

  it('moves nothing on a click, or a tap that jitters less than the slop', () => {
    const { input, moves } = setup();
    input.down(mouse(100, 100));
    input.up(mouse(100, 100));
    input.down(touch(2, 100, 100));
    input.move(touch(2, 104, 101));
    input.up(touch(2, 104, 101));
    expect(moves).toEqual([]);
  });

  it('zooms in on a double-click, but not on the double-click a touch double-tap may also fire', () => {
    const { input, moves } = setup();
    input.down(mouse(10, 10));
    input.up(mouse(10, 10));
    input.doubleClick({ x: 10, y: 10 });
    input.down(touch(2, 10, 10));
    input.up(touch(2, 10, 10));
    input.doubleClick({ x: 10, y: 10 });
    expect(moves).toEqual([{ zoom: [{ x: 10, y: 10 }, DOUBLE_ZOOM] }]);
  });

  it('zooms in on a double-tap, only when quick and close', () => {
    const { input, moves } = setup();
    for (const [x, y, time] of [[50, 50, 0], [60, 55, 200], [60, 55, 1000], [60, 55, 1400], [300, 300, 1500]] as const) {
      input.down(touch(2, x, y, time));
      input.up(touch(2, x, y, time));
    }
    expect(moves).toEqual([{ zoom: [{ x: 60, y: 55 }, DOUBLE_ZOOM] }]);
  });

  it('pinches around the fingers and pans with them', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    expect(moves).toEqual([{ pan: [50, 0] }, { zoom: [{ x: 200, y: 100 }, 2] }]);
  });

  it('keeps panning with the remaining finger after a pinch', () => {
    const { input, moves } = setup();
    input.down(touch(1, 100, 100));
    input.down(touch(2, 200, 100));
    input.move(touch(2, 300, 100));
    moves.length = 0;
    input.up(touch(1, 100, 100));
    input.move(touch(2, 310, 100));
    input.move(touch(2, 312, 104));
    input.up(touch(2, 312, 104));
    expect(moves).toEqual([{ pan: [10, 0] }, { pan: [2, 4] }]);
  });

  it('ignores other mouse buttons and a third finger, and a cancelled press is no tap', () => {
    const { input, moves } = setup();
    input.down(mouse(0, 0, 2));
    input.move(mouse(50, 0, 2));
    input.down(touch(1, 0, 0));
    input.down(touch(2, 100, 0));
    input.down(touch(3, 50, 50));
    input.move(touch(3, 90, 90));
    input.cancel(1);
    input.cancel(2);
    input.down(touch(4, 10, 10, 0));
    input.cancel(4);
    input.down(touch(5, 10, 10, 100));
    input.up(touch(5, 10, 10, 100));
    expect(moves).toEqual([]);
  });

  it('treats a pen like a mouse drag, and a page-mode wheel as 800 px', () => {
    const { input, moves } = setup();
    const pen = (x: number, y: number): PointerInput => ({ id: 9, x, y, kind: 'pen', button: 0, time: 0 });
    input.down(pen(0, 0));
    input.move(pen(20, 0));
    input.up(pen(20, 0));
    input.wheel({ x: 1, y: 1 }, 1, 2);
    expect(moves).toEqual([{ pan: [20, 0] }, { zoom: [{ x: 1, y: 1 }, Math.exp(-800 * WHEEL_ZOOM_PER_PIXEL)] }]);
  });

  it('ignores a wheel with a non-finite delta', () => {
    const { input, moves } = setup();
    input.wheel({ x: 1, y: 1 }, Number.NaN, 0);
    input.wheel({ x: 1, y: 1 }, Infinity, 0);
    expect(moves).toEqual([]);
  });

  it('drags a token pressed on instead of panning, once past the slop, and drops it on release', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(mouse(10, 10));
    input.move(mouse(13, 10));
    input.move(mouse(30, 10));
    input.move(mouse(40, 20));
    input.up(mouse(40, 20));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'move 40,20', 'drop 40,20']);
    expect(moves).toEqual([]);
  });

  it("pans when the press misses the player's tokens", () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(mouse(100, 100));
    input.move(mouse(120, 100));
    input.up(mouse(120, 100));
    expect(grabs).toEqual([]);
    expect(moves).toEqual([{ pan: [20, 0] }]);
  });

  it('cancels a press on a token that stays within the slop, and never grabs with another button', () => {
    const { input, grabs } = tokenSetup();
    input.down(mouse(10, 10));
    input.move(mouse(12, 10));
    input.up(mouse(12, 10));
    input.down(mouse(10, 10, 2));
    input.up(mouse(10, 10, 2));
    expect(grabs).toEqual(['grab 10,10', 'cancel']);
  });

  it('turns a second finger into a pinch that cancels the token drag, and the finger left pans', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(touch(1, 10, 10));
    input.move(touch(1, 30, 10));
    input.down(touch(2, 100, 10));
    input.move(touch(2, 120, 10));
    input.up(touch(2, 120, 10));
    input.move(touch(1, 40, 10));
    input.up(touch(1, 40, 10));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'cancel']);
    expect(moves.filter((move) => 'pan' in move)).toEqual([{ pan: [10, 0] }, { pan: [10, 0] }]);
    expect(moves.some((move) => 'zoom' in move)).toBe(true);
  });

  it('cancels the token drag when the browser cancels the pointer', () => {
    const { input, grabs } = tokenSetup();
    input.down(touch(1, 10, 10));
    input.move(touch(1, 30, 10));
    input.cancel(1);
    input.up(touch(1, 30, 10));
    expect(grabs).toEqual(['grab 10,10', 'move 30,10', 'cancel']);
  });

  it('still counts a tap on a token toward a double-tap zoom', () => {
    const { input, moves, grabs } = tokenSetup();
    input.down(touch(1, 10, 10, 0));
    input.up(touch(1, 10, 10, 0));
    input.down(touch(1, 12, 10, 100));
    input.up(touch(1, 12, 10, 100));
    expect(grabs).toEqual(['grab 10,10', 'cancel', 'grab 12,10', 'cancel']);
    expect(moves).toEqual([{ zoom: [{ x: 12, y: 10 }, DOUBLE_ZOOM] }]);
  });

  it('a drag or pinch forgets the previous tap', () => {
    const { input, moves } = setup();
    input.down(touch(1, 50, 50, 0));
    input.up(touch(1, 50, 50, 0));
    input.down(touch(1, 50, 50, 100));
    input.move(touch(1, 80, 50, 100));
    input.up(touch(1, 80, 50, 100));
    input.down(touch(1, 80, 50, 150));
    input.up(touch(1, 80, 50, 150));
    expect(moves).toEqual([{ pan: [30, 0] }]);
  });
});
