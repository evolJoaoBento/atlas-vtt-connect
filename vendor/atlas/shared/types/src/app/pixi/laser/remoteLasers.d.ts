/**
 * Other people's lasers as messages bring them: each a trail that fades like Atlas's own, its
 * newest point held at full strength until the laser is let go. A laser that hears nothing for
 * a second is let go, so a lost lift never leaves one hanging. Shared by the GM's view
 * (`RemoteLaserRenderer`) and code outside Obsidian (`@atlas-vtt/shared`).
 *
 * Messages arrive in bursts, unevenly. So a laser is played back, not drawn on arrival: its
 * points keep the spacing in time they were drawn with (the sender's `dt`, or an even spread
 * over one send interval without), the whole stroke runs `LASER_PLAYBACK_DELAY_MS` behind the
 * messages, and the head glides between points. A burst that is later than that delay moves the
 * stroke back a little instead of stalling it. Each trail point fades from its own time.
 */
import type { BeamPoint } from './laserBeamGeometry';
export declare const LASER_STALE_MS = 1000;
/** How far behind the messages a remote laser is drawn: enough to cover a late burst. */
export declare const LASER_PLAYBACK_DELAY_MS = 90;
/**
 * What one `receive` may bring in, so a flood of messages cannot cost the frame more than a few lasers' worth:
 * the newest `points` of a message count, a gap in time is at most `maxGapMs`, points are never queued further than
 * `maxAheadMs` past the playback time, and `senders` lasers at a time.
 */
export declare const REMOTE_LASER_LIMITS: {
    readonly points: 64;
    readonly maxGapMs: 2000;
    readonly maxAheadMs: 3000;
    readonly senders: 32;
};
interface Point {
    x: number;
    y: number;
}
export interface RemoteLaserFrame {
    from: string;
    color: string;
    /** Oldest to newest, the held point last at full strength. */
    trail: BeamPoint[];
    /** Where the laser is while it is held; null once let go. */
    head: Point | null;
}
/** `dt`: the milliseconds from each point to the one before it; `immediate`: the laser of this page, drawn as it is made. */
export interface LaserTiming {
    dt?: ReadonlyArray<number>;
    immediate?: boolean;
}
export declare class RemoteLasers {
    private readonly entries;
    get isActive(): boolean;
    receive(from: string, color: string, sent: ReadonlyArray<Point>, lifted: boolean, now: number, sentTiming?: LaserTiming): void;
    /** What to draw now; lasers that faded out are forgotten. */
    frame(now: number): RemoteLaserFrame[];
    clear(): void;
    /** Puts the points on the entry's timeline. */
    private enqueue;
    /** Points whose time has come join the trail, which fades each from its own time. */
    private play;
    /** The head between the point it left and the one it is heading for. */
    private headAt;
}
export {};
