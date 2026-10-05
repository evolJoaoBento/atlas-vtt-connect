import { describe, expect, it, vi } from 'vitest';
import type { SceneCamera } from '../../../src/app/online/scene/sceneCamera';
import { DEFAULT_CAMERA, GLIDE_MS, screenToWorld } from '../../../src/app/online/view/camera';
import { CameraController } from '../../../src/app/online/view/CameraController';
import { playerScene, playerToken } from './sceneFixtures';

function setup() {
  let time = 0;
  let changes = 0;
  const controller = new CameraController({ now: () => time, onChange: () => { changes++; } });
  return { controller, advance: (ms: number): void => { time += ms; }, changes: (): number => changes };
}

/** The 1000 × 800 map of `playerScene` fits at zoom 1 inside the 16 px padding. */
const SCREEN = { width: 1032, height: 832 };
const PHONE = { width: 800, height: 600 };
const gm = (overrides: Partial<SceneCamera> = {}): SceneCamera => ({
  sceneId: 'scene-1', centerX: 200, centerY: 300, width: 400, height: 300, ...overrides,
});

describe('CameraController', () => {
  it('fits the map while there is no GM camera', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
    expect(controller.isFollowing()).toBe(true);
  });

  it("fits the scene's content when the map has no size", () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene({ map: { asset: null, width: 0, height: 0, cellSize: 70 }, tokens: { t1: playerToken({ x: 100, y: 100 }) } }));
    const camera = controller.current();
    expect([camera.centerX, camera.centerY]).toEqual([100, 100]);
    expect(camera.zoom).toBeCloseTo(800 / 210);
  });

  it("glides to the GM's camera in 150 ms, fitting the GM's visible area to the screen", () => {
    const { controller, advance } = setup();
    controller.setScreen(PHONE);
    controller.setScene(playerScene());
    const fitted = controller.current();
    controller.setGmCamera(gm());
    expect(controller.current()).toEqual(fitted);
    advance(GLIDE_MS / 2);
    const halfway = controller.current();
    expect(halfway.centerX).toBeLessThan(fitted.centerX);
    expect(halfway.centerX).toBeGreaterThan(200);
    expect(controller.isMoving()).toBe(true);
    advance(GLIDE_MS / 2);
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
    expect(controller.isMoving()).toBe(false);
  });

  it('keeps the zoom between 1/20 and 8 times the fitted zoom, and the centre on the map', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.zoomAt({ x: 516, y: 416 }, 100);
    expect(controller.current().zoom).toBe(8);
    controller.zoomAt({ x: 516, y: 416 }, 1e-6);
    expect(controller.current().zoom).toBeCloseTo(0.05);
    controller.pan(-1e6, 1e6);
    expect([controller.current().centerX, controller.current().centerY]).toEqual([1000, 0]);
  });

  it('breaks away on a pan or zoom, and follows again on Follow GM', () => {
    const { controller, advance, changes } = setup();
    controller.setScreen(PHONE);
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    advance(GLIDE_MS);
    const before = changes();
    controller.pan(10, 0);
    expect(controller.isFollowing()).toBe(false);
    expect(controller.current().centerX).toBeCloseTo(200 - 10 / 2);
    expect(changes()).toBe(before + 1);
    controller.setGmCamera(gm({ centerX: 400 }));
    expect(controller.current().centerX).toBeCloseTo(195);
    controller.followGm();
    expect(controller.isFollowing()).toBe(true);
    advance(GLIDE_MS);
    expect(controller.current()).toEqual({ centerX: 400, centerY: 300, zoom: 2 });
  });

  it('returns to following on a new scene', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.pan(50, 50);
    controller.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(controller.isFollowing()).toBe(true);
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
  });

  it('uses a GM camera that arrived before its scene, and ignores one for another scene', () => {
    const { controller } = setup();
    controller.setScreen(PHONE);
    controller.setGmCamera(gm({ sceneId: 'scene-2' }));
    controller.setScene(playerScene());
    expect(controller.current().centerX).toBe(500);
    controller.setScene(playerScene({ sceneId: 'scene-2' }));
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
    controller.setGmCamera(gm({ sceneId: 'scene-1', centerX: 900 }));
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
  });

  it('refits on resize while following, and keeps the centre after breaking away', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.setScreen({ width: 532, height: 432 });
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 0.5 });
    controller.pan(50, 0);
    controller.setScreen(SCREEN);
    expect(controller.current()).toEqual({ centerX: 400, centerY: 400, zoom: 0.5 });
  });

  it('stays finite while the canvas has no size, and refits once it has one', () => {
    const { controller } = setup();
    controller.setScreen({ width: 0, height: 0 });
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    const camera = controller.current();
    expect([camera.centerX, camera.centerY, camera.zoom].every(Number.isFinite)).toBe(true);
    expect(camera.zoom).toBeGreaterThan(0);
    controller.setScreen(PHONE);
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
  });

  it('resets when the scene is cleared', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.pan(50, 0);
    controller.setScene(null);
    expect(controller.current()).toEqual(DEFAULT_CAMERA);
    expect(controller.isFollowing()).toBe(true);
  });

  it('shows the whole map on Fit map, staying broken away', () => {
    const { controller, advance } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    advance(GLIDE_MS);
    controller.fitMap();
    expect(controller.isFollowing()).toBe(false);
    advance(GLIDE_MS);
    expect(controller.current()).toEqual({ centerX: 500, centerY: 400, zoom: 1 });
  });

  it('zooms around the cursor', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    const point = { x: 300, y: 200 };
    const before = screenToWorld(controller.current(), SCREEN, point);
    controller.zoomAt(point, 2);
    const after = screenToWorld(controller.current(), SCREEN, point);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('turns canvas points into world points with the camera of now', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    expect(controller.toWorld({ x: 516, y: 416 })).toEqual({ x: 500, y: 400 });
    expect(controller.toWorld({ x: 16, y: 16 })).toEqual({ x: 0, y: 0 });
  });

  it('keeps a broken-away zoom through a canvas with no size', () => {
    const { controller } = setup();
    controller.setScreen({ width: 1032, height: 832 });
    controller.setScene(playerScene());
    controller.zoomAt({ x: 516, y: 416 }, 0.7);
    controller.setScreen({ width: 0, height: 0 });
    controller.setScreen({ width: 1000, height: 800 });
    expect(controller.current().zoom).toBeCloseTo(0.7);
    expect(controller.isFollowing()).toBe(false);
  });

  it('ignores non-finite zoom factors, and zooms fully out for a factor of zero or less', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.zoomAt({ x: 10, y: 10 }, Number.NaN);
    controller.zoomAt({ x: 10, y: 10 }, Infinity);
    expect(controller.current().zoom).toBe(1);
    expect(controller.isFollowing()).toBe(true);
    controller.zoomAt({ x: 10, y: 10 }, -3);
    expect(controller.current().zoom).toBeCloseTo(0.05);
  });

  it('stays following on a move that changes nothing', () => {
    const { controller } = setup();
    controller.setScreen(SCREEN);
    controller.setScene(playerScene());
    controller.pan(0, 0);
    controller.zoomAt({ x: 10, y: 10 }, 1);
    expect(controller.isFollowing()).toBe(true);
  });

  it('does not restart the glide for an identical repeated GM camera', () => {
    const { controller, advance, changes } = setup();
    controller.setScreen(PHONE);
    controller.setScene(playerScene());
    controller.setGmCamera(gm());
    advance(GLIDE_MS / 2);
    const before = changes();
    controller.setGmCamera(gm());
    expect(changes()).toBe(before);
    advance(GLIDE_MS / 2);
    expect(controller.current()).toEqual({ centerX: 200, centerY: 300, zoom: 2 });
    controller.setGmCamera(gm());
    expect(changes()).toBe(before);
  });

  it('stays where the player moved the view, without moving it back, and tells once that it stopped following', () => {
    const onChange = vi.fn();
    const camera = new CameraController({ now: () => 0, onChange });
    camera.setScreen({ width: 800, height: 600 });
    onChange.mockClear();
    camera.movedByPlayer({ centerX: 10, centerY: 20, zoom: 3 });
    expect(camera.isFollowing()).toBe(false);
    expect(camera.current()).toEqual({ centerX: 10, centerY: 20, zoom: 3 });
    expect(onChange).toHaveBeenCalledOnce();
    camera.movedByPlayer({ centerX: 11, centerY: 21, zoom: 3 });
    expect(onChange).toHaveBeenCalledOnce();
    expect(camera.isMoving()).toBe(false);
  });
});
