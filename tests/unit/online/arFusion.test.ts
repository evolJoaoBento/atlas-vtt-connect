import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { deviceRotation, flatSheet, placeFor, SensorFusion, sheetHeading } from '../../../online-client/ar/fusion.mts';
import { SHEET_MARKERS, MARKER_MM } from '../../../online-client/ar/markerSheet.mts';
import { intrinsicsFor, project, type Point } from '../../../online-client/ar/sheetPose.mts';

const DEG = Math.PI / 180;
const mul = (a: number[], b: number[]): number[] => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out;
};
const transpose = (m: number[]): number[] => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
const angle = (a: number[], b: number[]): number => {
  let trace = 0;
  for (let i = 0; i < 9; i++) trace += a[i]! * b[i]!;
  return Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2)));
};
/** A small turn about a random axis. */
const tremble = (radians: number, seed: number): number[] => {
  const axis = new THREE.Vector3(Math.sin(seed * 12.9), Math.cos(seed * 78.2), Math.sin(seed * 3.7)).normalize();
  const m = new THREE.Matrix4().makeRotationAxis(axis, radians).elements;
  return [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!];
};

const camera = intrinsicsFor(640, 480, 65);
const corners: Point[] = SHEET_MARKERS.flatMap((marker) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([dx, dy]) => ({ x: marker.x + (dx! * MARKER_MM) / 2, y: marker.y + (dy! * MARKER_MM) / 2 })));

describe('the phone\'s turn from its motion sensors', () => {
  it('is Tabletop\'s eye view turn, in computer vision\'s camera axes', () => {
    for (const [alpha, beta, gamma, screen] of [[0, 0, 0, 0], [30, 50, -10, 0], [200, 70, 20, 90], [10, 120, -40, 270]] as const) {
      // Tabletop's deviceQuaternion, written out with three.js.
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ'));
      q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
      q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screen * DEG));
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const m = deviceRotation(alpha, beta, gamma, screen);
      // Vision's z (ahead) is three's −z; its y (down the picture) three's −y.
      expect(m[2]).toBeCloseTo(ahead.x, 9);
      expect(m[5]).toBeCloseTo(ahead.y, 9);
      expect(m[8]).toBeCloseTo(ahead.z, 9);
      expect(m[1]).toBeCloseTo(-up.x, 9);
      expect(m[4]).toBeCloseTo(-up.y, 9);
      expect(m[7]).toBeCloseTo(-up.z, 9);
    }
  });

  it('looks straight down with the phone lying flat', () => {
    const m = deviceRotation(0, 0, 0, 0);
    expect(m[5]).toBeCloseTo(-1, 9);
  });
});

describe('the flat sheet', () => {
  it('lies face up at its heading, and its heading reads back', () => {
    const sheet = flatSheet(0.7);
    const { heading, tilt } = sheetHeading(sheet);
    expect(heading).toBeCloseTo(0.7, 9);
    expect(tilt).toBeCloseTo(0, 6);
    // A turn: its transpose is its inverse.
    mul(sheet, transpose(sheet)).forEach((value, i) => expect(value).toBeCloseTo(i % 4 === 0 ? 1 : 0, 9));
  });

  it('gives the camera\'s place from the corners, its turn known', () => {
    const rotation = mul(transpose(deviceRotation(40, 45, 5, 0)), flatSheet(0.3));
    const translation = [12, -30, 420];
    const seen = corners.map((point) => project({ rotation, translation }, camera, point)!);
    const t = placeFor(rotation, corners, seen, camera)!;
    t.forEach((value, k) => expect(value).toBeCloseTo(translation[k]!, 6));
  });
});

describe('the fused pose', () => {
  /** A phone hovering over a sheet at heading 0.3, a little moving; the gyroscope exact, the markers' turn shaky. */
  function run(fusion: SensorFusion, frames: number, shake: number): Array<{ drawn: number[]; truth: number[]; place: number[]; truePlace: number[] }> {
    const heading = 0.3;
    const out: Array<{ drawn: number[]; truth: number[]; place: number[]; truePlace: number[] }> = [];
    for (let i = 0; i < frames; i++) {
      const time = i * 16;
      const world = deviceRotation(30 + i * 0.05, 48 + Math.sin(i / 20) * 3, 4, 0);
      fusion.orient(world, time);
      const rotation = mul(transpose(world), flatSheet(heading));
      const truePlace = [20 + i * 0.1, 260, -330];
      const translation = rotation.reduce<number[]>((acc, _, idx) => { if (idx % 3 === 0) acc.push(-(rotation[idx]! * truePlace[0]! + rotation[idx + 1]! * truePlace[1]! + rotation[idx + 2]! * truePlace[2]!)); return acc; }, []);
      // Markers every fourth frame (15 a second), from the picture of that moment.
      if (i % 4 === 0) {
        const seen = corners.map((point) => project({ rotation, translation }, camera, point)!);
        // What markers alone would give: the true turn, shaken.
        fusion.found(mul(tremble(shake, i + 1), rotation), corners, seen.map((p, k) => ({ x: p.x + Math.sin(k * 7 + i) * 0.4, y: p.y + Math.cos(k * 5 + i) * 0.4 })), camera, time);
      }
      // Drawn one frame on (the gyroscope's lag set aside).
      fusion.orient(world, time + 45);
      const pose = fusion.pose(time + 45, 0.016);
      if (pose) {
        const place = [0, 1, 2].map((k) => -(pose.rotation[k]! * pose.translation[0]! + pose.rotation[3 + k]! * pose.translation[1]! + pose.rotation[6 + k]! * pose.translation[2]!));
        out.push({ drawn: pose.rotation, truth: rotation, place, truePlace });
      }
    }
    return out;
  }

  it('turns exactly as the phone does, however the markers shake', () => {
    const frames = run(new SensorFusion(), 240, 2.5 * DEG);
    expect(frames.length).toBeGreaterThan(200);
    // Once settled, the drawn turn is within a few tenths of a degree, frame after frame.
    for (const frame of frames.slice(60)) expect(angle(frame.drawn, frame.truth)).toBeLessThan(0.6 * DEG);
  });

  it('keeps the camera\'s place steady, within a few millimetres', () => {
    const frames = run(new SensorFusion(), 240, 2.5 * DEG);
    for (const frame of frames.slice(60)) expect(Math.hypot(...frame.place.map((v, k) => v - frame.truePlace[k]!))).toBeLessThan(6);
  });

  it('takes no finding before the gyroscope has spoken, nor a sheet tipped up off the table', () => {
    const fusion = new SensorFusion();
    expect(fusion.found(flatSheet(0), corners, corners, camera, 0)).toBe(false);
    fusion.orient(deviceRotation(0, 0, 0, 0), 0);
    // A turn whose sheet stands upright in the world.
    const upright = mul(transpose(deviceRotation(0, 0, 0, 0)), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(fusion.found(upright, corners, corners, camera, 0)).toBe(false);
  });
});
