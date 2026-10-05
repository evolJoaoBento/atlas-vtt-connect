/**
 * The player view's drawing interface (`ViewSurface`) on a 2D canvas. Colours and
 * text come from the network: they only reach `fillStyle`, `strokeStyle` and
 * `fillText`, which ignore invalid values and never interpret markup. Map icons are
 * drawn from Atlas's own markup through `Path2D`.
 */
import type { ScenePoint } from '../scene/sceneTypes';
import { MAP_ICON_BOX, mapIconPaths } from './mapIconPaths';
import type { ImageClip, LayerSurface, ShapeStyle, SurfaceImage, TextStyle, ViewSurface } from './ViewSurface';

interface IconShape {
  path: Path2D;
  fill: boolean;
}

/** Only Atlas's own icons are cached, so names from the network cannot grow it. */
const icons = new Map<string, IconShape[]>();

function iconShapes(name: string): IconShape[] | null {
  const paths = mapIconPaths(name);
  if (!paths) return null;
  let shapes = icons.get(name);
  if (!shapes) {
    shapes = paths.map(({ d, fill }) => ({ path: new Path2D(d), fill }));
    icons.set(name, shapes);
  }
  return shapes;
}

function trace(context: CanvasRenderingContext2D, points: readonly ScenePoint[], closed: boolean): void {
  const [first, ...rest] = points;
  if (!first) return;
  context.moveTo(first.x, first.y);
  for (const point of rest) context.lineTo(point.x, point.y);
  if (closed) context.closePath();
}

class CanvasSurface implements ViewSurface {
  private depth = 0;

  constructor(readonly canvas: HTMLCanvasElement, protected readonly context: CanvasRenderingContext2D) {}

  begin(width: number, height: number, background: string | null): void {
    // Assigning a size clears and reallocates the canvas, so only when it changed.
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.unwind();
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, width, height);
    if (background !== null) {
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);
    }
  }

  setCamera(scale: number, offsetX: number, offsetY: number): void {
    this.unwind();
    this.context.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  }

  push(x: number, y: number, rotation: number, scale: number): void {
    const context = this.context;
    context.save();
    this.depth++;
    context.translate(x, y);
    if (rotation !== 0) context.rotate(rotation);
    if (scale !== 1) context.scale(scale, scale);
  }

  pop(): void {
    if (this.depth === 0) return;
    this.depth--;
    this.context.restore();
  }

  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void {
    this.shape(style, () => this.context.rect(x, y, width, height));
  }

  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    this.shape(style, () => {
      const context = this.context;
      if (typeof context.roundRect === 'function') {
        context.roundRect(x, y, width, height, r);
        return;
      }
      // Browsers without CanvasRenderingContext2D.roundRect: the same outline from arcs.
      context.moveTo(x + r, y);
      context.arcTo(x + width, y, x + width, y + height, r);
      context.arcTo(x + width, y + height, x, y + height, r);
      context.arcTo(x, y + height, x, y, r);
      context.arcTo(x, y, x + width, y, r);
      context.closePath();
    });
  }

  circle(x: number, y: number, radius: number, style: ShapeStyle): void {
    this.shape(style, () => this.context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2));
  }

  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void {
    this.shape(style, () => {
      for (const points of paths) trace(this.context, points, closed);
    });
  }

  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void {
    const context = this.context;
    context.save();
    if (clip) {
      context.beginPath();
      context.arc(clip.x, clip.y, Math.max(0, clip.radius), 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(image, x, y, width, height);
    context.restore();
  }

  text(text: string, x: number, y: number, style: TextStyle): void {
    const context = this.context;
    context.save();
    context.font = style.font;
    context.textAlign = style.align;
    context.textBaseline = 'middle';
    context.globalAlpha = style.alpha ?? 1;
    context.fillStyle = style.color;
    context.fillText(text, x, y);
    context.restore();
  }

  measureText(text: string, font: string): number {
    const context = this.context;
    context.save();
    context.font = font;
    const { width } = context.measureText(text);
    context.restore();
    return width;
  }

  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void {
    const shapes = iconShapes(name);
    if (!shapes) return;
    const context = this.context;
    context.save();
    context.translate(x - size / 2, y - size / 2);
    context.scale(size / MAP_ICON_BOX, size / MAP_ICON_BOX);
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.fillStyle = color;
    // Lucide's stroke: 2 units wide, with round caps and joins.
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const { path, fill } of shapes) {
      if (fill) context.fill(path);
      context.stroke(path);
    }
    context.restore();
  }

  createLayer(width: number, height: number): LayerSurface | null {
    // A bare copy of the surface's own canvas: made by its own document (a pop-out window's too), which both the
    // join page and Obsidian can say, where `createEl` is Obsidian's alone.
    const canvas = this.context.canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    return context ? new CanvasLayer(canvas, context) : null;
  }

  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void {
    if (layer instanceof CanvasLayer) this.context.drawImage(layer.canvas, x, y, width, height);
  }

  private unwind(): void {
    while (this.depth > 0) this.pop();
  }

  private shape(style: ShapeStyle, outline: () => void): void {
    const context = this.context;
    context.save();
    try {
      context.beginPath();
      outline();
      context.globalAlpha = style.alpha ?? 1;
      context.globalCompositeOperation = style.erase ? 'destination-out' : 'source-over';
      context.lineCap = style.round ? 'round' : 'butt';
      context.lineJoin = style.round ? 'round' : 'miter';
      context.setLineDash(style.dash ? [...style.dash] : []);
      if (style.fill !== undefined) {
        context.fillStyle = style.fill;
        context.fill();
      }
      if (style.stroke !== undefined) {
        context.strokeStyle = style.stroke;
        context.lineWidth = style.lineWidth ?? 1;
        context.stroke();
      }
    } finally {
      context.restore();
    }
  }
}

class CanvasLayer extends CanvasSurface implements LayerSurface {
  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  release(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}

export function createCanvasSurface(canvas: HTMLCanvasElement): ViewSurface | null {
  const context = canvas.getContext('2d');
  return context ? new CanvasSurface(canvas, context) : null;
}
