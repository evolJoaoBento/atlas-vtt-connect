import type { PlayerLightMask, PlayerScene } from '../scene/sceneTypes';
import type { LightingFrame } from '../scene/lightingFrame';

export const LIGHT_PROFILES = ['none', 'torch', 'light', 'continual-flame'] as const;
export type LightProfile = typeof LIGHT_PROFILES[number];
export const LIGHT_MASK_MAX_SIDE = 512;
const BASE64_PNG = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;

const profileRadii: Record<Exclude<LightProfile, 'none'>, readonly [number, number]> = {
  torch: [20, 40], light: [20, 40], 'continual-flame': [20, 40],
};

export function isLightProfile(value: unknown): value is LightProfile {
  return (LIGHT_PROFILES as readonly unknown[]).includes(value);
}

/** Only emissions written by the bounded token editor are exposed as a selectable preset. */
export function lightProfileOf(value: unknown): LightProfile | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const light = value as Record<string, unknown>;
  if (light.bright !== 20 || light.dim !== 40) return undefined;
  if (light.animation === 'torch') return 'torch';
  if (light.animation !== 'magic') return undefined;
  return light.color === '#fff3a3' ? 'light' : light.color === '#ffcf81' ? 'continual-flame' : undefined;
}

export function isPlayerLightMask(value: unknown): value is PlayerLightMask {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Number.isInteger((value as PlayerLightMask).width) && (value as PlayerLightMask).width > 0 && (value as PlayerLightMask).width <= LIGHT_MASK_MAX_SIDE
    && Number.isInteger((value as PlayerLightMask).height) && (value as PlayerLightMask).height > 0 && (value as PlayerLightMask).height <= LIGHT_MASK_MAX_SIDE
    && typeof (value as PlayerLightMask).png === 'string' && (value as PlayerLightMask).png.length <= 1_400_000 && BASE64_PNG.test((value as PlayerLightMask).png);
}

/** Builds a small glow layer, clipped to Atlas's own visibility raster; no map geometry crosses the host boundary. */
export function renderLightMask(scene: PlayerScene, lighting: LightingFrame | null, dynamic: boolean): PlayerLightMask | null {
  if (!dynamic) return null;
  const { width, height } = scene.map;
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height) || !(scene.measurement.unitDistance > 0)) return null;
  const scale = Math.min(1, LIGHT_MASK_MAX_SIDE / width, LIGHT_MASK_MAX_SIDE / height);
  const rasterWidth = Math.max(1, Math.round(width * scale));
  const rasterHeight = Math.max(1, Math.round(height * scale));
  const sources = Object.values(scene.tokens).flatMap((token) => {
    const profile = isLightProfile(token.light) ? token.light : 'none';
    if (profile === 'none') return [];
    const [bright, dim] = profileRadii[profile];
    return [{ x: token.x * scale, y: token.y * scale, bright: bright * scene.map.cellSize / scene.measurement.unitDistance * scale, dim: dim * scene.map.cellSize / scene.measurement.unitDistance * scale }];
  });
  if (sources.length === 0) return null;
  const canvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas') as HTMLCanvasElement;
  canvas.width = rasterWidth; canvas.height = rasterHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  for (const source of sources) {
    const gradient = context.createRadialGradient(source.x, source.y, 0, source.x, source.y, source.dim);
    gradient.addColorStop(0, 'rgba(255,207,129,0.44)');
    gradient.addColorStop(Math.min(0.99, source.bright / source.dim), 'rgba(255,207,129,0.3)');
    gradient.addColorStop(1, 'rgba(255,207,129,0)');
    context.fillStyle = gradient;
    context.beginPath(); context.arc(source.x, source.y, source.dim, 0, Math.PI * 2); context.fill();
  }
  const image = context.getImageData(0, 0, rasterWidth, rasterHeight);
  const grid = lighting?.visibility;
  if (grid) for (let y = 0; y < rasterHeight; y++) for (let x = 0; x < rasterWidth; x++) {
    const col = Math.floor((x + 0.5) / scale / grid.cellSize), row = Math.floor((y + 0.5) / scale / grid.cellSize);
    if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows || grid.dark[row * grid.cols + col] !== 0) image.data[(y * rasterWidth + x) * 4 + 3] = 0;
  }
  context.putImageData(image, 0, 0);
  try { return { width: rasterWidth, height: rasterHeight, png: canvas.toDataURL('image/png') }; }
  catch { return null; }
}
