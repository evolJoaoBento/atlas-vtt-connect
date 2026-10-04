import { type BeamPoint } from './laserBeamGeometry';
export interface TrailPoint {
    x: number;
    y: number;
    timestamp: number;
}
export declare class LaserTrail {
    private points;
    get length(): number;
    last(): TrailPoint | undefined;
    add(x: number, y: number, now: number): void;
    /** Drops the points that have faded out. */
    prune(now: number): void;
    /** The trail from oldest to newest, each point with the share of its life left. */
    beamPoints(now: number): BeamPoint[];
    clear(): void;
}
