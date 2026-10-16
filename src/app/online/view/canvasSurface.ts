/**
 * The player view's drawing interface (`ViewSurface`) on a 2D canvas. Colours and
 * text come from the network: they only reach `fillStyle`, `strokeStyle` and
 * `fillText`, which ignore invalid values and never interpret markup. Map icons are
 * drawn from Atlas's own markup through `Path2D`.
 */
import tokenRingUrl from '../../assets/token-ring.webp';
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

/**
 * Atlas's token ring texture (`src/app/assets/token-ring.webp`, the same file), loaded once for every surface, and the
 * tinted copies drawn from it. Atlas multiplies the texture's colours by the ring colour (Pixi's `tint`) and keeps its
 * alpha; a copy per colour does the same once, at a size that keeps the stone's grain on any token on screen.
 */
const RING_TINT_SIZE = 512;
/** Ring colours come from the network: a bounded cache, so they cannot grow it. */
const RING_TINT_CACHE = 32;
let ringImage: HTMLImageElement | null = null;
let ringLoaded = false;
const ringListeners = new Set<() => void>();
const tintedRings = new Map<string, HTMLCanvasElement>();

/** The ring texture, or null while it loads; starts loading on the first call. */
function tokenRingImage(doc: Document): HTMLImageElement | null {
  if (!ringImage) {
    // The page's Image constructor (a pop-out window's too): `createEl` is Obsidian's alone, and this runs on the join page.
    ringImage = new (doc.defaultView ?? window).Image();
    ringImage.decoding = 'async';
    ringImage.addEventListener('load', () => {
      ringLoaded = true;
      for (const listener of [...ringListeners]) listener();
    }, { once: true });
    ringImage.src = tokenRingUrl;
  }
  return ringLoaded ? ringImage : null;
}

/** Calls `listener` once the ring texture has loaded, so a view drawn with the stand-in is drawn again; at once if it has. */
export function whenTokenRingLoaded(listener: () => void): () => void {
  if (ringLoaded) {
    listener();
    return () => undefined;
  }
  ringListeners.add(listener);
  return () => { ringListeners.delete(listener); };
}

/** Atlas reads the ring colour as hex and falls back to white: the same here, so a colour from the network is only #rrggbb. */
function ringColor(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#ffffff';
}

function tintedRing(image: HTMLImageElement, blank: () => HTMLCanvasElement, color: string): HTMLCanvasElement | null {
  const cached = tintedRings.get(color);
  if (cached) return cached;
  const canvas = blank();
  canvas.width = RING_TINT_SIZE;
  canvas.height = RING_TINT_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, RING_TINT_SIZE, RING_TINT_SIZE);
  if (color !== '#ffffff') {
    // Multiply by the colour, then keep the texture's own alpha, as a Pixi tint does.
    context.globalCompositeOperation = 'multiply';
    context.fillStyle = color;
    context.fillRect(0, 0, RING_TINT_SIZE, RING_TINT_SIZE);
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(image, 0, 0, RING_TINT_SIZE, RING_TINT_SIZE);
  }
  if (tintedRings.size >= RING_TINT_CACHE) tintedRings.clear();
  tintedRings.set(color, canvas);
  return canvas;
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

  tokenRing(x: number, y: number, diameter: number, artSize: number, color: string): void {
    const doc = this.canvas.ownerDocument;
    const tint = ringColor(color);
    const image = tokenRingImage(doc);
    // A bare copy of this surface's canvas, as createLayer makes one.
    const ring = image ? tintedRing(image, () => this.canvas.cloneNode(false) as HTMLCanvasElement, tint) : null;
    if (ring) {
      this.context.drawImage(ring, x - diameter / 2, y - diameter / 2, diameter, diameter);
      return;
    }
    // Atlas's stand-in while the texture loads (SpriteFactory.createFallbackRing): a ring as wide as the padding.
    const width = Math.max(2, (diameter - artSize) / 2);
    this.circle(x, y, Math.max(0, diameter / 2 - width / 2), { stroke: tint, lineWidth: width, alpha: 0.95 });
  }

  text(text: string, x: number, y: number, style: TextStyle): void {
    const context = this.context;
    context.save();
    context.font = style.font;
    context.textAlign = style.align;
    context.textBaseline = 'middle';
    context.globalAlpha = style.alpha ?? 1;
    if (style.outline) {
      // Under the fill, as PIXI strokes text: half the width shows outside the glyphs.
      context.strokeStyle = style.outline.color;
      context.lineWidth = style.outline.width;
      context.lineJoin = 'round';
      context.strokeText(text, x, y);
    }
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
