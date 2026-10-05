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
}

export interface TextStyle {
  /** A CSS font shorthand, such as `bold 24px serif`. */
  font: string;
  color: string;
  /** Where the point is horizontally; the text is always centred vertically on it. */
  align: 'left' | 'center' | 'right';
  alpha?: number;
}

/** A decoded image (`DecodedImage.image`): an `ImageBitmap` or a loaded `<img>`. */
export type SurfaceImage = ImageBitmap | HTMLImageElement;

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
  /** `image` stretched over the rectangle, clipped to `clip` when given. */
  image(image: SurfaceImage, x: number, y: number, width: number, height: number, clip: ImageClip | null): void;
  text(text: string, x: number, y: number, style: TextStyle): void;
  /** The width of `text` in `font`, in the font's own pixels (the camera does not apply). */
  measureText(text: string, font: string): number;
  /** One of Atlas's map icons, `size` wide and centred on (x, y); an unknown name draws nothing. */
  icon(name: string, x: number, y: number, size: number, color: string, alpha: number): void;
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
