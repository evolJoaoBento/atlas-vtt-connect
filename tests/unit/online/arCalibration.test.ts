import { describe, expect, it } from 'vitest';
import { FovCalibration, focalFrom, fovOf } from '../../../online-client/ar/calibrate.mts';
import { FIRST_MAT, MAT_MM, MATS_PER_PAGE, markerCells, markerGroup, markerMatSvg, SHEET_MARKERS, MARKER_MM } from '../../../online-client/ar/markerSheet.mts';
import { homography, intrinsicsFor, project, type Intrinsics, type Point } from '../../../online-client/ar/sheetPose.mts';
import { SheetTracker } from '../../../online-client/ar/sheetTracker.mts';

/** A turn: tilt about x, then a spin about the camera's axis, then a swing about z (radians), row by row. */
function turn(tilt: number, swing: number, spin = 0): number[] {
  const rx = [1, 0, 0, 0, Math.cos(tilt), -Math.sin(tilt), 0, Math.sin(tilt), Math.cos(tilt)];
  const rz = (a: number): number[] => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const mul = (a: number[], b: number[]): number[] => {
    const out: number[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
    return out;
  };
  return mul(rz(spin), mul(rx, rz(swing)));
}

/** The markers on the table: their ids, middles and sizes (millimetres). */
type Printed = Array<{ id: number; x: number; y: number; size: number }>;
const CELLS = new Map<number, { size: number; white: boolean[] }>();
const cells = (id: number): { size: number; white: boolean[] } => {
  let found = CELLS.get(id);
  if (!found) { found = markerCells(id); CELLS.set(id, found); }
  return found;
};

/** A camera picture of printed markers on white paper, two by two samples a pixel. */
function photograph(printed: Printed, rotation: number[], translation: number[], camera: Intrinsics, width: number, height: number): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(width * height * 4);
  const r = rotation;
  const eye = [0, 1, 2].map((k) => -(r[k]! * translation[0]! + r[3 + k]! * translation[1]! + r[6 + k]! * translation[2]!));
  const shade = (x: number, y: number): number => {
    for (const marker of printed) {
      const u = (x - (marker.x - marker.size / 2)) / marker.size;
      const v = (y - (marker.y - marker.size / 2)) / marker.size;
      if (u < 0 || v < 0 || u >= 1 || v >= 1) continue;
      const { size, white } = cells(marker.id);
      return white[Math.floor(v * size) * size + Math.floor(u * size)] ? 235 : 25;
    }
    return 235;
  };
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      let light = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]] as const) {
        const d = [(px + ox - camera.cx) / camera.f, (py + oy - camera.cy) / camera.f, 1];
        const dir = [0, 1, 2].map((k) => r[k]! * d[0]! + r[3 + k]! * d[1]! + r[6 + k]! * d[2]!);
        const s = -eye[2]! / dir[2]!;
        light += s > 0 ? shade(eye[0]! + dir[0]! * s, eye[1]! + dir[1]! * s) : 120;
      }
      const i = (py * width + px) * 4;
      data[i] = data[i + 1] = data[i + 2] = light / 4;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

const matPage: Printed = Array.from({ length: MATS_PER_PAGE }, (_, k) => {
  const corners = markerGroup(FIRST_MAT + k)!.corners;
  return { id: FIRST_MAT + k, x: (corners[0]!.x + corners[2]!.x) / 2, y: (corners[0]!.y + corners[2]!.y) / 2, size: MAT_MM };
});

describe('mat pages', () => {
  it('print 24 small markers on an A4 page, each placed on it', () => {
    const svg = markerMatSvg(0);
    expect(svg).toContain('width="210mm" height="297mm"');
    expect(markerGroup(FIRST_MAT)?.group).toBe('mat-0');
    expect(markerGroup(FIRST_MAT + MATS_PER_PAGE)?.group).toBe('mat-1');
    for (const marker of matPage) {
      expect(Math.abs(marker.x) + MAT_MM / 2).toBeLessThanOrEqual(105 - MAT_MM / 8);
      expect(Math.abs(marker.y) + MAT_MM / 2).toBeLessThanOrEqual(148.5 - MAT_MM / 8);
    }
  });

  const camera = intrinsicsFor(640, 480, 65);
  it('show a few whole markers leaning in close (12 cm)', () => {
    const picture = photograph(matPage, turn(-0.3, 0.2), [10, -5, 120], camera, 640, 480);
    const found = new SheetTracker().detect(picture, camera);
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('are still read from arm\'s length (60 cm, slanted)', () => {
    const picture = photograph(matPage, turn(-0.7, 0.3), [0, 40, 600], camera, 640, 480);
    const found = new SheetTracker().detect(picture, camera);
    expect(found.length).toBeGreaterThanOrEqual(8);
  });
});

describe('sharper corners', () => {
  it('find the markers\' corners to a few tenths of a pixel', () => {
    const camera = intrinsicsFor(640, 480, 65);
    const sheet: Printed = SHEET_MARKERS.map((marker) => ({ id: marker.id, x: marker.x, y: marker.y, size: MARKER_MM }));
    const rotation = turn(-0.6, 0.25, 0.1);
    const translation = [15, 20, 430];
    const found = new SheetTracker().detect(photograph(sheet, rotation, translation, camera, 640, 480), camera);
    expect(found.length).toBe(5);
    let total = 0;
    let count = 0;
    for (const marker of found) {
      const truth = markerGroup(marker.id)!.corners.map((corner) => project({ rotation, translation }, camera, corner)!);
      marker.seen.forEach((point, k) => { total += Math.hypot(point.x - truth[k]!.x, point.y - truth[k]!.y); count++; });
    }
    expect(total / count).toBeLessThan(0.2);
  });
});

describe('finding the field of view', () => {
  it('reads the focal length from a slanted page\'s homography', () => {
    const camera = intrinsicsFor(640, 480, 70);
    const points: Point[] = matPage.flatMap((marker) => markerGroup(marker.id)!.corners);
    const rotation = turn(-0.75, 0.4);
    const seen = points.map((point) => project({ rotation, translation: [20, 10, 450] }, camera, point)!);
    const found = focalFrom(homography(points, seen)!, camera.cx, camera.cy)!;
    expect(found.f).toBeCloseTo(camera.f, 3);
    // Straight on, it says nothing.
    const flat = points.map((point) => project({ rotation: turn(0.02, 0.3), translation: [0, 0, 450] }, camera, point)!);
    expect(focalFrom(homography(points, flat)!, camera.cx, camera.cy)).toBeNull();
  });

  it('settles within a degree or two from slanted pictures with a little noise', () => {
    const camera = intrinsicsFor(640, 480, 72);
    const points: Point[] = matPage.flatMap((marker) => markerGroup(marker.id)!.corners);
    const calibration = new FovCalibration();
    let i = 0;
    while (calibration.fov === null && i < 200) {
      i++;
      const rotation = turn(-(0.45 + (i % 7) * 0.08), i * 0.7, (i % 5) * 0.05);
      const seen = points.map((point, k) => {
        const p = project({ rotation, translation: [(i % 3) * 20 - 20, (i % 4) * 15 - 20, 420 + (i % 5) * 30] }, camera, point)!;
        return { x: p.x + Math.sin(k * 3.1 + i) * 0.4, y: p.y + Math.cos(k * 1.7 + i * 2) * 0.4 };
      });
      calibration.add(homography(points, seen)!, camera.cx, camera.cy, 640);
    }
    expect(calibration.fov).not.toBeNull();
    expect(Math.abs(calibration.fov! - fovOf(camera.f, 640))).toBeLessThan(1.5);
  });
});
