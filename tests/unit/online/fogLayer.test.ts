import { describe, expect, it } from 'vitest';
import { FOG_COLOR } from '@atlas-vtt/shared/draw';
import type { PlayerFogOp, PlayerMap } from '../../../src/app/online/scene/sceneTypes';
import { CameraController } from '../../../src/app/online/view/CameraController';
import { FOG_CACHE_MAX_SIDE, FogLayer } from '../../../src/app/online/view/layers/fogLayer';
import { createSceneLayers } from '../../../src/app/online/view/layers/sceneLayers';
import { PlayerViewRenderer } from '../../../src/app/online/view/PlayerViewRenderer';
import { fakeFrames, frame, RecordingSurface } from './recordingSurface';
import { fogRect, playerScene } from './sceneFixtures';

const MAP: PlayerMap = { asset: null, width: 1000, height: 800, cellSize: 70 };
const fogScene = (fog: Record<string, PlayerFogOp>, map: PlayerMap = MAP) => playerScene({ fog, map });

describe('fog layer', () => {
  it('renders the fog once into an image of the map area and draws it opaque', () => {
    const surface = new RecordingSurface();
    new FogLayer().draw(surface, frame(fogScene({ f1: fogRect(1), f2: fogRect(2, { erase: true, x: 10, y: 10, width: 20, height: 20 }) })));
    const [image] = surface.layers;
    expect([image?.width, image?.height]).toEqual([1000, 800]);
    expect(image?.calls).toEqual([
      { op: 'begin', width: 1000, height: 800, background: null },
      { op: 'camera', scale: 1, offsetX: 0, offsetY: 0 },
      { op: 'rect', x: 0, y: 0, width: 100, height: 100, style: { erase: false, round: true, fill: FOG_COLOR } },
      { op: 'rect', x: 10, y: 10, width: 20, height: 20, style: { erase: true, round: true, fill: FOG_COLOR } },
    ]);
    expect(surface.calls).toEqual([{ op: 'drawLayer', layer: 1, x: 0, y: 0, width: 1000, height: 800 }]);
  });

  it('keeps the image at most 4096 px on its long side', () => {
    const surface = new RecordingSurface();
    new FogLayer().draw(surface, frame(fogScene({ f1: fogRect(1) }, { ...MAP, width: 10_000, height: 5_000 })));
    const [image] = surface.layers;
    expect([image?.width, image?.height]).toEqual([FOG_CACHE_MAX_SIDE, 2048]);
    expect(image?.ops('camera')[0]?.scale).toBeCloseTo(FOG_CACHE_MAX_SIDE / 10_000);
  });

  it('rebuilds the image only when the fog changes, never on a pan or zoom', () => {
    const surface = new RecordingSurface();
    const layer = new FogLayer();
    const scene = fogScene({ f1: fogRect(1) });
    layer.draw(surface, frame(scene));
    layer.draw(surface, frame(scene, { visible: { x: 300, y: 300, width: 200, height: 100 }, zoom: 4 }));
    layer.draw(surface, frame(scene, { zoom: 0.1 }));
    expect(layer.rebuilds).toBe(1);
    layer.draw(surface, frame(fogScene({ ...scene.fog, f2: fogRect(2) })));
    expect(layer.rebuilds).toBe(2);
    expect(surface.layers[0]?.released).toBe(true);
    expect(surface.ops('drawLayer').map(({ layer: id }) => id)).toEqual([1, 1, 1, 2]);
  });

  it('draws brushes, lassos and dots, over the fog itself when the map has no size', () => {
    const surface = new RecordingSurface();
    const fog: Record<string, PlayerFogOp> = {
      b: { type: 'brush', erase: false, order: 1, radius: 10, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      l: { type: 'lasso', erase: false, order: 2, points: [{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 250, y: 100 }] },
      d: { type: 'brush', erase: true, order: 3, radius: 5, points: [{ x: 50, y: 50 }] },
    };
    new FogLayer().draw(surface, frame(fogScene(fog, { ...MAP, width: 0, height: 0 })));
    expect(surface.ops('drawLayer')[0]).toEqual({ op: 'drawLayer', layer: 1, x: -10, y: -10, width: 310, height: 110 });
    expect(surface.layers[0]?.calls.slice(2)).toEqual([
      { op: 'paths', paths: [[{ x: 0, y: 0 }, { x: 100, y: 0 }]], closed: false, style: { erase: false, round: true, stroke: FOG_COLOR, lineWidth: 20 } },
      { op: 'paths', paths: [[{ x: 200, y: 0 }, { x: 300, y: 0 }, { x: 250, y: 100 }]], closed: true, style: { erase: false, round: true, fill: FOG_COLOR } },
      { op: 'circle', x: 50, y: 50, radius: 5, style: { erase: true, round: true, fill: FOG_COLOR } },
    ]);
  });

  it('draws nothing without fog, and frees the image when disposed', () => {
    const surface = new RecordingSurface();
    const layer = new FogLayer();
    layer.draw(surface, frame(fogScene({})));
    expect(surface.calls).toEqual([]);
    layer.draw(surface, frame(fogScene({ f1: fogRect(1) })));
    layer.dispose();
    expect(surface.layers[0]?.released).toBe(true);
  });

  it('is the last thing the player view draws', () => {
    const surface = new RecordingSurface();
    const frames = fakeFrames();
    const camera = new CameraController({ now: () => 0, onChange: () => {} });
    const renderer = new PlayerViewRenderer({
      surface, camera, images: () => null, layers: createSceneLayers(),
      requestFrame: frames.request, cancelFrame: frames.cancel, isHidden: () => false,
    });
    const scene = playerScene();
    camera.setScreen({ width: 800, height: 600 });
    camera.setScene(scene);
    renderer.setSize({ width: 800, height: 600 }, 1);
    renderer.setScene(scene);
    frames.run();
    expect(surface.calls.at(-1)?.op).toBe('drawLayer');
    expect(surface.ops('text').map(({ text }) => text)).toContain('Tavern');
  });
});
