// online-client/ar/sheetTracker.mts
/**
 * Finds the printed sheet in a camera picture: its markers (js-aruco2), then the camera's pose over it from all their
 * corners; and steadies that pose from frame to frame, so a hand's shake does not shake the board while a real move
 * still follows at once.
 */
import { AR } from 'js-aruco2';
import { DICTIONARY, markerCorners } from './markerSheet.mts';
import { sheetPose, type Intrinsics, type Point, type SheetPose } from './sheetPose.mts';

export interface PictureData { width: number; height: number; data: Uint8ClampedArray }

export interface Tracked {
  pose: SheetPose;
  /** The sheet's markers seen. */
  markers: number[];
}

export class SheetTracker {
  private readonly detector = new AR.Detector({ dictionaryName: DICTIONARY });

  /** The camera's pose over the sheet in `picture`; null when no marker of the sheet shows (or the fit is poor). */
  track(picture: PictureData, camera: Intrinsics): Tracked | null {
    const found = this.detector.detectImage(picture.width, picture.height, picture.data);
    const sheet: Point[] = [];
    const seen: Point[] = [];
    const markers: number[] = [];
    for (const marker of found) {
      const corners = markerCorners(marker.id);
      if (!corners || markers.includes(marker.id) || marker.corners.length !== 4) continue;
      markers.push(marker.id);
      for (let i = 0; i < 4; i++) {
        sheet.push(corners[i]!);
        seen.push({ x: marker.corners[i]!.x, y: marker.corners[i]!.y });
      }
    }
    if (markers.length === 0) return null;
    const pose = sheetPose(sheet, seen, camera);
    // A fit whose corners land well off where they were seen is a misread marker, not the sheet.
    if (!pose || pose.error > Math.max(4, picture.width * 0.012)) return null;
    return { pose, markers: markers.sort((a, b) => a - b) };
  }
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
