/**
 * The player's camera: a centre in world units and a zoom in screen (CSS) pixels per
 * world unit, with the maths to fit areas, zoom around a point and keep the map in
 * view. Pure; shared with the web page.
 */
import type { PreviewRect } from '../preview/previewLayout';

export type WorldRect = PreviewRect;

export interface Camera {
  centerX: number;
  centerY: number;
  zoom: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** A world area by its centre and size, as the GM camera describes it. */
export interface WorldView {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface CameraLimits {
  minZoom: number;
  maxZoom: number;
  /** The centre stays inside this area, so part of the map is always on screen. */
  bounds: WorldRect;
}

/** Space left around the map when it is fitted to the screen, in CSS pixels. */
export const FIT_PADDING = 16;
/** Zoom limits around the map's fitted zoom: out to 1/20 of it, in to 8 times it. */
export const MIN_ZOOM_SHARE = 1 / 20;
export const MAX_ZOOM_SHARE = 8;
/** How long the view takes to glide to the GM's camera. */
export const GLIDE_MS = 150;
/** The camera before anything is known: the world origin in the middle, 1:1. */
export const DEFAULT_CAMERA: Camera = { centerX: 0, centerY: 0, zoom: 1 };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** A canvas not laid out yet measures 0 × 0: the maths treats it as one pixel each way. */
function usable(screen: ScreenSize): ScreenSize {
  return { width: Math.max(1, screen.width), height: Math.max(1, screen.height) };
}

/** The zoom that shows all of `area` on the screen, inset by `padding` CSS pixels. */
export function fitZoom(area: { width: number; height: number }, screen: ScreenSize, padding: number = FIT_PADDING): number {
  const { width, height } = usable(screen);
  const availableWidth = Math.max(1, width - 2 * padding);
  const availableHeight = Math.max(1, height - 2 * padding);
  return Math.min(availableWidth / Math.max(1e-6, area.width), availableHeight / Math.max(1e-6, area.height));
}

/** All of `area`, centred. */
export function fitCamera(area: WorldRect, screen: ScreenSize): Camera {
  return { centerX: area.x + area.width / 2, centerY: area.y + area.height / 2, zoom: fitZoom(area, screen) };
}

/** The GM's visible area: same centre, as large as fits this screen. */
export function cameraForView(view: WorldView, screen: ScreenSize): Camera {
  return { centerX: view.centerX, centerY: view.centerY, zoom: fitZoom(view, screen, 0) };
}

export function cameraLimits(map: WorldRect, screen: ScreenSize): CameraLimits {
  const fitted = fitZoom(map, screen);
  return { minZoom: fitted * MIN_ZOOM_SHARE, maxZoom: fitted * MAX_ZOOM_SHARE, bounds: map };
}

/** The zoom within the limits and the centre inside the map; without limits only a finite, positive zoom. */
export function clampCamera(camera: Camera, limits: CameraLimits | null): Camera {
  const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  if (!limits) return { centerX: camera.centerX, centerY: camera.centerY, zoom };
  const { bounds } = limits;
  return {
    centerX: clamp(camera.centerX, bounds.x, bounds.x + bounds.width),
    centerY: clamp(camera.centerY, bounds.y, bounds.y + bounds.height),
    zoom: clamp(zoom, limits.minZoom, limits.maxZoom),
  };
}

export function screenToWorld(camera: Camera, screen: ScreenSize, point: ScreenPoint): ScreenPoint {
  return {
    x: camera.centerX + (point.x - screen.width / 2) / camera.zoom,
    y: camera.centerY + (point.y - screen.height / 2) / camera.zoom,
  };
}

/** Zooms by `factor`, keeping the world point under `point` where it is on screen, unless a limit stops it. */
export function zoomAround(camera: Camera, screen: ScreenSize, point: ScreenPoint, factor: number, limits: CameraLimits | null): Camera {
  if (!Number.isFinite(factor)) return camera;
  const anchor = screenToWorld(camera, screen, point);
  // A factor of zero or less is the furthest zoom out.
  const requested = factor > 0 ? camera.zoom * factor : (limits?.minZoom ?? camera.zoom);
  const zoom = clampCamera({ ...camera, zoom: requested }, limits).zoom;
  return clampCamera({
    centerX: anchor.x - (point.x - screen.width / 2) / zoom,
    centerY: anchor.y - (point.y - screen.height / 2) / zoom,
    zoom,
  }, limits);
}

/** Moves the map by `dx`, `dy` screen pixels: the world follows the finger. */
export function panBy(camera: Camera, dx: number, dy: number, limits: CameraLimits | null): Camera {
  return clampCamera({ centerX: camera.centerX - dx / camera.zoom, centerY: camera.centerY - dy / camera.zoom, zoom: camera.zoom }, limits);
}

/** The world area on a screen of this size. */
export function visibleArea(camera: Camera, screen: ScreenSize): WorldRect {
  const width = screen.width / camera.zoom;
  const height = screen.height / camera.zoom;
  return { x: camera.centerX - width / 2, y: camera.centerY - height / 2, width, height };
}

/** Part way from `from` to `to` (`t` from 0 to 1), easing out; the zoom moves evenly in scale. */
export function interpolateCamera(from: Camera, to: Camera, t: number): Camera {
  const eased = 1 - (1 - clamp(t, 0, 1)) ** 3;
  return {
    centerX: from.centerX + (to.centerX - from.centerX) * eased,
    centerY: from.centerY + (to.centerY - from.centerY) * eased,
    zoom: from.zoom * (to.zoom / from.zoom) ** eased,
  };
}

export function sameRect(a: WorldRect | null, b: WorldRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function intersection(a: WorldRect, b: WorldRect): WorldRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
