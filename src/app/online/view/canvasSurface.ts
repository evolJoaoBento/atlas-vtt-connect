/**
 * The player view's drawing interface (`ViewSurface`) on a 2D canvas. Colours and
 * text come from the network: they only reach `fillStyle`, `strokeStyle` and
 * `fillText`, which ignore invalid values and never interpret markup. Map icons are
 * drawn from Atlas's own markup through `Path2D`.
 */
import tokenRingUrl from '../../assets/token-ring.webp';
import type { ScenePoint } from '../scene/sceneTypes';
import { MAP_ICON_BOX, mapIconPaths } from './mapIconPaths';
import { WIDGET_ICON_PATHS, type WidgetIcon } from '../../types/widgetIcons';
import { PIN_ICON_PATHS, type PinIconId } from './pinIcons';
import type { ImageClip, ImageLook, LayerSurface, RasterImage, ShapeStyle, SurfaceImage, TextStyle, ViewSurface } from './ViewSurface';

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

/** Atlas's widget and condition icons are drawn on a 512 × 512 canvas. */
const WIDGET_ICON_SPACE = 512;
/** Only Atlas's own icons are cached, so names from the network cannot grow it. */
const widgetIcons = new Map<string, Path2D>();

const pinIcons = new Map<string, Path2D>();

function pinIconPath(name: string): Path2D | null {
  if (!Object.hasOwn(PIN_ICON_PATHS, name)) return null;
  let path = pinIcons.get(name);
  if (!path) {
    path = new Path2D(PIN_ICON_PATHS[name as PinIconId]);
    pinIcons.set(name, path);
  }
  return path;
}

function widgetIconPath(name: string): Path2D | null {
  if (!Object.hasOwn(WIDGET_ICON_PATHS, name)) return null;
  let path = widgetIcons.get(name);
  if (!path) {
    path = new Path2D(WIDGET_ICON_PATHS[name as WidgetIcon]);
    widgetIcons.set(name, path);
  }
  return path;
}

/** Atlas's lifeless grey (`DownedTokenOverlay.LIFELESS_MATRIX`): luminance, dimmed and cooled a little per channel. */
const LIFELESS = { luminance: [0.2126, 0.7152, 0.0722], brightness: [0.7, 0.72, 0.76] } as const;
/** A greyed copy is drawn at most this many pixels across: token art is small on screen. */
const LIFELESS_SIZE = 512;
/** Greyed copies by source; a source that goes takes its copy with it. */
const lifelessCopies = new WeakMap<object, HTMLCanvasElement | null>();

/** `source` greyed as Atlas greys a downed token; null where its pixels cannot be read. */
function lifelessCopy(source: CanvasImageSource & { width: number; height: number }, blank: () => HTMLCanvasElement): HTMLCanvasElement | null {
  if (lifelessCopies.has(source)) return lifelessCopies.get(source) ?? null;
  let copy: HTMLCanvasElement | null = null;
  try {
    const scale = Math.min(1, LIFELESS_SIZE / Math.max(1, source.width, source.height));
    const canvas = blank();
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = pixels.data;
      const [lr, lg, lb] = LIFELESS.luminance;
      const [br, bg, bb] = LIFELESS.brightness;
      for (let i = 0; i < data.length; i += 4) {
        const grey = lr * data[i]! + lg * data[i + 1]! + lb * data[i + 2]!;
        data[i] = grey * br;
        data[i + 1] = grey * bg;
        data[i + 2] = grey * bb;
      }
      context.putImageData(pixels, 0, 0);
      copy = canvas;
    }
  } catch {
    // A tainted or unreadable image draws in colour only.
    copy = null;
  }
  lifelessCopies.set(source, copy);
  return copy;
}

/** Longest side of the overview a map's brightness is read from (`gridContrastColor.ts`). */
const LUMINANCE_SAMPLE_SIDE = 64;
const luminances = new WeakMap<SurfaceImage, number | null>();

/** The mean of Atlas's grey (`grayFromCanvasSource`) over a small overview of `image`; null when it cannot be read. */
function meanLuminanceOf(image: SurfaceImage, blank: () => HTMLCanvasElement): number | null {
  if (luminances.has(image)) return luminances.get(image) ?? null;
  let mean: number | null = null;
  try {
    const scale = Math.min(1, LUMINANCE_SAMPLE_SIDE / Math.max(image.width, image.height, 1));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = blank();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(image, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      mean = sum / (width * height);
      canvas.width = 0;
      canvas.height = 0;
    }
  } catch {
    // A tainted or unreadable image has no automatic colour.
    mean = null;
  }
  luminances.set(image, mean);
  return mean;
}

/** Atlas's glass dome, drawn once per document at its texture's size. */
const GLASS_SIZE = 512;
const glassDomes = new WeakMap<Document, HTMLCanvasElement | null>();

/**
 * Atlas's `SpriteFactory.getGlassTexture`, layer for layer: an edge vignette, a broad highlight above the centre, two soft
 * glints up and to the left, and a faint rim light along the bottom.
 */
function glassDomeCanvas(doc: Document, blank: () => HTMLCanvasElement): HTMLCanvasElement | null {
  if (glassDomes.has(doc)) return glassDomes.get(doc) ?? null;
  const canvas = blank();
  canvas.width = GLASS_SIZE;
  canvas.height = GLASS_SIZE;
  const ctx = canvas.getContext('2d');
  glassDomes.set(doc, ctx ? canvas : null);
  if (!ctx) return null;
  const centre = GLASS_SIZE / 2;
  const radius = GLASS_SIZE / 2;
  const stops = (gradient: CanvasGradient, list: ReadonlyArray<readonly [number, string]>): CanvasGradient => {
    for (const [offset, color] of list) gradient.addColorStop(offset, color);
    return gradient;
  };
  const glow = (x: number, y: number, reach: number, list: ReadonlyArray<readonly [number, string]>): void => {
    ctx.fillStyle = stops(ctx.createRadialGradient(x, y, 0, x, y, reach), list);
    ctx.beginPath();
    ctx.arc(x, y, reach, 0, Math.PI * 2);
    ctx.fill();
  };
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = stops(ctx.createRadialGradient(centre, centre, radius * 0.3, centre, centre, radius), [
    [0, 'rgba(0, 0, 0, 0)'], [0.55, 'rgba(0, 0, 0, 0)'], [0.65, 'rgba(0, 0, 0, 0.03)'], [0.75, 'rgba(0, 0, 0, 0.08)'],
    [0.82, 'rgba(0, 0, 0, 0.15)'], [0.88, 'rgba(0, 0, 0, 0.25)'], [0.93, 'rgba(0, 0, 0, 0.35)'], [0.97, 'rgba(0, 0, 0, 0.45)'],
    [1, 'rgba(0, 0, 0, 0.55)'],
  ]);
  ctx.fillRect(0, 0, GLASS_SIZE, GLASS_SIZE);
  const highY = centre - radius * 0.15;
  ctx.fillStyle = stops(ctx.createRadialGradient(centre, highY, radius * 0.1, centre, highY, radius * 0.85), [
    [0, 'rgba(255, 255, 255, 0.2)'], [0.3, 'rgba(255, 255, 255, 0.06)'], [0.5, 'rgba(255, 255, 255, 0.02)'], [1, 'rgba(255, 255, 255, 0)'],
  ]);
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, Math.PI * 2);
  ctx.fill();
  glow(centre - radius * 0.32, centre - radius * 0.35, radius * 0.4,
    [[0, 'rgba(255, 255, 255, 0.18)'], [0.4, 'rgba(255, 255, 255, 0.06)'], [1, 'rgba(255, 255, 255, 0)']]);
  glow(centre - radius * 0.18, centre - radius * 0.5, radius * 0.22,
    [[0, 'rgba(255, 255, 255, 0.14)'], [0.5, 'rgba(255, 255, 255, 0.04)'], [1, 'rgba(255, 255, 255, 0)']]);
  ctx.beginPath();
  ctx.arc(centre, centre, radius - 2, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = stops(ctx.createLinearGradient(centre - radius, centre + radius * 0.7, centre + radius, centre + radius * 0.7), [
    [0, 'rgba(255, 255, 255, 0)'], [0.3, 'rgba(255, 255, 255, 0.1)'], [0.5, 'rgba(255, 255, 255, 0.15)'], [0.7, 'rgba(255, 255, 255, 0.1)'],
    [1, 'rgba(255, 255, 255, 0)'],
  ]);
  ctx.lineWidth = 3;
  ctx.stroke();
  return canvas;
}

/** Atlas's downed emblem, drawn once per document at this size (`DOWNED_EMBLEM_TEXTURE_SIZE`). */
const EMBLEM_SIZE = 384;
const emblems = new WeakMap<Document, HTMLCanvasElement | null>();

/**
 * Atlas's `createDownedEmblemTexture`: the skull widget icon in muted, aged bone with a dark outline, a soft vignette
 * that keeps it legible on any art, and embers in its eye sockets.
 */
function downedEmblemCanvas(doc: Document, blank: () => HTMLCanvasElement): HTMLCanvasElement | null {
  if (emblems.has(doc)) return emblems.get(doc) ?? null;
  const canvas = blank();
  canvas.width = EMBLEM_SIZE;
  canvas.height = EMBLEM_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    emblems.set(doc, null);
    return null;
  }
  const size = EMBLEM_SIZE;
  const centre = size / 2;
  const vignette = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  vignette.addColorStop(0, 'rgba(10, 5, 5, 0.45)');
  vignette.addColorStop(0.6, 'rgba(10, 5, 5, 0.2)');
  vignette.addColorStop(1, 'rgba(10, 5, 5, 0)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  const scale = (size * 0.46) / WIDGET_ICON_SPACE;
  ctx.translate(size / 2 - (WIDGET_ICON_SPACE / 2) * scale, size / 2 - (WIDGET_ICON_SPACE / 2) * scale);
  ctx.scale(scale, scale);
  const skull = new Path2D(WIDGET_ICON_PATHS.skull);
  for (const [x, y] of [[166, 256], [346, 256]] as const) {
    const ember = ctx.createRadialGradient(x, y, 0, x, y, 70);
    ember.addColorStop(0, 'rgba(230, 95, 55, 0.7)');
    ember.addColorStop(0.45, 'rgba(150, 28, 18, 0.45)');
    ember.addColorStop(1, 'rgba(120, 10, 10, 0)');
    ctx.fillStyle = ember;
    ctx.fillRect(x - 70, y - 70, 140, 140);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = size * 0.05;
  ctx.shadowOffsetY = size * 0.015;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 28;
  ctx.strokeStyle = '#120c0a';
  ctx.fillStyle = '#120c0a';
  ctx.stroke(skull);
  ctx.fill(skull);
  ctx.restore();
  const bone = ctx.createLinearGradient(0, 16, 0, WIDGET_ICON_SPACE - 16);
  bone.addColorStop(0, '#d6cebd');
  bone.addColorStop(0.5, '#b3a892');
  bone.addColorStop(1, '#7c705c');
  ctx.fillStyle = bone;
  ctx.fill(skull);
  ctx.save();
  ctx.clip(skull);
  const highlight = ctx.createRadialGradient(200, 90, 0, 200, 90, 260);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = highlight;
  ctx.fillRect(0, 0, WIDGET_ICON_SPACE, WIDGET_ICON_SPACE);
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(60, 40, 30, 0.35)';
  ctx.stroke(skull);
  ctx.restore();
  emblems.set(doc, canvas);
  return canvas;
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
  /** Where `raster` puts its pixels before they are drawn. */
  private scratch: HTMLCanvasElement | null = null;

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

  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null, look?: ImageLook): void {
    const source = look?.lifeless ? lifelessCopy(image, () => this.blank()) : image;
    if (!source) return;
    const context = this.context;
    context.save();
    context.globalAlpha = look?.alpha ?? 1;
    if (clip) {
      context.beginPath();
      context.arc(clip.x, clip.y, Math.max(0, clip.radius), 0, Math.PI * 2);
      context.clip();
    }
    context.drawImage(source, x, y, width, height);
    context.restore();
  }

  downedEmblem(x: number, y: number, size: number, alpha: number): void {
    const emblem = downedEmblemCanvas(this.canvas.ownerDocument, () => this.blank());
    if (!emblem || !(alpha > 0)) return;
    const context = this.context;
    context.save();
    context.globalAlpha = alpha;
    context.drawImage(emblem, x - size / 2, y - size / 2, size, size);
    context.restore();
  }

  meanLuminance(image: SurfaceImage): number | null {
    return meanLuminanceOf(image, () => this.blank());
  }

  glassDome(x: number, y: number, size: number): void {
    const dome = glassDomeCanvas(this.canvas.ownerDocument, () => this.blank());
    if (dome) this.context.drawImage(dome, x - size / 2, y - size / 2, size, size);
  }

  /** A bare copy of this surface's canvas, made by its own document (a pop-out window's too). */
  private blank(): HTMLCanvasElement {
    return this.canvas.cloneNode(false) as HTMLCanvasElement;
  }

  tokenRing(x: number, y: number, diameter: number, artSize: number, color: string, look?: ImageLook): void {
    const doc = this.canvas.ownerDocument;
    const tint = ringColor(color);
    const image = tokenRingImage(doc);
    const tinted = image ? tintedRing(image, () => this.blank(), tint) : null;
    const ring = tinted && look?.lifeless ? lifelessCopy(tinted, () => this.blank()) : tinted;
    const alpha = look?.alpha ?? 1;
    if (ring) {
      const context = this.context;
      context.save();
      context.globalAlpha = alpha;
      context.drawImage(ring, x - diameter / 2, y - diameter / 2, diameter, diameter);
      context.restore();
      return;
    }
    // Atlas's stand-in while the texture loads (SpriteFactory.createFallbackRing): a ring as wide as the padding.
    const width = Math.max(2, (diameter - artSize) / 2);
    this.circle(x, y, Math.max(0, diameter / 2 - width / 2), { stroke: look?.lifeless ? '#5a5c60' : tint, lineWidth: width, alpha: 0.95 * alpha });
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

  glyph(name: string, x: number, y: number, size: number, color: string, alpha: number): void {
    const path = widgetIconPath(name);
    if (!path) return;
    const context = this.context;
    context.save();
    context.translate(x - size / 2, y - size / 2);
    context.scale(size / WIDGET_ICON_SPACE, size / WIDGET_ICON_SPACE);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fill(path);
    context.restore();
  }

  raster(image: RasterImage, x: number, y: number, width: number, height: number): void {
    if (image.width <= 0 || image.height <= 0) return;
    // Pixels go onto a canvas of their own first: `putImageData` ignores the transform and the alpha.
    const scratch = (this.scratch ??= this.blank());
    if (scratch.width < image.width) scratch.width = image.width;
    if (scratch.height < image.height) scratch.height = image.height;
    const context = scratch.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.clearRect(0, 0, image.width, image.height);
    context.putImageData(pixels, 0, 0);
    this.context.drawImage(scratch, 0, 0, image.width, image.height, x, y, width, height);
  }

  pinGlyph(name: string, x: number, y: number, size: number, color: string): void {
    const path = pinIconPath(name);
    if (!path) return;
    const context = this.context;
    context.save();
    context.translate(x - size / 2, y - size / 2);
    context.scale(size / WIDGET_ICON_SPACE, size / WIDGET_ICON_SPACE);
    context.fillStyle = color;
    context.fill(path);
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
      if (style.gradient) {
        const { from, to, stops } = style.gradient;
        const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
        for (const [offset, color] of stops) {
          try {
            gradient.addColorStop(Math.max(0, Math.min(1, offset)), color);
          } catch {
            // An invalid colour from the network adds no stop.
          }
        }
        context.fillStyle = gradient;
        context.fill();
      } else if (style.fill !== undefined) {
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
