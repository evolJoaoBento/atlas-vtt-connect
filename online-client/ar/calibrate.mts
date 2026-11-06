// online-client/ar/calibrate.mts
/**
 * Finding the phone camera's field of view (browsers do not tell it): from pictures of a flat printed page whose
 * markers' places are known (the A4 sheet or a mat page), seen at a slant.
 *
 * A page's homography H (page millimetres to picture pixels) is K·[r1 r2 t] up to scale, K the camera's focal length f
 * and its middle. r1 and r2, the page's axes in the camera, are at right angles and of one length: two equations in
 * 1/f². Seen straight on they say nothing (the slant is what carries f), so only slanted pictures count, and the answer
 * is the middle of many.
 *
 * It is kept per camera, by the camera's name and picture size, in the browser.
 */

/** Pictures needed. */
export const CALIBRATION_SAMPLES = 24;
const DEG = Math.PI / 180;
/** The slant a picture needs to say anything of f, and the most it may have (markers too squashed to read well). */
const MIN_SLANT = 20 * DEG;
const MAX_SLANT = 70 * DEG;
const KEY = 'atlas-connect-ar-cameras';

/** The field of view along the long side, in degrees, for a focal length `f` (pixels) and a picture whose long side is `long` pixels. */
export const fovOf = (f: number, long: number): number => (2 * Math.atan(long / 2 / f)) / DEG;

/**
 * The focal length (pixels) one homography gives, with the picture's middle at (`cx`, `cy`), and the page's slant;
 * null when it says nothing (seen too straight on, or too slanted).
 */
export function focalFrom(h: readonly number[], cx: number, cy: number): { f: number; slant: number } | null {
  const column = (k: number): { u: number; v: number; w: number } => ({ u: h[k]! - cx * h[6 + k]!, v: h[3 + k]! - cy * h[6 + k]!, w: h[6 + k]! });
  const a = column(0);
  const b = column(1);
  // x = 1/f²:  (u1u2 + v1v2)·x = −w1w2   and   (u1² + v1² − u2² − v2²)·x = w2² − w1².
  const rows: Array<[number, number]> = [
    [a.u * b.u + a.v * b.v, -a.w * b.w],
    [a.u * a.u + a.v * a.v - b.u * b.u - b.v * b.v, b.w * b.w - a.w * a.w],
  ];
  let num = 0;
  let den = 0;
  for (const [p, q] of rows) { num += p * q; den += p * p; }
  if (den <= 0) return null;
  const x = num / den;
  if (!(x > 0)) return null;
  const f = 1 / Math.sqrt(x);
  // The page's normal in the camera: r1 × r2, from K⁻¹h1 and K⁻¹h2.
  const r1 = [a.u / f, a.v / f, a.w];
  const r2 = [b.u / f, b.v / f, b.w];
  const n = [r1[1]! * r2[2]! - r1[2]! * r2[1]!, r1[2]! * r2[0]! - r1[0]! * r2[2]!, r1[0]! * r2[1]! - r1[1]! * r2[0]!];
  const slant = Math.acos(Math.min(1, Math.abs(n[2]!) / Math.hypot(n[0]!, n[1]!, n[2]!)));
  if (slant < MIN_SLANT || slant > MAX_SLANT) return null;
  return { f, slant };
}

/** Gathers focal lengths from slanted pictures and gives the field of view once there are enough. */
export class FovCalibration {
  private readonly fovs: number[] = [];

  /** A page's homography in a picture whose long side is `long` pixels, middle (`cx`, `cy`); whether it counted. */
  add(h: readonly number[], cx: number, cy: number, long: number): boolean {
    const found = focalFrom(h, cx, cy);
    if (!found) return false;
    const fov = fovOf(found.f, long);
    if (fov < 35 || fov > 110) return false;
    this.fovs.push(fov);
    return true;
  }

  /** How far along it is, 0 to 1. */
  get progress(): number {
    return Math.min(1, this.fovs.length / CALIBRATION_SAMPLES);
  }

  /** The field of view (long side, degrees) once enough pictures counted; else null. */
  get fov(): number | null {
    if (this.fovs.length < CALIBRATION_SAMPLES) return null;
    const sorted = [...this.fovs].sort((a, b) => a - b);
    // The middle half's mean: steadier than the median alone, deaf to the odd misread.
    const quarter = Math.floor(sorted.length / 4);
    const middle = sorted.slice(quarter, sorted.length - quarter);
    return middle.reduce((sum, value) => sum + value, 0) / middle.length;
  }
}

/** The calibrated field of view kept for a camera (its name and picture size), or null. */
export function keptFov(camera: string): number | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const fov = kept[camera];
    return typeof fov === 'number' && fov >= 35 && fov <= 110 ? fov : null;
  } catch {
    return null;
  }
}

/** Keeps a camera's calibrated field of view (null forgets it). */
export function keepFov(camera: string, fov: number | null): void {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    if (fov === null) delete kept[camera];
    else kept[camera] = Math.round(fov * 10) / 10;
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    // A private window: calibrate each time.
  }
}
