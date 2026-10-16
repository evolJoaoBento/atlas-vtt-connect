/**
 * Atlas's laser beam as its WebGL shader draws it (`laserBeamShader.ts`, `LaserBeam`), worked out per pixel on the CPU:
 * a canvas has no shaders, and Atlas's own Canvas beam (`CanvasLaserBeam`) leaves out the glow and the fade. The beam is
 * a chain of capsules, one per segment (`writeLaserBeam`), each narrowing with its age; every pixel takes the strongest
 * capsule (Atlas's max blending), whose cross-section is a faint glow, a saturated body and a white-hot filament, with a
 * white-hot spot at the pointer. Shared with the web page.
 */
import { beamRadius, DOT_SCALE, type BeamPoint } from '@atlas-vtt/shared/draw';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { RasterImage } from '../ViewSurface';

/** The most pixels a beam may cover; a larger one is drawn without its glow. */
export const MAX_BEAM_PIXELS = 4_000_000;

/** The beam's pixels and where they go, in world units. */
export interface BeamRaster {
  image: RasterImage;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BeamLook {
  color: string;
  /** Half the beam's width with its glow, and the body's share of it (`beamWidth`), in world units. */
  halfWidth: number;
  bodyShare: number;
  /** Where the white-hot spot sits, or null. */
  pointer: ScenePoint | null;
}

interface Capsule {
  a: BeamPoint;
  b: BeamPoint;
  radiusA: number;
  radiusB: number;
}

/**
 * The beam along `trail` (already smoothed) with a dot at `dot`, at `scale` device pixels per world unit; null when
 * nothing would show or it would cover more than `MAX_BEAM_PIXELS`.
 */
export function rasterBeam(trail: readonly BeamPoint[], dot: BeamPoint | null, look: BeamLook, scale: number): BeamRaster | null {
  const { halfWidth, bodyShare } = look;
  if (!(scale > 0) || !(halfWidth > 0) || !(bodyShare > 0)) return null;
  const capsules: Capsule[] = [];
  const add = (a: BeamPoint, b: BeamPoint, radiusA: number, radiusB: number): void => {
    if (Math.max(radiusA, radiusB) > 0) capsules.push({ a, b, radiusA, radiusB });
  };
  const radius = (point: BeamPoint): number => beamRadius(point, halfWidth);
  if (trail.length === 1) add(trail[0]!, trail[0]!, radius(trail[0]!), radius(trail[0]!));
  for (let i = 1; i < trail.length; i++) add(trail[i - 1]!, trail[i]!, radius(trail[i - 1]!), radius(trail[i]!));
  if (dot) add(dot, dot, halfWidth * DOT_SCALE, halfWidth * DOT_SCALE);
  if (capsules.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { a, b, radiusA, radiusB } of capsules) {
    const reach = Math.max(radiusA, radiusB);
    minX = Math.min(minX, a.x - reach, b.x - reach);
    minY = Math.min(minY, a.y - reach, b.y - reach);
    maxX = Math.max(maxX, a.x + reach, b.x + reach);
    maxY = Math.max(maxY, a.y + reach, b.y + reach);
  }
  const left = Math.floor(minX * scale);
  const top = Math.floor(minY * scale);
  const width = Math.ceil(maxX * scale) - left;
  const height = Math.ceil(maxY * scale) - top;
  if (width <= 0 || height <= 0 || width * height > MAX_BEAM_PIXELS) return null;

  const [red, green, blue] = rgbOf(look.color);
  // Premultiplied colour and alpha, each pixel keeping the strongest capsule.
  const shade = new Float32Array(width * height * 4);
  const pointer = look.pointer;
  const spotRadius = halfWidth * bodyShare * 0.43;
  for (const { a, b, radiusA, radiusB } of capsules) {
    const reach = Math.max(radiusA, radiusB);
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSquared = abX * abX + abY * abY;
    const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach) * scale) - left);
    const x1 = Math.min(width, Math.ceil((Math.max(a.x, b.x) + reach) * scale) - left);
    const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) * scale) - top);
    const y1 = Math.min(height, Math.ceil((Math.max(a.y, b.y) + reach) * scale) - top);
    for (let py = y0; py < y1; py++) {
      const worldY = (top + py + 0.5) / scale;
      for (let px = x0; px < x1; px++) {
        const worldX = (left + px + 0.5) / scale;
        const t = lengthSquared > 0 ? Math.min(1, Math.max(0, ((worldX - a.x) * abX + (worldY - a.y) * abY) / lengthSquared)) : 0;
        const life = a.life + (b.life - a.life) * t;
        const r = radiusA + (radiusB - radiusA) * t;
        const d = r > 0 ? Math.hypot(worldX - (a.x + abX * t), worldY - (a.y + abY * t)) / r : 1;
        if (d >= 1) continue;
        // Each gaussian is at half strength where its distance reaches 1.
        const bodyD = d / bodyShare;
        const filamentD = bodyD / 0.24;
        const halo = Math.exp(-d * d * 3) * 0.4;
        const body = Math.exp(-bodyD * bodyD * 0.693);
        const filament = Math.exp(-filamentD * filamentD * 0.693) * 0.5;
        let spot = 0;
        if (pointer) {
          const spotD = Math.hypot(worldX - pointer.x, worldY - pointer.y) / spotRadius;
          spot = Math.exp(-spotD * spotD * 0.693) * 0.9;
        }
        const alpha = Math.max(halo, body) * smoothstep(0, 0.5, life);
        if (alpha <= 0) continue;
        const white = Math.max(filament, spot);
        const index = (py * width + px) * 4;
        shade[index] = Math.max(shade[index]!, (red + (1 - red) * white) * alpha);
        shade[index + 1] = Math.max(shade[index + 1]!, (green + (1 - green) * white) * alpha);
        shade[index + 2] = Math.max(shade[index + 2]!, (blue + (1 - blue) * white) * alpha);
        shade[index + 3] = Math.max(shade[index + 3]!, alpha);
      }
    }
  }

  // A canvas takes straight colour, not premultiplied.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    const alpha = shade[index + 3]!;
    if (alpha <= 0) continue;
    data[index] = (shade[index]! / alpha) * 255;
    data[index + 1] = (shade[index + 1]! / alpha) * 255;
    data[index + 2] = (shade[index + 2]! / alpha) * 255;
    data[index + 3] = alpha * 255;
  }
  return { image: { data, width, height }, x: left / scale, y: top / scale, width: width / scale, height: height / scale };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** `#rgb` or `#rrggbb` as channels from 0 to 1; anything else (a colour from the network) is Atlas's red. */
function rgbOf(color: string): [number, number, number] {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1] ?? 'ff0059';
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('');
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255) as [number, number, number];
}
