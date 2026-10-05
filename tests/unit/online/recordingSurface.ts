import type { DecodedImage } from '../../../src/app/online/assets/AssetLoader';
import { sceneWorldBounds } from '../../../src/app/online/preview/previewLayout';
import type { PlayerScene, ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { NO_TOKEN_OVERLAY, type LayerFrame } from '../../../src/app/online/view/layers/layerTypes';
import type { ImageClip, LayerSurface, ShapeStyle, SurfaceImage, TextStyle, ViewSurface } from '../../../src/app/online/view/ViewSurface';

export type SurfaceCall =
  | { op: 'begin'; width: number; height: number; background: string | null }
  | { op: 'camera'; scale: number; offsetX: number; offsetY: number }
  | { op: 'push'; x: number; y: number; rotation: number; scale: number }
  | { op: 'pop' }
  | { op: 'rect'; x: number; y: number; width: number; height: number; style: ShapeStyle }
  | { op: 'roundRect'; x: number; y: number; width: number; height: number; radius: number; style: ShapeStyle }
  | { op: 'circle'; x: number; y: number; radius: number; style: ShapeStyle }
  | { op: 'paths'; paths: ScenePoint[][]; closed: boolean; style: ShapeStyle }
  | { op: 'image'; image: SurfaceImage; x: number; y: number; width: number; height: number; clip: ImageClip | null }
  | { op: 'text'; text: string; x: number; y: number; style: TextStyle }
  | { op: 'icon'; name: string; x: number; y: number; size: number; color: string; alpha: number }
  | { op: 'drawLayer'; layer: number; x: number; y: number; width: number; height: number };

export type CallOf<K extends SurfaceCall['op']> = Extract<SurfaceCall, { op: K }>;

/** Records every drawing call. Text measures half its font size per character. */
export class RecordingSurface implements ViewSurface {
  readonly calls: SurfaceCall[] = [];
  readonly layers: RecordingLayer[] = [];

  constructor(readonly id = 0) {}

  begin(width: number, height: number, background: string | null): void { this.calls.push({ op: 'begin', width, height, background }); }
  setCamera(scale: number, offsetX: number, offsetY: number): void { this.calls.push({ op: 'camera', scale, offsetX, offsetY }); }
  push(x: number, y: number, rotation: number, scale: number): void { this.calls.push({ op: 'push', x, y, rotation, scale }); }
  pop(): void { this.calls.push({ op: 'pop' }); }
  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void {
    this.calls.push({ op: 'rect', x, y, width, height, style });
  }
  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void {
    this.calls.push({ op: 'roundRect', x, y, width, height, radius, style });
  }
  circle(x: number, y: number, radius: number, style: ShapeStyle): void { this.calls.push({ op: 'circle', x, y, radius, style }); }
  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void {
    this.calls.push({ op: 'paths', paths: paths.map((path) => [...path]), closed, style });
  }
  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void {
    this.calls.push({ op: 'image', image, x, y, width, height, clip });
  }
  text(text: string, x: number, y: number, style: TextStyle): void { this.calls.push({ op: 'text', text, x, y, style }); }
  measureText(text: string, font: string): number {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
    return text.length * size * 0.5;
  }
  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void {
    this.calls.push({ op: 'icon', name, x, y, size, color, alpha });
  }
  createLayer(width: number, height: number): LayerSurface {
    const layer = new RecordingLayer(this.layers.length + 1, width, height);
    this.layers.push(layer);
    return layer;
  }
  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void {
    this.calls.push({ op: 'drawLayer', layer: layer instanceof RecordingLayer ? layer.id : -1, x, y, width, height });
  }

  /** The calls of one kind, in order. */
  ops<K extends SurfaceCall['op']>(op: K): Array<CallOf<K>> {
    return this.calls.filter((call): call is CallOf<K> => call.op === op);
  }

  clear(): void {
    this.calls.length = 0;
  }
}

export class RecordingLayer extends RecordingSurface implements LayerSurface {
  released = false;

  constructor(id: number, readonly width: number, readonly height: number) {
    super(id);
  }

  release(): void {
    this.released = true;
  }
}

/** Animation frames the test runs by hand. */
export function fakeFrames(): { request(draw: () => void): number; cancel(handle: number): void; run(): void; readonly pending: number } {
  const queue = new Map<number, () => void>();
  let next = 1;
  return {
    request: (draw) => {
      const handle = next++;
      queue.set(handle, draw);
      return handle;
    },
    cancel: (handle) => { queue.delete(handle); },
    run: () => {
      const due = [...queue.values()];
      queue.clear();
      due.forEach((draw) => draw());
    },
    get pending() { return queue.size; },
  };
}

export function decodedImage(width: number, height: number): DecodedImage {
  return { image: { width, height } as unknown as ImageBitmap, width, height, release: () => {} };
}

/** One frame for a layer: the whole 1000 × 800 map of `playerScene` visible at zoom 1, no images loaded. */
export function frame(scene: PlayerScene, overrides: Partial<LayerFrame> = {}): LayerFrame {
  return {
    scene, images: () => null, visible: { x: -100, y: -100, width: 1200, height: 1000 }, zoom: 1, pixel: 1,
    bounds: sceneWorldBounds(scene), overlay: NO_TOKEN_OVERLAY, ...overrides,
  };
}
