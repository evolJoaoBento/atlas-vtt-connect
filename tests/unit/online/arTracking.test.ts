import { describe, expect, it } from 'vitest';
import { MARKER_MM, SHEET_MARKERS, markerCells, markerSheetSvg } from '../../../online-client/ar/markerSheet.mts';
import { coverFrustum, intrinsicsFor, project, sheetPose, type Intrinsics, type Point } from '../../../online-client/ar/sheetPose.mts';
import { HOLD_MS, PoseSmoother, SheetTracker } from '../../../online-client/ar/sheetTracker.mts';

/** A turn from yaw, pitch and roll (radians), row by row. */
function turn(x: number, y: number, z: number): number[] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x), Math.sin(x), Math.cos(y), Math.sin(y), Math.cos(z), Math.sin(z)];
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const mul = (a: number[], b: number[]): number[] => {
    const out: number[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
    return out;
  };
  return mul(rz, mul(ry, rx));
}

const CELLS = new Map(SHEET_MARKERS.map((marker) => [marker.id, markerCells(marker.id)]));

/** Whether a sheet point is white, as the sheet is printed. */
function sheetWhite(x: number, y: number): boolean {
  for (const marker of SHEET_MARKERS) {
    const u = (x - (marker.x - MARKER_MM / 2)) / MARKER_MM;
    const v = (y - (marker.y - MARKER_MM / 2)) / MARKER_MM;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
    const { size, white } = CELLS.get(marker.id)!;
    return white[Math.floor(v * size) * size + Math.floor(u * size)]!;
  }
  return true;
}

/** A camera picture of the sheet (on a grey table) from a pose, two by two samples a pixel. */
function photograph(rotation: number[], translation: number[], camera: Intrinsics, width: number, height: number): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  const r = rotation;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let light = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        // The ray through the sample, in the sheet's frame: camera at -Rᵀt, direction Rᵀd.
        const d = [(px + ox - camera.cx) / camera.f, (py + oy - camera.cy) / camera.f, 1];
        const dir = [r[0]! * d[0]! + r[3]! * d[1]! + r[6]! * d[2]!, r[1]! * d[0]! + r[4]! * d[1]! + r[7]! * d[2]!, r[2]! * d[0]! + r[5]! * d[1]! + r[8]! * d[2]!];
        const eye = [0, 1, 2].map((k) => -(r[k]! * translation[0]! + r[3 + k]! * translation[1]! + r[6 + k]! * translation[2]!));
        const s = -eye[2]! / dir[2]!;
        const x = eye[0]! + dir[0]! * s;
        const y = eye[1]! + dir[1]! * s;
        const onSheet = s > 0 && Math.abs(x) <= 105 && Math.abs(y) <= 148.5;
        light += onSheet ? (sheetWhite(x, y) ? 235 : 25) : 120;
      }
      const value = light / 4;
      const i = (py * width + px) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const angleBetween = (a: number[], b: number[]): number => {
  // trace(AᵀB) = 1 + 2 cos θ.
  let trace = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) trace += a[r * 3 + c]! * b[r * 3 + c]!;
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
};

describe('the marker sheet', () => {
  it('prints five markers on an A4 page of its real size, in the margins its words', () => {
    const svg = markerSheetSvg();
    expect(svg).toContain('width="210mm" height="297mm"');
    expect(svg).toContain(`${MARKER_MM} mm`);
    expect(SHEET_MARKERS.map((marker) => marker.id)).toEqual([0, 1, 2, 3, 4]);
    // Every marker stays on the page with a white surround of at least a cell.
    for (const marker of SHEET_MARKERS) {
      expect(Math.abs(marker.x) + MARKER_MM / 2).toBeLessThanOrEqual(105 - MARKER_MM / 8);
      expect(Math.abs(marker.y) + MARKER_MM / 2).toBeLessThanOrEqual(148.5 - MARKER_MM / 8);
    }
  });
});

describe('the camera over the sheet', () => {
  const camera = intrinsicsFor(640, 480, 65);

  it('is recovered from where exact corners show', () => {
    const rotation = turn(-0.6, 0.2, 0.3);
    const translation = [20, -10, 420];
    const sheet: Point[] = [];
    const seen: Point[] = [];
    for (const marker of SHEET_MARKERS) for (const [dx, dy] of [[-25, -25], [25, -25], [25, 25], [-25, 25]] as const) {
      const point = { x: marker.x + dx, y: marker.y + dy };
      sheet.push(point);
      seen.push(project({ rotation, translation }, camera, point)!);
    }
    const pose = sheetPose(sheet, seen, camera)!;
    expect(pose.error).toBeLessThan(1e-4);
    expect(angleBetween(pose.rotation, rotation)).toBeLessThan(1e-5);
    pose.translation.forEach((value, k) => expect(value).toBeCloseTo(translation[k]!, 3));
  });

  for (const [name, rotation, translation] of [
    ['from straight above', turn(0, 0, 0.1), [0, 0, 380]],
    ['from a seated player\'s angle', turn(-0.7, 0.15, -0.2), [-15, 30, 430]],
  ] as const) {
    it(`is found in a camera picture of the sheet, ${name}`, () => {
      const picture = photograph([...rotation], [...translation], camera, 640, 480);
      const tracked = new SheetTracker().track(picture, camera);
      expect(tracked).not.toBeNull();
      expect(tracked!.markers.length).toBeGreaterThanOrEqual(3);
      // Within a degree and a centimetre at arm's length.
      expect(angleBetween(tracked!.pose.rotation, [...rotation])).toBeLessThan(Math.PI / 180);
      const off = Math.hypot(...tracked!.pose.translation.map((v, k) => v - translation[k]!));
      expect(off).toBeLessThan(10);
    });
  }

  it('is not found in a picture without the sheet', () => {
    const blank = { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(128) };
    expect(new SheetTracker().track(blank, intrinsicsFor(320, 240, 65))).toBeNull();
  });
});

describe('the steadied pose', () => {
  const still = { rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 400] };

  it('eases out a wobble and takes a real move at once', () => {
    const smoother = new PoseSmoother();
    smoother.next(still, 0);
    const wobble = smoother.next({ ...still, translation: [0.5, 0, 400] }, 33)!;
    expect(wobble.translation[0]).toBeLessThan(0.5);
    expect(wobble.translation[0]).toBeGreaterThan(0);
    const moved = smoother.next({ ...still, translation: [80, 0, 400] }, 66)!;
    expect(moved.translation[0]).toBeCloseTo(80, 6);
  });

  it('holds the last pose a moment while the sheet is out of sight, then lets go', () => {
    const smoother = new PoseSmoother();
    smoother.next(still, 0);
    expect(smoother.next(null, HOLD_MS - 1)).not.toBeNull();
    expect(smoother.next(null, HOLD_MS + 1)).toBeNull();
  });
});

describe('what the screen shows of the camera picture', () => {
  it('is the middle of a picture wider than the screen, as a cover fit crops it', () => {
    const camera = intrinsicsFor(1280, 720, 65);
    // A tall phone screen showing a wide picture: its sides are cut off.
    const frustum = coverFrustum(camera, 1280, 720, 390, 844);
    expect(frustum.top).toBeCloseTo(-camera.cy / camera.f, 9);
    expect(frustum.bottom).toBeCloseTo(camera.cy / camera.f, 9);
    expect(frustum.left).toBeCloseTo(-frustum.right, 9);
    expect((frustum.right - frustum.left) / (frustum.bottom - frustum.top)).toBeCloseTo(390 / 844, 9);
  });
});
