// online-client/ar/viewSender.mts
/**
 * Tells the GM where this phone looks from in augmented reality, for the eye on the GM's board: the camera's pose in
 * board units, about ten times a second while it moves, once a second while it lies still (so the GM knows it is still
 * there), and null once when the tracking is lost or AR ends. About 150 bytes a message.
 */
import type { ArPose } from '../../src/app/online/tools/arViews';

/** The fastest it sends, and the slowest while nothing moves. */
export const VIEW_EVERY_MS = 100;
export const VIEW_HEARTBEAT_MS = 1000;
/** Moved less than this (board units) and turned less than this (radians): still. */
const STILL_MOVE = 0.5;
const STILL_TURN = 0.5 * (Math.PI / 180);

/** Rounded for the wire: a hundredth of a board unit, and quaternions to five places. */
function rounded(pose: ArPose): ArPose {
  const at = (value: number, places: number): number => Math.round(value * 10 ** places) / 10 ** places;
  return {
    position: [at(pose.position[0], 2), at(pose.position[1], 2), at(pose.position[2], 2)],
    quaternion: [at(pose.quaternion[0], 5), at(pose.quaternion[1], 5), at(pose.quaternion[2], 5), at(pose.quaternion[3], 5)],
  };
}

/** The angle between two orientations (radians). */
function turned(a: ArPose['quaternion'], b: ArPose['quaternion']): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

export class ViewSender {
  private last: ArPose | null = null;
  private lastAt = -Infinity;
  /** Whether the GM was last told of a pose (so a null is owed when it goes). */
  private told = false;
  /** For the tracking numbers: messages that went, ones the session would not send, and the last pose sent. */
  readonly counts = { sent: 0, refused: 0, noPose: 0, last: null as ArPose | null };

  constructor(private readonly send: (pose: ArPose | null) => boolean) {}

  /** The camera's pose now (null: not tracking); `now` in milliseconds. */
  update(pose: ArPose | null, now: number): void {
    if (!pose) {
      this.counts.noPose++;
      if (this.told && this.send(null)) this.told = false;
      this.last = null;
      return;
    }
    if (now - this.lastAt < VIEW_EVERY_MS) return;
    const last = this.last;
    const still = last !== null
      && Math.hypot(pose.position[0] - last.position[0], pose.position[1] - last.position[1], pose.position[2] - last.position[2]) < STILL_MOVE
      && turned(pose.quaternion, last.quaternion) < STILL_TURN;
    if (still && now - this.lastAt < VIEW_HEARTBEAT_MS) return;
    const wire = rounded(pose);
    if (!this.send(wire)) { this.counts.refused++; return; }
    this.counts.sent++;
    this.counts.last = wire;
    this.last = wire;
    this.lastAt = now;
    this.told = true;
  }

  /** AR ended: the GM's eye goes. */
  stop(): void {
    this.update(null, 0);
  }
}
