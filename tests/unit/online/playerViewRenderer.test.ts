import { describe, expect, it, vi } from 'vitest';
import { SCENE_LAYER_ORDER, type SceneLayer } from '@atlas-vtt/shared/draw';
import { GLIDE_MS } from '../../../src/app/online/view/camera';
import { CameraController } from '../../../src/app/online/view/CameraController';
import { NO_TOKEN_OVERLAY, type PlayerLayer, type TokenOverlay } from '../../../src/app/online/view/layers/layerTypes';
import { pixelRatioFor, PlayerViewRenderer, VIEW_BACKGROUND } from '../../../src/app/online/view/PlayerViewRenderer';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function setup(options: { hidden?: boolean; throwing?: SceneLayer } = {}) {
  let time = 0;
  let hidden = options.hidden ?? false;
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const drawn: string[] = [];
  const disposed: string[] = [];
  const overlays: TokenOverlay[] = [];
  const layers = Object.fromEntries(SCENE_LAYER_ORDER.map((name): [SceneLayer, PlayerLayer] => [name, {
    draw: (target, frame) => {
      if (name === options.throwing) {
        target.push(1, 1, 0, 1);
        throw new Error('layer failed');
      }
      drawn.push(name);
      if (name === 'tokens') overlays.push(frame.overlay);
    },
    dispose: () => { disposed.push(name); },
  }])) as Record<SceneLayer, PlayerLayer>;
  const camera = new CameraController({ now: () => time, onChange: () => renderer.invalidate() });
  const renderer = new PlayerViewRenderer({
    surface, camera, images: () => null, layers, requestFrame: frames.request, cancelFrame: (handle) => frames.cancel(handle),
    isHidden: () => hidden,
  });
  const show = (screen = { width: 800, height: 600 }, ratio = 1): void => {
    const scene = playerScene();
    camera.setScreen(screen);
    renderer.setSize(screen, ratio);
    camera.setScene(scene);
    renderer.setScene(scene);
  };
  return {
    surface, camera, renderer, frames, drawn, disposed, overlays, show,
    advance: (ms: number): void => { time += ms; },
    setHidden: (value: boolean): void => { hidden = value; },
  };
}

describe('PlayerViewRenderer', () => {
  it("draws the layers in Atlas's order, once per frame however many changes arrive", () => {
    const t = setup();
    t.show();
    t.renderer.invalidate();
    expect(t.frames.pending).toBe(1);
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
    expect(t.surface.ops('begin')).toHaveLength(1);
    expect(t.frames.pending).toBe(0);
  });

  it('hands the token overlay to the layers, and draws again when it changes', () => {
    const t = setup();
    t.show();
    t.frames.run();
    expect(t.overlays.at(-1)).toBe(NO_TOKEN_OVERLAY);
    const overlay: TokenOverlay = { controlled: new Set(['t1']), positions: new Map() };
    t.renderer.setOverlay(overlay);
    expect(t.frames.pending).toBe(1);
    t.frames.run();
    expect(t.overlays.at(-1)).toBe(overlay);
  });

  it('still draws the fog, and resets the surface, when an earlier layer throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup({ throwing: 'tokens' });
    t.show();
    t.frames.run();
    t.renderer.invalidate();
    t.frames.run();
    expect(t.drawn.slice(-1)).toEqual(['fog']);
    expect(t.drawn).toEqual(['map', 'grid', 'texts', 'drawings', 'fog', 'map', 'grid', 'texts', 'drawings', 'fog']);
    // Each failure sets the camera again, which drops the unmatched push.
    expect(t.surface.ops('camera')).toHaveLength(4);
    expect(t.surface.calls.findIndex((call) => call.op === 'push')).toBeLessThan(t.surface.calls.findLastIndex((call) => call.op === 'camera'));
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('blanks the frame when the fog layer itself throws, so nothing under fog shows', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = setup({ throwing: 'fog' });
    t.show();
    t.frames.run();
    // The frame is begun once, then begun again blank after the fog failed.
    expect(t.surface.ops('begin')).toHaveLength(2);
    expect(t.surface.calls[t.surface.calls.length - 1]?.op).toBe('begin');
    error.mockRestore();
  });

  it('draws nothing more until something changes', () => {
    const t = setup();
    t.show();
    t.frames.run();
    t.frames.run();
    expect(t.surface.ops('begin')).toHaveLength(1);
  });

  it('draws nothing while the page is hidden, and catches up once it is visible', () => {
    const t = setup({ hidden: true });
    t.show();
    expect(t.frames.pending).toBe(0);
    t.setHidden(false);
    t.renderer.visibilityChanged();
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
  });

  it('keeps drawing frames while the camera glides, then stops', () => {
    const t = setup();
    t.show();
    t.frames.run();
    t.camera.setGmCamera({ sceneId: 'scene-1', centerX: 200, centerY: 200, width: 400, height: 300 });
    t.frames.run();
    expect(t.frames.pending).toBe(1);
    t.advance(GLIDE_MS);
    t.frames.run();
    expect(t.frames.pending).toBe(0);
  });

  it('maps world to device pixels at the pixel ratio, centred on the camera', () => {
    const t = setup();
    t.show({ width: 800, height: 600 }, 2);
    t.frames.run();
    const zoom = Math.min(768 / 1000, 568 / 800);
    expect(t.surface.ops('begin')[0]).toEqual({ op: 'begin', width: 1600, height: 1200, background: VIEW_BACKGROUND });
    const camera = t.surface.ops('camera')[0]!;
    expect(camera.scale).toBeCloseTo(zoom * 2);
    expect(camera.offsetX).toBeCloseTo(800 - 500 * zoom * 2);
    expect(camera.offsetY).toBeCloseTo(600 - 400 * zoom * 2);
  });

  it('clears to black and draws no layer without a scene', () => {
    const t = setup();
    t.renderer.setSize({ width: 100, height: 100 }, 1);
    t.renderer.setScene(null);
    t.frames.run();
    expect(t.surface.calls).toEqual([{ op: 'begin', width: 100, height: 100, background: VIEW_BACKGROUND }]);
    expect(t.drawn).toEqual([]);
  });

  it('cancels its frame and frees its layers when disposed', () => {
    const t = setup();
    t.show();
    const cancel = vi.spyOn(t.frames, 'cancel');
    t.renderer.dispose();
    expect(cancel).toHaveBeenCalled();
    expect(t.disposed).toEqual([...SCENE_LAYER_ORDER]);
  });

  it('caps the pixel ratio at 2 on phones', () => {
    expect(pixelRatioFor(3, true)).toBe(2);
    expect(pixelRatioFor(1.5, true)).toBe(1.5);
    expect(pixelRatioFor(3, false)).toBe(3);
    expect(pixelRatioFor(Number.NaN, false)).toBe(1);
  });

  it('skips a frame requested before the page was hidden', () => {
    const t = setup();
    t.show();
    t.setHidden(true);
    t.frames.run();
    expect(t.drawn).toEqual([]);
    expect(t.frames.pending).toBe(0);
    t.setHidden(false);
    t.renderer.visibilityChanged();
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
  });

  it('does nothing after dispose', () => {
    const t = setup();
    t.show();
    t.renderer.dispose();
    t.renderer.invalidate();
    t.renderer.setScene(playerScene());
    t.camera.pan(5, 5);
    expect(t.frames.pending).toBe(0);
  });

  it('treats a bad pixel ratio as 1', () => {
    const t = setup();
    t.show({ width: 100, height: 50 }, Number.NaN);
    t.frames.run();
    expect(t.surface.ops('begin')[0]).toMatchObject({ width: 100, height: 50 });
  });
});

describe('PlayerViewRenderer overlays', () => {
  function overlaySetup(overlay: { draw(): void; animating(): boolean }) {
    const frames = fakeFrames();
    const drawn: string[] = [];
    const layers = Object.fromEntries(SCENE_LAYER_ORDER.map((name): [SceneLayer, PlayerLayer] => [name, {
      draw: () => { drawn.push(name); },
    }])) as Record<SceneLayer, PlayerLayer>;
    const camera = new CameraController({ now: () => 0, onChange: () => {} });
    const renderer = new PlayerViewRenderer({
      surface: new RecordingSurface(), camera, images: () => null, layers, overlays: [overlay],
      requestFrame: frames.request, cancelFrame: (handle) => frames.cancel(handle), isHidden: () => false,
    });
    const scene = playerScene();
    camera.setScreen({ width: 800, height: 600 });
    renderer.setSize({ width: 800, height: 600 }, 1);
    camera.setScene(scene);
    renderer.setScene(scene);
    return { frames, drawn };
  }

  it('draws the overlays over the fog, and keeps drawing while one animates', () => {
    let animating = true;
    const order: string[] = [];
    const t = overlaySetup({ draw: () => { order.push('tools'); }, animating: () => animating });
    t.frames.run();
    expect([...t.drawn, ...order]).toEqual([...SCENE_LAYER_ORDER, 'tools']);
    expect(t.frames.pending).toBe(1);
    animating = false;
    t.frames.run();
    expect(t.frames.pending).toBe(0);
  });

  it('still draws the scene when an overlay throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = overlaySetup({ draw: () => { throw new Error('overlay failed'); }, animating: () => false });
    t.frames.run();
    expect(t.drawn).toEqual([...SCENE_LAYER_ORDER]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
