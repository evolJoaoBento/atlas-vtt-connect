/**
 * The GM's working view of the presented scene, as players receive it in
 * `scene-camera`: the visible world area's centre and size, in world units. It
 * carries no `seq`: it is the latest camera, not part of the scene. Shared with
 * the web player page, so this file imports nothing.
 */
export interface SceneCamera {
  sceneId: string;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** The GM camera is sent at most this often. */
export const CAMERA_INTERVAL_MS = 100;

const MIN_EXTENT = 0.01;
const hundredths = (value: number): number => Math.round(value * 100) / 100;

/** Rounded to hundredths of a world unit: finer moves are invisible and would only cost messages. */
export function roundedCamera(camera: SceneCamera): SceneCamera {
  return {
    sceneId: camera.sceneId,
    centerX: hundredths(camera.centerX),
    centerY: hundredths(camera.centerY),
    width: Math.max(MIN_EXTENT, hundredths(camera.width)),
    height: Math.max(MIN_EXTENT, hundredths(camera.height)),
  };
}

export function sameCamera(a: SceneCamera | null, b: SceneCamera | null): boolean {
  if (a === null || b === null) return a === b;
  return a.sceneId === b.sceneId && a.centerX === b.centerX && a.centerY === b.centerY
    && a.width === b.width && a.height === b.height;
}

/** The camera of a validated message, its named fields only: network data may carry more. */
export function cameraOfMessage(message: SceneCamera): SceneCamera {
  return {
    sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height,
  };
}
