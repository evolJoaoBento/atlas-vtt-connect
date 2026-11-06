import { afterEach, describe, expect, it } from 'vitest';
import { fovOf } from '../../../online-client/ar/calibrate.mts';
import { CalibrationWizard, pageView, PER_SIDE, type Side } from '../../../online-client/ar/calibrationWizard.mts';
import { FIRST_MAT, MATS_PER_PAGE, markerGroup } from '../../../online-client/ar/markerSheet.mts';
import { intrinsicsFor, project, type Intrinsics } from '../../../online-client/ar/sheetPose.mts';
import type { Detected } from '../../../online-client/ar/sheetTracker.mts';

const DEG = Math.PI / 180;
const norm = (v: number[]): number[] => { const n = Math.hypot(v[0]!, v[1]!, v[2]!); return v.map((x) => x / n); };
const cross = (a: number[], b: number[]): number[] => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];

/** A camera `distance` mm from the page's middle, slanted `slant` from straight above, over `side`, looking at the middle. */
function cameraOver(side: Side | null, slant: number, distance: number, wobble = 0): { rotation: number[]; translation: number[] } {
  const azimuth = { right: 0, bottom: 90, left: 180, top: -90 }[side ?? 'right'] * DEG + wobble;
  const s = side ? slant * DEG : 0.001;
  const eye = [distance * Math.sin(s) * Math.cos(azimuth), distance * Math.sin(s) * Math.sin(azimuth), -distance * Math.cos(s)];
  const z = norm(eye.map((v) => -v));
  const x = norm(cross(z, [0, 0, 1]).map((v) => -v));
  const y = cross(z, x);
  const rotation = [...x, ...y, ...z];
  const translation = [0, 1, 2].map((r) => -(rotation[r * 3]! * eye[0]! + rotation[r * 3 + 1]! * eye[1]! + rotation[r * 3 + 2]! * eye[2]!));
  return { rotation, translation };
}

/** What the camera finds of mat page 1: each marker in the picture. */
function seen(pose: { rotation: number[]; translation: number[] }, camera: Intrinsics): Detected[] {
  const out: Detected[] = [];
  for (let k = 0; k < MATS_PER_PAGE; k++) {
    const id = FIRST_MAT + k;
    const corners = markerGroup(id)!.corners.map((corner) => project(pose, camera, corner));
    if (corners.some((corner) => !corner || corner.x < 0 || corner.y < 0 || corner.x > 640 || corner.y > 480)) continue;
    out.push({ id, seen: corners as Array<{ x: number; y: number }>, pose: null });
  }
  return out;
}

const camera = intrinsicsFor(640, 480, 68);

describe('how the page shows', () => {
  for (const side of ['bottom', 'right', 'top', 'left'] as const) {
    it(`tells the camera is over ${side}, slanted`, () => {
      const view = pageView(seen(cameraOver(side, 45, 520), camera), camera)!;
      expect(view.side).toBe(side);
      expect(view.slant).toBeGreaterThan(40);
      expect(view.slant).toBeLessThan(50);
      expect(view.markers).toBeGreaterThanOrEqual(view.needed);
    });
  }

  it('is straight above when looked at from above', () => {
    const view = pageView(seen(cameraOver(null, 0, 480), camera), camera)!;
    expect(view.side).toBeNull();
    expect(view.slant).toBeLessThan(2);
  });
});

describe('calibrating step by step', () => {
  const roots: HTMLElement[] = [];
  afterEach(() => { for (const root of roots.splice(0)) root.remove(); });

  const press = (root: HTMLElement, words: string): void => {
    const button = [...root.querySelectorAll('button')].find((b) => b.textContent === words);
    expect(button, words).toBeTruthy();
    expect(button!.disabled, `${words} enabled`).toBe(false);
    button!.click();
  };

  it('walks from above round the four sides to the field of view, and saves it', () => {
    const root = document.createElement('div');
    document.body.append(root);
    roots.push(root);
    let saved: number | null = null;
    const wizard = new CalibrationWizard(root, { done: (fov) => { saved = fov; }, skip: () => undefined, currentFov: () => 65 });
    const title = (): string => root.querySelector('.ar-wizard__title')?.textContent ?? '';
    // The tracking guesses 65°; the lens is 68°: the slant tells it.
    const guess = intrinsicsFor(640, 480, 65);
    const show = (pose: { rotation: number[]; translation: number[] }): void => wizard.observe(seen(pose, camera), guess, 640, 640);
    expect(title()).toBe('Calibrate the camera');
    press(root, 'Start');
    expect(title()).toBe('From above');
    // Next waits for the checks: twice the same view is a phone held still.
    expect([...root.querySelectorAll('button')].find((b) => b.textContent === 'Next')!.disabled).toBe(true);
    show(cameraOver(null, 0, 480));
    show(cameraOver(null, 0, 480));
    press(root, 'Next');
    for (const side of ['bottom', 'right', 'top', 'left'] as const) {
      expect(title()).toMatch(new RegExp(side));
      // From the wrong side, Capture waits.
      show(cameraOver(side === 'bottom' ? 'top' : 'bottom', 45, 520));
      show(cameraOver(side === 'bottom' ? 'top' : 'bottom', 45, 520));
      expect([...root.querySelectorAll('button')].find((b) => b.textContent === 'Capture')!.disabled).toBe(true);
      show(cameraOver(side, 45, 520));
      show(cameraOver(side, 45, 520));
      press(root, 'Capture');
      // Pictures a little apart, still enough to be held still.
      for (let i = 0; i <= PER_SIDE; i++) show(cameraOver(side, 44 + (i % 3), 520, (i % 2) * 0.002));
    }
    expect(title()).toBe('Calibrated');
    press(root, 'Save');
    expect(saved).not.toBeNull();
    expect(Math.abs(saved! - fovOf(camera.f, 640))).toBeLessThan(1);
    wizard.dispose();
  });
});
