// online-client/ar/sheetTracker.mts
/**
 * Finds our markers in a camera picture (js-aruco2: the A4 sheet's and the cards'), and the camera's pose from all the
 * corners of those placed; and steadies that pose from frame to frame, so a hand's shake does not shake the board while a real move
 * still follows at once.
 */
import { AR } from 'js-aruco2';
import { DICTIONARY, markerCorners, markerGroup } from './markerSheet.mts';
import { sheetPose, type Intrinsics, type Point, type SheetPose } from './sheetPose.mts';

export interface PictureData { width: number; height: number; data: Uint8ClampedArray }

export interface Tracked {
  pose: SheetPose;
  /** The markers seen and used. */
  markers: number[];
  /** The marker corners used: where each is (in the frame the board stands in), and where it showed in the picture. */
  sheet: Point[];
  seen: Point[];
}

/** A marker of ours found in a picture: where its corners showed, and the camera's pose over it alone (its own frame). */
export interface Detected {
  id: number;
  seen: Point[];
  /** The camera's pose over the marker's sheet or card, from this marker's corners only; null when they do not fit. */
  pose: SheetPose | null;
}

/** Where marker corners are, by marker id, in the frame the board stands in. */
export type CornerLayout = (id: number) => Point[] | null;

/** The camera's pose from markers found, placed by `layout`; null when none is placed (or the fit is poor). */
export function poseFrom(markers: readonly Detected[], layout: CornerLayout, camera: Intrinsics, width: number): Tracked | null {
  const sheet: Point[] = [];
  const seen: Point[] = [];
  const used: number[] = [];
  for (const marker of markers) {
    const corners = layout(marker.id);
    if (!corners || used.includes(marker.id)) continue;
    used.push(marker.id);
    for (let i = 0; i < 4; i++) {
      sheet.push(corners[i]!);
      seen.push(marker.seen[i]!);
    }
  }
  if (used.length === 0) return null;
  const pose = sheetPose(sheet, seen, camera);
  // A fit whose corners land well off where they were seen is a misread marker, or a card placed wrong.
  if (!pose || pose.error > Math.max(4, width * 0.012)) return null;
  return { pose, markers: used.sort((a, b) => a - b), sheet, seen };
}

export class SheetTracker {
  // At most two of a marker's 36 bits misread (the dictionary would take eleven): with many markers about, a looser
  // match reads a pattern on the paper, or a mini, as a marker, and the board jumps.
  private readonly detector = new AR.Detector({ dictionaryName: DICTIONARY, maxHammingDistance: 3 });

  /** Our markers (the sheet's and the cards') in `picture`, each with the camera's pose over it alone. */
  detect(picture: PictureData, camera: Intrinsics): Detected[] {
    const found = this.detector.detectImage(picture.width, picture.height, picture.data);
    const out: Detected[] = [];
    for (const marker of found) {
      const group = markerGroup(marker.id);
      if (!group || marker.corners.length !== 4 || out.some((entry) => entry.id === marker.id)) continue;
      const seen = refineCorners(this.detector.grey, marker.corners.map((corner) => ({ x: corner.x, y: corner.y })));
      const pose = sheetPose(group.corners, seen, camera);
      out.push({ id: marker.id, seen, pose: pose && pose.error <= Math.max(3, picture.width * 0.008) ? pose : null });
    }
    return out;
  }

  /** The camera's pose over the A4 sheet in `picture`; null when no marker of the sheet shows (or the fit is poor). */
  track(picture: PictureData, camera: Intrinsics): Tracked | null {
    return poseFrom(this.detect(picture, camera), markerCorners, camera, picture.width);
  }
}

/**
 * Sharper corners: the detector's corners are where its outline's polygon bends, to the pixel. Each side of the marker
 * is found along its length instead (the strongest change of light across it, to a fraction of a pixel), a line fitted
 * through it, and each corner put where two sides' lines meet. A corner that would move far is left as it was. The
 * corners come back in the camera's terms (a pixel's middle at k + ½), the detector's being in the picture's (at k).
 */
export function refineCorners(grey: { width: number; height: number; data: ArrayLike<number> }, corners: readonly Point[]): Point[] {
  const { width, height, data } = grey;
  const at = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) return NaN;
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * width + x0;
    return (data[i]! * (1 - fx) + data[i + 1]! * fx) * (1 - fy) + (data[i + width]! * (1 - fx) + data[i + width + 1]! * fx) * fy;
  };
  const lines: Array<{ px: number; py: number; dx: number; dy: number } | null> = [];
  for (let side = 0; side < 4; side++) {
    const a = corners[side]!;
    const b = corners[(side + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 8) { lines.push(null); continue; }
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const nx = -uy;
    const ny = ux;
    const reach = Math.max(1, Math.min(3, Math.floor((length / 8) * 0.6 * 2) / 2));
    const points: Point[] = [];
    const samples = Math.max(6, Math.min(24, Math.floor(length / 3)));
    for (let k = 0; k < samples; k++) {
      // Clear of the corners, where the sides bend into each other.
      const t = 0.12 + (0.76 * k) / (samples - 1);
      const cx = a.x + (b.x - a.x) * t;
      const cy = a.y + (b.y - a.y) * t;
      // The change of light across the side, half a pixel at a time, a little either way: less than a marker cell, so the
      // black border's inner edge is not taken for its outer one.
      let best = 0;
      let bestAt = NaN;
      const steps: number[] = [];
      for (let o = -reach; o <= reach + 1e-9; o += 0.5) steps.push(Math.abs(at(cx + nx * (o + 0.5), cy + ny * (o + 0.5)) - at(cx + nx * (o - 0.5), cy + ny * (o - 0.5))));
      for (let i = 1; i < steps.length - 1; i++) {
        if (steps[i]! > best && steps[i]! >= steps[i - 1]! && steps[i]! >= steps[i + 1]!) {
          // The peak between samples (a parabola through three).
          const left = steps[i - 1]!;
          const right = steps[i + 1]!;
          const bend = left - 2 * steps[i]! + right;
          best = steps[i]!;
          bestAt = -reach + i * 0.5 + (bend < 0 ? (0.5 * 0.5 * (left - right)) / bend : 0);
        }
      }
      if (best >= 12 && Number.isFinite(bestAt)) points.push({ x: cx + nx * bestAt, y: cy + ny * bestAt });
    }
    lines.push(points.length >= 4 ? fitLine(points) : null);
  }
  // The grey picture's pixel k covers k to k + 1: its middle, where its light is, is at k + ½ in the camera's terms.
  return corners.map((corner, i) => {
    const before = lines[(i + 3) % 4];
    const after = lines[i];
    const meet = before && after ? intersect(before, after) : null;
    const best = meet && Math.hypot(meet.x - corner.x, meet.y - corner.y) < 3 ? meet : corner;
    return { x: best.x + 0.5, y: best.y + 0.5 };
  });
}

/** The line through points (least squares, either way): a point on it and its direction. */
function fitLine(points: readonly Point[]): { px: number; py: number; dx: number; dy: number } | null {
  const n = points.length;
  const mx = points.reduce((sum, p) => sum + p.x, 0) / n;
  const my = points.reduce((sum, p) => sum + p.y, 0) / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const p of points) {
    xx += (p.x - mx) ** 2;
    xy += (p.x - mx) * (p.y - my);
    yy += (p.y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) };
}

function intersect(a: { px: number; py: number; dx: number; dy: number }, b: { px: number; py: number; dx: number; dy: number }): Point | null {
  const det = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
  return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}

type Quaternion = [number, number, number, number];

function toQuaternion(m: readonly number[]): Quaternion {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const trace = a + e + i;
  let q: Quaternion;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(h - f) * s, (c - g) * s, (d - b) * s, 0.25 / s];
  } else if (a > e && a > i) {
    const s = 2 * Math.sqrt(1 + a - e - i);
    q = [0.25 * s, (b + d) / s, (c + g) / s, (h - f) / s];
  } else if (e > i) {
    const s = 2 * Math.sqrt(1 + e - a - i);
    q = [(b + d) / s, 0.25 * s, (f + h) / s, (c - g) / s];
  } else {
    const s = 2 * Math.sqrt(1 + i - a - e);
    q = [(c + g) / s, (f + h) / s, 0.25 * s, (d - b) / s];
  }
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as Quaternion;
}

function toMatrix([x, y, z, w]: Quaternion): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function slerp(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const to = [...b] as Quaternion;
  if (dot < 0) { dot = -dot; for (let k = 0; k < 4; k++) to[k] = -to[k]!; }
  if (dot > 0.9995) {
    const q = a.map((v, k) => v + (to[k]! - v) * t) as Quaternion;
    const n = Math.hypot(...q);
    return q.map((v) => v / n) as Quaternion;
  }
  const angle = Math.acos(Math.min(1, dot));
  const s = Math.sin(angle);
  const wa = Math.sin((1 - t) * angle) / s;
  const wb = Math.sin(t * angle) / s;
  return a.map((v, k) => v * wa + to[k]! * wb) as Quaternion;
}

/** How long the last pose holds while the sheet is out of sight (a hand over it, a blur), in milliseconds. */
export const HOLD_MS = 600;

/** Steadies the tracked pose: small wobbles are eased out, bigger moves taken at once. */
export class PoseSmoother {
  private rotation: Quaternion | null = null;
  private translation: number[] | null = null;
  private seenAt = -Infinity;

  /** The pose to draw with, after a tracked one (null: the sheet was not found this frame) at `now` milliseconds. */
  next(pose: Pick<SheetPose, 'rotation' | 'translation'> | null, now: number): { rotation: number[]; translation: number[] } | null {
    if (pose) {
      const rotation = toQuaternion(pose.rotation);
      if (!this.rotation || !this.translation || now - this.seenAt > HOLD_MS) {
        this.rotation = rotation;
        this.translation = [...pose.translation];
      } else {
        // How far it moved, against how far a hand's shake moves it: a millimetre or so, a few tenths of a degree.
        const distance = Math.hypot(...pose.translation.map((v, k) => v - this.translation![k]!));
        const dot = Math.abs(rotation.reduce((sum, v, k) => sum + v * this.rotation![k]!, 0));
        const angle = 2 * Math.acos(Math.min(1, dot));
        const depth = Math.max(50, Math.abs(pose.translation[2]!));
        const motion = Math.max(distance / (depth * 0.01), angle / 0.01);
        const t = Math.min(1, Math.max(0.2, motion / 4));
        this.rotation = slerp(this.rotation, rotation, t);
        this.translation = this.translation.map((v, k) => v + (pose.translation[k]! - v) * t);
      }
      this.seenAt = now;
    } else if (now - this.seenAt > HOLD_MS) {
      this.rotation = null;
      this.translation = null;
    }
    if (!this.rotation || !this.translation) return null;
    return { rotation: toMatrix(this.rotation), translation: [...this.translation] };
  }

  reset(): void {
    this.rotation = null;
    this.translation = null;
    this.seenAt = -Infinity;
  }
}

/** How fast the drawn pose closes on the tracked one, per second: the sheet is found a dozen times a second or so, the board drawn at the screen's rate. */
const EASE = 18;

/** Glides the drawn pose toward the last tracked one, frame by frame, so the board moves smoothly between findings. */
export class PoseEaser {
  private shown: { rotation: Quaternion; translation: number[] } | null = null;
  private target: { rotation: Quaternion; translation: number[] } | null = null;

  /** The pose to glide toward (null: none, the drawn pose goes too). */
  aim(pose: { rotation: number[]; translation: number[] } | null): void {
    this.target = pose ? { rotation: toQuaternion(pose.rotation), translation: [...pose.translation] } : null;
    if (!this.target) this.shown = null;
  }

  /** The pose to draw after `dt` seconds, and whether it is still gliding. */
  step(dt: number): { pose: { rotation: number[]; translation: number[] } | null; moving: boolean } {
    const target = this.target;
    if (!target) return { pose: null, moving: false };
    if (!this.shown) this.shown = { rotation: [...target.rotation] as Quaternion, translation: [...target.translation] };
    else {
      const t = 1 - Math.exp(-EASE * Math.max(0, dt));
      this.shown = { rotation: slerp(this.shown.rotation, target.rotation, t), translation: this.shown.translation.map((v, k) => v + (target.translation[k]! - v) * t) };
    }
    const off = Math.hypot(...this.shown.translation.map((v, k) => v - target.translation[k]!));
    const dot = Math.abs(this.shown.rotation.reduce((sum, v, k) => sum + v * target.rotation[k]!, 0));
    return { pose: { rotation: toMatrix(this.shown.rotation), translation: [...this.shown.translation] }, moving: off > 0.05 || dot < 1 - 1e-7 };
  }
}
