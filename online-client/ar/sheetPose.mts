// online-client/ar/sheetPose.mts
/**
 * Where the phone's camera is over the printed sheet, from where the sheet's marker corners show in its picture: a
 * homography from all the corners seen, taken apart into a turn and a place with the camera's focal length, then
 * refined (Gauss-Newton) so the corners reproject where they were seen.
 *
 * The camera is computer vision's: x to the right of the picture, y down it, z ahead; a sheet point P shows at
 * f·(R·P + t) / z + c. Sheet points are millimetres on the sheet (z = 0).
 */

export interface Point { x: number; y: number }

/** A pinhole camera: the focal length and the picture's middle, in pixels. */
export interface Intrinsics { f: number; cx: number; cy: number }

export interface SheetPose {
  /** Sheet directions to the camera's, row by row. */
  rotation: number[];
  /** The sheet's middle from the camera, in millimetres. */
  translation: number[];
  /** How far, on average, the corners reproject from where they were seen, in pixels. */
  error: number;
}

/**
 * The focal length for a picture `width` × `height` whose long side spans `fovDeg` degrees. Browsers do not tell a
 * camera's lens; a phone's main camera shows about 65° along its long side.
 */
export function intrinsicsFor(width: number, height: number, fovDeg: number): Intrinsics {
  const long = Math.max(width, height);
  return { f: long / 2 / Math.tan((fovDeg * Math.PI) / 360), cx: width / 2, cy: height / 2 };
}

/** Solves `a`·x = `b` (n × n, row by row) by elimination with pivoting; null when it is singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const lead = m[col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const line = m[row]!;
      const factor = line[col]! / lead[col]!;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) line[k]! -= factor * lead[k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Moves and scales points to their mean at the origin and an average distance of √2 (Hartley), and the matrix doing so. */
function normalizer(points: readonly Point[]): { points: Point[]; matrix: number[] } {
  let mx = 0;
  let my = 0;
  for (const p of points) { mx += p.x; my += p.y; }
  mx /= points.length;
  my /= points.length;
  let spread = 0;
  for (const p of points) spread += Math.hypot(p.x - mx, p.y - my);
  const s = Math.SQRT2 / Math.max(1e-9, spread / points.length);
  return { points: points.map((p) => ({ x: (p.x - mx) * s, y: (p.y - my) * s })), matrix: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1] };
}

const mul3 = (a: readonly number[], b: readonly number[]): number[] => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
};

const invert3 = (m: readonly number[]): number[] | null => {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
};

/** The homography (3 × 3, row by row) taking each `from` point to its `to` point; at least four pairs. */
export function homography(from: readonly Point[], to: readonly Point[]): number[] | null {
  if (from.length < 4 || from.length !== to.length) return null;
  const a = normalizer(from);
  const b = normalizer(to);
  // h33 = 1: eight unknowns, by least squares.
  const ata = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const atb = new Array<number>(8).fill(0);
  const add = (row: number[], value: number): void => {
    for (let i = 0; i < 8; i++) {
      atb[i]! += row[i]! * value;
      for (let j = 0; j < 8; j++) ata[i]![j]! += row[i]! * row[j]!;
    }
  };
  for (let k = 0; k < a.points.length; k++) {
    const { x, y } = a.points[k]!;
    const { x: u, y: v } = b.points[k]!;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solve(ata, atb);
  if (!h) return null;
  const inverse = invert3(b.matrix);
  if (!inverse) return null;
  return mul3(mul3(inverse, [...h, 1]), a.matrix);
}

const cross = (a: readonly number[], b: readonly number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
const norm = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);

/** The nearest turn to a 3 × 3 matrix (row by row), by Higham's iteration of the polar decomposition. */
function nearestRotation(m: readonly number[]): number[] {
  let r = [...m];
  for (let k = 0; k < 12; k++) {
    const inverse = invert3(r);
    if (!inverse) break;
    // (R + R⁻ᵀ) / 2.
    const next = r.map((value, i) => (value + inverse[(i % 3) * 3 + Math.floor(i / 3)]!) / 2);
    const change = next.reduce((sum, value, i) => sum + Math.abs(value - r[i]!), 0);
    r = next;
    if (change < 1e-12) break;
  }
  return r;
}

/** A turn from an axis-angle vector (Rodrigues), row by row. */
function rodrigues(w: readonly number[]): number[] {
  const angle = norm(w);
  if (angle < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const [x, y, z] = [w[0]! / angle, w[1]! / angle, w[2]! / angle];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

/** Where a sheet point shows in the picture; null behind the camera. */
export function project(pose: Pick<SheetPose, 'rotation' | 'translation'>, camera: Intrinsics, point: Point): Point | null {
  const r = pose.rotation;
  const t = pose.translation;
  const x = r[0]! * point.x + r[1]! * point.y + t[0]!;
  const y = r[3]! * point.x + r[4]! * point.y + t[1]!;
  const z = r[6]! * point.x + r[7]! * point.y + t[2]!;
  if (z <= 1e-6) return null;
  return { x: camera.f * (x / z) + camera.cx, y: camera.f * (y / z) + camera.cy };
}

function reprojection(pose: Pick<SheetPose, 'rotation' | 'translation'>, camera: Intrinsics, sheet: readonly Point[], seen: readonly Point[]): number[] | null {
  const out: number[] = [];
  for (let i = 0; i < sheet.length; i++) {
    const shown = project(pose, camera, sheet[i]!);
    if (!shown) return null;
    out.push(shown.x - seen[i]!.x, shown.y - seen[i]!.y);
  }
  return out;
}

/** Gauss-Newton on the six numbers of the pose (a small turn and the place), with a numeric Jacobian. */
function refine(start: Pick<SheetPose, 'rotation' | 'translation'>, camera: Intrinsics, sheet: readonly Point[], seen: readonly Point[]): Pick<SheetPose, 'rotation' | 'translation'> {
  let pose = { rotation: [...start.rotation], translation: [...start.translation] };
  const moved = (p: typeof pose, delta: readonly number[]): typeof pose => ({
    rotation: mul3(rodrigues(delta.slice(0, 3)), p.rotation),
    translation: [p.translation[0]! + delta[3]!, p.translation[1]! + delta[4]!, p.translation[2]! + delta[5]!],
  });
  let residual = reprojection(pose, camera, sheet, seen);
  if (!residual) return pose;
  let cost = residual.reduce((sum, value) => sum + value * value, 0);
  for (let iteration = 0; iteration < 8; iteration++) {
    const steps = [1e-5, 1e-5, 1e-5, 1e-3, 1e-3, 1e-3];
    const columns: number[][] = [];
    for (let k = 0; k < 6; k++) {
      const delta = [0, 0, 0, 0, 0, 0];
      delta[k] = steps[k]!;
      const shifted = reprojection(moved(pose, delta), camera, sheet, seen);
      if (!shifted) return pose;
      columns.push(shifted.map((value, i) => (value - residual![i]!) / steps[k]!));
    }
    const jtj = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (__, j) => columns[i]!.reduce((sum, value, n) => sum + value * columns[j]![n]!, 0)));
    const jtr = columns.map((column) => -column.reduce((sum, value, n) => sum + value * residual![n]!, 0));
    // A touch of damping keeps a poor start from leaping.
    for (let i = 0; i < 6; i++) jtj[i]![i]! *= 1 + 1e-6;
    const delta = solve(jtj, jtr);
    if (!delta) break;
    const next = moved(pose, delta);
    const nextResidual = reprojection(next, camera, sheet, seen);
    if (!nextResidual) break;
    const nextCost = nextResidual.reduce((sum, value) => sum + value * value, 0);
    if (nextCost >= cost) break;
    pose = next;
    residual = nextResidual;
    const gain = cost - nextCost;
    cost = nextCost;
    if (gain < 1e-9 * Math.max(1, cost)) break;
  }
  return { rotation: nearestRotation(pose.rotation), translation: pose.translation };
}

/** The camera's pose over the sheet from sheet points and where each showed in the picture; at least four. */
export function sheetPose(sheet: readonly Point[], seen: readonly Point[], camera: Intrinsics): SheetPose | null {
  const h = homography(sheet, seen);
  if (!h) return null;
  // K⁻¹·H = λ·[r1 r2 t].
  const kInverse = [1 / camera.f, 0, -camera.cx / camera.f, 0, 1 / camera.f, -camera.cy / camera.f, 0, 0, 1];
  const m = mul3(kInverse, h);
  let r1 = [m[0]!, m[3]!, m[6]!];
  let r2 = [m[1]!, m[4]!, m[7]!];
  let t = [m[2]!, m[5]!, m[8]!];
  const scale = 2 / (norm(r1) + norm(r2));
  if (!Number.isFinite(scale)) return null;
  // The sheet is ahead of the camera.
  const sign = t[2]! * scale < 0 ? -scale : scale;
  r1 = r1.map((v) => v * sign);
  r2 = r2.map((v) => v * sign);
  t = t.map((v) => v * sign);
  const r3 = cross(r1, r2);
  const rotation = nearestRotation([r1[0]!, r2[0]!, r3[0]!, r1[1]!, r2[1]!, r3[1]!, r1[2]!, r2[2]!, r3[2]!]);
  const refined = refine({ rotation, translation: t }, camera, sheet, seen);
  const residual = reprojection(refined, camera, sheet, seen);
  if (!residual) return null;
  let sum = 0;
  for (let i = 0; i < residual.length; i += 2) sum += Math.hypot(residual[i]!, residual[i + 1]!);
  return { rotation: refined.rotation, translation: refined.translation, error: sum / (residual.length / 2) };
}

/** What a screen `screenWidth` × `screenHeight` shows of a picture `width` × `height` made to cover it (CSS `object-fit: cover`). */
export function coverCrop(width: number, height: number, screenWidth: number, screenHeight: number): { x: number; y: number; width: number; height: number } {
  const scale = Math.max(screenWidth / width, screenHeight / height);
  const shownWidth = screenWidth / scale;
  const shownHeight = screenHeight / scale;
  return { x: (width - shownWidth) / 2, y: (height - shownHeight) / 2, width: shownWidth, height: shownHeight };
}

/**
 * What the screen shows of a camera picture `width` × `height` made to cover it, as the tangents of the screen's edges
 * from the camera: what Tabletop's board takes as its frustum.
 */
export function coverFrustum(camera: Intrinsics, width: number, height: number, screenWidth: number, screenHeight: number): { left: number; right: number; top: number; bottom: number } {
  const crop = coverCrop(width, height, screenWidth, screenHeight);
  return {
    left: (crop.x - camera.cx) / camera.f,
    right: (crop.x + crop.width - camera.cx) / camera.f,
    top: (crop.y - camera.cy) / camera.f,
    bottom: (crop.y + crop.height - camera.cy) / camera.f,
  };
}
