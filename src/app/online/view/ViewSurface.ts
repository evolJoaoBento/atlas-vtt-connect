/**
 * What the player view's layers draw through. A 2D canvas implements it on the join
 * page (`src/app/online/view/canvasSurface.ts`), tests record the calls, and a PIXI renderer
 * could implement it later. Coordinates are world units after `setCamera`, or the local
 * frame after `push`. Colours and text come from the network: implementations hand
 * them only to the drawing API (`fillStyle`, `strokeStyle`, `fillText`), which ignores
 * invalid values and never interprets markup. Shared with the web page.
 */
import type { ScenePoint } from '../scene/sceneTypes';

export interface ShapeStyle {
  fill?: string;
  stroke?: string;
  /** Stroke width in the current frame's units; 1 when unset. */
  lineWidth?: number;
  /** From 0 to 1; 1 when unset. */
  alpha?: number;
  /** Dash pattern in the current frame's units; solid when unset. */
  dash?: readonly number[];
  /** Round caps and joins (ink, fog brushes); butt caps and mitred joins otherwise. */
  round?: boolean;
  /** Cuts the shape out of what was drawn before (fog erasing). */
  erase?: boolean;
  /** Fills by the even-odd rule: a path inside another is a hole in it (a liquid's holes). */
  evenOdd?: boolean;
  /** Fills with a linear gradient from `from` to `to` (current frame) instead of `fill`: offsets 0 to 1 and colours. */
  gradient?: { from: ScenePoint; to: ScenePoint; stops: ReadonlyArray<readonly [offset: number, color: string]> };
}

export interface TextStyle {
  /** A CSS font shorthand, such as `bold 24px serif`. */
  font: string;
  color: string;
  /** Where the point is horizontally; the text is always centred vertically on it. */
  align: 'left' | 'center' | 'right';
  alpha?: number;
  /** A stroke around the glyphs, in the font's pixels, drawn under the fill. */
  outline?: { color: string; width: number };
}

/** A decoded image (`DecodedImage.image`): an `ImageBitmap` or a loaded `<img>`. */
/** A canvas is the minis' picture (`minis/miniLayer.ts`). */
export type SurfaceImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;

/** How an image or a token ring is drawn: its opacity, and greyed as Atlas greys a downed token (`DownedTokenOverlay`). */
export interface ImageLook {
  /** From 0 to 1; 1 when unset. */
  alpha?: number;
  /** Luminance grey, dimmed and cooled slightly, so the creature reads as lifeless. */
  lifeless?: boolean;
}

/** Pixels worked out in code: straight (not premultiplied) RGBA, row by row. */
export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A circle an image is clipped to, in the current frame. */
export interface ImageClip {
  x: number;
  y: number;
  radius: number;
}

export interface ViewSurface {
  /** Starts a frame of `width × height` device pixels, filled with `background` (null: transparent). */
  begin(width: number, height: number, background: string | null): void;
  /** World to device pixels for the calls that follow: device = world × scale + offset. Drops local frames. */
  setCamera(scale: number, offsetX: number, offsetY: number): void;
  /** A local frame with its origin at (x, y) of the current one, rotated by `rotation` radians and scaled. */
  push(x: number, y: number, rotation: number, scale: number): void;
  pop(): void;
  rect(x: number, y: number, width: number, height: number, style: ShapeStyle): void;
  roundRect(x: number, y: number, width: number, height: number, radius: number, style: ShapeStyle): void;
  circle(x: number, y: number, radius: number, style: ShapeStyle): void;
  /** Several open or closed paths stroked or filled as one shape: grid lines, hexes, ink. */
  paths(paths: ReadonlyArray<readonly ScenePoint[]>, closed: boolean, style: ShapeStyle): void;
  /** `image` drawn with its unit square mapped by `matrix` (`[a, b, c, d, e, f]`, as a canvas takes it): a map Atlas aligned turned or shifted. */
  imageMatrix(image: SurfaceImage, matrix: readonly [number, number, number, number, number, number]): void;
  /** `image` stretched over the rectangle, clipped to `clip` when given. */
  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null, look?: ImageLook): void;
  /**
   * Atlas's token ring (its `token-ring.webp`), `diameter` wide and centred on (x, y), its colours multiplied by `color`
   * as Atlas tints it, around art `artSize` wide. Until the texture has loaded, Atlas's own stand-in: a plain ring in the
   * colour as wide as the padding between the art and the ring's edge.
   */
  tokenRing(x: number, y: number, diameter: number, artSize: number, color: string, look?: ImageLook): void;
  /** Atlas's glass dome over framed token art (`SpriteFactory.getGlassTexture`): a vignette and soft highlights, `size` wide, centred on (x, y). */
  glassDome(x: number, y: number, size: number): void;
  /** Atlas's downed emblem (`downedEmblemTexture`): a skull in aged bone with embers in its eyes, `size` wide, centred on (x, y). */
  downedEmblem(x: number, y: number, size: number, alpha: number): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
  /** The width of `text` in `font`, in the font's own pixels (the camera does not apply). */
  measureText(text: string, font: string): number;
  /** One of Atlas's map icons, `size` wide and centred on (x, y); an unknown name draws nothing. */
  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void;
  /** One of Atlas's widget and condition icons (`WIDGET_ICON_PATHS`), filled, `size` wide and centred on (x, y); an unknown name draws nothing. */
  glyph(name: string, x: number, y: number, size: number, color: string, alpha: number): void;
  /** `image` stretched over the rectangle, as an image is: pixels worked out in code, such as the laser's glow. */
  raster(image: RasterImage, x: number, y: number, width: number, height: number): void;
  /** The image's mean luminance (0–255) from a small overview, as Atlas reads a map's for the grid colour; null when unreadable. */
  meanLuminance(image: SurfaceImage): number | null;
  /** One of Atlas's pin icons (`PIN_ICON_PATHS`), filled, `size` wide and centred on (x, y); an unknown name draws nothing. */
  pinGlyph(name: string, x: number, y: number, size: number, color: string): void;
  /** An offscreen surface for caching a layer; null when none can be made. */
  createLayer(width: number, height: number): LayerSurface | null;
  /** Draws a cached layer stretched over the rectangle. */
  drawLayer(layer: LayerSurface, x: number, y: number, width: number, height: number): void;
}

export interface LayerSurface extends ViewSurface {
  readonly width: number;
  readonly height: number;
  /** Frees its pixels; it is never drawn again. */
  release(): void;
}
