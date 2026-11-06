// online-client/ar/fusion.mts
/**
 * Steadier augmented reality: the phone's gyroscope turns the view, the markers place it.
 *
 * A pose read from markers alone wobbles: a pixel's error in a corner tips the sheet a degree or two, and a degree at
 * arm's length moves the board's far side by centimetres. The phone's motion sensors know which way it points far more
 * steadily, and many times a second. So:
 * - The table is level: the sheet lies flat, its face up. Of its turn in the world only its heading is unknown; each
 *   finding gives one, and the heading kept is their slow average (the sheet does not move).
 * - The camera's turn over the sheet is the phone's turn (gyroscope) against that heading, fresh every frame.
 * - Its place is found again from the marker corners with that turn held fixed: three numbers from many corners, which
 *   hardly wobble, and are eased a little.
 *
 * The world is three.js's: y up. Turns are 3 × 3 matrices, row by row; the camera is computer vision's (x right, y down
 * the picture, z ahead).
 */
import type { Intrinsics, Point } from './sheetPose.mts';

type Matrix = number[];

const mul = (a: readonly number[], b: readonly number[]): Matrix => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
};
const transpose = (m: readonly number[]): Matrix => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
const apply = (m: readonly number[], v: readonly number[]): number[] => [0, 1, 2].map((r) => m[r * 3]! * v[0]! + m[r * 3 + 1]! * v[1]! + m[r * 3 + 2]! * v[2]!);
const rotX = (a: number): Matrix => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number): Matrix => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a: number): Matrix => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const DEG = Math.PI / 180;
/** Computer vision's camera axes from three.js's (y and z turned round). */
const VISION = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * The phone's back camera in the world, for a device orientation (`alpha`, `beta`, `gamma` in degrees) with the screen
 * turned `screen` degrees: the turn taking the camera's directions to the world's. As Tabletop's eye view reads the
 * gyroscope (its `deviceQuaternion`), in computer vision's camera axes.
 */
export function deviceRotation(alpha: number, beta: number, gamma: number, screen: number): Matrix {
  // three.js's YXZ Euler order, a quarter turn back about x (the phone flat looks down), then the screen's turn.
  const three = mul(mul(mul(mul(rotY(alpha * DEG), rotX(beta * DEG)), rotZ(-gamma * DEG)), rotX(-Math.PI / 2)), rotZ(-screen * DEG));
  return mul(three, VISION);
}

/** The sheet lying flat with heading `heading`: the turn taking its directions (x right, y down the page, z into the table) to the world's. */
export function flatSheet(heading: number): Matrix {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  // Columns: the sheet's x (level, at the heading), its y (z × x), its z (straight down).
  const x = [c, 0, s];
  const z = [0, -1, 0];
  const y = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!];
  return [x[0]!, y[0]!, z[0]!, x[1]!, y[1]!, z[1]!, x[2]!, y[2]!, z[2]!];
}

/** The heading of a sheet whose turn in the world is `world` (sheet to world), and how far its face is from up (radians). */
export function sheetHeading(world: readonly number[]): { heading: number; tilt: number } {
  const heading = Math.atan2(world[6]!, world[0]!);
  // The sheet's z (into the table) against straight down.
  const tilt = Math.acos(Math.max(-1, Math.min(1, -world[5]!)));
  return { heading, tilt };
}

/**
 * Where the sheet's middle is from the camera, the camera's turn over the sheet being `rotation`: the least-squares
 * place putting each sheet point where it was seen. Null when the points cannot fix it.
 */
export function placeFor(rotation: readonly number[], sheet: readonly Point[], seen: readonly Point[], camera: Intrinsics): number[] | null {
  // For each point: (RP + t)ₓ − u (RP + t)_z = 0 and the same for v; linear in t.
  const ata = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const atb = [0, 0, 0];
  for (let i = 0; i < sheet.length; i++) {
    const p = apply(rotation, [sheet[i]!.x, sheet[i]!.y, 0]);
    const u = (seen[i]!.x - camera.cx) / camera.f;
    const v = (seen[i]!.y - camera.cy) / camera.f;
    for (const [row, value] of [[[1, 0, -u], u * p[2]! - p[0]!], [[0, 1, -v], v * p[2]! - p[1]!]] as const) {
      for (let a = 0; a < 3; a++) {
        atb[a]! += row[a]! * value;
        for (let b = 0; b < 3; b++) ata[a * 3 + b]! += row[a]! * row[b]!;
      }
    }
  }
  const det = ata[0]! * (ata[4]! * ata[8]! - ata[5]! * ata[7]!) - ata[1]! * (ata[3]! * ata[8]! - ata[5]! * ata[6]!) + ata[2]! * (ata[3]! * ata[7]! - ata[4]! * ata[6]!);
  if (Math.abs(det) < 1e-12) return null;
  // Cramer's rule.
  const column = (k: number): number[] => ata.map((value, i) => (i % 3 === k ? atb[Math.floor(i / 3)]! : value));
  const detOf = (m: number[]): number => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const t = [detOf(column(0)) / det, detOf(column(1)) / det, detOf(column(2)) / det];
  return t[2]! > 0 ? t : null;
}

/** How much of a new heading a finding moves the kept one by. */
const HEADING_GAIN = 0.06;
/** A finding whose heading is further than this off the kept one is doubted… */
const HEADING_DOUBT = 6 * DEG;
/** …unless the findings keep saying so this long: the sheet was moved. */
const MOVED_MS = 500;
/** A sheet tipped further than this from level against the gyroscope: a misread, or the sensors not to be trusted. */
const MAX_TILT = 20 * DEG;
/** How fast the drawn place closes on the found one, per second. */
const PLACE_EASE = 14;
/**
 * A camera picture is taken a moment before the page has it: the gyroscope's turn for a picture is read from this long
 * before it came, unless the browser tells when it was taken.
 */
export const CAMERA_LAG_MS = 45;
/** How far ahead the camera's place is carried on its way between findings (it moves on with the hand), in milliseconds. */
const CARRY_MS = 150;

interface Sample { time: number; world: Matrix }

/** Fuses the phone's motion sensors with the markers found; see the top of this file. */
export class SensorFusion {
  private readonly samples: Sample[] = [];
  private heading: number | null = null;
  /** How many findings the heading was averaged from (the first few are averaged evenly, then slowly). */
  private headings = 0;
  private doubtedSince: number | null = null;
  /** The camera's place in the sheet's frame (millimetres): where it is aimed, and where it is drawn. */
  private place: number[] | null = null;
  private shown: number[] | null = null;
  /** How fast the camera's place moves (millimetres a millisecond), from finding to finding, steadied. */
  private velocity = [0, 0, 0];
  private lastFound = -Infinity;

  /** A gyroscope reading at `time` (ms): the camera's turn in the world. */
  orient(world: Matrix, time: number): void {
    this.samples.push({ time, world });
    // A second of readings is plenty.
    while (this.samples.length > 2 && this.samples[0]!.time < time - 1000) this.samples.shift();
  }

  /** Whether readings are coming (within the last half second of `now`). */
  sensing(now: number): boolean {
    const last = this.samples.at(-1);
    return last !== undefined && now - last.time < 500;
  }

  /** The camera's turn in the world at `time`: between the readings either side of it. */
  private worldAt(time: number): Matrix | null {
    const samples = this.samples;
    if (samples.length === 0) return null;
    if (time <= samples[0]!.time) return samples[0]!.world;
    for (let i = 1; i < samples.length; i++) {
      const after = samples[i]!;
      if (after.time < time) continue;
      const before = samples[i - 1]!;
      const t = after.time === before.time ? 1 : (time - before.time) / (after.time - before.time);
      return orthonormal(before.world.map((value, k) => value + (after.world[k]! - value) * t));
    }
    return samples.at(-1)!.world;
  }

  /** The camera's turn over the sheet at `time` (picture time), from the gyroscope and the heading kept; null before both. */
  turnAt(time: number): Matrix | null {
    const world = this.worldAt(time);
    return world && this.heading !== null ? mul(transpose(world), flatSheet(this.heading)) : null;
  }

  /**
   * Markers found in a picture taken at `time`: their marker-only turn over the sheet (`rotation`) and their corners.
   * Returns whether the finding was used.
   */
  found(rotation: readonly number[], sheet: readonly Point[], seen: readonly Point[], camera: Intrinsics, time: number): boolean {
    const world = this.worldAt(time);
    if (!world) return false;
    const measured = sheetHeading(mul(world, rotation));
    if (measured.tilt > MAX_TILT) return false;
    if (this.heading === null) { this.heading = measured.heading; this.headings = 1; }
    else {
      const off = wrap(measured.heading - this.heading);
      if (Math.abs(off) > HEADING_DOUBT) {
        this.doubtedSince ??= time;
        if (time - this.doubtedSince < MOVED_MS) return false;
        // The sheet was turned on the table: start again from here.
        this.heading = measured.heading;
        this.headings = 1;
        this.place = null;
        this.shown = null;
      } else {
        this.headings++;
        this.heading = wrap(this.heading + off * Math.max(HEADING_GAIN, 1 / this.headings));
      }
    }
    this.doubtedSince = null;
    // The camera's turn over the sheet, from the gyroscope and the kept heading; its place from the corners.
    const turn = mul(transpose(world), flatSheet(this.heading));
    const t = placeFor(turn, sheet, seen, camera);
    if (!t) return false;
    // The camera in the sheet's frame: −Rᵀt.
    const place = apply(transpose(turn), t).map((value) => -value);
    if (!this.place || time - this.lastFound > 1500) { this.place = place; this.velocity = [0, 0, 0]; }
    else {
      const gap = Math.max(1, time - this.lastFound);
      // The hand's speed, steadied over a few findings.
      this.velocity = this.velocity.map((value, k) => value + ((place[k]! - this.place![k]!) / gap - value) * 0.35);
      // Small differences are a pixel's noise, eased out; bigger ones, the phone moving, taken at once.
      const distance = Math.hypot(...place.map((value, k) => value - this.place![k]!));
      const depth = Math.max(50, Math.hypot(...place));
      const gain = Math.min(1, Math.max(0.3, distance / (depth * 0.03)));
      this.place = this.place.map((value, k) => value + (place[k]! - value) * gain);
    }
    this.lastFound = time;
    return true;
  }

  /** Whether the sheet was found lately (within `holdMs` of `now`). */
  tracking(now: number, holdMs: number): boolean {
    return this.heading !== null && this.place !== null && now - this.lastFound <= holdMs;
  }

  /**
   * The camera's pose over the sheet for a picture taken at `time`, `dt` seconds after the last drawn: the turn
   * (gyroscope, at that moment) and the place (the last found, carried on a little at the hand's speed).
   */
  pose(time: number, dt: number): { rotation: Matrix; translation: number[] } | null {
    if (this.heading === null || !this.place) return null;
    const world = this.worldAt(time);
    if (!world) return null;
    const ahead = Math.max(0, Math.min(CARRY_MS, time - this.lastFound));
    // A phone at rest still shows a little speed (a finding's noise): under a few centimetres a second it is carried no further.
    const speed = Math.hypot(...this.velocity);
    const carry = speed * 1000 > 30 ? ahead : 0;
    const target = this.place.map((value, k) => value + this.velocity[k]! * carry);
    if (!this.shown) this.shown = [...target];
    else {
      const t = 1 - Math.exp(-PLACE_EASE * Math.max(0, dt));
      this.shown = this.shown.map((value, k) => value + (target[k]! - value) * t);
    }
    const rotation = mul(transpose(world), flatSheet(this.heading));
    // t = −R·place.
    const translation = apply(rotation, this.shown).map((value) => -value);
    return { rotation, translation };
  }

  reset(): void {
    this.heading = null;
    this.headings = 0;
    this.place = null;
    this.shown = null;
    this.velocity = [0, 0, 0];
    this.doubtedSince = null;
    this.lastFound = -Infinity;
  }
}

/** The nearest turn to a nearly-turn matrix (Gram-Schmidt on its columns). */
function orthonormal(m: readonly number[]): Matrix {
  const col = (k: number): number[] => [m[k]!, m[3 + k]!, m[6 + k]!];
  const norm = (v: number[]): number[] => { const n = Math.hypot(v[0]!, v[1]!, v[2]!) || 1; return v.map((x) => x / n); };
  const x = norm(col(0));
  const yRaw = col(1);
  const d = x[0]! * yRaw[0]! + x[1]! * yRaw[1]! + x[2]! * yRaw[2]!;
  const y = norm(yRaw.map((v, k) => v - d * x[k]!));
  const z = [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  return [x[0]!, y[0]!, z[0]!, x[1]!, y[1]!, z[1]!, x[2]!, y[2]!, z[2]!];
}
