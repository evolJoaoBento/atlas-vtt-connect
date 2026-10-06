import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { CONFIRM_TIMEOUT_MS, MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS, TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PAUSED_BANNER } from '../../../src/app/online/split/splitCopy';
import { playerScene, playerToken } from './sceneFixtures';

const scene = playerScene({ tokens: { t1: playerToken(), t2: playerToken({ x: 300 }) } });

/** The scene with t1's record replaced, as the GM's patch replaces it. */
function withT1(base: PlayerScene, x: number, y: number): PlayerScene {
  return { ...base, tokens: { ...base.tokens, t1: playerToken({ x, y }) } };
}

function setup() {
  const sent: Array<[string, number, number]> = [];
  let accept = true;
  let changes = 0;
  // Screen and world coincide here: the camera is tested on its own.
  const moves = new TokenMoves({
    toWorld: (point) => ({ x: point.x, y: point.y }),
    send: (tokenId, x, y) => {
      sent.push([tokenId, x, y]);
      return accept;
    },
    onChange: () => { changes++; },
  });
  moves.setScene(scene);
  moves.setControlled(['t1']);
  moves.setConnected(true);
  return { moves, sent, refuseSending: (): void => { accept = false; }, changes: (): number => changes };
}

const positions = (moves: TokenMoves): Record<string, { x: number; y: number }> => Object.fromEntries(moves.overlay().positions);

/** Grabs t1 (at 100, 100) 10 px left of and 5 px above its centre, and drags it 100 px right. */
function dragT1(moves: TokenMoves): void {
  expect(moves.grab({ x: 90, y: 95 })).toBe(true);
  moves.move({ x: 190, y: 95 });
}

describe('TokenMoves', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('grabs only controlled tokens, and nothing while disconnected', () => {
    const { moves } = setup();
    expect(moves.canGrab({ x: 300, y: 100 })).toBe(false);
    expect(moves.grab({ x: 300, y: 100 })).toBe(false);
    expect(moves.canGrab({ x: 100, y: 100 })).toBe(true);
    moves.setConnected(false);
    expect(moves.grab({ x: 100, y: 100 })).toBe(false);
  });

  it('shows the token under the pointer where it was grabbed, sends nothing until release, then one move', () => {
    const { moves, sent, changes } = setup();
    const before = changes();
    dragT1(moves);
    expect(changes()).toBeGreaterThan(before);
    expect(moves.isDragging()).toBe(true);
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    moves.move({ x: 240, y: 145 });
    expect(sent).toEqual([]);
    moves.drop({ x: 240, y: 145 });
    expect(sent).toEqual([['t1', 250, 150]]);
    expect(moves.isDragging()).toBe(false);
    expect(positions(moves)).toEqual({ t1: { x: 250, y: 150 } });
    expect(moves.overlay().controlled).toEqual(new Set(['t1']));
  });

  it("keeps the token at the drop spot until the scene brings the GM's position", () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    // Another change of the scene is not the answer.
    moves.setScene({ ...scene, widgets: [] });
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    moves.setScene(withT1(scene, 205, 105));
    expect(positions(moves)).toEqual({});
  });

  it('drops the preview after two seconds without an update, as when the GM put the token back where it was', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS - 1);
    expect(positions(moves)).toEqual({ t1: { x: 200, y: 100 } });
    vi.advanceTimersByTime(1);
    expect(positions(moves)).toEqual({});
  });

  it('puts a refused token back and says so for a few seconds', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    moves.refused('t1');
    expect(positions(moves)).toEqual({});
    expect(moves.notice()).toBe(MOVE_REFUSED_TEXT);
    vi.advanceTimersByTime(REFUSED_NOTICE_MS - 1);
    expect(moves.notice()).toBe(MOVE_REFUSED_TEXT);
    vi.advanceTimersByTime(1);
    expect(moves.notice()).toBeNull();
  });

  it('sends nothing for a cancelled drag', () => {
    const cancels: Array<[string, (moves: TokenMoves) => void]> = [
      ['Escape or pointer cancel', (moves) => moves.cancel()],
      ['connection lost', (moves) => moves.setConnected(false)],
      ['the token left the scene', (moves) => moves.setScene({ ...scene, tokens: { t2: scene.tokens.t2! } })],
      ['a new scene', (moves) => moves.setScene({ ...scene, sceneId: 'scene-2' })],
      ['control lost', (moves) => moves.setControlled([])],
    ];
    for (const [label, cancel] of cancels) {
      const { moves, sent } = setup();
      dragT1(moves);
      cancel(moves);
      expect(moves.isDragging(), label).toBe(false);
      moves.drop({ x: 240, y: 145 });
      expect(sent, label).toEqual([]);
      expect(moves.overlay().positions.size, label).toBe(0);
    }
  });

  it('shows no preview for a drop that could not be sent', () => {
    const { moves, sent, refuseSending } = setup();
    refuseSending();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    expect(sent).toHaveLength(1);
    expect(positions(moves)).toEqual({});
  });

  it('grabs a waiting token where it is shown, and drops every preview with a new scene', () => {
    const { moves } = setup();
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    expect(moves.canGrab({ x: 100, y: 100 })).toBe(false);
    expect(moves.grab({ x: 200, y: 100 })).toBe(true);
    moves.cancel();
    moves.setScene({ ...scene, sceneId: 'scene-2' });
    expect(positions(moves)).toEqual({});
  });

  it('while paused shows the paused banner, and a refusal snaps back without the refusal notice', () => {
    const { moves } = setup();
    moves.setPaused(true);
    expect(moves.notice()).toBe(PAUSED_BANNER);
    dragT1(moves);
    moves.drop({ x: 190, y: 95 });
    moves.refused('t1');
    expect(positions(moves)).toEqual({});
    expect(moves.notice()).toBe(PAUSED_BANNER);
    moves.setPaused(false);
    expect(moves.notice()).toBeNull();
  });
});
